// Missions: small robot programs made with blocks (Robot → 🧱 Blocks) or taught by driving (teach & repeat), run here on
// the PC step by step through the same safe robot functions the AI uses (the car's own safety stop, the failsafe and the
// STOP button still work). A program is plain JSON — never code that is executed — so a mission file cannot do anything
// but drive the robot.
//   statements: { op: 'forward'|'back', cm } { op: 'turn', deg } { op: 'drive', left, right, ms } { op: 'wait', s }
//               { op: 'stop' } { op: 'speed', pct } { op: 'say', text } { op: 'photo' } { op: 'look', dir } { op: 'scan' }
//               { op: 'goto', target } { op: 'light', v } { op: 'repeat', n, body } { op: 'while', cond, body }
//               { op: 'if', cond, then, else } { op: 'log', text }
//   conditions: { op: 'dist_lt'|'dist_gt', cm } { op: 'blocked' } { op: 'true' } { op: 'not', a } { op: 'and'|'or', a, b }
'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_STEPS = 600, MAX_MS = 10 * 60 * 1000;
const safeName = (n) => String(n || '').trim().replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').slice(0, 40);

class Missions {
  constructor({ robot, mapper, camera, emit, log = () => {}, getSettings }) {
    Object.assign(this, { robot, mapper, camera, emit, log, getSettings });
    this.running = null;
    this.teach = null;
  }
  dir() { const d = path.join(this.getSettings().workspace, 'missions'); fs.mkdirSync(d, { recursive: true }); return d; }
  list() {
    return fs.readdirSync(this.dir()).filter((f) => f.endsWith('.json')).map((f) => {
      try { const j = JSON.parse(fs.readFileSync(path.join(this.dir(), f), 'utf8')); return { name: j.name, kind: j.kind, steps: count(j.program), at: j.at }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  get(name) { const f = path.join(this.dir(), `${safeName(name)}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; }
  save(name, data) {
    const n = safeName(name);
    if (!n) throw new Error('Give the mission a name.');
    validate(data.program);
    const j = { name: n, kind: data.kind || 'blocks', program: data.program, blocks: data.blocks || null, at: new Date().toISOString() };
    fs.writeFileSync(path.join(this.dir(), `${n}.json`), JSON.stringify(j, null, 1));
    return j;
  }
  remove(name) { const f = path.join(this.dir(), `${safeName(name)}.json`); if (fs.existsSync(f)) fs.unlinkSync(f); return { ok: true }; }

  // ---------------------------------------------------------------- running
  stop(reason = 'stopped') { if (this.running) { this.running.abort = reason; } this.robot.stop('mission'); return { ok: true }; }
  async run(program, { name = 'mission' } = {}) {
    validate(program);
    if (this.running) throw new Error('A mission is already running.');
    const ctx = { abort: null, steps: 0, t0: Date.now(), speed: Number((this.getSettings().robot || {}).driveSpeed) || 60, name, said: [] };
    this.running = ctx;
    const say = (text) => { this.emit('robot:mission', { name, text }); };
    say(`▶ ${name} started`);
    try {
      await this.block(program, ctx);
      say(ctx.abort ? `■ ${name} stopped (${ctx.abort})` : `✓ ${name} finished (${ctx.steps} steps)`);
      return { ok: !ctx.abort, steps: ctx.steps, stopped: ctx.abort || null };
    } catch (e) {
      this.robot.stop('mission');
      say(`✕ ${name}: ${e.message}`);
      return { ok: false, steps: ctx.steps, error: e.message };
    } finally { this.running = null; }
  }
  async block(list, ctx) { for (const st of list || []) { if (ctx.abort) return; await this.stmt(st, ctx); } }
  async stmt(st, ctx) {
    if (++ctx.steps > MAX_STEPS) throw new Error(`more than ${MAX_STEPS} steps — is a loop endless?`);
    if (Date.now() - ctx.t0 > MAX_MS) throw new Error('the mission ran longer than 10 minutes');
    const note = (t) => this.emit('robot:mission', { name: ctx.name, text: t, step: ctx.steps });
    const cfg = this.mapper.cfg();
    switch (st.op) {
      case 'forward': case 'back': {
        const m = (Math.max(1, Math.min(300, Number(st.cm) || 0)) / 100) * (st.op === 'back' ? -1 : 1);
        note(`${st.op === 'back' ? 'Back' : 'Forward'} ${Math.abs(m * 100)} cm`);
        const ms = Math.max(150, Math.round((Math.abs(m) * 100 / cfg.cmPerSec) * 1000 * (cfg.driveSpeed / ctx.speed)));
        const sp = Math.sign(m) * ctx.speed;
        const r = await this.robot.runPlan([{ type: 'drive', left: sp, right: sp, ms: Math.min(8000, ms) }, { type: 'stop' }], 'mission');
        if (!r.completed) { ctx.abort = ctx.abort || r.reason || 'interrupted'; return; }
        await sleep(250); return;
      }
      case 'turn': { const d = Math.max(-360, Math.min(360, Number(st.deg) || 0)); note(`Turn ${d}°`); await this.mapper.turn(d, 'mission'); return; }
      case 'drive': {
        const ms = Math.max(50, Math.min(8000, Number(st.ms) || 0));
        const r = await this.robot.runPlan([{ type: 'drive', left: clamp(st.left), right: clamp(st.right), ms }, ...(st.keep ? [] : [{ type: 'stop' }])], 'mission');
        if (!r.completed) ctx.abort = ctx.abort || r.reason || 'interrupted';
        return;
      }
      case 'wait': { const ms = Math.max(0, Math.min(60, Number(st.s) || 0)) * 1000; note(`Wait ${ms / 1000} s`); const t = Date.now(); while (Date.now() - t < ms && !ctx.abort) await sleep(100); return; }
      case 'stop': this.robot.stop('mission'); return;
      case 'speed': ctx.speed = Math.max(20, Math.min(100, Number(st.pct) || 60)); note(`Speed ${ctx.speed} %`); return;
      case 'say': { const t = String(st.text || '').slice(0, 300); if (t) { this.emit('robot:say', { text: t, by: 'mission' }); note(`Say "${t}"`); await sleep(Math.min(6000, 400 + t.length * 60)); } return; }
      case 'log': note(String(st.text || '').slice(0, 200)); return;
      case 'photo': { note('Photo'); const ph = await this.camera.capture(); this.emit('robot:photo', { path: ph.path, source: ph.source }); return; }
      case 'look': { note(`Look ${st.dir}`); await this.mapper.look(st.dir || 'front', { source: 'mission' }); return; }
      case 'scan': note('Scanning the room'); await this.mapper.scan({ steps: 8, source: 'mission' }); return;
      case 'goto': {
        if (!this.mapper.goto) throw new Error('go to is not available');
        note(`Go to ${st.target}`); const r = await this.mapper.goto(String(st.target || ''), { source: 'mission' }); note(r && r.arrived ? `Arrived at ${st.target}` : `Did not reach ${st.target}`); return;
      }
      case 'place': { // a place named on the room map (Robot → Map): plan a way around the known walls and drive there
        if (!this.roommap) throw new Error('the room map is not available');
        note(`Go to the place "${st.name}"`);
        const p = this.roommap.places.find((q) => q.name.toLowerCase() === String(st.name || '').toLowerCase().trim()) || this.roommap.objects.find((q) => q.name.toLowerCase() === String(st.name || '').toLowerCase().trim());
        if (!p) throw new Error(`No place called "${st.name}" on the room map.`);
        this.roommap.stopFlag = false;
        const r = await this.roommap.driveTo(p.x, p.y, p.name); note(r.text); return;
      }
      case 'light': await this.robot.led(Math.max(0, Math.min(255, Number(st.v) || 0))).catch(() => {}); return;
      case 'repeat': { const n = Math.max(0, Math.min(100, Math.round(Number(st.n) || 0))); for (let i = 0; i < n && !ctx.abort; i++) await this.block(st.body, ctx); return; }
      case 'while': { let i = 0; while (!ctx.abort && (await this.cond(st.cond)) && i++ < 200) await this.block(st.body, ctx); return; }
      case 'if': { if (await this.cond(st.cond)) await this.block(st.then, ctx); else await this.block(st.else, ctx); return; }
      default: throw new Error(`unknown step "${st.op}"`);
    }
  }
  async cond(c) {
    if (!c) return false;
    switch (c.op) {
      case 'true': return true;
      case 'not': return !(await this.cond(c.a));
      case 'and': return (await this.cond(c.a)) && (await this.cond(c.b));
      case 'or': return (await this.cond(c.a)) || (await this.cond(c.b));
      case 'dist_lt': case 'dist_gt': {
        const s = await this.robot.sensors();
        if (!s || !s.tof) throw new Error('this mission needs the laser distance sensor');
        const d = s.dist > 0 ? s.dist / 10 : 999; // nothing within 2 m = far
        return c.op === 'dist_lt' ? d < Number(c.cm) : d > Number(c.cm);
      }
      case 'blocked': { const s = await this.robot.sensors(); return !!(s && s.blocked); }
      default: throw new Error(`unknown condition "${c.op}"`);
    }
  }

  // ---------------------------------------------------------------- teach & repeat: drive by hand, the car remembers
  teachStart() { this.teach = { segs: [], cur: null, t0: Date.now() }; this.robot.onCommand = (l, r, src) => this.record(l, r, src); return { ok: true, recording: true }; }
  record(l, r, src) {
    const t = this.teach; if (!t || /mission|^ai$/.test(src || '')) return;
    const now = Date.now();
    if (t.cur && t.cur.left === l && t.cur.right === r) return;
    if (t.cur) { t.cur.ms = now - t.cur.at; if (t.cur.ms >= 40) t.segs.push({ op: 'drive', left: t.cur.left, right: t.cur.right, ms: t.cur.ms }); }
    t.cur = { left: l, right: r, at: now };
  }
  teachStop(name) {
    const t = this.teach; this.teach = null; this.robot.onCommand = null;
    if (!t) throw new Error('Not recording.');
    if (t.cur) { t.cur.ms = Date.now() - t.cur.at; if (t.cur.left || t.cur.right) t.segs.push({ op: 'drive', left: t.cur.left, right: t.cur.right, ms: t.cur.ms }); }
    // merge pauses into waits, drop the trailing stop
    const program = [];
    for (const s of t.segs) {
      if (!s.left && !s.right) { if (program.length) program.push({ op: 'wait', s: Math.round(s.ms / 100) / 10 }); continue; }
      program.push({ op: 'drive', left: s.left, right: s.right, ms: Math.min(8000, s.ms), keep: true });
    }
    while (program.length && program[program.length - 1].op === 'wait') program.pop();
    program.push({ op: 'stop' });
    if (program.length < 2) throw new Error('Nothing was driven while recording.');
    return this.save(name || `Taught ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')}`, { kind: 'taught', program });
  }
}
const clamp = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));
function count(p) { let n = 0; for (const s of p || []) { n++; n += count(s.body) + count(s.then) + count(s.else); } return n; }
const OPS = new Set(['forward', 'back', 'turn', 'drive', 'wait', 'stop', 'speed', 'say', 'log', 'photo', 'look', 'scan', 'goto', 'place', 'light', 'repeat', 'while', 'if']);
const COPS = new Set(['true', 'not', 'and', 'or', 'dist_lt', 'dist_gt', 'blocked']);
function validate(p, depth = 0) {
  if (!Array.isArray(p)) throw new Error('A mission is a list of steps.');
  if (depth > 12) throw new Error('Too deeply nested.');
  const vc = (c, d) => { if (!c || !COPS.has(c.op)) throw new Error(`Unknown condition ${c && c.op}`); if (d > 12) throw new Error('Too deeply nested.'); if (c.a) vc(c.a, d + 1); if (c.b) vc(c.b, d + 1); };
  for (const s of p) {
    if (!s || !OPS.has(s.op)) throw new Error(`Unknown step ${s && s.op}`);
    for (const k of ['body', 'then', 'else']) if (s[k] != null) validate(s[k], depth + 1);
    if (s.cond) vc(s.cond, 0);
  }
  if (count(p) > 2000) throw new Error('The mission is too long.');
}

module.exports = { Missions, validate, count };
