// Practice car: a simulated Baby Carpathron (firmware 2.2 API) that drives around a virtual room. Muse Carpathron can
// use it like the real car (Robot → Find my car → Practice car), so settings, health check, mapping and missions can be
// tried and tested without hardware. Faults can be switched on to practise troubleshooting (camera off, a dead motor,
// swapped wires, a noisy laser…).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const C = require('./carsettings');

const FW = '2.3.0';
const VIEW = fs.readFileSync(path.join(__dirname, 'simcar-view.jpg'));
// room in cm: outer walls + boxes [x1, y1, x2, y2]; the car starts in the middle looking along +x (heading 0 = +x, clockwise positive)
const ROOM = { w: 360, h: 280, start: [120, 140], boxes: [[250, 110, 290, 170], [40, 200, 120, 260], [170, 30, 200, 60]] };

function rayDist(room, x, y, headDeg) {
  const a = (headDeg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  let best = Infinity;
  const seg = (x1, y1, x2, y2) => { // ray vs segment
    const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) return;
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den, u = ((x1 - x) * dy - (y1 - y) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  };
  const rect = ([a1, b1, a2, b2]) => { seg(a1, b1, a2, b1); seg(a2, b1, a2, b2); seg(a2, b2, a1, b2); seg(a1, b2, a1, b1); };
  rect([0, 0, room.w, room.h]);
  room.boxes.forEach(rect);
  return best * 10; // mm
}
const inside = (room, x, y, r = 8) => x > r && y > r && x < room.w - r && y < room.h - r && !room.boxes.some(([a1, b1, a2, b2]) => x > a1 - r && x < a2 + r && y > b1 - r && y < b2 + r);

function start({ port = 0, faults = {}, room = ROOM, tickMs = 20, otaKey = '' } = {}) {
  const st = {
    values: { ...C.DEFAULTS }, saved: { ...C.DEFAULTS }, strings: { name: 'Practice car', apSsid: 'Carpathron-Car', apPass: 'carpathron' },
    restartPending: false, x: (room.start || [room.w / 2, room.h / 2])[0], y: (room.start || [room.w / 2, room.h / 2])[1], head: 0, l: 0, r: 0, lastCmd: Date.now(), led: 0, boot: Date.now(), reset: 'power-on',
    fw: FW, slots: { running: 'app0', other: null }, otaKey,
    turn: null, turnResult: 0, blocked: false, faults: { ...faults }, sensorMode: 'auto', log: [], trail: [],
  };
  const v = () => st.values;
  // motors → wheel speeds (cm/s) as the firmware would drive them, including the configured fixes and the faults
  function wheel(cmd, side) {
    if (!cmd) return 0;
    const val = v();
    let p = Math.max(-100, Math.min(100, cmd)) * (val.maxPct / 100); // trim is applied by the caller (only when both sides go the same way, like the firmware)
    const duty = Math.abs(p) < 1 ? 0 : val.minDuty + ((255 - val.minDuty) * Math.abs(p)) / 100;
    if (duty < (st.faults.stallDuty || 140)) return 0; // too little power: the motor hums
    let s = Math.sign(p) * (duty / 255) * 32; // ~32 cm/s at full power (TT motors, 18650s)
    if (side === 'l' && val.invL) s = -s;
    if (side === 'r' && val.invR) s = -s;
    if (st.faults[side === 'l' ? 'invertLeft' : 'invertRight']) s = -s; // wires swapped on the real car
    if (st.faults[side === 'l' ? 'deadLeft' : 'deadRight']) s = 0;
    if (side === 'l' && st.faults.weakLeft) s *= st.faults.weakLeft; // a weaker motor: the car pulls to the left
    return s;
  }
  function drive(l, r) {
    st.l = Math.round(l); st.r = Math.round(r);
  }
  const tick = setInterval(() => {
    const dt = tickMs / 1000, now = Date.now();
    if ((st.l || st.r) && !st.turn && now - st.lastCmd > v().failMs) drive(0, 0);
    if (st.turn) {
      const left = st.turn.target - (yaw() - st.turn.from);
      if (Math.abs(left) < 2 || now - st.turn.t0 > 15000) { drive(0, 0); st.turnResult = Math.abs(left) < 2 ? 1 : 2; st.turn = null; }
      else { const sp = Math.max(45, Math.min(st.turn.speed || v().turnSpd, Math.abs(left) * 2)); drive(Math.sign(left) * sp, -Math.sign(left) * sp); }
    }
    // swapped sides: the firmware's swap setting undoes a physical swap
    let cl = st.l, cr = st.r;
    if (cl && cr && (cl > 0) === (cr > 0)) { cl = Math.trunc((cl * (100 + v().trim)) / 100); cr = Math.trunc((cr * (100 - v().trim)) / 100); }
    if (v().swap) [cl, cr] = [cr, cl];
    if (st.faults.swapSides) [cl, cr] = [cr, cl];
    const vl = wheel(cl, 'l'), vr = wheel(cr, 'r'), track = 13; // cm between the wheels
    const fwd = (vl + vr) / 2, rot = ((vl - vr) / track) * (180 / Math.PI); // deg/s, + = clockwise (right)
    const dist = rayDist(room, st.x, st.y, st.head);
    st.blocked = false;
    if (st.l > 0 && st.r > 0 && tofOk() && v().stopMm > 0 && dist < v().stopMm) { drive(0, 0); st.blocked = true; } else {
      const a = (st.head * Math.PI) / 180, nx = st.x + Math.cos(a) * fwd * dt, ny = st.y + Math.sin(a) * fwd * dt;
      if (inside(room, nx, ny)) { st.x = nx; st.y = ny; } else if (fwd) st.bumped = now;
      st.head = st.head + rot * dt;
    }
    if (fwd || rot) { const last = st.trail[st.trail.length - 1]; if (!last || Math.hypot(last[0] - st.x, last[1] - st.y) > 5) { st.trail.push([Math.round(st.x), Math.round(st.y)]); if (st.trail.length > 2000) st.trail.shift(); } }
  }, tickMs);

  // the camera picture: the 3D view the app renders from the car's position (Robot page), else a still picture
  const view = () => (st.frame && Date.now() - st.frameAt < 10000 ? st.frame : VIEW);
  const imuOk = () => !st.faults.noImu && st.sensorMode === 'auto';
  const tofOk = () => !st.faults.noTof && st.sensorMode === 'auto';
  const yaw = () => (st.head * v().gScale * (st.faults.gyroErr || 1)) / 1000 + (st.faults.gyroDrift ? ((Date.now() - st.boot) / 1000) * 0.8 : 0);
  function distMm() {
    if (!tofOk()) return -1;
    const d = rayDist(room, st.x, st.y, st.head) + (st.faults.noisyTof ? (Math.random() - 0.5) * 500 : (Math.random() - 0.5) * 8) + 25 - v().tofOff;
    return d > 2000 ? -1 : Math.max(0, Math.round(d));
  }
  const settingsJson = (extra = {}) => {
    const active = {};
    for (const k of Object.keys(st.values)) if (!C.STRING_KEYS.has(k) && st.values[k] !== st.saved[k]) active[k] = st.values[k];
    const values = {};
    for (const k of Object.keys(C.DEFAULTS)) if (!C.STRING_KEYS.has(k)) values[k] = st.saved[k];
    return { fw: st.fw, board: 'esp32cam', values, active, strings: { name: st.strings.name, apSsid: st.strings.apSsid }, restartPending: st.restartPending, ...extra };
  };
  function setOne(values, key, val) { // → error text or ''
    if (C.STRING_KEYS.has(key)) {
      const s = String(val || '').trim();
      if (key === 'apPass' && (s.length < 8 || s.length > 63)) return 'the hotspot password needs 8 to 63 characters';
      if (key !== 'apPass' && (!s.length || s.length > 31)) return 'use 1 to 31 characters';
      if (/["\\]/.test(s)) return 'quotes and backslashes are not allowed';
      return '';
    }
    if (!(key in C.FIELDS)) return `unknown setting ${key}`;
    const r = C.check(values, key, val);
    return r.errors[0] || '';
  }
  function restart(reason = 'software') {
    st.values = { ...st.saved }; st.restartPending = false; st.boot = Date.now(); st.reset = reason; drive(0, 0); st.turn = null;
  }
  function diag(motors) {
    const d = {
      fw: st.fw, uptime: Math.round((Date.now() - st.boot) / 1000), reset: { code: 0, name: st.faults.crashed ? 'crash' : st.reset, brownoutDetector: false },
      memory: { heapFree: 182000, psram: !st.faults.noPsram, psramFree: st.faults.noPsram ? 0 : 4011000 },
      wifi: { mode: 'wifi', connected: true, rssi: st.faults.weakWifi ? -80 : -52 }, bootFix: !st.faults.noBootFix,
      camera: st.faults.noCamera ? { ok: false, error: 0x105, pid: 0, fps: 0 } : { ok: true, error: 0, pid: 0x26, fps: [25, 18, 12, 8, 5][v().frame] || 12 },
      i2c: { sda: v().sda, scl: v().scl, mode: st.sensorMode, active: imuOk() || tofOk(), devices: [...(tofOk() ? [0x29] : []), ...(imuOk() ? [0x68] : [])] },
    };
    const reads = Array.from({ length: 20 }, distMm).filter((x) => x > 0);
    const mean = reads.length ? reads.reduce((a, b) => a + b, 0) / reads.length : 0;
    const sd = reads.length ? Math.sqrt(reads.reduce((a, b) => a + (b - mean) ** 2, 0) / reads.length) : 0;
    d.tof = { ok: tofOk(), samples: reads.length, outOfRange: 20 - reads.length, mean: Math.round(mean), sd: Math.round(sd * 10) / 10, min: reads.length ? Math.min(...reads) : -1, max: reads.length ? Math.max(...reads) : 0, stopMm: v().stopMm };
    d.imu = { ok: imuOk(), whoAmI: imuOk() ? (st.faults.cloneImu ? 0x70 : 0x68) : -1, bias: -1.2, restDps: st.faults.gyroDrift ? 0.8 : 0.03, noiseDps: 0.08, yaw: Math.round(yaw() * 10) / 10 };
    d.ir = { ok: false, left: false, right: false };
    d.pins = { rEn: v().rEn, rFwd: v().rFwd, rBack: v().rBack, lEn: v().lEn, lFwd: v().lFwd, lBack: v().lBack, led: 4 };
    if (!motors) return Promise.resolve(d);
    const probe = (side) => new Promise((res) => {
      if (!imuOk()) return res(null);
      const y0 = yaw(), d0 = distMm();
      drive(side !== 'r' ? 70 : 0, side !== 'l' ? 70 : 0); st.lastCmd = Date.now();
      setTimeout(() => { drive(0, 0); setTimeout(() => res({ turnDeg: Math.round((yaw() - y0) * 10) / 10, distBefore: d0, distAfter: distMm() }), 350); }, side === 'b' ? 350 : 600);
    });
    return (async () => {
      const left = await probe('l'), right = await probe('r'), both = tofOk() && v().stopMm > 0 ? await probe('b') : null;
      d.motors = { left, right, both };
      return d;
    })();
  }

  const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  const api = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), q = u.searchParams;
    st.log.push(u.pathname + u.search); if (st.log.length > 500) st.log.shift();
    switch (u.pathname) {
      case '/': res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<!doctype html><title>${st.strings.name}</title><h1>Baby Carpathron practice car</h1>`);
      case '/status': return json(res, {
        name: st.strings.name, fw: st.fw, restartPending: st.restartPending, ip: '127.0.0.1', mode: 'wifi', wifi: 'Simulator', wifiIp: '127.0.0.1', connecting: false,
        rssi: st.faults.weakWifi ? -80 : -52, left: st.l, right: st.r, camera: !st.faults.noCamera, psram: !st.faults.noPsram, uptime: Math.round((Date.now() - st.boot) / 1000), simulator: true,
        sensors: { mode: st.sensorMode, ir: false, irLeft: false, irRight: false, tof: tofOk(), imu: imuOk(), dist: distMm(), stopMm: v().stopMm, blocked: st.blocked, yaw: Math.round(yaw() * 10) / 10, turning: !!st.turn, turnResult: st.turnResult, mega: false, tempC: null, humidity: null, tilt: null, pir: -1 },
      });
      case '/drive': {
        if (st.turn) { st.turn = null; st.turnResult = 3; }
        drive(Number(q.get('l')) || 0, Number(q.get('r')) || 0); st.lastCmd = Date.now(); return res.end('ok');
      }
      case '/stop': if (st.turn) { st.turn = null; st.turnResult = 3; } drive(0, 0); return res.end('ok');
      case '/led': st.led = Math.min(Number(q.get('v')) || 0, v().ledMax); return res.end('ok');
      case '/capture': if (st.faults.noCamera) { res.writeHead(500); return res.end('camera not available'); } res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(view());
      case '/turn': {
        if (!imuOk()) return json(res, { ok: false, error: 'no gyro' });
        const deg = Number(q.get('deg')) || 0; st.turn = { target: deg, from: yaw(), t0: Date.now(), speed: Number(q.get('speed')) || 0 }; st.turnResult = 0;
        return json(res, { ok: true, deg });
      }
      case '/safety': if (q.has('mm')) st.values.stopMm = st.saved.stopMm = Math.max(0, Math.min(1000, Number(q.get('mm')) || 0)); return json(res, { ok: true, stopMm: v().stopMm });
      case '/config': { const m = q.get('sensors'); if (['auto', 'ir', 'mega', 'off'].includes(m)) { st.sensorMode = m; restart(); return json(res, { ok: true, restarting: true }); } return json(res, { ok: true, sensors: st.sensorMode }); }
      case '/test': return res.end('ok');
      case '/settings': {
        if (q.has('restart') || q.has('reset')) { if (q.has('reset')) { st.saved = { ...C.DEFAULTS }; st.strings = { name: 'Practice car', apSsid: 'Carpathron-Car', apPass: 'carpathron' }; } json(res, { ok: true, restarting: true }); return setTimeout(() => restart(), 300); }
        if (q.has('many')) {
          const tmp = { ...st.saved }, touched = [];
          for (const part of String(q.get('many')).split(',')) {
            const [k, val] = part.split(':');
            if (!(k in C.FIELDS) || C.STRING_KEYS.has(k)) return json(res, { ok: false, error: `unknown setting ${k}` });
            tmp[k] = Math.round(Number(val)); touched.push(k);
          }
          for (const k of touched) { const e = setOne(tmp, k, tmp[k]); if (e) return json(res, { ok: false, error: e }); }
          let restartNeed = false;
          for (const k of touched) { st.saved[k] = tmp[k]; if (C.FIELDS[k].restart) restartNeed = st.restartPending = true; else st.values[k] = tmp[k]; }
          return json(res, settingsJson({ ok: true, needsRestart: restartNeed }));
        }
        if (q.has('set')) {
          const key = q.get('set'), isStr = C.STRING_KEYS.has(key), val = isStr ? q.get('s') : Math.round(Number(q.get('v')));
          if (!isStr && !q.has('v')) return json(res, { ok: false, error: 'missing v=<number>' });
          const e = setOne(st.saved, key, val);
          if (e) return json(res, { ok: false, error: e });
          let restartNeed = false;
          if (isStr) { st.strings[key] = String(val).trim(); if (key !== 'name') restartNeed = st.restartPending = true; }
          else { st.saved[key] = val; if (C.FIELDS[key].restart) restartNeed = st.restartPending = true; else st.values[key] = val; }
          return json(res, settingsJson({ ok: true, changed: key, needsRestart: restartNeed }));
        }
        return json(res, settingsJson());
      }
      case '/diag': return json(res, await diag(q.get('motors') === '1'));
      case '/pin': {
        const g = Number(q.get('gpio')), mode = q.get('mode') || 'read', vv = v();
        let why = null;
        if (![1, 2, 3, 12, 13, 14, 15, 33].includes(g)) why = 'not a free pin of the ESP32-CAM (free: 1 2 3 12 13 14 15 33)';
        else if ([vv.rEn, vv.rFwd, vv.rBack, vv.lEn, vv.lFwd, vv.lBack].includes(g)) why = 'used by the motors (change it in Car settings first)';
        else if (st.sensorMode !== 'off' && [vv.sda, vv.scl].includes(g)) why = 'used by the sensors now (sensor mode off frees it)';
        if (why) return json(res, { ok: false, error: `GPIO ${g} is ${why}` });
        st.pins = st.pins || {};
        if (mode === 'high' || mode === 'low') st.pins[g] = mode === 'high' ? 1 : 0;
        const level = mode === 'read' ? (st.faults.pinLow === g ? 0 : 1) : mode === 'blink' ? 0 : st.pins[g];
        return json(res, { ok: true, gpio: g, mode, level });
      }
      case '/ota': {
        const keyOk = st.otaKey && req.headers['x-ota-key'] === st.otaKey;
        const info = () => ({ fw: st.fw, ota: true, keySet: !!st.otaKey, running: { label: st.slots.running, valid: true }, other: st.slots.other ? { label: st.slots.running === 'app0' ? 'app1' : 'app0', valid: true, built: st.slots.other.built } : null });
        if (req.method === 'GET' && !q.has('rollback')) return json(res, info());
        if (!keyOk) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'wrong or missing OTA key' })); }
        if (req.method === 'GET') {
          if (!st.slots.other) return json(res, { ok: false, error: 'there is no previous firmware on the car' });
          const prev = st.slots.other; st.slots.other = { fw: st.fw, built: 'now' }; st.fw = prev.fw; st.slots.running = st.slots.running === 'app0' ? 'app1' : 'app0';
          json(res, { ok: true, restarting: true }); return setTimeout(() => restart(), 300);
        }
        const chunks = []; for await (const c of req) chunks.push(c);
        const bin = Buffer.concat(chunks);
        if (bin.length < 1000 || bin[0] !== 0xe9) return json(res, { ok: false, error: 'the firmware file is damaged (magic byte)' });
        const m = bin.toString('latin1').match(/FWVER=([\d.]+)/);
        st.slots.other = { fw: st.fw, built: 'before' }; st.fw = m ? m[1] : st.fw; st.slots.running = st.slots.running === 'app0' ? 'app1' : 'app0';
        json(res, { ok: true, restarting: true }); return setTimeout(() => restart(), 300);
      }
      default: res.writeHead(404); return res.end('not found');
    }
  });
  const stream = http.createServer((req, res) => {
    if (st.faults.noCamera) { res.writeHead(500); return res.end('camera not available'); }
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=123456789000000000000987654321', 'Access-Control-Allow-Origin': '*' });
    const t = setInterval(() => { const v = view(); res.write(Buffer.concat([Buffer.from(`\r\n--123456789000000000000987654321\r\nContent-Type: image/jpeg\r\nContent-Length: ${v.length}\r\n\r\n`), v])); }, 100);
    req.on('close', () => clearInterval(t));
  });
  return new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(port, '127.0.0.1', () => {
      const p = api.address().port;
      stream.once('error', reject);
      stream.listen(p + 1, '127.0.0.1', () => resolve({
        port: p, host: `127.0.0.1:${p}`, state: st, room,
        pose: () => ({ x: Math.round(st.x), y: Math.round(st.y), heading: Math.round(st.head * 10) / 10 }),
        setFaults: (f) => { st.faults = { ...f }; },
        setFrame: (buf) => { st.frame = buf; st.frameAt = Date.now(); },
        place: (x, y, heading = 0) => { st.x = x; st.y = y; st.head = heading; st.trail = []; },
        close: () => { clearInterval(tick); api.close(); stream.close(); },
      }));
    });
  });
}

module.exports = { start, ROOM, rayDist };
