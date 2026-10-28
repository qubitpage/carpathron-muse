// Robot "head" for Baby Carpathron: the camera is fixed to the car, so looking somewhere = turning the car body.
//  - turn(deg):  calibrated spin on the spot (+ = right / clockwise, - = left)
//  - look(dir):  turn to left / right / back (or any angle), take a photo, turn back to where it was facing
//  - scan():     room map — turn around in N steps, photograph every side, the vision model names what it sees
//                and how far, and we draw a top-down map (SVG + PNG) and a photo collage. Saved in <workspace>/maps
//                and as a memory, so later chats know the room.
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIRS = { front: 0, ahead: 0, forward: 0, right: 90, back: 180, behind: 180, backward: 180, left: -90 };
const FOV = 60; // ESP32-CAM OV2640 horizontal field of view, about 60 degrees

class Mapper {
  constructor({ robot, camera, api, memory, getSettings, emit, log }) {
    Object.assign(this, { robot, camera, api, memory, getSettings, emit, log });
    this.busy = false;
  }

  cfg() {
    const r = this.getSettings().robot || {};
    return { turnMs360: Number(r.turnMs360) || 2400, turnSpeed: Number(r.turnSpeed) || 70 };
  }

  needCar() {
    if (this.robot.status().state !== 'online') throw new Error('The car is not connected (Robot page → Find my car). Turning and scanning need the real car.');
  }

  // Spin on the spot. + = right (clockwise seen from above), - = left.
  async turn(deg, source = 'ai') {
    deg = Math.max(-360, Math.min(360, Number(deg) || 0));
    if (!deg) return { turned: 0 };
    const { turnMs360, turnSpeed } = this.cfg();
    const ms = Math.round((Math.abs(deg) / 360) * turnMs360);
    const s = deg > 0 ? [turnSpeed, -turnSpeed] : [-turnSpeed, turnSpeed];
    const r = await this.robot.runPlan([{ type: 'drive', left: s[0], right: s[1], ms }, { type: 'stop' }], source);
    if (!r.completed) throw new Error(`Turn interrupted: ${r.reason || 'stopped'}`);
    await sleep(350); // let the car settle so the photo is sharp
    return { turned: deg, ms };
  }

  static angleOf(direction) {
    if (typeof direction === 'number') return direction;
    const d = String(direction || '').toLowerCase().trim();
    if (d in DIRS) return DIRS[d];
    const n = Number(d.replace(/deg(rees)?/, ''));
    if (Number.isFinite(n)) return n;
    throw new Error(`Unknown direction "${direction}" (use left, right, back, front or degrees)`);
  }

  // Look somewhere: turn, photo, and (by default) turn back to face the original direction.
  async look(direction, { comeBack = true, source = 'ai' } = {}) {
    const deg = Mapper.angleOf(direction);
    if (deg) this.needCar();
    const turnDeg = deg > 180 ? deg - 360 : deg; // shortest way
    if (turnDeg) await this.turn(turnDeg, source);
    let photo;
    try { photo = await this.camera.capture(); }
    finally { if (comeBack && turnDeg) await this.turn(-turnDeg, source).catch(() => {}); }
    this.emit('robot:look', { direction: String(direction), path: photo.path });
    return { ...photo, direction: String(direction), degrees: turnDeg };
  }

