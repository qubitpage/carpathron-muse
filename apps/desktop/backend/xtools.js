// Extra agent tools: remote servers (SSH), documents and PDFs, page screenshots, web search and deep research,
// Arduino / firmware, background jobs, and the non-chat Meta models (Muse Image, SAM 3.1, Muse Voice).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const render = require('./render');
const { mimeOf } = require('./models');

const IS_WIN = process.platform === 'win32';
const clip = (s, n = 30000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} characters]` : s; };
const resolveLocal = (ws, p) => (!p ? ws : path.resolve(ws, String(p).replace(/^~(?=$|[\\/])/, os.homedir())));

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const XTOOLS = [
  // ---------- remote servers
  { name: 'ssh_servers', risk: 'read', description: 'List the saved remote servers (VPS / dedicated) you can work on over SSH, with their OS and whether they are connected.', parameters: obj({}) },
  { name: 'ssh_exec', risk: 'exec', description: 'Run a command on a saved remote server over SSH (bash on Linux, PowerShell on Windows servers) and return the output. The connection stays open between calls. Use for installing packages, git, builds, docker, systemctl, logs…', parameters: obj({ server: { type: 'string', description: 'server name (from ssh_servers)' }, command: { type: 'string' }, cwd: { type: 'string', description: 'folder on the server' }, timeout_seconds: { type: 'integer', description: 'default 120, max 3600' } }, ['server', 'command']) },
  { name: 'ssh_shell', risk: 'exec', description: 'Interactive terminal on a remote server that stays open (for programs that ask questions, REPLs, sudo prompts, top, tail -f, editors). action=start returns a shell_id; action=send types input (add {ctrl-c}, {enter}, {tab} if needed) and returns new output; action=read waits for more output; action=close ends it.', parameters: obj({ server: { type: 'string' }, action: { type: 'string', enum: ['start', 'send', 'read', 'close', 'list'] }, shell_id: { type: 'string' }, input: { type: 'string' }, wait_ms: { type: 'integer', description: 'how long to wait for output (default 1500, max 120000)' } }, ['action']) },
  { name: 'ssh_upload', risk: 'write', description: 'Copy a file or folder from this PC to a remote server (SFTP). Folders are copied recursively without node_modules/.git.', parameters: obj({ server: { type: 'string' }, local_path: { type: 'string' }, remote_path: { type: 'string' } }, ['server', 'local_path', 'remote_path']) },
  { name: 'ssh_download', risk: 'write', description: 'Copy a file from a remote server to this PC (SFTP).', parameters: obj({ server: { type: 'string' }, remote_path: { type: 'string' }, local_path: { type: 'string' } }, ['server', 'remote_path', 'local_path']) },
  { name: 'ssh_save_server', risk: 'write', description: 'Save a remote server (only when the user gives you the details). Credentials are stored encrypted on this PC.', parameters: obj({ name: { type: 'string' }, host: { type: 'string' }, port: { type: 'integer' }, username: { type: 'string' }, password: { type: 'string' }, private_key_path: { type: 'string' }, default_path: { type: 'string' } }, ['host', 'username']) },
  // ---------- documents
  { name: 'read_document', risk: 'read', description: 'Read a document and return its text: PDF (with page numbers), Word .docx, Excel .xlsx/.xls/.csv/.ods (every sheet as a table), PowerPoint .pptx (text per slide), HTML, Markdown, code. For images use view_image.', parameters: obj({ path: { type: 'string' }, pages: { type: 'string', description: 'PDF pages, e.g. "1-5" or "3,7"' }, max_chars: { type: 'integer' } }, ['path']) },
  { name: 'view_image', risk: 'read', description: 'Look at an image file (PNG/JPG/WEBP), e.g. a design, a screenshot, a photo or a chart. The image is shown to you and to the user.', parameters: obj({ path: { type: 'string' } }, ['path']) },
  { name: 'create_pdf', risk: 'write', description: 'Create a PDF. Give html (a full designed HTML page with CSS — best for good-looking reports, flyers, invoices, CVs), or markdown, or source (path/URL of an .html or .md file). Uses Chromium print, so CSS @page, flex/grid, web fonts, images and SVG charts work. After creating it, check it with screenshot_page or read_document.', parameters: obj({ output_path: { type: 'string' }, html: { type: 'string' }, markdown: { type: 'string' }, source: { type: 'string' }, landscape: { type: 'boolean' }, page_size: { type: 'string', description: 'A4 (default), Letter, A3, A5, Legal, Tabloid' }, margins: { type: 'string', enum: ['default', 'none', 'minimum'] } }, ['output_path']) },
  { name: 'screenshot_page', risk: 'read', description: 'Open a web page, local HTML file or PDF-ready page in a hidden browser and take a screenshot you can see. Use it to check websites and designs you built (desktop and mobile widths) and fix what looks wrong.', parameters: obj({ target: { type: 'string', description: 'URL or local file path' }, width: { type: 'integer', description: '1366 desktop (default), 390 phone' }, height: { type: 'integer' }, full_page: { type: 'boolean' }, save_to: { type: 'string' } }, ['target']) },
  // ---------- web
  { name: 'web_search', risk: 'read', description: 'Search the web. Returns a short answer and a list of sources (title, URL, snippet). Then use web_fetch on the best sources for details.', parameters: obj({ query: { type: 'string' }, max_results: { type: 'integer' } }, ['query']) },
  { name: 'deep_research', risk: 'read', description: 'Deep research on a question: plans several searches, reads many sources and writes a cited Markdown report saved in the workspace. Takes 1-5 minutes. Use for market research, comparisons, technical state of the art, prices, regulations.', parameters: obj({ question: { type: 'string' }, depth: { type: 'string', enum: ['quick', 'standard', 'deep'] }, output_path: { type: 'string' } }, ['question']) },
  // ---------- background jobs
  { name: 'job_start', risk: 'exec', description: 'Start a long-running command in the background (dev server, build, training, watcher) on this PC or on a remote server. Returns a job id; check it with job_output, stop it with job_stop.', parameters: obj({ command: { type: 'string' }, cwd: { type: 'string' }, server: { type: 'string', description: 'optional remote server name' } }, ['command']) },
  { name: 'job_output', risk: 'read', description: 'Show the latest output of a background job (and whether it is still running). Without job_id lists all jobs.', parameters: obj({ job_id: { type: 'string' }, tail_lines: { type: 'integer' } }) },
  { name: 'job_stop', risk: 'exec', description: 'Stop a background job.', parameters: obj({ job_id: { type: 'string' } }, ['job_id']) },
  // ---------- Arduino / firmware
  { name: 'arduino_setup', risk: 'exec', description: 'Prepare Arduino tooling: finds arduino-cli (from Arduino IDE 2 or installed) or downloads it, updates the board index and can install cores (e.g. "esp32:esp32", "arduino:avr", "rp2040:rp2040") and libraries.', parameters: obj({ cores: { type: 'array', items: { type: 'string' } }, libraries: { type: 'array', items: { type: 'string' } } }) },
  { name: 'arduino_boards', risk: 'read', description: 'List boards connected to this PC (serial ports, detected board names and FQBNs). With search, lists installable board FQBNs matching the text.', parameters: obj({ search: { type: 'string' } }) },
  { name: 'arduino_compile', risk: 'exec', description: 'Compile (build) an Arduino sketch folder with arduino-cli. Returns compiler errors with file:line so you can fix them. fqbn examples: esp32:esp32:esp32, esp32:esp32:esp32cam, esp32:esp32:esp32s3, arduino:avr:uno, arduino:avr:nano.', parameters: obj({ sketch_path: { type: 'string' }, fqbn: { type: 'string' }, export_binaries: { type: 'boolean' }, build_properties: { type: 'array', items: { type: 'string' } } }, ['sketch_path', 'fqbn']) },
  { name: 'arduino_upload', risk: 'exec', description: 'Compile and flash (upload) a sketch to a board on a serial port (e.g. COM5). Hardware action: the board resets.', parameters: obj({ sketch_path: { type: 'string' }, fqbn: { type: 'string' }, port: { type: 'string' } }, ['sketch_path', 'fqbn', 'port']) },
  { name: 'serial_monitor', risk: 'exec', description: 'Read the serial output of a board for some seconds (and optionally send a line first). Use to see boot logs, IP addresses, debug prints.', parameters: obj({ port: { type: 'string' }, baud: { type: 'integer', description: 'default 115200' }, seconds: { type: 'integer', description: 'default 8, max 120' }, send: { type: 'string' } }, ['port']) },
  { name: 'arduino_cli', risk: 'exec', description: 'Run any arduino-cli command (arguments only, e.g. "lib search FastLED", "core list", "board details -b esp32:esp32:esp32").', parameters: obj({ args: { type: 'string' } }, ['args']) },
  { name: 'open_arduino_ide', risk: 'exec', description: 'Open the Arduino IDE on this PC, optionally with a sketch, so the user can see or edit it.', parameters: obj({ path: { type: 'string' } }) },
  // ---------- Meta media models
  { name: 'generate_image', risk: 'write', description: 'Create an image with Muse Image (logos, product renders, illustrations, website hero images, UI mockups) or edit existing images (give edit_images). Saves PNG/JPG/WEBP to output_path and shows it.', parameters: obj({ prompt: { type: 'string' }, output_path: { type: 'string' }, size: { type: 'string', description: 'aspect, e.g. 1024x1024, 1792x1024, 1024x1792' }, edit_images: { type: 'array', items: { type: 'string' } } }, ['prompt', 'output_path']) },
  { name: 'segment_image', risk: 'read', description: 'Find objects in an image or short video with SAM 3.1 (Segment Anything). prompt = what to find ("person", "red box", "cable"). Returns boxes (pixels) with confidence and saves an overlay picture you can see. Good for robot vision: where is the object, how many, how big.', parameters: obj({ path: { type: 'string', description: 'image/video file; "robot" = take a robot photo now' }, prompt: { type: 'string' }, output_path: { type: 'string' } }, ['path', 'prompt']) },
  { name: 'transcribe_audio', risk: 'read', description: 'Turn speech in a WAV or OGG/Opus audio file into text (Muse Voice Transcribe).', parameters: obj({ path: { type: 'string' } }, ['path']) },
];

// ------------------------------------------------------------------ documents
function parseRanges(spec, max) {
  if (!spec) return null;
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    for (let i = Math.max(1, a); i <= Math.min(max, b); i++) out.add(i);
  }
  return out.size ? out : null;
}

async function readDocument(file, { pages, maxChars = 60000 } = {}) {
  const ext = path.extname(file).toLowerCase();
  const st = await fsp.stat(file);
  if (st.isDirectory()) throw new Error(`${file} is a folder`);
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(await fsp.readFile(file)));
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    const want = parseRanges(pages, totalPages);
    const parts = text.map((t, i) => (want && !want.has(i + 1) ? null : `--- page ${i + 1} / ${totalPages} ---\n${t.trim()}`)).filter(Boolean);
    const all = parts.join('\n\n');
    return clip(`PDF, ${totalPages} pages${all.trim().length < 20 * totalPages ? ' (little text: it may be scanned images — screenshot or view it instead)' : ''}\n\n${all}`, maxChars);
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.convertToMarkdown({ path: file }).catch(() => mammoth.extractRawText({ path: file }));
    return clip(`Word document\n\n${r.value || ''}`, maxChars);
  }
  if (['.xlsx', '.xlsm', '.xls', '.ods', '.csv'].includes(ext)) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(await fsp.readFile(file), { type: 'buffer', cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) {
      const sh = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sh, { blankrows: false });
      const rows = csv.split('\n');
      out.push(`### Sheet "${name}" (${rows.length} rows${sh['!ref'] ? ', range ' + sh['!ref'] : ''})\n${rows.slice(0, 400).join('\n')}${rows.length > 400 ? `\n… ${rows.length - 400} more rows` : ''}`);
      const formulas = Object.entries(sh).filter(([k, c]) => !k.startsWith('!') && c && c.f).slice(0, 40).map(([k, c]) => `${k}: =${c.f}`);
      if (formulas.length) out.push(`Formulas (first ${formulas.length}): ${formulas.join('; ')}`);
    }
    return clip(`Spreadsheet with ${wb.SheetNames.length} sheet(s)\n\n${out.join('\n\n')}`, maxChars);
  }
  if (ext === '.pptx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(await fsp.readFile(file));
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/g).pop()) - Number(b.match(/\d+/g).pop()));
    const out = [];
    for (const [i, n] of slides.entries()) {
      const xml = await zip.file(n).async('string');
      const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      out.push(`--- slide ${i + 1} ---\n${text}`);
    }
    return clip(`PowerPoint, ${slides.length} slides\n\n${out.join('\n')}`, maxChars);
  }
  if (/^\.(png|jpe?g|webp|gif|bmp)$/.test(ext)) return `Image file (${st.size} bytes). Use view_image to look at it.`;
  const buf = await fsp.readFile(file);
  if (buf.subarray(0, 8000).includes(0)) return `Binary file (${st.size} bytes) of type ${ext || 'unknown'}; no text to show.`;
  let t = buf.toString('utf8');
  if (ext === '.html' || ext === '.htm') t = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ');
  return clip(t, maxChars);
}

