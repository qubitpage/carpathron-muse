// Screenshots of the Supervisor: failed verdict → agent fixes → verified; and its settings.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const out = process.argv[2] || os.tmpdir();
  await fake.start(18741);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-uisup-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-uisupws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18741/v1', engine: 'api', workspace: ws, port: 18742, mode: 'auto' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`https://localhost:18742/?t=${srv.token}`);
  await p.waitForTimeout(1000);
  await p.fill('#input', 'supervisor fail test'); await p.keyboard.press('Enter');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${out}/sup-chat.png` });
  const cards = await p.$$eval('.msg.supervisor, [class*="supervisor"]', (els) => els.map((e) => e.textContent.slice(0, 140)));
  await p.evaluate(() => { const el = document.querySelector('[class*="sup"]'); if (el) el.scrollIntoView(); });
  await p.screenshot({ path: `${out}/sup-card.png` });
  console.log(JSON.stringify({ errs, cards }, null, 1));
  await b.close(); await srv.close(); process.exit(errs.length || !cards.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
