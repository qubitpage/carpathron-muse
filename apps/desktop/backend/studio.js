// Firmware studio (Robot page → 🧩 Firmware studio): Arduino projects in <workspace>/firmware/<name>/<name>.ino,
// file editing with automatic history (.history/), compile / upload with arduino-cli and a live log, compiler errors as
// file:line, and a serial monitor. The AI works on the same folders (the "Ask AI" box opens a chat there).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const NAME_RE = /^[A-Za-z0-9_-]{1,60}$/;
const SRC_RE = /\.(ino|cpp|c|h|hpp|S|txt|md|json|yaml|yml|py|csv)$/i;

const TEMPLATES = {
  blink: { label: 'Blink (any board)', code: (n) => `// ${n} — blink the built-in LED and print over USB serial\n#ifndef LED_BUILTIN\n#define LED_BUILTIN 2   // ESP32 dev boards; the ESP32-CAM has its flash LED on 4\n#endif\n\nvoid setup() {\n  Serial.begin(115200);\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.println("${n} started");\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH); delay(500);\n  digitalWrite(LED_BUILTIN, LOW);  delay(500);\n  Serial.printf("alive %lu s\\n", millis() / 1000);\n}\n` },
  'esp32-web': { label: 'ESP32 Wi-Fi web page', code: (n) => `// ${n} — ESP32 joins your Wi-Fi and serves a page at its IP (see the Serial monitor)\n#include <WiFi.h>\n#include <WebServer.h>\n\nconst char* SSID = "YOUR_WIFI";\nconst char* PASS = "YOUR_PASSWORD";\nWebServer server(80);\n\nvoid setup() {\n  Serial.begin(115200);\n  WiFi.begin(SSID, PASS);\n  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }\n  Serial.printf("\\nOpen http://%s/\\n", WiFi.localIP().toString().c_str());\n  server.on("/", []() { server.send(200, "text/html", "<h1>${n}</h1><p>Hello from the ESP32</p>"); });\n  server.begin();\n}\n\nvoid loop() { server.handleClient(); }\n` },
  'servo-sweep': { label: 'Servo sweep (ESP32 / Arduino)', code: (n) => `// ${n} — sweep a servo on pin 13 (ESP32: install the "ESP32Servo" library; Arduino: use <Servo.h>)\n#include <ESP32Servo.h>\nServo s;\n\nvoid setup() { s.attach(13); }\n\nvoid loop() {\n  for (int a = 0; a <= 180; a += 2) { s.write(a); delay(15); }\n  for (int a = 180; a >= 0; a -= 2) { s.write(a); delay(15); }\n}\n` },
  empty: { label: 'Empty sketch', code: (n) => `// ${n}\n\nvoid setup() {\n  Serial.begin(115200);\n}\n\nvoid loop() {\n}\n` },
};

class Studio {
  constructor({ getSettings, findCli, emit, log, dataDir }) {
    Object.assign(this, { getSettings, findCli, emit: emit || (() => {}), log: log || (() => {}), dataDir });
    this.job = null; this.serial = null;
  }
  root() { return path.join(this.getSettings().workspace, 'firmware'); }
  dir(project) {
    if (!NAME_RE.test(String(project || ''))) throw new Error('Project names use letters, digits, - and _ only.');
    return path.join(this.root(), project);
  }
  cli() {
    const c = this.findCli();
    if (!c) throw new Error('arduino-cli is not installed yet: Robot → Devices → "Install tools" (or ask the agent to run arduino_setup).');
    return c;
  }
  meta(project) { try { return JSON.parse(fs.readFileSync(path.join(this.dir(project), '.studio.json'), 'utf8')); } catch { return {}; } }
  setMeta(project, patch) { const m = { ...this.meta(project), ...patch }; fs.writeFileSync(path.join(this.dir(project), '.studio.json'), JSON.stringify(m, null, 2)); return m; }

