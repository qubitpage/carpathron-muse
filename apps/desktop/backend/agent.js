// Conversation runtime: runs turns on the chosen engine, streams events to every client,
// handles approvals (UI buttons, WhatsApp replies, or automatic by mode) and sub-agent orchestration.
'use strict';
const crypto = require('crypto');
const os = require('os');
const { BUILTIN, DELEGATE, execBuiltin, describeCall, clip } = require('./tools');
const { ApiEngine, compactHistory } = require('./engines/api');
const { MuseEngine, subjectSummary } = require('./engines/muse');

const fs = require('fs');
const path = require('path');
const uid = () => crypto.randomUUID();

// Folder metadata snapshot sent with the prompt (names only, never file contents).
function folderTree(root, maxEntries = 150, maxDepth = 2) {
  const out = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', '.next']);
  const walk = (dir, depth, indent) => {
    if (out.length >= maxEntries) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= maxEntries) { out.push(`${indent}…`); return; }
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      if (e.isDirectory()) {
        out.push(`${indent}${e.name}/`);
        if (depth < maxDepth && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1, indent + '  ');
      } else out.push(`${indent}${e.name}`);
    }
  };
  walk(root, 1, '');
  return out.join('\n') || '(empty folder)';
}

function systemPrompt(settings, conv, ctx = {}) {
  const { sub = false, memory = '', project = null, projectText = null, skills = [] } = ctx;
  const lines = [
    sub
      ? 'You are a sub-agent of Muse Carpathron. Complete only the task you were given, using tools as needed, then reply with a concise final report of what you did and found.'
      : 'You are Muse Carpathron, an agentic assistant running on the user\'s computer, powered by Meta Muse models. You work like a local bridge: you see the user\'s files through tools, decide what to do, and your tool calls are executed on the user\'s PC.',
    `Operating system: ${os.type()} ${os.release()} (${process.platform}). Shell for run_command: ${process.platform === 'win32' ? 'Windows PowerShell' : 'bash'}.`,
    `Attached folder (workspace): ${conv.workspace}. Relative paths are inside it.`,
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    'Work step by step: inspect before you change things, prefer small precise edits (edit_file) over rewriting whole files, and verify your work (run it, read it back).',
    'Tool calls may need the user\'s approval; if one is denied, do not retry the same action — adapt or ask.',
    'You can drive the Baby Carpathron robot car with robot_drive / robot_stop. Its camera is fixed to the car like a robot head: to look left/right/behind use robot_look (the car turns its body, photographs, turns back); robot_turn turns by degrees; robot_scan_room makes a room map. Voice notes from WhatsApp arrive as transcribed text.',
    'Answer in the user\'s language. Use Markdown. Be concise when reporting.',
  ];
  if (!sub) {
    lines.push('For big jobs that split into independent parts you may use the delegate tool to run sub-agents in parallel.');
    lines.push('Memory: when the user tells you a lasting fact or preference (name, projects, how they like answers, hardware they own), save it with memory_save. Use search_chats to recall details from earlier conversations and memory_search for saved facts. Never save passwords, keys or card numbers.');
  }
  if ((conv.mode || settings.mode) === 'plan') lines.push('PLAN MODE: you may only read and research. Do not try to change files, run commands or move the robot; propose a plan instead.');
  if (settings.systemPrompt) lines.push('', '## User instructions', settings.systemPrompt);
  if (memory) lines.push('', '## What you remember about the user (long-term memory)', memory);
  if (project) {
    lines.push('', `## Project: ${project.name}`);
    if (project.instructions) lines.push(project.instructions);
    if (projectText) lines.push('', '### Project knowledge (full text)', projectText);
    else if (project.files.length) lines.push('', `Project knowledge has ${project.files.length} files (${project.files.map((f) => f.name).slice(0, 30).join(', ')}). It is too big to include: use knowledge_search to pull the relevant passages before answering questions about it.`);
  }
  if (ctx.related) lines.push('', '## Possibly related earlier conversations (from chat history)', ctx.related);
  if (skills.length && !sub) lines.push('', '## Skills the user can call with /name', skills.map((k) => `- /${k.name}: ${k.description}`).join('\n'));
  if (ctx.tree) lines.push('', '## Attached folder contents (names only)', ctx.tree);
  return lines.join('\n');
}

