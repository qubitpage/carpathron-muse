// Runs inside Electron (main process): PDF from Markdown/HTML, page screenshot, SAM overlay drawing.
// Usage: electron test/electron-tools.js <outDir>
const { app } = require('electron');
const fs = require('fs'), path = require('path');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const out = process.argv[process.argv.length - 1];
  const logf = path.join(out, 'result.txt'); fs.writeFileSync(logf, ''); const _l = console.log; console.log = (...a) => { fs.appendFileSync(logf, a.join(' ') + '\n'); _l(...a); }; console.error = console.log;
  const render = require('../backend/render');
  const { execX, readDocument } = require('../backend/xtools');
  const ws = out;
  const ctx = { workspace: ws, dataDir: out, settings: {}, onPhoto: (p) => console.log('photo', p.source, p.path, p.buffer.length) };
  try {
    console.log(await execX('create_pdf', { output_path: 'md.pdf', markdown: '# Carpathron\n\nA **test** PDF.\n\n| a | b |\n|---|---|\n| 1 | 2 |' }, ctx));
    const html = `<!doctype html><html><head><style>@page{size:A4;margin:0}body{margin:0;font-family:Arial}.c{height:297mm;background:linear-gradient(135deg,#0d0e12,#e8742a);color:#fff;display:flex;align-items:center;justify-content:center;font-size:40px}</style></head><body><div class="c">Cover page</div><div style="padding:20mm"><h1>Page 2</h1><p>Body text</p></div></body></html>`;
    fs.writeFileSync(path.join(ws, 'design.html'), html);
    console.log(await execX('create_pdf', { output_path: 'design.pdf', source: 'design.html', margins: 'none' }, ctx));
    console.log((await readDocument(path.join(ws, 'design.pdf'))).slice(0, 200));
    console.log(await execX('screenshot_page', { target: 'design.html', width: 390, save_to: 'phone.png' }, ctx));
    const png = await render.overlayBoxes(path.join(__dirname, 'sample.jpg'), [{ x1: 10, y1: 20, x2: 110, y2: 220, w: 640, h: 480, conf: 0.9 }], ['cup']);
    fs.writeFileSync(path.join(ws, 'overlay.png'), png);
    console.log('overlay bytes', png.length);
    const { Secrets } = require('../backend/secrets');
    const s = new Secrets(out); const e = s.encrypt('pw'); console.log('secret', e.slice(0, 6), s.decrypt(e) === 'pw');
    console.log('ALL OK');
  } catch (e) { console.error('FAILED', e.stack || e); }
  app.exit(0);
});
