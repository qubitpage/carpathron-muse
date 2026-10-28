process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const out = process.argv[2];
  await fake.start(18811);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ui2-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18811/v1', engine: 'api', port: 18812 }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  // A: normal live connection
  const p = await b.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`https://localhost:18812/?t=${srv.token}`); await p.waitForTimeout(700);
  await p.fill('#input', 'slow question please'); await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/live-working.png` });
  const t1 = await p.textContent('#working .wtext');
  await p.waitForTimeout(3000);
  const ans = await p.textContent('.msg.assistant');
  console.log('A status:', t1, '| answer:', ans.slice(0, 40), '| indicator gone:', !(await p.$('#working')));
  // B: live connection blocked (like the Windows bug) -> polling fallback must still show the answer
  const q = await b.newPage({ viewport: { width: 1200, height: 760 } });
  await q.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose && this.onclose(), 10); } send() {} close() {} }; });
  await q.goto(`https://localhost:18812/?t=${srv.token}`); await q.waitForTimeout(700);
  await q.fill('#input', 'hello without websocket'); await q.keyboard.press('Enter');
  await q.waitForTimeout(3500);
  const ans2 = await q.textContent('.msg.assistant').catch(() => 'NONE');
  console.log('B fallback answer:', ans2.slice(0, 45));
  await q.screenshot({ path: `${out}/live-fallback.png` });
  console.log('errors:', JSON.stringify(errs));
  await b.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