// ------------------------------------------------------------------ web
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

async function ddgSearch(query, n = 8, signal) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let url = m[1].replace(/&amp;/g, '&');
    const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    if (/duckduckgo\.com\/y\.js|bing\.com\/aclick/.test(url)) continue;
    out.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3] || '') });
  }
  return out;
}

async function fetchText(url, signal, max = 9000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36 MuseCarpathron' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (/pdf/i.test(type)) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(doc, { mergePages: true });
    return clip(text, max);
  }
  const body = await res.text();
  return clip(/html/i.test(type) ? htmlToText(body) : body, max);
}

// ------------------------------------------------------------------ Arduino
const ARDUINO_ADDITIONAL = ['https://espressif.github.io/arduino-esp32/package_esp32_index.json', 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json'];
function arduinoCandidates(dataDir, explicit) {
  const exe = IS_WIN ? 'arduino-cli.exe' : 'arduino-cli';
  const pf = process.env.ProgramFiles || 'C:\\Program Files', la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const list = [explicit, path.join(dataDir, 'tools', 'arduino-cli', exe)];
  if (IS_WIN) {
    for (const base of [path.join(la, 'Programs', 'Arduino IDE'), path.join(pf, 'Arduino IDE'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Arduino IDE')]) {
      list.push(path.join(base, 'resources', 'app', 'lib', 'backend', 'resources', exe));
    }
  } else list.push('/usr/local/bin/arduino-cli', '/usr/bin/arduino-cli', path.join(os.homedir(), 'bin', 'arduino-cli'), '/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli');
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d) list.push(path.join(d, exe));
  return list.filter(Boolean);
}
function findArduinoCli(dataDir, explicit) { for (const c of arduinoCandidates(dataDir, explicit)) { try { if (fs.statSync(c).isFile()) return c; } catch {} } return ''; }
function findArduinoIde() {
  if (!IS_WIN) return '';
  const la = process.env.LOCALAPPDATA || '', pf = process.env.ProgramFiles || 'C:\\Program Files';
  for (const p of [path.join(la, 'Programs', 'Arduino IDE', 'Arduino IDE.exe'), path.join(pf, 'Arduino IDE', 'Arduino IDE.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Arduino', 'arduino.exe')]) { try { if (fs.statSync(p).isFile()) return p; } catch {} }
  return '';
}
function splitArgs(s) {
  const out = []; let cur = '', q = null, any = false;
  for (const ch of String(s)) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}
function runProc(cmd, args, { cwd, timeoutMs = 600000, signal, input, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, ...(env || {}) } }); }
    catch (e) { resolve({ code: -1, out: `Failed to start ${cmd}: ${e.message}` }); return; }
    let out = '';
    const add = (d) => { if (out.length < 400000) out += d.toString('utf8'); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const kill = () => { try { if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGKILL'); } catch {} };
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (input !== undefined) { try { child.stdin.write(input); } catch {} }
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out + `\n${e.message}` }); });
    child.on('close', (code) => { clearTimeout(t); signal?.removeEventListener('abort', onAbort); resolve({ code, out, timedOut, stopped: !!signal?.aborted }); });
  });
}

