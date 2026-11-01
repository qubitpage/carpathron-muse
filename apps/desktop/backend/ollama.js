// Local models through Ollama (on this PC, works offline): install, start, list, download with progress, delete,
// and a tuned copy of each model with a large enough context window for the agent (Ollama's OpenAI-compatible endpoint
// cannot set the context size per request, so "carpathron-<model>" is created with PARAMETER num_ctx — instant, it
// shares the model files).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { CompatOllama, needsCompat } = require('./ollama-compat');

const IS_WIN = process.platform === 'win32';
const DEFAULT_BASE = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'muse-glimmer';
// Meta open-weight models offered for download (any Ollama model name works too)
const SUGGESTED = [
  { name: 'muse-glimmer', size: '18 GB', about: 'Meta Muse Glimmer 30B — tools, vision, reasoning. Best quality; 24 GB GPU ideal, 16 GB works (slower).' },
  { name: 'hf.co/bartowski/Muse-Glimmer-30B-GGUF:Q3_K_M', size: '17.8 GB (with vision)', about: 'Muse Glimmer 30B, 3-bit — for 12–16 GB GPUs; close to full quality.' },
  { name: 'hf.co/bartowski/Muse-Glimmer-30B-GGUF:IQ3_XXS', size: '15.4 GB (with vision)', about: 'Muse Glimmer 30B, compact 3-bit — for 8–12 GB GPUs (part runs on the CPU, slower; use a 8K–16K context).' },
  { name: 'llama3.2-vision:11b', size: '7.8 GB', about: 'Meta Llama 3.2 Vision 11B — the eyes for Llama 3.1 8B and the robot camera (photos, room map, go-to) offline. Runs on a compatibility runner the app sets up by itself.' },
  { name: 'qwen3-vl:2b', size: '1.9 GB', about: 'Qwen3-VL 2B (not Meta) — very fast eyes that fit on the GPU together with Llama 3.1 8B.' },
  { name: 'llama3.1:8b', size: '4.9 GB', about: 'Meta Llama 3.1 8B — tools, fast on 8 GB GPUs.' },
  { name: 'llama3.2:3b', size: '2.0 GB', about: 'Meta Llama 3.2 3B — very fast, small tasks and offline basics.' },
];
const TUNED_PREFIX = 'carpathron-';
// Pick the best model for this PC's graphics memory (GB of VRAM; 0 = no NVIDIA GPU found).
function recommend(vram) {
  if (vram >= 20) return { name: 'muse-glimmer', why: 'fits fully on your GPU' };
  if (vram >= 12) return { name: 'hf.co/bartowski/Muse-Glimmer-30B-GGUF:Q3_K_M', why: 'Glimmer 3-bit, mostly on your GPU' };
  if (vram >= 7) return { name: 'hf.co/bartowski/Muse-Glimmer-30B-GGUF:IQ3_XXS', why: 'the smallest good Glimmer; for speed use llama3.1:8b, which fits fully on the GPU', fast: 'llama3.1:8b' };
  if (vram >= 4) return { name: 'llama3.1:8b', why: 'fits your GPU' };
  return { name: 'llama3.2:3b', why: 'runs on the CPU' };
}

const rootOf = (base) => String(base || DEFAULT_BASE).replace(/\/+$/, '').replace(/\/v1$/, '');
const tunedName = (name, ctx) => `${TUNED_PREFIX}${String(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')}-${Math.round(ctx / 1024)}k`;

