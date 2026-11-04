// The room map the car learns by itself (Robot → 🗺 Map): an occupancy grid made from the laser distance sensor and
// the car's position (wheels + gyro). Every laser reading says "free floor up to here, something solid there"; the grid
// adds them up, so the more the car drives around and measures, the better the map gets. On the map you can put the
// robot where it really is, name places ("door", "charger"), and send the car somewhere: it plans a way around what it
// knows is solid (A*), and drives it in short hops (the laser still stops it before anything new).
//
// Grid: 5 cm cells, 12 × 12 m around the start point, values -100 (surely free) … +100 (surely solid), 0 = not seen.
// Saved in <workspace>/maps/room-map.json (old maps are kept as room-map-<date>.json when you start a new one).
'use strict';
const fs = require('fs');
const path = require('path');

const RES = 0.05, SIZE = 240, HALF = SIZE / 2; // 240 × 5 cm = 12 m
const HIT = 30, MISS = -8, MAXV = 100, SOLID = 25, FREE = -8;
const LASER_MAX = 2.0, LASER_AHEAD = 0.1; // metres; the laser sits about 10 cm in front of the car's centre
const CAR_R = 0.16; // metres: half the car's width plus room to turn (2.2.2: was 0.13, the car scraped things)
const HAZARD_R = 0.22; // metres kept away from a step / drop / bump the car felt
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Grid {
  constructor(data) { this.v = data ? Int8Array.from(Buffer.from(data, 'base64')) : new Int8Array(SIZE * SIZE); if (this.v.length !== SIZE * SIZE) this.v = new Int8Array(SIZE * SIZE); }
  static cell(x, y) { return [Math.floor(x / RES) + HALF, Math.floor(y / RES) + HALF]; }
  static centre(i, j) { return [(i - HALF + 0.5) * RES, (j - HALF + 0.5) * RES]; }
  in(i, j) { return i >= 0 && j >= 0 && i < SIZE && j < SIZE; }
  get(i, j) { return this.in(i, j) ? this.v[j * SIZE + i] : 0; }
  add(i, j, d) { if (!this.in(i, j)) return; const k = j * SIZE + i; this.v[k] = Math.max(-MAXV, Math.min(MAXV, this.v[k] + d)); }
  // one laser reading from (x, y) in direction heading (degrees, 0 = ahead at the start, clockwise); m = null → nothing within range
  // The VL53L0X sees a cone of about 25°: what it measures is the nearest thing in that cone, so the floor is free
  // up to that distance across the middle of the cone (±6°), and the hit is marked on the centre line.
  ray(x, y, heading, m) {
    for (const off of [-6, -3, 3, 6]) this.beam(x, y, heading + off, m == null ? null : m, false);
    this.beam(x, y, heading, m, true);
  }
  beam(x, y, heading, m, centre) {
    const a = (heading * Math.PI) / 180, sx = Math.sin(a), sy = Math.cos(a);
    const ox = x + sx * LASER_AHEAD, oy = y + sy * LASER_AHEAD;
    const hit = m != null && m > 0.02 && m < LASER_MAX, len = (hit ? m : LASER_MAX * 0.75) - (centre ? 0 : RES * 1.5);
    if (len <= 0) return; // beyond range: only the near part is surely free
    const steps = Math.ceil(len / (RES / 2));
    let last = '';
    for (let s = 0; s < steps; s++) {
      const d = (s * len) / steps, [i, j] = Grid.cell(ox + sx * d, oy + sy * d), k = `${i},${j}`;
      if (k !== last) { this.add(i, j, MISS); last = k; }
    }
    if (hit && centre) { const [i, j] = Grid.cell(ox + sx * m, oy + sy * m); this.add(i, j, HIT - MISS); }
  }
  stats() {
    let free = 0, solid = 0;
    for (const v of this.v) { if (v <= FREE) free++; else if (v >= SOLID) solid++; }
    return { freeM2: Math.round(free * RES * RES * 10) / 10, solidCells: solid, wallM: Math.round(solid * RES * 10) / 10 };
  }
  // cells for drawing: [i, j, v] of everything seen
  cells() { const out = []; for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) { const v = this.v[j * SIZE + i]; if (v <= FREE || v >= SOLID) out.push(i, j, v); } return out; }
  toJSON() { return Buffer.from(this.v.buffer, this.v.byteOffset, this.v.byteLength).toString('base64'); }
  // A* from (x0, y0) to (x1, y1) in metres. Solid cells are grown by the car's size; unknown cells cost more than free.
  // hazards: steps / drops / bumps the car felt ({ x, y }), kept HAZARD_R away.
  plan(x0, y0, x1, y1, hazards = []) {
    const grow = Math.ceil(CAR_R / RES), blocked = new Uint8Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) if (this.v[j * SIZE + i] >= SOLID) {
      for (let dj = -grow; dj <= grow; dj++) for (let di = -grow; di <= grow; di++) if (di * di + dj * dj <= grow * grow && this.in(i + di, j + dj)) blocked[(j + dj) * SIZE + i + di] = 1;
    }
    const hg = Math.ceil(HAZARD_R / RES);
    for (const h of hazards) { const [hi, hj] = Grid.cell(h.x, h.y); for (let dj = -hg; dj <= hg; dj++) for (let di = -hg; di <= hg; di++) if (di * di + dj * dj <= hg * hg && this.in(hi + di, hj + dj)) blocked[(hj + dj) * SIZE + hi + di] = 1; }
    const [si, sj] = Grid.cell(x0, y0); let [gi, gj] = Grid.cell(x1, y1);
    if (!this.in(gi, gj)) return null;
    // the start may sit inside the grown border (next to a wall): free a small area around it
    for (let dj = -grow; dj <= grow; dj++) for (let di = -grow; di <= grow; di++) if (this.in(si + di, sj + dj)) blocked[(sj + dj) * SIZE + si + di] = 0;
    if (blocked[gj * SIZE + gi]) { // goal too close to something solid: the nearest reachable cell next to it
      let best = null;
      for (let r = 1; r < grow * 3 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = gi + di, j = gj + dj; if (this.in(i, j) && !blocked[j * SIZE + i] && (!best || di * di + dj * dj < best[2])) best = [i, j, di * di + dj * dj]; }
      if (!best) return null; [gi, gj] = best;
    }
    const N = SIZE * SIZE, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (i, j) => Math.hypot(i - gi, j - gj);
    const open = [[h(si, sj), si, sj]]; g[sj * SIZE + si] = 0;
    const push = (n) => { open.push(n); let k = open.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (open[p][0] <= open[k][0]) break; [open[p], open[k]] = [open[k], open[p]]; k = p; } };
    const pop = () => { const top = open[0], end = open.pop(); if (open.length) { open[0] = end; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === k) break; [open[m], open[k]] = [open[k], open[m]]; k = m; } } return top; };
    open.length = 0; push([h(si, sj), si, sj]);
    let found = false, n = 0;
    while (open.length && n++ < 200000) {
      const [, i, j] = pop(), k = j * SIZE + i;
      if (closed[k]) continue; closed[k] = 1;
      if (i === gi && j === gj) { found = true; break; }
      for (const [di, dj, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const a = i + di, b = j + dj; if (!this.in(a, b)) continue;
        const kk = b * SIZE + a; if (blocked[kk] || closed[kk]) continue;
        const cost = g[k] + c * (this.v[kk] <= FREE ? 1 : 3); // unknown floor: allowed, but the free one is preferred
        if (cost < g[kk]) { g[kk] = cost; from[kk] = k; push([cost + h(a, b), a, b]); }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = gj * SIZE + gi; k !== -1; k = from[k]) cells.push([k % SIZE, Math.floor(k / SIZE)]);
    cells.reverse();
    // keep only the corners: a straight line between two kept points never crosses a blocked cell
    const clear = (a, b) => { const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2; for (let s = 0; s <= steps; s++) { const i = Math.round(a[0] + ((b[0] - a[0]) * s) / steps), j = Math.round(a[1] + ((b[1] - a[1]) * s) / steps); if (blocked[j * SIZE + i]) return false; } return true; };
    const keep = [cells[0]]; let at = 0;
    while (at < cells.length - 1) { let k = cells.length - 1; while (k > at + 1 && !clear(cells[at], cells[k])) k--; keep.push(cells[k]); at = k; }
    return keep.slice(1).map(([i, j]) => { const [x, y] = Grid.centre(i, j); return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }; });
  }
  // the nearest free cell that has unseen floor next to it (where the car should go to learn more)
  frontier(x, y, skip = []) {
    const [ci, cj] = Grid.cell(x, y); let best = null;
    for (let j = 1; j < SIZE - 1; j++) for (let i = 1; i < SIZE - 1; i++) {
      if (this.v[j * SIZE + i] > FREE) continue;
      let unk = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = this.v[(j + dj) * SIZE + i + di]; if (v > FREE && v < SOLID) unk++; }
      if (!unk) continue;
      let near = false; for (let dj = -3; dj <= 3 && !near; dj++) for (let di = -3; di <= 3; di++) if (this.get(i + di, j + dj) >= SOLID) { near = true; break; }
      if (near) continue;
      const [px, py] = Grid.centre(i, j);
      if (skip.some((s) => Math.hypot(s.x - px, s.y - py) < 0.4)) continue;
      const d = Math.hypot(i - ci, j - cj) * RES;
      if (d < 0.35) continue;
      if (!best || d < best.d) best = { x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100, d };
    }
    return best;
  }
}