// ------------------------------------------------------------------ background jobs
class Jobs {
  constructor(dataDir) { this.dir = path.join(dataDir, 'jobs'); fs.mkdirSync(this.dir, { recursive: true }); this.jobs = new Map(); this.n = 0; }
  start(command, cwd) {
    const id = `job${++this.n}`;
    const log = path.join(this.dir, `${Date.now()}-${id}.log`);
    const fd = fs.openSync(log, 'a');
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { cwd, windowsHide: true, stdio: ['ignore', fd, fd] })
      : spawn('bash', ['-lc', command], { cwd, detached: true, stdio: ['ignore', fd, fd] });
    const j = { id, command, cwd, log, pid: child.pid, running: true, code: null, started: Date.now(), child };
    child.on('close', (code) => { j.running = false; j.code = code; try { fs.closeSync(fd); } catch {} });
    child.on('error', (e) => { j.running = false; j.code = -1; fs.appendFileSync(log, `\n${e.message}`); });
    this.jobs.set(id, j);
    return j;
  }
  addRemote(id, command, server, log, pid) { const j = { id, command, server, log, pid, running: true, remote: true, started: Date.now() }; this.jobs.set(id, j); return j; }
  nextId() { return `job${++this.n}`; }
  stop(id) {
    const j = this.jobs.get(id);
    if (!j || j.remote) return false;
    try { if (IS_WIN) spawn('taskkill', ['/pid', String(j.pid), '/T', '/F'], { windowsHide: true }); else process.kill(-j.pid, 'SIGKILL'); } catch {}
    return true;
  }
  stopAll() { for (const j of this.jobs.values()) if (j.running && !j.remote) this.stop(j.id); }
  tail(id, lines = 80) {
    const j = this.jobs.get(id);
    if (!j) throw new Error(`No job ${id}`);
    let txt = '';
    try { const st = fs.statSync(j.log); const fd = fs.openSync(j.log, 'r'); const len = Math.min(st.size, 200000); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd); txt = b.toString('utf8'); } catch {}
    return txt.split(/\r?\n/).slice(-lines).join('\n');
  }
}

