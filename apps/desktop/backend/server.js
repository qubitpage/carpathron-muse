// Muse Carpathron backend: HTTPS + WebSocket server used by the desktop window, the Quest/phone browser and WhatsApp.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');
const { Store } = require('./store');
const { Robot } = require('./robot');
const { Mapper } = require('./mapper');
const voice = require('./voice');
const { McpManager } = require('./mcp');
const { Agent } = require('./agent');
const { WhatsApp } = require('./whatsapp');
const { Projects, Memory, Skills, extractText, Bm25 } = require('./knowledge');
const { MuseEngine, protectedFolder } = require('./engines/muse');
const { Camera } = require('./camera');
const { Secrets } = require('./secrets');
const { Remote } = require('./remote');
const { GitHub } = require('./github');
const { Jobs, findArduinoCli } = require('./xtools');
const models = require('./models');
const render = require('./render');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VENDOR = {
  '/vendor/marked.js': path.join(__dirname, '..', 'node_modules', 'marked', 'lib', 'marked.umd.js'),
  '/vendor/purify.js': path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

async function getCert(dataDir) {
  const keyF = path.join(dataDir, 'cert-key.pem'), certF = path.join(dataDir, 'cert.pem');
  if (fs.existsSync(keyF) && fs.existsSync(certF)) return { key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) };
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanIps().map((ip) => ({ type: 7, ip }))];
  const pems = await Promise.resolve(selfsigned.generate([{ name: 'commonName', value: 'muse-carpathron.local' }], { days: 825, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] }));
  fs.writeFileSync(keyF, pems.private);
  fs.writeFileSync(certF, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

// Built-in skills (saved once; the user can edit or delete them).
const BUILTIN_SKILLS = [
  { name: 'design-website', description: 'Design and build a modern website or landing page, then check it visually', body: 'Build a complete, modern, responsive website for the request.\n1. Ask yourself who it is for and what the page must achieve; pick a clear visual direction (colors, type, spacing) and write it down in 3 lines.\n2. Create index.html + styles.css (+ script.js only if needed) in a new folder. Use semantic HTML, CSS variables, a fluid layout (flex/grid), real copy (no lorem ipsum), accessible contrast, and a mobile layout.\n3. If images help, make them with generate_image (hero, illustrations, logo) and save them in the folder.\n4. Check it with screenshot_page at width 1366 and at width 390. Look at the screenshots critically: alignment, spacing, overflow, readability, hierarchy. Fix and re-check until it looks professional.\n5. If asked to publish, upload with ssh_upload to the chosen server and configure nginx/caddy there with ssh_exec.' },
  { name: 'design-pdf', description: 'Create a professionally designed PDF (report, offer, CV, flyer, invoice)', body: 'Create a professionally designed PDF.\n1. Collect the content (read the given files with read_document, research with web_search if facts are needed).\n2. Write one HTML document with embedded CSS: @page size and margins, a cover or header, clear typographic hierarchy, tables with borders, page-break rules (break-inside: avoid for tables/figures), SVG charts drawn inline when numbers matter, a footer.\n3. Save the HTML next to the PDF, call create_pdf with source = that HTML, then check it: screenshot_page on the HTML (width 1240) and read_document on the PDF (page count, text). Fix layout problems and regenerate.\n4. Report the PDF path and page count.' },
  { name: 'research', description: 'Research a topic on the web and write a cited report', body: 'Use deep_research with depth "standard" (or "deep" if the user wants thoroughness) on the request. Then read the report, check the most important claims against the sources with web_fetch, correct anything unsupported, and give the user a short answer plus the report path.' },
  { name: 'firmware', description: 'Write, build and flash ESP32/Arduino firmware, then verify on the serial monitor', body: 'Firmware workflow:\n1. arduino_setup (with the core needed, e.g. esp32:esp32) if arduino_compile is not available yet.\n2. arduino_boards to find the port and board.\n3. Write or edit the sketch in its own folder (folder name = sketch name, file <name>.ino). Keep pins, Wi-Fi credentials and constants at the top.\n4. arduino_compile; read errors (file:line) and fix until BUILD OK.\n5. arduino_upload to the port (ESP32: if it cannot connect, tell the user to hold BOOT).\n6. serial_monitor for 10 s to verify it boots and prints what is expected (IP address, sensor values). Fix and repeat if needed.' },
  { name: 'carpathron-build', description: 'The Carpathron process: robot firmware + control app + Avatar (VR) + docs, end to end', body: 'Work like the Carpathron project:\n1. Hardware: list parts and pins; write the robot firmware (ESP32, HTTP/WebSocket protocol like protocol/ROBOT-PROTOCOL.md) and flash it with the /firmware steps.\n2. Control: connect the robot in Muse Carpathron (Robot page → Find my car), test robot_status, robot_drive, robot_photo.\n3. Apps: extend the desktop control center or the Quest Avatar app; build, run, and test after every change.\n4. Server: if the user wants it online, deploy to the chosen SSH server (ssh_upload, ssh_exec, job_start for long processes).\n5. Documentation: README with setup steps and a designed PDF (/design-pdf) for partners.\nAfter each step report what works and what is next.' },
  { name: 'github-publish', description: 'Publish a folder to GitHub (create the repo if needed) and optionally make a release with files', body: 'Publish to GitHub:\n1. github_account to know the owner (or use the owner/name the user gave).\n2. Make sure a good .gitignore exists (node_modules, dist, build outputs, .env, keys, *.keystore) and that no secrets (API keys, passwords, tokens, keystores) are inside the folder — search for them first and stop if you find any.\n3. Add or update README.md if missing.\n4. github_publish with a clear commit message (private repo unless the user says public).\n5. If the user wants downloadable apps: github_release with a version tag (e.g. v1.0.0), release notes, and the installer/APK files.\n6. Report the repository and download links.' },
  { name: 'server-setup', description: 'Set up or fix a VPS / dedicated server over SSH', body: 'On the chosen server (ssh_servers to list):\n1. Inspect first: OS, disk, memory, running services (ssh_exec: uname -a; df -h; free -m; systemctl --failed; ss -tlnp).\n2. Say what you will change, then do it step by step: updates, firewall (keep SSH open!), users, nginx/caddy, certificates, docker, databases, app deployment with systemd or docker compose.\n3. Use ssh_shell for interactive programs. Verify each step (curl the site, check logs).\n4. Summarise what was changed and how to undo it.' },
];
function seedSkills(skills) {
  // Add each built-in skill once; if the user deletes one it stays deleted.
  const marker = path.join(skills.dir, '.seeded.json');
  let done = [];
  try { done = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch {}
  try {
    const have = new Set(skills.list().map((k) => k.name));
    for (const k of BUILTIN_SKILLS) if (!done.includes(k.name)) { if (!have.has(k.name)) skills.save(k); done.push(k.name); }
    fs.writeFileSync(marker, JSON.stringify(done));
  } catch {}
}

async function startServer({ dataDir, log = console.log, version = '1.0.0', portOverride } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new Store(dataDir);
  if (portOverride) store.settings.port = portOverride;
  const memory = new Memory(path.join(dataDir, 'memory.json'));
  const projects = new Projects(path.join(dataDir, 'projects'));
  const skills = new Skills(path.join(dataDir, 'skills'));
  const clients = new Set();

  let wa = null;
  const logLines = [];
  const emit = (event, data) => {
    const msg = JSON.stringify({ event, data });
    for (const c of clients) if (c.readyState === 1) c.send(msg);
    if (wa) try { wa.onEvent(event, data); } catch {}
  };
  const logFn = (text) => {
    const line = `${new Date().toISOString().slice(11, 19)} ${text}`;
    logLines.push(line); if (logLines.length > 500) logLines.shift();
    log(text);
    emit('log', { text, ts: Date.now() });
  };

  const robot = new Robot({ getIp: () => store.settings.robot.carIp, emit: (e, d) => (e === 'log' ? logFn(d) : emit(e, d)) });
  const mcp = new McpManager({ log: logFn });
  const camera = new Camera({ getSettings: () => store.settings, emit, log: logFn });
  // Camera source: a device that offered its camera (e.g. a phone on the robot) first, else the desktop window's webcam.
  camera.pickClient = () => {
    const live = [...clients].filter((c) => c.readyState === 1);
    return live.find((c) => c.offersCamera) || live.find((c) => c.isDesktop) || null;
  };
  camera.hasWindow = () => !!camera.pickClient();
  camera.carHasCamera = () => robot.status().state === 'online' && robot.status().camera;
  camera.sendRequest = (data) => { const c = camera.pickClient(); if (c) c.send(JSON.stringify({ event: 'camera:request', data })); };
  const secrets = new Secrets(dataDir);
  const remote = new Remote({ store, secrets, log: logFn, emit });
  const jobs = new Jobs(dataDir);
  const github = new GitHub({ store, secrets, log: logFn });
  seedSkills(skills);
  // terminal session -> chat (transcript saved like a conversation)
  const termConvs = new Map();
  const logTerm = (shellId, input, output) => {
    const convId = termConvs.get(shellId);
    const c = convId && store.get(convId);
    if (!c) return;
    const out = String(output || '').replace(/^\(no new output\)$/, '').trim();
    if (input !== null && input !== undefined && String(input).trim()) {
      agent.addMsg(c, { role: 'user', text: `$ ${String(input).replace(/\{ctrl-c\}/i, '^C')}`, from: 'terminal' });
    }
    if (out) agent.addMsg(c, { role: 'assistant', text: '```text\n' + out.slice(-20000) + '\n```', from: 'terminal' });
    if ((input && String(input).trim()) || out) {
      c.llm = c.llm || [];
      c.llm.push({ role: 'user', content: `[Terminal on this server — for context only]${input ? `\n$ ${input}` : ''}${out ? `\n${out.slice(-4000)}` : ''}` });
      c.llm.push({ role: 'assistant', content: 'Noted.' });
      if (c.llm.length > 400) c.llm.splice(0, c.llm.length - 400);
    }
    emit('conv:update', store.index[c.id]);
  };
  const agent = new Agent({ store, robot, mcp, emit, log: logFn, memory, projects, skills, camera, remote, jobs, dataDir, github });
  const mapper = new Mapper({ robot, camera, api: agent.api, memory, getSettings: () => store.settings, emit, log: logFn });
  agent.mapper = mapper;
  wa = new WhatsApp({ store, agent, emit, log: logFn, dataDir });
  mcp.sync(store.settings.mcpServers).then(() => emit('mcp:status', mcp.status())).catch(() => {});
  wa.applySettings().catch(() => {});

  const tls = await getCert(dataDir);
  // Pairing PIN for the Quest / phones: short code instead of typing the long secret link.
  let pair = { pin: '', at: 0 };
  const pinNow = () => {
    if (!pair.pin || Date.now() - pair.at > 10 * 60 * 1000) pair = { pin: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), at: Date.now() };
    return pair;
  };
  const pairTries = new Map(); // ip -> [timestamps]
  // Carpathron Avatar (native Quest app) link: the headset asks, you click Allow on the PC, it gets its own token.
  const avatarLinks = new Map(); // id -> { status, device, ip, at, token }
  const avatarTries = new Map();
  const avatarAuthed = (req) => {
    const t = String(req.headers['x-avatar-token'] || '');
    if (!t) return null;
    return (store.settings.avatarTokens || []).find((x) => x.token.length === t.length && crypto.timingSafeEqual(Buffer.from(x.token), Buffer.from(t))) || null;
  };
  const token = () => store.settings.accessToken;

  function authed(req, url) {
    const b = Buffer.from(token());
    const candidates = [req.headers['x-mc-token'], url.searchParams.get('t'), (String(req.headers.cookie || '').match(/(?:^|;\s*)mc_token=([^;]+)/) || [])[1]];
    return candidates.some((t) => { if (!t) return false; const a = Buffer.from(String(t)); return a.length === b.length && crypto.timingSafeEqual(a, b); });
  }
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

  const readBody = (req, limit = 40 * 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  // Attachments are kept (images for vision / Muse Image / SAM, audio for transcription, documents for tools).
  const ATT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf' };
  async function attachmentsToText(list) {
    const out = [];
    const dir = path.join(dataDir, 'attachments', new Date().toISOString().slice(0, 10));
    await fsp.mkdir(dir, { recursive: true });
    for (const a of (list || []).slice(0, 10)) {
      const safe = path.basename(String(a.name || 'file')).replace(/[<>:"/\\|?*]/g, '_');
      const file = path.join(dir, `${Date.now().toString(36)}-${safe}`);
      const mime = ATT_MIME[path.extname(safe).toLowerCase()] || '';
      try {
        await fsp.writeFile(file, Buffer.from(String(a.dataBase64 || ''), 'base64'));
        if (/^(image|audio|video)\//.test(mime)) { agent.shown.add(path.resolve(file)); out.push({ name: safe, path: file, mime, text: '' }); continue; }
        let text = '';
        try { text = await extractText(file); } catch (e) { text = `[binary file; use tools on it: ${e.message}]`; }
        out.push({ name: safe, path: file, mime, text });
      } catch (e) { out.push({ name: safe, text: `[could not read: ${e.message}]` }); }
    }
    return out;
  }

  async function engineStatus() {
    const muse = await agent.muse.status();
    return { default: store.settings.engine, muse, api: { hasKey: !!store.settings.apiKey, base: store.settings.apiBase } };
  }

  async function bootstrap() {
    return {
      version,
      settings: store.publicSettings(),
      convs: store.list(),
      projects: projects.list(),
      skills: skills.list(),
      memoryCount: memory.list().length,
      engines: await engineStatus(),
      mcp: mcp.status(),
      wa: wa.status(),
      robot: robot.status(),
      lanIps: lanIps(),
      platform: process.platform,
      servers: remote.publicList(),
      github: github.publicInfo(),
      features: { render: render.available(), arduinoCli: findArduinoCli(dataDir, store.settings.arduinoCli) || '' },
    };
  }

  // ---------------------------------------------------------------- routes
  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    let mm;
    if (p === '/api/bootstrap') return send(res, 200, await bootstrap());

    // conversations
    if (p === '/api/convs' && m === 'GET') return send(res, 200, store.list());
    if (p === '/api/convs' && m === 'POST') {
      const b = await readJson(req);
      let rem = null;
      if (b.remote && b.remote.serverId) { const sv = remote.find(b.remote.serverId); if (sv) rem = { serverId: sv.id, path: String(b.remote.path || sv.defaultPath || '').trim() }; }
      const c = store.createConversation({ projectId: b.projectId || null, engine: b.engine || undefined, workspace: b.workspace || undefined, remote: rem });
      if (b.projectId) { try { const pm = projects.meta(b.projectId); if (pm.workspace) c.workspace = pm.workspace; } catch {} }
      emit('conv:update', store.index[c.id]);
      return send(res, 200, c);
    }
    if ((mm = p.match(/^\/api\/convs\/([\w-]+)$/))) {
      const c = store.get(mm[1]);
      if (!c) return send(res, 404, { error: 'not found' });
      if (m === 'GET') {
        const { llm, ...rest } = c;
        return send(res, 200, { ...rest, running: agent.isRunning(c.id), status: agent.runtime.get(c.id)?.status || '', pending: agent.pendingApprovals(c.id) });
      }
      if (m === 'PATCH') {
        const b = await readJson(req);
        for (const k of ['title', 'model', 'museModel', 'engine', 'mode', 'projectId', 'effort']) if (k in b) c[k] = b[k] || null;
        if ('remote' in b) {
          if (!b.remote || !b.remote.serverId) c.remote = null;
          else { const sv = remote.find(b.remote.serverId); if (!sv) return send(res, 400, { error: 'Unknown server' }); c.remote = { serverId: sv.id, path: String(b.remote.path || sv.defaultPath || '').trim() }; }
          c.museSessionId = null;
        }
        if (b.workspace) {
          const ws = path.resolve(String(b.workspace));
          try { if (!fs.statSync(ws).isDirectory()) throw 0; } catch { return send(res, 400, { error: 'Folder does not exist' }); }
          if (protectedFolder(ws)) return send(res, 400, { error: 'That is a protected Windows folder (Program Files / Windows). Choose a folder in your user files, e.g. Documents.' });
          c.workspace = ws;
        }
        if ('engine' in b || 'workspace' in b) c.museSessionId = null; // new Muse session for the new setup
        if ('museModel' in b && b.museModel && c.museSessionId && c.engineUsed === 'muse') await agent.muse.setModel(c.museSessionId, b.museModel).catch((e) => logFn(`Muse model change: ${e.message}`));
        store.touch(c);
        emit('conv:update', store.index[c.id]);
        const { llm, ...rest } = c;
        return send(res, 200, rest);
      }
      if (m === 'DELETE') { await agent.stop(c.id); store.delete(c.id); emit('conv:delete', { id: c.id }); return send(res, 200, { ok: true }); }
    }
    if ((mm = p.match(/^\/api\/convs\/([\w-]+)\/send$/)) && m === 'POST') {
      const b = await readJson(req);
      if (!store.get(mm[1])) return send(res, 404, { error: 'not found' });
      if (agent.isRunning(mm[1])) return send(res, 409, { error: 'Still working on the previous message.' });
      const attachments = await attachmentsToText(b.attachments);
      agent.send(mm[1], b.text, { from: b.from || 'app', attachments }).catch((e) => logFn(`send failed: ${e.message}`));
      return send(res, 202, { ok: true });
    }
    if ((mm = p.match(/^\/api\/convs\/([\w-]+)\/stop$/)) && m === 'POST') return send(res, 200, { ok: await agent.stop(mm[1]) });
    if (p === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const hits = agent.searchChats(q, null, 20);
      const titleHits = store.list().filter((c) => (c.title || '').toLowerCase().includes(q.toLowerCase())).map((c) => ({ convId: c.id, conv: c.title, text: '' }));
      const seen = new Set(); const out = [];
      for (const h of [...titleHits, ...hits]) { if (seen.has(h.convId)) continue; seen.add(h.convId); out.push({ convId: h.convId, title: h.conv, snippet: (h.text || '').slice(0, 160) }); }
      return send(res, 200, out.slice(0, 20));
    }

    // approvals
    if ((mm = p.match(/^\/api\/approvals\/([\w-]+)$/)) && m === 'POST') {
      const b = await readJson(req);
      return send(res, 200, { ok: agent.decide(mm[1], b.choiceId, b.by || 'app') });
    }

    // models
    if (p === '/api/models') {
      const engine = url.searchParams.get('engine') || 'api';
      try {
        const list = engine === 'muse' ? await agent.muse.listModels() : models.withCaps(await agent.api.listModels());
        return send(res, 200, { models: list });
      } catch (e) { return send(res, 200, { models: [], error: e.message }); }
    }

    // settings
    if (p === '/api/settings' && m === 'GET') return send(res, 200, store.publicSettings());
    if (p === '/api/settings' && m === 'POST') {
      const b = await readJson(req);
      const patch = {};
      for (const k of ['engine', 'apiBase', 'model', 'museModel', 'museBin', 'mode', 'maxSteps', 'systemPrompt', 'autoMemory', 'autoSkills', 'effort', 'museBridge', 'museSandbox', 'museTrustWorkspace', 'musePermissionProfile', 'arduinoCli', 'webSearch', 'researchModel']) if (k in b) patch[k] = b[k];
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) patch.apiKey = b.apiKey.trim();
      if (b.clearApiKey) patch.apiKey = '';
      if (b.workspace) {
        const ws = path.resolve(String(b.workspace));
        if (protectedFolder(ws)) return send(res, 400, { error: 'That is a protected Windows folder (Program Files / Windows). Choose a folder in your user files, e.g. Documents.' });
        try { fs.mkdirSync(ws, { recursive: true }); patch.workspace = ws; } catch (e) { return send(res, 400, { error: `Workspace: ${e.message}` }); }
      }
      if (b.robot) {
        const cur = store.settings.robot || {};
        const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
        patch.robot = {
          carIp: String(b.robot.carIp ?? cur.carIp ?? '').trim(), cameraUrl: String(b.robot.cameraUrl ?? cur.cameraUrl ?? '').trim(),
          turnMs360: num(b.robot.turnMs360, cur.turnMs360 || 2400, 600, 5000), turnSpeed: num(b.robot.turnSpeed, cur.turnSpeed || 70, 40, 100),
        };
      }
      if ('vision' in b) patch.vision = !!b.vision;
      if (b.mcpServers && typeof b.mcpServers === 'object') { store.settings.mcpServers = b.mcpServers; }
      if (b.whatsapp) {
        const w = b.whatsapp;
        const cur = store.settings.whatsapp;
        if (Array.isArray(w.allowed)) cur.allowed = w.allowed.map(String).map((x) => x.trim()).filter(Boolean);
        if (w.personal) cur.personal.enabled = !!w.personal.enabled;
        if (w.cloud) {
          for (const k of ['enabled', 'phoneNumberId', 'verifyToken', 'graphVersion', 'cloudflaredPath']) if (k in w.cloud) cur.cloud[k] = w.cloud[k];
          if (w.cloud.accessToken) cur.cloud.accessToken = String(w.cloud.accessToken).trim();
          if (w.cloud.appSecret) cur.cloud.appSecret = String(w.cloud.appSecret).trim();
        }
      }
      store.updateSettings(patch);
      if (b.robot) robot.connect();
      if (b.mcpServers) mcp.sync(store.settings.mcpServers).then(() => emit('mcp:status', mcp.status()));
      if (b.whatsapp) await wa.applySettings();
      if (b.museBin !== undefined || b.museSandbox !== undefined || b.museTrustWorkspace !== undefined) { agent.muse.noSandboxNext = false; await agent.muse.close(); }
      const pub = store.publicSettings();
      emit('settings:update', pub);
      return send(res, 200, pub);
    }
    if (p === '/api/access' && isLocal(req)) {
      const pp = pinNow();
      return send(res, 200, { token: token(), urls: lanIps().map((ip) => `https://${ip}:${store.settings.port}/?t=${encodeURIComponent(token())}`), pairUrls: lanIps().map((ip) => `https://${ip}:${store.settings.port}/pair`), pin: pp.pin, pinExpiresIn: Math.round((pp.at + 600000 - Date.now()) / 1000) });
    }

    // engines
    if (p === '/api/engines') return send(res, 200, await engineStatus());
    if (p === '/api/muse/login' && m === 'POST') { try { agent.muse.openLogin(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/muse/install' && m === 'POST') { try { MuseEngine.openInstaller(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/muse/sandbox' && m === 'POST') { try { agent.muse.openSandboxSetup(); await agent.muse.close(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/muse/test' && m === 'POST') {
      try { await agent.muse.close(); await agent.muse.ensure(); const models = await agent.muse.listModels(); return send(res, 200, { ok: true, models, status: await agent.muse.status() }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message, status: await agent.muse.status() }); }
    }
    if (p === '/api/api/test' && m === 'POST') {
      try {
        const r = await agent.api.complete({ model: store.settings.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] });
        return send(res, 200, { ok: true, reply: r.content.slice(0, 200) });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }

    // Remote servers (SSH)
    if (p === '/api/servers' && m === 'GET') return send(res, 200, remote.publicList());
    if (p === '/api/servers' && m === 'POST') {
      const b = await readJson(req);
      try { const sv = remote.save(b); emit('remote:status', remote.publicList()); return send(res, 200, sv); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)$/)) && m === 'DELETE') { remote.remove(mm[1]); emit('remote:status', remote.publicList()); return send(res, 200, { ok: true }); }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/test$/)) && m === 'POST') {
      try { const r = await remote.test(mm[1]); return send(res, 200, r); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/reset-key$/)) && m === 'POST') { try { remote.save({ id: mm[1], resetFingerprint: true }); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/ls$/))) {
      try {
        const dir = await remote.resolve(mm[1], url.searchParams.get('path') || '', '');
        const list = await remote.list(mm[1], dir);
        return send(res, 200, { path: dir, dirs: list.filter((e) => e.longname[0] === 'd').map((e) => e.filename).filter((n) => !n.startsWith('.')).sort() });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/disconnect$/)) && m === 'POST') { remote.disconnect(mm[1]); emit('remote:status', remote.publicList()); return send(res, 200, { ok: true }); }

    // SSH keys
    if (p === '/api/keys' && m === 'GET') return send(res, 200, remote.keyList());
    if (p === '/api/keys/generate' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, remote.generateKey(b)); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/keys/import' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, remote.importKey(b)); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((mm = p.match(/^\/api\/keys\/([\w-]+)$/)) && m === 'DELETE') { try { remote.deleteKey(mm[1]); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((mm = p.match(/^\/api\/keys\/([\w-]+)\/export$/)) && m === 'POST') { try { return send(res, 200, { file: remote.exportKey(mm[1]) }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/install-key$/)) && m === 'POST') {
      const b = await readJson(req);
      try { const msg = await remote.installKey(mm[1], String(b.keyId || ''), { use: b.use !== false, removePassword: !!b.removePassword }); emit('remote:status', remote.publicList()); return send(res, 200, { ok: true, message: msg }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    // Remote terminal (interactive shell sessions)
    if ((mm = p.match(/^\/api\/servers\/([\w-]+)\/shell$/)) && m === 'POST') {
      // Every terminal session is also saved as a chat (listed with 🌐), so it can be continued another day —
      // by typing commands again or by asking the agent, which works on the same server.
      const b = await readJson(req);
      try {
        const sv = remote.need(mm[1]);
        let c = b.convId ? store.get(b.convId) : null;
        if (!c) {
          c = store.createConversation({ title: `Terminal — ${sv.name} ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`, source: 'terminal', remote: { serverId: sv.id, path: sv.defaultPath || '' } });
          c.mode = 'ask';
          emit('conv:update', store.index[c.id]);
        }
        const id = await remote.shellStart(sv.id);
        termConvs.set(id, c.id);
        const output = await remote.shellRead(id, { waitMs: 1500 });
        if (sv.defaultPath) await remote.shellSend(id, `cd ${sv.defaultPath.includes(' ') ? `'${sv.defaultPath}'` : sv.defaultPath}`, { waitMs: 400 }).catch(() => {});
        logTerm(id, null, output);
        return send(res, 200, { id, output, convId: c.id });
      }
      catch (e) { return send(res, 200, { error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/shells\/([\w-]+)$/))) {
      try {
        if (m === 'POST') { const b = await readJson(req); const output = await remote.shellSend(mm[1], b.input ?? '', { waitMs: Number(b.waitMs) || 1200 }); logTerm(mm[1], b.input, output); return send(res, 200, { output }); }
        if (m === 'GET') { const output = await remote.shellRead(mm[1], { waitMs: Number(url.searchParams.get('wait')) || 300 }); logTerm(mm[1], null, output); return send(res, 200, { output }); }
        if (m === 'DELETE') { termConvs.delete(mm[1]); return send(res, 200, { ok: remote.shellClose(mm[1]) }); }
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // GitHub plugin
    if (p === '/api/github' && m === 'GET') return send(res, 200, github.publicInfo());
    if (p === '/api/github/connect' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await github.connect(String(b.token || '').trim(), b)); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/github/author' && m === 'POST') { const b = await readJson(req); return send(res, 200, github.updateAuthor(b)); }
    if (p === '/api/github' && m === 'DELETE') { github.disconnect(); return send(res, 200, { ok: true }); }
    if (p === '/api/github/device' && m === 'POST') {
      const b = await readJson(req);
      const clientId = String(b.clientId || store.settings.githubClientId || '').trim();
      if (b.clientId !== undefined) store.updateSettings({ githubClientId: clientId });
      if (!clientId) return send(res, 400, { error: 'No OAuth App client ID set.' });
      try { return send(res, 200, await github.deviceStart(clientId)); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/github/device' && m === 'GET') return send(res, 200, { ...github.deviceStatus(), info: github.publicInfo() });
    if (p === '/api/github/gh' && m === 'GET') return send(res, 200, await github.ghStatus());
    if (p === '/api/github/gh/login' && m === 'POST') {
      try {
        const st = await github.ghStatus();
        const lines = [];
        if (!st.installed) lines.push("Write-Host 'Installing GitHub CLI (official, from GitHub via winget)...' -ForegroundColor Green", 'winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements', "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')");
        lines.push("Write-Host 'Your browser opens GitHub: copy the one-time code shown here, paste it there and click Authorize.' -ForegroundColor Green",
          'gh auth login --web --hostname github.com --git-protocol https --scopes "repo,workflow,read:org"',
          "Write-Host ''", "Write-Host 'Done. Go back to Muse Carpathron - it connects automatically. You can close this window.' -ForegroundColor Green");
        MuseEngine.openConsole('github-login', lines, os.homedir());
        return send(res, 200, { ok: true, installing: !st.installed });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === '/api/github/gh/import' && m === 'POST') { try { return send(res, 200, await github.ghImport()); } catch (e) { return send(res, 200, { error: e.message }); } }

    // Muse Code ↔ app tools (MCP bridge, called by backend/bridge.js)
    if (p === '/api/bridge/tools') return send(res, 200, { tools: agent.bridgeTools() });
    if (p === '/api/bridge/call' && m === 'POST') { const b = await readJson(req); return send(res, 200, await agent.bridgeCall(String(b.conv || ''), String(b.name || ''), b.args || {})); }
    if (p === '/api/muse/profiles') { try { return send(res, 200, { profiles: await agent.muse.permissionProfiles() }); } catch (e) { return send(res, 200, { profiles: [], error: e.message }); } }

    // MCP
    if (p === '/api/mcp' && m === 'GET') return send(res, 200, { servers: mcp.status(), config: store.settings.mcpServers });
    if (p === '/api/mcp/reload' && m === 'POST') { await mcp.closeAll(); await mcp.sync(store.settings.mcpServers); emit('mcp:status', mcp.status()); return send(res, 200, mcp.status()); }

    // memory
    if (p === '/api/memory' && m === 'GET') return send(res, 200, memory.list());
    if (p === '/api/memory' && m === 'POST') { const b = await readJson(req); const it = memory.add(b.text, 'user'); emit('memory:update', {}); return send(res, 200, it); }
    if (p === '/api/memory' && m === 'DELETE') { memory.clear(); emit('memory:update', {}); return send(res, 200, { ok: true }); }
    if ((mm = p.match(/^\/api\/memory\/([\w-]+)$/))) {
      if (m === 'DELETE') { memory.remove(mm[1]); emit('memory:update', {}); return send(res, 200, { ok: true }); }
      if (m === 'PATCH') { const b = await readJson(req); const it = memory.update(mm[1], b.text); emit('memory:update', {}); return send(res, 200, it || {}); }
    }

    // projects
    if (p === '/api/projects' && m === 'GET') return send(res, 200, projects.list());
    if (p === '/api/projects' && m === 'POST') { const b = await readJson(req); const pr = projects.create(b); emit('projects:update', {}); return send(res, 200, pr); }
    if ((mm = p.match(/^\/api\/projects\/([\w-]+)$/))) {
      if (m === 'GET') { try { return send(res, 200, projects.meta(mm[1])); } catch { return send(res, 404, { error: 'not found' }); } }
      if (m === 'PATCH') { const b = await readJson(req); const pr = projects.update(mm[1], b); if (b.workspace) { pr.workspace = path.resolve(String(b.workspace)); projects.saveMeta(pr); } emit('projects:update', {}); return send(res, 200, pr); }
      if (m === 'DELETE') { projects.remove(mm[1]); emit('projects:update', {}); return send(res, 200, { ok: true }); }
    }
    if ((mm = p.match(/^\/api\/projects\/([\w-]+)\/files$/)) && m === 'POST') {
      const b = await readJson(req);
      try { const pr = await projects.addFile(mm[1], b.name, Buffer.from(String(b.dataBase64 || ''), 'base64')); emit('projects:update', {}); return send(res, 200, pr); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/projects\/([\w-]+)\/files\/([\w-]+)$/)) && m === 'DELETE') { const pr = projects.removeFile(mm[1], mm[2]); emit('projects:update', {}); return send(res, 200, pr); }
    if ((mm = p.match(/^\/api\/projects\/([\w-]+)\/search$/))) return send(res, 200, projects.search(mm[1], url.searchParams.get('q') || '', 8));

    // skills
    if (p === '/api/skills' && m === 'GET') return send(res, 200, skills.list());
    if (p === '/api/skills' && m === 'POST') { const b = await readJson(req); try { const sk = skills.save(b); emit('skills:update', {}); return send(res, 200, sk); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((mm = p.match(/^\/api\/skills\/([\w-]+)$/)) && m === 'DELETE') { skills.remove(mm[1]); emit('skills:update', {}); return send(res, 200, { ok: true }); }

    // activity / logs
    if (p === '/api/activity') return send(res, 200, { activity: agent.activity.slice(-200), log: logLines.slice(-200) });

    // WhatsApp
    if (p === '/api/wa' && m === 'GET') return send(res, 200, wa.status());
    if (p === '/api/wa/personal/logout' && m === 'POST') { await wa.stopPersonal({ logout: true }); store.settings.whatsapp.personal.enabled = false; store.saveSettings(); return send(res, 200, wa.status()); }
    if (p === '/api/wa/tunnel/start' && m === 'POST') { wa.startTunnel(store.settings.port); return send(res, 200, wa.status()); }
    if (p === '/api/wa/tunnel/stop' && m === 'POST') { wa.stopTunnel(); return send(res, 200, wa.status()); }
    if (p === '/api/wa/cloud/test' && m === 'POST') {
      const b = await readJson(req);
      try { await wa.cloudSend(b.to, b.text || 'Hello from Muse Carpathron'); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }

    // robot + camera
    if (p === '/api/robot') return send(res, 200, robot.status());
    if (p === '/api/robot/stream') return robot.pipeStream(res);
    if (p === '/api/robot/find' && m === 'POST') {
      const b = await readJson(req);
      const { Robot } = require('./robot');
      const found = await Robot.find(lanIps(), { extra: Array.isArray(b.extra) ? b.extra : [] });
      if (found.length === 1 && b.autoSet !== false) { store.updateSettings({ robot: { ...store.settings.robot, carIp: found[0].mode === 'hotspot' ? found[0].host : found[0].ip } }); robot.connect(); emit('settings:update', store.publicSettings()); }
      logFn(`Find my car: ${found.length ? found.map((f) => f.ip).join(', ') : 'none found'}`);
      return send(res, 200, { found, carIp: store.settings.robot.carIp });
    }
    if (p === '/api/robot/led' && m === 'POST') { const b = await readJson(req); try { await robot.led(b.v); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (p === '/api/camera/capture' && m === 'POST') {
      try { const ph = await camera.capture(); return send(res, 200, { path: ph.path, source: ph.source }); }
      catch (e) { return send(res, 200, { error: e.message }); }
    }
    if ((mm = p.match(/^\/api\/camera\/([\w-]+)$/)) && m === 'POST') { const b = await readJson(req); return send(res, 200, { ok: camera.answer(mm[1], b) }); }
    if (p === '/api/photo') {
      const f = path.resolve(String(url.searchParams.get('path') || ''));
      const inPhotos = path.basename(path.dirname(f)) === 'photos' && /\.jpe?g$/i.test(f);
      const inMaps = path.basename(path.dirname(path.dirname(f))) === 'maps' && /\.(jpe?g|png)$/i.test(f);
      const shown = agent.shown.has(f) && /\.(jpe?g|png|webp|gif|bmp)$/i.test(f);
      if ((!inPhotos && !inMaps && !shown) || !fs.existsSync(f)) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': models.mimeOf(f).startsWith('image/') ? models.mimeOf(f) : 'image/jpeg', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    // Robot head + room maps
    if (p === '/api/robot/look' && m === 'POST') {
      const b = await readJson(req);
      try { const ph = await mapper.look(b.direction, { comeBack: b.comeBack !== false, source: 'pc' }); return send(res, 200, { ok: true, path: ph.path, degrees: ph.degrees }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/robot/turn' && m === 'POST') {
      const b = await readJson(req);
      try { mapper.needCar(); const r = await mapper.turn(b.degrees, 'pc'); return send(res, 200, { ok: true, ...r }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/api/robot/scan' && m === 'POST') {
      const b = await readJson(req);
      mapper.scan({ steps: b.steps, source: 'pc' }).catch((e) => emit('robot:scan', { text: `Scan failed: ${e.message}`, error: true }));
      return send(res, 200, { ok: true, started: true });
    }
    if (p === '/api/robot/maps' && m === 'GET') return send(res, 200, mapper.list());
    if (p === '/api/avatar/decide' && m === 'POST') {
      const b = await readJson(req);
      const l = avatarLinks.get(String(b.id || ''));
      if (!l) return send(res, 404, { error: 'Link request expired' });
      if (b.allow) {
        l.token = crypto.randomBytes(24).toString('hex'); l.status = 'allowed';
        store.updateSettings({ avatarTokens: [...(store.settings.avatarTokens || []), { token: l.token, device: l.device, at: Date.now() }].slice(-5) });
        logFn(`Carpathron Avatar linked: ${l.device}`);
      } else { l.status = 'denied'; }
      return send(res, 200, { ok: true });
    }
    const mf = p.match(/^\/api\/robot\/maps\/([\w-]+)\/([\w.-]+)$/);
    if (mf && m === 'GET') {
      const f = mapper.file(mf[1], mf[2]);
      if (!f) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'Content-Type': f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/api/wa/personal/test' && m === 'POST') { try { await wa.sendSelfTest(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }

    return send(res, 404, { error: 'unknown endpoint' });
  }

  const server = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    try {
      // WhatsApp Cloud API webhook (called by Meta, authenticated by verify token / signature)
      if (url.pathname === '/whatsapp/webhook') {
        if (req.method === 'GET') {
          const ch = wa.cloudVerify(Object.fromEntries(url.searchParams));
          if (ch === null) { res.writeHead(403); return res.end('forbidden'); }
          res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(ch);
        }
        if (req.method === 'POST') {
          const raw = await readBody(req, 2 * 1024 * 1024);
          if (!wa.cloudSignatureOk(raw, req.headers['x-hub-signature-256'])) { res.writeHead(401); return res.end(); }
          res.writeHead(200); res.end('ok');
          try { await wa.cloudReceive(JSON.parse(raw.toString('utf8'))); } catch (e) { logFn(`webhook: ${e.message}`); }
          return;
        }
      }
      // ---- Carpathron Avatar (Quest app) endpoints
      if (url.pathname === '/avatar/hello') return send(res, 200, { app: 'Muse Carpathron', version: require('../package.json').version, linked: !!avatarAuthed(req) });
      if (url.pathname === '/avatar/link' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || '';
        const now = Date.now();
        const tries = (avatarTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (tries.length >= 6) return send(res, 429, { error: 'Too many link requests. Wait 10 minutes.' });
        tries.push(now); avatarTries.set(ip, tries);
        let b = {};
        try { b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); } catch {}
        const id = crypto.randomUUID();
        const device = String(b.device || 'Quest').replace(/[^\w .-]/g, '').slice(0, 40) || 'Quest';
        avatarLinks.set(id, { status: 'pending', device, ip, at: now });
        emit('avatar:link', { id, device, ip: ip.replace(/^::ffff:/, '') });
        logFn(`Carpathron Avatar link request from ${device} (${ip.replace(/^::ffff:/, '')}) — waiting for Allow on the PC`);
        return send(res, 200, { id });
      }
      const al = url.pathname.match(/^\/avatar\/link\/([\w-]+)$/);
      if (al && req.method === 'GET') {
        const l = avatarLinks.get(al[1]);
        if (!l || Date.now() - l.at > 5 * 60 * 1000) return send(res, 404, { status: 'expired' });
        if (l.status === 'allowed') { avatarLinks.delete(al[1]); return send(res, 200, { status: 'allowed', token: l.token }); }
        return send(res, 200, { status: l.status });
      }
      if (url.pathname.startsWith('/avatar/')) {
        const who = avatarAuthed(req);
        if (!who) return send(res, 401, { error: 'Not linked. Link the headset again (both grips) and press Allow on the PC.' });
        try {
          if (url.pathname === '/avatar/ask' && req.method === 'POST') {
            const b = await readJson(req);
            const ph = await camera.capture();
            const s = store.settings;
            if (!s.apiKey) return send(res, 200, { answer: 'Add the Meta API key in Muse Carpathron (Settings) so Muse can see through the robot.' });
            const r = await agent.api.complete({ model: s.model, messages: [
              { role: 'system', content: 'You are the eyes of a small robot car (camera 10 cm above the floor). The user wears a VR headset and sees the same picture. Answer in 1-3 short sentences, practical (obstacles, distances, where to drive).' },
              { role: 'user', content: [{ type: 'text', text: String(b.question || 'What do you see?').slice(0, 500) }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${ph.buffer.toString('base64')}` } }] },
            ] });
            agent.track && agent.track({ kind: 'cloud', text: `Avatar asked Muse: ${String(b.question || '').slice(0, 60)}` });
            return send(res, 200, { answer: String(r.content || '').trim(), photo: ph.path });
          }
          if (url.pathname === '/avatar/voice' && req.method === 'POST') {
            const raw = await readBody(req, 12 * 1024 * 1024);
            const s = store.settings;
            const heard = await voice.transcribe(raw, { apiKey: s.apiKey, apiBase: s.apiBase, mime: 'audio/wav' });
            if (!heard) return send(res, 200, { heard: '', replies: ['I did not hear any words.'] });
            const cmd = voice.voiceToCommand(heard);
            const replies = [];
            await wa.handle('quest', 'avatar', cmd || heard, async (t) => { if (!/^⏳ Working on it/.test(t)) replies.push(String(t)); }, async () => {});
            return send(res, 200, { heard, command: cmd, replies });
          }
          if (url.pathname === '/avatar/look' && req.method === 'POST') {
            const b = await readJson(req);
            const ph = await mapper.look(b.direction || 'back', { source: 'quest' });
            return send(res, 200, { ok: true, path: ph.path });
          }
          if (url.pathname === '/avatar/scan' && req.method === 'POST') {
            mapper.scan({ source: 'quest' }).catch((e) => emit('robot:scan', { text: `Scan failed: ${e.message}`, error: true }));
            return send(res, 200, { ok: true });
          }
        } catch (e) { return send(res, 200, { error: e.message }); }
        return send(res, 404, { error: 'unknown' });
      }
      if (url.pathname === '/pair' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.createReadStream(path.join(PUBLIC_DIR, 'pair.html')).pipe(res);
      }
      if (url.pathname === '/pair' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || '';
        const now = Date.now();
        const tries = (pairTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (tries.length >= 8) return send(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
        tries.push(now); pairTries.set(ip, tries);
        let b = {};
        try { b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); } catch {}
        const pp = pinNow();
        const given = String(b.pin || '').replace(/\D/g, '');
        const ok = given.length === 6 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pp.pin));
        if (!ok) return send(res, 403, { error: 'Wrong PIN. Check the PIN shown in Muse Carpathron on the PC.' });
        pair = { pin: '', at: 0 }; // one use
        pairTries.delete(ip);
        logFn(`Device paired from ${ip}`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `mc_token=${token()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authed(req, url)) return send(res, 401, { error: 'Not authorized. Open the link shown in Muse Carpathron → Settings → Phone & Quest.' });
        return await api(req, res, url);
      }
      // pages: accept ?t=token once and keep it in a cookie
      if (url.searchParams.get('t') && authed(req, url)) {
        res.writeHead(302, { 'Set-Cookie': `mc_token=${token()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`, Location: url.pathname });
        return res.end();
      }
      if (VENDOR[url.pathname]) { res.writeHead(200, { 'Content-Type': MIME['.js'] }); return fs.createReadStream(VENDOR[url.pathname]).pipe(res); }
      let file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      file = path.normalize(path.join(PUBLIC_DIR, file));
      if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    } catch (e) {
      logFn(`HTTP error: ${e.message}`);
      if (!res.headersSent) send(res, 500, { error: e.message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname !== '/ws' || !authed(req, url)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    clients.add(ws);
    const who = isLocal(req) ? 'pc' : `remote ${req.socket.remoteAddress}`;
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      if (m.type === 'hello') { ws.isDesktop = !!m.desktop; ws.offersCamera = !!m.camera; if (m.camera) logFn(`Camera offered by ${who}`); return; }
      if (m.type === 'drive') robot.manualDrive(m.left, m.right, m.by || who);
      else if (m.type === 'stop') robot.stop(m.by || who);
    });
    ws.on('close', () => clients.delete(ws));
    ws.send(JSON.stringify({ event: 'hello', data: { who } }));
  });

  const port = store.settings.port;
  agent.bridgeInfo = { port, token: token(), ca: path.join(dataDir, 'cert.pem') };
  // One port, both protocols: browsers (Quest Browser!) often try http:// first. TLS connections go to the
  // HTTPS app; plain HTTP gets a redirect to https:// on the same address instead of an empty "page isn't working".
  const redirect = http.createServer((req, res) => {
    const host = String(req.headers.host || `localhost:${port}`).replace(/[^\w.:\[\]-]/g, '');
    res.writeHead(301, { Location: `https://${host}${req.url && req.url.startsWith('/') ? req.url : '/'}`, 'Content-Type': 'text/html' });
    res.end(`<a href="https://${host}${req.url}">Continue to the secure page</a>`);
  });
  const front = net.createServer((socket) => {
    socket.on('error', () => {});
    socket.setTimeout(30000, () => socket.destroy());
    socket.once('data', (buf) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? server : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
  await new Promise((resolve, reject) => { front.once('error', reject); front.listen(port, '0.0.0.0', resolve); });
  logFn(`Muse Carpathron server on https://localhost:${port}`);

  return {
    port,
    token: token(),
    store, agent, robot, mcp, wa, memory, projects, skills, camera, remote, jobs, github,
    async close() {
      for (const c of clients) try { c.close(); } catch {}
      wss.close();
      await new Promise((r) => front.close(r));
      server.close(); redirect.close();
      robot.close();
      remote.closeAll();
      jobs.stopAll();
      await mcp.closeAll();
      await agent.muse.close();
      await wa.close();
      store.close();
    },
  };
}

module.exports = { startServer, lanIps };
