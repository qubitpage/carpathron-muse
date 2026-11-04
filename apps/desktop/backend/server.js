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
const { pipeline } = require('stream');
const { WebSocketServer } = require('ws');
const selfsigned = require('selfsigned');
const { Store } = require('./store');
const { Tts } = require('./tts');
const { RoomMap } = require('./roommap');
const { Robot } = require('./robot');
const { Mapper } = require('./mapper');
const { Vision } = require('./vision');
const voice = require('./voice');
const { Companion } = require('./companion');
const samc = require('./samcontour');
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
const { Ollama } = require('./ollama');
const { Jobs, findArduinoCli, execX, runProc } = require('./xtools');
const devices = require('./devices');
const { Studio } = require('./studio');
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
  { name: 'carpathron-build', description: 'The Carpathron process: robot firmware + control app + Avatar (VR) + docs, end to end', body: 'Work like the Carpathron project:\n1. Hardware: list parts and pins; write the robot firmware (ESP32, HTTP/WebSocket protocol like protocol/ROBOT-PROTOCOL.md) and flash it with the /firmware steps.\n2. Control: connect the robot in Muse Carpathron (Robot page → Find my car), test robot_status, robot_drive, robot_photo.\n3. Apps: extend the desktop control center or the Quest Avatar app; build, run, and test after every change.\n4. Server: if the user wants it online, deploy to the chosen SSH server (ssh_upload, ssh_exec, job_start for long processes).\n5. Documentation: README with setup steps and a designed PDF (/design-pdf) for partners.\nAfter each step report what works and what is next.' },
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
  let tts = null, sayChain = Promise.resolve();
  // what the room map / photo scan last said (the Quest app shows it: Carpathron Avatar 1.2)
  const mapNews = { text: '', at: 0, done: null };
  const emit = (event, data) => {
    if ((event === 'robot:roommap' || event === 'robot:scan') && data) {
      if (data.text) Object.assign(mapNews, { text: String(data.text), at: Date.now() });
      if (data.result) Object.assign(mapNews, { text: `${data.result.ok ? '✓' : '⚠'} ${data.result.text}`, at: Date.now(), done: data.result });
    }
    // the robot speaks with its own neural voice when it is installed: make the sound first (in order), then send
    if (event === 'robot:say' && tts && data && data.text && !data.audio && !data.plain && tts.ready()) {
      // long answers are spoken sentence by sentence: the first one plays while the next is being made
      const parts = [];
      for (const sn of String(data.text).split(/(?<=[.!?…])\s+/)) { if (parts.length && (parts[parts.length - 1] + ' ' + sn).length < 90) parts[parts.length - 1] += ' ' + sn; else parts.push(sn); }
      parts.forEach((part, i) => {
        sayChain = sayChain.then(() => tts.speak(part).then(
          (r) => emit(event, i === 0 ? { ...data, audio: r.url, secs: r.secs } : { text: part, by: data.by, audio: r.url, secs: r.secs, more: true }),
          (e) => { logFn(`Robot voice: ${e.message}`); emit(event, i === 0 ? { ...data, plain: true } : { text: part, by: data.by, plain: true, more: true }); }));
      });
      return;
    }
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

  tts = new Tts({ dataDir, getSettings: () => store.settings, log: logFn });
  // 2.2.5: the Quest headset's view (what the user sees in the headset), shown in Muse > Robots > Live
  const questView = {
    clients: new Set(), last: null, at: 0, mode: '',
    push(jpg, mode) {
      const first = Date.now() - this.at > 5000;
      this.last = jpg; this.at = Date.now(); this.mode = mode;
      if (first) emit('avatar:view', { live: true, mode });
      for (const c of this.clients) if (c.writableLength < 600000) this.send(c, jpg);
    },
    send(c, jpg) { try { c.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`); c.write(jpg); c.write('\r\n'); } catch {} },
    add(res) {
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store', Connection: 'close' });
      this.clients.add(res);
      if (this.last) this.send(res, this.last);
      res.on('close', () => this.clients.delete(res));
    },
  };
  // 2.2.5: smart vision for the headset — while Carpathron Avatar asks for it (and the car's video flows through this
  // PC), Muse looks at the newest camera picture every few seconds and names people, animals, obstacles and room
  // items with a box around each. The headset draws them on the robot's picture.
  // 2.3: two independent smart-vision loops — the car camera (with SAM 3.1 outlines) and the Quest 3 headset camera
  // (the room: quick, fast reasoning, every object remembered with when it was last seen)
  const liveVision = { wantedAt: 0, busy: false, seen: [], at: 0, frame: 0 };
  const roomVision = { wantedAt: 0, busy: false, seen: [], at: 0, frame: 0, memory: new Map() };
  // the newest headset camera picture and its number (the headset keeps where it looked for each number, so the
  // names land on the right things in the room)
  const roomEyes = { last: null, at: 0, id: 0 };
  // 2.3.3: Baby Carpathron's camera as the headset receives it (when this PC does not stream that car itself)
  const carEyes = { last: null, at: 0 };
  const carFrame = () => { const hub = robot._hub; if (hub && hub.last && Date.now() - hub.lastAt < 2500) return hub.last; return carEyes.last && Date.now() - carEyes.at < 2500 ? carEyes.last : null; };
  const KINDS = ['human', 'animal', 'obstacle', 'furniture', 'item', 'door'];
  const ROOM_PROMPT = 'You are the eyes of Carpathron, a friendly robot companion. The picture comes from the camera of a VR headset, at the eye height of the person wearing it, in their room. Find people, animals (pets), furniture, doors, obstacles on the floor and notable items. A small robot car (white or grey body, yellow wheels, round eyes) is "robot car" — always list it when you see it. Reply with JSON only, no text: {"objects":[{"label":"short name","kind":"human|animal|obstacle|furniture|item|door","box":[x,y,w,h],"dist":metres,"near":true|false}]} where box is the bounding box in fractions of the picture (0..1, x,y = top-left) and dist your best estimate of the distance from the camera in metres. At most 10 objects, the most interesting first. near = closer than about 1 m.';
  const CAR_PROMPT = 'You are the eyes of a small robot car; the camera is about 10 cm above the floor. Find what matters for driving and for a person watching: people, animals (pets), obstacles in the way, furniture, doors and notable items. Reply with JSON only, no text: {"objects":[{"label":"short name","kind":"human|animal|obstacle|furniture|item|door","box":[x,y,w,h],"near":true|false}]} where box is the bounding box in fractions of the picture (0..1, x,y = top-left). At most 8 objects, the most important first. near = closer than about 50 cm or blocking the way.';
  const visionTick = async (V, room) => {
    if (V.busy || Date.now() - V.wantedAt > 8000) return;
    const s = store.settings, hub = robot._hub;
    if (!s.apiKey) return;
    if (room ? (!roomEyes.last || Date.now() - roomEyes.at > 4000) : !carFrame()) return;
    V.busy = true;
    try {
      const jpg = room ? roomEyes.last : carFrame(), frame = room ? roomEyes.id : 0, t0 = Date.now();
      const r = await agent.api.complete({ model: s.model, effort: 'minimal', messages: [
        { role: 'system', content: room ? ROOM_PROMPT : CAR_PROMPT },
        { role: 'user', content: [{ type: 'text', text: room ? 'What is in this room?' : 'What is in this picture?' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpg.toString('base64')}` } }] },
      ] });
      const txt = String(r.content || ''), a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      const j = a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1)) : { objects: [] };
      const num = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      const seen = (Array.isArray(j.objects) ? j.objects : []).slice(0, room ? 10 : 8).map((o) => {
        const bx = Array.isArray(o.box) ? o.box.map(num) : [0, 0, 0, 0];
        const d = Number(o.dist);
        return { label: String(o.label || 'object').slice(0, 30), kind: KINDS.includes(o.kind) ? o.kind : 'item', box: [bx[0], bx[1], Math.min(1 - bx[0], bx[2]), Math.min(1 - bx[1], bx[3])], near: !!o.near, ...(room && d > 0 ? { dist: Math.round(Math.min(8, d) * 10) / 10 } : {}) };
      }).filter((o) => o.box[2] > 0.01 && o.box[3] > 0.01);
      V.ms = Date.now() - t0;
      // SAM 3.1 cuts out every object of the car camera: an exact outline (contour) instead of a box
      if (!room && seen.length && s.samOutlines !== false && Date.now() > (V.samOffUntil || 0)) {
        const t1 = Date.now(), sz = samc.jpegSize(jpg) || { w: 640, h: 480 };
        const file = path.join(os.tmpdir(), `muse-live-${process.pid}.jpg`);
        try {
          fs.writeFileSync(file, jpg);
          const rs = await agent.media.segment({ file, prompt: samc.objectPrompt(seen.map((o) => o.box), sz.w, sz.h) });
          for (const rec of samc.parseRecords(rs.raw)) {
            const o = seen[rec.id], sh = o && samc.recordShape(rec, sz.w, sz.h);
            if (!sh || sh.box[2] < 0.01) continue;
            o.box = sh.box.map((v) => Math.round(v * 1000) / 1000);
            if (sh.poly.length >= 6) o.poly = sh.poly;
          }
          V.samMs = Date.now() - t1;
        } catch (e) { V.samOffUntil = Date.now() + 60000; logFn(`Smart vision: SAM 3.1 outlines unavailable (${e.message}) — boxes for a minute`); }
      }
      if (room) for (const o of seen) {
        const k = o.label.toLowerCase(), m = V.memory.get(k) || { label: o.label, kind: o.kind, n: 0 };
        Object.assign(m, { at: Date.now(), dist: o.dist, n: m.n + 1 }); V.memory.set(k, m);
        if (V.memory.size > 60) V.memory.delete([...V.memory.entries()].sort((x, y) => x[1].at - y[1].at)[0][0]);
      }
      Object.assign(V, { seen, at: Date.now(), frame });
      // the real car notices people and pets that come into view and says so (in the headset)
      if (!room && companion && Date.now() - (companion.realAt || 0) < 60000) {
        const nowT = Date.now();
        V.noticed = V.noticed || new Map();
        for (const o of seen) {
          const k = o.label.toLowerCase();
          if ((o.kind === 'human' || o.kind === 'animal') && nowT - (V.noticed.get(k) || 0) > 90000 && nowT - (V.lastNotice || 0) > 25000) {
            V.noticed.set(k, nowT); V.lastNotice = nowT;
            companionSay(o.kind === 'human' ? `Oh, hello! I can see a ${o.label} in front of me.` : `Hey, look! There's a ${o.label} right here.`);
            break;
          }
        }
      }
    } catch (e) { logFn(`Smart vision${room ? ' (room)' : ''}: ${e.message}`); }
    V.busy = false;
  };
  setInterval(() => visionTick(liveVision, false), 3000).unref();
  setInterval(() => visionTick(roomVision, true), 1500).unref();
  const robot = new Robot({ getCfg: () => store.settings.robot || {}, getIp: () => store.settings.robot.carIp, emit: (e, d) => (e === 'log' ? logFn(d) : emit(e, d)) });
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
  const carsettings = require('./carsettings');
  const boards = require('./boards');
  const { Missions } = require('./missions');
  let missions = null; // made after the mapper
  let calibrating = false;
  let practice = null; // the practice car (simulator), started from Robot → Setup
  const carHistory = { // robot passport: what changed on the car and what the health checks found
    f: path.join(dataDir, 'car-history.json'),
    read() { try { return JSON.parse(fs.readFileSync(this.f, 'utf8')); } catch { return []; } },
    add(e) { const l = this.read(); l.push({ at: new Date().toISOString(), ...e }); try { fs.writeFileSync(this.f, JSON.stringify(l.slice(-300), null, 1)); } catch {} },
  };
  const mapper = new Mapper({ robot, camera, api: agent.api, memory, getSettings: () => store.settings, emit, log: logFn });
  const roommap = new RoomMap({ robot, mapper, getSettings: () => store.settings, emit, log: logFn });
  // a room scan also teaches the room map: its laser sweep (from where the car stood) and the objects it named
  agent.roommap = roommap;
  mapper.onMap = (map) => {
    if (map.sweep && map.pose) { for (const pt of map.sweep) roommap.grid.ray(map.pose.x, map.pose.y, (map.pose.heading || 0) + pt.deg, pt.m); roommap.dirty = true; }
    roommap.addObjects(map.landmarks);
  };
  missions = new Missions({ robot, mapper, camera, emit, log: logFn, getSettings: () => store.settings });
  const phraseCache = new Map();  // quick answers ("Coming!") are made once per voice
  const speechJobs = new Map();   // companion sentence id -> promise (its WAV is being made)
  // things the companion says on its own (a scan summary, noticing someone): spoken in the headset via /avatar/state
  let companionSayMsg = null;
  let companionGen = 0;
  const companionSay = async (text) => {
    const msg = { id: Date.now(), text: String(text).slice(0, 300), audio: [] };
    try {
      const cv = tts && (tts.ready(tts.companionVoiceId()) ? tts.companionVoiceId() : tts.voiceId());
      if (tts && tts.ready(cv, true)) { const r = await tts.speak(msg.text, { voice: cv, fast: true }); msg.audio = [`/avatar/speech/${r.id}.wav`]; }
    } catch (e) { logFn(`Companion voice: ${e.message}`); }
    companionSayMsg = msg;
    emit('companion', { say: msg.text, action: 'none', mode: 'real' });
  };
  const companion = new Companion({ agent, store, tts, robot, mapper, roommap, missions, liveVision, roomVision, roomEyes, log: logFn, emit });
  companion.onSay = companionSay;
  companion.carEyes = carEyes;
  missions.roommap = roommap;
  agent.mapper = mapper;
  const shield = new Shield({ store, remote, log: logFn, emit, dataDir });
  agent.shield = shield;
  const ollama = new Ollama({ getSettings: () => store.settings, saveSettings: () => store.saveSettings(), emit, log: logFn });
  agent.api.ollama = ollama;
  agent.ollama = ollama;
  const studio = new Studio({ getSettings: () => store.settings, findCli: () => findArduinoCli(dataDir, store.settings.arduinoCli), emit, log: logFn, dataDir });
  const vision = new Vision({ api: agent.api, getSettings: () => store.settings, ollama, log: logFn });
  agent.vision = vision; mapper.vision = vision;
  setTimeout(() => ollama.status().catch(() => {}), 1500); // local model capabilities (vision, tools) for routing
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
        let list;
        if (engine === 'muse') list = await agent.muse.listModels();
        else {
          // cloud models (or the known list when offline) + the local models picked in Settings → Local models
          if (ollama.enabledModels().length && !models.LOCAL_CAPS.size) await ollama.status().catch(() => {}); // learn what each local model can do
          const local = ollama.enabledModels().map((n) => ({ id: `local:${n}`, label: `${n} — on this PC (offline)` }));
          list = models.withCaps([...(await agent.api.listModels()), ...local]);
        }
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
      for (const k of ['engine', 'apiBase', 'model', 'museModel', 'museBin', 'mode', 'maxSteps', 'systemPrompt', 'autoMemory', 'autoSkills', 'effort', 'museBridge', 'museSandbox', 'museTrustWorkspace', 'musePermissionProfile', 'arduinoCli', 'webSearch', 'researchModel', 'finishAllTasks', 'verifyBeforeFinish', 'supervisor', 'supervisorModel', 'toolRouting', 'localEnabled', 'localBase', 'localModel', 'localModels', 'localContext', 'localFallback', 'ollamaBin', 'visionModel', 'maxTotalSteps', 'apiWire', 'contextTokens']) if (k in b) patch[k] = b[k];
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
          driveSpeed: num(b.robot.driveSpeed, cur.driveSpeed || 60, 30, 100), cmPerSec: num(b.robot.cmPerSec, cur.cmPerSec || 40, 5, 200),
          turnSteps360: b.robot.turnSteps360 === 0 ? 0 : num(b.robot.turnSteps360, cur.turnSteps360 || 0, 0, 200),
          usbPort: String(b.robot.usbPort ?? cur.usbPort ?? ''),
          camHeightCm: num(b.robot.camHeightCm, cur.camHeightCm || 10, 3, 60), camTiltDeg: Number.isFinite(Number(b.robot.camTiltDeg)) ? Math.max(-30, Math.min(45, Number(b.robot.camTiltDeg))) : (cur.camTiltDeg || 0),
        };
      }
      if ('vision' in b) patch.vision = !!b.vision;
      if (b.mcpServers && typeof b.mcpServers === 'object') { store.settings.mcpServers = b.mcpServers; }
      if (b.whatsapp) {
        const w = b.whatsapp;
        const cur = store.settings.whatsapp;
        if (Array.isArray(w.allowed)) cur.allowed = w.allowed.map(String).map((x) => x.trim()).filter(Boolean);
        if (w.personal) cur.personal.enabled = !!w.personal.enabled;
        if ('model' in w) cur.model = String(w.model || '');
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
    // Local models (Ollama on this PC)
    if (p === '/api/local' && m === 'GET') return send(res, 200, await ollama.status());
    if (p === '/api/local/test' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await agent.api.testLocal(b.model ? `local:${b.model}` : undefined)); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (p === '/api/local/install' && m === 'POST') { try { return send(res, 200, ollama.install()); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/compat/install' && m === 'POST') { try { return send(res, 200, ollama.compat.install()); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/compat/start' && m === 'POST') { try { return send(res, 200, await ollama.compat.start()); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/start' && m === 'POST') { try { return send(res, 200, await ollama.start()); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/pull' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, await ollama.pull(b.name)); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/pull' && m === 'DELETE') { const b = await readJson(req); return send(res, 200, { ok: ollama.cancelPull(String(b.name || '')) }); }
    if (p === '/api/local/models' && m === 'DELETE') { const b = await readJson(req); try { return send(res, 200, await ollama.remove(String(b.name || ''))); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/local/enabled' && m === 'POST') { const b = await readJson(req); ollama.setEnabled(b.models); if (b.defaultModel) { store.settings.localModel = String(b.defaultModel); store.saveSettings(); } return send(res, 200, await ollama.status()); }
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
      try { await wa.cloudSend(b.to, b.text || 'Hello from Muse Carpathron'); return send(res, 200, { ok: true }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }

    // robot + camera
    if (p === '/api/robot') return send(res, 200, robot.status());
    if (p === '/api/robot/stream') return robot.pipeStream(res);
    if (p === '/api/avatar/view.mjpg') return questView.add(res);
    if (p === '/api/avatar/view') return send(res, 200, { live: Date.now() - questView.at < 3000, at: questView.at, mode: questView.mode });
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
    // Distance calibration: an object stands `cm` in front of the car; where it touches the floor in the photo → camera tilt
    if (p === '/api/robot/calibrate-distance' && m === 'POST') {
      const b = await readJson(req);
      try {
        const geo = require('./geometry');
        const cm = Math.max(15, Math.min(300, Number(b.cm) || 50));
        const ph = await camera.capture();
        const meas = await vision.measure({ buffer: ph.buffer, mime: ph.mime }, String(b.target || 'the object standing on the floor straight ahead'), {});
        if (!meas.visible || !meas.box) return send(res, 200, { error: `The vision model did not find the object (${meas.what || 'nothing'}). Put a box or a shoe ${cm} cm in front of the car, in the middle.`, photo: ph.path });
        const cur = store.settings.robot || {};
        const g = geo.cfgOf(cur);
        const tilt = Math.round(geo.calibrateTilt(meas.box[3], cm, g) * 10) / 10;
        store.updateSettings({ robot: { ...cur, camTiltDeg: tilt } });
        emit('settings:update', store.publicSettings());
        return send(res, 200, { ok: true, tiltDeg: tilt, row: meas.box[3], model: meas.model, photo: ph.path });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // ---- Robot page → Devices: boards on USB + robots on the network
    if (p === '/api/hw/devices' && m === 'GET') {
      const cli = findArduinoCli(dataDir, store.settings.arduinoCli);
      let usb = [], cores = [];
      if (cli) {
        const r = await runProc(cli, ['board', 'list', '--format', 'json'], { timeoutMs: 30000 });
        usb = devices.fromBoardList(r.out);
        const c = await runProc(cli, ['core', 'list', '--format', 'json'], { timeoutMs: 30000 });
        try { const j = JSON.parse(c.out); cores = (j.platforms || j || []).map((x) => ({ id: x.id || (x.metadata && x.metadata.id), version: x.installed_version || x.installed || '' })); } catch {}
      }
      if (process.platform === 'win32') {
        // boards without a serial port (Pico in BOOTSEL, Jetson) and everything when arduino-cli is missing
        const r = await runProc('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_PnPEntity | Where-Object { $_.DeviceID -match 'VID_' } | Select-Object Name,DeviceID | ConvertTo-Json -Compress"], { timeoutMs: 20000 }).catch(() => ({ out: '' }));
        for (const d of devices.fromPnp(r.out)) if (!usb.some((u) => (u.address && u.address === d.address) || (!d.address && u.vid === d.vid && u.pid === d.pid))) usb.push(d);
      }
      // the car on USB: the port the firmware was last flashed through
      const lastPort = (store.settings.robot || {}).usbPort;
      for (const u of usb) if (lastPort && u.address === lastPort) { u.robot = 'Baby Carpathron car'; u.fqbn = 'esp32:esp32:esp32cam'; u.core = 'esp32:esp32'; }
      const network = await devices.networkDevices({ settings: store.settings, servers: remote.publicList(), robotStatus: robot.status() });
      return send(res, 200, { usb, network, cli: cli || null, cores });
    }
    if (p === '/api/hw/install' && m === 'POST') {
      const b = await readJson(req);
      const core = String(b.core || '').trim();
      if (core && !/^[\w.-]+:[\w.-]+(@[\w.-]+)?$/.test(core)) return send(res, 200, { error: 'bad core id' });
      try {
        const ctx = { settings: store.settings, workspace: store.settings.workspace, dataDir, status: (t) => emit('studio:log', { text: `${t}\n` }) };
        const text = await execX('arduino_setup', { cores: core ? [core === 'esp32:esp32' ? 'esp32:esp32@2.0.12' : core] : [] }, ctx);
        return send(res, 200, { ok: !/FAILED/.test(text), text });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // ---- Robot page → Firmware studio
    if (p.startsWith('/api/studio/')) {
      const b = m === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(req);
      try {
        if (p === '/api/studio/projects') return send(res, 200, { root: studio.root(), projects: studio.projects(), templates: Object.entries(require('./studio').TEMPLATES).map(([id, t]) => ({ id, label: t.label })).concat([{ id: 'carpathron_car', label: 'Baby Carpathron car firmware (bundled)' }]) });
        if (p === '/api/studio/new') {
          if (b.template === 'carpathron_car') { const fwm = require('./firmware'); const r = fwm.prepare(store.settings); studio.setMeta('carpathron_car', { fqbn: 'esp32:esp32:esp32cam' }); return send(res, 200, { name: 'carpathron_car', dir: r.dir, backup: r.backup }); }
          return send(res, 200, studio.create(String(b.name || ''), b.template, b.fqbn));
        }
        if (p === '/api/studio/files') return send(res, 200, { files: studio.files(b.project), meta: studio.meta(b.project), dir: studio.dir(b.project) });
        if (p === '/api/studio/file' && m === 'GET') return send(res, 200, { content: studio.file(b.project, b.name), history: studio.history(b.project, b.name) });
        if (p === '/api/studio/file') return send(res, 200, studio.save(b.project, b.name, String(b.content ?? '')));
        if (p === '/api/studio/restore') return send(res, 200, studio.restore(b.project, b.name, b.id));
        if (p === '/api/studio/meta') return send(res, 200, studio.setMeta(b.project, { fqbn: String(b.fqbn || ''), port: String(b.port || '') }));
        if (p === '/api/studio/compile') return send(res, 200, await studio.compile(b.project, b.fqbn));
        if (p === '/api/studio/upload') {
          const r = await studio.upload(b.project, b.fqbn, b.port);
          if (r.ok && b.project === 'carpathron_car') { store.updateSettings({ robot: { ...store.settings.robot, usbPort: b.port } }); setTimeout(() => robot.connect(), 4000); }
          return send(res, 200, r);
        }
        if (p === '/api/studio/cancel') return send(res, 200, { cancelled: studio.cancel() });
        if (p === '/api/studio/pincheck') {
          const B = require('./boards'); const board = B.byFqbn(b.fqbn);
          if (!board) return send(res, 200, { board: null, problems: [], note: 'No pin profile for this board (profiles: ESP32-CAM, ESP32 DevKit, XIAO ESP32S3, Uno, Mega, Pico).' });
          let text = ''; for (const f of studio.files(b.project)) text += `\n${studio.file(b.project, f.name)}`;
          const { assign, needs } = B.pinsInCode(text);
          return send(res, 200, { board: board.name, pins: assign, problems: B.checkPins(board, assign, { needs }) });
        }
        if (p === '/api/studio/libs') {
          const r = await runProc(studio.cli(), ['lib', 'search', String(b.q || '').slice(0, 60), '--format', 'json'], { timeoutMs: 120000 });
          let libs = []; try { const j = JSON.parse(r.out); libs = (j.libraries || j || []).slice(0, 30).map((l) => { const rel = l.latest || (l.releases && Object.values(l.releases).pop()) || {}; return { name: l.name, version: rel.version || '', author: rel.author || '', sentence: rel.sentence || '' }; }); } catch {}
          const inst = await runProc(studio.cli(), ['lib', 'list', '--format', 'json'], { timeoutMs: 60000 });
          let installed = []; try { const j = JSON.parse(inst.out); installed = (j.installed_libraries || j || []).map((x) => (x.library || x).name); } catch {}
          return send(res, 200, { libs, installed });
        }
        if (p === '/api/studio/libinstall') {
          const name = String(b.name || '').trim();
          if (!/^[\w .+\-]{1,80}$/.test(name)) return send(res, 200, { error: 'bad library name' });
          const r = await runProc(studio.cli(), ['lib', 'install', name], { timeoutMs: 300000 });
          return send(res, 200, { ok: r.code === 0, out: r.out.slice(-2000) });
        }
        if (p === '/api/studio/serial') {
          if (b.action === 'start') return send(res, 200, studio.serialStart(b.port, b.baud));
          if (b.action === 'send') return send(res, 200, studio.serialSend(String(b.text || '')));
          return send(res, 200, { stopped: studio.serialStop() });
        }
        if (p === '/api/studio/boards') {
          const cli = studio.cli();
          const r = await runProc(cli, ['board', 'listall', '--format', 'json'], { timeoutMs: 60000 });
          let boards = []; try { boards = (JSON.parse(r.out).boards || []).map((x) => ({ name: x.name, fqbn: x.fqbn })); } catch {}
          return send(res, 200, { boards });
        }
        return send(res, 404, { error: 'unknown studio call' });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // Car firmware: status / update over USB (Settings → Devices & robots → Update car firmware)
    if (p === '/api/robot/firmware' && m === 'GET') return send(res, 200, { builds: require('./firmware').listBuilds(dataDir).map((x) => ({ version: x.version, at: x.at, size: x.size })) });
    if (p === '/api/robot/firmware' && m === 'POST') {
      const b = await readJson(req);
      const action = ['status', 'check', 'build', 'update', 'wifi', 'undo', 'mega'].includes(b.action) ? b.action : 'status';
      const busy = action !== 'status' && action !== 'check';
      if (agent.firmwareBusy && busy) return send(res, 200, { error: 'A firmware job is already running.' });
      if (busy) agent.firmwareBusy = true;
      try {
        const ctx = { settings: store.settings, workspace: store.settings.workspace, dataDir, robot, status: (t) => emit('robot:firmware', { text: t }) };
        const text = await execX('robot_firmware', { action, port: b.port }, ctx);
        if (busy) carHistory.add({ kind: 'firmware', action, ok: !/FAILED\]/.test(text), version: (text.match(/firmware ([\d.]+)/g) || []).pop() || '' });
        return send(res, 200, { ok: !/FAILED\]/.test(text), text });
      } catch (e) { return send(res, 200, { error: e.message }); }
      finally { if (busy) agent.firmwareBusy = false; }
    }
    // Sensor mode on the car (firmware 2.1): auto (I2C laser + gyro, or the Mega hub) | ir (IR obstacle modules) | mega (2.3: Arduino Mega hub) | off — the car restarts
    if (p === '/api/robot/sensor-mode' && m === 'POST') {
      const b = await readJson(req);
      const mode = ['auto', 'ir', 'mega', 'off'].includes(b.mode) ? b.mode : null;
      const ip = String((store.settings.robot || {}).carIp || '').trim();
      if (!mode || !ip) return send(res, 200, { error: !ip ? 'Set the car address first.' : 'mode must be auto, ir, mega or off' });
      try {
        const r = await fetch(`http://${ip}/config?sensors=${mode}`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setTimeout(() => robot.connect(), 5000);
        return send(res, 200, { ok: true, mode, restarting: true });
      } catch (e) { return send(res, 200, { error: `The car did not accept it (${e.message}). It needs firmware 2.1 (mega: 2.3) — update it first.` }); }
    }
    // Voice: spoken robot commands (short ones run at once, the rest go to the agent) and the robot's own voice
    if (p === '/api/robot/voice' && m === 'POST') {
      const raw = await readBody(req, 8 * 1024 * 1024);
      const s = store.settings;
      if (!s.apiKey) return send(res, 200, { error: 'Voice commands need the Meta API key (Settings) for Muse Voice Transcribe.' });
      try {
        const heard = await voice.transcribe(raw, { apiKey: s.apiKey, apiBase: s.apiBase, mime: 'audio/wav' });
        if (!heard) return send(res, 200, { heard: '', replies: [] });
        const cmd = voice.voiceToCommand(heard);
        if (cmd === '/robot stop') robot.stop('voice'); // stop first, before anything else
        const replies = [];
        const speak = url.searchParams.get('speak') === '1';
        await wa.handle('robot-voice', 'desktop', cmd || heard, async (t) => { if (!/^⏳ Working on it/.test(t)) { replies.push(String(t)); if (speak) emit('robot:say', { text: String(t).replace(/[*_`#>]/g, '').slice(0, 400), by: 'muse' }); } }, async () => {});
        logFn(`Voice: "${heard}"${cmd ? ` → ${cmd}` : ''}`);
        return send(res, 200, { heard, command: cmd, replies });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // The robot's own voice: list voices, download one (once), pick one, hear a sample, fetch the sound files
    if (p === '/api/robot/voice/status' && m === 'GET') return send(res, 200, tts.status());
    if (p === '/api/robot/voice/download' && m === 'POST') {
      const b = await readJson(req);
      tts.download(b.model, (pct) => emit('voice:download', { model: b.model, pct })).then(() => emit('voice:download', { model: b.model, done: true }), (e) => emit('voice:download', { model: b.model, error: e.message }));
      return send(res, 200, { ok: true, started: true });
    }
    if (p === '/api/robot/voice/choose' && m === 'POST') {
      const b = await readJson(req);
      if (!require('./tts').VOICES[b.voice]) return send(res, 200, { error: 'Unknown voice.' });
      store.settings.robot = { ...(store.settings.robot || {}), [b.for === 'companion' ? 'companionVoice' : 'voice']: b.voice }; store.saveSettings();
      return send(res, 200, { ok: true, voice: b.voice, for: b.for === 'companion' ? 'companion' : 'robot' });
    }
    if (p === '/api/robot/voice/sample' && m === 'POST') {
      const b = await readJson(req);
      try { const r = await tts.speak(String(b.text || 'Hello! I am Baby Carpathron. Where shall we go today?').slice(0, 300), { voice: b.voice }); return send(res, 200, { ok: true, audio: r.url, secs: r.secs, ms: r.ms }); }
      catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (p.startsWith('/api/robot/voice/audio/') && m === 'GET') {
      const f = tts.file(p.slice('/api/robot/voice/audio/'.length));
      if (!f) return send(res, 404, { error: 'not found' });
      return sendFile(res, f, 'audio/wav');
    }
    if (p === '/api/robot/say' && m === 'POST') {
      const b = await readJson(req);
      const text = String(b.text || '').trim().slice(0, 400);
      if (!text) return send(res, 200, { error: 'Nothing to say.' });
      emit('robot:say', { text, by: 'you' });
      return send(res, 200, { ok: true });
    }
    // Board & parts: board profiles, parts library, pin planner, saved builds (one per board), starter code
    if (p === '/api/robot/parts' && m === 'GET') {
      const B = require('./boards').BOARDS, PT = require('./parts');
      return send(res, 200, { boards: Object.values(B), parts: PT.PARTS });
    }
    if (p === '/api/robot/parts/plan' && m === 'POST') { const b = await readJson(req); try { const r = require('./parts').plan(b.board, b.part, b.used || {}, { i2c: b.i2c }); return send(res, 200, { ok: r.ok, assign: r.assign, notes: r.notes }); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/robot/parts/check' && m === 'POST') { const b = await readJson(req); const B = require('./boards'); const board = B.BOARDS[b.board]; if (!board) return send(res, 200, { error: 'unknown board' }); return send(res, 200, { problems: B.checkPins(board, b.assign || {}, { needs: b.needs || {} }) }); }
    if (p === '/api/robot/parts/code' && m === 'POST') { const b = await readJson(req); try { return send(res, 200, { code: require('./parts').starterCode(b.board, b.placed || []) }); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/robot/build') {
      const f = path.join(dataDir, 'robot-builds.json');
      let all = {}; try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (m === 'GET') return send(res, 200, all);
      const b = await readJson(req);
      if (!b.board || !require('./boards').BOARDS[b.board]) return send(res, 200, { error: 'unknown board' });
      all[b.board] = { parts: (Array.isArray(b.parts) ? b.parts : []).slice(0, 40).map((x) => ({ id: String(x.id || '').slice(0, 24), name: String(x.name || '').slice(0, 60), part: String(x.part || ''), assign: Object.fromEntries(Object.entries(x.assign || {}).map(([k, v]) => [String(k).slice(0, 12), Number(v)])) })), at: Date.now() };
      fs.writeFileSync(f, JSON.stringify(all, null, 1));
      return send(res, 200, { ok: true });
    }
    // Make my robot ready: one look at everything (connection, firmware, Wi-Fi updates, health, calibration, map)
    if (p === '/api/robot/ready' && m === 'GET') {
      const items = [], add = (id, status, title, detail, action) => items.push({ id, status, title, detail, action: action || null });
      const ip = String((store.settings.robot || {}).carIp || '').trim(), st0 = robot.status();
      if (!ip) { add('connect', 'bad', 'No car address yet', 'Find the car on your Wi-Fi, or try everything on the practice car.', { tab: 'setup', label: 'Find my car' }); return send(res, 200, { items, ready: false }); }
      if (st0.state !== 'online') { add('connect', 'bad', `The car does not answer at ${ip}`, 'Switch it on; it must be on the same Wi-Fi as this PC.', { tab: 'setup', label: 'Find my car' }); return send(res, 200, { items, ready: false }); }
      add('connect', 'ok', `Car online at ${ip}`, st0.rssi ? `Wi-Fi ${st0.rssi} dBm` : '');
      const fwm = require('./firmware'); const bdir = fwm.bundledDir();
      const bundled = bdir ? fwm.versionOf(fs.readFileSync(path.join(bdir, `${fwm.SKETCH}.ino`), 'utf8')) : null;
      const carV = st0.version;
      if (!carV || (bundled && fwm.cmpVersion(bundled, carV) > 0)) add('firmware', 'warn', `Firmware ${carV || 'older than 2.0'} — ${bundled} is available`, 'Car settings, the health check and Wi-Fi updates need the new firmware.', { tab: 'setup', label: 'Update the firmware' });
      else add('firmware', 'ok', `Firmware ${carV} (newest)`, '');
      const ota = await fwm.otaInfo(ip).catch(() => null);
      if (ota && ota.ota && ota.keySet) add('ota', 'ok', 'Wi-Fi updates ready', ota.other && ota.other.valid ? 'Undo is possible.' : '');
      else if (carV && fwm.cmpVersion(carV, '2.2.0') >= 0) add('ota', 'info', 'Wi-Fi updates not set up yet', 'Flash once over USB from this PC.', { tab: 'setup', label: 'Flash over USB' });
      let health = null;
      try { health = carsettings.health(await carsettings.runDiag(ip)); } catch {}
      if (health) {
        const bad = health.items.filter((x) => x.status === 'bad'), warn = health.items.filter((x) => x.status === 'warn');
        add('health', bad.length ? 'bad' : warn.length ? 'warn' : 'ok', bad.length ? `Health: ${bad.map((x) => x.title).join(', ')}` : warn.length ? `Health: ${warn.length} thing(s) to check` : 'Health check: all parts work', [...bad, ...warn].map((x) => x.fix).filter(Boolean).slice(0, 2).join(' '), bad.length || warn.length ? { tab: 'health', label: 'Open the health check' } : null);
        const sn = st0.sensors || {};
        if (!sn.tof || !sn.imu) add('sensors', 'info', `Optional sensors: laser ${sn.tof ? '✓' : '—'} · gyro ${sn.imu ? '✓' : '—'}`, 'A VL53L0X and an MPU-6050 (≈ 20 lei) give the safety stop, exact turns, calibration and laser maps.', { tab: 'parts', label: 'See where they go' });
      }
      const hist = carHistory.read(), done = new Set(hist.filter((e) => e.kind === 'calibration' && e.ok).map((e) => e.step));
      const want = ['deadzone', 'straight', 'turn'].filter((x) => !done.has(x));
      add('calibration', want.length ? 'warn' : 'ok', want.length ? `Calibration not done: ${want.map((x) => ({ deadzone: 'lowest power', straight: 'drive straight', turn: 'exact turns' })[x]).join(', ')}` : 'Calibrated', want.length ? 'A few minutes, the car measures itself.' : '', want.length ? { tab: 'health', label: 'Calibrate' } : null);
      const maps = mapper.list();
      add('map', maps.length ? 'ok' : 'info', maps.length ? `Room map from ${maps[0].id.slice(0, 16).replace('T', ' ')}` : 'No room map yet', maps.length ? '' : 'The car photographs (and with the laser measures) all around and draws a map.', maps.length ? null : { tab: 'control', label: 'Scan the room' });
      return send(res, 200, { items, ready: !items.some((x) => x.status === 'bad' || x.status === 'warn') });
    }
    // Car Settings + Health check (firmware 2.2): explained settings, checked before they are sent; the car's self-test
    if (p.startsWith('/api/robot/car/')) {
      const ip = String((store.settings.robot || {}).carIp || '').trim();
      const what = p.slice('/api/robot/car/'.length);
      if (what === 'schema') return send(res, 200, { groups: carsettings.GROUPS, board: boards.BOARDS.esp32cam });
      if (what === 'history') return send(res, 200, carHistory.read());
      if (what === 'practice' && m === 'POST') { // start / stop the practice car (simulator)
        const b = await readJson(req);
        if (b.stop) { if (practice) { practice.close(); practice = null; } return send(res, 200, { ok: true, running: false }); }
        if (!practice) { practice = await require('./simcar').start({ faults: b.faults || {} }); robot.resetPose(); } // the map's (0, 0) = where the practice car starts
        else if (b.faults) practice.setFaults(b.faults);
        if (b.use !== false) { store.updateSettings({ robot: { ...store.settings.robot, carIp: practice.host } }); robot.connect(); emit('settings:update', store.publicSettings()); }
        logFn(`Practice car running at ${practice.host}`);
        return send(res, 200, { ok: true, running: true, host: practice.host, faults: practice.state.faults });
      }
      if (what === 'practice/pose') return send(res, 200, practice ? { running: true, x: practice.state.x, y: practice.state.y, heading: practice.state.head, l: practice.state.l, r: practice.state.r, camera: !practice.state.faults.noCamera, led: practice.state.led, blocked: practice.state.blocked } : { running: false });
      if (what === 'practice/frame' && m === 'POST') { const buf = await readBody(req, 2 * 1024 * 1024); if (practice && buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8) practice.setFrame(buf); return send(res, 200, { ok: !!practice }); }
      if (what === 'practice') return send(res, 200, { running: !!practice, host: practice ? practice.host : '', pose: practice ? practice.pose() : null, trail: practice ? practice.state.trail : [], room: practice ? practice.room : null, faults: practice ? practice.state.faults : {} });
      if (!ip) return send(res, 200, { error: 'Set the car address first (Robot → Setup → Find my car), or start the practice car.' });
      try {
        if (what === 'settings' && m === 'GET') return send(res, 200, await carsettings.getSettings(ip));
        if (what === 'check' && m === 'POST') { const b = await readJson(req); return send(res, 200, carsettings.checkAll(b.values || {}, b.changes || {})); }
        if (what === 'settings' && m === 'POST') {
          const b = await readJson(req), changes = b.changes || {};
          const cur = await carsettings.getSettings(ip);
          const values = { ...cur.values, ...cur.strings };
          const chk = carsettings.checkAll(values, changes);
          if (!chk.ok) return send(res, 200, { ok: false, errors: chk.errors, warnings: chk.warnings });
          let out = null;
          const nums = Object.fromEntries(Object.entries(changes).filter(([k]) => !carsettings.STRING_KEYS.has(k)));
          if (Object.keys(nums).length) out = await carsettings.setMany(ip, nums);
          for (const [k, v] of Object.entries(changes)) if (carsettings.STRING_KEYS.has(k)) out = await carsettings.setSetting(ip, k, v);
          carHistory.add({ kind: 'settings', changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, k === 'apPass' ? '••••' : v])), before: Object.fromEntries(Object.keys(changes).map((k) => [k, k === 'apPass' ? '••••' : values[k]])) });
          logFn(`Car settings changed: ${Object.keys(changes).join(', ')}`);
          return send(res, 200, { ok: true, warnings: chk.warnings, settings: out, needsRestart: !!(out && out.restartPending) });
        }
        if (what === 'restart' && m === 'POST') { const r = await carsettings.restart(ip); setTimeout(() => robot.connect(), 6000); return send(res, 200, r); }
        if (what === 'reset' && m === 'POST') { const r = await carsettings.factoryReset(ip); carHistory.add({ kind: 'reset' }); setTimeout(() => robot.connect(), 6000); return send(res, 200, r); }
        if (what === 'pin' && m === 'POST') { const b = await readJson(req); return send(res, 200, await carsettings.carJson(ip, `/pin?gpio=${Number(b.gpio)}&mode=${encodeURIComponent(['read', 'high', 'low', 'blink'].includes(b.mode) ? b.mode : 'read')}`, 6000)); }
        if (what === 'calibrate' && m === 'GET') return send(res, 200, { steps: require('./calibrate').STEPS });
        if (what === 'calibrate' && m === 'POST') {
          const b = await readJson(req);
          if (calibrating) return send(res, 200, { error: 'A calibration step is already running.' });
          calibrating = true;
          try {
            robot.stop('calibration'); await new Promise((r) => setTimeout(r, 400));
            const { Calibrator } = require('./calibrate');
            const cal = new Calibrator(ip, { appRobot: () => store.settings.robot || {}, setAppRobot: (x) => { store.updateSettings({ robot: { ...store.settings.robot, ...x } }); emit('settings:update', store.publicSettings()); }, log: logFn });
            const r = await cal.run(String(b.step || ''), b.input || {});
            if (!r.waiting) carHistory.add({ kind: 'calibration', step: r.step, ok: r.ok, applied: r.applied || {}, before: r.before || {}, text: r.text });
            return send(res, 200, r);
          } finally { calibrating = false; }
        }
        if (what === 'diag' && m === 'POST') {
          const b = await readJson(req);
          if (b.motors) { robot.stop('health check'); await new Promise((r) => setTimeout(r, 400)); } // the stop reaches the car before the wheel test
          const d = await carsettings.runDiag(ip, { motors: !!b.motors });
          const h = carsettings.health(d);
          carHistory.add({ kind: 'health', summary: h.summary, problems: h.items.filter((x) => x.status === 'bad' || x.status === 'warn').map((x) => x.title) });
          return send(res, 200, { ...h, raw: d });
        }
      } catch (e) { return send(res, 200, { error: e.message }); }
      return send(res, 404, { error: 'not found' });
    }
    if (p === '/api/robot/calibrate-turn' && m === 'POST') {
      try {
        const r = await mapper.calibrateTurn({ source: 'pc' });
        store.updateSettings({ robot: { ...store.settings.robot, turnMs360: r.turnMs360, turnSteps360: 0 } });
        emit('settings:update', store.publicSettings());
        return send(res, 200, { ok: true, ...r });
      } catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (p === '/api/robot/forward' && m === 'POST') {
      const b = await readJson(req);
      try {
        mapper.needCar();
        const { driveSpeed } = mapper.cfg();
        const ms = Math.max(200, Math.min(3000, Math.round((Number(b.seconds) || 1) * 1000)));
        const r = await robot.runPlan([{ type: 'drive', left: driveSpeed, right: driveSpeed, ms }, { type: 'stop' }], 'pc');
        return send(res, 200, { ok: !!r.completed, ms, speed: driveSpeed });
      } catch (e) { return send(res, 200, { error: e.message }); }
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
    // Missions (blocks / teach & repeat)
    if (p === '/api/robot/missions' && m === 'GET') return send(res, 200, { missions: missions.list(), running: !!missions.running, teaching: !!missions.teach });
    if (p.startsWith('/api/robot/missions/') && m === 'POST') {
      const what = p.slice('/api/robot/missions/'.length), b = await readJson(req);
      try {
        if (what === 'get') { const x = missions.get(b.name); return send(res, 200, x || { error: 'not found' }); }
        if (what === 'save') return send(res, 200, { ok: true, mission: missions.save(b.name, { kind: 'blocks', program: b.program, blocks: b.blocks }) });
        if (what === 'delete') return send(res, 200, missions.remove(b.name));
        if (what === 'stop') return send(res, 200, missions.stop('STOP pressed'));
        if (what === 'teach') return send(res, 200, b.action === 'start' ? missions.teachStart() : { ok: true, mission: missions.teachStop(b.name) });
        if (what === 'run') {
          const prog = b.program || (missions.get(b.name) || {}).program;
          if (!prog) return send(res, 200, { error: 'Mission not found.' });
          if (missions.running) return send(res, 200, { error: 'A mission is already running.' });
          missions.run(prog, { name: b.name || 'mission' }).then((r) => emit('robot:mission', { done: true, ...r })).catch(() => {});
          return send(res, 200, { ok: true, started: true });
        }
      } catch (e) { return send(res, 200, { error: e.message }); }
      return send(res, 404, { error: 'not found' });
    }
    if (p === '/api/robot/goto-point' && m === 'POST') {
      const b = await readJson(req);
      try { robot.stop('go there'); return send(res, 200, await mapper.gotoPoint(Number(b.x), Number(b.y), { source: 'plan view' })); } catch (e) { return send(res, 200, { error: e.message }); }
    }
    // 🗺 Map: the room map the car learns, places, put the robot somewhere, go / patrol / explore
    if (p === '/api/robot/roommap' && m === 'GET') return send(res, 200, roommap.view());
    if (p.startsWith('/api/robot/roommap/') && m === 'POST') {
      const what = p.slice('/api/robot/roommap/'.length), b = await readJson(req);
      const bg = (job) => { job.then((r) => emit('robot:roommap', { result: r })).catch((e) => emit('robot:roommap', { result: { ok: false, text: e.message === 'stopped' ? 'Stopped.' : e.message } })); return send(res, 200, { ok: true, started: true }); };
      try {
        if (what === 'place') return send(res, 200, { ok: true, places: roommap.addPlace(b.name, b.x, b.y) });
        if (what === 'unplace') return send(res, 200, { ok: true, places: roommap.removePlace(b.name) });
        if (what === 'pose') return send(res, 200, { ok: true, pose: roommap.setPose(b.x, b.y, b.heading) });
        if (what === 'plan') return send(res, 200, { ok: true, route: roommap.plan(b.x, b.y) });
        if (what === 'reset') { roommap.reset(); return send(res, 200, { ok: true }); }
        if (what === 'stop') { roommap.stop(); missions.stop('STOP pressed'); return send(res, 200, { ok: true }); }
        mapper.needCar();
        if (roommap.busy) return send(res, 200, { error: `The car is busy: ${roommap.busy}. Press ■ Stop first.` });
        if (what === 'goto') { roommap.plan(b.x, b.y); return bg(roommap.goTo(b.x, b.y, b.label)); }
        if (what === 'gotoplace') return bg(roommap.goToPlace(b.name));
        if (what === 'find') return bg(roommap.find(b.name));
        if (what === 'patrol') return bg(roommap.patrol(b.points, b.loops));
        if (what === 'measure') return bg(roommap.measureHere());
        if (what === 'explore') return bg(roommap.explore(b.rounds));
      } catch (e) { return send(res, 200, { error: e.message }); }
      return send(res, 404, { error: 'not found' });
    }
    if (p === '/api/robot/pose' && m === 'POST') { const b = await readJson(req); if (b.reset) robot.resetPose(); return send(res, 200, { ok: true, pose: robot.pose }); }
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
      return sendFile(res, f, f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : f.endsWith('.json') ? 'application/json' : 'image/jpeg');
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
      if (url.pathname === '/avatar/hello') return send(res, 200, { app: 'Muse Carpathron', name: 'Muse Carpathron', /* 'app' is checked by the Quest app 1.1.x: keep */ version: require('../package.json').version, linked: !!avatarAuthed(req) });
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
            const answer = String(r.content || '').trim();
            emit('robot:say', { text: answer.replace(/[*_`#>]/g, '').slice(0, 400), by: 'muse' });
            return send(res, 200, { answer, photo: ph.path });
          }
          if (url.pathname === '/avatar/voice' && req.method === 'POST') {
            const raw = await readBody(req, 12 * 1024 * 1024);
            const s = store.settings;
            const heard = await voice.transcribe(raw, { apiKey: s.apiKey, apiBase: s.apiBase, mime: 'audio/wav' });
            if (!heard) return send(res, 200, { heard: '', replies: ['I did not hear any words.'] });
            const cmd = voice.voiceToCommand(heard);
            const replies = [];
            if (cmd === '/robot stop') robot.stop('quest');
            // 2.2.5: what you said in the headset and the robot's answers are also spoken by the PC speakers
            emit('robot:say', { text: heard, by: 'you' });
            await wa.handle('quest', 'avatar', cmd || heard, async (t) => { if (!/^⏳ Working on it/.test(t)) { replies.push(String(t)); emit('robot:say', { text: String(t).replace(/[*_`#>]/g, '').slice(0, 400), by: 'muse' }); } }, async () => {});
            logFn(`Quest voice: "${heard}"${cmd ? ` → ${cmd}` : ''}`);
            return send(res, 200, { heard, command: cmd, replies });
          }
          // ---- 2.3: Carpathron the companion (mixed reality on Quest 3): the headset camera, talking, tasks
          // 2.3.2: the linked headset copies the Meta API key so it can also work on its own (standalone)
          if (url.pathname === '/avatar/apikey' && req.method === 'GET') {
            const s = store.settings;
            if (!s.apiKey) return send(res, 200, { error: 'No Meta API key in Muse Carpathron (Settings)' });
            logFn(`The headset ${who.name || 'Quest'} copied the Meta API key (to use Meta's models on its own)`);
            return send(res, 200, { key: s.apiKey, model: s.model });
          }
          if (url.pathname === '/avatar/eyes' && req.method === 'POST') {
            const jpg = await readBody(req, 2 * 1024 * 1024);
            if (jpg.length > 200 && jpg[0] === 0xff && jpg[1] === 0xd8) {
              if (url.searchParams.get('src') === 'car') Object.assign(carEyes, { last: jpg, at: Date.now() });
              else Object.assign(roomEyes, { last: jpg, at: Date.now(), id: Number(url.searchParams.get('id')) || 0 });
            }
            return send(res, 200, { ok: true });
          }
          if (url.pathname === '/avatar/companion' && req.method === 'POST') {
            const mode = url.searchParams.get('mode') === 'real' ? 'real' : 'demo';
            const guide = url.searchParams.get('guide') === '1';
            const t0 = Date.now();
            let text = '';
            if (String(req.headers['content-type'] || '').startsWith('audio/')) {
              const raw = await readBody(req, 12 * 1024 * 1024);
              const s = store.settings;
              text = await voice.transcribe(raw, { apiKey: s.apiKey, apiBase: s.apiBase, mime: 'audio/wav' });
              if (!text) return send(res, 200, { heard: '', say: "Sorry, I didn't catch that.", action: 'none', mood: 'sorry' });
            } else text = String((await readJson(req)).text || '');
            const sttMs = Date.now() - t0;
            if (voice.voiceToCommand(text) === '/robot stop') { roommap.stop('Quest'); missions.stop('Quest'); robot.stop('Quest'); }
            // the companion's natural voice; the first sentence is made while the model is still writing the rest
            const cv = tts && (tts.ready(tts.companionVoiceId(), true) ? tts.companionVoiceId() : tts.voiceId());
            const canSpeak = !!(tts && tts.ready(cv, true));
            // a new turn: the rest of the previous answer is not spoken any more (it would delay this one)
            const gen = ++companionGen;
            const say1 = (t, id) => (gen === companionGen ? tts.speak(t, { voice: cv, id, fast: true, rate: 1.05 }) : Promise.resolve());
            const newId = () => require('crypto').randomBytes(6).toString('hex');
            let first = null;
            const onFirst = canSpeak ? (t) => { const id = newId(); const job = say1(t, id).catch((e) => { logFn(`Companion voice: ${e.message}`); }); speechJobs.set(id, job); setTimeout(() => speechJobs.delete(id), 120000).unref(); first = { text: t, id, job }; } : null;
            const out = await companion.turn({ text, mode, guide, onFirst });
            const pk = `${cv}|${out.say}`, cached = out.quick && phraseCache.get(pk);
            if (cached && tts.file(`${cached}.wav`)) { fs.utimesSync(tts.file(`${cached}.wav`), new Date(), new Date()); out.audio = [`/avatar/speech/${cached}.wav`]; }
            else if (canSpeak && out.say) {
              let rest = String(out.say), ids = [];
              if (first && rest.startsWith(first.text)) { ids.push(first.id); rest = rest.slice(first.text.length).trim(); }
              const parts = [];
              for (const sn of rest ? rest.split(/(?<=[.!?…])\s+/) : []) { if (parts.length && (parts[parts.length - 1] + ' ' + sn).length < 80) parts[parts.length - 1] += ' ' + sn; else parts.push(sn); }
              let chain = ids.length ? first.job : Promise.resolve();
              for (const part of parts) { const id = newId(); ids.push(id); chain = chain.then(() => say1(part, id)).catch((e) => { logFn(`Companion voice: ${e.message}`); }); speechJobs.set(id, chain); setTimeout(() => speechJobs.delete(id), 120000).unref(); }
              await speechJobs.get(ids[0]);
              if (tts.file(`${ids[0]}.wav`)) { out.audio = ids.map((id) => `/avatar/speech/${id}.wav`); if (out.quick && ids.length === 1) phraseCache.set(pk, ids[0]); }
            }
            out.ms = { ...(out.ms || {}), stt: sttMs, total: Date.now() - t0 };
            logFn(`Companion timing: heard ${sttMs} ms, thought ${out.ms.llm || 0} ms${out.ms.picture ? ' (with picture)' : ''}, first words ready ${out.ms.total} ms`);
            return send(res, 200, { heard: text, ...out });
          }
          if (url.pathname.startsWith('/avatar/speech/') && req.method === 'GET') {
            const nm = url.pathname.slice('/avatar/speech/'.length), job = speechJobs.get(nm.replace(/\.wav$/, ''));
            if (job) await Promise.race([job, new Promise((r) => setTimeout(r, 30000))]);
            const f = tts.file(nm);
            if (!f) return send(res, 404, { error: 'gone' });
            const b = fs.readFileSync(f);
            res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
            return res.end(b);
          }
          if (url.pathname === '/avatar/look' && req.method === 'POST') {
            const b = await readJson(req);
            const ph = await mapper.look(b.direction || 'back', { source: 'quest' });
            return send(res, 200, { ok: true, path: ph.path });
          }
          // ---- 2.2.5: the car's video through this PC (one shared camera connection = steady picture) and the
          // headset's own view, sent here so Muse shows (and you can record) what the Quest user sees
          if (url.pathname === '/avatar/stream' && req.method === 'GET') return robot.pipeStream(res);
          if (url.pathname === '/avatar/view' && req.method === 'POST') {
            const jpg = await readBody(req, 1024 * 1024);
            if (jpg.length > 200 && jpg[0] === 0xff && jpg[1] === 0xd8) questView.push(jpg, url.searchParams.get('mode') || '');
            return send(res, 200, { ok: true, watchers: questView.clients.size });
          }
          // ---- Carpathron Avatar 1.2: the room map, the car's state and missions from the headset
          if (url.pathname === '/avatar/state' && req.method === 'GET') {
            const wv = url.searchParams.get('vision');
            if (wv === '1' || wv === 'both') { liveVision.wantedAt = Date.now(); companion.realAt = Date.now(); }
            if (wv === 'room' || wv === 'both') roomVision.wantedAt = Date.now();
            const v = roommap.view();
            return send(res, 200, { pose: robot.pose, busy: v.busy || (mapper.busy ? 'scanning with photos' : null), news: mapNews.text, newsAt: mapNews.at, sensors: (robot.info && robot.info.sensors) || null,
              // 2.2.5: the car this PC drives, so the headset can list it even when its own Wi-Fi search misses it
              seen: liveVision.seen, seenAt: liveVision.at, seenAgoMs: liveVision.at ? Date.now() - liveVision.at : -1, seenSrc: 'car',
              room: { seen: roomVision.seen, at: roomVision.at, frame: roomVision.frame, agoMs: roomVision.at ? Date.now() - roomVision.at : -1, ms: roomVision.ms || 0 },
              companion: { busy: companion.busy, task: companion.task, say: companionSayMsg && Date.now() - companionSayMsg.id < 30000 ? companionSayMsg : null },
              car: store.settings.robot.carIp ? { ip: String(store.settings.robot.carIp), name: (robot.info && robot.info.name) || 'Baby Carpathron', online: robot.state === 'online' } : null,
              targets: [...v.places.map((p) => ({ name: p.name, kind: 'place' })), ...v.objects.map((o) => ({ name: o.name, kind: 'object' }))].filter((t, i, l) => l.findIndex((q) => q.name.toLowerCase() === t.name.toLowerCase()) === i) });
          }
          if (url.pathname === '/avatar/map' && req.method === 'GET') {
            // the known part of the grid only (a crop), as bytes: -100 free … +100 solid, 0 not seen
            const g = roommap.grid, N = g.v.length, S = Math.round(Math.sqrt(N));
            let i0 = S, j0 = S, i1 = -1, j1 = -1;
            for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (g.v[j * S + i]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
            const v = roommap.view();
            if (i1 < 0) return send(res, 200, { empty: true, res: v.res, pose: robot.pose, places: v.places, objects: v.objects, hazards: v.hazards });
            i0 = Math.max(0, i0 - 2); j0 = Math.max(0, j0 - 2); i1 = Math.min(S - 1, i1 + 2); j1 = Math.min(S - 1, j1 + 2);
            const w = i1 - i0 + 1, h = j1 - j0 + 1, crop = Buffer.alloc(w * h);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) crop[j * w + i] = g.v[(j + j0) * S + i + i0] & 255;
            return send(res, 200, { res: v.res, half: S / 2, i0, j0, w, h, cells: crop.toString('base64'), pose: robot.pose, places: v.places, objects: v.objects, hazards: v.hazards, route: v.route });
          }
          if (url.pathname === '/avatar/mission' && req.method === 'POST') {
            const b = await readJson(req), a = String(b.action || '');
            if (a === 'stop') { roommap.stop('Quest'); missions.stop('Quest'); robot.stop('Quest'); return send(res, 200, { ok: true, text: 'Stopped.' }); }
            if (roommap.busy || mapper.busy) return send(res, 200, { error: `The car is busy: ${roommap.busy || 'scanning'}. Press A or X to stop it first.` });
            mapper.needCar();
            const bg = (job, what) => { Object.assign(mapNews, { text: `⏳ ${what}…`, at: Date.now(), done: null }); job.then((r) => emit('robot:roommap', { result: r })).catch((e) => emit('robot:roommap', { result: { ok: false, text: e.message === 'stopped' ? 'Stopped.' : e.message } })); return send(res, 200, { ok: true, text: `${what}…` }); };
            if (a === 'explore') return bg(roommap.explore(Number(b.rounds) || 6), 'Exploring the room');
            if (a === 'measure') return bg(roommap.measureHere(), 'Measuring all around');
            if (a === 'find') { if (!b.name) return send(res, 200, { error: 'What should the car find?' }); return bg(roommap.find(String(b.name)), `Finding the ${b.name}`); }
            if (a === 'scan') { Object.assign(mapNews, { text: '⏳ Scanning with photos…', at: Date.now(), done: null }); mapper.scan({ source: 'quest' }).then((r) => Object.assign(mapNews, { text: `✓ Scan done: ${String(r.summary || '').slice(0, 140)}`, at: Date.now() })).catch((e) => emit('robot:scan', { text: `Scan failed: ${e.message}`, error: true })); return send(res, 200, { ok: true, text: 'Scanning with photos…' }); }
            return send(res, 200, { error: 'unknown mission' });
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
          return send(res, 403, { error: 'Wrong PIN. Check the PIN shown in Muse Carpathron on the PC.' });
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
        if (!authed(req, url)) return send(res, 401, { error: 'Not authorized. Open the link shown in Muse Carpathron → Settings → Phone & Quest.' });
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
  const listenWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname === '/avatar/listen') {
      // the Quest companion's realtime speech to text (linked headsets only)
      if (!avatarAuthed(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
      return listenWss.handleUpgrade(req, socket, head, (ws) => voice.relayRealtime(ws, { apiKey: store.settings.apiKey, apiBase: store.settings.apiBase, log: logFn }));
    }
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
  logFn(`Muse Carpathron server on https://localhost:${port}`);

  return {
    port,
    token: token(),
    store, agent, robot, mcp, wa, memory, projects, skills, camera, remote, jobs, github, shield, ollama,
    async close() {
      for (const c of clients) try { c.close(); } catch {}
      wss.close();
      await new Promise((r) => front.close(r));
      server.close(); redirect.close();
      robot.close();
      tts.close();
      roommap.close();
      if (practice) practice.close();
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
