#!/usr/bin/env node
// Stand-in for the Windows desktop helper (same line protocol): a 2732x1536 screen at offset 0,0.
const fs = require('fs'), path = require('path');
const log = process.env.FAKE_DESKTOP_LOG;
let cur = { x: 10, y: 10 };
process.stdout.write('{"ready":true}\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const c = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (log) fs.appendFileSync(log, JSON.stringify(c) + '\n');
    let r;
    switch (c.op) {
      case 'shot': fs.copyFileSync(path.join(__dirname, 'sample.jpg'), c.file); r = { file: c.file, w: 1366, h: 768, ox: 0, oy: 0, sw: 2732, sh: 1536, scale: 0.5 }; break;
      case 'click': case 'move': cur = { x: c.x, y: c.y }; r = { ok: true }; break;
      case 'cursor': r = cur; break;
      case 'windows': r = [{ hwnd: 42, title: 'Untitled - Notepad', app: 'notepad', x: 100, y: 100, w: 800, h: 600, minimized: false, active: false }]; break;
      case 'screens': r = [{ index: 0, x: 0, y: 0, w: 2732, h: 1536, primary: true }]; break;
      default: r = { ok: true };
    }
    process.stdout.write(JSON.stringify({ id: c.id, ok: true, result: r }) + '\n');
  }
});
