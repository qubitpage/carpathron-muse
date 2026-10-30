// UI test: the 🎤 button records (fake microphone), converts to WAV, sends it, and the transcript drives the agent.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  await fake.start(18741);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mic-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18742, apiKey: 'test-key', apiBase: 'http://127.0.0.1:18741/v1', engine: 'api' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1250, height: 860 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`https://localhost:18742/?t=${srv.token}`); await p.waitForTimeout(800);
  await p.click('#btnMic'); await p.waitForTimeout(1600);
  const label = await p.textContent('#btnMic');
  await p.click('#btnMic');
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { await p.waitForTimeout(250); ok = /Look left/.test(await p.textContent('#messages').catch(() => '')); }
  const last = fake.calls().pop();
  const sentText = last ? String(last.messages[last.messages.length - 1].content) : '';
  console.log(`${/⏺ \d+s/.test(label) ? 'PASS' : 'FAIL'} recording indicator: ${label}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} transcript shown in the chat`);
  console.log(`${/^Look left/.test(sentText) ? 'PASS' : 'FAIL'} transcript sent to the model: ${sentText.slice(0, 40)}`);
  console.log(`${fake.asr().length ? 'PASS' : 'FAIL'} WAV reached Muse Voice Transcribe (${fake.asr()[0] || 0} bytes)`);
  console.log(`${errs.length ? 'FAIL' : 'PASS'} no page errors ${errs.join(' | ')}`);
  await p.screenshot({ path: '/tmp/claude-0/ui-mic.png' });
  await b.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
