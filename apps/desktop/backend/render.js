// Off-screen Chromium (Electron) for PDFs, page screenshots and image overlays.
// Only available inside the desktop app; the stand-alone server reports that clearly.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

function electron() {
  try { const e = require('electron'); if (e && e.BrowserWindow) return e; } catch {}
  return null;
}
const available = () => !!electron();

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm; }
html { font-family: "Segoe UI", Inter, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #1c1f24; }
body { margin: 0; }
h1 { font-size: 22pt; margin: 0 0 8pt; } h2 { font-size: 15pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
h3 { font-size: 12.5pt; margin: 12pt 0 4pt; } h1, h2, h3 { break-after: avoid; }
p, li { orphans: 3; widows: 3; } table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 10pt; }
th, td { border: 1px solid #c9ccd2; padding: 4pt 6pt; text-align: left; vertical-align: top; } th { background: #f1f2f4; }
tr { break-inside: avoid; } code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f4f5f7; padding: 0 3px; border-radius: 3px; }
pre { background: #f4f5f7; padding: 8pt; border-radius: 4px; white-space: pre-wrap; font-size: 9pt; } img { max-width: 100%; }
blockquote { border-left: 3px solid #e8742a; margin: 8pt 0; padding: 2pt 10pt; color: #444; }`;

function markdownToHtml(md, title = 'Document') {
  const { marked } = require('marked');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '')}</title><style>${PRINT_CSS}</style></head><body>${marked.parse(String(md || ''), { gfm: true })}</body></html>`;
}

async function withWindow(width, height, fn) {
  const e = electron();
  if (!e) throw new Error('This tool needs the Carpathron Robotics & Coding desktop app (it uses the built-in Chromium).');
  // Own in-memory session: no access to the app's login cookie or its local-certificate trust.
  const win = new e.BrowserWindow({ show: false, width, height, webPreferences: { partition: 'render-tools', sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (ev, url) => { if (/^https?:/i.test(win.webContents.getURL()) && !/^https?:/i.test(url)) ev.preventDefault(); };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  try { return await fn(win); } finally { try { win.destroy(); } catch {} await new Promise((r) => setTimeout(r, 150)); }
}

async function load(win, target, waitMs = 600) {
  const url = /^(https?|file|data):/i.test(target) ? target : pathToFileURL(path.resolve(target)).href;
  // Chromium sometimes aborts a file:// load right after another hidden window closed (ERR_FAILED): retry.
  for (let attempt = 1; ; attempt++) {
    try { await Promise.race([win.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('Page took longer than 45 s to load')), 45000))]); break; }
    catch (e) {
      if (attempt >= 3 || !/ERR_FAILED|ERR_ABORTED/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  try { await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(()=>true) : true', true); } catch {}
  await new Promise((r) => setTimeout(r, waitMs));
}

// html: full HTML text, or source: path/URL of an .html/.md file. Returns the written PDF path.
async function toPdf({ html, source, output, landscape = false, pageSize = 'A4', margins = 'default', background = true }) {
  let target = source, tmp = null;
  if (source && /\.md$/i.test(source) && !/^https?:/i.test(source)) html = markdownToHtml(fs.readFileSync(source, 'utf8'), path.basename(source));
  if (html) {
    tmp = path.join(os.tmpdir(), `mc-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    // keep relative image/CSS links working: write next to the source if there is one
    if (source && !/^https?:/i.test(source)) tmp = path.join(path.dirname(path.resolve(source)), `.mc-pdf-${Date.now()}.html`);
    fs.writeFileSync(tmp, /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html}</body></html>`);
    target = tmp;
  }
  if (!target) throw new Error('Give html or a source file/URL.');
  try {
    return await withWindow(1240, 1754, async (win) => {
      await load(win, target, 900);
      const opts = { landscape: !!landscape, printBackground: !!background, preferCSSPageSize: true };
      if (pageSize) opts.pageSize = pageSize;
      if (margins === 'none') opts.margins = { top: 0, bottom: 0, left: 0, right: 0 };
      else if (margins === 'minimum') opts.margins = { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 };
      const pdf = await win.webContents.printToPDF(opts);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, pdf);
      return { output, bytes: pdf.length };
    });
  } finally { if (tmp) try { fs.unlinkSync(tmp); } catch {} }
}

async function screenshot({ target, width = 1366, height = 900, fullPage = true, output, waitMs = 1200 }) {
  return withWindow(width, height, async (win) => {
    await load(win, target, waitMs);
    if (fullPage) {
      const h = await win.webContents.executeJavaScript('Math.min(12000, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))', true).catch(() => height);
      win.setContentSize(width, Math.max(height, Number(h) || height));
      await new Promise((r) => setTimeout(r, 400));
    }
    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    // keep images the model receives reasonably small
    const sized = img.getSize().width > 1600 ? img.resize({ width: 1600 }).toJPEG(85) : img.toJPEG(88);
    if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, png); }
    return { png, jpeg: sized, size: img.getSize() };
  });
}

// Draws SAM boxes over an image and returns PNG bytes.
async function overlayBoxes(imageFile, boxes, labels = []) {
  const e = electron();
  if (!e) return null;
  const img = e.nativeImage.createFromPath(imageFile);
  const { width, height } = img.getSize();
  if (!width) return null;
  const data = `data:image/png;base64,${img.toPNG().toString('base64')}`;
  const colors = ['#ff3b30', '#34c759', '#0a84ff', '#ff9f0a', '#bf5af2', '#64d2ff'];
  const rects = boxes.map((b, i) => {
    const sx = width / (b.w || width), sy = height / (b.h || height);
    const x = b.x1 * sx, y = b.y1 * sy, w = (b.x2 - b.x1) * sx, h = (b.y2 - b.y1) * sy, c = colors[i % colors.length];
    const t = `${labels[i] || `#${i + 1}`}${b.conf != null ? ` ${(b.conf * 100).toFixed(0)}%` : ''}`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}22" stroke="${c}" stroke-width="${Math.max(2, width / 400)}"/><text x="${x + 4}" y="${y + Math.max(14, width / 60)}" fill="${c}" font-size="${Math.max(14, width / 60)}" font-family="Arial" font-weight="bold">${t}</text>`;
  }).join('');
  const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}svg{display:block}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="${data}" width="${width}" height="${height}"/>${rects}</svg></body></html>`;
  const tmp = path.join(os.tmpdir(), `mc-ov-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  try {
    const r = await screenshot({ target: tmp, width, height, fullPage: false, waitMs: 300 });
    return r.png;
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

module.exports = { available, toPdf, screenshot, overlayBoxes, markdownToHtml, PRINT_CSS };