  projects() {
    const root = this.root();
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && NAME_RE.test(d.name) && fs.existsSync(path.join(root, d.name, `${d.name}.ino`)))
      .map((d) => { const m = this.meta(d.name); return { name: d.name, dir: path.join(root, d.name), fqbn: m.fqbn || (d.name === 'carpathron_car' ? 'esp32:esp32:esp32cam' : ''), port: m.port || '', updatedAt: fs.statSync(path.join(root, d.name, `${d.name}.ino`)).mtimeMs }; })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(name, template = 'blink', fqbn = '') {
    const dir = this.dir(name);
    if (fs.existsSync(dir)) throw new Error(`A project "${name}" already exists.`);
    const t = TEMPLATES[template] || TEMPLATES.blink;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.ino`), t.code(name));
    this.setMeta(name, { fqbn: fqbn || '', template });
    return { name, dir };
  }

  files(project) {
    const dir = this.dir(project);
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && SRC_RE.test(f) && fs.statSync(path.join(dir, f)).isFile())
      .sort((a, b) => (a === `${project}.ino` ? -1 : b === `${project}.ino` ? 1 : a.localeCompare(b)))
      .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
  }
  file(project, name) {
    const f = path.join(this.dir(project), path.basename(String(name)));
    if (!SRC_RE.test(f) || !fs.existsSync(f)) throw new Error('File not found.');
    return fs.readFileSync(f, 'utf8');
  }
  // Save; the previous version goes to .history/ (last 30 per file)
  save(project, name, content) {
    const dir = this.dir(project);
    const base = path.basename(String(name));
    if (!SRC_RE.test(base)) throw new Error('Only source files (.ino .cpp .h .c .py …) can be saved here.');
    const f = path.join(dir, base);
    if (fs.existsSync(f)) {
      const old = fs.readFileSync(f, 'utf8');
      if (old === content) return { saved: false };
      const hist = path.join(dir, '.history');
      fs.mkdirSync(hist, { recursive: true });
      fs.writeFileSync(path.join(hist, `${base}.${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`), old);
      const mine = fs.readdirSync(hist).filter((x) => x.startsWith(`${base}.`)).sort();
      for (const x of mine.slice(0, Math.max(0, mine.length - 30))) fs.unlinkSync(path.join(hist, x));
    }
    fs.writeFileSync(f, content);
    return { saved: true };
  }
  history(project, name) {
    const hist = path.join(this.dir(project), '.history');
    const base = path.basename(String(name));
    if (!fs.existsSync(hist)) return [];
    return fs.readdirSync(hist).filter((x) => x.startsWith(`${base}.`)).sort().reverse().map((x) => ({ id: x, at: x.slice(base.length + 1) }));
  }
  restore(project, name, id) {
    const p = path.join(this.dir(project), '.history', path.basename(String(id)));
    if (!fs.existsSync(p) || !path.basename(id).startsWith(`${path.basename(name)}.`)) throw new Error('Version not found.');
    return this.save(project, name, fs.readFileSync(p, 'utf8'));
  }

  // Compiler errors and warnings as { file, line, col, kind, msg }
  static problems(out, dir) {
    const res = [];
    const re = /^(.*?):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$/gm;
    let m;
    while ((m = re.exec(out))) {
      if (m[4] === 'note') continue;
      const file = path.basename(m[1]);
      if (dir && !fs.existsSync(path.join(dir, file))) continue; // errors inside libraries / the core: not editable here
      res.push({ file, line: Number(m[2]), col: Number(m[3]), kind: m[4] === 'warning' ? 'warning' : 'error', msg: m[5].slice(0, 300) });
    }
    return res.slice(0, 50);
  }

  // Run arduino-cli with the output streamed to the UI (studio:log). One job at a time.
  run(args, label) {
    if (this.job) throw new Error('A compile/upload is already running.');
    const cli = this.cli();
    return new Promise((resolve) => {
      const started = Date.now();
      let out = '';
      this.emit('studio:log', { start: true, text: `▶ ${label}\n` });
      const child = spawn(cli, args, { windowsHide: true });
      this.job = child;
      const on = (d) => { const t = d.toString(); out += t; if (out.length > 400000) out = out.slice(-300000); this.emit('studio:log', { text: t }); };
      child.stdout.on('data', on); child.stderr.on('data', on);
      child.on('error', (e) => { out += `\n${e.message}`; });
      child.on('close', (code) => {
        this.job = null;
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        this.emit('studio:log', { end: true, ok: code === 0, text: `\n${code === 0 ? '✓' : '✕'} ${label} — ${code === 0 ? 'done' : `failed (exit ${code})`} in ${secs} s\n` });
        resolve({ code, out });
      });
    });
  }
  cancel() { if (this.job) { try { this.job.kill(); } catch {} return true; } return false; }

  async compile(project, fqbn) {
    const dir = this.dir(project);
    fqbn = fqbn || this.meta(project).fqbn;
    if (!fqbn) throw new Error('Pick the board first (Board box).');
    this.setMeta(project, { fqbn });
    const r = await this.run(['compile', '--fqbn', fqbn, '--warnings', 'default', dir], `Compile ${project} for ${fqbn}`);
    const size = r.out.match(/Sketch uses (\d+) bytes \((\d+)%\)/);
    return { ok: r.code === 0, problems: Studio.problems(r.out, dir), size: size ? { bytes: Number(size[1]), percent: Number(size[2]) } : null, out: r.out.slice(-20000) };
  }
  async upload(project, fqbn, port) {
    const dir = this.dir(project);
    fqbn = fqbn || this.meta(project).fqbn;
    if (!fqbn) throw new Error('Pick the board first (Board box).');
    if (!port) throw new Error('Pick the port (the board must be connected by USB).');
    const hadSerial = this.serial && this.serial.port === port;
    if (hadSerial) this.serialStop(); // the monitor holds the port
    this.setMeta(project, { fqbn, port });
    const r = await this.run(['compile', '--upload', '-p', port, '--fqbn', fqbn, dir], `Compile and upload ${project} to ${port}`);
    let hint = '';
    if (r.code && /Failed to connect|Wrong boot mode|timed out waiting for packet/i.test(r.out)) hint = 'Hold the board\'s BOOT button while "Connecting…" appears, then upload again.';
    if (r.code && /could not open port|Access is denied|busy/i.test(r.out)) hint = 'Another program uses the port (Arduino IDE, a serial monitor). Close it and upload again.';
    return { ok: r.code === 0, problems: Studio.problems(r.out, dir), hint, out: r.out.slice(-20000) };
  }

  // Serial monitor: lines stream to the UI as studio:serial
  serialStart(port, baud = 115200) {
    this.serialStop();
    const cli = this.cli();
    const child = spawn(cli, ['monitor', '-p', String(port), '--config', `baudrate=${Number(baud) || 115200}`, '--quiet'], { windowsHide: true });
    this.serial = { child, port, baud };
    const on = (d) => this.emit('studio:serial', { port, text: d.toString() });
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('close', () => { if (this.serial && this.serial.child === child) { this.serial = null; this.emit('studio:serial', { port, closed: true, text: '\n[monitor closed]\n' }); } });
    return { ok: true, port, baud };
  }
  serialSend(text) { if (!this.serial) throw new Error('The serial monitor is not running.'); this.serial.child.stdin.write(`${text}\n`); return { ok: true }; }
  serialStop() { if (this.serial) { const c = this.serial.child; this.serial = null; try { c.kill(); } catch {} return true; } return false; }
}

module.exports = { Studio, TEMPLATES, NAME_RE };