const KNOWLEDGE_TOOLS = [
  { name: 'memory_save', risk: 'read', description: 'Save a lasting fact or preference about the user to long-term memory (shared across all chats). One short sentence per fact.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'memory_search', risk: 'read', description: 'Search long-term memory for saved facts.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'memory_forget', risk: 'read', description: 'Delete a memory by id (from memory_search) when the user asks to forget it or it is wrong.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'search_chats', risk: 'read', description: 'Search the user\'s earlier conversations (chat history) for details, decisions, code or facts discussed before.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];
const KNOWLEDGE_SEARCH = { name: 'knowledge_search', risk: 'read', description: 'Search this project\'s uploaded knowledge files (RAG) and return the most relevant passages with file names.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } };

class Agent {
  constructor({ store, robot, mcp, emit, log, memory, projects, skills, camera }) {
    this.camera = camera;
    this.memory = memory;
    this.projects = projects;
    this.skills = skills;
    this.store = store;
    this.robot = robot;
    this.mcp = mcp;
    this.emit = emit; // (event, data) → all UI clients + bridges
    this.log = log;
    this.api = new ApiEngine({ getSettings: () => this.store.settings });
    this.muse = new MuseEngine({ getSettings: () => this.store.settings, log });
    this.runtime = new Map(); // convId -> { running, abort, turnId }
    this.approvals = new Map(); // approvalId -> { convId, resolve, msg, choices }
    this.activity = []; // what went to the cloud and what ran locally (transparency view)
  }

  settings() { return this.store.settings; }

  // Live "what am I doing" line shown under the chat (like a progress indicator).
  status(conv, text) {
    const rt = this.runtime.get(conv.id);
    if (rt) rt.status = text;
    this.emit('turn:status', { convId: conv.id, text, ts: Date.now() });
  }

  track(entry) {
    const e = { ts: Date.now(), ...entry };
    this.activity.push(e);
    if (this.activity.length > 300) this.activity.shift();
    this.emit('activity', e);
  }

  promptContext(conv, { sub = false } = {}) {
    const ctx = { sub };
    if (!sub) {
      ctx.memory = this.memory.promptBlock(4000, conv.lastQuery || '');
      if (conv.lastQuery) {
        const related = this.searchChats(conv.lastQuery, conv.id, 2).filter((h) => h.score > 3);
        if (related.length) ctx.related = related.map((h) => `"${h.conv}" (${h.date}):\n${clip(h.text, 900)}`).join('\n---\n');
      }
    }
    if (conv.projectId) {
      try {
        const idx = this.projects.index(conv.projectId);
        ctx.project = idx.meta;
        ctx.projectText = this.projects.fullTextIfSmall(conv.projectId);
      } catch {}
    }
    ctx.skills = this.skills.list();
    ctx.tree = folderTree(conv.workspace);
    return ctx;
  }

  searchChats(query, excludeId, k = 6) {
    const { Bm25 } = require('./knowledge');
    const docs = [];
    let n = 0;
    for (const c of this.store.iterTexts(excludeId)) {
      if (++n > 400) break;
      // window the conversation into ~1500-char passages
      let buf = '';
      for (const p of c.parts) {
        buf += p + '\n';
        if (buf.length > 1500) { docs.push({ conv: c.title, convId: c.id, date: new Date(c.updatedAt).toISOString().slice(0, 10), text: buf }); buf = ''; }
      }
      if (buf.trim()) docs.push({ conv: c.title, convId: c.id, date: new Date(c.updatedAt).toISOString().slice(0, 10), text: buf });
    }
    return new Bm25(docs).search(query, k);
  }

  async execKnowledgeTool(conv, name, args) {
    switch (name) {
      case 'memory_save': { const m = this.memory.add(args.fact, 'agent', conv.id); this.emit('memory:update', {}); return `Saved to memory (id ${m.id}): ${m.text}`; }
      case 'memory_search': { const r = this.memory.search(String(args.query || '')); return r.length ? r.map((m) => `[${m.id}] ${m.text}`).join('\n') : 'No matching memories.'; }
      case 'memory_forget': { const ok = this.memory.remove(String(args.id || '')); this.emit('memory:update', {}); return ok ? 'Forgotten.' : 'No memory with that id.'; }
      case 'search_chats': {
        const r = this.searchChats(String(args.query || ''), conv.id);
        return r.length ? r.map((h) => `### "${h.conv}" (${h.date})\n${clip(h.text, 1500)}`).join('\n\n') : 'Nothing found in earlier chats.';
      }
      case 'knowledge_search': {
        if (!conv.projectId) return 'This chat is not in a project.';
        const r = this.projects.search(conv.projectId, String(args.query || ''), Math.min(12, Number(args.max_results) || 6));
        return r.length ? r.map((h) => `### ${h.file} (score ${h.score})\n${h.text}`).join('\n\n') : 'No relevant passages found.';
      }
      default: return null;
    }
  }

  // Background: pull lasting facts from the last exchange into memory (API engine only, if enabled).
  async autoMemory(conv, userText, reply) {
    const s = this.settings();
    if (s.autoMemory === false || !s.apiKey || !userText) return;
    // Only spend a model call when the user talks about themselves or their preferences.
    if (!/\b(i|i'm|im|my|me|mine|we|our|us|prefer|always|never|don't|dont|please|style|like|want|call me|remember|eu|meu|mea|mei|mele|sunt|am|noi|nostru|prefer|mereu|niciodata|vreau|imi place|te rog)\b/i.test(userText)) return;
    try {
      const existing = this.memory.promptBlock(3000) || '(none)';
      const res = await this.api.complete({
        model: s.model,
        messages: [
          { role: 'system', content: 'You maintain a long-term memory about the user. From the exchange, extract only NEW lasting facts the USER stated: about themselves, their projects, equipment, decisions, and their working style (how they like answers, code, naming, language, tools, level of detail). Skip anything temporary, anything already in memory, guesses, secrets (passwords, keys, card numbers) and sensitive personal data. Reply with JSON only: {"facts":["..."]} (empty list if nothing).' },
          { role: 'user', content: `Existing memory:\n${existing}\n\nUser said:\n${clip(userText, 3000)}\n\nAssistant replied:\n${clip(reply || '', 1500)}` },
        ],
      });
      const m = (res.content || '').match(/\{[\s\S]*\}/);
      if (!m) return;
      const facts = (JSON.parse(m[0]).facts || []).filter((f) => typeof f === 'string' && f.trim()).slice(0, 5);
      for (const f of facts) this.memory.add(f, 'auto', conv.id);
      if (facts.length) { this.emit('memory:update', {}); this.track({ kind: 'memory', text: `Remembered: ${facts.join(' | ')}` }); }
    } catch (e) { this.log(`auto-memory skipped: ${e.message}`); }
  }

  // After a multi-step job: if it looks like a reusable workflow, save it as a learned skill (/name).
  async autoSkill(conv, userText) {
    const s = this.settings();
    if (s.autoSkills === false || !s.apiKey) return;
    try {
      const steps = conv.messages.slice(-40).filter((m) => m.role === 'tool').map((m) => `- ${m.summary}`).join('\n');
      const existing = this.skills.list().map((k) => `/${k.name}: ${k.description}`).join('\n') || '(none)';
      const res = await this.api.complete({
        model: s.model,
        messages: [
          { role: 'system', content: 'You turn repeated work into reusable "skills" (saved instructions the user can run with /name). Decide if the task below is a workflow the user is likely to repeat (not a one-off question). If yes and no existing skill covers it, write a general, reusable skill. Reply with JSON only: {"skill": null} or {"skill": {"name":"kebab-case-name","description":"one line","body":"step-by-step instructions, generalized, in the user\'s style"}}' },
          { role: 'user', content: `Existing skills:\n${existing}\n\nUser request:\n${clip(userText, 2000)}\n\nSteps taken:\n${clip(steps, 3000)}` },
        ],
      });
      const m = (res.content || '').match(/\{[\s\S]*\}/);
      if (!m) return;
      const sk = JSON.parse(m[0]).skill;
      if (!sk || !sk.name || !sk.body) return;
      if (this.skills.read(String(sk.name).toLowerCase())) return;
      const saved = this.skills.save({ name: sk.name, description: `(learned) ${sk.description || ''}`, body: sk.body });
      this.emit('skills:update', {});
      this.addMsg(conv, { role: 'info', text: `💡 Learned a new skill: /${saved.name} — ${sk.description || ''} (edit or delete it in Skills)` });
      this.track({ kind: 'memory', text: `Learned skill /${saved.name}` });
    } catch (e) { this.log(`auto-skill skipped: ${e.message}`); }
  }

  // Expands "/skill rest of message" into the skill's instructions.
  expandSkill(text) {
    const m = text.match(/^\/([a-z0-9_-]+)\b\s*([\s\S]*)$/i);
    if (!m) return { text };
    const skill = this.skills.read(m[1].toLowerCase());
    if (!skill) return { text };
    return { text: `${skill.body}\n\n${m[2] ? 'Request: ' + m[2] : ''}`.trim(), skill: skill.name };
  }

  async engineFor(conv) {
    let e = conv.engine || this.settings().engine;
    if (e === 'auto') e = this.settings().apiKey ? 'api' : (this.muse.resolveBin() ? 'muse' : 'api');
    return e;
  }

  // ---------------------------------------------------------------- messages
  addMsg(conv, msg) {
    const m = { id: msg.id || uid(), ts: Date.now(), ...msg };
    conv.messages.push(m);
    if (conv.messages.length > 2000) conv.messages.splice(0, conv.messages.length - 2000);
    this.store.touch(conv);
    this.emit('msg:add', { convId: conv.id, msg: m });
    return m;
  }
  patchMsg(conv, m, patch) {
    Object.assign(m, patch);
    this.store.touch(conv);
    this.emit('msg:patch', { convId: conv.id, id: m.id, patch });
  }
  appendText(conv, m, field, delta) {
    m[field] = (m[field] || '') + delta;
    this.store.touch(conv);
    this.emit('msg:delta', { convId: conv.id, id: m.id, field, delta });
  }

  isRunning(convId) { return !!this.runtime.get(convId)?.running; }

  // ---------------------------------------------------------------- approvals
  // Returns { approved: boolean, choiceId?, note? }
  requestApproval(conv, { summary, detail, risk, choices, tool }) {
    const s = this.settings();
    const mode = conv.mode || s.mode;
    if (risk === 'read') return Promise.resolve({ approved: true, auto: true });
    if (mode === 'plan') return Promise.resolve({ approved: false, note: 'Plan mode is read-only.' });
    if (mode === 'auto') return Promise.resolve({ approved: true, auto: true });
    if (tool && conv.allowed && conv.allowed.includes(tool)) return Promise.resolve({ approved: true, auto: true });
    const id = uid();
    const msg = this.addMsg(conv, {
      role: 'approval', approvalId: id, summary, detail: clip(detail || '', 4000), risk, tool,
      choices: choices || [
        { id: 'allow', label: 'Allow once', approve: true },
        { id: 'allow_chat', label: 'Always allow in this chat', approve: true },
        { id: 'deny', label: 'Deny', approve: false },
      ],
      status: 'pending',
    });
    return new Promise((resolve) => {
      this.approvals.set(id, { convId: conv.id, resolve, msg });
      this.emit('approval:new', { convId: conv.id, approvalId: id, summary, detail: msg.detail, choices: msg.choices, source: conv.source });
    });
  }

  decide(approvalId, choiceId, by = 'app') {
    const a = this.approvals.get(approvalId);
    if (!a) return false;
    const conv = this.store.get(a.convId);
    const choice = a.msg.choices.find((c) => c.id === choiceId) || a.msg.choices.find((c) => (choiceId === true ? c.approve : !c.approve));
    if (!choice) return false;
    this.approvals.delete(approvalId);
    if (choice.id === 'allow_chat' && conv && a.msg.tool) conv.allowed = [...new Set([...(conv.allowed || []), a.msg.tool])];
    if (conv) this.patchMsg(conv, a.msg, { status: choice.approve ? 'approved' : 'denied', decidedBy: by, choiceLabel: choice.label });
    this.emit('approval:done', { convId: a.convId, approvalId, approved: !!choice.approve, by });
    a.resolve({ approved: !!choice.approve, choiceId: choice.id });
    return true;
  }

  pendingApprovals(convId) {
    return [...this.approvals].filter(([, a]) => !convId || a.convId === convId).map(([id, a]) => ({ approvalId: id, convId: a.convId, summary: a.msg.summary, choices: a.msg.choices }));
  }

  cancelApprovals(convId) {
    for (const [id, a] of [...this.approvals]) if (a.convId === convId) this.decide(id, a.msg.choices.find((c) => !c.approve)?.id, 'cancel');
  }

  // ---------------------------------------------------------------- turns
  async send(convId, text, { from = 'app', attachments = [] } = {}) {
    const conv = this.store.get(convId);
    if (!conv) throw new Error('Conversation not found');
    if (this.isRunning(convId)) throw new Error('Still working on the previous message. Wait, or press Stop.');
    text = String(text || '').trim();
    if (!text) throw new Error('Empty message');
    if (conv.messages.filter((m) => m.role === 'user').length === 0 && (!conv.title || conv.title === 'New chat')) {
      conv.title = text.replace(/\s+/g, ' ').slice(0, 60);
      this.emit('conv:update', { id: conv.id, title: conv.title, updatedAt: Date.now() });
    }
    this.addMsg(conv, { role: 'user', text, from, attachments: attachments.map((a) => ({ name: a.name, chars: (a.text || '').length })) });
    if (/^\/remember\s+/i.test(text)) {
      const mem = this.memory.add(text.replace(/^\/remember\s+/i, ''), 'user', conv.id);
      this.emit('memory:update', {});
      this.addMsg(conv, { role: 'assistant', text: `Got it — I'll remember: *${mem.text}*` });
      this.emit('turn:state', { convId, running: false });
      this.emit('conv:update', { id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
      return `Saved to memory: ${mem.text}`;
    }
    const exp = this.expandSkill(text);
    let modelText = exp.text;
    if (exp.skill) this.addMsg(conv, { role: 'info', text: `Using skill /${exp.skill}` });
    for (const a of attachments.slice(0, 10)) modelText += `\n\n<attached_file name="${String(a.name).replace(/"/g, '')}">\n${clip(a.text || '', 60000)}\n</attached_file>`;
    const rt = { running: true, abort: new AbortController(), toolCalls: 0 };
    this.runtime.set(convId, rt);
    conv.lastQuery = text;
    conv.turnImages = [];
    this.emit('turn:state', { convId, running: true });
    this.status(conv, 'Starting…');
    const engine = await this.engineFor(conv);
    conv.engineUsed = engine;
    const startedAt = Date.now();
    try {
      this.store.pinned.add(convId);
      if (engine === 'muse') await this.runMuse(conv, modelText, rt, text);
      else {
        const reply = await this.runApi(conv, modelText, rt);
        if (!rt.abort.signal.aborted) {
          this.autoMemory(conv, text, reply);
          if (rt.toolCalls >= 3) this.autoSkill(conv, text);
        }
      }
    } catch (e) {
      if (!rt.abort.signal.aborted) this.addMsg(conv, { role: 'error', text: e.message || String(e) });
    } finally {
      if (rt.abort.signal.aborted) this.addMsg(conv, { role: 'info', text: 'Stopped.' });
      rt.running = false;
      this.store.pinned.delete(convId);
      // keep saved history small: photos stay on disk, not inside the chat history
      for (const m of conv.llm || []) if (m._image) { m.content = '[photo shown to the model earlier]'; delete m._image; }
      this.cancelApprovals(convId);
      this.runtime.delete(convId);
      this.store.touch(conv);
      this.emit('turn:status', { convId, text: '', ts: Date.now() });
      this.emit('turn:state', { convId, running: false, ms: Date.now() - startedAt });
      this.emit('conv:update', { id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
    }
    // final assistant text (for WhatsApp replies)
    const last = [...conv.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'error');
    return last ? last.text : '';
  }

  async stop(convId) {
    const rt = this.runtime.get(convId);
    if (!rt) return false;
    rt.abort.abort();
    this.cancelApprovals(convId);
    const conv = this.store.get(convId);
    if (conv && conv.engineUsed === 'muse' && conv.museSessionId) await this.muse.interrupt(conv.museSessionId);
    this.robot.cancelPlan('chat stopped');
    return true;
  }

  // ---------------------------------------------------------------- API-key engine
  toolSpecs(conv, { sub = false } = {}) {
    const specs = [...BUILTIN, ...KNOWLEDGE_TOOLS, ...this.mcp.toolSpecs()];
    if (conv.projectId) specs.push(KNOWLEDGE_SEARCH);
    if (!sub) specs.push(DELEGATE);
    return specs;
  }

  async runApi(conv, text, rt) {
    conv.llm = conv.llm || [];
    conv.llm.push({ role: 'user', content: text });
    const final = await this.agentLoop(conv, conv.llm, rt, { sub: false });
    return final;
  }

  async agentLoop(conv, llm, rt, { sub, label }) {
    const s = this.settings();
    const model = conv.model || s.model;
    const maxSteps = Math.max(1, Math.min(200, Number(s.maxSteps) || 40));
    const specs = this.toolSpecs(conv, { sub });
    const ctx = this.promptContext(conv, { sub });
    const byName = new Map(specs.map((t) => [t.name, t]));
    let finalText = '';
    for (let step = 0; step < maxSteps; step++) {
      if (rt.abort.signal.aborted) return finalText;
      compactHistory(llm);
      const prefix = sub ? `[${label}] ` : '';
      let textMsg = null, thinkMsg = null;
      const sentChars = JSON.stringify(llm).length;
      this.track({ kind: 'cloud', convId: conv.id, text: `${prefix}Sent to Meta API (${model}): ${llm.length} messages, ~${Math.round(sentChars / 1024)} KB, ${specs.length} tools` });
      if (!sub) this.status(conv, step === 0 ? `Asking ${model}…` : `Thinking about the results (step ${step + 1})…`);
      const stripImages = () => {
        let n = 0;
        for (const m of llm) if (m._image && Array.isArray(m.content)) { m.content = '[photo omitted: this model/endpoint did not accept images]'; n++; }
        return n;
      };
      const callModel = () => this.api.complete({
        model,
        messages: [{ role: 'system', content: systemPrompt(s, conv, ctx) }, ...llm.map(({ _image, ...m }) => m)],
        tools: specs,
        signal: rt.abort.signal,
        onText: (d) => {
          if (sub) return; // sub-agent text is reported through its tool card
          if (!textMsg) { textMsg = this.addMsg(conv, { role: 'assistant', text: '', streaming: true }); this.status(conv, 'Writing the answer…'); }
          this.appendText(conv, textMsg, 'text', d);
        },
        onReasoning: (d) => {
          if (!thinkMsg) thinkMsg = this.addMsg(conv, { role: 'thinking', text: '', label: prefix || undefined });
          this.appendText(conv, thinkMsg, 'text', d);
        },
      });
      let res;
      try { res = await callModel(); }
      catch (e) {
        if (/image|vision|content type|multimodal|400/i.test(e.message) && stripImages()) { this.log(`Model refused images, retrying without: ${e.message}`); res = await callModel(); }
        else throw e;
      }
      if (textMsg) this.patchMsg(conv, textMsg, { streaming: false, text: res.content });
      const assistant = { role: 'assistant', content: res.content || '' };
      if (res.toolCalls.length) assistant.tool_calls = res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } }));
      llm.push(assistant);
      if (res.content) finalText = res.content;
      if (!res.toolCalls.length) {
        if (!res.content && !sub) this.addMsg(conv, { role: 'error', text: `The model (${model}) returned an empty answer. Try again, or pick another model at the top.` });
        return finalText;
      }

      for (const call of res.toolCalls) {
        const output = await this.runToolCall(conv, call, byName, rt, { sub, prefix });
        llm.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
      // Let the model see photos it just took (Muse Spark accepts images).
      if (rt.newImages && rt.newImages.length && s.vision !== false) {
        const parts = [{ type: 'text', text: `[${rt.newImages.length} photo(s) from the ${rt.newImages[0].source}. Describe what you see if it helps the task.]` }];
        for (const ph of rt.newImages.slice(-2)) parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${ph.buffer.toString('base64')}` } });
        llm.push({ role: 'user', content: parts, _image: true });
        rt.newImages = [];
      }
    }
    const msg = `Reached the step limit (${maxSteps}). Say "continue" to keep going.`;
    if (!sub) this.addMsg(conv, { role: 'info', text: msg });
    return finalText || msg;
  }

  async runToolCall(conv, call, byName, rt, { sub, prefix }) {
    let args;
    try { args = call.arguments ? JSON.parse(call.arguments) : {}; }
    catch { return `Error: tool arguments were not valid JSON: ${clip(call.arguments, 300)}`; }
    const spec = byName.get(call.name);
    const card = this.addMsg(conv, { role: 'tool', name: call.name, summary: prefix + describeCall(call.name, args), args, status: 'running', output: '', sub: !!sub });
    if (!spec) {
      this.patchMsg(conv, card, { status: 'error', output: 'Unknown tool' });
      return `Error: unknown tool "${call.name}". Available: ${[...byName.keys()].join(', ')}`;
    }
    const rtc = this.runtime.get(conv.id);
    if (rtc) rtc.toolCalls++;
    this.status(conv, spec.risk === 'read' || (conv.mode || this.settings().mode) === 'auto' ? `Running: ${prefix}${describeCall(call.name, args)}` : `Waiting for your approval: ${describeCall(call.name, args)}`);
    const decision = await this.requestApproval(conv, {
      summary: prefix + describeCall(call.name, args),
      detail: call.name === 'write_file' ? String(args.content || '') : call.name === 'edit_file' ? `- ${args.old_string}\n+ ${args.new_string}` : JSON.stringify(args, null, 2),
      risk: spec.risk, tool: call.name,
    });
    if (rt.abort.signal.aborted) { this.patchMsg(conv, card, { status: 'denied', output: 'Stopped' }); return 'Stopped by user.'; }
    if (!decision.approved) {
      this.patchMsg(conv, card, { status: 'denied', output: decision.note || 'Denied by user' });
      return `The user denied this action${decision.note ? ' (' + decision.note + ')' : ''}. Do not retry it; continue another way or ask the user.`;
    }
    try {
      let out;
      this.status(conv, `Running: ${prefix}${describeCall(call.name, args)}`);
      this.track({ kind: 'local', convId: conv.id, text: `${prefix}Ran locally: ${describeCall(call.name, args)}` });
      const k = await this.execKnowledgeTool(conv, call.name, args);
      if (k !== null) out = k;
      else if (call.name === 'delegate') out = await this.runDelegate(conv, args, rt, card);
      else if (spec._mcp) out = await this.mcp.call(spec._mcp.server, spec._mcp.tool, args);
      else {
        out = await execBuiltin(call.name, args, {
          workspace: conv.workspace, robot: this.robot, camera: this.camera, mapper: this.mapper, signal: rt.abort.signal,
          onPhoto: (ph) => {
            conv.turnImages = [...(conv.turnImages || []), ph.path];
            if (!ph.noVision) (rt.newImages = rt.newImages || []).push(ph);
            this.patchMsg(conv, card, { image: ph.path });
          },
        });
      }
      out = clip(out);
      this.patchMsg(conv, card, { status: 'done', output: out });
      return out;
    } catch (e) {
      const err = `Error: ${e.message || e}`;
      this.patchMsg(conv, card, { status: 'error', output: err });
      return err;
    }
  }

  async runDelegate(conv, args, rt, card) {
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).slice(0, 4);
    if (!tasks.length) throw new Error('No tasks given');
    const results = await Promise.all(tasks.map(async (t, i) => {
      const label = `${i + 1}. ${t.title || 'task'}`;
      const llm = [{ role: 'user', content: String(t.instructions || t.title) }];
      try {
        const report = await this.agentLoop(conv, llm, rt, { sub: true, label });
        return `## Sub-agent ${label}\n${report || '(no report)'}`;
      } catch (e) {
        return `## Sub-agent ${label}\nFAILED: ${e.message}`;
      }
    }));
    return results.join('\n\n');
  }

  // ---------------------------------------------------------------- Muse Code engine
  // Muse Code runs its own tools, so our memory/project/history context travels with the message.
  museContext(conv, query, firstTurn) {
    const parts = [];
    const mem = this.memory.promptBlock(3000);
    if (mem) parts.push(`<memory about the user>\n${mem}\n</memory>`);
    if (conv.projectId) {
      try {
        const meta = this.projects.meta(conv.projectId);
        if (meta.instructions) parts.push(`<project name="${meta.name}" instructions>\n${meta.instructions}\n</project>`);
        const hits = this.projects.search(conv.projectId, query, 4);
        if (hits.length) parts.push(`<project knowledge (most relevant passages)>\n${hits.map((h) => `[${h.file}]\n${h.text}`).join('\n---\n')}\n</project knowledge>`);
      } catch {}
    }
    const past = this.searchChats(query, conv.id, 2).filter((h) => h.score > 3);
    if (past.length) parts.push(`<related earlier chats>\n${past.map((h) => `"${h.conv}" (${h.date}):\n${clip(h.text, 900)}`).join('\n---\n')}\n</related earlier chats>`);
    if (this.settings().systemPrompt && firstTurn) parts.push(`<user instructions>\n${this.settings().systemPrompt}\n</user instructions>`);
    return parts.length ? `${parts.join('\n\n')}\n\n(Context above comes from the Muse Carpathron app. Use it if relevant.)\n\n` : '';
  }

  async runMuse(conv, text, rt, displayText = text) { // eslint-disable-line no-param-reassign
    const s = this.settings();
    const mode = conv.mode || s.mode;
    const convId = conv.id;
    const onApproval = async (req) => {
      conv = this.store.get(convId) || conv; // the chat may have been reloaded from disk since the session started
      const choices = (req.availableChoices || []).map((c) => ({
        id: c.choiceId, label: c.label, approve: /^approved/.test(c.decision), scope: c.scope,
      }));
      const approveOnce = choices.find((c) => c.approve && c.scope === 'once') || choices.find((c) => c.approve);
      const reject = choices.find((c) => !c.approve);
      const m = conv.mode || this.settings().mode;
      if (m === 'auto' && approveOnce) return { choiceId: approveOnce.id };
      if (m === 'plan' && reject) return { choiceId: reject.id };
      this.status(conv, `Waiting for your approval: ${subjectSummary(req)}`);
      const r = await this.requestApproval(conv, { summary: subjectSummary(req), detail: req.rawArgs, risk: 'external', choices, tool: req.toolName });
      const chosen = choices.find((c) => c.id === r.choiceId) ? r.choiceId : (r.approved ? approveOnce?.id : reject?.id);
      return { choiceId: chosen || choices[0].id };
    };
    this.status(conv, this.muse.client ? 'Opening Muse Code session…' : 'Starting Muse Code (first message takes a few seconds)…');
    const session = await this.muse.session(conv, { onApproval, model: conv.museModel || s.museModel || undefined, mode });
    this.store.touch(conv);
    if (conv._museMode !== mode) { conv._museMode = mode; await this.muse.setMode(session.sessionId, mode); }

    const firstTurn = !conv._museTurns;
    conv._museTurns = (conv._museTurns || 0) + 1;
    const full = this.museContext(conv, displayText, firstTurn) + text;
    this.track({ kind: 'cloud', convId: conv.id, text: `Sent to Muse Code (Meta account): message ~${Math.round(full.length / 1024)} KB incl. memory/project context` });
    const turn = await session.sendUserTurn({ input: [{ type: 'text', text: full }], displayText });
    this.status(conv, 'Muse is thinking…');
    const byItem = new Map(); // itemId -> display msg

    const render = (item) => {
      if (item.kind === 'userMessage') return;
      let m = byItem.get(item.itemId);
      const base = { museItem: item.itemId };
      let patch;
      switch (item.kind) {
        case 'agentMessage': patch = { role: 'assistant', text: item.text || '' }; break;
        case 'reasoning': patch = { role: 'thinking', text: (item.summary || []).join('\n') || item.text || '' }; break;
        case 'toolCall': {
          let args = item.args;
          try { args = JSON.parse(item.args); } catch {}
          patch = {
            role: 'tool', name: item.tool || 'tool', args,
            summary: item.displayLabel?.text || item.displayLabel || `${item.tool || 'tool'} ${typeof item.args === 'string' ? item.args.slice(0, 160) : ''}`,
            output: item.visibleOutput || '',
            status: { inProgress: 'running', completed: 'done', failed: 'error', rejected: 'denied', cancelled: 'denied', timedOut: 'error' }[item.status] || 'running',
          };
          if (typeof patch.summary !== 'string') patch.summary = JSON.stringify(patch.summary);
          break;
        }
        case 'subagent': patch = { role: 'tool', name: 'sub-agent', summary: `Sub-agent: ${item.objective || item.label || item.agentPath || ''}`, output: item.finalSummary || item.statusLine || '', status: item.status === 'inProgress' ? 'running' : item.status === 'completed' ? 'done' : 'error' }; break;
        case 'userShell': patch = { role: 'tool', name: 'shell', summary: `Shell: ${item.commandText || ''}`, output: item.visibleOutput || '', status: item.status === 'inProgress' ? 'running' : 'done' }; break;
        default: {
          const t = item.text || item.message || item.statusLine || item.label || item.reason || '';
          if (!t) return;
          patch = { role: 'info', text: `${item.kind}: ${t}` };
        }
      }
      if (!m) {
        m = this.addMsg(conv, { ...base, ...patch }); byItem.set(item.itemId, m);
        if (patch.role === 'tool') { this.track({ kind: 'local', convId: conv.id, text: `Muse Code ran: ${patch.summary}` }); this.status(conv, `Running: ${patch.summary}`); }
        else if (patch.role === 'assistant') this.status(conv, 'Writing the answer…');
        else if (patch.role === 'thinking') this.status(conv, 'Muse is thinking…');
      }
      else this.patchMsg(conv, m, patch);
    };

    const consumeItems = (async () => { for await (const item of turn.items()) render(item); })();
    const consumeDeltas = (async () => {
      for await (const d of turn.deltas()) {
        const m = byItem.get(d.itemId);
        if (!m) continue;
        const field = !d.field || d.field === 'text' || d.field.startsWith('summary') ? 'text' : d.field === 'output' ? 'output' : null;
        if (field) this.appendText(conv, m, field, d.delta);
      }
    })();
    const onAbort = () => { this.muse.interrupt(session.sessionId); };
    rt.abort.signal.addEventListener('abort', onAbort, { once: true });
    const outcome = await turn.completed;
    rt.abort.signal.removeEventListener('abort', onAbort);
    await Promise.race([Promise.allSettled([consumeItems, consumeDeltas]), new Promise((r) => setTimeout(r, 1500))]);
    if (outcome.kind === 'completed') {
      const p = outcome.params || {};
      if (p.terminal && p.terminal !== 'completed' && p.terminal !== 'cancelled') {
        const err = p.error || {};
        let msg = err.message || p.reason || `Turn ${p.terminal}`;
        if (err.kind === 'authRequired') msg = 'Muse Code needs you to sign in with your Meta account. Open Settings → "Sign in with Meta".';
        this.addMsg(conv, { role: 'error', text: msg });
      }
    } else if (outcome.kind === 'terminalUnknown') {
      this.addMsg(conv, { role: 'error', text: 'Muse Code stopped unexpectedly. Send your message again.' });
    }
  }
}

module.exports = { Agent, systemPrompt };
