// Robot "head" for Baby Carpathron: the camera is fixed to the car, so looking somewhere = turning the car body.
//  - turn(deg):  calibrated spin on the spot (+ = right / clockwise, - = left)
//  - look(dir):  turn to left / right / back (or any angle), take a photo, turn back to where it was facing
//  - scan():     room map — turn around in N steps, photograph every side, the vision model names what it sees
//                and how far, and we draw a top-down map (SVG + PNG) and a photo collage. Saved in <workspace>/maps
//                and as a memory, so later chats know the room.
'use strict';
const fs = require('fs');
const geometry = require('./geometry');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIRS = { front: 0, ahead: 0, forward: 0, right: 90, back: 180, behind: 180, backward: 180, left: -90 };
const FOV = 60; // ESP32-CAM OV2640 horizontal field of view, about 60 degrees

class Mapper {
  constructor({ robot, camera, api, vision, memory, getSettings, emit, log }) {
    Object.assign(this, { robot, camera, api, vision, memory, getSettings, emit, log });
    this.frameDiff = geometry.frameDiff; // replaceable in tests
    this.thumb = geometry.thumb; this.thumbDiff = geometry.thumbDiff;
    this.busy = false;
  }

  cfg() {
    const r = this.getSettings().robot || {};
    // cmPerSec: how far the car drives in 1 s at driveSpeed (calibrate on the Robot page / Settings → Robots)
    return { turnMs360: Number(r.turnMs360) || 2400, turnSpeed: Number(r.turnSpeed) || 70, driveSpeed: Number(r.driveSpeed) || 60, cmPerSec: Number(r.cmPerSec) || 40 };
  }

  // Drive straight ahead about `m` metres (calibrated), then stop.
  async forward(m, source = 'ai') {
    const { driveSpeed, cmPerSec } = this.cfg();
    const ms = Math.max(150, Math.min(4000, Math.round((Math.abs(m) * 100 / cmPerSec) * 1000)));
    const sp = m < 0 ? -driveSpeed : driveSpeed; // negative metres = back up
    const r = await this.robot.runPlan([{ type: 'drive', left: sp, right: sp, ms }, { type: 'stop' }], source);
    if (!r.completed) throw new Error(`Drive interrupted: ${r.reason || 'stopped'}`);
    await sleep(350);
    return { metres: m, ms };
  }

  // Drive to a point of the map (metres, x = right, y = ahead at the start): turn towards it, then short hops; the laser
  // stops the car before obstacles. Uses the dead-reckoned pose, so it is right to about 10 % of the distance.
  async gotoPoint(x, y, { source = 'ai', stopAt = 0, abort = () => false } = {}) {
    this.needCar();
    const p = this.robot.pose;
    const dx = Number(x) - p.x, dy = Number(y) - p.y, dist = Math.hypot(dx, dy);
    if (dist < 0.08) return { metres: 0, text: 'Already there.' };
    if (dist > 6) throw new Error('That point is more than 6 m away: pick a closer one.');
    const want = (Math.atan2(dx, dy) * 180) / Math.PI;
    let turn = ((want - p.heading) % 360 + 540) % 360 - 180;
    if (Math.abs(turn) > 4) await this.turn(Math.round(turn), source);
    if (abort()) throw new Error('stopped');
    let left = dist - stopAt, driven = 0, blocked = false;
    let s = null;
    while (left > 0.05) {
      if (abort()) throw new Error('stopped');
      const hop = Math.min(0.3, left);   // 2.2.2: 30 cm hops (was 50): the car checks the way more often
      s = await this.robot.sensors().catch(() => null);
      // the car's distance sensor went away (Mega hub restarting, loose wire): wait for it, never drive blind
      for (let w = 0; s && s.tof === false && (s.mega === false || s.linkLost) && w < 8 && !abort(); w++) { await new Promise((r) => setTimeout(r, 700)); s = await this.robot.sensors().catch(() => null); }
      if (s && s.tof === false && (s.mega === false || s.linkLost)) { blocked = true; break; }
      const keep = ((s && s.stopMm) || 150) / 1000 + 0.05;   // the hop must end before the car's stop distance
      if (s && s.tof && s.dist > 0 && s.dist / 1000 < hop + keep) { blocked = true; break; }
      const felt = s ? (s.bumps | 0) + (s.tiltStops | 0) + (s.cliffStops | 0) : 0;
      await this.forward(hop, source);
      driven += hop; left -= hop;
      const s2 = await this.robot.sensors().catch(() => null);
      if (s2 && ((s2.bumps | 0) + (s2.tiltStops | 0) + (s2.cliffStops | 0) > felt || (s2.blocked && s2.dist > 0 && s2.dist < (s2.stopMm || 150) + 30))) { blocked = true; break; }
    }
    return { metres: Math.round(driven * 100) / 100, turned: Math.round(turn), blocked, text: blocked ? `Stopped after ${driven.toFixed(1)} m: something is in the way.` : `Arrived (${driven.toFixed(1)} m).` };
  }