class RoomMap {
  constructor({ robot, mapper, getSettings, emit, log }) {
    Object.assign(this, { robot, mapper, getSettings, emit, log });
    this.grid = new Grid(); this.places = []; this.objects = []; this.hazards = []; this.createdAt = Date.now();
    this._counts = null;
    this.dirty = false; this.busy = null; this.stopFlag = false; this.route = null;
    this.load();
    this._save = setInterval(() => { if (this.dirty) this.save(); }, 5000);
    this._learn = setInterval(() => this.listen().catch(() => {}), 220);
    this._last = null;
  }
  file() { return path.join(this.getSettings().workspace || '.', 'maps', 'room-map.json'); }
  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      this.grid = new Grid(j.grid); this.places = j.places || []; this.objects = j.objects || []; this.hazards = j.hazards || []; this.createdAt = j.createdAt || Date.now();
    } catch {}
  }
  save() {
    try { fs.mkdirSync(path.dirname(this.file()), { recursive: true }); fs.writeFileSync(this.file(), JSON.stringify({ version: 1, res: RES, size: SIZE, createdAt: this.createdAt, savedAt: Date.now(), grid: this.grid.toJSON(), places: this.places, objects: this.objects, hazards: this.hazards })); this.dirty = false; } catch (e) { this.log(`room map: not saved (${e.message})`); }
  }
  // while the car is online with the laser: add what it measures (only when it has moved or turned a little,
  // so a car standing still doesn't make one cell "very sure")
  async listen() {
    if (this._busyListen || this.robot.state !== 'online') return;
    const c = this.robot.current || {}, l0 = this._last, p0 = this.robot.pose;
    // standing still and already measured from here: nothing new to learn (and no extra requests to the car)
    if (l0 && !c.left && !c.right && Math.hypot(p0.x - l0.x, p0.y - l0.y) < 0.03 && Math.abs(p0.heading - l0.heading) < 3) return;
    this._busyListen = true;
    try {
      const s = await this.robot.sensors();
      if (!s) return;
      this.feel(s);
      if (!s.tof) return;
      const p = this.robot.pose, m = s.dist > 0 ? s.dist / 1000 : null;
      const l = this._last;
      if (l && Math.hypot(p.x - l.x, p.y - l.y) < 0.03 && Math.abs(p.heading - l.heading) < 3) return;
      this._last = { x: p.x, y: p.y, heading: p.heading };
      this.grid.ray(p.x, p.y, p.heading, m);
      // side eyes (Mega hub 1.1, optional): two more HC-SR04 at the front corners, turned 45° outwards
      if (s.sideEyes) for (const [deg, mm] of [[-45, s.sideL], [45, s.sideR]]) this.grid.beam(p.x, p.y, p.heading + deg, mm > 0 ? mm / 1000 : null, true);
      this.dirty = true; this.changed();
    } finally { this._busyListen = false; }
  }
  // What the car FELT (car firmware 2.4): a bump, a step / edge (sudden lean) or a drop (no floor under the drop
  // sensor). The car has already stopped and backed off by itself; here the spot goes on the map so routes avoid it.
  feel(s) {
    const now = { bump: s.bumps | 0, step: s.tiltStops | 0, drop: s.cliffStops | 0 };
    const was = this._counts; this._counts = now;
    if (!was) return null;
    const p = this.robot.pose; let added = null;
    for (const kind of ['bump', 'step', 'drop']) {
      if (now[kind] <= was[kind]) continue;
      const back = s.hazardDir === -1 && s.hazard === kind ? -1 : 1;   // a step met while reversing is behind the car
      const a = (p.heading * Math.PI) / 180, d = 0.2 * back;              // the car backed off ~10 cm: the spot is ~20 cm ahead
      const h = { kind, x: +(p.x + Math.sin(a) * d).toFixed(2), y: +(p.y + Math.cos(a) * d).toFixed(2), at: Date.now() };
      this.hazards = this.hazards.filter((q) => q.kind !== h.kind || Math.hypot(q.x - h.x, q.y - h.y) > 0.12).concat(h).slice(-80);
      if (kind === 'bump') { const [i, j] = Grid.cell(h.x, h.y); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) this.grid.add(i + di, j + dj, 2 * MAXV); }   // surely solid, even where the floor looked free
      this.dirty = true; this.changed(); added = h;
      this.say(kind === 'bump' ? 'Bumped into something low — marked on the map.' : kind === 'drop' ? 'Edge: no floor ahead — stopped, marked on the map.' : 'Step / edge felt (the car leaned) — stopped, marked on the map.');
    }
    return added;
  }
  changed() { clearTimeout(this._ch); this._ch = setTimeout(() => this.emit('robot:roommap', { stats: this.grid.stats() }), 400); }
  view() { return { res: RES, size: SIZE, cells: this.grid.cells(), places: this.places, objects: this.objects, hazards: this.hazards, stats: this.grid.stats(), pose: this.robot.pose, route: this.route, busy: this.busy, createdAt: this.createdAt }; }
  reset() {
    try { if (fs.existsSync(this.file())) fs.renameSync(this.file(), this.file().replace(/\.json$/, `-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)); } catch {}
    this.grid = new Grid(); this.places = []; this.objects = []; this.hazards = []; this.createdAt = Date.now(); this.route = null; this.dirty = true; this.save(); this.changed();
  }
  addPlace(name, x, y) {
    name = String(name || '').trim().slice(0, 40); if (!name) throw new Error('Give the place a name.');
    if (!Number.isFinite(+x) || !Number.isFinite(+y)) throw new Error('Pick the place on the map.');
    this.places = this.places.filter((p) => p.name.toLowerCase() !== name.toLowerCase()); this.places.push({ name, x: +(+x).toFixed(2), y: +(+y).toFixed(2) });
    this.dirty = true; this.changed(); return this.places;
  }
  removePlace(name) { this.places = this.places.filter((p) => p.name !== name); this.dirty = true; this.changed(); return this.places; }
  // objects the camera named in a room scan (Mapper landmarks, already in map metres)
  addObjects(list) {
    for (const l of list || []) { if (!Number.isFinite(l.x) || !Number.isFinite(l.y)) continue; this.objects = this.objects.filter((o) => !(o.name === l.name && Math.hypot(o.x - l.x, o.y - l.y) < 0.6)); this.objects.push({ name: l.name, x: +l.x.toFixed(2), y: +l.y.toFixed(2), from: l.from || 'camera' }); }
    this.objects = this.objects.slice(-60); this.dirty = true; this.changed();
  }
  setPose(x, y, heading) { this.robot.setPose({ x: +x, y: +y, heading: +heading }); this._last = null; return this.robot.pose; }
  plan(x, y) {
    const p = this.robot.pose, r = this.grid.plan(p.x, p.y, +x, +y, this.hazards);
    if (!r) throw new Error('No way there on the map — it is behind walls the car has seen, or outside the map.');
    return r;
  }
  stop(why = 'STOP pressed') { this.stopFlag = true; this.robot.stop(why); }
  async task(name, fn) {
    if (this.busy) throw new Error(`The car is busy: ${this.busy}. Press ■ Stop first.`);
    this.busy = name; this.stopFlag = false; this.emit('robot:roommap', { busy: name, stats: this.grid.stats() });
    try { return await fn(); } finally { this.busy = null; this.route = null; this.emit('robot:roommap', { busy: null, stats: this.grid.stats(), done: name }); }
  }
  say(text) { this.emit('robot:roommap', { text }); }
  // drive a planned route: each corner with mapper.gotoPoint (turn + short hops, laser stop); re-plans when blocked
  async driveTo(x, y, label = 'there', tries = 3) {
    for (let attempt = 0; attempt < tries; attempt++) {
      const route = this.plan(x, y); this.route = route; this.emit('robot:roommap', { route });
      let blocked = false;
      for (const pt of route) {
        if (this.stopFlag) throw new Error('stopped');
        const r = await this.mapper.gotoPoint(pt.x, pt.y, { source: 'map', abort: () => this.stopFlag });
        if (r.blocked) { blocked = true; if (attempt < tries - 1) { this.say('Something is in the way — finding another way…'); await this.measureAround(8).catch(() => {}); } break; }
      }
      if (!blocked) return { ok: true, text: `Arrived at ${label}.` };
    }
    const p = this.robot.pose;
    return { ok: false, text: `Could not reach ${label}: blocked (stopped ${Math.hypot(p.x - x, p.y - y).toFixed(1)} m away).` };
  }
  goTo(x, y, label) { return this.task(`going to ${label || 'a point'}`, () => this.driveTo(+x, +y, label || 'the point')); }
  goToPlace(name) {
    const want = String(name || '').toLowerCase().trim();
    const p = this.places.find((q) => q.name.toLowerCase() === want) || this.objects.find((q) => q.name.toLowerCase() === want) || this.places.find((q) => q.name.toLowerCase().includes(want)) || this.objects.find((q) => q.name.toLowerCase().includes(want));
    if (!p) throw new Error(`No place called "${name}" on the map. Places: ${this.places.map((q) => q.name).join(', ') || 'none yet'}.`);
    return this.goTo(p.x, p.y, p.name);
  }
  // 🎯 Find an object: known on the map (a place, or something the camera named in a scan) → drive there around
  // what the map knows; then the camera takes over for the last part (photo, turn, short hop … until close).
  // Not known yet → photo scan here; still not seen → explore the nearest unknown part and scan again (up to `rounds`).
  find(name, { rounds = 3, vision = true } = {}) {
    const want = String(name || '').toLowerCase().trim();
    if (!want) throw new Error('What should the car find?');
    const match = () => this.places.find((q) => q.name.toLowerCase() === want) || this.objects.find((q) => q.name.toLowerCase() === want)
      || this.places.find((q) => q.name.toLowerCase().includes(want) || want.includes(q.name.toLowerCase()))
      || this.objects.find((q) => q.name.toLowerCase().includes(want) || want.includes(q.name.toLowerCase()));
    return this.task(`finding the ${name}`, async () => {
      let it = match();
      const tried = [];
      // 2.3.4: not on the map → look for it with the camera RIGHT HERE, one step at a time (turn ~45°, stop, look),
      // and go to it as soon as it is in the picture. No full photo scans and laser spins first. Only when it is not
      // anywhere around, drive to an unknown part of the room and look again.
      if (!it && vision && this.mapper.goto && this.mapper.vision) {
        for (let n = 0; n < rounds; n++) {
          if (this.stopFlag) return { ok: false, text: 'Stopped.' };
          this.say(n ? `Looking for the ${name} here…` : `Looking around for the ${name}, a bit at a time…`);
          const ctl = new AbortController(); const iv = setInterval(() => { if (this.stopFlag) ctl.abort(); }, 200);
          const g = await this.mapper.goto(name, { stopAt: 0.35, maxHops: 6, source: 'map', onStatus: (t) => this.say(t), signal: ctl.signal }).catch((e) => ({ found: false, text: e.message })).finally(() => clearInterval(iv));
          if (this.stopFlag) return { ok: false, text: 'Stopped.' };
          if (g && g.found) return { ok: !!g.arrived, text: g.arrived ? `Found the ${name}: it is right in front of the car.` : `Found the ${name}${g.distance_m != null ? ` (about ${Math.round(g.distance_m * 100)} cm ahead)` : ''}.`, log: g.log };
          const p = this.robot.pose, f = this.grid.frontier(p.x, p.y, tried);
          if (!f) break;
          tried.push(f);
          this.say(`No ${name} around here — going to look in another part of the room (${f.d.toFixed(1)} m away)…`);
          await this.driveTo(f.x, f.y, 'the unknown part', 2).catch((e) => this.say(e.message));
        }
        return { ok: false, text: `I looked all around but couldn't find the ${name}.` };
      }
      for (let n = 0; !it && n < rounds; n++) {
        if (this.stopFlag) return { ok: false, text: 'Stopped.' };
        if (!this.mapper.scan) break;
        this.say(`Looking for the ${name}: photo scan ${n + 1}/${rounds}…`);
        await this.mapper.scan({ steps: 8, source: 'map' }).catch((e) => this.say(`Scan: ${e.message}`));
        it = match(); if (it) break;
        const p = this.robot.pose, f = this.grid.frontier(p.x, p.y, tried);
        if (!f) break;
        tried.push(f);
        this.say(`Not seen yet — going to look in an unknown part (${f.d.toFixed(1)} m away)…`);
        await this.driveTo(f.x, f.y, 'the unknown part', 2).catch((e) => this.say(e.message));
      }
      if (!it) return { ok: false, text: `Could not find the ${name}. Objects on the map: ${this.objects.map((o) => o.name).join(', ') || 'none yet (Scan with photos)'}.` };
      this.say(`The ${it.name} is on the map — driving there…`);
      // stop ~40 cm before it: the route goes to the nearest free spot next to it
      const p = this.robot.pose, d = Math.hypot(it.x - p.x, it.y - p.y);
      const k = d > 0.45 ? (d - 0.4) / d : 0;
      const r = k ? await this.driveTo(p.x + (it.x - p.x) * k, p.y + (it.y - p.y) * k, `the ${it.name}`) : { ok: true };
      if (this.stopFlag) return { ok: false, text: 'Stopped.' };
      if (vision && this.mapper.goto && this.mapper.vision) {
        this.say(`Close to the ${it.name}: the camera takes over…`);
        // face it first (the camera looks straight ahead)
        const q = this.robot.pose, want2 = (Math.atan2(it.x - q.x, it.y - q.y) * 180) / Math.PI;
        let turn = ((want2 - q.heading + 540) % 360) - 180;
        if (Math.abs(turn) > 8) await this.mapper.turn(turn, 'map').catch(() => {});
        const g = await this.mapper.goto(it.name, { stopAt: 0.35, maxHops: 4, source: 'map' }).catch((e) => ({ ok: false, text: e.message }));
        if (!g || g.ok === false || g.found === false) return { ok: r.ok, text: `${r.ok ? 'Arrived near' : 'Got close to'} the ${it.name} by the map; the camera could not confirm it (${(g && g.text) || 'not in view'}).` };
        return { ok: true, text: g.arrived ? `Found the ${it.name}: it is right in front of the car.` : `Found the ${it.name} (about ${Math.round((g.distance_m || 0) * 100)} cm ahead).`, log: g.log };
      }
      return { ok: r.ok, text: r.ok ? `Arrived at the ${it.name}.` : r.text };
    });
  }
  patrol(points, loops = 1) {
    if (!Array.isArray(points) || points.length < 2) throw new Error('Pick at least 2 points for a patrol.');
    loops = Math.max(1, Math.min(20, Math.round(+loops || 1)));
    return this.task('patrolling', async () => {
      for (let n = 0; n < loops; n++) for (let i = 0; i < points.length; i++) {
        if (this.stopFlag) return { ok: false, text: 'Patrol stopped.' };
        this.say(`Patrol ${n + 1}/${loops}: point ${i + 1} of ${points.length}`);
        const r = await this.driveTo(points[i].x, points[i].y, `point ${i + 1}`);
        if (!r.ok) this.say(r.text);
      }
      return { ok: true, text: `Patrol done (${loops} × ${points.length} points).` };
    });
  }
  // turn once around (with the gyro: one smooth turn, measured continuously; without: 12 steps of 30°)
  // the distance sensor (laser, or the Mega hub's HC-SR04): wait up to `ms` for it — Mega hub 1.1 restarts itself
  async waitSensor(ms = 7000) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.robot.sensors();
      if (s && s.tof) return s;
      if (Date.now() - t0 > ms || this.stopFlag) return s;
      this.say('Waiting for the distance sensor to come back…'); await sleep(700);
    }
  }
  async measureAround(steps = 12) {
    const s = await this.waitSensor();
    if (!s || !s.tof) throw new Error('No distance sensor: the car needs the laser (VL53L0X) or the Mega hub\'s HC-SR04 eyes to map the room (Robot → Setup → Sensors on the car).');
    if (s.imu && this.robot.gyroTurn) {
      let done = false; const t = this.robot.gyroTurn(360, 50).catch(() => null).finally(() => { done = true; });
      const t0 = Date.now();
      while (!done && Date.now() - t0 < 20000 && !this.stopFlag) { this._last = null; await this.listen(); await sleep(40); }
      await t;
    } else {
      for (let i = 0; i < steps && !this.stopFlag; i++) { this._last = null; await this.listen(); await this.mapper.turn(360 / steps, 'map'); await sleep(250); }
    }
    this.save();
    return this.grid.stats();
  }
  measureHere() { return this.task('measuring all around', async () => { const st = await this.measureAround(); return { ok: true, text: `Measured all around: ${st.freeM2} m² of floor known.` }; }); }
  // Explore: measure here, then drive to the nearest edge of what is known, measure again … (at most `rounds` times)
  explore(rounds = 6) {
    rounds = Math.max(1, Math.min(15, Math.round(+rounds || 6)));
    return this.task('exploring the room', async () => {
      const tried = [];
      for (let n = 0; n < rounds; n++) {
        if (this.stopFlag) return { ok: false, text: 'Exploring stopped.' };
        this.say(`Exploring ${n + 1}/${rounds}: measuring all around…`);
        await this.measureAround();
        const p = this.robot.pose, f = this.grid.frontier(p.x, p.y, tried);
        if (!f) return { ok: true, text: `The room is explored: ${this.grid.stats().freeM2} m² of floor known.` };
        tried.push(f);
        this.say(`Going to look at an unknown part (${f.d.toFixed(1)} m away)…`);
        try { await this.driveTo(f.x, f.y, 'the unknown part', 1); } catch (e) { if (this.stopFlag) break; this.say(e.message); }
      }
      return { ok: true, text: `Explored ${rounds} spots: ${this.grid.stats().freeM2} m² of floor known.` };
    });
  }
  close() { clearInterval(this._save); clearInterval(this._learn); if (this.dirty) this.save(); }
}

module.exports = { RoomMap, Grid, RES, SIZE };