  // ------------------------------------------------------------------ room scan
  async scan({ steps = 8, source = 'ai', onProgress } = {}) {
    if (this.busy) throw new Error('A room scan is already running.');
    this.needCar();
    steps = Math.max(4, Math.min(12, Math.round(Number(steps) || 8)));
    this.busy = true;
    const progress = (t) => { this.emit('robot:scan', { text: t }); if (onProgress) onProgress(t); };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(this.getSettings().workspace, 'maps', stamp);
    fs.mkdirSync(dir, { recursive: true });
    const photos = [];
    try {
      for (let i = 0; i < steps; i++) {
        const heading = Math.round((i * 360) / steps);
        progress(`Photo ${i + 1}/${steps} (heading ${heading}°)`);
        const ph = await this.camera.capture();
        const file = path.join(dir, `view-${String(heading).padStart(3, '0')}.jpg`);
        fs.writeFileSync(file, ph.buffer);
        photos.push({ heading, file, buffer: ph.buffer });
        await this.turn(360 / steps, source); // the last turn brings the car back to the start direction
      }
      progress('Looking at the photos…');
      const analysis = await this.analyze(photos).catch((e) => { this.log(`room scan: analysis failed: ${e.message}`); return null; });
      const map = { createdAt: Date.now(), steps, turnMs360: this.cfg().turnMs360, views: photos.map((p) => ({ heading: p.heading, file: path.basename(p.file) })), analysis };
      const svg = Mapper.renderSvg(map);
      fs.writeFileSync(path.join(dir, 'map.svg'), svg);
      fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map, null, 2));
      progress('Drawing the map…');
      const png = await renderImage(`<html><head><meta charset="utf-8"></head><body style="margin:0;background:#0d0f12">${svg}</body></html>`, 640, 720, 'png').catch(() => null);
      if (png) fs.writeFileSync(path.join(dir, 'map.png'), png);
      const collage = await renderImage(Mapper.collageHtml(photos), 960, Math.ceil(photos.length / 4) * 270 + 10, 'jpeg').catch(() => null);
      if (collage) fs.writeFileSync(path.join(dir, 'collage.jpg'), collage);
      const summary = Mapper.summaryText(map);
      try {
        if (analysis && analysis.summary) this.memory.add(`Room map (${new Date().toLocaleString()}, from where the car stood, 0° = start direction, clockwise): ${analysis.summary}`.slice(0, 500), 'robot');
        this.emit('memory:update', {});
      } catch {}
      this.emit('robot:map', { id: stamp, summary });
      progress('Room map ready');
      return { id: stamp, dir, summary, svg, png, collage, photos: photos.map((p) => p.file), analysis };
    } finally { this.busy = false; }
  }

  async analyze(photos) {
    const s = this.getSettings();
    if (!s.apiKey) return null;
    const content = [{ type: 'text', text: `These ${photos.length} photos were taken by a small robot car's camera (about ${FOV}° wide, 10 cm above the floor) while it turned on the spot to the RIGHT in equal steps. Heading 0° = the direction it faced first; headings grow clockwise. For each photo list the main objects with: bearing inside the photo in degrees (-${FOV / 2} = left edge, 0 = centre, +${FOV / 2} = right edge) and estimated distance from the car in metres. Also estimate free_m = how far the car could drive straight towards the photo centre before hitting something. Reply with JSON only:\n{"views":[{"heading":0,"description":"short","objects":[{"name":"chair","bearing":-10,"distance_m":1.2}],"free_m":1.5}],"room":"one line about the room type and size","summary":"2-3 sentences: what is around the car at which headings, where the open space and the exits/doors are"}` }];
    for (const p of photos) {
      content.push({ type: 'text', text: `Heading ${p.heading}°:` });
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.buffer.toString('base64')}` } });
    }
    const res = await this.api.complete({ model: s.model, messages: [{ role: 'user', content }] });
    const m = String(res.content || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('the model did not return a map');
    const j = JSON.parse(m[0]);
    j.views = (Array.isArray(j.views) ? j.views : []).map((v, i) => ({
      heading: Number.isFinite(Number(v.heading)) ? Number(v.heading) : photos[i] ? photos[i].heading : 0,
      description: String(v.description || '').slice(0, 200),
      free_m: Math.max(0, Math.min(6, Number(v.free_m) || 0)),
      objects: (Array.isArray(v.objects) ? v.objects : []).slice(0, 8).map((o) => ({ name: String(o.name || '?').slice(0, 30), bearing: Math.max(-FOV / 2, Math.min(FOV / 2, Number(o.bearing) || 0)), distance_m: Math.max(0.1, Math.min(8, Number(o.distance_m) || 1)) })),
    }));
    return j;
  }

  static summaryText(map) {
    const a = map.analysis;
    if (!a) return `🗺️ Scanned ${map.steps} directions (photos saved). Add the Meta API key in Settings so the AI can name what is around the car and draw the objects on the map.`;
    const lines = [`🗺️ *Room map* — ${a.room || ''}`.trim(), a.summary || ''];
    for (const v of a.views || []) {
      const objs = (v.objects || []).map((o) => `${o.name} ${o.distance_m.toFixed(1)} m`).join(', ');
      lines.push(`• ${v.heading}°: ${v.description || ''}${objs ? ` (${objs})` : ''}${v.free_m ? ` — free ${v.free_m.toFixed(1)} m` : ''}`);
    }
    lines.push('0° = where the car faced at the start, angles clockwise (90° = its right).');
    return lines.filter(Boolean).join('\n');
  }

  // Top-down map: car in the middle, 0° up, clockwise. Rings every metre, free-space wedges, labelled objects.
  static renderSvg(map) {
    const W = 640, H = 720, cx = 320, cy = 335, px = 86; // px per metre
    const pt = (deg, m) => [cx + Math.sin((deg * Math.PI) / 180) * m * px, cy - Math.cos((deg * Math.PI) / 180) * m * px];
    const a = map.analysis || { views: [] };
    const step = 360 / (map.steps || 8);
    let wedges = '', objs = '', ticks = '';
    for (const v of a.views || []) {
      const r = Math.min(3.2, v.free_m || 0);
      if (r > 0) {
        const [x1, y1] = pt(v.heading - step / 2, r), [x2, y2] = pt(v.heading + step / 2, r);
        wedges += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r * px},${r * px} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="#2f7d5b" fill-opacity="0.28" stroke="#3fb37f" stroke-opacity="0.5"/>`;
      }
      for (const o of v.objects || []) {
        const [x, y] = pt(v.heading + o.bearing, Math.min(3.4, o.distance_m));
        objs += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#ffb347"/><text x="${(x + 9).toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="#f4f4f4" font-size="13">${esc(o.name)}</text>`;
      }
    }
    for (let d = 0; d < 360; d += 45) {
      const [x, y] = pt(d, 3.45);
      ticks += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="#8a93a0" font-size="12" text-anchor="middle">${d}°</text>`;
    }
    const rings = [1, 2, 3].map((m) => `<circle cx="${cx}" cy="${cy}" r="${m * px}" fill="none" stroke="#2a2f37" stroke-dasharray="4 5"/><text x="${cx + 4}" y="${cy - m * px - 4}" fill="#5d6673" font-size="11">${m} m</text>`).join('');
    const car = `<g transform="translate(${cx},${cy})"><rect x="-11" y="-15" width="22" height="30" rx="5" fill="#4f8cff"/><path d="M0,-28 L8,-17 L-8,-17 Z" fill="#4f8cff"/></g>`;
    const title = esc(`Room map · ${new Date(map.createdAt).toLocaleString()}`);
    const sub = esc(a.room || (map.analysis ? '' : 'photos only — add the Meta API key for object detection'));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#0d0f12"/>${rings}${wedges}${ticks}${objs}${car}<text x="20" y="${H - 44}" fill="#e8eaed" font-size="16" font-weight="600">${title}</text><text x="20" y="${H - 22}" fill="#9aa0a6" font-size="13">${sub} · green = free space · 0° = start direction</text></svg>`;
  }

  static collageHtml(photos) {
    const cells = photos.map((p) => `<div style="position:relative;width:236px;height:177px;margin:2px;float:left"><img src="data:image/jpeg;base64,${p.buffer.toString('base64')}" style="width:236px;height:177px;object-fit:cover;border-radius:6px"><span style="position:absolute;left:6px;top:4px;color:#fff;font:600 14px Segoe UI,Arial;text-shadow:0 0 4px #000">${p.heading}°</span></div>`).join('');
    return `<html><head><meta charset="utf-8"></head><body style="margin:0;padding:3px;background:#0d0f12;width:954px">${cells}</body></html>`;
  }

  list() {
    const root = path.join(this.getSettings().workspace, 'maps');
    try {
      return fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'map.json'))).sort().reverse().slice(0, 20).map((id) => {
        let summary = '';
        try { summary = Mapper.summaryText(JSON.parse(fs.readFileSync(path.join(root, id, 'map.json'), 'utf8'))); } catch {}
        return { id, summary };
      });
    } catch { return []; }
  }

  file(id, name) {
    if (!/^[\w-]+$/.test(id) || !/^(map\.svg|map\.png|collage\.jpg|view-\d{3}\.jpg)$/.test(name)) return null;
    const f = path.join(this.getSettings().workspace, 'maps', id, name);
    return fs.existsSync(f) ? f : null;
  }
}

// Renders HTML to PNG/JPEG with an invisible Electron window (inside the desktop app). Outside Electron: null.
async function renderImage(html, width, height, format) {
  let electron;
  try { electron = require('electron'); } catch { return null; }
  if (!electron || typeof electron !== 'object' || !electron.BrowserWindow || !electron.app || !electron.app.isReady()) return null;
  const win = new electron.BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { offscreen: true, javascript: false } });
  try {
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await sleep(300);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    return format === 'png' ? img.toPNG() : img.toJPEG(85);
  } finally { win.destroy(); }
}

module.exports = { Mapper, renderImage };