  needCar() {
    if (this.robot.status().state !== 'online') throw new Error('The car is not connected (Robot page → Find my car). Turning and scanning need the real car.');
  }

  // Spin on the spot. + = right (clockwise seen from above), - = left.
  // look = a search step: a little slower, and a longer pause so the next photo is sharp (not a blurred spin)
  async turn(deg, source = 'ai', { look = false } = {}) {
    deg = Math.max(-360, Math.min(360, Number(deg) || 0));
    if (!deg) return { turned: 0 };
    const settle = look ? 450 : 250;
    // with the gyro on the car: exact turn done by the car itself — 2.3.8: the PC stops a turn that runs too long; after
    // one such turn the gyro is not trusted for 10 minutes and turns are timed (the Mega hub's heading can lag, and
    // the car then kept spinning full circles)
    if (this.robot.gyroTurn && Date.now() > (this.gyroBadUntil || 0)) {
      const sp = look ? Math.min(this.cfg().turnSpeed, 58) : this.cfg().turnSpeed;
      // the longest this turn should take: the measured full-turn time, scaled for the speed, with a generous margin
      const maxMs = Math.round((Math.abs(deg) / 360) * this.cfg().turnMs360 * (this.cfg().turnSpeed / sp) * 1.5 + 400);
      const g = await this.robot.gyroTurn(deg, sp, { maxMs }).catch(() => null);
      if (g && g.result === 'timeout') { this.gyroBadUntil = Date.now() + 600000; this.log(`gyro turn ${deg}° did not finish: timed turns for the next 10 minutes`); }
      if (g) { if (g.result === 'cancelled') throw new Error('Turn interrupted (STOP or manual control)'); await sleep(settle); return { turned: deg, gyro: true, result: g.result }; }
    }
    const { turnMs360, turnSpeed } = this.cfg();
    const ms = Math.round((Math.abs(deg) / 360) * turnMs360);
    const s = deg > 0 ? [turnSpeed, -turnSpeed] : [-turnSpeed, turnSpeed];
    const r = await this.robot.runPlan([{ type: 'drive', left: s[0], right: s[1], ms }, { type: 'stop' }], source);
    if (!r.completed) throw new Error(`Turn interrupted: ${r.reason || 'stopped'}`);
    await sleep(look ? 450 : 350); // let the car settle so the photo is sharp
    return { turned: deg, ms };
  }

