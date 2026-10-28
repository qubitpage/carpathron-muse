process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const fake = require('./fake-meta');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const out = process.argv[2];
  await fake.start(18911);
  // real small JPEG from python-generated file
  const jpg = fs.readFileSync(require('path').join(__dirname, 'sample.jpg'));
  const camSrv = require('http').createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'image/jpeg' }); r.end(jpg); }).listen(18913);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-ui3-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'test-key', apiBase: 'http://127.0.0.1:18911/v1', engine: 'api', port: 18912, mode: 'auto', robot: { cameraUrl: 'http://127.0.0.1:18913/capture' } }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.goto(`https://localhost:18912/?t=${srv.token}`); await p.waitForTimeout(700);
  await p.fill('#input', 'take a photo of the room'); await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
  console.log(JSON.stringify(await p.evaluate(() => window.MC.conv.messages.map(m => [m.role, m.image || '', m.status || '']))));
  console.log(await p.evaluate(async () => { const m = window.MC.conv.messages.find(x => x.image); if (!m) return 'no image msg'; const r = await fetch(window.MCphotoUrl(m.image)); return r.status + ' ' + r.headers.get('content-type'); }));
  await p.screenshot({ path: `${out}/photo-chat.png` });
  await p.click('#nav button[data-view="robot"]'); await p.waitForTimeout(500);
  await p.click('#btnPhoto'); await p.waitForTimeout(3000); console.log('preview:', await p.evaluate(() => { const i = document.querySelector('#camPreview'); return fetch(i.src).then(r => i.hidden + ' ' + i.naturalWidth + ' ' + r.status + ' ' + i.src); }));
  await p.screenshot({ path: `${out}/photo-robot.png`, fullPage: true });
  await b.close(); camSrv.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
