// Runs inside Electron: the Muse Browser tools (open, elements, click by index, type, key, select, text, eval, scroll).
// Usage: electron test/electron-browser.js <outDir>
const { app } = require('electron');
const fs = require('fs'), path = require('path');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const out = process.argv[process.argv.length - 1];
  const res = [];
  const ok = (cond, msg) => { res.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); };
  const { execComputer } = require('../backend/computer');
  const photos = [];
  const ctx = { dataDir: out, onPhoto: (p) => photos.push(p), computerState: {} };
  const page = path.join(out, 'form.html');
  fs.writeFileSync(page, `<!doctype html><html><head><title>Test form</title></head><body style="font-family:Arial;height:3000px">
    <h1>Muse test</h1><input id="name" placeholder="Your name"> <select id="color"><option>Red</option><option>Green</option></select>
    <button id="go" onclick="document.getElementById('out').textContent = 'Hello ' + document.getElementById('name').value + ' / ' + document.getElementById('color').value">Say hello</button>
    <p id="out"></p><form onsubmit="event.preventDefault(); document.getElementById('sub').textContent='submitted:'+this.q.value"><input name="q" id="q" placeholder="Search"></form><p id="sub"></p></body></html>`);
  try {
    let r = await execComputer('browser_view', { action: 'open', url: page, width: 1000 }, ctx);
    ok(/Test form/.test(r) && photos.length === 1 && photos[0].buffer.length > 1000, `open + screenshot (${r.split('\n')[1]})`);
    const els = await execComputer('browser_view', { action: 'elements' }, ctx);
    const idx = (label) => Number((els.split('\n').find((l) => l.includes(label)) || '').match(/^\[(\d+)\]/)?.[1]);
    ok(Number.isInteger(idx('Your name')) && Number.isInteger(idx('Say hello')), 'elements list has the field and the button');
    await execComputer('browser_act', { action: 'type', index: idx('Your name'), text: 'Mircea' }, ctx);
    const sel = Number((els.split('\n').find((l) => /select/.test(l)) || '').match(/^\[(\d+)\]/)?.[1]);
    await execComputer('browser_act', { action: 'select', index: sel, value: 'green' }, ctx);
    await execComputer('browser_act', { action: 'click', index: idx('Say hello') }, ctx);
    r = await execComputer('browser_view', { action: 'text' }, ctx);
    ok(/Hello Mircea \/ Green/.test(r), 'typed, selected and clicked: ' + (r.match(/Hello.*/) || [''])[0]);
    await execComputer('browser_act', { action: 'type', index: idx('Search'), text: 'robots' }, ctx);
    await execComputer('browser_act', { action: 'key', keys: 'enter' }, ctx);
    r = await execComputer('browser_act', { action: 'eval', js: "document.getElementById('sub').textContent" }, ctx);
    ok(/submitted:robots/.test(r), 'Enter submits the form: ' + r);
    // click by screenshot coordinates (scaled) instead of index
    await execComputer('browser_act', { action: 'eval', js: "document.getElementById('out').textContent=''" }, ctx);
    const btn = (await execComputer('browser_view', { action: 'elements' }, ctx)).split('\n').find((l) => l.includes('Say hello'));
    const [, x, y] = btn.match(/@ (\d+),(\d+)/);
    await execComputer('browser_act', { action: 'click', x: Number(x), y: Number(y) }, ctx);
    r = await execComputer('browser_act', { action: 'eval', js: "document.getElementById('out').textContent" }, ctx);
    ok(/Hello Mircea/.test(r), 'click by screenshot coordinates works');
    r = await execComputer('browser_view', { action: 'scroll', direction: 'down', amount: 5 }, ctx);
    const y2 = await execComputer('browser_act', { action: 'eval', js: 'window.scrollY' }, ctx);
    ok(Number(y2.replace(/\D/g, '')) > 100, 'scroll moves the page: ' + y2);
    let err = ''; try { await execComputer('browser_act', { action: 'click', index: 999 }, ctx); } catch (e) { err = e.message; }
    ok(/No element with index 999/.test(err), 'clear error for a stale index');
    await execComputer('browser_view', { action: 'close' }, ctx);
    let e2 = ''; try { await execComputer('browser_view', { action: 'text' }, ctx); } catch (e) { e2 = e.message; }
    ok(/not open/.test(e2), 'clear error when the browser is closed');
  } catch (e) { res.push('FAIL exception ' + (e.stack || e)); }
  fs.writeFileSync(path.join(out, 'browser-result.txt'), res.join('\n'));
  console.log(res.join('\n'));
  app.exit(0);
});
