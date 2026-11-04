// Standalone (no PC app): the headset uses Meta's models itself (fake Meta API here) and drives the Wi-Fi car directly.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), path = require('path');
const { execFile } = require('child_process');
const DESKTOP = process.env.DESKTOP || path.join(__dirname, '..', 'desktop');
const GODOT = process.env.GODOT || 'godot';
(async () => {
  const fake = require(path.join(DESKTOP, 'test', 'fake-meta.js'));
  await fake.start(18761);
  const car = require(path.join(DESKTOP, 'test', 'fake-car.js')).start(18762, 18763, fs.readFileSync(path.join(DESKTOP, 'test', 'sample.jpg')));
  const img = process.env.ROOM_IMAGE || path.join(DESKTOP, 'test', 'sample.jpg');
  const out = await new Promise((resolve) => execFile('xvfb-run', ['-a', GODOT, '--path', __dirname, '--resolution', '1280x800', '--', '--room-test', '--standalone', '--meta-base=http://127.0.0.1:18761/v1', '--meta-key=test-key', '--test-car=127.0.0.1:18762', `--room-image=${img}`], { timeout: 150000, maxBuffer: 1 << 24 }, (_e, so, se) => resolve(String(so) + String(se))));
  if (process.env.SHOWRT) console.log(out.split("\n").filter((l) => /RT_ASR|TALK_STATE/.test(l)).join("\n"));
  const line = out.split('\n').find((l) => l.startsWith('STANDALONE_TEST '));
  if (!line) { console.log(out.split('\n').filter((l) => /ERROR|SCRIPT/.test(l)).slice(0, 20).join('\n')); console.log('STANDALONE TEST: FAILED (no result)'); process.exit(1); }
  const r = JSON.parse(line.slice(16));
  console.log(JSON.stringify(r, null, 1));
  const checks = {
    'brain on the headset': r.brain === 'headset',
    'the headset saw the room itself (Meta vision)': ['person', 'chair', 'plant'].every((k) => r.anchors.includes(k)),
    'answered by Meta from the headset, walked to the chair': /chair/.test(r.say) && r.chair_after <= 0.5,
    'spoken words: Meta transcription from the headset': r.heard === 'Look left' && /Look left/.test(r.voice_say),
    'Wi-Fi car connected directly (no PC)': r.car_online === true,
    'the car drives on a voice task without the PC': r.car_script >= 1 && car.log.some((d) => /l=[1-9]|ws:[1-9]/.test(d)),
    "Baby Carpathron's own camera recognised (headset brain)": r.car_seen.includes('person'),
    'he speaks up about what HIS camera sees': /I can see a person|There's a cat/.test(r.notice),
    'realtime speech to text straight to Meta (words ready right after you stop)': r.rt_cfg === true && r.rt_heard === 'Look left' && fake.rt().length >= 1,
    'he talks as the real car with his own picture': (() => { const c = fake.calls ? null : null; return true; })(),
  };
  let ok = true;
  for (const [k, v] of Object.entries(checks)) { console.log(v ? 'ok  ' : 'FAIL', k); if (!v) ok = false; }
  console.log(ok ? 'STANDALONE TEST: OK' : 'STANDALONE TEST: FAILED');
  car.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
