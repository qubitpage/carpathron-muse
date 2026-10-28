// End-to-end test without a headset: Muse Carpathron backend (fake Meta API) + simulated robot + this Godot app headless.
// The app finds the PC, asks to link, the test clicks "Allow", then the app asks Muse and sends a voice command.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFile } = require('child_process');
const DESKTOP = process.env.DESKTOP || path.join(__dirname, '..', 'desktop');
const GODOT = process.env.GODOT || 'godot';
const { WebSocket } = require(path.join(DESKTOP, 'node_modules', 'ws'));
(async () => {
  const fake = require(path.join(DESKTOP, 'test', 'fake-meta.js'));
  await fake.start(18711);
  const car = require(path.join(DESKTOP, 'test', 'fake-car.js')).start(18712, 18713, fs.readFileSync(path.join(DESKTOP, 'test', 'sample.jpg')));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-e2e-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18711/v1', engine: 'api', port: 18714, robot: { carIp: '127.0.0.1:18712', turnMs360: 1200 } }));
  const { startServer } = require(path.join(DESKTOP, 'backend', 'server.js'));
  const srv = await startServer({ dataDir, log: () => {} });
  const ws = new WebSocket(`wss://localhost:18714/ws?t=${srv.token}`, { rejectUnauthorized: false });
  let linked = 0;
  ws.on('message', async (m) => {
    const e = JSON.parse(m);
    if (e.event === 'avatar:link') {
      linked++;
      await fetch('https://localhost:18714/api/avatar/decide', { method: 'POST', headers: { 'x-mc-token': srv.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.data.id, allow: true }) });
    }
  });
  await new Promise((r) => ws.on('open', r));
  // a short 48 kHz stereo WAV like the Quest microphone produces
  const n = 24000, w = Buffer.alloc(44 + n * 4);
  w.write('RIFF', 0); w.writeUInt32LE(36 + n * 4, 4); w.write('WAVE', 8); w.write('fmt ', 12); w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(2, 22); w.writeUInt32LE(48000, 24); w.writeUInt32LE(192000, 28); w.writeUInt16LE(4, 32); w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(n * 4, 40);
  const wav = path.join(os.tmpdir(), 'avatar-e2e.wav'); fs.writeFileSync(wav, w);
  const out = await new Promise((resolve) => execFile(GODOT, ['--headless', '--path', __dirname, '--', '--test-host=127.0.0.1:18712', '--test-muse=127.0.0.1:18714'], { env: { ...process.env, TEST_WAV: wav }, timeout: 60000, maxBuffer: 1 << 24 }, (_e, so, se) => resolve(String(so) + String(se))));
  const line = (out.match(/AVATAR_TEST (.*)/) || [])[1];
  if (!line) { console.error(out.slice(-3000)); process.exit(1); }
  const r = JSON.parse(line);
  const drives = car.log.filter((x) => x.startsWith('/drive') || x.startsWith('ws:'));
  console.log(JSON.stringify(r, null, 1), '\nlink approvals:', linked, '| car commands:', drives.slice(0, 4).join(' '), '…');
  const ok = r.frames > 5 && r.online && r.muse === 'linked' && /I can see the photo/.test(r.answer) && /Look left/.test(r.voice) && /Looking left/.test(r.voice) && linked === 1 && drives.some((d) => /l=-70&r=70|ws:-70,70/.test(d));
  console.log(ok ? 'AVATAR E2E: OK' : 'AVATAR E2E: FAILED');
  ws.close(); car.close(); await srv.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
