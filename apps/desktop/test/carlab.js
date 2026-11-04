// Tests for the robot tools: board profiles and pin checks, Car Settings (firmware 2.2 API) against the practice car,
// the health check with injected faults (dead camera, reversed motor, swapped sides, noisy laser, drifting gyro…),
// the practice car's physics, and the app routes.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { startServer } = require('../backend/server');
const C = require('../backend/carsettings');
const boards = require('../backend/boards');
const sim = require('../backend/simcar');

const PORT = 18660;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const byPart = (h, part) => h.items.find((x) => x.part === part) || {};

(async () => {
  await step('board profiles: every pin is sane, the ESP32-CAM has the expected free pins', () => {
    for (const b of Object.values(boards.BOARDS)) {
      assert.ok(b.pins.length > 10, b.id);
      const g = b.pins.filter((p) => p.gpio != null).map((p) => p.gpio);
      assert.strictEqual(new Set(g).size, g.length, `${b.id}: a GPIO is listed twice`);
    }
    const free = boards.BOARDS.esp32cam.pins.filter((p) => p.gpio != null && !p.level).map((p) => p.gpio);
    assert.deepStrictEqual(free.sort((a, b) => a - b), [13, 14]);
  });

  await step('settings schema matches the firmware table', () => {
    const ino = fs.readFileSync(path.join(__dirname, '../../../firmware/carpathron_car/carpathron_car.ino'), 'utf8');
    const table = [...ino.matchAll(/\{ "(\w+)", (-?\d+), (-?\d+), (-?\d+), (true|false) \}/g)].map((m) => ({ key: m[1], def: +m[2], lo: +m[3], hi: +m[4], restart: m[5] === 'true' }));
    assert.strictEqual(table.length, 32);
    for (const t of table) {
      const f = C.FIELDS[t.key];
      assert.ok(f, `missing ${t.key}`);
      assert.deepStrictEqual([f.def, f.min, f.max, !!f.restart], [t.def, t.lo, t.hi, t.restart], t.key);
      assert.ok(f.label && f.help && f.help.length > 20, `${t.key} explained`);
    }
  });

  await step('checks: ranges, camera pins, duplicates, a pin swap, hotspot password', () => {
    const v = C.DEFAULTS;
    assert.ok(C.check(v, 'maxPct', 10).errors.length);
    assert.ok(/not free/.test(C.check(v, 'rEn', 5).errors[0]));
    assert.ok(/already used/.test(C.check(v, 'rEn', 13).errors[0]));
    assert.ok(/headlight/.test(C.check(v, 'lBack', 4).errors[0]));
    const swap = C.checkAll(v, { rEn: 2, lEn: 12 });
    assert.ok(swap.ok && swap.warnings.lEn.length, 'swap allowed, boot pin warned');
    assert.ok(C.check(v, 'apPass', 'short').errors.length);
    assert.deepStrictEqual(C.check(v, 'trim', 5), { errors: [], warnings: [] });
  });

  await step('parts: planner on every board, default I2C pins, shared bus, no pin twice, starter code', () => {
    const PT = require('../backend/parts');
    for (const b of Object.keys(boards.BOARDS)) for (const part of PT.PARTS) {
      const r = PT.plan(b, part.id, {});
      const g = Object.values(r.assign);
      assert.strictEqual(new Set(g).size, g.length, `${b} ${part.id}: a pin twice`);
      for (const x of g) assert.notStrictEqual(boards.BOARDS[b].pins.find((p) => p.gpio === x).level, 'error', `${b} ${part.id}: reserved pin ${x}`);
    }
    assert.deepStrictEqual(PT.plan('esp32devkit', 'oled', {}).assign, { SDA: 21, SCL: 22 });
    assert.deepStrictEqual(PT.plan('uno', 'mpu6050', {}, { i2c: { sda: 18, scl: 19 } }).assign, { SDA: 18, SCL: 19 });
    const used = { 13: 'x', 14: 'y' };
    assert.ok(!Object.values(PT.plan('esp32cam', 'sg90', used).assign).some((g) => used[g]));
    assert.strictEqual(PT.plan('esp32cam', 'tb6612', { 1: 'a', 2: 'b', 3: 'c', 12: 'd', 13: 'e', 14: 'f', 15: 'g', 33: 'h' }).ok, false);
    const code = PT.starterCode('pico', [{ id: 'oled', part: 'oled', assign: { SDA: 4, SCL: 5 } }, { id: 'servo', part: 'sg90', assign: { signal: 15 } }]);
    assert.ok(/Wire.setSDA\(OLED_SDA\)/.test(code) && /#define SERVO_SIGNAL 15/.test(code) && /pinMode\(SERVO_SIGNAL, OUTPUT\)/.test(code));
  });

  await step('Mega sensor hub: bundled sketch, port picking (never the car), DHT11 + car link on the Mega pins, tool schema', () => {
    const fw = require('../backend/firmware');
    const PT = require('../backend/parts');
    const dir = fw.bundledMegaDir();
    assert.ok(dir && fs.existsSync(path.join(dir, 'carpathron_mega.ino')), 'the Mega sketch is bundled');
    const ino = fs.readFileSync(path.join(dir, 'carpathron_mega.ino'), 'utf8');
    assert.ok(/^\d+\.\d+\.\d+$/.test(fw.megaVersionOf(ino)));
    for (const pin of ['TRIG_PIN = 22', 'ECHO_PIN = 23', 'DHT_PIN = A0', 'Serial1.begin(115200)', '$CAR,']) assert.ok(ino.includes(pin), `sketch: ${pin}`);
    const car = fs.readFileSync(path.join(fw.bundledDir(), 'carpathron_car.ino'), 'utf8');
    assert.ok(/"\$CAR,"|startsWith\("CAR,"\)/.test(car) && /sensors=auto\|ir\|mega\|off/.test(car), 'car firmware understands the hub');
    const list = (ports) => JSON.stringify({ detected_ports: ports });
    const sp = (address, vid, pid, boards) => ({ port: { address, protocol: 'serial', properties: vid ? { vid, pid } : {} }, ...(boards ? { matching_boards: boards } : {}) });
    assert.deepStrictEqual(fw.pickMegaPort(list([sp('COM3', '0x1A86', '0x7523'), sp('COM5', '0x2341', '0x0042')]), 'COM3').address, 'COM5');
    assert.strictEqual(fw.pickMegaPort(list([sp('COM3', '0x1A86', '0x7523'), sp('COM7', '0x1A86', '0x7523', [{ fqbn: 'arduino:avr:mega' }])]), 'COM3').address, 'COM7');
    assert.strictEqual(fw.pickMegaPort(list([sp('COM3', '0x1A86', '0x7523')]), 'COM3'), null, 'never the car');
    assert.strictEqual(fw.pickMegaPort(list([sp('COM3', '0x1A86', '0x7523'), sp('COM9', '0x1A86', '0x7523')]), 'COM3').address, 'COM9', 'the only other USB board');
    assert.strictEqual(fw.pickMegaPort(list([sp('COM8', '0x1A86', '0x7523'), sp('COM9', '0x1A86', '0x7523')]), null), null, 'two unknown boards: ask');
    const used = {}; const placed = [];
    for (const [id, part, assign] of [['link', 'carlink', { TX: 18, RX: 19 }], ['eyes', 'hcsr04', { TRIG: 22, ECHO: 23 }], ['gyro', 'mpu6050', { SDA: 20, SCL: 21 }], ['climate', 'dht11', { DATA: 54 }]]) {
      placed.push({ id, part, assign });
      const chk = boards.checkPins(boards.BOARDS.mega2560, Object.fromEntries(Object.entries(assign).map(([r, g]) => [`${id}.${r}`, g])));
      assert.ok(!chk.some((x) => x.level === 'error'), `${part}: ${JSON.stringify(chk)}`);
      Object.values(assign).forEach((g) => { assert.ok(!used[g], `pin ${g} twice`); used[g] = id; });
    }
    assert.ok(PT.plan('mega2560', 'dht11', used).ok);
    assert.ok(PT.wires('mega2560', placed).length >= 12);
    const xt = require('../backend/xtools');
    const def = xt.XTOOLS.find((t) => t.name === 'robot_firmware');
    assert.ok(def && JSON.stringify(def).includes('"mega"'), 'robot_firmware has the mega action');
  });

  const car = await sim.start();
  await step('practice car: settings read, live change, restart change, pin swap, factory reset', async () => {
    const s = await C.getSettings(car.host);
    assert.strictEqual(s.fw, '2.4.2'); assert.strictEqual(s.values.rEn, 12);
    await C.setSetting(car.host, 'maxPct', 60);
    let s2 = await C.getSettings(car.host);
    assert.strictEqual(s2.values.maxPct, 60); assert.strictEqual(s2.restartPending, false);
    await assert.rejects(C.setSetting(car.host, 'rEn', 13), /already used/);
    await assert.rejects(C.setSetting(car.host, 'maxPct', 5), /between/);
    const r = await C.setMany(car.host, { rEn: 2, lEn: 12 });
    assert.ok(r.needsRestart); assert.strictEqual(r.values.rEn, 2); assert.strictEqual(r.active.rEn, 12, 'still using the old pin until the restart');
    await C.setSetting(car.host, 'name', 'Bolt');
    assert.strictEqual((await C.getSettings(car.host)).strings.name, 'Bolt');
    await C.restart(car.host); await sleep(400);
    s2 = await C.getSettings(car.host);
    assert.deepStrictEqual(s2.active, {}); assert.strictEqual(s2.restartPending, false);
    await C.factoryReset(car.host); await sleep(400);
    s2 = await C.getSettings(car.host);
    assert.strictEqual(s2.values.rEn, 12); assert.strictEqual(s2.values.maxPct, 100); assert.strictEqual(s2.strings.name, 'Practice car');
  });

  await step('practice car drives: forward moves, the laser stops it at the wall, gyro turn', async () => {
    const p0 = car.pose();
    for (let i = 0; i < 12; i++) { await fetch(`http://${car.host}/drive?l=80&r=80`); await sleep(100); }
    const p1 = car.pose();
    assert.ok(p1.x - p0.x > 20, `moved ${p1.x - p0.x} cm`);
    for (let i = 0; i < 40; i++) { await fetch(`http://${car.host}/drive?l=100&r=100`); await sleep(100); }
    const st = await (await fetch(`http://${car.host}/status`)).json();
    assert.ok(st.sensors.dist > 0 && st.sensors.dist < 260, `stopped at ${st.sensors.dist} mm`);
    assert.ok(car.pose().x < 250 - 8, 'did not drive into the box');
    await fetch(`http://${car.host}/turn?deg=90`);
    for (let i = 0; i < 60; i++) { const s = await (await fetch(`http://${car.host}/status`)).json(); if (!s.sensors.turning) break; await sleep(100); }
    const s = await (await fetch(`http://${car.host}/status`)).json();
    assert.strictEqual(s.sensors.turnResult, 1);
    assert.ok(Math.abs(car.pose().heading - 90) < 6, `heading ${car.pose().heading}`);
  });

  await step('health: a healthy car is all green, motors turn the expected way', async () => {
    const h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.strictEqual(h.summary, 'ok', JSON.stringify(h.items.filter((x) => x.status !== 'ok')));
    assert.strictEqual(byPart(h, 'motor-left').status, 'ok');
    assert.strictEqual(byPart(h, 'motor-right').status, 'ok');
    assert.strictEqual(byPart(h, 'tof').status, 'ok');
  });

  await step('health: faults are found and explained', async () => {
    car.setFaults({ noCamera: true, noPsram: true, weakWifi: true, gyroDrift: true });
    let h = C.health(await C.runDiag(car.host));
    assert.strictEqual(h.summary, 'bad');
    assert.ok(/ribbon cable/.test(byPart(h, 'camera').fix));
    assert.strictEqual(byPart(h, 'memory').status, 'warn');
    assert.strictEqual(byPart(h, 'wifi').status, 'bad');
    assert.ok(/drifts/.test(byPart(h, 'imu').title));
    car.setFaults({ deadRight: true });
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.strictEqual(byPart(h, 'motor-right').status, 'bad');
    assert.ok(/did not move/.test(byPart(h, 'motor-right').title));
    car.setFaults({ invertLeft: true });
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.strictEqual(byPart(h, 'motor-left').status, 'warn');
    assert.ok(/Left wheels turn the wrong way/.test(byPart(h, 'motor-left').fix), byPart(h, 'motor-left').fix);
    // the suggested fix really fixes it
    await C.setSetting(car.host, 'invL', 1);
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.strictEqual(byPart(h, 'motor-left').status, 'ok');
    await C.setSetting(car.host, 'invL', 0);
    car.setFaults({ swapSides: true }); car.place(120, 140, 0);
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.ok(/swapped \(driving straight/.test(byPart(h, "motor-left").fix), byPart(h, "motor-left").fix);
    car.setFaults({ invertLeft: true, invertRight: true }); car.place(120, 140, 0);
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.ok(/Both sides run backward/.test(byPart(h, "motor-right").fix), byPart(h, "motor-right").fix);
    car.setFaults({ noisyTof: true, cloneImu: true }); car.place(120, 140, 0);
    h = C.health(await C.runDiag(car.host));
    assert.strictEqual(byPart(h, 'tof').status, 'warn');
    assert.ok(/clone/.test(byPart(h, 'imu').detail));
    car.setFaults({ noImu: true, noTof: true });
    h = C.health(await C.runDiag(car.host, { motors: true }));
    assert.strictEqual(byPart(h, 'motor-left').status, 'info');
    car.setFaults({});
  });

  await step('health interpreter: odd camera codes, hotspot mode, crash restart, boot fix', () => {
    const base = { camera: { ok: false, error: 0x20002 }, memory: { psram: true }, wifi: { mode: 'hotspot', connected: false }, reset: { name: 'watchdog' }, i2c: { mode: 'off' }, tof: {}, imu: {}, pins: { rEn: 12 }, bootFix: false };
    const h = C.health(base);
    assert.ok(/smaller picture/.test(byPart(h, 'camera').fix));
    assert.ok(/hotspot/.test(byPart(h, 'wifi').title));
    assert.strictEqual(byPart(h, 'power').status, 'warn');
    assert.strictEqual(byPart(h, 'boot').status, 'warn');
    assert.strictEqual(byPart(h, 'i2c').status, 'skip');
  });
  await step('Wi-Fi update and undo: key checked, damaged file refused, rollback to the previous firmware', async () => {
    const fw = require('../backend/firmware');
    const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'carlab-ota-'));
    const key = fw.otaKey(tmpd);
    assert.match(key, /^[a-f0-9]{32}$/); assert.strictEqual(fw.otaKey(tmpd), key, 'the key stays');
    const c2 = await sim.start({ otaKey: key });
    const info = await fw.otaInfo(c2.host);
    assert.ok(info.ota && info.keySet && !info.other);
    const bin = path.join(tmpd, 'carpathron_car.ino.bin');
    fs.writeFileSync(bin, Buffer.concat([Buffer.from([0xe9]), Buffer.alloc(3000), Buffer.from('FWVER=2.3.1')]));
    assert.strictEqual((await fw.sendOta(c2.host, bin, 'wrong-key')).ok, false);
    const bad = path.join(tmpd, 'bad.bin'); fs.writeFileSync(bad, Buffer.alloc(3000));
    assert.ok(/damaged/.test((await fw.sendOta(c2.host, bad, key)).error));
    const r = await fw.sendOta(c2.host, bin, key);
    assert.ok(r.ok, JSON.stringify(r)); await sleep(500);
    assert.strictEqual((await C.getSettings(c2.host)).fw, '2.3.1');
    assert.ok((await fw.otaInfo(c2.host)).other.valid, 'the previous firmware is kept');
    assert.strictEqual((await fw.rollback(c2.host, 'nope')).ok, false);
    assert.ok((await fw.rollback(c2.host, key)).ok); await sleep(500);
    assert.strictEqual((await C.getSettings(c2.host)).fw, '2.4.2');
    // builds list keeps the newest 8
    for (let i = 0; i < 10; i++) { const d = fw.newBuildDir(tmpd, `2.2.${i}`); fs.writeFileSync(path.join(d, 'carpathron_car.ino.bin'), 'x'); fs.writeFileSync(path.join(d, 'build.json'), JSON.stringify({ version: `2.2.${i}`, at: new Date(Date.now() + i * 1000).toISOString() })); }
    const list = fw.listBuilds(tmpd);
    assert.ok(list.length <= 9 && list[list.length - 1].version === '2.2.9', JSON.stringify(list.map((x) => x.version)));
    // the key header the firmware includes
    fw.writeKey(tmpd, key);
    assert.ok(fs.readFileSync(path.join(tmpd, 'ota_key.h'), 'utf8').includes(`#define OTA_KEY "${key}"`));
    c2.close();
  });
  await step('calibration on the practice car: dead zone, straight, speed, laser, turn, camera', async () => {
    const { Calibrator } = require('../backend/calibrate');
    const c3 = await sim.start({ faults: { weakLeft: 0.92, gyroErr: 1.05 } });
    let app = { driveSpeed: 60, cmPerSec: 40 };
    let cam = { mean: 60, contrast: 25, saturation: 30, warmth: 0 };
    const cal = new Calibrator(c3.host, { appRobot: () => app, setAppRobot: (x) => { app = { ...app, ...x }; }, imageStats: () => { const v = c3.state.values; return { mean: 60 + v.ae * 20 + v.bright * 10, contrast: 25 + v.contr * 10, saturation: 30, warmth: 0 }; } });
    const g = await cal.run('gyro');
    assert.ok(g.ok, g.text);
    const dz = await cal.run('deadzone');
    assert.ok(dz.ok, dz.text);
    assert.ok(dz.applied.minDuty >= 140 && dz.applied.minDuty <= 175, dz.text); // the simulated motors stall below 140
    assert.strictEqual(c3.state.values.maxPct, 100); // restored
    c3.place(60, 140, 0);
    const st = await cal.run('straight');
    assert.ok(st.ok, st.text);
    assert.ok(st.applied.trim > 5, `a weak left motor needs more power left: ${st.text}`);
    c3.place(60, 140, 0);
    const sp = await cal.run('speed');
    assert.ok(sp.ok && app.cmPerSec > 10 && app.cmPerSec < 40, sp.text);
    c3.place(200, 140, 0); // 50 cm before the box at x=250
    const truth = sim.rayDist(c3.room, 200, 140, 0);
    const la = await cal.run('laser', { knownMm: Math.round(truth) });
    assert.ok(la.ok && Math.abs(la.applied.tofOff - 25) <= 6, la.text); // the simulated laser reads 25 mm long
    c3.place(120, 140, 0);
    const t1 = await cal.run('turn', { phase: 'run' });
    assert.ok(t1.waiting);
    const realDeg = c3.pose().heading; // the gyro reads 5 % high, so the car really turned less than 360
    assert.ok(realDeg < 352, `really turned ${realDeg}`);
    const t2 = await cal.run('turn', { phase: 'apply', errorDeg: Math.round(realDeg - 360) });
    assert.ok(t2.applied.gScale < 965 && t2.applied.gScale > 935, t2.text);
    c3.place(120, 140, 0);
    await cal.run('turn', { phase: 'run' });
    assert.ok(Math.abs(c3.pose().heading - 360) < 6, `after calibration: ${c3.pose().heading}`);
    const cm = await cal.run('camera');
    assert.ok(cm.ok && cm.applied.ae >= 1 && cm.applied.contr >= 1, cm.text);
    await assert.rejects(new Calibrator(c3.host).run('nope'), /Unknown/);
    c3.setFaults({ noImu: true });
    await assert.rejects(cal.run('straight'), /gyro/);
    c3.close();
  });
  await step('pin test on the car: motor and sensor pins refused, free pins answer', async () => {
    let r = await C.carJson(car.host, '/pin?gpio=13&mode=read');
    assert.ok(!r.ok && /motors/.test(r.error));
    r = await C.carJson(car.host, '/pin?gpio=5&mode=read');
    assert.ok(!r.ok && /not a free pin/.test(r.error));
    r = await C.carJson(car.host, '/pin?gpio=3&mode=read');
    assert.ok(!r.ok && /sensors/.test(r.error));
    await fetch(`http://${car.host}/config?sensors=off`); await sleep(100);
    r = await C.carJson(car.host, '/pin?gpio=3&mode=high');
    assert.ok(r.ok && r.level === 1, JSON.stringify(r));
    await fetch(`http://${car.host}/config?sensors=auto`); await sleep(100);
  });
  car.close();

  // ---- the app routes
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carlab-data-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'carlab-ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ workspace: ws, port: PORT, apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const api = async (p, body, method) => {
    const r = await fetch(`https://localhost:${PORT}${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'x-mc-token': srv.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  await step('app: schema, practice car, settings through the app, health, history', async () => {
    const sc = await api('/api/robot/car/schema');
    assert.ok(sc.groups.length >= 6 && sc.board.id === 'esp32cam');
    const noCar = await api('/api/robot/car/settings');
    assert.ok(/car address/.test(noCar.error));
    const pr = await api('/api/robot/car/practice', {});
    assert.ok(pr.running && /127\.0\.0\.1/.test(pr.host));
    const s = await api('/api/robot/car/settings');
    assert.strictEqual(s.fw, '2.4.2');
    const bad = await api('/api/robot/car/settings', { changes: { rEn: 5 } });
    assert.strictEqual(bad.ok, false); assert.ok(bad.errors.rEn);
    const good = await api('/api/robot/car/settings', { changes: { maxPct: 70, name: 'Rover', apPass: 'secret123' } });
    assert.ok(good.ok, JSON.stringify(good));
    assert.strictEqual((await api('/api/robot/car/settings')).values.maxPct, 70);
    const h = await api('/api/robot/car/diag', { motors: true });
    assert.strictEqual(h.summary, 'ok', JSON.stringify(h.items));
    const hist = await api('/api/robot/car/history');
    assert.ok(hist.some((e) => e.kind === 'settings' && e.changes.apPass === '••••' && e.before.maxPct === 100));
    assert.ok(hist.some((e) => e.kind === 'health'));
    const robot = await api('/api/robot');
    assert.ok(robot, 'robot status still works');
    const st = await api('/api/robot/car/practice');
    assert.ok(st.running && st.pose && st.room.w === 360);
  });
  await step('mapping on the practice car: laser sweep in the room scan, map v2 with landmarks, go to a point', async () => {
    await api('/api/robot/car/practice', { stop: true });
    await api('/api/robot/car/practice', {});
    for (let i = 0; i < 30 && (await api('/api/robot')).state !== 'online'; i++) await sleep(200);
    await api('/api/robot/pose', { reset: true });
    await api('/api/robot/scan', { steps: 4 });
    let maps = [];
    for (let i = 0; i < 120 && !maps.length; i++) { await sleep(500); maps = await api('/api/robot/maps'); }
    assert.ok(maps.length, 'a map was made');
    const map = await api(`/api/robot/maps/${maps[0].id}/map.json`);
    assert.strictEqual(map.version, 2);
    assert.ok(map.sweep && map.sweep.length >= 40, `sweep points: ${map.sweep && map.sweep.length}`);
    const ahead = map.sweep.find((q) => q.deg === 0);
    assert.ok(ahead && ahead.m && Math.abs(ahead.m - 1.30) < 0.12, `box 1.30 m ahead, laser says ${JSON.stringify(ahead)}`);
    const at = (d) => map.sweep.find((q) => q.deg === d) || map.sweep.find((q) => q.deg === d + 5) || map.sweep.find((q) => q.deg === d - 5);
    const left = at(270), right = at(90); // left: the room wall 1.40 m away; right: the edge of a box 0.60 m away
    assert.ok(left && left.m && Math.abs(left.m - 1.40) < 0.15, `left wall ${JSON.stringify(left)}`);
    assert.ok(right && right.m && Math.abs(right.m - 0.62) < 0.12, `box on the right ${JSON.stringify(right)}`);
    const svg = await fetch(`https://localhost:${PORT}/api/robot/maps/${maps[0].id}/map.svg`, { headers: { 'x-mc-token': srv.token } }).then((r) => r.text());
    assert.ok(/laser outline/.test(svg) && /#ff8a3d/.test(svg));
    // landmarks from a vision analysis are placed with the laser distance
    const { Mapper } = require('../backend/mapper');
    const lm = Mapper.landmarks({ pose: { x: 0, y: 0, heading: 0 }, sweep: map.sweep, analysis: { views: [{ heading: 0, objects: [{ name: 'red box', bearing: 0, distance_m: 1.6 }] }] } });
    assert.ok(lm[0].from === 'laser' && Math.abs(lm[0].distance_m - 1.30) < 0.12 && Math.abs(lm[0].y - lm[0].distance_m) < 0.01, JSON.stringify(lm));
    // go to a point 0.5 m ahead and 0.4 m right (with the speed the calibration measures on this practice car)
    await api('/api/settings', { robot: { cmPerSec: 27 } });
    await api('/api/robot/pose', { reset: true });
    const before = (await api('/api/robot/car/practice')).pose;
    const g = await api('/api/robot/goto-point', { x: 0.4, y: 0.5 });
    assert.ok(!g.error, g.error);
    const after = (await api('/api/robot/car/practice')).pose;
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    assert.ok(moved > 50 && moved < 80, `moved ${moved} cm: ${JSON.stringify(g)}`);
    assert.ok(after.y > before.y + 15, `went right (sim +y): ${JSON.stringify([before, after])}`);
    const parts = await api('/api/robot/parts');
    assert.ok(parts.boards.length === 6 && parts.parts.length >= 18);
    const plan = await api('/api/robot/parts/plan', { board: 'esp32devkit', part: 'hcsr04', used: {} });
    assert.ok(plan.ok && plan.assign.TRIG != null);
    assert.ok((await api('/api/robot/build', { board: 'uno', parts: [{ id: 'servo', part: 'sg90', assign: { signal: 9 } }] })).ok);
    assert.strictEqual((await api('/api/robot/build')).uno.parts[0].assign.signal, 9);
    const chk = await api('/api/robot/parts/check', { board: 'esp32cam', assign: { a: 16 } });
    assert.ok(chk.problems.some((x) => x.level === 'error'));
    assert.ok((await api('/api/robot/car/practice', { stop: true })).ok);
  });
  await step('missions: validation, run a blocks program on the practice car, stop, teach & repeat', async () => {
    const { validate } = require('../backend/missions');
    assert.throws(() => validate([{ op: 'rm -rf' }]), /Unknown step/);
    assert.throws(() => validate([{ op: 'if', cond: { op: 'eval' }, then: [] }]), /Unknown condition/);
    await api('/api/robot/car/practice', {});
    for (let i = 0; i < 30 && (await api('/api/robot')).state !== 'online'; i++) await sleep(200);
    const ready = await api('/api/robot/ready');
    const it = (id) => ready.items.find((x) => x.id === id) || {};
    assert.ok(it('connect').status === 'ok' && it('firmware').status === 'ok' && it('health').status === 'ok' && it('calibration').status === 'warn', JSON.stringify(ready.items));
    const p0 = (await api('/api/robot/car/practice')).pose;
    const prog = [{ op: 'say', text: 'Go' }, { op: 'repeat', n: 2, body: [{ op: 'forward', cm: 20 }, { op: 'turn', deg: 90 }] }, { op: 'if', cond: { op: 'dist_lt', cm: 500 }, then: [{ op: 'log', text: 'something ahead' }], else: [] }];
    const r = await api('/api/robot/missions/run', { program: prog, name: 'test' });
    assert.ok(r.started, JSON.stringify(r));
    let busy = true; for (let i = 0; i < 80 && busy; i++) { await sleep(250); busy = (await api('/api/robot/missions')).running; }
    assert.ok(!busy, 'mission finished');
    const p1 = (await api('/api/robot/car/practice')).pose;
    assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 15, `moved ${JSON.stringify([p0, p1])}`);
    assert.ok(Math.abs(((p1.heading - p0.heading) % 360 + 360) % 360 - 180) < 12, `turned 180: ${p0.heading} → ${p1.heading}`);
    // stop a long one
    await api('/api/robot/missions/run', { program: [{ op: 'wait', s: 20 }], name: 'long' });
    await sleep(300); await api('/api/robot/missions/stop', {});
    busy = true; for (let i = 0; i < 20 && busy; i++) { await sleep(150); busy = (await api('/api/robot/missions')).running; }
    assert.ok(!busy, 'stopped');
    // save / list / delete
    assert.ok((await api('/api/robot/missions/save', { name: 'Square', program: prog })).ok);
    assert.ok((await api('/api/robot/missions')).missions.some((x) => x.name === 'Square' && x.steps >= 5));
    // teach & repeat
    await api('/api/robot/missions/teach', { action: 'start' });
    await api('/api/robot/forward', { seconds: 1 });
    await sleep(600);
    const taught = await api('/api/robot/missions/teach', { action: 'stop', name: 'Taught one' });
    assert.ok(taught.ok && taught.mission.program.some((x) => x.op === 'drive' && x.left > 0 && x.ms >= 700), JSON.stringify(taught));
    const q0 = (await api('/api/robot/car/practice')).pose;
    await api('/api/robot/missions/run', { name: 'Taught one' });
    busy = true; for (let i = 0; i < 40 && busy; i++) { await sleep(200); busy = (await api('/api/robot/missions')).running; }
    const q1 = (await api('/api/robot/car/practice')).pose;
    assert.ok(Math.hypot(q1.x - q0.x, q1.y - q0.y) > 10, 'the taught drive was repeated');
    await api('/api/robot/missions/delete', { name: 'Square' });
    await api('/api/robot/car/practice', { stop: true });
  });
  await srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