// ------------------------------------------------------------------ executor
async function execX(name, args, ctx) {
  const ws = ctx.workspace;
  const { remote, media, signal } = ctx;
  const status = ctx.status || (() => {});
  switch (name) {
    // ---- SSH
    case 'ssh_servers': {
      const l = remote.publicList();
      if (!l.length) return 'No remote servers saved. The user can add them in Settings → Remote servers (or give you host, user and password/key and you call ssh_save_server).';
      return l.map((s) => `- ${s.name}: ${s.username}@${s.host}:${s.port} · ${s.os || 'os unknown'} · ${s.connected ? 'connected' : 'not connected'}${s.defaultPath ? ' · default folder ' + s.defaultPath : ''}`).join('\n');
    }
    case 'ssh_exec': {
      const t = Math.min(3600, Math.max(1, Number(args.timeout_seconds) || 120)) * 1000;
      const srv = remote.need(args.server || ctx.remoteServer);
      const cwd = args.cwd ? await remote.resolve(srv.id, args.cwd, ctx.remotePath) : (ctx.remoteServer === srv.id ? ctx.remotePath : srv.defaultPath) || undefined;
      return remote.exec(srv.id, String(args.command), { cwd, timeoutMs: t, signal });
    }
    case 'ssh_shell': {
      const a = String(args.action || 'list');
      if (a === 'list') { const l = remote.shellList(); return l.length ? l.map((s) => `${s.id} on ${s.server}${s.closed ? ' (closed)' : ''}`).join('\n') : 'No open shells.'; }
      if (a === 'start') {
        const id = await remote.shellStart(args.server || ctx.remoteServer);
        const first = await remote.shellRead(id, { waitMs: 1200, signal });
        if (args.input) return `shell_id: ${id}\n${first}\n${await remote.shellSend(id, args.input, { waitMs: Number(args.wait_ms) || 1500, signal })}`;
        return `shell_id: ${id}\n${first}`;
      }
      if (!args.shell_id) throw new Error('shell_id is required');
      if (a === 'send') return remote.shellSend(args.shell_id, args.input ?? '', { waitMs: Number(args.wait_ms) || 1500, signal });
      if (a === 'read') return remote.shellRead(args.shell_id, { waitMs: Number(args.wait_ms) || 1500, signal });
      if (a === 'close') return remote.shellClose(args.shell_id) ? 'Closed.' : 'No such shell.';
      throw new Error(`Unknown action ${a}`);
    }
    case 'ssh_upload': {
      const srv = remote.need(args.server || ctx.remoteServer);
      return remote.upload(srv.id, resolveLocal(ws, args.local_path), await remote.resolve(srv.id, args.remote_path, srv.defaultPath));
    }
    case 'ssh_download': {
      const srv = remote.need(args.server || ctx.remoteServer);
      return remote.download(srv.id, await remote.resolve(srv.id, args.remote_path, srv.defaultPath), resolveLocal(ws, args.local_path));
    }
    case 'ssh_save_server': {
      const s = remote.save({ name: args.name, host: args.host, port: args.port, username: args.username, password: args.password, keyPath: args.private_key_path, defaultPath: args.default_path });
      try { const t = await remote.test(s.id); return `Saved and connected to ${s.name} (${t.os}).\n${t.output}`; }
      catch (e) { return `Saved ${s.name}, but connecting failed: ${e.message}`; }
    }
    // ---- documents
    case 'read_document': {
      if (ctx.remoteServer && !path.isAbsolute(String(args.path)) && !/^[a-z]:/i.test(String(args.path))) {
        const rp = await remote.resolve(ctx.remoteServer, args.path, ctx.remotePath);
        const tmp = path.join(os.tmpdir(), `mc-doc-${Date.now()}${path.posix.extname(rp)}`);
        await remote.download(ctx.remoteServer, rp, tmp);
        try { return await readDocument(tmp, { pages: args.pages, maxChars: Number(args.max_chars) || 60000 }); } finally { fsp.unlink(tmp).catch(() => {}); }
      }
      return readDocument(resolveLocal(ws, args.path), { pages: args.pages, maxChars: Number(args.max_chars) || 60000 });
    }
    case 'view_image': {
      const f = resolveLocal(ws, args.path);
      const buf = await fsp.readFile(f);
      if (buf.length > 15 * 1024 * 1024) throw new Error('Image is larger than 15 MB');
      ctx.onPhoto?.({ path: f, buffer: buf, source: path.basename(f), mime: mimeOf(f), media: true });
      return `Showing ${f} (${buf.length} bytes).`;
    }
    case 'create_pdf': {
      const output = resolveLocal(ws, args.output_path);
      status(`Making PDF ${path.basename(output)}…`);
      const html = args.html || (args.markdown ? render.markdownToHtml(args.markdown, path.basename(output, '.pdf')) : undefined);
      const r = await render.toPdf({ html, source: args.source ? (/^https?:/i.test(args.source) ? args.source : resolveLocal(ws, args.source)) : undefined, output, landscape: !!args.landscape, pageSize: args.page_size || 'A4', margins: args.margins || 'default' });
      let pages = '?';
      try { const { getDocumentProxy } = await import('unpdf'); pages = (await getDocumentProxy(new Uint8Array(fs.readFileSync(output)))).numPages; } catch {}
      return `PDF created: ${r.output} (${pages} pages, ${Math.round(r.bytes / 1024)} KB). Check the layout with screenshot_page on the HTML source if needed.`;
    }
    case 'screenshot_page': {
      const target = /^(https?|file|data):/i.test(String(args.target)) ? String(args.target) : resolveLocal(ws, args.target);
      status(`Taking a screenshot of ${String(args.target).slice(0, 80)}…`);
      const save = args.save_to ? resolveLocal(ws, args.save_to) : path.join(ctx.dataDir, 'media', `shot-${Date.now()}.png`);
      const r = await render.screenshot({ target, width: Number(args.width) || 1366, height: Number(args.height) || 900, fullPage: args.full_page !== false, output: save });
      ctx.onPhoto?.({ path: save, buffer: r.jpeg, source: 'screenshot', mime: 'image/jpeg', media: true });
      return `Screenshot ${r.size.width}×${r.size.height} saved to ${save}. You can see it now.`;
    }
    // ---- web
    case 'web_search': {
      const n = Math.max(1, Math.min(15, Number(args.max_results) || 8));
      let answer = '', sources = [];
      if (media && ctx.settings.apiKey && ctx.settings.webSearch !== 'duckduckgo') {
        try { const r = await media.search({ query: String(args.query), signal }); answer = r.answer; sources = r.sources; }
        catch (e) { answer = `(Meta search grounding not available: ${e.message.slice(0, 160)})`; }
      }
      if (sources.length < 3) { try { sources = sources.concat(await ddgSearch(String(args.query), n, signal)); } catch (e) { if (!sources.length) throw new Error(`Web search failed: ${e.message}`); } }
      const seen = new Set();
      sources = sources.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, n);
      return `${answer ? `Answer (from search):\n${clip(answer, 4000)}\n\n` : ''}Sources:\n${sources.map((s, i) => `[${i + 1}] ${s.title}\n${s.url}${s.snippet ? `\n${s.snippet}` : ''}`).join('\n\n') || '(none)'}`;
    }
    case 'deep_research': return deepResearch(args, ctx);
    // ---- jobs
    case 'job_start': {
      if (args.server || ctx.remoteServer) {
        const srv = remote.need(args.server || ctx.remoteServer);
        const id = ctx.jobs.nextId();
        const log = `/tmp/muse-${id}-${Date.now()}.log`;
        const cwd = args.cwd ? await remote.resolve(srv.id, args.cwd, ctx.remotePath) : (ctx.remotePath || srv.defaultPath || '');
        const out = await remote.exec(srv.id, `nohup bash -lc ${JSON.stringify(String(args.command))} > ${log} 2>&1 & echo PID=$!`, { cwd: cwd || undefined, timeoutMs: 30000 });
        const pid = (out.match(/PID=(\d+)/) || [])[1];
        ctx.jobs.addRemote(id, args.command, srv.id, log, pid);
        return `Started ${id} on ${srv.name} (pid ${pid || '?'}, log ${log}). Use job_output to watch it.`;
      }
      const j = ctx.jobs.start(String(args.command), resolveLocal(ws, args.cwd));
      await new Promise((r) => setTimeout(r, 1500));
      return `Started ${j.id} (pid ${j.pid}). First output:\n${ctx.jobs.tail(j.id, 30) || '(nothing yet)'}${j.running ? '' : `\n[already exited with code ${j.code}]`}`;
    }
    case 'job_output': {
      if (!args.job_id) { const l = [...ctx.jobs.jobs.values()]; return l.length ? l.map((j) => `${j.id}: ${j.running ? 'running' : `exited ${j.code}`} · ${j.command.slice(0, 120)}${j.server ? ' · remote' : ''}`).join('\n') : 'No jobs.'; }
      const j = ctx.jobs.jobs.get(args.job_id);
      if (!j) throw new Error(`No job ${args.job_id}`);
      const lines = Math.max(5, Math.min(1000, Number(args.tail_lines) || 80));
      if (j.remote) return remote.exec(j.server, `tail -n ${lines} ${j.log}; kill -0 ${j.pid} 2>/dev/null && echo '[still running]' || echo '[finished]'`, { timeoutMs: 30000 });
      return `${ctx.jobs.tail(j.id, lines) || '(no output yet)'}\n[${j.running ? 'still running' : `exited with code ${j.code}`}]`;
    }
    case 'job_stop': {
      const j = ctx.jobs.jobs.get(args.job_id);
      if (!j) throw new Error(`No job ${args.job_id}`);
      if (j.remote) { await remote.exec(j.server, `kill ${j.pid} 2>/dev/null; sleep 1; kill -9 ${j.pid} 2>/dev/null; echo stopped`, { timeoutMs: 20000 }); j.running = false; return `Stopped ${j.id}.`; }
      ctx.jobs.stop(j.id); return `Stopped ${j.id}.`;
    }
    // ---- Arduino
    case 'arduino_setup': return arduinoSetup(args, ctx);
    case 'arduino_boards': {
      const cli = needCli(ctx);
      if (args.search) { const r = await runProc(cli, ['board', 'listall', String(args.search)], { timeoutMs: 60000, signal }); return clip(r.out); }
      const r = await runProc(cli, ['board', 'list', '--format', 'json'], { timeoutMs: 60000, signal });
      try {
        const j = JSON.parse(r.out);
        const ports = j.detected_ports || j.ports || j || [];
        const lines = ports.map((p) => { const port = p.port || p; const b = (p.matching_boards || p.boards || [])[0]; return `${port.address || port.label} (${port.protocol_label || port.protocol || ''})${b ? ` → ${b.name} [${b.fqbn}]` : ''}${port.properties && port.properties.vid ? ` vid ${port.properties.vid} pid ${port.properties.pid}` : ''}`; });
        return lines.length ? lines.join('\n') + '\nTip: ESP32 boards often show no name — use esp32:esp32:esp32 (or the exact module).' : 'No boards/serial ports found. Check the USB cable (data, not charge-only) and the driver (CP210x / CH340).';
      } catch { return clip(r.out); }
    }
    case 'arduino_compile': {
      const cli = needCli(ctx);
      const sketch = resolveLocal(ws, args.sketch_path);
      status(`Compiling ${path.basename(sketch)} for ${args.fqbn}…`);
      const a = ['compile', '--fqbn', String(args.fqbn), '--warnings', 'default'];
      if (args.export_binaries) a.push('--export-binaries');
      for (const bp of args.build_properties || []) a.push('--build-property', String(bp));
      a.push(sketch);
      const r = await runProc(cli, a, { timeoutMs: 900000, signal });
      return `${clip(r.out.trim(), 25000)}\n[${r.code === 0 ? 'BUILD OK' : `BUILD FAILED (exit ${r.code})`}]`;
    }
    case 'arduino_upload': {
      const cli = needCli(ctx);
      const sketch = resolveLocal(ws, args.sketch_path);
      status(`Flashing ${path.basename(sketch)} to ${args.port}…`);
      const r = await runProc(cli, ['compile', '--upload', '-p', String(args.port), '--fqbn', String(args.fqbn), sketch], { timeoutMs: 900000, signal });
      let hint = '';
      if (r.code !== 0 && /Failed to connect|Wrong boot mode|timed out waiting for packet/i.test(r.out)) hint = '\nHint (ESP32): hold the BOOT button while "Connecting…" appears, or lower the upload speed: build_properties / board option UploadSpeed=115200.';
      if (r.code !== 0 && /could not open port|Access is denied|busy/i.test(r.out)) hint = '\nHint: the port is used by another program (serial monitor, Arduino IDE, the car app). Close it and retry.';
      return `${clip(r.out.trim(), 25000)}\n[${r.code === 0 ? 'UPLOAD OK' : `UPLOAD FAILED (exit ${r.code})`}]${hint}`;
    }
    case 'serial_monitor': {
      const cli = needCli(ctx);
      const secs = Math.max(1, Math.min(120, Number(args.seconds) || 8));
      status(`Reading serial ${args.port} for ${secs}s…`);
      const r = await runProc(cli, ['monitor', '-p', String(args.port), '--config', `baudrate=${Number(args.baud) || 115200}`, '--quiet'], { timeoutMs: secs * 1000, signal, input: args.send ? `${args.send}\n` : undefined });
      return `${clip(r.out.trim() || '(no serial output in that time — wrong baud rate, or press the board RESET button)', 25000)}`;
    }
    case 'arduino_cli': {
      const cli = needCli(ctx);
      const r = await runProc(cli, splitArgs(args.args), { timeoutMs: 900000, signal, cwd: ws });
      return `${clip(r.out.trim(), 25000)}\n[exit ${r.code}]`;
    }
    case 'open_arduino_ide': {
      const ide = findArduinoIde();
      if (!ide) return 'Arduino IDE was not found on this PC. Install Arduino IDE 2 from arduino.cc, or use the arduino_* tools (they work without the IDE).';
      const a = args.path ? [resolveLocal(ws, args.path)] : [];
      spawn(ide, a, { detached: true, stdio: 'ignore' }).unref();
      return `Opened Arduino IDE${a.length ? ' with ' + a[0] : ''}.`;
    }
    // ---- media models
    case 'generate_image': {
      if (!media) throw new Error('not available');
      const out = resolveLocal(ws, args.output_path);
      status('Muse Image is drawing…');
      const fmt = /\.jpe?g$/i.test(out) ? 'jpeg' : /\.webp$/i.test(out) ? 'webp' : 'png';
      const inputs = (args.edit_images || []).map((p) => resolveLocal(ws, p));
      const r = await media.image({ prompt: args.prompt, inputs, size: args.size, format: fmt, signal });
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, r.images[0]);
      ctx.onPhoto?.({ path: out, buffer: r.images[0], source: 'Muse Image', mime: `image/${fmt === 'jpeg' ? 'jpeg' : fmt}`, media: true });
      return `Image saved to ${out} (${Math.round(r.images[0].length / 1024)} KB). You can see it.`;
    }
    case 'segment_image': {
      if (!media) throw new Error('not available');
      let file;
      if (String(args.path).toLowerCase() === 'robot') { const ph = await ctx.camera.capture(); file = ph.path; }
      else file = resolveLocal(ws, args.path);
      status(`SAM 3.1 is looking for "${args.prompt}"…`);
      const r = await media.segment({ file, prompt: args.prompt, signal });
      let overlay = '';
      if (r.boxes.length && render.available() && !/^video\//.test(mimeOf(file))) {
        const png = await render.overlayBoxes(file, r.boxes, r.boxes.map(() => args.prompt));
        if (png) {
          overlay = args.output_path ? resolveLocal(ws, args.output_path) : path.join(ctx.dataDir, 'media', `sam-${Date.now()}.png`);
          await fsp.mkdir(path.dirname(overlay), { recursive: true });
          await fsp.writeFile(overlay, png);
          ctx.onPhoto?.({ path: overlay, buffer: png, source: 'SAM 3.1', mime: 'image/png', media: true });
        }
      }
      const lines = r.boxes.map((b, i) => `#${i + 1}: box x ${b.x1}-${b.x2}, y ${b.y1}-${b.y2} of ${b.w}×${b.h} px (center ${Math.round((b.x1 + b.x2) / 2)},${Math.round((b.y1 + b.y2) / 2)}; ${Math.round(((b.x2 - b.x1) * (b.y2 - b.y1) * 100) / ((b.w || 1) * (b.h || 1)))}% of the picture)${b.conf != null ? `, confidence ${(b.conf * 100).toFixed(0)}%` : ''}`);
      return `${r.boxes.length} match(es) for "${args.prompt}" in ${path.basename(file)}${r.masks ? ` (${r.masks} masks)` : ''}.\n${lines.join('\n')}${overlay ? `\nOverlay saved: ${overlay}` : ''}`;
    }
    case 'transcribe_audio': {
      if (!media) throw new Error('not available');
      const t = await media.transcribe(resolveLocal(ws, args.path));
      return t ? `Transcript:\n${t}` : 'No speech found in the audio.';
    }
    default: return null;
  }
}

