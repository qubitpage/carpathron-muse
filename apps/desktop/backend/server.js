// Carpathron Robotics & Coding backend: HTTPS + WebSocket server used by the desktop window, the Quest/phone browser and WhatsApp.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { pipeline } = require('stream');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');
const { Store } = require('./store');
const { Robot } = require('./robot');
const { Mapper } = require('./mapper');
const voice = require('./voice');
const { McpManager, BUILTIN_MCP } = require('./mcp');
const { Agent } = require('./agent');
const { WhatsApp } = require('./whatsapp');
const { Projects, Memory, Skills, extractText, Bm25 } = require('./knowledge');
const { MuseEngine, protectedFolder } = require('./engines/muse');
const { Camera } = require('./camera');
const { Secrets } = require('./secrets');
const { Remote } = require('./remote');
const { GitHub } = require('./github');
const { Shield } = require('./shield');
const { Jobs, findArduinoCli } = require('./xtools');
const models = require('./models');
const render = require('./render');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VENDOR = {
  '/vendor/marked.js': path.join(__dirname, '..', 'node_modules', 'marked', 'lib', 'marked.umd.js'),
  '/vendor/purify.js': path.join(__dirname, '..', 'node_modules', 'dompurify', 'dist', 'purify.min.js'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };

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
  { name: 'carpathron-build', description: 'The Carpathron process: robot firmware + control app + Avatar (VR) + docs, end to end', body: 'Work like the Carpathron project:\n1. Hardware: list parts and pins; write the robot firmware (ESP32, HTTP/WebSocket protocol like protocol/ROBOT-PROTOCOL.md) and flash it with the /firmware steps.\n2. Control: connect the robot in Carpathron Robotics & Coding (Robot page → Find my car), test robot_status, robot_drive, robot_photo.\n3. Apps: extend the desktop control center or the Quest Avatar app; build, run, and test after every change.\n4. Server: if the user wants it online, deploy to the chosen SSH server (ssh_upload, ssh_exec, job_start for long processes).\n5. Documentation: README with setup steps and a designed PDF (/design-pdf) for partners.\nAfter each step report what works and what is next.' },
  { name: 'github-publish', description: 'Publish a folder to GitHub (create the repo if needed) and optionally make a release with files', body: 'Publish to GitHub:\n1. github_account to know the owner (or use the owner/name the user gave).\n2. Make sure a good .gitignore exists (node_modules, dist, build outputs, .env, keys, *.keystore) and that no secrets (API keys, passwords, tokens, keystores) are inside the folder — search for them first and stop if you find any.\n3. Add or update README.md if missing.\n4. github_publish with a clear commit message (private repo unless the user says public).\n5. If the user wants downloadable apps: github_release with a version tag (e.g. v1.0.0), release notes, and the installer/APK files.\n6. Report the repository and download links.' },
  { name: 'raspberry-pi', description: 'Raspberry Pi work: Pico / MicroPython over USB, or a Pi board over SSH (setup, GPIO, camera, services)', body: 'Raspberry Pi workflow:\n1. dev_environment to see what is connected (Pico on a COM port or in BOOTSEL mode, Pi boards on the network) and which tools are installed; install missing ones with dev_install (mpremote, thonny, rpi-imager).\n2. Pico / Pico W / Pico 2: flash MicroPython with pico_flash (download the right .uf2 from micropython.org first) or a compiled C/C++/Arduino .uf2; then micropython (put, run, exec, ls) to deploy and test main.py; read the output and fix until it works. Arduino-style builds: arduino_setup with core rp2040:rp2040.\n3. New Pi board: download Raspberry Pi OS (Lite for headless), sd_card_image list → confirm the drive with the user → write. Enable SSH and Wi-Fi through Imager customisation or tell the user the first-boot steps.\n4. Pi on the network: add it as a server (ssh_save_server, user from the setup), then work over SSH: apt update/upgrade, python3-venv, gpiozero / picamera2 / libcamera, I2C/SPI with raspi-config nonint, systemd service for the app, logs with journalctl.\n5. Test on the real hardware (run it, read the output, camera photo) before saying it works. Finish with security_check if the Pi is reachable from the internet.' },
  { name: 'nvidia-jetson', description: 'NVIDIA work: GPU/CUDA on this PC, or a Jetson board over SSH (JetPack, CUDA, TensorRT, cameras, AI models)', body: 'NVIDIA workflow:\n1. dev_environment: GPU and driver (nvidia-smi), CUDA Toolkit (nvcc), Nsight, Jetson on USB (recovery mode) or on the network.\n2. On this PC: install the CUDA Toolkit with dev_install cuda if needed, build and run a small CUDA/PyTorch check (torch.cuda.is_available()), profile with Nsight (open_ide nsight-systems).\n3. Jetson over SSH (add it with ssh_save_server): cat /etc/nv_tegra_release and dpkg -l nvidia-jetpack for the JetPack version; sudo nvpmodel -q / jetson_clocks for power modes; jtop (pip install jetson-stats) for load; CUDA samples / deviceQuery; TensorRT (trtexec) and DeepStream for AI pipelines; cameras with gst-launch-1.0 nvarguscamerasrc; Docker with the NVIDIA runtime (l4t containers).\n4. Flashing a Jetson needs NVIDIA SDK Manager on Ubuntu (a Linux PC or WSL2): explain the steps (recovery mode jumper/button, USB-C to the host, SDK Manager) — or flash an SD-card image for Orin Nano dev kits with sd_card_image.\n5. Always measure and test on the device before saying it works.' },
  { name: 'test-app', description: 'Test an app or website like a user: run it, click through it, find defects, fix them and test again', body: 'App testing loop:\n1. Build and start the app (run_command / job_start for servers; open the page with browser_view open, or the desktop app with computer_act open_app).\n2. Make a task list (task_update) of the main user flows and checks (start, navigation, forms, errors, mobile width 390 for websites).\n3. Go through each flow visually: screenshot, act (browser_act / computer_act), screenshot again. Note every defect: crashes, console errors, wrong text, broken layout, slow steps.\n4. Fix the defects in the code, rebuild, and test the same flow again until it passes.\n5. Run the automated tests if the project has them. Report what was tested, what was fixed, and anything still open — with evidence (screenshots, outputs).' },
  { name: 'security-audit', description: 'Check and harden a public server or website (ports, firewall, SSH, updates, TLS, headers, exposed files)', body: 'Security audit:\n1. security_check with the server and/or the domain.\n2. Explain the findings in plain words, most critical first.\n3. With the user\'s OK, fix them over SSH step by step (keep your own SSH access working: allow OpenSSH in the firewall BEFORE enabling it; test a second SSH login before disabling passwords).\n4. Run security_check again and show the before/after.' },
  { name: 'secure-publish', description: 'Publish an app safely with Carpathron Shield: scan before upload, deploy, then scan, fix and monitor the server and site', body: 'Secure publish with Carpathron Shield:\n1. shield_scan target project on the folder you will publish (purpose server for an SSH upload, github for GitHub; remote_path = the destination). Fix every critical finding in the code first: move secrets to environment variables on the server, add .env* to .gitignore, build without source maps, turn on row-level security. Never use allow_risky unless the user explicitly accepts the risk.\n2. Publish (ssh_upload / github_publish) and configure the web server.\n3. shield_scan target server, then target site with the public url (deep true when the app uses Supabase or Firebase).\n4. Explain the findings in plain words, most critical first. With the user\'s OK apply built-in fixes with shield_fix (preview first); make other changes with ssh_exec carefully.\n5. Scan again and show before/after scores, then offer shield_monitor start with the site url.' },
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
  const mcp = new McpManager({ log: logFn, dataDir });
  // First run with this version: set up the built-in MCP servers (they need nothing installed).
  if (!store.settings.mcpBuiltinsSeeded) {
    const cur = store.settings.mcpServers || {};
    const seed = { filesystem: { builtin: 'filesystem', args: [path.join(os.homedir(), 'MuseCarpathron')] }, memory: { builtin: 'memory' }, 'sequential-thinking': { builtin: 'sequential-thinking' } };
    for (const [k, v] of Object.entries(seed)) if (!cur[k]) cur[k] = v;
    store.settings.mcpServers = cur;
    store.settings.mcpBuiltinsSeeded = true;
    store.saveSettings();
  }
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
  // Chats that pointed at a merged duplicate now point at the kept server; older chats get the 🌐 badge data.
  try {
    let n = 0;
    for (const meta of store.list()) {
      const stale = meta.remote === undefined;
      const moved = meta.remote && remote.merged[meta.remote.serverId];
      if (!stale && !moved) continue;
      const c = store.get(meta.id);
      if (!c) continue;
      if (c.remote && remote.merged[c.remote.serverId]) { c.remote.serverId = remote.merged[c.remote.serverId]; n++; store._dirty.add(c.id); }
      store.index[c.id] = store._meta(c);
    }
    store._saveIndex();
    if (n) logFn(`remote: moved ${n} chat(s) to the kept server`);
  } catch (e) { logFn(`remote: chat migration failed: ${e.message}`); }
  const jobs = new Jobs(dataDir);
  const github = new GitHub({ store, secrets, log: logFn });
  seedSkills(skills);
  // terminal session -> chat (transcript saved like a conversation)
  const termConvs = new Map();
  const termLast = new Map(); // shellId -> tail of the last output (to spot password prompts)
  // A line typed right after "Password:", "[sudo] password for…", "Passphrase", "PIN", "token:" … is a secret:
  // never store it in the chat or send it to the model.
  const SECRET_PROMPT = /(pass(word|phrase|code)?|pin|secret|token|otp|verification code)[^\n]{0,60}[:?]\s*$/i;
  const logTerm = (shellId, input, output) => {
    const convId = termConvs.get(shellId);
    const c = convId && store.get(convId);
    const prev = termLast.get(shellId) || '';
    const out = String(output || '').replace(/^\(no new output\)$/, '').trim();
    if (out) termLast.set(shellId, out.slice(-400));
    if (!c) return;
    if (input !== null && input !== undefined && String(input).trim() && SECRET_PROMPT.test(prev.trimEnd().split('\n').pop() || '')) {
      input = '•••••• (typed at a password prompt — not saved)';
    }
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
  const shield = new Shield({ store, remote, log: logFn, emit, dataDir });
  agent.shield = shield;
  shield.resume();
  wa = new WhatsApp({ store, agent, emit, log: logFn, dataDir });
  mcp.sync(store.settings.mcpServers).then(() => emit('mcp:status', mcp.status())).catch(() => {});
  wa.applySettings().catch(() => {});

  const tls = await getCert(dataDir);
  // Pairing PIN for phones / browsers: shown only while Settings → Phone & Quest is open, valid 2 minutes,
  // one use, and destroyed after 10 wrong tries from anywhere. Each paired device gets its own revocable token.
  let pair = { pin: '', at: 0, fails: 0 };
  const PIN_TTL = 2 * 60 * 1000;
  const pinNow = () => {
    if (!pair.pin || Date.now() - pair.at > PIN_TTL) pair = { pin: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), at: Date.now(), fails: 0 };
    return pair;
  };
  const pinValid = () => pair.pin && Date.now() - pair.at <= PIN_TTL;
  const pairTries = new Map(); // ip -> [timestamps]
  // Carpathron Avatar (native Quest app) link: the headset asks, you click Allow on the PC, it gets its own token.
  const avatarLinks = new Map(); // id -> { status, device, ip, at, token }
  const avatarTries = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [k, l] of avatarLinks) if (now - l.at > 5 * 60 * 1000) avatarLinks.delete(k);
    for (const m of [pairTries, avatarTries]) for (const [k, v] of m) if (!v.some((t) => now - t < 10 * 60 * 1000)) m.delete(k);
  };
  const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
  const deviceFor = (t, kind) => {
    if (!t) return null;
    const h = Buffer.from(hashToken(t));
    return (store.settings.devices || []).find((d) => (!kind || d.kind === kind) && d.hash && d.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(d.hash), h)) || null;
  };
  const addDevice = (kind, name, ip) => {
    const t = crypto.randomBytes(24).toString('base64url');
    const devs = (store.settings.devices || []).filter((d) => d.kind !== kind || d.name !== name || d.ip !== ip);
    devs.push({ id: crypto.randomUUID(), kind, name: String(name).slice(0, 60), ip: String(ip || '').replace(/^::ffff:/, ''), at: Date.now(), hash: hashToken(t) });
    store.updateSettings({ devices: devs.slice(-20) });
    emit('settings:update', store.publicSettings());
    return t;
  };
  const avatarAuthed = (req) => deviceFor(String(req.headers['x-avatar-token'] || ''), 'quest');
  const token = () => store.settings.accessToken;

  function authed(req, url) {
    const b = Buffer.from(token());
    const candidates = [req.headers['x-mc-token'], url.searchParams.get('t'), (String(req.headers.cookie || '').match(/(?:^|;\s*)mc_token=([^;]+)/) || [])[1]];
    return candidates.some((t) => {
      if (!t) return false;
      const a = Buffer.from(String(t));
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
      return !!deviceFor(String(t), 'browser');
    });
  }
  // Requests relayed by the Cloudflare tunnel (WhatsApp webhook) arrive from 127.0.0.1 but come from the internet.
  const viaTunnel = (req) => !!(req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['cdn-loop']);
  const isLocal = (req) => !viaTunnel(req) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const sendFile = (res, file, type) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    pipeline(fs.createReadStream(file), res, (e) => { if (e && !res.writableEnded) { try { res.destroy(); } catch {} } });
  };

  const readBody = (req, limit = 40 * 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  // Attachments are kept (images for vision / Muse Image / SAM, audio for transcription, documents for tools).
  const ATT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.weba': 'audio/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf' };
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
        return send(res, 200, { ...rest, queue: agent.publicQueue(c), running: agent.isRunning(c.id), status: agent.runtime.get(c.id)?.status || '', pending: agent.pendingApprovals(c.id) });
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
      if (m === 'DELETE') {
        await agent.stop(c.id); store.delete(c.id); emit('conv:delete', { id: c.id });
        fs.promises.rm(path.join(dataDir, 'scratch', c.id), { recursive: true, force: true }).catch(() => {});
        return send(res, 200, { ok: true });
      }
    }
    if ((mm = p.match(/^\/api\/convs\/([\w-]+)\/send$/)) && m === 'POST') {
      const b = await readJson(req);
      if (!store.get(mm[1])) return send(res, 404, { error: 'not found' });
      const attachments = await attachmentsToText(b.attachments);
      const busy = agent.isRunning(mm[1]);
      const when = b.when === 'queue' ? 'queue' : 'now';
      const p2 = agent.send(mm[1], b.text, { from: b.from || 'app', attachments, when });
      if (busy) { const r = await p2.catch((e) => `Error: ${e.message}`); return send(res, 200, { ok: true, busy: true, when, result: r }); }
      p2.catch((e) => logFn(`send failed: ${e.message}`));
      return send(res, 202, { ok: true });
    }
    // queued messages: remove, or send one right now (joins the running work, or starts if idle)
    if ((mm = p.match(/^\/api\/convs\/([\w-]+)\/queue\/([\w-]+)$/))) {
      const c = store.get(mm[1]);
      if (!c) return send(res, 404, { error: 'not found' });
      if (m === 'DELETE') return send(res, 200, { ok: !!agent.removeQueued(c, mm[2]) });
      if (m === 'POST') {
        const q = agent.removeQueued(c, mm[2]);
        if (!q) return send(res, 404, { error: 'not in the queue any more' });
        const r = agent.send(c.id, q.text, { from: q.from || 'app', attachments: q.attachments || [], when: 'now' });
        if (agent.isRunning(c.id)) await r.catch(() => {}); else r.catch((e) => logFn(`send failed: ${e.message}`));
        return send(res, 200, { ok: true });
      }
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
      // Settings that start programs, open the PC to the network or hold credentials: only from this PC.
      if (!isLocal(req)) for (const k of ['mcpServers', 'museBin', 'apiBase', 'apiKey', 'clearApiKey', 'workspace', 'arduinoCli', 'whatsapp', 'lanAccess', 'systemPrompt', 'githubClientId', 'museSandbox', 'musePermissionProfile']) delete b[k];
      const patch = {};
      if ('lanAccess' in b) patch.lanAccess = !!b.lanAccess;
      if (b.whatsapp && b.whatsapp.cloud && b.whatsapp.cloud.enabled && !(b.whatsapp.cloud.appSecret || store.settings.whatsapp.cloud.appSecret)) {
        return send(res, 400, { error: 'WhatsApp Cloud needs the App Secret (Meta app → Settings → Basic) so the app can check that messages really come from Meta.' });
      }
      for (const k of ['engine', 'apiBase', 'model', 'museModel', 'museBin', 'mode', 'maxSteps', 'systemPrompt', 'autoMemory', 'autoSkills', 'effort', 'museBridge', 'museSandbox', 'museTrustWorkspace', 'musePermissionProfile', 'arduinoCli', 'webSearch', 'researchModel', 'finishAllTasks', 'verifyBeforeFinish', 'maxTotalSteps', 'apiWire', 'contextTokens']) if (k in b) patch[k] = b[k];
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
      if (b.mcpServers) mcp.sync(store.settings.mcpServers).then(() => emit('mcp:status', mcp.status())).catch((e) => logFn(`MCP: ${e.message}`));
      if (b.whatsapp) await wa.applySettings();
      if ('lanAccess' in patch) await listenFront().catch((e) => logFn(`Network access: ${e.message}`));
      if (b.museBin !== undefined || b.museSandbox !== undefined || b.museTrustWorkspace !== undefined) { agent.muse.noSandboxNext = false; await agent.muse.close(); }
      const pub = store.publicSettings();
      emit('settings:update', pub);
      return send(res, 200, pub);
    }
    if (p === '/api/devices' && m === 'GET') return send(res, 200, store.publicSettings().devices || []);
    const dv = p.match(/^\/api\/devices\/([\w-]+)$/);
    if (dv && m === 'DELETE') {
      store.updateSettings({ devices: (store.settings.devices || []).filter((d) => d.id !== dv[1]) });
      emit('settings:update', store.publicSettings());
      return send(res, 200, { ok: true });
    }
    if (p === '/api/access' && isLocal(req)) {
      const pp = pinNow();
      return send(res, 200, { lanAccess: !!store.settings.lanAccess, token: token(), urls: lanIps().map((ip) => `https://${ip}:${store.settings.port}/?t=${encodeURIComponent(token())}`), pairUrls: lanIps().map((ip) => `https://${ip}:${store.settings.port}/pair`), pin: pp.pin, pinExpiresIn: Math.round((pp.at + PIN_TTL - Date.now()) / 1000) });
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
    // Carpathron Shield: scans, fixes, monitoring
    if (p === '/api/shield' && m === 'GET') return send(res, 200, shield.status());
    if (p === '/api/shield/last' && m === 'GET') return send(res, 200, shield.last[url.searchParams.get('key') || ''] || null);
    if (p === '/api/shield/scan' && m === 'POST') {
      const b = await readJson(req);
      try {
        if (b.target === 'project') return send(res, 200, await shield.scanProject(String(b.path || store.settings.workspace || ''), { purpose: ['github', 'server', 'review'].includes(b.purpose) ? b.purpose : 'review', remotePath: b.remotePath || '' }));
        if (b.target === 'server') return send(res, 200, await shield.scanServer(String(b.server || '')));
        if (b.target === 'site') return send(res, 200, await shield.scanSite(String(b.url || ''), { deep: !!b.deep }));
        return send(res, 400, { error: 'target must be project, server or site' });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (p === '/api/shield/fix/preview' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await shield.preview(String(b.server || ''), String(b.fix || ''), { allowPorts: b.allowPorts })); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/shield/fix' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await shield.applyFix(String(b.server || ''), String(b.fix || ''), { allowPorts: b.allowPorts })); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/shield/undo' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await shield.undo(String(b.id || ''))); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/shield/monitor' && m === 'POST') {
      const b = await readJson(req);
      try {
        if (b.action === 'start') return send(res, 200, shield.monitorStart(String(b.server || ''), { intervalMin: b.intervalMin, urls: b.urls }));
        if (b.action === 'stop') return send(res, 200, shield.monitorStop(String(b.server || '')));
        if (b.action === 'reset') { shield.resetBaseline(String(b.server || '')); return send(res, 200, { ok: true }); }
        if (b.action === 'now') { const sv = remote.need(String(b.server || '')); await shield.tick(sv.id); return send(res, 200, shield.monitorStatus(sv.id)); }
        return send(res, 400, { error: 'action must be start, stop, reset or now' });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (p === '/api/shield/events' && m === 'DELETE') { shield.events = []; shield.writeJson('events.json', []); return send(res, 200, { ok: true }); }
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
    if (p === '/api/github/gh/start' && m === 'POST') return send(res, 200, github.ghLoginStart());
    if (p === '/api/github/gh/start' && m === 'GET') return send(res, 200, github.ghLoginStatus());
    if (p === '/api/github/gh/start' && m === 'DELETE') return send(res, 200, github.ghLoginCancel());
    if (p === '/api/github/gh/login' && m === 'POST') {
      try {
        const st = await github.ghStatus();
        const lines = [];
        if (!st.installed) lines.push("Write-Host 'Installing GitHub CLI (official, from GitHub via winget)...' -ForegroundColor Green", 'winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements', "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')");
        lines.push("Write-Host 'Your browser opens GitHub: copy the one-time code shown here, paste it there and click Authorize.' -ForegroundColor Green",
          'gh auth login --web --hostname github.com --git-protocol https --scopes "repo,workflow,read:org"',
          "Write-Host ''", "Write-Host 'Done. Go back to Carpathron Robotics & Coding - it connects automatically. You can close this window.' -ForegroundColor Green");
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
    if (p === '/api/mcp/builtins') return send(res, 200, Object.entries(BUILTIN_MCP).map(([id, b]) => ({ id, about: b.about })));
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
      try { await wa.cloudSend(b.to, b.text || 'Hello from Carpathron Robotics & Coding'); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
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
      return sendFile(res, f, models.mimeOf(f).startsWith('image/') ? models.mimeOf(f) : 'image/jpeg');
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
        l.token = addDevice('quest', l.device, l.ip); l.status = 'allowed';
        logFn(`Carpathron Avatar linked: ${l.device}`);
      } else { l.status = 'denied'; }
      return send(res, 200, { ok: true });
    }
    const mf = p.match(/^\/api\/robot\/maps\/([\w-]+)\/([\w.-]+)$/);
    if (mf && m === 'GET') {
      const f = mapper.file(mf[1], mf[2]);
      if (!f) return send(res, 404, { error: 'not found' });
      return sendFile(res, f, f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg');
    }
    if (p === '/api/wa/personal/test' && m === 'POST') { try { await wa.sendSelfTest(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }

    return send(res, 404, { error: 'unknown endpoint' });
  }

  const server = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    try {
      prune();
      // Through the tunnel only the WhatsApp webhook is reachable; everything else is for this PC / the LAN.
      if (viaTunnel(req) && url.pathname !== '/whatsapp/webhook') { res.writeHead(403); return res.end('forbidden'); }
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
      if (url.pathname === '/avatar/hello') return send(res, 200, { app: 'Muse Carpathron', name: 'Carpathron Robotics & Coding', /* 'app' is checked by the Quest app 1.1.x: keep */ version: require('../package.json').version, linked: !!avatarAuthed(req) });
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
            if (!s.apiKey) return send(res, 200, { answer: 'Add the Meta API key in Carpathron Robotics & Coding (Settings) so Muse can see through the robot.' });
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
        return sendFile(res, path.join(PUBLIC_DIR, 'pair.html'), 'text/html; charset=utf-8');
      }
      if (url.pathname === '/pair' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || '';
        const now = Date.now();
        const tries = (pairTries.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (tries.length >= 8) return send(res, 429, { error: 'Too many tries. Wait 10 minutes.' });
        tries.push(now); pairTries.set(ip, tries);
        let b = {};
        try { b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}'); } catch {}
        if (!pinValid()) return send(res, 403, { error: 'No PIN is active. On the PC open Settings → Phone & Quest to show a new PIN (valid 2 minutes).' });
        const given = String(b.pin || '').replace(/\D/g, '');
        const ok = given.length === 6 && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pair.pin));
        if (!ok) {
          if (++pair.fails >= 10) { pair = { pin: '', at: 0, fails: 0 }; logFn('Pairing PIN cancelled after 10 wrong tries'); }
          return send(res, 403, { error: 'Wrong PIN. Check the PIN shown in Carpathron Robotics & Coding on the PC.' });
        }
        pair = { pin: '', at: 0, fails: 0 }; // one use
        pairTries.delete(ip);
        const ua = String(req.headers['user-agent'] || '');
        const name = /Quest|OculusBrowser/i.test(ua) ? 'Quest browser' : /iPhone|iPad/i.test(ua) ? 'iPhone / iPad' : /Android/i.test(ua) ? 'Android phone' : 'Browser';
        const devTok = addDevice('browser', name, ip);
        logFn(`Device paired from ${ip} (${name})`);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `mc_token=${devTok}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authed(req, url)) return send(res, 401, { error: 'Not authorized. Open the link shown in Carpathron Robotics & Coding → Settings → Phone & Quest.' });
        return await api(req, res, url);
      }
      // pages: accept ?t=token once and keep it in a cookie
      if (url.searchParams.get('t') && authed(req, url)) {
        res.writeHead(302, { 'Set-Cookie': `mc_token=${token()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`, Location: url.pathname });
        return res.end();
      }
      if (VENDOR[url.pathname]) return sendFile(res, VENDOR[url.pathname], MIME['.js']);
      let file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      file = path.normalize(path.join(PUBLIC_DIR, file));
      if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
        // The app page shows model output: no remote images/scripts/connections (stops data leaking through injected links).
        if (path.basename(file) === 'index.html') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
        res.writeHead(200, headers);
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
  const openSockets = new Set();
  const loopback = (a) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(a);
  const front = net.createServer((socket) => {
    socket.on('error', () => {});
    if (!store.settings.lanAccess && !loopback(socket.remoteAddress)) return socket.destroy();
    openSockets.add(socket); socket.on('close', () => openSockets.delete(socket));
    socket.setTimeout(30000, () => socket.destroy());
    socket.once('data', (buf) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? server : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
  // Only this PC can connect unless "Allow phones and Quest on this network" is on.
  let frontHost = '';
  async function listenFront() {
    const want = store.settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
    if (want === frontHost) return;
    if (frontHost) front.close(); // stops listening now; the app window's own connection stays
    if (want === '127.0.0.1') for (const sk of openSockets) if (!loopback(sk.remoteAddress)) sk.destroy(); // network access off: drop LAN devices now
    await new Promise((resolve, reject) => { front.once('error', reject); front.listen(port, want, () => { front.off('error', reject); resolve(); }); });
    frontHost = want;
    logFn(`Listening on ${want}:${port} (${store.settings.lanAccess ? 'network access on' : 'this PC only'})`);
  }
  await listenFront();
  logFn(`Carpathron Robotics & Coding server on https://localhost:${port}`);

  return {
    port,
    token: token(),
    store, agent, robot, mcp, wa, memory, projects, skills, camera, remote, jobs, github, shield,
    async close() {
      for (const c of clients) try { c.close(); } catch {}
      wss.close();
      await new Promise((r) => front.close(r));
      server.close(); redirect.close();
      robot.close();
      shield.stopAll();
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
