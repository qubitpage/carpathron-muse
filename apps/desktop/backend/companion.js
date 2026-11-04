'use strict';
// Muse Carpathron 2.3 — Carpathron, the companion.
// The Quest 3 user talks to Carpathron in their real room. Carpathron sees the room through the headset camera
// (the newest picture plus the objects smart vision found in it), remembers the conversation, answers like a
// person and turns tasks into actions:
//   demo  — the 3D Carpathron standing in the room (mixed reality) does them in the headset
//   real  — the real robot car does them for real (drive, turn, find an object with its own camera, explore, scan)
// "outline" asks SAM 3.1 for the exact box of an object in the room picture. The answer is spoken with the robot's
// neural voice; the headset plays the sound from Carpathron's head.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ACTIONS = ['none', 'come', 'follow', 'stay', 'goto', 'forward', 'back', 'left', 'right', 'spin', 'dance', 'wave', 'look', 'outline', 'stop', 'explore', 'scan', 'photo'];

function clean(s, n = 400) {
  return String(s || '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}

const MOODS = ['happy', 'curious', 'thinking', 'excited', 'calm', 'sorry', 'proud'];

// short, clear commands are answered at once (no model call): the robot reacts while you are still looking at it
const QUICK = [
  [/^(stop|halt|freeze|stop it|stop now)$/, () => ({ say: 'Okay, stopping.', action: 'stop', mood: 'calm' })],
  [/^(stay|wait|stay there|stay here|wait there|wait here)$/, () => ({ say: "Sure, I'll wait right here.", action: 'stay', mood: 'calm' })],
  [/^(come here|come to me|come over here|come over|come back|come)$/, () => ({ say: 'Coming!', action: 'come', mood: 'happy' })],
  [/^(follow me|follow|come with me)$/, () => ({ say: 'Right behind you!', action: 'follow', mood: 'excited' })],
  [/^(dance|dance for me|do a dance|let's dance)$/, () => ({ say: 'Watch my moves!', action: 'dance', mood: 'excited' })],
  [/^(wave|say hi|say hello|wave at me)$/, () => ({ say: 'Hi there!', action: 'wave', mood: 'happy' })],
  [/^(spin|turn around|spin around|do a spin)$/, () => ({ say: 'Wheee!', action: 'spin', mood: 'excited' })],
  [/^(?:go|walk|move|run|come) (?:over )?there$/, () => ({ say: 'Okay, over there!', action: 'goto', target: 'there', mood: 'happy' })],
  [/^(?:go|walk|drive|move|run) (?:to|over to|near) (?:the |that |this |my )?([a-z][a-z ]{1,24})$/, (m) => ({ say: `On my way to the ${m[1]}!`, action: 'goto', target: m[1], mood: 'happy' })],
];
function quick(text) {
  const t = String(text || '').toLowerCase().replace(/^(hey |ok |okay |please |carpathron,? )+/, '').replace(/[.!?,]+/g, '').replace(/\s+(please|now|carpathron)$/, '').trim();
  if (!t || t.split(' ').length > 6) return null;
  for (const [re, f] of QUICK) { const m = re.exec(t); if (m) return { amount: 0, target: '', ...f(m), quick: true }; }
  return null;
}

function parseReply(txt) {
  const t = String(txt || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let j = null;
  if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch { j = null; } }
  if (!j) return { say: clean(t) || 'Sorry, could you say that again?', action: 'none', target: '', amount: 0, mood: 'sorry' };
  const action = ACTIONS.includes(String(j.action || '').toLowerCase()) ? String(j.action).toLowerCase() : 'none';
  const mood = MOODS.includes(String(j.mood || '').toLowerCase()) ? String(j.mood).toLowerCase() : 'happy';
  return { say: clean(j.say) || (action === 'none' ? 'Hmm?' : 'On it!'), action, target: clean(j.target, 40), amount: Number(j.amount) || 0, mood };
}

// SAM box -> [x, y, w, h] in 0..1
function samBox(b) {
  let { x1, y1, x2, y2, w, h } = b;
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (x2 > 1.5 || y2 > 1.5) { const W = w > 2 ? w : 640, H = h > 2 ? h : 480; x1 /= W; x2 /= W; y1 /= H; y2 /= H; }
  const c = (v) => Math.max(0, Math.min(1, v));
  return [c(x1), c(y1), c(x2 - x1), c(y2 - y1)];
}

class Companion {
  constructor(d) {
    Object.assign(this, d);   // { agent, store, tts, robot, mapper, roommap, missions, liveVision, roomEyes, log, emit }
    this.history = [];         // [{role, content}] last turns (text only)
    this.busy = false;
    this.task = '';            // what the real car is doing now
  }

  roomObjects() {
    const lv = this.liveVision;
    if (lv.src !== 'room' || !lv.seen.length || Date.now() - lv.at > 60000) return [];
    return lv.seen.map((o) => `${o.label} (${o.kind}${o.dist ? `, about ${o.dist} m away` : ''})`);
  }

  freshPicture() {
    const e = this.roomEyes;
    if (e.last && Date.now() - e.at < 5000) return { jpg: e.last, from: 'headset' };
    const hub = this.robot && this.robot._hub;
    if (hub && hub.last && Date.now() - hub.lastAt < 3000) return { jpg: hub.last, from: 'car' };
    return null;
  }

  async turn({ text, mode = 'demo' }) {
    const s = this.store.settings;
    if (!s.apiKey) return { say: 'Add the Meta API key in Muse Carpathron settings, then I can talk with you.', action: 'none' };
    const real = mode === 'real' && this.robot.state === 'online';
    const q = quick(text);
    if (q) {
      this.history.push({ role: 'user', content: String(text).slice(0, 600) }, { role: 'assistant', content: JSON.stringify({ say: q.say, action: q.action, target: q.target }) });
      if (real) q.doing = await this.act(q).catch((e) => `couldn't: ${e.message}`);
      q.mode = real ? 'real' : 'demo';
      this.log(`Companion (${q.mode}, quick): "${clean(text, 80)}" → [${q.action}${q.target ? ' ' + q.target : ''}]`);
      this.emit('companion', { heard: text, say: q.say, action: q.action, target: q.target, mode: q.mode });
      return q;
    }
    if (this.busy) return { say: 'One moment, I am still thinking about the last thing you said.', action: 'none', mood: 'thinking' };
    this.busy = true;
    try {
      const objs = this.roomObjects();
      const pic = this.freshPicture();
      const sys = [
        `You are Carpathron, a small friendly robot and the user's companion. The user wears a Meta Quest 3 headset in their real room.`,
        real ? 'You are a REAL robot car (Baby Carpathron, 4 wheels, a camera 10 cm above the floor) on the floor of that room: your actions really drive the car, so be careful and only move when asked.'
          : 'They see you as a 3D robot (about 1 m tall) standing in their real room (mixed reality). You walk on their floor.',
        pic ? `The picture is what ${pic.from === 'headset' ? 'the user sees right now (headset camera)' : 'your car camera sees'}.` : 'You have no picture right now.',
        objs.length ? `Objects you recognised in the room: ${objs.join('; ')}.` : '',
        this.task ? `You are busy with: ${this.task}.` : '',
        'Talk like a warm, witty, curious human friend, not an assistant: 1-3 short spoken sentences, natural and casual (contractions, a little humour, real reactions), no lists, no markdown, no emoji. Never say you are an AI model. Use the room: notice and mention what you see when it fits. Remember the conversation and refer back to it. Now and then ask the user a short question back, so it feels like a real conversation. Reply in the user\'s language.',
        'When the user gives you a task, do it with ONE action. Reply with JSON only:',
        '{"say":"what you say aloud","action":"none|come|follow|stay|goto|forward|back|left|right|spin|dance|wave|look|outline|stop|explore|scan|photo","target":"an object (for goto / outline)","amount":metres or degrees,"mood":"happy|curious|thinking|excited|calm|sorry|proud"}',
        'Actions: none = just talk; come = come to the user; follow = follow the user; stay = stay where you are; goto = go to an object (target); forward/back = move amount metres; left/right = turn amount degrees; spin = turn around; dance; wave; look = tell what you see; outline = point out an object precisely (target); stop; explore = drive around and map the room; scan = photo scan of the room; photo = take a picture.',
      ].filter(Boolean).join('\n');
      const user = pic ? [{ type: 'text', text: String(text).slice(0, 600) }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${pic.jpg.toString('base64')}` } }] : String(text).slice(0, 600);
      const r = await this.agent.api.complete({ model: s.model, messages: [{ role: 'system', content: sys }, ...this.history.slice(-12), { role: 'user', content: user }] });
      const out = parseReply(r.content);
      this.history.push({ role: 'user', content: String(text).slice(0, 600) }, { role: 'assistant', content: JSON.stringify(out) });
      if (this.history.length > 24) this.history.splice(0, this.history.length - 24);
      if (out.action === 'outline' && pic) out.boxes = await this.outline(pic.jpg, out.target || 'object');
      if (real) out.doing = await this.act(out).catch((e) => `couldn't: ${e.message}`);
      out.mode = real ? 'real' : 'demo';
      this.log(`Companion (${out.mode}): "${clean(text, 80)}" → "${clean(out.say, 80)}"${out.action !== 'none' ? ` [${out.action}${out.target ? ' ' + out.target : ''}${out.amount ? ' ' + out.amount : ''}]` : ''}`);
      this.emit('companion', { heard: text, say: out.say, action: out.action, target: out.target, mode: out.mode });
      return out;
    } finally { this.busy = false; }
  }

  // SAM 3.1: exact boxes of the target in the room picture
  async outline(jpg, target) {
    const file = path.join(os.tmpdir(), `carpathron-room-${Date.now()}.jpg`);
    try {
      fs.writeFileSync(file, jpg);
      const r = await this.agent.media.segment({ file, prompt: target });
      return r.boxes.map(samBox).filter(Boolean).slice(0, 4).map((box) => ({ label: target, kind: 'item', box, near: false, sam: true }));
    } catch (e) { this.log(`SAM 3.1: ${e.message}`); return []; }
    finally { try { fs.unlinkSync(file); } catch {} }
  }

  // the real car does the task (in the background; STOP from the headset cancels it)
  async act(o) {
    const { robot, mapper, roommap, missions } = this;
    const bg = (job, what) => { this.task = what; job.catch((e) => this.log(`Companion task: ${e.message}`)).finally(() => { if (this.task === what) this.task = ''; }); return what; };
    const m = Math.max(0.1, Math.min(2, Math.abs(o.amount) || 0.5));
    const deg = Math.max(10, Math.min(360, Math.abs(o.amount) || 90));
    switch (o.action) {
      case 'stop': case 'stay': roommap.stop('companion'); missions.stop('companion'); robot.stop('companion'); this.task = ''; return 'stopped';
      case 'forward': return bg(mapper.forward(m, 'companion'), `driving ${m} m forward`);
      case 'back': return bg(robot.runPlan([{ type: 'drive', left: -60, right: -60, ms: Math.round(m / 0.28 * 1000) }, { type: 'stop' }], 'companion'), `backing up ${m} m`);
      case 'left': return bg(mapper.turn(-deg, 'companion'), `turning left ${deg}°`);
      case 'right': return bg(mapper.turn(deg, 'companion'), `turning right ${deg}°`);
      case 'spin': return bg(mapper.turn(360, 'companion'), 'spinning around');
      case 'dance': return bg(robot.runPlan([{ type: 'drive', left: 70, right: -70, ms: 400 }, { type: 'drive', left: -70, right: 70, ms: 400 }, { type: 'drive', left: 70, right: -70, ms: 400 }, { type: 'drive', left: -70, right: 70, ms: 400 }, { type: 'drive', left: 60, right: 60, ms: 300 }, { type: 'drive', left: -60, right: -60, ms: 300 }, { type: 'stop' }], 'companion'), 'dancing');
      case 'wave': return bg(robot.runPlan([{ type: 'drive', left: 55, right: -55, ms: 220 }, { type: 'drive', left: -55, right: 55, ms: 220 }, { type: 'drive', left: 55, right: -55, ms: 220 }, { type: 'drive', left: -55, right: 55, ms: 220 }, { type: 'stop' }], 'companion'), 'waving');
      case 'goto': case 'come': case 'follow': {
        if (roommap.busy || mapper.busy) return `busy: ${roommap.busy || 'scanning'}`;
        const what = o.action === 'goto' ? (o.target || 'object') : 'person';
        mapper.needCar();
        return bg(roommap.find(what), `finding the ${what}`);
      }
      case 'explore': if (roommap.busy || mapper.busy) return 'busy'; mapper.needCar(); return bg(roommap.explore(6), 'exploring the room');
      case 'scan': if (roommap.busy || mapper.busy) return 'busy'; mapper.needCar(); return bg(mapper.scan({ source: 'companion' }), 'scanning the room');
      default: return '';
    }
  }
}

module.exports = { Companion, parseReply, samBox, ACTIONS, quick, MOODS };