function needCli(ctx) {
  const cli = findArduinoCli(ctx.dataDir, ctx.settings.arduinoCli);
  if (!cli) throw new Error('arduino-cli not found. Run the arduino_setup tool first (it downloads arduino-cli), or install Arduino IDE 2.');
  return cli;
}

async function arduinoSetup(args, ctx) {
  const log = [];
  let cli = findArduinoCli(ctx.dataDir, ctx.settings.arduinoCli);
  if (!cli) {
    const dir = path.join(ctx.dataDir, 'tools', 'arduino-cli');
    fs.mkdirSync(dir, { recursive: true });
    const url = IS_WIN ? 'https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip' : `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Linux_${process.arch === 'arm64' ? 'ARM64' : '64bit'}.tar.gz`;
    ctx.status?.('Downloading arduino-cli…');
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} (${url})`);
    const archive = path.join(dir, IS_WIN ? 'cli.zip' : 'cli.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    const r = IS_WIN
      ? await runProc('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${dir}'`], { timeoutMs: 120000 })
      : await runProc('tar', ['-xzf', archive, '-C', dir], { timeoutMs: 120000 });
    fs.unlinkSync(archive);
    cli = findArduinoCli(ctx.dataDir);
    if (!cli) throw new Error(`Could not unpack arduino-cli: ${r.out}`);
    log.push(`Downloaded arduino-cli to ${cli}`);
  } else log.push(`Using arduino-cli: ${cli}`);
  const v = await runProc(cli, ['version'], { timeoutMs: 30000 }); log.push(v.out.trim());
  await runProc(cli, ['config', 'init'], { timeoutMs: 30000 });
  for (const u of ARDUINO_ADDITIONAL) await runProc(cli, ['config', 'add', 'board_manager.additional_urls', u], { timeoutMs: 30000 });
  ctx.status?.('Updating the board index…');
  const up = await runProc(cli, ['core', 'update-index'], { timeoutMs: 600000, signal: ctx.signal }); log.push(`core update-index: exit ${up.code}`);
  for (const core of args.cores || []) {
    ctx.status?.(`Installing core ${core} (can take several minutes)…`);
    const r = await runProc(cli, ['core', 'install', String(core)], { timeoutMs: 1800000, signal: ctx.signal });
    log.push(`core install ${core}: ${r.code === 0 ? 'OK' : `FAILED\n${clip(r.out, 3000)}`}`);
  }
  for (const lib of args.libraries || []) {
    const r = await runProc(cli, ['lib', 'install', String(lib)], { timeoutMs: 600000, signal: ctx.signal });
    log.push(`lib install ${lib}: ${r.code === 0 ? 'OK' : `FAILED\n${clip(r.out, 2000)}`}`);
  }
  const cores = await runProc(cli, ['core', 'list'], { timeoutMs: 60000 });
  log.push(`Installed cores:\n${cores.out.trim()}`);
  return log.join('\n');
}

