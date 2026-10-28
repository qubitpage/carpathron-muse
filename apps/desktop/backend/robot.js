// Baby Carpathron link: sends motor commands to the car over HTTP (Carpathron firmware for the
// KUONGSHUN AD174 ESP32-CAM car: GET /drive?l=..&r=.., /stop, /status) or simulates the car.
'use strict';
const http = require('http');
const net = require('net');
const WebSocket = require('ws');

const MAX_SPEED = 100;
const MAX_ACTION_MS = 5000;
const DRIVER_TIMEOUT_MS = 400;
const CAR_TICK_MS = 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });

function carGet(host, pathAndQuery, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const [h, port] = host.split(':');
    const req = http.get({ host: h, port: Number(port) || 80, path: pathAndQuery, agent, timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => (res.statusCode < 400 ? resolve(body) : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class Robot {
  constructor({ getIp, emit }) {
    this.getIp = getIp;
    this.emit = emit; // (event, data)
    this.state = 'simulated';
    this.ip = '';
    this.info = null;
    this.manual = { left: 0, right: 0, at: 0, by: '' };
    this.auto = null;
    this.planId = 0;
    this.current = { left: 0, right: 0, source: 'idle' };
    this.inFlight = false;
    this.stopsSent = 2;
    this._tick = setInterval(() => this._push(), CAR_TICK_MS);
    this._status = setInterval(() => this.emit('robot:status', this.status()), 1000);
    this._probe = setInterval(() => this.probe(), 2000);
    this.connect();
  }

  host() { return this.ip; }

  connect() {
    this.ip = (this.getIp() || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    this.info = null;
    this.firmware = null;
    try { this.kitSock && this.kitSock.destroy(); } catch {}
    this._wsClose();
    this.state = this.ip ? 'connecting' : 'simulated';
    this.probe();
  }

  // Detects which program runs on the car:
  //  'carpathron' = our firmware (/status JSON, /drive?l=&r=)
  //  'kit-web'    = KUONGSHUN factory "Web" program (/control?var=car&val=1..5)
  //  'kit-app'    = KUONGSHUN factory "APP" program (TCP port 100 packets)
  async probe() {
    if (!this.ip) { this.state = 'simulated'; return; }
    const ip = this.ip;
    let fw = null;
    try {
      const body = await carGet(ip, '/status', 2500);
      try { const j = JSON.parse(body); if (/carpathron/i.test(j.name || '')) { fw = 'carpathron'; this.info = j; } } catch {}
      if (!fw) fw = this.firmware && this.firmware.startsWith('kit') ? this.firmware : null;
    } catch {}
    if (!fw) {
      try {
        const page = await carGet(ip, '/', 2500);
        if (/Baby Carpathron/i.test(page)) fw = 'carpathron'; // our firmware, /status was just slow
        else if (/var=car/.test(page)) { fw = 'kit-web'; this.info = { camera: true, name: 'KUONGSHUN car' }; }
        else if (this.firmware !== 'carpathron') { fw = 'kit-app'; this.info = { camera: true, name: 'KUONGSHUN car' }; }
      } catch {}
    }
    if (ip !== this.ip) return;
    // A weak Wi-Fi link can miss one check: keep the car online (and keep driving) until 3 checks in a row fail.
    if (!fw && this.state === 'online' && (this.missed = (this.missed || 0) + 1) < 3) return;
    if (fw) this.missed = 0;
    if (fw) {
      if (this.state !== 'online' || this.firmware !== fw) this.emit('log', `Car online at ${ip} — ${{ carpathron: 'Carpathron firmware', 'kit-web': 'KUONGSHUN factory Web program', 'kit-app': 'KUONGSHUN factory APP program' }[fw]}${this.info && this.info.camera ? ' (camera ready)' : ''}`);
      this.firmware = fw;
      this.state = 'online';
    } else {
      if (this.state === 'online') this.emit('log', `Car at ${ip} stopped answering`);
      this.state = 'offline';
    }
  }

  status() { return { state: this.state, ip: this.ip, firmware: this.firmware || null, motors: this.current, camera: !!(this.info && this.info.camera), rssi: this.info ? this.info.rssi : null }; }

  manualDrive(left, right, by = 'pc') {
    left = clamp(left, -MAX_SPEED, MAX_SPEED); right = clamp(right, -MAX_SPEED, MAX_SPEED);
    if ((left || right) && this.auto) this.cancelPlan('manual override');
    this.manual = { left, right, at: Date.now(), by };
  }

  stop(by = 'pc') {
    this.cancelPlan('STOP');
    this.manual = { left: 0, right: 0, at: Date.now(), by };
    this.emit('log', `STOP from ${by}`);
  }

  cancelPlan(reason) {
    if (this.auto) { this.planId++; this.auto = null; if (reason) this.emit('log', `Robot plan cancelled (${reason})`); }
  }

  // Runs a list of {type:'drive',left,right,ms} | {type:'wait',ms} | {type:'stop'}; resolves when done or cancelled.
  async runPlan(actions, source = 'ai') {
    this.cancelPlan();
    const id = ++this.planId;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const done = [];
    for (const a of actions.slice(0, 30)) {
      if (this.planId !== id) return { completed: false, done, reason: 'cancelled (manual control or STOP)' };
      if (a.type === 'drive') {
        const left = clamp(a.left, -MAX_SPEED, MAX_SPEED), right = clamp(a.right, -MAX_SPEED, MAX_SPEED), ms = clamp(a.ms, 50, MAX_ACTION_MS);
        this.auto = { left, right, source };
        await sleep(ms);
        done.push({ type: 'drive', left, right, ms });
      } else if (a.type === 'wait') {
        const ms = clamp(a.ms, 50, MAX_ACTION_MS);
        this.auto = { left: 0, right: 0, source };
        await sleep(ms);
        done.push({ type: 'wait', ms });
      } else {
        this.auto = { left: 0, right: 0, source };
        await sleep(120);
        done.push({ type: 'stop' });
      }
    }
    if (this.planId !== id) return { completed: false, done, reason: 'cancelled (manual control or STOP)' };
    this.auto = { left: 0, right: 0, source };
    await sleep(120);
    if (this.planId === id) this.auto = null;
    return { completed: true, done };
  }

  _push() {
    const now = Date.now();
    let next;
    if (this.manual.at && now - this.manual.at < DRIVER_TIMEOUT_MS && (this.manual.left || this.manual.right)) {
      next = { left: this.manual.left, right: this.manual.right, source: this.manual.by };
    } else if (this.auto) next = { ...this.auto };
    else next = { left: 0, right: 0, source: 'idle' };
    this._send(Math.round(next.left), Math.round(next.right));
    const c = this.current;
    this.current = next;
    if (next.left !== c.left || next.right !== c.right || next.source !== c.source) this.emit('robot:motors', next);
  }

  // RC-style link to the Carpathron firmware: one permanent WebSocket (ws://car/ws), like RC transmitters.
  // A new direction is sent at once; while held it is repeated every 300 ms (the car stops by itself after 2.5 s
  // of silence, e.g. if the PC or Wi-Fi goes away); release sends stop 3 times. Falls back to HTTP if /ws is missing.
  _wsEnsure() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.wsRetryAt && Date.now() < this.wsRetryAt) return;
    const [h, p] = this.ip.split(':');
    let ws;
    try { ws = new WebSocket(`ws://${h}:${Number(p) || 80}/ws`, { handshakeTimeout: 3000, perMessageDeflate: false }); } catch { return; }
    this.ws = ws;
    ws.on('open', () => { this.wsOk = true; this.emit('log', `RC link open to ${this.ip}`); try { ws._socket.setNoDelay(true); } catch {} });
    ws.on('message', () => { this.lastAck = Date.now(); });
    ws.on('close', () => { if (this.ws === ws) { this.wsOk = false; this.ws = null; this.wsRetryAt = Date.now() + 1000; } });
    ws.on('error', () => {});
  }
  _wsClose() { try { this.ws && this.ws.terminate(); } catch {} this.ws = null; this.wsOk = false; }
  _out(l, r) {
    const msg = l === 0 && r === 0 ? 's' : `${l},${r}`;
    if (this.wsOk && this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 64) { this.ws.send(msg); return; }
    if (msg === 's') carGet(this.ip, '/stop', 1000).catch(() => {});
    else if (!this.inFlight) { this.inFlight = true; carGet(this.ip, `/drive?l=${l}&r=${r}`, 1500).catch(() => {}).finally(() => { this.inFlight = false; }); }
  }
  _send(l, r) {
    if (this.state !== 'online' || !this.ip) { this._wsClose(); return; }
    if (this.firmware === 'kit-web' || this.firmware === 'kit-app') return this._sendKit(l, r);
    this._wsEnsure();
    const now = Date.now();
    const moving = l !== 0 || r !== 0;
    const changed = !this.lastSent || this.lastSent.l !== l || this.lastSent.r !== r;
    if (moving) {
      this.stopTicks = 0;
      if (!changed && now - (this.lastSentAt || 0) < 300) return;
      this.lastSent = { l, r }; this.lastSentAt = now;
      this._out(l, r);
    } else {
      if (changed) { this.lastSent = { l: 0, r: 0 }; this.stopTicks = 0; }
      const t = this.stopTicks = (this.stopTicks || 0) + 1;
      if (t === 1 || t === 3 || t === 6) this._out(0, 0);
    }
  }

  // Factory programs only know 4 directions + one speed. Map (left,right) to the closest one.
  static kitCommand(l, r) {
    if (!l && !r) return { dir: 'stop', speed: 0 };
    const speed = Math.round(Math.max(Math.abs(l), Math.abs(r)) * 2.55);
    if (l > 0 && r > 0) return { dir: Math.abs(l - r) > 50 ? (l > r ? 'right' : 'left') : 'fwd', speed };
    if (l < 0 && r < 0) return { dir: 'back', speed };
    return { dir: l < r ? 'left' : 'right', speed };
  }

  _sendKit(l, r) {
    const cmd = Robot.kitCommand(l, r);
    const key = `${cmd.dir}:${Math.round(cmd.speed / 16)}`;
    const now = Date.now();
    // factory programs keep moving until told otherwise: send on change, and refresh every 400 ms while moving
    if (key === this.lastKitKey && (cmd.dir === 'stop' ? (this.stopsSent || 0) >= 2 : now - (this.lastKitAt || 0) < 400)) return;
    if (cmd.dir === 'stop') this.stopsSent = (this.stopsSent || 0) + 1; else this.stopsSent = 0;
    this.lastKitKey = key; this.lastKitAt = now;
    if (this.firmware === 'kit-web') {
      const val = { fwd: 1, left: 2, stop: 3, right: 4, back: 5 }[cmd.dir];
      const go = () => carGet(this.ip, `/control?var=car&val=${val}`, 800).catch(() => {});
      if (cmd.dir === 'stop') go();
      else carGet(this.ip, `/control?var=speed&val=${Math.max(80, cmd.speed)}`, 800).catch(() => {}).finally(go);
    } else {
      const val = { stop: 0, fwd: 1, back: 2, right: 3, left: 4 }[cmd.dir];
      if (cmd.dir !== 'stop') this._kitPacket(0x0d, Math.max(80, cmd.speed));
      this._kitPacket(0x0c, val);
    }
  }

  // KUONGSHUN APP protocol: ff 55 0a 00 00 00 00 00 00 01 <device> 00 <value>, over TCP port 100.
  _kitPacket(device, value) {
    const pkt = Buffer.from([0xff, 0x55, 0x0a, 0, 0, 0, 0, 0, 0, 0x01, device, 0x00, value & 0xff]);
    const [h] = this.ip.split(':');
    if (!this.kitSock || this.kitSock.destroyed) {
      this.kitSock = net.connect({ host: h, port: 100 });
      this.kitSock.setNoDelay(true);
      this.kitSock.on('error', () => {});
      this.kitSock.on('close', () => { this.kitSock = null; });
    }
    this.kitSock.write(pkt);
  }

  // Live video (MJPEG) from the car's camera, piped through our server so https pages can show it.
  pipeStream(res) {
    if (!this.ip) { res.writeHead(404); return res.end('no car'); }
    const [h, p] = this.ip.split(':');
    const up = http.get({ host: h, port: p ? Number(p) + 1 : 81, path: '/stream', timeout: 5000 }, (r) => {
      res.writeHead(r.statusCode || 200, { 'Content-Type': r.headers['content-type'] || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store' });
      r.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('car camera not reachable'); } else res.end(); });
    res.on('close', () => up.destroy());
  }

  // Looks for Carpathron cars on the local networks of this PC (and the car's own hotspot).
  static async find(lanIps, { extra = [], timeout = 800, concurrency = 48 } = {}) {
    const hosts = new Set(['carpathron.local', '192.168.4.1', ...extra]);
    for (const ip of lanIps) {
      const p = ip.split('.');
      if (p.length !== 4) continue;
      for (let i = 1; i < 255; i++) { const h = `${p[0]}.${p[1]}.${p[2]}.${i}`; if (h !== ip) hosts.add(h); }
    }
    const list = [...hosts];
    const found = [];
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const h = list[next++];
        try {
          const body = await carGet(h, '/status', timeout);
          let j = null; try { j = JSON.parse(body); } catch {}
          if (j && /carpathron/i.test(j.name || '')) found.push({ host: h, ip: j.wifiIp || j.ip || h, mode: j.mode, camera: !!j.camera, wifi: j.wifi || '' });
          else if (h === '192.168.4.1' || /^10\.|^192\.168\./.test(h)) {
            // KUONGSHUN factory program: camera server with /control
            const page = await carGet(h, '/', timeout).catch(() => '');
            if (/esp32|camera|var=car|KUONGSHUN|stream/i.test(page)) found.push({ host: h, ip: h, mode: 'factory', camera: true, wifi: '' });
          }
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    const seen = new Set();
    return found.filter((f) => { const k = f.ip; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async led(v) {
    if (!this.ip) return;
    const val = Math.max(0, Math.min(255, Number(v) || 0));
    if (this.firmware === 'kit-web') return carGet(this.ip, `/control?var=flash&val=${val}`);
    if (this.firmware === 'kit-app') return this._kitPacket(0x05, val);
    return carGet(this.ip, `/led?v=${val}`);
  }

  close() { clearInterval(this._tick); clearInterval(this._status); clearInterval(this._probe); try { this.kitSock && this.kitSock.destroy(); } catch {} agent.destroy(); }
}

module.exports = { Robot, MAX_ACTION_MS };
