// Muse 2.3 companion + room vision: the Quest posts its camera picture (/avatar/eyes), smart vision names the room's
// objects and SAM 3.1 outlines them (contours, not boxes); talking (/avatar/companion) gets a spoken answer with an
// action; demo = the 3D robot does it, real = the car really drives; the car camera gets contours too.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
let fail = 0;
const step = async (n, f) => { try { await f(); console.log('ok  ', n); } catch (e) { fail++; console.log('FAIL', n, '-', e.message); } };
(async () => {
  await fake.start(18831);
  const car = require('./fake-car').start(18834, 18835, fs.readFileSync(path.join(__dirname, 'sample.jpg')));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-comp-'));
  const TOK = 'quest-token-for-the-companion-test-1234567';
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18831/v1', engine: 'api', port: 18832, robot: { carIp: '127.0.0.1:18834' }, avatarTokens: [{ token: TOK, device: 'Quest 3', at: 1 }] }));
  // optional: a real Kokoro model (MC_TEST_KOKORO=<dir of kokoro-int8-en-v0_19>) -> real speech for the headset
  if (process.env.MC_TEST_KOKORO) { fs.mkdirSync(path.join(dataDir, 'voices'), { recursive: true }); fs.symlinkSync(process.env.MC_TEST_KOKORO, path.join(dataDir, 'voices', 'kokoro-int8-en-v0_19')); }
  const srv = await startServer({ dataDir, log: () => {} });
  const base = 'https://localhost:18832', H = { 'x-avatar-token': TOK };
  const get = async (p) => (await fetch(base + p, { headers: H })).json();
  const post = async (p, body, ct = 'application/json') => (await fetch(base + p, { method: 'POST', headers: { ...H, 'Content-Type': ct }, body: ct === 'application/json' ? JSON.stringify(body) : body })).json();
  const jpg = fs.readFileSync(path.join(__dirname, 'sample.jpg'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await step('headset camera picture accepted, room vision (fast, remembered)', async () => {
    assert.ok((await post('/avatar/eyes?id=7', jpg, 'image/jpeg')).ok);
    let st;
    for (let i = 0; i < 20; i++) { await sleep(500); await post('/avatar/eyes?id=7', jpg, 'image/jpeg'); st = await get('/avatar/state?vision=room'); if (st.room && st.room.seen.length) break; }
    assert.strictEqual(st.room.frame, 7);
    assert.deepStrictEqual(st.room.seen.map((o) => o.label), ['person', 'chair', 'plant']);
    assert.strictEqual(st.room.seen[1].dist, 1.4);
    assert.ok(st.room.seen.every((o) => o.box.length === 4), 'boxes');
    console.log('      room:', st.room.seen.map((x) => `${x.label} ${x.dist} m`).join(' | '), `(${st.room.ms} ms)`);
  });

  await step('companion talks about the room, remembers, speaks', async () => {
    const r1 = await post('/avatar/companion?mode=demo', { text: 'Hello Carpathron, how are you?' });
    assert.strictEqual(r1.action, 'none'); assert.strictEqual(r1.mode, 'demo');
    assert.ok(/I see 3 things/.test(r1.say), r1.say);
    const r2 = await post('/avatar/companion?mode=demo', { text: 'what do you think?' });
    assert.ok(/Earlier turns: 2/.test(r2.say), 'remembers: ' + r2.say);
  });

  await step('demo tasks: go to the chair, dance, outline the plant with SAM', async () => {
    const g = await post('/avatar/companion?mode=demo', { text: 'go to the chair please' });
    assert.strictEqual(g.action, 'goto'); assert.strictEqual(g.target, 'chair'); assert.ok(g.quick && /chair/.test(g.say), 'quick answer, no model call');
    await post('/avatar/eyes?id=8', jpg, 'image/jpeg');
    const g2 = await post('/avatar/companion?mode=demo', { text: 'could you take a look at the chair for me' });
    assert.strictEqual(g2.action, 'goto'); assert.ok(/picture/.test(g2.say) && !g2.quick, 'model sees the picture'); assert.ok(g2.mood, 'mood');
    assert.strictEqual((await post('/avatar/companion?mode=demo', { text: 'dance for me' })).action, 'dance');
    const c = await post('/avatar/companion?mode=demo', { text: 'Come here!' });
    assert.strictEqual(c.action, 'come'); assert.ok(c.quick);
    await post('/avatar/eyes?id=8', jpg, 'image/jpeg');
    const o = await post('/avatar/companion?mode=demo', { text: 'which one is the plant?' });
    assert.strictEqual(o.action, 'outline'); assert.ok(Array.isArray(o.boxes) && o.boxes.length >= 1 && o.boxes[0].sam, 'SAM boxes');
  });

  await step('real mode: the car does the task (forward drives the motors)', async () => {
    for (let i = 0; i < 20 && srv.robot.state !== 'online'; i++) await sleep(300);
    assert.strictEqual(srv.robot.state, 'online', 'car online');
    const before = car.log.filter((x) => x.startsWith('/drive')).length;
    const r = await post('/avatar/companion?mode=real', { text: 'drive forward a bit' });
    assert.strictEqual(r.mode, 'real'); assert.strictEqual(r.action, 'forward'); assert.ok(/forward/.test(r.doing), r.doing);
    await sleep(1500);
    const drives = car.log.filter((x) => x.startsWith('/drive')).slice(before);
    assert.ok(drives.some((d) => /l=[1-9]/.test(d) || /ws:[1-9]/.test(d)), 'car drove: ' + drives.slice(-3).join(' '));
    const st = await post('/avatar/companion?mode=real', { text: 'stop' });
    assert.ok(st.say);
  });

  await step('car camera vision gets SAM contours too', async () => {
    const ac = new AbortController();
    fetch(base + '/avatar/stream', { headers: H, signal: ac.signal }).then((r) => r.body.getReader().read()).catch(() => {});
    let st;
    for (let i = 0; i < 24; i++) { st = await get('/avatar/state?vision=1'); if (st.seenSrc === 'car' && st.seen.length) break; await sleep(500); }
    assert.strictEqual(st.seenSrc, 'car');
    assert.deepStrictEqual(st.seen.map((o) => o.label), ['person', 'cat']);
    assert.ok(st.seen.every((o) => o.poly && o.poly.length >= 12), 'contours');
    ac.abort();
  });

  if (process.env.MC_TEST_KOKORO) await step('natural companion voice: sentence by sentence WAVs for the headset, quick phrases cached', async () => {
    const r = await post('/avatar/companion?mode=demo', { text: 'tell me something nice about this room' });
    assert.ok(Array.isArray(r.audio) && r.audio.length >= 2, 'several sentences: ' + JSON.stringify(r.audio));
    for (const u of r.audio) { const a = await fetch(base + u, { headers: H }); const b = Buffer.from(await a.arrayBuffer()); assert.strictEqual(a.status, 200); assert.strictEqual(b.slice(0, 4).toString(), 'RIFF'); assert.ok(b.length > 20000, 'audio length'); }
    const t0 = Date.now(); const q1 = await post('/avatar/companion?mode=demo', { text: 'follow me' }); const t1 = Date.now() - t0;
    const t2s = Date.now(); const q2 = await post('/avatar/companion?mode=demo', { text: 'follow me' }); const t2 = Date.now() - t2s;
    assert.deepStrictEqual(q1.audio, q2.audio, 'cached phrase'); assert.ok(t2 < 300, `second quick answer ${t2} ms`);
    console.log(`      ${r.audio.length} sentences; quick phrase ${t1} ms first, ${t2} ms cached; voice ${srv.tts ? '' : ''}`);
  });

  await step('speech file for the headset (when the neural voice is installed) / 401 without the token', async () => {
    assert.strictEqual((await fetch(base + '/avatar/companion', { method: 'POST', body: '{}' })).status, 401);
    assert.strictEqual((await fetch(base + '/avatar/speech/aaaaaaaaaaaa.wav', { headers: H })).status, 404);
  });

  console.log(fail ? `${fail} FAILED` : 'ALL OK');
  car.close(); await srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