// ------------------------------------------------------------------ deep research
async function deepResearch(args, ctx) {
  const { api, signal } = ctx;
  const q = String(args.question);
  const depth = args.depth || 'standard';
  const nQueries = { quick: 3, standard: 6, deep: 10 }[depth] || 6;
  const nPages = { quick: 5, standard: 10, deep: 18 }[depth] || 10;
  const s = ctx.settings;
  const model = s.researchModel || ctx.model || s.model;
  const canLLM = !!(api && s.apiKey);
  const status = ctx.status || (() => {});
  // 1) plan the searches
  let queries = [q];
  if (canLLM) {
    status('Research: planning searches…');
    try {
      const r = await api.complete({ model, signal, messages: [{ role: 'system', content: `Plan web research. Reply with JSON only: {"queries":[...]} — ${nQueries} diverse, specific search queries (different angles: facts, latest news ${new Date().getFullYear()}, prices/numbers, official sources, critics/limitations). Use the language that gives the best sources.` }, { role: 'user', content: q }] });
      const m = (r.content || '').match(/\{[\s\S]*\}/);
      const list = m ? JSON.parse(m[0]).queries : null;
      if (Array.isArray(list) && list.length) queries = [...new Set([q, ...list.map(String)])].slice(0, nQueries + 1);
    } catch (e) { if (signal?.aborted) throw e; }
  }
  // 2) search
  const sources = []; const seen = new Set(); const answers = [];
  for (let i = 0; i < queries.length; i += 3) {
    if (signal?.aborted) throw new Error('Stopped');
    status(`Research: searching (${Math.min(i + 3, queries.length)}/${queries.length})…`);
    const batch = await Promise.all(queries.slice(i, i + 3).map(async (qq) => {
      let res = [];
      if (ctx.media && s.apiKey) { try { const r = await ctx.media.search({ query: qq, signal }); if (r.answer) answers.push(`Q: ${qq}\n${clip(r.answer, 1500)}`); res = r.sources; } catch {} }
      if (res.length < 3) { try { res = res.concat(await ddgSearch(qq, 6, signal)); } catch {} }
      return res;
    }));
    for (const list of batch) for (const r of list) if (r.url && !seen.has(r.url)) { seen.add(r.url); sources.push(r); }
  }
  if (!sources.length) throw new Error('No search results (check the internet connection).');
  // 3) read the best pages
  const picked = sources.slice(0, nPages);
  const notes = [];
  for (let i = 0; i < picked.length; i += 4) {
    if (signal?.aborted) throw new Error('Stopped');
    status(`Research: reading sources (${Math.min(i + 4, picked.length)}/${picked.length})…`);
    const texts = await Promise.all(picked.slice(i, i + 4).map(async (src) => { try { return await fetchText(src.url, signal, 7000); } catch (e) { return `(could not read: ${e.message})`; } }));
    texts.forEach((t, k) => notes.push({ n: i + k + 1, ...picked[i + k], text: t }));
  }
  // 4) write the report
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/^-|-$/g, '') || 'research';
  const out = resolveLocal(ctx.workspace, args.output_path || path.join('research', `${new Date().toISOString().slice(0, 10)}-${slug}.md`));
  let report;
  if (canLLM) {
    status('Research: writing the report…');
    const material = notes.map((x) => `[${x.n}] ${x.title} — ${x.url}\n${clip(x.text, depth === 'deep' ? 5000 : 3500)}`).join('\n\n=====\n\n');
    const r = await api.complete({ model, signal, messages: [
      { role: 'system', content: 'You are a careful research analyst. Write a well-structured Markdown report answering the question, using ONLY the sources given. Cite with [n] after each claim. Start with a short summary (key findings), then sections, then "Open questions / limitations", then a "Sources" list ([n] title — URL). Point out where sources disagree or are old. Use the user\'s language.' },
      { role: 'user', content: `Question: ${q}\n\nSearch answers (may be incomplete):\n${answers.join('\n\n').slice(0, 6000)}\n\nSources:\n${material}` },
    ] });
    report = r.content || '';
  } else {
    report = `# Research: ${q}\n\n(No Meta API key: sources collected for you to summarise.)\n\n${notes.map((x) => `## [${x.n}] ${x.title}\n${x.url}\n\n${clip(x.text, 2500)}`).join('\n\n')}`;
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, report, 'utf8');
  return `Report saved to ${out} (${queries.length} searches, ${notes.length} sources read).\n\n${clip(report, 20000)}`;
}

module.exports = { XTOOLS, execX, readDocument, Jobs, ddgSearch, fetchText, htmlToText, findArduinoCli, splitArgs, parseRanges };
