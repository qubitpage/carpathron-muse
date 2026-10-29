// Conversation runtime: runs turns on the chosen engine, streams events to every client,
// handles approvals (UI buttons, WhatsApp replies, or automatic by mode) and sub-agent orchestration.
'use strict';
const crypto = require('crypto');
const os = require('os');
const { BUILTIN, DELEGATE, execBuiltin, describeCall, clip } = require('./tools');
const { ApiEngine, compactHistory } = require('./engines/api');
const { MuseEngine, subjectSummary } = require('./engines/muse');
const { XTOOLS, execX } = require('./xtools');
const { GH_TOOLS, execGitHub } = require('./github');
const { COMPUTER_TOOLS, COMPUTER_NAMES, execComputer, hideBanner } = require('./computer');
const { DEV_TOOLS, DEV_NAMES, execDev } = require('./devtools');
const GHNAMES = new Set(GH_TOOLS.map((t) => t.name));
const models = require('./models');
const XNAMES = new Set(XTOOLS.map((t) => t.name));

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
  ctx.remote = ctx.remote || null;
  const lines = [
    sub
      ? 'You are a sub-agent of Muse Carpathron. Complete only the task you were given, using tools as needed, then reply with a concise final report of what you did and found.'
      : 'You are Muse Carpathron, an agentic assistant running on the user\'s computer, powered by Meta Muse models. You work like a local bridge: you see the user\'s files through tools, decide what to do, and your tool calls are executed on the user\'s PC.',
    `Operating system: ${os.type()} ${os.release()} (${process.platform}). Shell for run_command: ${process.platform === 'win32' ? 'Windows PowerShell' : 'bash'}.`,
    ctx.remote
      ? `WORKING ON REMOTE SERVER "${ctx.remote.name}" (${ctx.remote.username}@${ctx.remote.host}, ${ctx.remote.os || 'linux'}) over SSH. list_dir, read_file, write_file, edit_file, search and run_command run ON THAT SERVER, in ${ctx.remote.path} (relative paths are there). Use ssh_upload / ssh_download to move files between this PC (${conv.workspace}) and the server. Be careful with destructive commands on servers (rm -rf, firewall, reboots): say what you will do first.`
      : `Attached folder (workspace): ${conv.workspace}. Relative paths are inside it.`,
    `Today: ${new Date().toISOString().slice(0, 10)}.`,
    'Work step by step: inspect before you change things, prefer small precise edits (edit_file) over rewriting whole files, and verify your work (run it, read it back).',
    'Tool calls may need the user\'s approval; if one is denied, do not retry the same action — adapt or ask.',
    'Capabilities: full shell access (run_command, background jobs with job_start), remote servers over SSH (ssh_servers, ssh_exec, interactive ssh_shell, ssh_upload/ssh_download), documents (read_document for PDF/Word/Excel/PowerPoint, create_pdf with designed HTML+CSS, view_image), web (web_search, web_fetch, deep_research for cited reports), design (build HTML/CSS sites and PDFs, then check them visually with screenshot_page at desktop 1366 px and phone 390 px and fix what looks wrong; generate_image for illustrations/logos), firmware (arduino_setup, arduino_boards, arduino_compile, arduino_upload, serial_monitor, arduino_cli, open_arduino_ide — ESP32 FQBN esp32:esp32:esp32, ESP32-CAM esp32:esp32:esp32cam), vision (segment_image with SAM 3.1), speech (transcribe_audio). For multi-step engineering work: plan, do it step by step, build/run/test after each change, read errors and fix them until it works.',
    'Hardware beyond Arduino: dev_environment (what is installed and connected: IDEs, SDKs, NVIDIA GPU/CUDA, boards on USB and on the network), dev_install, open_ide (Arduino, VS Code, Thonny, Raspberry Pi Imager, Nsight, SDK Manager), micropython (Pico/ESP32 MicroPython over USB with mpremote), pico_flash (.uf2 to a Pico in BOOTSEL), sd_card_image (Raspberry Pi SD cards — erases the drive, confirm first). Raspberry Pi and Jetson boards are worked on over SSH like servers. Security: security_check for servers and websites. Other models: ask_model gets a second opinion from another Muse model (e.g. muse-wonder-1.0 for hard reasoning or reviews).',
    'Computer use: computer_view (screenshot / list_windows) and computer_act (click, type, key, scroll, drag, focus_window, open_app) control this Windows PC like a person — use them for desktop apps without an API (IDEs, installers, settings dialogs) and to test the apps you build; browser_view / browser_act drive the visible Muse Browser (open, elements, click by index, type, key, text) for websites and web apps. Always take a screenshot first, act, then check the new screenshot. Prefer direct tools (files, commands, APIs) when they can do the job — they are faster and more exact. Never type passwords, card or bank details, never solve CAPTCHAs, and ask before sending, deleting, buying or confirming anything irreversible.',
    'GitHub (when connected in Plugins): github_account, github_repos, github_create_repo, github_publish (commit + push a folder, creates the repo), github_clone, github_release (create a release and upload installers/APKs), github_issues, github_pulls, github_api. Never force-push unless the user asks.',
    'You can drive the Baby Carpathron robot car with robot_drive / robot_stop. Its camera is fixed to the car like a robot head: to look left/right/behind use robot_look (the car turns its body, photographs, turns back); robot_turn turns by degrees; robot_scan_room makes a room map. Voice notes from WhatsApp arrive as transcribed text.',
    'Answer in the user\'s language. Use Markdown. Be concise when reporting.',
    '## Honesty (no hallucinations)\n- Never invent facts, file contents, command output, prices, versions, URLs, API behaviour or test results. If you did not see it in a tool result or the conversation, you do not know it: check with a tool (read_file, run_command, web_search, web_fetch) or say plainly that you are not sure.\n- Do not claim something works, was created, deployed or fixed unless a tool result in this conversation proves it. Say what you verified and what you assume.\n- For current facts (prices, versions, news, people, rules) search the web and cite the sources. If sources disagree, say so.\n- If a request is ambiguous or impossible, say so instead of guessing.',
    '## How to work\n- For any job with more than one step keep the task list up to date with task_update (pass the full list each time: pending / in_progress / done / blocked). Mark a task done only after checking it.\n- New messages can arrive while you work. Unless a message explicitly says to stop or cancel, keep every earlier task, add the new request to the task list and finish ALL tasks before your final answer.\n- Test before delivery: build it, run the tests, start the app and check it (screenshot_page, browser, computer); fix what fails and test again. Never hand over untested work as done.\n- If you get stuck (the same error twice), do not repeat the same call: read the error carefully, check logs and docs, web_search the exact error message, try another approach or tool. Mark a task blocked only when you truly need the user, and say exactly what is needed.\n- Work clean and professionally: keep files in the project folder in a sensible structure, put temporary files in the scratch folder and delete them when done, remove debug leftovers, never hard-code secrets (use .env + .gitignore), and leave servers tidy (no stray files in web roots).\n- Security: after setting up or changing anything reachable from the internet (servers, websites, APIs, domains) run security_check on it and fix what it reports.',
  ];
  if (!sub) {
    lines.push('For big jobs that split into independent parts you may use the delegate tool to run sub-agents in parallel.');
    lines.push('Memory: when the user tells you a lasting fact or preference (name, projects, how they like answers, hardware they own), save it with memory_save. Use search_chats to recall details from earlier conversations and memory_search for saved facts. Never save passwords, keys or card numbers.');
  }
  if ((conv.mode || settings.mode) === 'plan') lines.push('PLAN MODE: you may only read and research. Do not try to change files, run commands or move the robot; propose a plan instead.');
  if ((conv.mode || settings.mode) === 'full') lines.push('FULL ACCESS MODE: the user gave you full access to this PC and the saved servers — act without asking for routine steps, but still confirm before irreversible destruction of data.');
  if (ctx.modelCaps && !ctx.modelCaps.includes('vision')) lines.push('This model cannot see images: do not rely on photos or screenshots.');
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
  if (ctx.scratch && !sub) lines.push('', `Scratch folder for temporary files (deleted with this chat): ${ctx.scratch}`);
  if (ctx.tasks && ctx.tasks.length && !sub) lines.push('', '## Your task list (keep it current with task_update)', ctx.tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.title}${t.note ? ` — ${t.note}` : ''}`).join('\n'));
  if (ctx.tree) lines.push('', '## Attached folder contents (names only)', ctx.tree);
  return lines.join('\n');
}

const KNOWLEDGE_TOOLS = [
  { name: 'memory_save', risk: 'read', description: 'Save a lasting fact or preference about the user to long-term memory (shared across all chats). One short sentence per fact.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'memory_search', risk: 'read', description: 'Search long-term memory for saved facts.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'memory_forget', risk: 'read', description: 'Delete a memory by id (from memory_search) when the user asks to forget it or it is wrong.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'search_chats', risk: 'read', description: 'Search the user\'s earlier conversations (chat history) for details, decisions, code or facts discussed before.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];
const TASK_TOOL = { name: 'task_update', risk: 'read', description: 'Set the task list shown to the user for this chat. Pass the FULL list every time (it replaces the old one). Use it for every multi-step job: add tasks (also for new requests that arrive while you work), mark one in_progress while you do it, done only after checking it, blocked with a note when you need the user.', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] }, note: { type: 'string', description: 'short: result, or what is needed when blocked' } }, required: ['title', 'status'] } } }, required: ['tasks'] } };
const STEER_NOTE = '[New message from the user while you were working. Unless it explicitly says to stop or cancel, keep all your current tasks, add this request to the task list (task_update) and make sure everything is finished before your final answer.]\n';
const MUSE_RULES = [
  '- Never invent facts, file contents, command output or test results; check with tools or say you are not sure. Do not claim something works unless a tool result proves it.',
  '- Keep the task list current with the app tool task_update (mcp__carpathron__task_update): full list each time, statuses pending / in_progress / done / blocked.',
  '- Messages that arrive while you work add to the task list unless they say stop. Finish all tasks before the final answer.',
  '- Test before delivery (build, run, check visually with screenshot_page / browser / computer). When stuck, change approach, search the exact error, do not repeat failing calls.',
  '- Work clean: tidy project structure, temporary files removed, no secrets in code. Run security_check after changing anything public.',
].join('\n');
const openTasks = (conv) => (conv.tasks || []).filter((t) => t.status === 'pending' || t.status === 'in_progress');
const KNOWLEDGE_SEARCH = { name: 'knowledge_search', risk: 'read', description: 'Search this project\'s uploaded knowledge files (RAG) and return the most relevant passages with file names.', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } };

class Agent {
  constructor({ store, robot, mcp, emit, log, memory, projects, skills, camera, remote, jobs, dataDir, github }) {
    this.camera = camera;
    this.github = github;
    this.remote = remote;
    this.jobs = jobs;
    this.dataDir = dataDir;
    this.shown = new Set(); // image files the agent showed in chats (served to the UI)
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
    this.media = new models.Media({ getSettings: () => this.store.settings });
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
    const rs = conv.remote && this.remote && this.remote.find(conv.remote.serverId);
    if (rs) ctx.remote = { name: rs.name, host: rs.host, username: rs.username, os: rs.os, path: conv.remote.path || rs.defaultPath || '~' };
    else ctx.tree = folderTree(conv.workspace);
    ctx.modelCaps = models.capsFor(conv.model || this.settings().model).caps;
    ctx.tasks = conv.tasks || [];
    if (!sub && this.dataDir && conv.id) ctx.scratch = path.join(this.dataDir, 'scratch', conv.id);
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
      case 'task_update': {
        const list = (Array.isArray(args.tasks) ? args.tasks : []).slice(0, 40).map((t) => ({
          title: String(t.title || '').slice(0, 200), status: ['pending', 'in_progress', 'done', 'blocked'].includes(t.status) ? t.status : 'pending', note: t.note ? String(t.note).slice(0, 300) : '',
        })).filter((t) => t.title);
        conv.tasks = list;
        this.emit('tasks:update', { convId: conv.id, tasks: list });
        if (this.store.index[conv.id]) this.store.touch(conv);
        const c = (st) => list.filter((t) => t.status === st).length;
        return `Task list saved: ${c('done')} done, ${c('in_progress')} in progress, ${c('pending')} pending, ${c('blocked')} blocked.`;
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
  requestApproval(conv, { summary, detail, risk, choices, tool, always = false }) {
    const s = this.settings();
    const mode = conv.mode || s.mode;
    if (risk === 'read') return Promise.resolve({ approved: true, auto: true });
    if (mode === 'plan') return Promise.resolve({ approved: false, note: 'Plan mode is read-only.' });
    // "always": actions that destroy data (erasing a drive) are confirmed by the user in every mode
    if (!always && (mode === 'auto' || mode === 'full')) return Promise.resolve({ approved: true, auto: true });
    if (!always && tool && conv.allowed && conv.allowed.includes(tool)) return Promise.resolve({ approved: true, auto: true });
    if (always && !choices) choices = [{ id: 'allow', label: 'Yes, do it', approve: true }, { id: 'deny', label: 'No', approve: false }];
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
  // Builds what the model sees for a user message with attachments.
  modelInput(text, attachments = []) {
    const exp = this.expandSkill(text);
    let modelText = exp.text;
    const imageAtt = attachments.filter((a) => a.path && /^image\//.test(a.mime || ''));
    for (const a of attachments.slice(0, 10)) {
      if (imageAtt.includes(a)) { modelText += `\n\n[attached image "${a.name}", saved at ${a.path}]`; continue; }
      if (a.path && /^(audio|video)\//.test(a.mime || '')) { modelText += `\n\n[attached ${a.mime.split('/')[0]} "${a.name}", saved at ${a.path}]`; continue; }
      modelText += `\n\n<attached_file name="${String(a.name).replace(/"/g, '')}"${a.path ? ` saved_at="${a.path}"` : ''}>\n${clip(a.text || '', 60000)}\n</attached_file>`;
    }
    return { modelText, imageAtt, skill: exp.skill };
  }

  publicQueue(conv) { return (conv.queue || []).map((q) => ({ id: q.id, text: q.text, from: q.from, at: q.at, files: (q.attachments || []).map((a) => a.name) })); }

  // A message sent while the chat is working: "now" joins the current work, "queue" runs after it.
  enqueue(conv, text, attachments = [], from = 'app') {
    conv.queue = conv.queue || [];
    const q = { id: uid(), text, attachments, from, at: Date.now() };
    conv.queue.push(q);
    this.store.touch(conv);
    this.emit('queue:update', { convId: conv.id, queue: this.publicQueue(conv) });
    return q;
  }
  removeQueued(conv, id) {
    const i = (conv.queue || []).findIndex((q) => q.id === id);
    if (i < 0) return null;
    const [q] = conv.queue.splice(i, 1);
    this.store.touch(conv);
    this.emit('queue:update', { convId: conv.id, queue: this.publicQueue(conv) });
    return q;
  }
  async steer(conv, text, attachments = [], from = 'app') {
    const rt = this.runtime.get(conv.id);
    const { modelText, imageAtt } = this.modelInput(text, attachments);
    this.addMsg(conv, { role: 'user', text, from, steered: true, attachments: attachments.map((a) => ({ name: a.name, chars: (a.text || '').length })) });
    if (conv.engineUsed === 'muse' && rt && rt.museSession) {
      try {
        await rt.museSession.sendUserTurn({ input: [{ type: 'text', text: STEER_NOTE + modelText }], displayText: text, ifBusy: 'steer' });
        this.status(conv, 'Added your message to the current work…');
        return 'Added to the current work.';
      } catch (e) {
        this.log(`Muse steer failed, queued instead: ${e.message}`);
        this.enqueue(conv, text, attachments, from);
        return 'Queued: it runs when the current work finishes.';
      }
    }
    if (!rt) { this.enqueue(conv, text, attachments, from); return 'Queued.'; }
    (rt.inbox = rt.inbox || []).push({ text: STEER_NOTE + modelText, images: imageAtt });
    this.status(conv, 'Got your new message — it joins the current work at the next step…');
    return 'Added to the current work.';
  }
  // Moves messages that arrived during the turn into the model's history. True if there were any.
  drainInbox(conv, llm, rt) {
    if (!rt.inbox || !rt.inbox.length) return false;
    const model = conv.model || this.settings().model;
    for (const m of rt.inbox.splice(0)) {
      if (m.images && m.images.length && (models.has(model, 'vision') || !models.KNOWN[model])) {
        const parts = [{ type: 'text', text: m.text }];
        for (const im of m.images.slice(0, 6)) { try { parts.push({ type: 'image_url', image_url: { url: models.dataUrl(fs.readFileSync(im.path), im.mime) } }); } catch {} }
        llm.push({ role: 'user', content: parts, _image: true });
      } else llm.push({ role: 'user', content: m.text });
    }
    return true;
  }
  async runNextQueued(convId) {
    const conv = this.store.get(convId);
    if (!conv || this.isRunning(convId) || !(conv.queue || []).length) return;
    const q = conv.queue.shift();
    this.store.touch(conv);
    this.emit('queue:update', { convId, queue: this.publicQueue(conv) });
    try { await this.send(convId, q.text, { from: q.from || 'app', attachments: q.attachments || [] }); } catch (e) { this.log(`queued message failed: ${e.message}`); }
  }

  async send(convId, text, { from = 'app', attachments = [], when = 'now' } = {}) {
    const conv = this.store.get(convId);
    if (!conv) throw new Error('Conversation not found');
    text = String(text || '').trim();
    if (!text) throw new Error('Empty message');
    if (this.isRunning(convId)) {
      if (when === 'queue') { this.enqueue(conv, text, attachments, from); return 'Queued: it runs when the current work finishes.'; }
      return this.steer(conv, text, attachments, from);
    }
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
    const { modelText, imageAtt, skill } = this.modelInput(text, attachments);
    if (skill) this.addMsg(conv, { role: 'info', text: `Using skill /${skill}` });
    const rt = { running: true, abort: new AbortController(), toolCalls: 0, finished: false, inbox: [] };
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
      const kind = models.capsFor(conv.model || this.settings().model).kind;
      if (engine === 'muse') {
        await this.runMuse(conv, modelText, rt, text);
        // Muse Code: keep going while tasks it listed are unfinished (it reports them with task_update)
        for (let k = 0; k < 4 && !rt.abort.signal.aborted && openTasks(conv).length && this.settings().finishAllTasks !== false; k++) {
          const before = JSON.stringify(conv.tasks);
          const open = openTasks(conv);
          this.addMsg(conv, { role: 'info', text: `↻ ${open.length} task(s) not finished yet — continuing.` });
          await this.runMuse(conv, `[Automatic check] These tasks are not marked done yet:\n${open.map((t) => `- ${t.title}`).join('\n')}\nContinue working on them now. When a task is really finished and checked, mark it done with task_update; if it is truly blocked, mark it blocked with what you need.`, rt, '↻ Continue unfinished tasks');
          if (JSON.stringify(conv.tasks) === before) break; // no progress: stop and report
        }
      }
      else if (kind !== 'chat') await this.runMedia(conv, text, attachments, rt, kind);
      else {
        const reply = await this.runApi(conv, modelText, rt, imageAtt);
        if (!rt.abort.signal.aborted) {
          this.autoMemory(conv, text, reply);
          if (rt.toolCalls >= 3) this.autoSkill(conv, text);
        }
      }
    } catch (e) {
      if (!rt.abort.signal.aborted) this.addMsg(conv, { role: 'error', text: e.message || String(e) });
    } finally {
      this.finishTurn(conv, rt, startedAt);
    }
    // final assistant text (for WhatsApp replies)
    const last = [...conv.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'error');
    return last ? last.text : '';
  }

  // Ends a turn exactly once (normal end, or forced by Stop when an engine does not react).
  finishTurn(conv, rt, startedAt = Date.now()) {
    if (rt.finished) return;
    rt.finished = true;
    const convId = conv.id;
    {
      if (rt.abort.signal.aborted) this.addMsg(conv, { role: 'info', text: 'Stopped.' });
      rt.running = false;
      for (const m of conv.messages.slice(-60)) {
        if (m.role === 'tool' && m.status === 'running') this.patchMsg(conv, m, { status: rt.abort.signal.aborted ? 'denied' : 'error', output: (m.output || '') + (rt.abort.signal.aborted ? '\n[stopped]' : '') });
        if (m.role === 'assistant' && m.streaming) this.patchMsg(conv, m, { streaming: false });
      }
      this.store.pinned.delete(convId);
      // keep saved history small: photos stay on disk, not inside the chat history
      for (const m of conv.llm || []) if (m._image) { m.content = '[photo shown to the model earlier]'; delete m._image; }
      this.cancelApprovals(convId);
      try { hideBanner(); } catch {}
      if (this.runtime.get(convId) === rt) this.runtime.delete(convId);
      this.store.touch(conv);
      this.emit('turn:status', { convId, text: '', ts: Date.now() });
      this.emit('turn:state', { convId, running: false, ms: Date.now() - startedAt });
      this.emit('conv:update', { id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
      // messages that arrived too late for this turn, then the queue: they run next (not after Stop)
      if (!rt.abort.signal.aborted) {
        for (const m of (rt.inbox || []).splice(0)) this.enqueue(conv, m.text.replace(STEER_NOTE, ''), [], 'app');
        if ((conv.queue || []).length) setTimeout(() => this.runNextQueued(convId), 400);
      }
    }
  }

  async stop(convId) {
    const rt = this.runtime.get(convId);
    const conv = this.store.get(convId);
    this.robot.cancelPlan('chat stopped');
    if (!rt) {
      // Nothing running here: make sure every client shows the chat as idle (fixes a stuck Stop button).
      this.emit('turn:status', { convId, text: '', ts: Date.now() });
      this.emit('turn:state', { convId, running: false });
      return false;
    }
    rt.abort.abort();
    this.cancelApprovals(convId);
    if (conv && conv.engineUsed === 'muse' && conv.museSessionId) this.muse.interrupt(conv.museSessionId).catch(() => {});
    this.status(conv || { id: convId }, 'Stopping…');
    // If the engine or a tool does not react, end the turn anyway after a short grace period.
    setTimeout(() => {
      if (!rt.finished && conv) { this.log(`Stop: forcing the turn to end (${conv.engineUsed || 'api'} did not react)`); this.finishTurn(conv, rt); }
      if (conv && conv.engineUsed === 'muse' && rt.museStuck) this.muse.dropSession(conv);
    }, 2500);
    return true;
  }

  // ---------------------------------------------------------------- API-key engine
  toolSpecs(conv, { sub = false } = {}) {
    const specs = [...BUILTIN, ...XTOOLS, ...GH_TOOLS, ...COMPUTER_TOOLS, ...DEV_TOOLS, ...KNOWLEDGE_TOOLS, ...this.mcp.toolSpecs()];
    if (!sub) specs.push(TASK_TOOL);
    if (conv.projectId) specs.push(KNOWLEDGE_SEARCH);
    if (!sub) specs.push(DELEGATE);
    return specs;
  }

  async runApi(conv, text, rt, images = []) {
    conv.llm = conv.llm || [];
    const model = conv.model || this.settings().model;
    if (images.length && (models.has(model, 'vision') || !models.KNOWN[model])) {
      const parts = [{ type: 'text', text }];
      for (const im of images.slice(0, 6)) { try { parts.push({ type: 'image_url', image_url: { url: models.dataUrl(fs.readFileSync(im.path), im.mime) } }); } catch {} }
      conv.llm.push({ role: 'user', content: parts, _image: true });
    } else conv.llm.push({ role: 'user', content: text });
    const final = await this.agentLoop(conv, conv.llm, rt, { sub: false });
    return final;
  }

  async agentLoop(conv, llm, rt, { sub, label }) {
    const s = this.settings();
    const model = conv.model || s.model;
    const baseSteps = Math.max(1, Math.min(500, Number(s.maxSteps) || 100));
    let maxSteps = baseSteps;
    // Auto / Full: the step limit is only a checkpoint — keep going until the job is done
    // (stops only when a whole checkpoint made no progress, or at the hard safety limit).
    const hardLimit = Math.max(baseSteps, Math.min(5000, Number(s.maxTotalSteps) || 1000));
    const specs = this.toolSpecs(conv, { sub });
    const ctx = this.promptContext(conv, { sub });
    const byName = new Map(specs.map((t) => [t.name, t]));
    let finalText = '';
    const mode = conv.mode || s.mode;
    let okAtCheckpoint = rt.okCalls || 0;
    for (let step = 0; ; step++) {
      if (step >= maxSteps) {
        const keepGoing = (mode === 'auto' || mode === 'full') && s.finishAllTasks !== false && maxSteps < hardLimit && (rt.okCalls || 0) > okAtCheckpoint;
        if (!keepGoing) break;
        okAtCheckpoint = rt.okCalls || 0;
        maxSteps = Math.min(hardLimit, maxSteps + baseSteps);
        if (!sub) this.addMsg(conv, { role: 'info', text: `↻ ${step} steps done — still working (${mode === 'full' ? 'Full' : 'Auto'} mode keeps going until the job is finished).` });
      }
      if (rt.abort.signal.aborted) return finalText;
      if (!sub) this.drainInbox(conv, llm, rt);
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
        effort: conv.effort || s.effort || undefined,
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
        if (!sub) {
          // 1) a message arrived while it was answering: continue with it
          if (this.drainInbox(conv, llm, rt)) continue;
          // 2) unfinished tasks: keep working (stops when there is no progress)
          const open = openTasks(conv);
          if (open.length && s.finishAllTasks !== false && mode !== 'plan') {
            const sig = JSON.stringify(conv.tasks);
            rt.noProgress = sig === rt.lastTaskSig ? (rt.noProgress || 0) + 1 : 0;
            rt.lastTaskSig = sig;
            if (rt.noProgress < 2 && (rt.autoContinue = (rt.autoContinue || 0) + 1) <= 8) {
              if (textMsg) this.patchMsg(conv, textMsg, { interim: true });
              this.addMsg(conv, { role: 'info', text: `↻ ${open.length} task(s) not finished yet — continuing.` });
              llm.push({ role: 'user', content: `[Automatic check] These tasks are not marked done:\n${open.map((t) => `- [${t.status}] ${t.title}`).join('\n')}\nContinue working on them now. If one is actually finished, check it and mark it done with task_update. If one is truly blocked, mark it blocked with a note saying exactly what you need from the user.` });
              continue;
            }
          }
          // 3) self-check before delivering work that changed something
          if (rt.changedSomething && !rt.verified && s.verifyBeforeFinish !== false && mode !== 'plan') {
            rt.verified = true;
            if (textMsg) this.patchMsg(conv, textMsg, { draft: true });
            this.addMsg(conv, { role: 'info', text: '🔎 Checking the work before finishing…' });
            this.status(conv, 'Checking the work…');
            llm.push({ role: 'user', content: '[Automatic self-check before you finish] Go through your answer above claim by claim (files created or changed, commands that worked, tests that passed, things deployed, facts and numbers). Every claim must be backed by a tool result from this conversation. If something is not proven yet, check it now with tools (run the tests, open/screenshot the page, read the file, query the server). If you cannot check it, say so. Remove anything you invented. Then give the final answer — short, saying what was verified and anything still open.' });
            continue;
          }
        }
        if (!res.content && !sub) this.addMsg(conv, { role: 'error', text: `The model (${model}) returned an empty answer. Try again, or pick another model at the top.` });
        return finalText;
      }

      for (const call of res.toolCalls) {
        const output = await this.runToolCall(conv, call, byName, rt, { sub, prefix });
        llm.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
      // Let the model see photos it just took (Muse Spark accepts images).
      if (rt.newImages && rt.newImages.length && s.vision !== false && (models.has(model, 'vision') || !models.KNOWN[model])) {
        const parts = [{ type: 'text', text: `[${rt.newImages.length} image(s): ${rt.newImages.map((x) => x.source).join(', ')}. Look at them if it helps the task.]` }];
        for (const ph of rt.newImages.slice(-3)) parts.push({ type: 'image_url', image_url: { url: `data:${ph.mime || 'image/jpeg'};base64,${ph.buffer.toString('base64')}` } });
        llm.push({ role: 'user', content: parts, _image: true });
      }
      rt.newImages = [];
    }
    const msg = (mode === 'auto' || mode === 'full')
      ? (maxSteps >= hardLimit ? `Stopped at the safety limit of ${hardLimit} steps. Say "continue" to keep going.` : `Stopped after ${maxSteps} steps because the last ${baseSteps} steps made no progress (only errors). Check the last error above, then say "continue".`)
      : `Reached the step limit (${maxSteps}) — Ask and Plan modes pause here. Say "continue" to keep going, or use Auto / Full to let it run until the job is done.`;
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
      always: call.name === 'sd_card_image' && args.action === 'write',
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
      const onPhoto = (ph) => {
        conv.turnImages = [...(conv.turnImages || []), ph.path];
        this.shown.add(path.resolve(ph.path));
        if (!ph.noVision) (rt.newImages = rt.newImages || []).push(ph);
        this.patchMsg(conv, card, { image: ph.path });
      };
      const work = (async () => {
        const k = await this.execKnowledgeTool(conv, call.name, args);
        if (k !== null) return k;
        if (call.name === 'delegate') return this.runDelegate(conv, args, rt, card);
        if (spec._mcp) return this.mcp.call(spec._mcp.server, spec._mcp.tool, args);
        const ctx = this.toolCtx(conv, rt, { onPhoto, status: (t) => { if (!sub) this.status(conv, t); } });
        if (XNAMES.has(call.name)) return execX(call.name, args, ctx);
        if (COMPUTER_NAMES.has(call.name)) return execComputer(call.name, args, ctx);
        if (DEV_NAMES.has(call.name)) return execDev(call.name, args, ctx);
        if (GHNAMES.has(call.name)) return execGitHub(call.name, args, ctx);
        return execBuiltin(call.name, args, ctx);
      })();
      // Stop must win even if a tool ignores the abort signal.
      const stopped = new Promise((resolve) => {
        if (rt.abort.signal.aborted) resolve('__stopped__');
        else rt.abort.signal.addEventListener('abort', () => setTimeout(() => resolve('__stopped__'), 1200), { once: true });
      });
      out = await Promise.race([work, stopped]);
      if (out === '__stopped__') { work.catch(() => {}); this.patchMsg(conv, card, { status: 'denied', output: 'Stopped by user' }); return 'Stopped by user.'; }
      out = clip(out);
      this.patchMsg(conv, card, { status: 'done', output: out });
      if (spec.risk !== 'read') rt.changedSomething = true;
      const failed = /^Error\b|\bexit code:? ?[1-9]\d*\b|\[exit (code )?[1-9]\d*\]/i.test(out.slice(0, 400)) || /\[exit code [1-9]\d*\]\s*$/.test(out);
      if (!failed) rt.okCalls = (rt.okCalls || 0) + 1;
      return this.stuckNote(rt, call.name, args, failed, out);
    } catch (e) {
      const err = `Error: ${e.message || e}`;
      this.patchMsg(conv, card, { status: 'error', output: err });
      return this.stuckNote(rt, call.name, args, true, err);
    }
  }

  // Notices when the agent keeps failing the same way and tells it to change approach.
  stuckNote(rt, name, args, failed, out) {
    if (!failed) { rt.errStreak = 0; return out; }
    rt.errStreak = (rt.errStreak || 0) + 1;
    const key = name + ':' + crypto.createHash('sha1').update(JSON.stringify(args || {})).digest('hex').slice(0, 12);
    rt.errKeys = rt.errKeys || {};
    const same = rt.errKeys[key] = (rt.errKeys[key] || 0) + 1;
    if (same >= 2 || rt.errStreak >= 3) {
      return `${out}\n\n[Muse Carpathron: this has failed ${same >= 2 ? `${same} times with the same call` : `${rt.errStreak} times in a row`}. Do not repeat the same call. Read the error closely, check logs, config and docs, web_search the exact error message, then try a different approach or tool. If it is truly blocked, mark the task blocked with what you need from the user.]`;
    }
    return out;
  }

  // Last screenshot geometry per chat (computer use maps the model's picture coordinates to the screen).
  screenState(convId) { this.screens = this.screens || new Map(); if (!this.screens.has(convId)) this.screens.set(convId, {}); return this.screens.get(convId); }

  // Everything a tool may need: where to work (this PC or a remote server), engines, devices.
  toolCtx(conv, rt, extra = {}) {
    const s = this.settings();
    const rs = conv.remote && this.remote ? this.remote.find(conv.remote.serverId) : null;
    return {
      workspace: conv.workspace, robot: this.robot, camera: this.camera, mapper: this.mapper, signal: rt.abort.signal,
      remote: this.remote, remoteServer: rs ? rs.id : null, remotePath: rs ? (conv.remote.path || rs.defaultPath || '') : null,
      media: this.media, api: this.api, jobs: this.jobs, settings: s, dataDir: this.dataDir, model: conv.model || s.model, github: this.github,
      computerState: this.screenState(conv.id), requestStop: () => this.stop(conv.id),
      ...extra,
    };
  }

  // ---------------------------------------------------------------- non-chat models picked in the model menu
  async runMedia(conv, text, attachments, rt, kind) {
    const model = conv.model || this.settings().model;
    const signal = rt.abort.signal;
    const mediaDir = path.join(this.dataDir, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    const show = (file) => this.shown.add(path.resolve(file));
    if (kind === 'image') {
      this.status(conv, `${model} is drawing…`);
      const inputs = attachments.filter((a) => a.path && /^image\//.test(a.mime || '')).map((a) => a.path);
      const sizeM = text.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
      const r = await this.media.image({ prompt: text, inputs, size: sizeM ? `${sizeM[1]}x${sizeM[2]}` : undefined, model, signal, format: 'png' });
      const outDir = path.join(conv.workspace, 'images');
      fs.mkdirSync(outDir, { recursive: true });
      const files = r.images.map((buf, i) => { const f = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${r.images.length > 1 ? '-' + (i + 1) : ''}.${r.format === 'jpeg' ? 'jpg' : r.format}`); fs.writeFileSync(f, buf); show(f); return f; });
      for (const f of files) this.addMsg(conv, { role: 'assistant', text: `${inputs.length ? 'Edited' : 'Created'} with ${model} → \`${f}\``, image: f });
      return;
    }
    if (kind === 'segment') {
      let file = (attachments.find((a) => a.path && /^(image|video)\//.test(a.mime || '')) || {}).path;
      if (!file) { this.status(conv, 'No image attached — taking a robot photo…'); const ph = await this.camera.capture(); file = ph.path; }
      this.status(conv, `SAM 3.1 is looking for "${text}"…`);
      const out = await execX('segment_image', { path: file, prompt: text }, this.toolCtx(conv, rt, { onPhoto: (ph) => { show(ph.path); this.addMsg(conv, { role: 'assistant', text: `Segmentation overlay for "${text}"`, image: ph.path }); }, status: (t) => this.status(conv, t) }));
      this.addMsg(conv, { role: 'assistant', text: out });
      return;
    }
    if (kind === 'transcribe') {
      const a = attachments.find((x) => x.path && /^audio\//.test(x.mime || '') || /\.(wav|ogg|opus|oga)$/i.test(x.name || ''));
      if (!a) { this.addMsg(conv, { role: 'error', text: `${model} turns speech into text: attach a WAV or OGG audio file.` }); return; }
      this.status(conv, 'Transcribing…');
      const t = await this.media.transcribe(a.path);
      this.addMsg(conv, { role: 'assistant', text: t ? `**Transcript of ${a.name}:**\n\n${t}` : 'No speech found.' });
      return;
    }
    this.addMsg(conv, { role: 'error', text: `${model} is not a chat model and this app does not know how to use it yet. Pick a Muse Spark or Muse Wonder model for chat.` });
  }

  // ---------------------------------------------------------------- tools for Muse Code (MCP bridge)
  bridgeFor(conv) {
    const b = this.bridgeInfo;
    if (!b || this.settings().museBridge === false) return null;
    return {
      transport: 'stdio', command: process.execPath, args: [path.join(__dirname, 'bridge.js')], mode: 'optional',
      env: { ELECTRON_RUN_AS_NODE: '1', MC_URL: `https://127.0.0.1:${b.port}`, MC_TOKEN: b.token, MC_CONV: conv.id, MC_CA: b.ca },
    };
  }
  bridgeTools() {
    return [...BUILTIN.filter((t) => t.name.startsWith('robot_')), ...XTOOLS, ...GH_TOOLS, ...COMPUTER_TOOLS, ...DEV_TOOLS, ...KNOWLEDGE_TOOLS, TASK_TOOL]
      .map(({ name, description, parameters }) => ({ name, description, parameters }));
  }
  async bridgeCall(convId, name, args) {
    const conv = this.store.get(convId) || { id: convId, workspace: this.settings().workspace, messages: [] };
    const rt = this.runtime.get(convId) || { abort: new AbortController() };
    const images = [];
    const onPhoto = (ph) => {
      this.shown.add(path.resolve(ph.path));
      if (ph.buffer && !ph.noVision) images.push({ data: Buffer.from(ph.buffer).toString('base64'), mime: ph.mime || 'image/jpeg' });
      if (conv.messages && this.store.get(convId)) this.addMsg(conv, { role: 'info', text: `🖼 ${ph.source || 'image'}: ${ph.path}`, image: ph.path });
    };
    this.track({ kind: 'local', convId, text: `Muse Code used app tool: ${describeCall(name, args)}` });
    try {
      const k = await this.execKnowledgeTool(conv, name, args);
      let output = k;
      if (output === null) {
        const ctx = this.toolCtx(conv, rt, { onPhoto, status: (t) => this.status(conv, t) });
        output = XNAMES.has(name) ? await execX(name, args, ctx) : GHNAMES.has(name) ? await execGitHub(name, args, ctx) : COMPUTER_NAMES.has(name) ? await execComputer(name, args, ctx) : DEV_NAMES.has(name) ? await execDev(name, args, ctx) : await execBuiltin(name, args, ctx);
      }
      return { output: clip(output), images: images.slice(-3) };
    } catch (e) { return { output: `Error: ${e.message || e}`, isError: true, images }; }
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
    if (firstTurn) parts.push(`<working rules from Muse Carpathron>\n${MUSE_RULES}\n</working rules>`);
    if ((conv.tasks || []).length) parts.push(`<task list>\n${conv.tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.title}${t.note ? ` — ${t.note}` : ''}`).join('\n')}\n</task list>`);
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
    const abortWait = (graceMs) => new Promise((resolve) => {
      if (rt.abort.signal.aborted) resolve({ kind: 'aborted' });
      else rt.abort.signal.addEventListener('abort', () => setTimeout(() => resolve({ kind: 'aborted' }), graceMs), { once: true });
    });
    const sessionP = this.muse.session(conv, { onApproval, model: conv.museModel || s.museModel || undefined, mode, bridge: this.bridgeFor ? this.bridgeFor(conv) : null, extraMcp: this.mcp && this.mcp.museServers ? this.mcp.museServers(s.mcpServers) : null });
    const opened = await Promise.race([sessionP, abortWait(0)]);
    if (opened && opened.kind === 'aborted') { sessionP.catch(() => {}); return; }
    const session = opened;
    rt.museSession = session;
    this.store.touch(conv);
    if (conv._museMode !== mode) { conv._museMode = mode; await this.muse.setMode(session.sessionId, mode); }

    const firstTurn = !conv._museTurns;
    conv._museTurns = (conv._museTurns || 0) + 1;
    const full = this.museContext(conv, displayText, firstTurn) + text;
    this.track({ kind: 'cloud', convId: conv.id, text: `Sent to Muse Code (Meta account): message ~${Math.round(full.length / 1024)} KB incl. memory/project context` });
    const turnP = session.sendUserTurn({ input: [{ type: 'text', text: full }], displayText });
    const started = await Promise.race([turnP, abortWait(0)]);
    if (started && started.kind === 'aborted') { turnP.then(() => this.muse.interrupt(session.sessionId)).catch(() => {}); return; }
    const turn = started;
    let closed = false;
    this.status(conv, 'Muse is thinking…');
    const byItem = new Map(); // itemId -> display msg

    const render = (item) => {
      if (closed || item.kind === 'userMessage') return;
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
      if (patch.role === 'tool' && patch.status === 'error' && /sandbox enforcement unavailable|setup_required|sandbox setup has not run/i.test(patch.output || '') && (this.settings().museSandbox || 'auto') === 'auto' && !this.muse.noSandboxNext) {
        // The sandbox claimed to work but commands fail: use a host without it from now on.
        this.muse.noSandboxNext = true;
        rt.restartMuse = true;
        this.log('Muse Code: shell blocked by the Windows sandbox — the next message runs Muse Code without it.');
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
        if (closed) break;
        const m = byItem.get(d.itemId);
        if (!m) continue;
        const field = !d.field || d.field === 'text' || d.field.startsWith('summary') ? 'text' : d.field === 'output' ? 'output' : null;
        if (field) this.appendText(conv, m, field, d.delta);
      }
    })();
    const onAbort = () => { this.muse.interrupt(session.sessionId); };
    rt.abort.signal.addEventListener('abort', onAbort, { once: true });
    const outcome = await Promise.race([turn.completed, abortWait(2000)]);
    rt.abort.signal.removeEventListener('abort', onAbort);
    if (outcome.kind === 'aborted') {
      // Muse did not confirm the interrupt in time: stop listening and use a fresh session next time.
      closed = true; rt.museStuck = true;
      this.muse.dropSession(conv);
      return;
    }
    await Promise.race([Promise.allSettled([consumeItems, consumeDeltas]), new Promise((r) => setTimeout(r, 1500))]);
    if (rt.restartMuse) {
      this.addMsg(conv, { role: 'info', text: '🛡 Muse Code\'s Windows sandbox blocked the command. Muse Code was restarted without the sandbox (your approval mode still applies) — send the message again.' });
      conv.museSessionId = null;
      this.muse.close().catch(() => {});
    }
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
