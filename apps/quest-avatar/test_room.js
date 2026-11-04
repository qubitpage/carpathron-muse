// "Carpathron in my room" end to end without a headset: Muse Carpathron backend (fake Meta API, SAM masks) + this
// Godot app rendering for real (xvfb). The app links to the PC, sends a picture as "the headset camera", Muse names
// the room's objects, the app puts markers in the room, you talk (text), Carpathron answers and walks to the chair.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFile } = require('child_process');
const DESKTOP = process.env.DESKTOP || path.join(__dirname, '..', 'desktop');
const GODOT = process.env.GODOT || 'godot';
const { WebSocket } = require(path.join(DESKTOP, 'node_modules', 'ws'));
(async () => {
  const fake = require(path.join(DESKTOP, 'test', 'fake-meta.js'));
  await fake.start(18741);
  const car = require(path.join(DESKTOP, 'test', 'fake-car.js')).start(18742, 18743, fs.readFileSync(path.join(DESKTOP, 'test', 'sample.jpg')));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-room-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18741/v1', engine: 'api', port: 18744, robot: { carIp: '127.0.0.1:18742' } }));
  if (process.env.MC_TEST_KOKORO) { fs.mkdirSync(path.join(dataDir, 'voices'), { recursive: true }); fs.symlinkSync(process.env.MC_TEST_KOKORO, path.join(dataDir, 'voices', 'kokoro-int8-en-v0_19')); }
  const { startServer } = require(path.join(DESKTOP, 'backend', 'server.js'));
  const srv = await startServer({ dataDir, log: () => {} });
  const ws = new WebSocket(`wss://localhost:18744/ws?t=${srv.token}`, { rejectUnauthorized: false });
  const events = [];
  ws.on('message', async (m) => {
    const e = JSON.parse(m); events.push(e.event);
    if (e.event === 'avatar:link') await fetch('https://localhost:18744/api/avatar/decide', { method: 'POST', headers: { 'x-mc-token': srv.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.data.id, allow: true }) });
  });
  await new Promise((r) => ws.on('open', r));
  const img = process.env.ROOM_IMAGE || path.join(DESKTOP, 'test', 'sample.jpg');
  const shot = process.env.ROOM_SHOT || '';
  const out = await new Promise((resolve) => execFile('xvfb-run', ['-a', GODOT, '--path', __dirname, '--resolution', '1280x800', '--', '--room-test', '--nav-sim', '--test-muse=127.0.0.1:18744', '--test-car=127.0.0.1:18742', `--room-image=${img}`, ...(shot ? [`--room-shot=${shot}`] : [])], { timeout: 150000, maxBuffer: 1 << 24 }, (_e, so, se) => resolve(String(so) + String(se))));
  const line = out.split('\n').find((l) => l.startsWith('ROOM_TEST '));
  if (!line) { console.log(out.split('\n').filter((l) => /ERROR|SCRIPT/.test(l)).slice(0, 20).join('\n')); console.log('ROOM TEST: FAILED (no result)'); process.exit(1); }
  const r = JSON.parse(line.slice(10));
  if (shot) {   // the last picture Muse got (what Robots > Live shows)
    const ac = new AbortController(); const res = await fetch('https://localhost:18744/api/avatar/view.mjpg', { headers: { 'x-mc-token': srv.token }, signal: ac.signal });
    const rd = res.body.getReader(); let buf = Buffer.alloc(0);
    while (true) { const { value, done } = await rd.read(); if (done) break; buf = Buffer.concat([buf, Buffer.from(value)]); const a = buf.indexOf(Buffer.from([0xff, 0xd8])), b = buf.indexOf(Buffer.from([0xff, 0xd9]), a + 2); if (a >= 0 && b > a) { fs.writeFileSync(shot.replace('.png', '-muse.jpg'), buf.slice(a, b + 2)); break; } }
    ac.abort();
  }
  console.log(JSON.stringify(r, null, 1));
  const view = await (await fetch('https://localhost:18744/api/avatar/view', { headers: { 'x-mc-token': srv.token } })).json();
  const checks = {
    linked: r.linked,
    'objects recognised -> markers in the room': ['person', 'chair', 'plant'].every((k) => r.anchors.includes(k)),
    'answered (model saw the room picture)': /chair/.test(r.say) && /picture/.test(r.say),
    'walked to the chair (stops beside it)': r.chair_after <= 0.5 && r.chair_after < r.chair_before - 0.1,
    'quick command: dance': r.danced && /moves/i.test(r.quick_say),
    'thinking state shown': r.states.includes('thinking'),
    'room picture behind the 3D for the PC view': r.view_bg,
    'PC view live (mode room)': !!view.live && view.mode === 'room',
    'companion events in Muse': events.includes('companion'),
    'guided driving: the headset brings the car to the chair (unknown heading, learns its speed)': r.nav_dist < 0.5 && Math.abs(r.nav_speed_learned - 0.42) < 0.12,
    'Baby Carpathron picked: mixed reality + camera window, no 3D robot': r.real && r.car_online && r.car_window,
    'talking to Baby Carpathron drives the real car': /forward/i.test(r.real_say) && car.log.some((d) => /l=[1-9]|ws:[1-9]/.test(d)),
    ...(process.env.MC_TEST_KOKORO ? { 'spoke in the headset (natural voice)': r.states.includes('speaking') } : {}),
  };
  let ok = true;
  for (const [k, v] of Object.entries(checks)) { console.log(v ? 'ok  ' : 'FAIL', k); if (!v) ok = false; }
  console.log(ok ? 'ROOM TEST: OK' : 'ROOM TEST: FAILED');
  ws.close(); car.close(); await srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