  // Turn calibration with the camera. Short bursts turn by different amounts on a real floor (every start slips), so
  // the car spins CONTINUOUSLY for a few seconds at the turn speed while photographing as fast as it can. For each
  // photo the most similar later photo (1.2–6 s later) marks one full circle; the median of those times = Full turn (ms).
  // turn() then uses one continuous spin of the matching length.
  async calibrateTurn({ source = 'pc', onStatus, spinMs = 7000 } = {}) {
    this.needCar();
    if (this.busy) throw new Error('The car is busy.');
    this.busy = true;
    const say = (t) => { this.emit('robot:scan', { text: t }); if (onStatus) onStatus(t); };
    try {
      const { turnSpeed } = this.cfg();
      const frames = [];
      say('Turn calibration: spinning for about 7 seconds…');
      const t0 = Date.now();
      const plan = [];
      for (let left = spinMs; left > 0; left -= 4000) plan.push({ type: 'drive', left: turnSpeed, right: -turnSpeed, ms: Math.min(4000, left) });
      plan.push({ type: 'stop' });
      const spin = this.robot.runPlan(plan, source);
      let spinning = true;
      spin.finally(() => { spinning = false; });
      await sleep(600); // let it reach a steady speed
      while (spinning) {
        const t = Date.now() - t0;
        let ph;
        try { ph = await this.camera.capture({ quiet: true }); } catch { continue; }
        if (!spinning) break;
        const th = this.thumb(ph.buffer);
        if (th) frames.push({ t: (t + (Date.now() - t0)) / 2, th });
      }
      const r = await spin;
      if (!r.completed) throw new Error(`Calibration interrupted: ${r.reason || 'stopped'}`);
      if (frames.length < 8) throw new Error(`Too few photos while spinning (${frames.length}). Is the camera working (Robot page → live video)?`);
      const cands = [];
      for (let i = 0; i < frames.length; i++) {
        let best = null;
        for (let j = i + 1; j < frames.length; j++) {
          const dt = frames[j].t - frames[i].t;
          if (dt < 1200 || dt > 6000) continue;
          const d = this.thumbDiff(frames[i].th, frames[j].th);
          if (d != null && (!best || d < best.d)) best = { dt, d };
        }
        if (best) cands.push(best);
      }
      if (cands.length < 3) throw new Error('The car turned too slowly to come round in 6 seconds — raise Turn speed and try again.');
      // keep the clearest matches, then the median time
      cands.sort((a, b) => a.d - b.d);
      const good = cands.slice(0, Math.max(3, Math.ceil(cands.length / 2))).map((c) => c.dt).sort((a, b) => a - b);
      const ms = Math.round(good[Math.floor(good.length / 2)] + 120); // + spin-up from standstill
      const spread = Math.round(good[good.length - 1] - good[0]);
      say(`Turn calibrated: a full circle takes ${ms} ms at ${turnSpeed}% (${frames.length} photos, ${good.length} matches, spread ${spread} ms)`);
      return { turnMs360: ms, photos: frames.length, matches: good.length, spreadMs: spread };
    } finally { this.busy = false; }
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
  // Laser sweep: with the laser + gyro the car turns once slowly on the spot while reading the distance ~15 times a second,
  // giving the outline of the room around it (walls, furniture) in 5° steps. null when the car has no laser + gyro.
  async sweep(progress = () => {}) {
    const s = await this.robot.sensors();
    if (!s || !s.tof || !s.imu || !this.robot.gyroTurn) return null;
    progress('Laser sweep: the car turns once slowly and measures all around…');
    const y0 = Number(s.yaw), raw = [];
    let done = false;
    const turning = this.robot.gyroTurn(360, 50).catch(() => null).finally(() => { done = true; });
    const t0 = Date.now();
    while (!done && Date.now() - t0 < 20000) {
      const v = await this.robot.sensors();
      if (v && v.imu) raw.push({ deg: ((Number(v.yaw) - y0) % 360 + 360) % 360, mm: Number(v.dist) });
      await sleep(25);
    }
    await turning;
    const bins = {};
    for (const r of raw) { const b = Math.round(r.deg / 5) * 5 % 360; (bins[b] = bins[b] || []).push(r.mm); }
    const out = [];
    for (let b = 0; b < 360; b += 5) {
      const v = (bins[b] || []).filter((x) => x > 0).sort((a, c) => a - c);
      const none = (bins[b] || []).length && !v.length;
      if (v.length) out.push({ deg: b, m: Math.round(v[Math.floor(v.length / 2)] / 10) / 100 });
      else if (none) out.push({ deg: b, m: null }); // free beyond 2 m
    }
    return out.length >= 12 ? out : null;
  }

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
      const sweep = await this.sweep(progress).catch((e) => { this.log(`laser sweep failed: ${e.message}`); return null; });
      progress('Looking at the photos…');
      const analysis = await this.analyze(photos).catch((e) => { this.log(`room scan: analysis failed: ${e.message}`); return null; });
      const pose = this.robot.pose ? { x: this.robot.pose.x, y: this.robot.pose.y, heading: this.robot.pose.heading } : { x: 0, y: 0, heading: 0 };
      const map = { version: 2, createdAt: Date.now(), steps, turnMs360: this.cfg().turnMs360, pose, views: photos.map((p) => ({ heading: p.heading, file: path.basename(p.file) })), analysis, sweep };
      map.landmarks = Mapper.landmarks(map);
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
      if (this.onMap) try { this.onMap(map); } catch {}
      progress('Room map ready');
      return { id: stamp, dir, summary, svg, png, collage, photos: photos.map((p) => p.file), analysis };
    } finally { this.busy = false; }
  }

  // What is in the photos. A local vision model (offline) looks at one photo at a time; a cloud model sees all at once.
  async analyze(photos) {
    const s = this.getSettings();
    const vm = this.vision ? this.vision.pick(s.model) : (s.apiKey ? s.model : null);
    if (!vm) return null;
    if (this.vision && require('./models').isLocal(vm)) return this.analyzeEach(photos, vm);
    try { return await this.analyzeAll(photos, vm); } catch (e) {
      const local = this.vision ? this.vision.localVisionModels() : [];
      if (!local.length) throw e;
      this.log(`room scan: ${vm} failed (${e.message}); using ${local[0]} on this PC`);
      return this.analyzeEach(photos, local[0]);
    }
  }

  async analyzeEach(photos, model) {
    const views = [];
    for (let i = 0; i < photos.length; i++) {
      this.emit('robot:scan', { text: `Looking at photo ${i + 1}/${photos.length} (${model.replace(/^local:/, '')})…` });
      const v = await this.vision.view({ buffer: photos[i].buffer, mime: 'image/jpeg' }, { model }).catch((e) => ({ description: `(not analysed: ${e.message})`, objects: [], free_m: 0 }));
      views.push({ heading: photos[i].heading, description: v.description, objects: v.objects, free_m: v.free_m });
    }
    const near = views.flatMap((v) => v.objects.map((o) => ({ ...o, at: Math.round((v.heading + o.bearing + 360) % 360) }))).sort((a, b) => a.distance_m - b.distance_m);
    const open = views.slice().sort((a, b) => b.free_m - a.free_m)[0];
    const summary = `${near.slice(0, 6).map((o) => `${o.name} at ${o.at}° (~${o.distance_m.toFixed(1)} m)`).join(', ') || 'No objects recognised'}.${open && open.free_m ? ` Most open space towards ${open.heading}° (~${open.free_m.toFixed(1)} m free).` : ''}`;
    return { views, room: `seen by ${model.replace(/^local:/, '')} on this PC`, summary, model };
  }

  async analyzeAll(photos, model) {
    const s = this.getSettings();
    const content = [{ type: 'text', text: `These ${photos.length} photos were taken by a small robot car's camera (about ${FOV}° wide, 10 cm above the floor) while it turned on the spot to the RIGHT in equal steps. Heading 0° = the direction it faced first; headings grow clockwise. For each photo list the main objects with: bearing inside the photo in degrees (-${FOV / 2} = left edge, 0 = centre, +${FOV / 2} = right edge) and estimated distance from the car in metres. Also estimate free_m = how far the car could drive straight towards the photo centre before hitting something. Reply with JSON only:\n{"views":[{"heading":0,"description":"short","objects":[{"name":"chair","bearing":-10,"distance_m":1.2}],"free_m":1.5}],"room":"one line about the room type and size","summary":"2-3 sentences: what is around the car at which headings, where the open space and the exits/doors are"}` }];
    for (const p of photos) {
      content.push({ type: 'text', text: `Heading ${p.heading}°:` });
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.buffer.toString('base64')}` } });
    }
    const res = await this.api.complete({ model: model || s.model, messages: [{ role: 'user', content }] });
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

  // Newest room map (or null).
  latestMap() {
    const root = path.join(this.getSettings().workspace, 'maps');
    try {
      const id = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'map.json'))).sort().pop();
      return id ? { id, ...JSON.parse(fs.readFileSync(path.join(root, id, 'map.json'), 'utf8')) } : null;
    } catch { return null; }
  }

  // Go to an object: find it with the camera (straight ahead, the last room map, then looking around), turn towards it
  // and drive in short hops, checking with a new photo after each hop, until it is close. Returns a step log and the
  // final photo. onPhoto(photo) is called for the photo where the target was found and for the final one.
  async goto(target, { stopAt = 0.45, maxHops = 6, source = 'ai', onPhoto, signal, chatModel, onStatus } = {}) {
    if (!this.vision) throw new Error('vision is not available');
    target = String(target || '').trim();
    if (!target) throw new Error('say what to go to, e.g. "the red chair"');
    this.needCar();
    if (this.busy) throw new Error('The car is busy (a scan is running).');
    this.busy = true;
    const log = [];
    const say = (t) => { log.push(t); this.emit('robot:scan', { text: t }); if (onStatus) onStatus(t); };
    const stop = () => signal && signal.aborted;
    const snap = async () => { const ph = await this.camera.capture(); this.emit('robot:look', { direction: 'goto', path: ph.path }); return ph; };
    // Where is the target, and how much free floor is ahead? Distances come from the floor geometry (where the box /
    // the obstacle touches the floor in the picture); the model's own guess is only the fallback.
    const g = geometry.cfgOf(this.getSettings().robot);
    const laser = async () => { const s = this.robot.sensors ? await this.robot.sensors().catch(() => null) : null; return s && s.tof ? (s.dist > 0 ? s.dist / 1000 : 2) : null; }; // metres ahead, 2 = nothing within 2 m
    const where0 = async (ph) => {
      const img = { buffer: ph.buffer, mime: ph.mime || 'image/jpeg' };
      let m = null;
      if (this.vision.measure) { try { m = await this.vision.measure(img, target, { chatModel, signal }); } catch (e) { this.log(`goto: measuring failed (${e.message}), using the model's estimate`); } }
      if (m && (m.box || m.floorEndY != null)) {
        const free = m.floorEndY != null ? Math.min(6, geometry.floorDistanceCm(m.floorEndY, g) / 100) : null;
        if (!m.visible) return { visible: false, bearing: 0, distance_m: null, free_m: free, what: m.what };
        const [x1, y1, x2, y2] = m.box;
        const close = y2 > 0.97 || y2 - y1 > 0.85 || x2 - x1 > 0.9; // it fills the picture: right in front of the car
        return { visible: true, bearing: geometry.bearingOf((x1 + x2) / 2, g), distance_m: close ? 0 : Math.min(6, geometry.floorDistanceCm(y2, g) / 100), free_m: free, what: m.what, close, measured: true };
      }
      return this.vision.locate(img, target, { chatModel, signal });
    };
    // the laser (VL53L0X) measures straight ahead in millimetres: it replaces the camera's free-space estimate, and the
    // target distance too when the target is straight ahead
    const where = async (ph) => {
      const r = await where0(ph);
      const l = await laser();
      if (l == null) return r;
      const out = { ...r, free_m: l, laser: true };
      if (r.visible && Math.abs(r.bearing || 0) < 8 && (r.distance_m == null || l < r.distance_m + 0.4)) { out.distance_m = l; out.measured = true; }
      return out;
    };
    const cm = (v) => (v == null || !Number.isFinite(v) ? '?' : `${Math.round(v * 100)} cm`);
    let heading = 0; // degrees turned from the start, + = right
    const turn = async (d, look = false) => { d = Math.round(d); if (Math.abs(d) < 4) return; await this.turn(d, source, { look }); heading += d; };
    // search steps a bit smaller than what the camera sees (60° wide), so each view overlaps the last one and
    // nothing at the edge of the picture is missed: 45° = 8 looks for a full circle
    const fov = geometry.cfgOf(this.getSettings().robot).hfovDeg || 60;
    const step = 360 / Math.ceil(360 / Math.max(30, fov - 15));
    try {
      // 1) search: ahead, then the heading from the last room map, then around: turn one step, STOP, look, … — it
      // stops turning as soon as the target is in the picture (never spins blindly)
      let ph = await snap(), seen = await where(ph);
      say(`Ahead: ${seen.visible ? `found ${target} (${seen.what})` : `no ${target}`}`);
      if (!seen.visible) {
        const map = this.latestMap();
        const words = target.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        const hit = map && map.analysis && (map.analysis.views || []).flatMap((v) => (v.objects || []).map((o) => ({ ...o, heading: v.heading }))).find((o) => words.some((w) => o.name.toLowerCase().includes(w)));
        if (hit) {
          const d = ((hit.heading + hit.bearing + 540) % 360) - 180;
          say(`The room map (${map.id}) has ${hit.name} at ${Math.round(hit.heading + hit.bearing)}° — turning ${Math.round(d)}°`);
          await turn(d); ph = await snap(); seen = await where(ph);
        }
      }
      for (let i = 0; !seen.visible && i < Math.round(360 / step) - 1 && !stop(); i++) {
        await turn(step, true); ph = await snap(); seen = await where(ph);
        say(`Looked at ${((heading % 360) + 360) % 360}°: ${seen.visible ? `found ${target}` : 'not here'}`);
      }
      if (!seen.visible) {
        await turn(-((heading % 360 + 540) % 360 - 180)).catch(() => {});
        say(`Could not find ${target} anywhere around the car.`);
        if (onPhoto) onPhoto(ph);
        return { arrived: false, found: false, log, photo: ph };
      }
      if (onPhoto) onPhoto(ph);
      // 2) approach in short hops. Never drive further in total than the first measured distance (a "budget"), never
      // further than the free floor, and stop when the picture shows the car did not move (it bumped into something).
      let lost = 0, driven = 0;
      let budget = Math.max(0, (seen.distance_m ?? 1) - stopAt);
      for (let hop = 1; hop <= maxHops && !stop(); hop++) {
        if (!seen.visible) {
          // out of the picture (after steering around something): look a little left and right
          for (const d of [-30, 60]) { await turn(d); ph = await snap(); seen = await where(ph); if (seen.visible) break; }
          if (!seen.visible) { await turn(-30); say(`Lost sight of ${target}.`); break; }
        }
        if (Math.abs(seen.bearing) >= 6) await turn(seen.bearing);
        const dist = seen.distance_m ?? 1;
        budget = Math.min(budget, driven + Math.max(0, dist - stopAt)); // a closer measurement shrinks the budget
        const left = budget - driven;
        if (seen.close || left < 0.08) { say(`Arrived: ${target} is ${seen.close ? 'right in front of the car' : `about ${cm(dist)} ahead`}.`); if (onPhoto) onPhoto(ph); return { arrived: true, found: true, log, photo: ph, distance_m: dist }; }
        let go = Math.max(0.08, Math.min(0.35, left));
        const free = seen.free_m;
        if (free != null && free < dist - 0.1) {
          if (free < 0.3) {
            say(`Hop ${hop}: something is in the way (${cm(free)} free) — steering around it`);
            const side = await this.findGap(snap, where, turn, say);
            if (!side) { say('Blocked on both sides — stopping here.'); break; }
            ph = await snap(); seen = await where(ph);
            continue;
          }
          go = Math.min(go, Math.max(0.08, free - 0.2));
        }
        say(`Hop ${hop}: ${target} ${cm(dist)} ${seen.bearing < -5 ? 'left' : seen.bearing > 5 ? 'right' : 'ahead'}${free != null ? `, ${cm(free)} free` : ''}${seen.measured ? '' : ' (estimated)'} → driving ${cm(go)}`);
        const before = ph.buffer;
        await this.forward(go, source);
        driven += go;
        ph = await snap();
        const s = this.robot.sensors ? await this.robot.sensors().catch(() => null) : null;
        if (s && s.blocked) say(`The car's distance sensor stopped it ${s.dist > 0 ? `${Math.round(s.dist / 10)} cm` : ''} before an obstacle.`);
        const diff = before && ph.buffer ? this.frameDiff(before, ph.buffer) : null;
        if ((s && s.blocked && !(seen.visible && seen.distance_m != null && seen.distance_m < stopAt + 0.3)) || (diff != null && diff < 0.02)) {
          say(`Bump: the picture did not change after driving (${(diff * 100).toFixed(1)}%) — the car is blocked. Backing up 10 cm.`);
          await this.forward(-0.1, source); driven -= 0.1;
          const side = await this.findGap(snap, where, turn, say);
          if (!side) { say('Blocked on both sides — stopping here.'); break; }
          ph = await snap(); seen = await where(ph);
          continue;
        }
        seen = await where(ph);
        if (!seen.visible) {
          // maybe it is just outside the picture: check a little left and right
          let found = false;
          for (const d of [-30, 60]) { await turn(d); ph = await snap(); seen = await where(ph); if (seen.visible) { found = true; break; } }
          if (!found) { await turn(-30); if (++lost >= 2) break; say(`Lost sight of ${target}; trying once more.`); seen = { visible: true, bearing: 0, distance_m: Math.max(stopAt, dist - go) }; }
        } else lost = 0;
      }
      if (onPhoto) onPhoto(ph);
      const done = seen.visible && (seen.close || (seen.distance_m ?? 9) <= stopAt + 0.2);
      say(done ? `Arrived near ${target}.` : `Stopped: ${seen.visible ? `${target} is still about ${cm(seen.distance_m)} away` : `lost sight of ${target}`}.`);
      return { arrived: done, found: true, log, photo: ph, distance_m: seen.distance_m };
    } finally {
      this.busy = false;
      try { this.robot.stop('goto'); } catch {}
    }
  }

  // Blocked ahead: look 40° left and right for free space, drive past the obstacle on the freer side.
  // Returns the angle turned (to turn back to the target afterwards) or 0 when both sides are blocked.
  async findGap(snap, where, turn, say) {
    // IR obstacle modules on the car (front-left / front-right): go to the side that is free
    const sn = this.robot.sensors ? await this.robot.sensors().catch(() => null) : null;
    if (sn && sn.ir && sn.irLeft !== sn.irRight) {
      const side = sn.irLeft ? 40 : -40;
      say(`The ${sn.irLeft ? 'left' : 'right'} IR sensor sees the obstacle — going round on the ${side > 0 ? 'right' : 'left'}`);
      await turn(side); await this.forward(0.2); await turn(-side);
      return side;
    }
    const sides = [];
    for (const d of [-40, 80]) { await turn(d); const ph = await snap(); const s = await where(ph); sides.push({ side: d < 0 ? -40 : 40, free: s.free_m == null ? 0.4 : s.free_m }); }
    await turn(-40); // back to the middle
    const best = sides.sort((a, b) => b.free - a.free)[0];
    if (!best || best.free < 0.4) return 0;
    await turn(best.side);
    const step = Math.min(0.3, best.free - 0.2);
    say(`More room on the ${best.side < 0 ? 'left' : 'right'} (${Math.round(best.free * 100)} cm) — driving ${Math.round(step * 100)} cm to get past`);
    await this.forward(step);
    await turn(-best.side);
    return best.side;
  }

  // Objects the camera named, placed in metres around the scan spot (x = right, y = ahead at the start). With a laser
  // sweep the distance comes from the laser at that angle when it sees something there (more exact than the photo).
  static landmarks(map) {
    const out = [];
    const a = map.analysis || { views: [] };
    for (const v of a.views || []) for (const o of v.objects || []) {
      const deg = ((v.heading + (Number(o.bearing) || 0)) % 360 + 360) % 360;
      let dist = Number(o.distance_m) || 1, src = 'camera';
      if (map.sweep) {
        const near = map.sweep.filter((p) => p.m && Math.min(Math.abs(p.deg - deg), 360 - Math.abs(p.deg - deg)) <= 7.5).map((p) => p.m).sort((x, y) => x - y);
        if (near.length && Math.abs(near[0] - dist) < Math.max(0.6, dist * 0.6)) { dist = near[0]; src = 'laser'; }
      }
      const r = (deg * Math.PI) / 180, ph = ((map.pose && map.pose.heading) || 0) * Math.PI / 180;
      out.push({ name: o.name, deg, distance_m: Math.round(dist * 100) / 100, from: src, x: Math.round(((map.pose ? map.pose.x : 0) + Math.sin(r + ph) * dist) * 100) / 100, y: Math.round(((map.pose ? map.pose.y : 0) + Math.cos(r + ph) * dist) * 100) / 100 });
    }
    return out;
  }

  static summaryText(map) {
    const a = map.analysis;
    if (!a) return `🗺️ Scanned ${map.steps} directions (photos saved). To name what is around the car, add the Meta API key or download a vision model (Settings → AI models → Local models, e.g. llama3.2-vision:11b).`;
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
    let wedges = '', objs = '', ticks = '', outline = '';
    if (map.sweep && map.sweep.length) { // laser outline of the room: points joined where they are close
      const pts = map.sweep.filter((q) => q.m).map((q) => pt(q.deg, Math.min(3.4, q.m)));
      outline = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ff8a3d"/>`).join('');
      const seg = []; const sw = map.sweep;
      for (let i = 0; i < sw.length; i++) { const p1 = sw[i], p2 = sw[(i + 1) % sw.length]; if (p1.m && p2.m && Math.abs(p1.m - p2.m) < 0.35 && (p2.deg - p1.deg + 360) % 360 <= 10) { const [x1, y1] = pt(p1.deg, Math.min(3.4, p1.m)), [x2, y2] = pt(p2.deg, Math.min(3.4, p2.m)); seg.push(`M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`); } }
      outline = `<path d="${seg.join(' ')}" stroke="#ff8a3d" stroke-width="2.5" fill="none" stroke-linecap="round"/>${outline}`;
    }
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
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#0d0f12"/>${rings}${wedges}${outline}${ticks}${objs}${car}<text x="20" y="${H - 44}" fill="#e8eaed" font-size="16" font-weight="600">${title}</text><text x="20" y="${H - 22}" fill="#9aa0a6" font-size="13">${sub} · green = free space${map.sweep ? ' · orange = laser outline' : ''} · 0° = start direction</text></svg>`;
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
    if (!/^[\w-]+$/.test(id) || !/^(map\.svg|map\.png|map\.json|collage\.jpg|view-\d{3}\.jpg)$/.test(name)) return null;
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
