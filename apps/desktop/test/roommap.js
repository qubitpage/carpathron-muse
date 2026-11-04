// Tests for the room map the car learns (Robot → 🗺 Map): the occupancy grid and path planner on a drawn room, then the
// real thing on the practice car — measure all around, explore, the map matches the practice room's walls, places,
// put the robot somewhere, plan a way around a box and drive it, patrol, stop.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { Grid, RES } = require('../backend/roommap');

const PORT = 18676;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // a 3 × 3 m room drawn with laser rays from its centre, with a wall piece between the car and the goal
  const room = new Grid();
  const wallAt = (x, y) => Math.abs(x) >= 1.5 || Math.abs(y) >= 1.5 || (y > 0.55 && y < 0.65 && x > -0.8 && x < 0.8);
  const rayLen = (x, y, deg) => { const a = (deg * Math.PI) / 180; for (let d = 0.02; d < 2; d += 0.01) if (wallAt(x + Math.sin(a) * (d + 0.1), y + Math.cos(a) * (d + 0.1))) return d; return null; };
  for (const [x, y] of [[0, 0], [0, -1], [1, 0], [-1, 0], [0, 1.1], [1, 1.1], [-1, 1.1]]) for (let deg = 0; deg < 360; deg += 2) for (let k = 0; k < 2; k++) room.ray(x, y, deg, rayLen(x, y, deg));

  await step('grid: free floor and solid walls where the laser says', () => {
    const at = (x, y) => room.get(...Grid.cell(x, y));
    assert.ok(at(0, 0) < -10 && at(0.5, -0.5) < -10, 'floor is free');
    assert.ok(at(0, 0.6) >= 25, `wall piece is solid (${at(0, 0.6)})`);
    assert.ok(at(1.52, 0) >= 25 || at(1.47, 0) >= 25, 'outer wall is solid');
    assert.strictEqual(at(4, 4), 0, 'outside: never seen');
    const st = room.stats(); assert.ok(st.freeM2 > 4 && st.freeM2 < 9.5, JSON.stringify(st));
  });
  await step('2.2.2: a felt step / drop / bump goes on the map and routes keep away from it', () => {
    const { RoomMap } = require('../backend/roommap');
    const ws0 = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-hz-'));
    const robot = { pose: { x: 0, y: 0, heading: 0 }, state: 'offline', current: {} };
    const rm = new RoomMap({ robot, mapper: {}, getSettings: () => ({ workspace: ws0 }), emit: () => {}, log: () => {} });
    const g = new Grid(room.toJSON()); rm.grid = g;
    rm.feel({ bumps: 0, tiltStops: 0, cliffStops: 0 });
    assert.strictEqual(rm.hazards.length, 0, 'the first reading only remembers the counters');
    robot.pose = { x: 0, y: -0.5, heading: 0 };
    rm.feel({ bumps: 0, tiltStops: 1, cliffStops: 0, hazard: 'step', hazardDir: 1 });
    assert.strictEqual(rm.hazards.length, 1); assert.strictEqual(rm.hazards[0].kind, 'step');
    assert.ok(Math.abs(rm.hazards[0].y - -0.3) < 0.02 && Math.abs(rm.hazards[0].x) < 0.02, JSON.stringify(rm.hazards[0]));
    const r = g.plan(0, -1, 0, 0.2, rm.hazards);
    assert.ok(r, 'still a way round');
    for (let i = 0; i < r.length; i++) { const a = i ? r[i - 1] : { x: 0, y: -1 }, b = r[i]; for (let k = 0; k <= 20; k++) { const x = a.x + ((b.x - a.x) * k) / 20, y = a.y + ((b.y - a.y) * k) / 20; assert.ok(Math.hypot(x - 0, y - -0.3) > 0.2, `route passes the step at ${x.toFixed(2)},${y.toFixed(2)}`); } }
    robot.pose = { x: 0.8, y: -0.8, heading: 90 };
    rm.feel({ bumps: 1, tiltStops: 1, cliffStops: 1, hazard: 'drop', hazardDir: 1 });
    assert.deepStrictEqual(rm.hazards.map((h) => h.kind).sort(), ['bump', 'drop', 'step'], JSON.stringify(rm.hazards));
    assert.ok(g.get(...Grid.cell(1.0, -0.8)) >= 25, 'a bump spot is solid on the map');
    rm.close();
  });
  await step('2.2.2: Find — a known object: drives to ~40 cm before it, then the camera finishes', async () => {
    const { RoomMap } = require('../backend/roommap');
    const ws0 = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-find-'));
    const robot = { pose: { x: 0, y: -1, heading: 0 }, state: 'offline', current: {}, stop() {} };
    const calls = [];
    const mapper = { vision: {}, scan: async () => calls.push('scan'), turn: async (d) => calls.push(`turn ${Math.round(d)}`),
      goto: async (t, o) => { calls.push(`camera ${t} ${o.stopAt}`); return { arrived: true, found: true }; } };
    const rm = new RoomMap({ robot, mapper, getSettings: () => ({ workspace: ws0 }), emit: () => {}, log: () => {} });
    rm.grid = new Grid(room.toJSON()); rm.objects = [{ name: 'chair', x: 0.9, y: 0.2 }];
    rm.driveTo = async (x, y, label) => { calls.push(`drive ${x.toFixed(2)},${y.toFixed(2)} ${label}`); robot.pose = { x, y, heading: 0 }; return { ok: true }; };
    const r = await rm.find('Chair');
    assert.ok(r.ok && /Found the chair/.test(r.text), JSON.stringify(r));
    const d = calls.find((c) => c.startsWith('drive')); const [x, y] = d.split(' ')[1].split(',').map(Number);
    assert.ok(Math.abs(Math.hypot(0.9 - x, 0.2 - y) - 0.4) < 0.03, `stops ~40 cm before: ${d}`);
    assert.ok(calls.some((c) => /^camera chair 0.35/.test(c)) && !calls.includes('scan'), calls.join(' | '));
    // 2.3.4: not on the map: the camera looks around step by step right away (no full photo scan / laser spins first)
    calls.length = 0; rm.objects = []; rm.grid = new Grid();
    const r3 = await rm.find('dog', { rounds: 2 });
    assert.ok(r3.ok && /Found the dog/.test(r3.text) && calls[0] === 'camera dog 0.35' && !calls.includes('scan'), JSON.stringify(r3) + calls.join('|'));
    // nowhere around: gives up without spinning through photo scans
    calls.length = 0;
    mapper.goto = async (t, o) => { calls.push(`camera ${t} ${o.stopAt}`); return { found: false }; };
    const r2 = await rm.find('shoe', { rounds: 2 });
    assert.ok(!r2.ok && /couldn't find the shoe/.test(r2.text) && !calls.includes('scan') && calls.filter((c) => c.startsWith('camera shoe')).length >= 1, JSON.stringify(r2) + calls.join('|'));
    rm.close();
  });
  await step('2.2.2: map driving never goes forward blind and stops after a bump', async () => {
    const { Mapper } = require('../backend/mapper');
    let sens = { tof: false, mega: false, linkLost: true, dist: -1 }, moved = 0;
    const robot = { pose: { x: 0, y: 0, heading: 0 }, status: () => ({ state: 'online' }), sensors: async () => sens };
    const m = new Mapper({ robot, getSettings: () => ({ robot: {} }), emit: () => {}, log: () => {} });
    m.forward = async (d) => { moved += d; robot.pose = { ...robot.pose, y: robot.pose.y + d }; if (sens.bumpNext) sens = { ...sens, bumps: 1 }; };
    m.turn = async () => {};
    const t0 = Date.now(); const r = await m.gotoPoint(0, 1);
    assert.ok(r.blocked && moved === 0, `blind: ${JSON.stringify(r)} moved ${moved}`);
    assert.ok(Date.now() - t0 > 3000, 'it waited for the sensor to come back first');
    sens = { tof: true, mega: true, dist: 1500, stopMm: 300, bumps: 0, tiltStops: 0, cliffStops: 0, bumpNext: true }; moved = 0; robot.pose = { x: 0, y: 0, heading: 0 };
    const r2 = await m.gotoPoint(0, 1.5);
    assert.ok(r2.blocked && Math.abs(moved - 0.3) < 0.01, `bump: ${JSON.stringify(r2)} moved ${moved}`);
    sens = { tof: true, mega: true, dist: 500, stopMm: 300, bumps: 0 }; moved = 0;
    const r3 = await m.gotoPoint(0, 2);
    assert.ok(r3.blocked && moved === 0, `50 cm free < 30 cm hop + 35 cm: ${JSON.stringify(r3)}`);
  });
  await step('path planner: goes around the wall piece, keeps away from walls, refuses unreachable points', () => {
    const r = room.plan(0, 0, 0, 1.1);
    assert.ok(r && r.length >= 2, JSON.stringify(r));
    for (let i = 0; i < r.length; i++) { const a = i ? r[i - 1] : { x: 0, y: 0 }, b = r[i]; for (let s = 0; s <= 20; s++) { const x = a.x + ((b.x - a.x) * s) / 20, y = a.y + ((b.y - a.y) * s) / 20; assert.ok(room.get(...Grid.cell(x, y)) < 25, `path crosses a wall at ${x.toFixed(2)},${y.toFixed(2)}`); } }
    assert.ok(r.some((p) => Math.abs(p.x) > 0.8), 'goes around the end of the wall piece');
    const last = r[r.length - 1]; assert.ok(Math.hypot(last.x, last.y - 1.1) < 0.15, JSON.stringify(last));
    assert.strictEqual(room.plan(0, 0, 3, 0), null, 'outside the walls: no way');
  });
  await step('frontier: the nearest edge of unknown floor, away from walls', () => {
    const g = new Grid(); for (let deg = 0; deg < 360; deg += 3) g.ray(0, 0, deg, null);
    const f = g.frontier(0, 0); assert.ok(f && f.d > 0.35 && f.d < 1.7, JSON.stringify(f));
    assert.strictEqual(room.frontier(0, 0), null, 'a closed room has no frontier');
  });
  await step('save / load keeps the grid', () => { const g2 = new Grid(room.toJSON()); assert.deepStrictEqual(Array.from(g2.v.slice(0, 50000)), Array.from(room.v.slice(0, 50000))); assert.strictEqual(RES, 0.05); });

  // ---- on the practice car
  const { startServer } = require('../backend/server');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-data-')), ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ workspace: ws, port: PORT, apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api', robot: { cmPerSec: 27, driveSpeed: 60 } }));
  const srv = await startServer({ dataDir, log: () => {} });
  const api = async (p, body) => (await fetch(`https://localhost:${PORT}${p}`, { method: body ? 'POST' : 'GET', headers: { 'x-mc-token': srv.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  const waitIdle = async (ms) => { const t = Date.now(); await sleep(400); while (Date.now() - t < ms) { const v = await api('/api/robot/roommap'); if (!v.busy) return v; await sleep(400); } throw new Error('still busy'); };
  try {
    await api('/api/robot/car/practice', {});
    for (let i = 0; i < 30 && (await api('/api/robot')).state !== 'online'; i++) await sleep(300);
    await step('measure all around on the practice car: the walls it sees are where the practice room has them', async () => {
      assert.ok((await api('/api/robot/roommap/measure', {})).started);
      const v = await waitIdle(40000);
      assert.ok(v.stats.freeM2 > 2, JSON.stringify(v.stats));
      assert.ok(v.stats.solidCells > 20, JSON.stringify(v.stats));
      // practice room: 360 × 280 cm, the car starts at (120, 140) facing east (+x) → map: ahead = east, right = south
      const pr = await api('/api/robot/car/practice'); const room = pr.room, st = room.start;
      const g = new Grid(); g.v = Int8Array.from(Buffer.from((await (async () => { const f = path.join(ws, 'maps', 'room-map.json'); for (let i = 0; i < 20 && !fs.existsSync(f); i++) await sleep(300); return JSON.parse(fs.readFileSync(f, 'utf8')).grid; })()), 'base64'));
      let good = 0, bad = 0;
      for (let j = 0; j < 240; j++) for (let i = 0; i < 240; i++) {
        const val = g.v[j * 240 + i]; if (val < 25) continue;
        const [mx, my] = Grid.centre(i, j); const sx = st[0] + my * 100, sy = st[1] + mx * 100; // map (x right, y ahead) → simulator cm
        const nearWall = sx < 15 || sy < 15 || sx > room.w - 15 || sy > room.h - 15 || room.boxes.some(([x1, y1, x2, y2]) => sx > x1 - 15 && sx < x2 + 15 && sy > y1 - 15 && sy < y2 + 15);
        if (nearWall) good++; else bad++;
      }
      console.log(`      solid cells on a real wall or box: ${good}, elsewhere: ${bad}`);
      assert.ok(good > 15 && bad <= good * 0.15, `${good} / ${bad}`);
    });
    await step('places: name a place, list, remove; bad input refused', async () => {
      assert.ok((await api('/api/robot/roommap/place', { name: 'Door', x: 0.5, y: 0.6 })).ok);
      assert.ok((await api('/api/robot/roommap/place', { name: 'Charger', x: -0.4, y: -0.3 })).places.length === 2);
      assert.ok(/name/.test((await api('/api/robot/roommap/place', { name: ' ', x: 0, y: 0 })).error));
      assert.deepStrictEqual((await api('/api/robot/roommap/unplace', { name: 'Charger' })).places.map((p) => p.name), ['Door']);
      const v = await api('/api/robot/roommap'); assert.deepStrictEqual(v.places, [{ name: 'Door', x: 0.5, y: 0.6 }]);
    });
    await step('go to a place on the map: plans a route and the car arrives', async () => {
      const r = await api('/api/robot/roommap/gotoplace', { name: 'door' });
      assert.ok(r.started, JSON.stringify(r));
      await waitIdle(60000);
      const pose = (await api('/api/robot')).pose, pr = await api('/api/robot/car/practice/pose'), st = (await api('/api/robot/car/practice')).room.start;
      const real = { x: (pr.y - st[1]) / 100, y: (pr.x - st[0]) / 100 };
      console.log(`      car thinks (${pose.x}, ${pose.y}); really (${real.x.toFixed(2)}, ${real.y.toFixed(2)})`);
      assert.ok(Math.hypot(real.x - 0.5, real.y - 0.6) < 0.3, `really arrived near the door: ${JSON.stringify(real)}`);
    });
    await step('put the robot here: position and heading set, gyro keeps working', async () => {
      const r = await api('/api/robot/roommap/pose', { x: 1, y: 2, heading: 90 });
      assert.deepStrictEqual([r.pose.x, r.pose.y, Math.round(r.pose.heading)], [1, 2, 90]);
      await api('/api/robot/roommap/pose', { x: 0.5, y: 0.6, heading: (await api('/api/robot')).pose.heading });
    });
    await step('stop: a patrol stops at once; busy is refused meanwhile', async () => {
      assert.ok((await api('/api/robot/roommap/patrol', { points: [{ x: 0.3, y: 0 }, { x: 0.5, y: 0.6 }], loops: 5 })).started);
      await sleep(600);
      assert.ok(/busy/.test((await api('/api/robot/roommap/measure', {})).error));
      await api('/api/robot/roommap/stop', {});
      const v = await waitIdle(15000); assert.strictEqual(v.busy, null);
      assert.ok(/at least 2/.test((await api('/api/robot/roommap/patrol', { points: [{ x: 0, y: 0 }] })).error));
    });
    await step('explore: drives to unknown parts and learns more of the room', async () => {
      const before = (await api('/api/robot/roommap')).stats.freeM2;
      assert.ok((await api('/api/robot/roommap/explore', { rounds: 3 })).started);
      const v = await waitIdle(240000);
      console.log(`      floor known: ${before} → ${v.stats.freeM2} m²`);
      assert.ok(v.stats.freeM2 >= before + 0.5, `${before} → ${v.stats.freeM2}`);
      assert.ok(v.stats.freeM2 < 10.08 * 1.15, 'not more floor than the room has');
    });
    await step('a new map starts empty and keeps the old one as a file', async () => {
      await api('/api/robot/roommap/reset', {});
      const v = await api('/api/robot/roommap'); assert.ok(v.stats.freeM2 < 0.5 && !v.places.length);
      assert.ok(fs.readdirSync(path.join(ws, 'maps')).some((f) => /^room-map-.+\.json$/.test(f)));
    });
  } finally { await srv.close(); }
  const fail = results.filter((r) => r[0] === 'FAIL');
  console.log(`\nroommap: ${results.length - fail.length}/${results.length} passed`);
  process.exit(fail.length ? 1 : 0);
})();
