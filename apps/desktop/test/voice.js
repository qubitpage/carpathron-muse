// Tests for the robot's own voice: the robot effect, the voice download (served locally here), every voice spoken AND
// understood by speech recognition (Whisper), the "Carpathron" pronunciation, the server sending the sound with
// robot:say in order, and the fallbacks (voice not downloaded → plain text for the browser voice).
// Needs the models: MC_TEST_MODELS=<dir with kokoro-int8-en-v0_19, kitten-nano-en-v0_1-fp16, sherpa-onnx-whisper-tiny.en>
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { WebSocket } = require('ws');
const fx = require('../backend/robotfx');
const { Tts, VOICES, MODELS } = require('../backend/tts');

const M = process.env.MC_TEST_MODELS;
const LIB = path.join(__dirname, '../build/voice-engine/node_modules', `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
if (M && process.platform === 'linux' && !String(process.env.LD_LIBRARY_PATH || '').includes(LIB)) { // the recogniser runs in this process
  const r = require('child_process').spawnSync(process.execPath, [__filename], { stdio: 'inherit', env: { ...process.env, LD_LIBRARY_PATH: `${LIB}:${process.env.LD_LIBRARY_PATH || ''}` } });
  process.exit(r.status == null ? 1 : r.status);
}
const PORT = 18672;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const words = (t) => t.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = words(ref), h = words(hyp), d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0][j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return d[r.length][h.length] / r.length;
}
function readWav(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF'); assert.strictEqual(b.toString('ascii', 8, 12), 'WAVE');
  const rate = b.readUInt32LE(24), n = (b.length - 44) / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return { rate, samples: x };
}

(async () => {
  await step('robot effect: pitch-up keeps the length natural, loud but never clipped, valid WAV', () => {
    const rate = 24000, x = new Float32Array(rate).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 180 * i) / rate));
    for (const p of Object.keys(fx.PRESETS)) {
      const y = fx.robotize(x, rate, p);
      assert.ok(Math.abs(y.length * Math.pow(2, fx.PRESETS[p].semis / 12) - x.length) < 4, p);
      let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
      assert.ok(peak > 0.5 && peak <= 1, `${p} peak ${peak}`);
      assert.ok(Math.abs(fx.speedFor(p) * Math.pow(2, fx.PRESETS[p].semis / 12) - 1) < 1e-9);
    }
    const w = fx.wav(new Float32Array([0, 0.5, -0.5, 1]), 24000);
    assert.strictEqual(w.length, 52); assert.strictEqual(w.readInt16LE(46), 16384); assert.strictEqual(w.readInt16LE(50), 32767);
  });

  if (!M) { console.log('  (MC_TEST_MODELS not set — neural voice tests skipped)'); return finish(); }
  const sherpa = require(path.join(__dirname, '../build/voice-engine/node_modules/sherpa-onnx-node'));
  const W = path.join(M, 'sherpa-onnx-whisper-tiny.en');
  const asr = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { whisper: { encoder: `${W}/tiny.en-encoder.int8.onnx`, decoder: `${W}/tiny.en-decoder.int8.onnx` }, tokens: `${W}/tiny.en-tokens.txt`, numThreads: 2, provider: 'cpu', debug: 0 } });
  const hear = (file) => { const a = readWav(file); const s = asr.createStream(); s.acceptWaveform({ sampleRate: a.rate, samples: a.samples }); asr.decode(s); return asr.getResult(s).text.trim(); };

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-data-'));
  const settings = { robot: {} };
  const tts = new Tts({ dataDir, getSettings: () => settings });

  await step('before download: nothing is ready, the engine is found, every voice listed', () => {
    const s = tts.status();
    assert.ok(s.engine, 'speech engine found in build/voice-engine');
    assert.strictEqual(s.voice, 'bella');
    assert.strictEqual(s.voices.length, Object.keys(VOICES).length);
    assert.ok(s.voices.every((v) => !v.ready) && !tts.ready());
  });

  await step('download: progress, unpack, installed (light voice served from a local server)', async () => {
    const pack = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voice-pack-')), 'kitten.tar.bz2');
    execFileSync('tar', ['-cjf', pack, '-C', M, MODELS.kitten.name]);
    const srv = http.createServer((q, r) => { if (q.url !== '/kitten.tar.bz2') { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Length': fs.statSync(pack).size }); fs.createReadStream(pack).pipe(r); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const saved = MODELS.kitten.url;
    MODELS.kitten.url = `http://127.0.0.1:${srv.address().port}/kitten.tar.bz2`;
    const seen = [];
    try { assert.deepStrictEqual(await tts.download('kitten', (p) => seen.push(p)), { ok: true }); }
    finally { MODELS.kitten.url = saved; srv.close(); }
    assert.ok(seen.length > 5 && seen[seen.length - 1] === 100, `progress ${seen.slice(-3)}`);
    assert.ok(tts.installed('kitten') && !fs.readdirSync(tts.dir).some((f) => f.endsWith('.part')), 'unpacked, temp file removed');
    assert.ok(tts.ready('kitten') && !tts.ready('bella'));
    // a broken download is reported and leaves nothing behind
    const bad = http.createServer((q, r) => { r.writeHead(404); r.end(); });
    await new Promise((r) => bad.listen(0, '127.0.0.1', r));
    MODELS.kokoro.url = `http://127.0.0.1:${bad.address().port}/x`;
    await assert.rejects(tts.download('kokoro'), /HTTP 404/);
    bad.close();
    assert.ok(!tts.installed('kokoro') && !tts.status().models.kokoro.downloading);
  });
  // the big voice: linked in instead of downloading 100 MB again
  fs.symlinkSync(path.join(M, MODELS.kokoro.name), path.join(tts.dir, MODELS.kokoro.name));

  const TEXT = 'Hello! I am Baby Carpathron. I found the red chair, and the door is on my left.';
  for (const id of Object.keys(VOICES)) {
    await step(`voice "${VOICES[id].label}": spoken, robot sound, understood by speech recognition`, async () => {
      const r = await tts.speak(TEXT, { voice: id });
      assert.ok(r.url === `/api/robot/voice/audio/${r.id}.wav` && tts.file(`${r.id}.wav`), 'served file');
      assert.ok(r.secs > 2.5 && r.secs < 9, `natural length: ${r.secs.toFixed(1)} s`);
      const heard = hear(r.file), e = wer(TEXT.replace('Carpathron', 'car path ron'), heard.replace(/carpathron/i, 'car path ron'));
      console.log(`      heard: "${heard}"  (word errors ${(e * 100).toFixed(0)} %, made in ${r.ms} ms)`);
      assert.ok(e <= 0.3, `too hard to understand (${(e * 100).toFixed(0)} % wrong)`);
      assert.ok(/\b(chair|door|left)\b/i.test(heard) && /\bhello\b/i.test(heard), heard);
    });
  }

  await step('"Carpathron" is said as "Car-path-ron" (not spelled out), numbers and units are spoken', async () => {
    const r = await tts.speak('Carpathron is 30 cm from the wall.', { voice: 'bella' });
    const heard = hear(r.file).toLowerCase();
    console.log(`      heard: "${heard}"`);
    assert.ok(/car\s*-?\s*path|carpath|car pat/.test(heard), heard);
    assert.ok(/centimet|30|thirty/.test(heard), heard);
  });

  await step('file names are safe; old sounds are cleaned up; the worker restarts after a crash', async () => {
    assert.strictEqual(tts.file('../settings.json'), null); assert.strictEqual(tts.file('abc.wav'), null);
    const old = path.join(tts.outDir, 'aaaaaaaaaaaa.wav'); fs.writeFileSync(old, 'x'); const t = new Date(Date.now() - 3600e3); fs.utimesSync(old, t, t);
    tts.cleanup(); assert.ok(!fs.existsSync(old));
    tts.worker.kill(); await new Promise((r) => setTimeout(r, 300));
    const r = await tts.speak('Still here!', { voice: 'kitten' }); assert.ok(r.secs > 0.4);
  });
  tts.close();

  // ---- the app: robot:say carries the sound, in order; a missing voice falls back to plain text
  await step('server: Say → robot:say with the sound (in order); voice list, choose, sample, audio route', async () => {
    const { startServer } = require('../backend/server');
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-srv-'));
    fs.mkdirSync(path.join(dd, 'voices'), { recursive: true });
    fs.symlinkSync(path.join(M, MODELS.kitten.name), path.join(dd, 'voices', MODELS.kitten.name));
    fs.writeFileSync(path.join(dd, 'settings.json'), JSON.stringify({ workspace: dd, port: PORT, apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api' }));
    const srv = await startServer({ dataDir: dd, log: () => {} });
    const base = `https://localhost:${PORT}`, H = { 'x-mc-token': srv.token, 'Content-Type': 'application/json' };
    const api = async (p, body) => (await fetch(base + p, { method: body ? 'POST' : 'GET', headers: H, body: body ? JSON.stringify(body) : undefined })).json();
    const sock = new WebSocket(`wss://localhost:${PORT}/ws?t=${srv.token}`, { rejectUnauthorized: false });
    const says = [];
    sock.on('message', (m) => { const j = JSON.parse(m); if (j.event === 'robot:say') says.push(j.data); });
    await new Promise((r) => sock.on('open', r));
    try {
      let s = await api('/api/robot/voice/status');
      assert.ok(s.engine && s.models.kitten.installed && !s.models.kokoro.installed);
      // default voice (Bella) is not downloaded → plain text, the browser voice speaks it
      await api('/api/robot/say', { text: 'One.' });
      await new Promise((r) => setTimeout(r, 300));
      assert.ok(says.length === 1 && !says[0].audio, JSON.stringify(says));
      assert.deepStrictEqual(await api('/api/robot/voice/choose', { voice: 'nobody' }), { error: 'Unknown voice.' });
      assert.ok((await api('/api/robot/voice/choose', { voice: 'kitten' })).ok);
      s = await api('/api/robot/voice/status'); assert.strictEqual(s.voice, 'kitten');
      for (const t of ['First sentence.', 'Second sentence, a bit longer than the first one.', 'Third.']) await api('/api/robot/say', { text: t });
      for (let i = 0; i < 100 && says.length < 4; i++) await new Promise((r) => setTimeout(r, 100));
      assert.deepStrictEqual(says.slice(1).map((d) => d.text), ['First sentence.', 'Second sentence, a bit longer than the first one.', 'Third.'], 'in order');
      assert.ok(says.slice(1).every((d) => /^\/api\/robot\/voice\/audio\/[a-f0-9]{12}\.wav$/.test(d.audio)));
      const a = await fetch(base + says[2].audio, { headers: H });
      assert.ok(a.ok && a.headers.get('content-type') === 'audio/wav');
      assert.strictEqual(Buffer.from(await a.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
      assert.strictEqual((await fetch(base + says[2].audio)).status, 401, 'needs the access token');
      assert.strictEqual((await fetch(`${base}/api/robot/voice/audio/..%2Fsettings.json`, { headers: H })).status, 404);
      // a long answer: shown once, spoken in sentences, the first sound arrives before the whole answer is made
      says.length = 0;
      await api('/api/robot/say', { text: 'I looked around the room. The door is on my left, about two metres away. The red chair is behind me. Shall I go to the door?' });
      for (let i = 0; i < 150 && says.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
      for (let i = 0; i < 50 && says.length && says[says.length - 1].text !== 'Shall I go to the door?' && !/door\?$/.test(says[says.length - 1].text); i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(says.length >= 2 && !says[0].more && says.slice(1).every((d) => d.more && d.audio), JSON.stringify(says.map((d) => [d.text, d.more])));
      assert.ok(says[0].text.endsWith('Shall I go to the door?') && says[0].text.startsWith('I looked'), 'the first message carries the whole text for the log');
      const smp = await api('/api/robot/voice/sample', { voice: 'kitten', text: 'Hi there!' });
      assert.ok(smp.ok && smp.audio && smp.secs > 0.3, JSON.stringify(smp));
      const no = await api('/api/robot/voice/sample', { voice: 'bella' });
      assert.ok(/not downloaded/.test(no.error), JSON.stringify(no));
    } finally { sock.close(); await srv.close(); }
  });
  finish();
})();

function finish() {
  const fail = results.filter((r) => r[0] === 'FAIL');
  console.log(`\nvoice: ${results.length - fail.length}/${results.length} passed`);
  process.exit(fail.length ? 1 : 0);
}
