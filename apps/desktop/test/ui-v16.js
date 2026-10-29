// Screenshots of 1.6: messages while working (now / queue), task list, draft + self-check.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const out = process.argv[2];
  await fake.start(18731);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ui16-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ui16ws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18731/v1', engine: 'api', workspace: ws, port: 18732, mode: 'auto' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: 1360, height: 860 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`https://localhost:18732/?t=${srv.token}`);
  await p.waitForTimeout(1000);
  await p.fill('#input', 'make tasks for the job'); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/a-tasks.png` });
  await p.fill('#input', 'medium wait please'); await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  await p.fill('#input', 'also say banana'); await p.keyboard.press('Enter');   // default: now
  await p.waitForTimeout(600);
  await p.click('#btnWhen');                                                     // switch to queue
  await p.fill('#input', 'write hello when you are done'); await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/b-working.png` });
  await p.waitForTimeout(12000);
  await p.screenshot({ path: `${out}/c-after.png` });
  const conv = (await (await p.evaluate(async (t) => (await fetch('/api/convs', { headers: { 'x-mc-token': t } })).json(), srv.token)))[0];
  const full = await p.evaluate(async ([t, id]) => (await fetch('/api/convs/' + id, { headers: { 'x-mc-token': t } })).json(), [srv.token, conv.id]);
  console.log(JSON.stringify({ errs, queue: full.queue.length, steered: full.messages.filter((m) => m.steered).length, users: full.messages.filter((m) => m.role === 'user').map((m) => m.text), tasks: full.tasks }, null, 1));
  await b.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
