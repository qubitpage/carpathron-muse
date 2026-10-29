// Settings + conversation persistence (JSON files in the app data folder).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  // engine: 'muse' = Muse Code with your Meta account, 'api' = Meta Model API key
  engine: 'auto',
  museBin: '',
  apiKey: '',
  apiBase: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  museModel: '',
  mode: 'ask', // ask | auto | full | plan
  workspace: '',
  maxSteps: 100, // Ask / Plan: pause after this many steps; Auto / Full: checkpoint, keeps going
  maxTotalSteps: 1000, // Auto / Full safety limit for one message
  finishAllTasks: true, // keep working while the task list has unfinished tasks
  verifyBeforeFinish: true, // one self-check pass before delivering work that changed something
  effort: '', // reasoning effort for Muse Spark / Wonder: '', minimal, low, medium, high, xhigh, max
  servers: [], // SSH servers (passwords/keys encrypted, see secrets.js)
  museBridge: true, // give Muse Code sessions the app's tools through the MCP bridge
  museSandbox: 'auto', // auto | on | off — Muse Code OS sandbox for shell commands
  museTrustWorkspace: true, // let Muse Code load skills/rules from the chat folder
  musePermissionProfile: '', // Muse Code permission profile ('' = host default, full mode picks a full-access one)
  arduinoCli: '',
  githubClientId: '', // optional OAuth App (device flow) for "Sign in with browser"
  webSearch: 'auto', // auto (Meta search grounding, then DuckDuckGo) | duckduckgo
  autoMemory: true,
  autoSkills: true,
  port: 8443,
  accessToken: '',
  systemPrompt: '',
  mcpServers: {}, // { name: { command, args: [], env: {}, enabled: true } }
  robot: { carIp: '', cameraUrl: '', turnMs360: 2400, turnSpeed: 70 },
  vision: true,
  whatsapp: {
    allowed: [], // phone numbers (digits, with country code) allowed to control the app
    personal: { enabled: false },
    cloud: { enabled: false, phoneNumberId: '', accessToken: '', verifyToken: '', appSecret: '', graphVersion: 'v21.0', cloudflaredPath: '' },
  },
};

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  // Windows: antivirus / indexer can briefly lock the target; retry, then fall back to a direct write.
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      const until = Date.now() + 40 * (i + 1); while (Date.now() < until) { /* short wait */ }
    }
  }
  fs.writeFileSync(file, data);
  try { fs.unlinkSync(tmp); } catch {}
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.convDir = path.join(dataDir, 'conversations');
    fs.mkdirSync(this.convDir, { recursive: true });
    this.settingsFile = path.join(dataDir, 'settings.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch {}
    this.settings = deepMerge(DEFAULT_SETTINGS, saved);
    if (!this.settings.accessToken) this.settings.accessToken = crypto.randomBytes(18).toString('base64url');
    const lw = String(this.settings.workspace || '').toLowerCase();
    if (process.platform === 'win32' && (lw.includes('\\program files') || lw.includes('\\windows\\'))) this.settings.workspace = '';
    if (!this.settings.workspace) {
      const home = require('os').homedir();
      this.settings.workspace = path.join(home, 'MuseCarpathron');
    }
    try { fs.mkdirSync(this.settings.workspace, { recursive: true }); } catch {}
    this.saveSettings();
    // Conversations are loaded lazily (index in memory, messages on demand) to keep RAM low.
    this.indexFile = path.join(dataDir, 'conversations.index.json');
    try { this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { this.index = {}; }
    this._reconcileIndex();
    this.loaded = new Map(); // id -> conversation (LRU)
    this.pinned = new Set(); // ids that must stay loaded (running turns)
    this._dirty = new Set();
    this._timer = setInterval(() => this.flush(), 1500);
    this._timer.unref?.();
  }

  // Make the chat list match the chat files on disk (recovers chats if the index file was not saved).
  _reconcileIndex() {
    let changed = false;
    const files = new Set();
    for (const f of fs.readdirSync(this.convDir)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      files.add(id);
      if (this.index[id]) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.convDir, f), 'utf8'));
        if (c && c.id) { this.index[c.id] = this._meta(c); changed = true; }
      } catch {}
    }
    for (const id of Object.keys(this.index)) if (!files.has(id)) { delete this.index[id]; changed = true; }
    if (changed) try { this._saveIndex(); } catch {}
  }

  _rebuildIndex() {
    for (const f of fs.readdirSync(this.convDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.convDir, f), 'utf8'));
        if (c && c.id) this.index[c.id] = this._meta(c);
      } catch {}
    }
    this._saveIndex();
  }
  _meta(c) { return { id: c.id, title: c.title, updatedAt: c.updatedAt, createdAt: c.createdAt, source: c.source, engine: c.engine, projectId: c.projectId || null, remote: c.remote && c.remote.serverId ? { serverId: c.remote.serverId, path: c.remote.path || '' } : null }; }
  _saveIndex() { writeAtomic(this.indexFile, JSON.stringify(this.index)); }

  saveSettings() { writeAtomic(this.settingsFile, JSON.stringify(this.settings, null, 2)); }
  updateSettings(patch) { this.settings = deepMerge(this.settings, patch); this.saveSettings(); return this.settings; }

  // Settings safe to send to the UI (secrets masked)
  publicSettings() {
    const s = JSON.parse(JSON.stringify(this.settings));
    s.hasApiKey = !!s.apiKey; delete s.apiKey;
    s.whatsapp.cloud.hasAccessToken = !!s.whatsapp.cloud.accessToken; delete s.whatsapp.cloud.accessToken;
    s.whatsapp.cloud.hasAppSecret = !!s.whatsapp.cloud.appSecret; delete s.whatsapp.cloud.appSecret;
    delete s.accessToken;
    delete s.servers;
    delete s.sshKeys;
    if (s.github) s.github = { connected: !!s.github.token, login: s.github.login || '', name: s.github.name || '', email: s.github.email || '' };
    s.avatarLinked = (s.avatarTokens || []).map((x) => ({ device: x.device, at: x.at })); delete s.avatarTokens;
    return s;
  }

  createConversation({ title = 'New chat', engine, model, source = 'app', workspace, projectId = null, remote = null } = {}) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const c = { id, title, engine, model, source, projectId, remote, workspace: workspace || this.settings.workspace, createdAt: now, updatedAt: now, messages: [], llm: [], museSessionId: null };
    this.loaded.set(id, c);
    this.touch(c);
    this._evict();
    return c;
  }
  get(id) {
    if (!id) return null;
    let c = this.loaded.get(id);
    if (c) { this.loaded.delete(id); this.loaded.set(id, c); return c; }
    if (!this.index[id]) return null;
    try { c = JSON.parse(fs.readFileSync(path.join(this.convDir, `${id}.json`), 'utf8')); }
    catch { return null; }
    this.loaded.set(id, c);
    this._evict();
    return c;
  }
  _evict() {
    while (this.loaded.size > 8) {
      const victim = [...this.loaded.keys()].find((id) => !this.pinned.has(id) && !this._dirty.has(id));
      if (!victim) break;
      this.loaded.delete(victim);
    }
  }
  list() { return Object.values(this.index).sort((a, b) => b.updatedAt - a.updatedAt); }
  touch(c) { c.updatedAt = Date.now(); this.index[c.id] = this._meta(c); this._dirty.add(c.id); }
  delete(id) {
    this.loaded.delete(id);
    this._dirty.delete(id);
    delete this.index[id];
    this._saveIndex();
    try { fs.unlinkSync(path.join(this.convDir, `${id}.json`)); } catch {}
  }
  flush() {
    if (!this._dirty.size) return;
    const failed = new Set();
    for (const id of this._dirty) {
      const c = this.loaded.get(id);
      if (c) try { writeAtomic(path.join(this.convDir, `${id}.json`), JSON.stringify(c)); } catch (e) { failed.add(id); this._lastError = e.message; }
    }
    this._dirty = failed; // retry failed saves on the next tick instead of dropping them
    try { this._saveIndex(); } catch (e) { this._lastError = e.message; }
    this._evict();
  }
  // Plain text of past conversations (for "search my chats"), newest first, read from disk lazily.
  *iterTexts(excludeId) {
    for (const meta of this.list()) {
      if (meta.id === excludeId) continue;
      const c = this.loaded.get(meta.id) || (() => { try { return JSON.parse(fs.readFileSync(path.join(this.convDir, `${meta.id}.json`), 'utf8')); } catch { return null; } })();
      if (!c) continue;
      const parts = c.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text || ''}`);
      yield { id: c.id, title: c.title, updatedAt: c.updatedAt, parts };
    }
  }
  close() { clearInterval(this._timer); this.flush(); }
}

module.exports = { Store, DEFAULT_SETTINGS, deepMerge };
