// 2.3.6: the Quest view recorder in Muse (Robots → Control → ⏺ Record): the view + audio become a .webm in <workspace>/recordings
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');
(async () => {
  const { startServer } = require('../backend/server');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-recd-'));
  const fake = require('./fake-meta.js'); await fake.start(18996);
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18995, workspace: ws, apiKey: 'test-key', apiBase: 'http://127.0.0.1:18996/v1' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const H = { 'x-mc-token': srv.token, 'Content-Type': 'application/json' };
  // a "headset" links (Allow on the PC) and sends its view
  const { id } = await (await fetch('https://localhost:18995/avatar/link', { method: 'POST', body: JSON.stringify({ device: 'Test Quest' }) })).json();
  await fetch('https://localhost:18995/api/avatar/decide', { method: 'POST', headers: H, body: JSON.stringify({ id, allow: true }) });
  const { token } = await (await fetch(`https://localhost:18995/avatar/link/${id}`)).json();
  const jpg = fs.readFileSync(path.join(__dirname, 'sample.jpg'));
  const post = () => fetch('https://localhost:18995/avatar/view?mode=room', { method: 'POST', headers: { 'x-avatar-token': token, 'Content-Type': 'image/jpeg' }, body: jpg }).catch(() => {});
  const iv = setInterval(post, 200); await post();
  const br = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await br.newContext({ ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`https://localhost:18995/?t=${srv.token}`); await p.waitForTimeout(800);
  await p.click('#nav button[data-view="robot"]'); await p.waitForTimeout(3000);
  assert.ok(await p.isVisible('#questVideo'), 'the Quest view shows');
  assert.ok(await p.isEnabled('#btnQuestRec'), 'Record is enabled while the view is live');
  await p.click('#btnQuestRec'); await p.waitForTimeout(5000);
  const state = await p.textContent('#questRecState');
  assert.ok(/Recording/.test(state), `recording: ${state}`);
  await p.click('#btnQuestRec'); await p.waitForTimeout(2500);
  const saved = await p.textContent('#questRecState');
  const files = fs.readdirSync(path.join(ws, 'recordings'));
  assert.ok(files.length === 1 && /^quest-.*\.webm$/.test(files[0]) && fs.statSync(path.join(ws, 'recordings', files[0])).size > 20000, `file: ${files} ${saved}`);
  assert.ok(/Saved/.test(saved), saved);
  assert.ok((await p.textContent('#questRecList')).includes(files[0]), 'listed');
  // 2.3.9: talk to Carpathron with the PC microphone (Chromium's fake microphone beeps = "speech")
  await p.uncheck('#pcGripOnly');   // hands-free for this test (the default is: only while the grip is held)
  await p.click('#btnPcTalk');
  let st = null;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(500);
    st = await (await fetch('https://localhost:18995/avatar/state', { headers: { 'x-avatar-token': token } })).json().catch(() => null);
    if (st && st.companion && st.companion.say && st.companion.say.pc) break;
  }
  const said = st && st.companion && st.companion.say;
  console.log('PC microphone ->', await p.textContent('#pcTalkState'));
  assert.ok(said && said.heard === 'Look left' && said.pc, 'PC mic talk reaches the headset: ' + JSON.stringify(said));
  await p.click('#btnPcTalk');
  console.log('page errors:', errs);
  assert.strictEqual(errs.length, 0);
  console.log(`Quest recorder: OK — ${files[0]} ${fs.statSync(path.join(ws, 'recordings', files[0])).size} bytes`);
  clearInterval(iv); await br.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