class Ollama {
  constructor({ getSettings, saveSettings, emit, log }) {
    this.getSettings = getSettings; this.saveSettings = saveSettings || (() => {}); this.emit = emit || (() => {}); this.log = log || (() => {});
    this.pulls = new Map(); // name -> { abort, status, completed, total }
    this.installing = null;
    this.compat = new CompatOllama({ main: this, emit: this.emit, log: this.log }); // Llama 3.2 Vision (mllama) runner
    // 1.8.3 saved the Hugging Face path; Ollama publishes the same model as "muse-glimmer"
    const st = this.getSettings();
    if (st && /meta-models\/Muse-Glimmer-30B-GGUF/i.test(String(st.localModel || ''))) { st.localModel = DEFAULT_MODEL; this.saveSettings(); }
    if (st && Array.isArray(st.localModels)) st.localModels = st.localModels.map((n) => (/meta-models\/Muse-Glimmer-30B-GGUF/i.test(n) ? DEFAULT_MODEL : n));
  }
  s() { return this.getSettings(); }
  root() { return rootOf(this.s().localBase); }
  context() { return Math.max(8192, Math.min(262144, Number(this.s().localContext) || 32768)); }
  isLocalBase() { try { return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(this.root()).hostname); } catch { return false; } }

  async api(p, { method = 'GET', body, timeoutMs = 15000 } = {}) {
    const res = await fetch(`${this.root()}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error((j && j.error) || `${res.status} ${text.slice(0, 200)}`);
    return j;
  }

  // Ollama's model folder (shared with the compatibility runner)
  modelsDir() { return process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models'); }
  // Free the GPU: unload every model this server holds.
  async unloadAll() {
    try {
      const ps = await this.api('/api/ps', { timeoutMs: 2000 });
      for (const m of ps.models || []) await this.api('/api/generate', { method: 'POST', body: { model: m.name, keep_alive: 0 }, timeoutMs: 20000 }).catch(() => {});
      return (ps.models || []).length;
    } catch { return 0; }
  }

  // where ollama.exe is (null = not installed)
  binary() {
    const cands = [];
    if (this.s().ollamaBin) cands.push(this.s().ollamaBin);
    if (IS_WIN) {
      cands.push(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe'));
      cands.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'));
    } else cands.push('/usr/local/bin/ollama', '/usr/bin/ollama', path.join(os.homedir(), '.local', 'bin', 'ollama'));
    for (const c of cands) try { if (c && fs.existsSync(c)) return c; } catch {}
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      const f = path.join(dir, IS_WIN ? 'ollama.exe' : 'ollama');
      try { if (dir && fs.existsSync(f)) return f; } catch {}
    }
    return null;
  }

  // NVIDIA GPU name and memory (cached). Other GPUs: vram 0 → CPU-friendly suggestions.
  gpu() {
    if (this._gpu) return this._gpu;
    this._gpu = new Promise((resolve) => {
      require('child_process').execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true }, (err, out) => {
        const l = !err && String(out || '').split(/\r?\n/).find((x) => x.includes(','));
        if (!l) return resolve({ name: '', vram: 0 });
        const [name, mb] = l.split(',').map((x) => x.trim());
        resolve({ name, vram: Math.round((Number(mb) || 0) / 1024) });
      });
    });
    return this._gpu;
  }
  async status() {
    const out = { base: `${this.root()}/v1`, installed: !!this.binary(), binary: this.binary(), running: false, version: '', models: [], suggested: SUGGESTED, context: this.context(), defaultModel: this.s().localModel || DEFAULT_MODEL, enabled: this.enabledModels(), fallback: this.s().localFallback !== false, pulls: [...this.pulls.entries()].map(([name, p]) => ({ name, status: p.status, completed: p.completed, total: p.total })), installing: this.installing };
    out.gpu = await this.gpu(); out.recommended = recommend(out.gpu.vram);
    try { out.version = (await this.api('/api/version', { timeoutMs: 3000 })).version || ''; out.running = true; } catch { return out; }
    if (!out.installed && this.isLocalBase()) out.installed = true; // running from somewhere we did not find
    try {
      const tags = await this.api('/api/tags');
      out.models = (tags.models || []).filter((m) => !String(m.name).startsWith(TUNED_PREFIX)).map((m) => ({ compat: needsCompat(m.details), name: m.name, size: m.size, sizeLabel: `${(m.size / 1e9).toFixed(1)} GB`, params: (m.details && m.details.parameter_size) || '', family: (m.details && m.details.family) || '', quant: (m.details && m.details.quantization_level) || '', modified: m.modified_at }));
      await Promise.all(out.models.map(async (m) => { try { const sh = await this.api('/api/show', { method: 'POST', body: { model: m.name } }); m.caps = sh.capabilities || []; require('./models').setLocalCaps(m.name, m.caps); const ci = Object.entries(sh.model_info || {}).find(([k]) => /context_length$/.test(k)); m.maxContext = ci ? ci[1] : 0; } catch { m.caps = []; } }));
    } catch {}
    for (const m of out.models) if (m.compat) this.compat.models.add(m.name);
    out.compat = await this.compat.status();
    return out;
  }

  enabledModels() {
    const s = this.s();
    if (Array.isArray(s.localModels)) return s.localModels;
    return s.localEnabled ? [s.localModel || DEFAULT_MODEL] : [];
  }
  setEnabled(names) { this.s().localModels = [...new Set((names || []).map(String).filter(Boolean))]; this.s().localEnabled = this.s().localModels.length > 0; this.saveSettings(); }

  // Start the Ollama server if it is installed but not running.
  async start() {
    try { await this.api('/api/version', { timeoutMs: 2000 }); return { ok: true, already: true }; } catch {}
    const bin = this.binary();
    if (!bin) throw new Error('Ollama is not installed. Use "Install Ollama" first.');
    const env = { ...process.env, OLLAMA_CONTEXT_LENGTH: String(this.context()) };
    let child;
    try { child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env }); child.unref(); }
    catch (e) { throw new Error(`Could not start Ollama: ${e.message}`); }
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { const v = await this.api('/api/version', { timeoutMs: 2000 }); this.log(`Ollama ${v.version} started`); return { ok: true, version: v.version }; } catch {}
    }
    throw new Error('Ollama did not start within 20 seconds. Start it from the Start menu, then try again.');
  }
  // Used before a local request: start Ollama by itself when it is installed but not running.
  async ensureRunning() {
    try { await this.api('/api/version', { timeoutMs: 2000 }); return true; } catch {}
    if (!this.isLocalBase() || !this.binary()) return false;
    try { await this.start(); return true; } catch { return false; }
  }

  // Install Ollama with winget (Windows). Progress lines go to the UI.
  install() {
    if (this.installing) return { started: false, message: 'Already installing.' };
    if (!IS_WIN) throw new Error('Install Ollama from https://ollama.com/download (one command on Linux/macOS).');
    this.installing = { status: 'installing', lines: [] };
    const args = ['install', '-e', '--id', 'Ollama.Ollama', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'];
    const child = spawn('winget', args, { windowsHide: true });
    const line = (d) => { const t = String(d).replace(/\r/g, '\n').split('\n').map((x) => x.trim()).filter((x) => x && !/^[-\\|/]$/.test(x) && !/^[█▒ ]+$/.test(x)); for (const x of t) { this.installing.lines.push(x); this.installing.lines = this.installing.lines.slice(-12); } this.emit('local:install', this.installing); };
    child.stdout.on('data', line); child.stderr.on('data', line);
    child.on('error', (e) => { this.installing = { status: 'error', lines: [`winget is not available (${e.message}). Download Ollama from https://ollama.com/download`] }; this.emit('local:install', this.installing); const done = this.installing; setTimeout(() => { if (this.installing === done) this.installing = null; }, 60000); });
    child.on('close', async (code) => {
      const ok = code === 0 || !!this.binary();
      this.installing = { status: ok ? 'done' : 'error', lines: [...(this.installing ? this.installing.lines : []), ok ? 'Ollama is installed.' : `winget exit code ${code}`] };
      this.emit('local:install', this.installing);
      if (ok) { try { await this.start(); } catch {} }
      this.emit('local:status', await this.status().catch(() => ({})));
      const done = this.installing; setTimeout(() => { if (this.installing === done) this.installing = null; }, 60000);
    });
    return { started: true };
  }

  // Download a model (streamed progress). Resolves when finished; the UI follows "local:pull" events.
  async pull(name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Model name is needed');
    if (this.pulls.has(name)) return { started: false, message: 'Already downloading.' };
    if (!(await this.ensureRunning())) throw new Error('Ollama is not running. Install or start it first.');
    const ctl = new AbortController();
    const p = { abort: ctl, status: 'starting', completed: 0, total: 0 };
    this.pulls.set(name, p);
    const tick = () => this.emit('local:pull', { name, status: p.status, completed: p.completed, total: p.total, error: p.error || '' });
    (async () => {
      try {
        const res = await fetch(`${this.root()}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, stream: true }), signal: ctl.signal });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const dec = new TextDecoder(); let buf = ''; let last = 0;
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!l) continue;
            let j; try { j = JSON.parse(l); } catch { continue; }
            if (j.error) throw new Error(j.error);
            p.status = j.status || p.status;
            if (j.total) { p.total = j.total; p.completed = j.completed || 0; }
            if (Date.now() - last > 400 || /success/.test(p.status)) { last = Date.now(); tick(); }
          }
        }
        if (!/success/.test(p.status)) throw new Error(`download ended early (${p.status})`);
        p.status = 'preparing';
        tick();
        await this.tuned(name);
        if (this.compat.uses(name) && !this.compat.exe()) { this.log(`${name} needs the compatibility runner: setting it up`); try { this.compat.install(); } catch {} }
        p.status = 'done';
        if (!this.enabledModels().includes(name)) this.setEnabled([...this.enabledModels(), name]);
        if (!this.s().localModel || this.s().localModel === 'hf.co/meta-models/Muse-Glimmer-30B-GGUF:Q4_K_M') { this.s().localModel = name; this.saveSettings(); }
        this.log(`local model ${name} downloaded`);
      } catch (e) {
        p.status = ctl.signal.aborted ? 'cancelled' : 'error';
        p.error = ctl.signal.aborted ? '' : e.message;
      } finally {
        tick();
        this.pulls.delete(name);
        this.emit('local:status', await this.status().catch(() => ({})));
      }
    })();
    return { started: true };
  }
  cancelPull(name) { const p = this.pulls.get(name); if (p) p.abort.abort(); return !!p; }

  async remove(name) {
    await this.api('/api/delete', { method: 'DELETE', body: { model: name } });
    try { await this.api('/api/delete', { method: 'DELETE', body: { model: tunedName(name, this.context()) } }); } catch {}
    this.setEnabled(this.enabledModels().filter((n) => n !== name));
    return { ok: true };
  }

  // The name to send requests to: a copy of the model with the agent's context window (created once, instant).
  // Muse Glimmer GGUF files from Hugging Face (smaller quantized builds) do not carry Ollama's Glimmer prompt format, and the
  // import adds stop words (<|message|>, <|start|>) that Glimmer writes at the start of every answer → empty replies.
  // Give them what the official muse-glimmer model has: the built-in glimmer renderer/parser and only the real end tokens.
  async formatFix(name) {
    try {
      const sh = await this.api('/api/show', { method: 'POST', body: { model: name } });
      const fam = (sh.details && (sh.details.family || '')) + ' ' + ((sh.details && sh.details.families) || []).join(' ');
      if (!/muse-glimmer/i.test(fam) || sh.renderer) return null;
      return { renderer: 'glimmer', parser: 'glimmer', parameters: { temperature: 1, top_k: 64, top_p: 0.95, stop: ['<|eot|>', '<|end_of_text|>'] } };
    } catch { return null; }
  }
  async tuned(name) {
    const ctx = this.context();
    const t = tunedName(name, ctx);
    this._tuned = this._tuned || new Map();
    if (this._tuned.get(t)) return t;
    try {
      const tags = await this.api('/api/tags');
      let exists = (tags.models || []).some((m) => m.name === t || m.name === `${t}:latest`);
      // Llama 3.2 Vision runs on the compatibility runner as it is (no tuned copy on the main server)
      if (this.compat.uses(name)) return name;
      const sh0 = await this.api('/api/show', { method: 'POST', body: { model: name } }).catch(() => null);
      if (sh0 && needsCompat(sh0.details)) { this.compat.models.add(name); return name; }
      const fix = await this.formatFix(name);
      // a copy made before the fix (e.g. by 1.8.4) answers empty: make it again
      if (exists && fix) { const sh = await this.api('/api/show', { method: 'POST', body: { model: t } }).catch(() => ({})); if (sh.renderer !== fix.renderer) exists = false; }
      if (!exists) await this.api('/api/create', { method: 'POST', body: { model: t, from: name, ...(fix || {}), parameters: { ...((fix && fix.parameters) || {}), num_ctx: ctx }, stream: false }, timeoutMs: 120000 });
      this._tuned.set(t, true);
      return t;
    } catch (e) {
      this.log(`ollama: could not create ${t} (${e.message}); using ${name} with its default context`);
      return name;
    }
  }
}

module.exports = { Ollama, SUGGESTED, recommend, DEFAULT_BASE, DEFAULT_MODEL, rootOf, tunedName, TUNED_PREFIX };
