// Robot page → 🧱 Blocks: a step builder that reads like a list of sentences — no canvas, nothing can overlap.
//  • "Make the car do something" — a mission in the server's JSON step format ("Drive forward 40 cm", "Repeat 4 times").
//  • "Program a board" — steps about real things ("LED on pin 2 → ON", "Servo on pin 13 turns to 90°") that become
//    Arduino code with a comment on every line. Next to the steps the app always explains in plain English what the program
//    will do and what to connect; the code is there when you want to see it.
// Steps are added by clicking an action on the left: it goes where the "New steps go here" line is. Every step has
// ▲ ▼ ⧉ ✕ buttons (and a ⠿ handle to drag it); Ctrl+Z undoes the last 30 changes.
(() => {
  'use strict';
  const ui = () => window.MCui;
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const BOARD_NAMES = { esp32devkit: 'ESP32 DevKit', esp32cam: 'ESP32-CAM (the car board)', xiaoesp32s3: 'XIAO ESP32S3', uno: 'Arduino Uno', mega2560: 'Arduino Mega', pico: 'Raspberry Pi Pico' };
  const FQBN = { esp32devkit: 'esp32:esp32:esp32', esp32cam: 'esp32:esp32:esp32cam', xiaoesp32s3: 'esp32:esp32:XIAO_ESP32S3', uno: 'arduino:avr:uno', mega2560: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico' };
  const KIDS = ['body', 'then', 'else'];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let uidN = 0;
  const newId = () => `s${(++uidN).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // the program without the editor's own ids (what is saved, run and shown)
  const clean = (list) => (Array.isArray(list) ? list : []).map((s) => { const o = {}; for (const [k, v] of Object.entries(s || {})) { if (k[0] === '_') continue; o[k] = KIDS.includes(k) ? clean(v) : (v && typeof v === 'object' ? clone(v) : v); } return o; });
  const withIds = (list) => (Array.isArray(list) ? list : []).filter((s) => s && typeof s === 'object').map((s) => { const o = { ...clone(s), _id: newId() }; for (const k of KIDS) if (Array.isArray(s[k])) o[k] = withIds(s[k]); return o; });
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
  const int = (v) => Math.round(Number(v) || 0);

  // ---------------------------------------------------------------- what a step looks like (sentence parts + fields)
  const num = (k, min, max, unit, o = {}) => ({ t: 'num', k, min, max, unit, step: o.step || 1, get: o.get, set: o.set, label: o.label || k });
  const sel = (k, options, o = {}) => ({ t: 'sel', k, options, get: o.get, set: o.set, label: o.label || k });
  const txt = (k, o = {}) => ({ t: 'txt', k, max: o.max || 100, label: o.label || k });
  const pinF = (k = 'pin') => num(k, 0, 60, null, { label: 'pin number' });
  const COND = { t: 'cond' };

  const M_GROUPS = {
    move: { t: 'Move', icon: '🚗', c: '#4f8cff' },
    flow: { t: 'Wait & repeat', icon: '🔁', c: '#f5b74e' },
    decide: { t: 'Decide', icon: '❓', c: '#b07cff' },
    talk: { t: 'Talk & look', icon: '💬', c: '#3ddc97' },
  };
  const M_DEFS = {
    forward: { g: 'move', icon: '🚗', name: 'Drive forward', help: 'Straight ahead, then stop.', make: () => ({ op: 'forward', cm: 30 }), words: ['Drive forward', num('cm', 1, 300, 'cm', { label: 'distance' })] },
    back: { g: 'move', icon: '🔙', name: 'Drive backward', help: 'Straight back, then stop.', make: () => ({ op: 'back', cm: 20 }), words: ['Drive backward', num('cm', 1, 300, 'cm', { label: 'distance' })] },
    turn: { g: 'move', icon: '↪️', name: 'Turn', help: 'On the spot. 90° = a quarter turn.', make: () => ({ op: 'turn', deg: 90 }),
      words: ['Turn', sel('dir', [['R', 'right'], ['L', 'left']], { label: 'direction', get: (s) => (Number(s.deg) < 0 ? 'L' : 'R'), set: (s, v) => { s.deg = Math.abs(Number(s.deg) || 90) * (v === 'L' ? -1 : 1); } }),
        'by', num('deg', 1, 360, '°', { label: 'angle', get: (s) => Math.abs(Number(s.deg) || 0), set: (s, v) => { s.deg = v * (Number(s.deg) < 0 ? -1 : 1); } })] },
    speed: { g: 'move', icon: '🐇', name: 'Set the speed', help: 'For the next drives.', make: () => ({ op: 'speed', pct: 60 }), words: ['Drive at', num('pct', 20, 100, '%', { label: 'speed' }), 'speed'] },
    stop: { g: 'move', icon: '⛔', name: 'Stop the wheels', help: 'Stops at once.', make: () => ({ op: 'stop' }), words: ['Stop the wheels'] },
    wait: { g: 'flow', icon: '⏱️', name: 'Wait', help: 'Stand still for a while.', make: () => ({ op: 'wait', s: 1 }), words: ['Wait', num('s', 0, 60, 'seconds', { step: 0.1, label: 'seconds' })] },
    repeat: { g: 'flow', icon: '🔁', name: 'Repeat', help: 'The steps inside, N times.', make: () => ({ op: 'repeat', n: 4, body: [] }), words: ['Repeat', num('n', 1, 100, 'times', { label: 'how many times' })], kids: [['body', null]], end: 'end of repeat — goes back up' },
    while: { g: 'flow', icon: '♾️', name: 'Repeat while…', help: 'While a question is true.', make: () => ({ op: 'while', cond: { op: 'true' }, body: [] }), words: ['Keep doing this while', COND], kids: [['body', null]], conds: ['true', 'dist_lt', 'dist_gt', 'blocked', 'free'], end: 'end of keep repeating' },
    if: { g: 'decide', icon: '❓', name: 'If … otherwise', help: 'One thing or the other.', make: () => ({ op: 'if', cond: { op: 'dist_lt', cm: 30 }, then: [], else: [] }), words: ['If', COND, ', then:'], kids: [['then', null], ['else', 'Otherwise (if not):']], conds: ['dist_lt', 'dist_gt', 'blocked', 'free'], end: 'end of if' },
    say: { g: 'talk', icon: '💬', name: 'Say something', help: 'Speaks out loud.', make: () => ({ op: 'say', text: 'Hello!' }), words: ['Say', txt('text', { max: 300, label: 'what to say' })] },
    photo: { g: 'talk', icon: '📷', name: 'Take a photo', help: 'With the car camera.', make: () => ({ op: 'photo' }), words: ['Take a photo'] },
    look: { g: 'talk', icon: '👀', name: 'Look around', help: 'Left, right or behind.', make: () => ({ op: 'look', dir: 'left' }), words: ['Look', sel('dir', [['left', 'left'], ['right', 'right'], ['back', 'behind']], { label: 'where to look' }), 'and turn back'] },
    scan: { g: 'talk', icon: '🗺️', name: 'Scan the room', help: 'Photos all around → a map.', make: () => ({ op: 'scan' }), words: ['Scan the room and draw a map'] },
    goto: { g: 'talk', icon: '🎯', name: 'Find and drive to…', help: 'Camera finds it, car goes.', make: () => ({ op: 'goto', target: 'door' }), words: ['Find the', txt('target', { max: 60, label: 'what to find' }), 'and drive to it'] },
    place: { g: 'talk', icon: '🚩', name: 'Go to a place on the map', help: 'A place named on 🗺 Map.', make: () => ({ op: 'place', name: 'door' }), words: ['Go to the place', txt('name', { max: 40, label: 'place name' }), 'on the room map'] },
    light: { g: 'talk', icon: '🔦', name: 'Headlight', help: '0 % = off, 100 % = full.', make: () => ({ op: 'light', v: 128 }), words: ['Headlight at', num('v', 0, 100, '%', { label: 'brightness', get: (s) => Math.round((Number(s.v) || 0) / 2.55), set: (s, v) => { s.v = Math.round(v * 2.55); } })] },
    // only from "teach by driving" / the AI — editable, not in the list on the left
    drive: { g: 'move', icon: '🕹️', name: 'Drive the wheels', help: '', hidden: true, make: () => ({ op: 'drive', left: 50, right: 50, ms: 1000 }),
      words: ['Wheels: left', num('left', -100, 100, '%', { label: 'left wheels' }), 'right', num('right', -100, 100, '%', { label: 'right wheels' }), 'for', num('ms', 0.05, 8, 's', { step: 0.05, label: 'seconds', get: (s) => (Number(s.ms) || 0) / 1000, set: (s, v) => { s.ms = Math.round(v * 1000); } })] },
    log: { g: 'talk', icon: '📝', name: 'Note', help: '', hidden: true, make: () => ({ op: 'log', text: '' }), words: ['Write in the log:', txt('text', { max: 200, label: 'note' })] },
  };
  const M_PALETTE = [
    ['move', [{ op: 'forward' }, { op: 'back' }, { op: 'turn', name: 'Turn right', icon: '↪️', make: () => ({ op: 'turn', deg: 90 }) }, { op: 'turn', name: 'Turn left', icon: '↩️', help: 'On the spot. 180° = turn around.', make: () => ({ op: 'turn', deg: -90 }) }, { op: 'speed' }, { op: 'stop' }]],
    ['flow', [{ op: 'wait' }, { op: 'repeat' }, { op: 'while' }]],
    ['decide', [{ op: 'if', name: 'If something is close', help: 'Uses the laser sensor.' }, { op: 'if', name: 'If the way is blocked', help: 'When it can’t go on.', make: () => ({ op: 'if', cond: { op: 'blocked' }, then: [], else: [] }) }]],
    ['talk', [{ op: 'say' }, { op: 'photo' }, { op: 'look' }, { op: 'scan' }, { op: 'goto' }, { op: 'place' }, { op: 'light' }]],
  ];
  const M_CONDS = { dist_lt: 'something is closer than', dist_gt: 'the way is free for more than', blocked: 'the way ahead is blocked', free: 'the way ahead is free', true: 'always (until you press ■ Stop)' };
  const mCondKind = (c) => (!c ? 'true' : c.op === 'not' && c.a && c.a.op === 'blocked' ? 'free' : M_CONDS[c.op] ? c.op : 'custom');
  const mCondMake = (k, old) => (k === 'free' ? { op: 'not', a: { op: 'blocked' } } : k === 'dist_lt' || k === 'dist_gt' ? { op: k, cm: Number(old && old.cm) || 30 } : { op: k });

  const B_GROUPS = {
    lights: { t: 'Lights', icon: '💡', c: '#ffd84f' },
    sense: { t: 'Buttons & sensors', icon: '🔘', c: '#4fd1ff' },
    motors: { t: 'Motors & servos', icon: '⚙️', c: '#ff8a4f' },
    sound: { t: 'Sound', icon: '🔊', c: '#ff6fb5' },
    time: { t: 'Time', icon: '⏱️', c: '#f5b74e' },
    ctl: { t: 'Repeat & decide', icon: '🔁', c: '#b07cff' },
    show: { t: 'Show on PC', icon: '🖥️', c: '#3ddc97' },
  };
  const HZ = { 2000: 'high', 1000: 'medium', 440: 'low' };
  const B_DEFS = {
    led: { g: 'lights', icon: '💡', name: 'Switch an LED', help: 'On or off.', make: () => ({ op: 'led', pin: 2, on: true }),
      words: ['LED on pin', pinF(), '→', sel('on', [['1', 'ON'], ['0', 'OFF']], { label: 'on or off', get: (s) => (s.on ? '1' : '0'), set: (s, v) => { s.on = v === '1'; } })] },
    dim: { g: 'lights', icon: '🔆', name: 'Dim an LED', help: '0 % = off, 100 % = full.', make: () => ({ op: 'dim', pin: 2, pct: 50 }), words: ['LED on pin', pinF(), 'brightness', num('pct', 0, 100, '%', { label: 'brightness' })] },
    servo: { g: 'motors', icon: '🦾', name: 'Turn a servo', help: 'To an angle from 0° to 180°.', make: () => ({ op: 'servo', pin: 13, deg: 90 }), words: ['Servo on pin', pinF(), 'turns to', num('deg', 0, 180, '°', { label: 'angle' })] },
    motor: { g: 'motors', icon: '⚙️', name: 'Motor speed', help: 'Via a driver (L298N…).', make: () => ({ op: 'motor', pin: 12, pct: 50 }), words: ['Motor (via driver) on pin', pinF(), 'speed', num('pct', 0, 100, '%', { label: 'speed' })] },
    beep: { g: 'sound', icon: '🔊', name: 'Beep', help: 'A tone on a passive buzzer.', make: () => ({ op: 'beep', pin: 15, hz: 2000, s: 0.2 }),
      words: ['Buzzer on pin', pinF(), 'beeps', sel('hz', [['2000', 'high'], ['1000', 'medium'], ['440', 'low']], { label: 'pitch', get: (s) => String(s.hz), set: (s, v) => { s.hz = Number(v); } }), 'for', num('s', 0.05, 10, 'seconds', { step: 0.05, label: 'seconds' })] },
    wait: { g: 'time', icon: '⏱️', name: 'Wait', help: 'Pauses the program.', make: () => ({ op: 'wait', s: 1 }), words: ['Wait', num('s', 0, 3600, 'seconds', { step: 0.01, label: 'seconds' })] },
    waituntil: { g: 'time', icon: '⏳', name: 'Wait until…', help: 'For a button or a sensor.', make: () => ({ op: 'waituntil', cond: { op: 'pressed', pin: 4 } }), words: ['Wait until', COND] },
    repeat: { g: 'ctl', icon: '🔁', name: 'Repeat', help: 'The steps inside, N times.', make: () => ({ op: 'repeat', n: 3, body: [] }), words: ['Repeat', num('n', 1, 10000, 'times', { label: 'how many times' })], kids: [['body', null]], end: 'end of repeat — goes back up' },
    if: { g: 'ctl', icon: '❓', name: 'If … otherwise', help: 'One thing or the other.', make: () => ({ op: 'if', cond: { op: 'pressed', pin: 4 }, then: [], else: [] }), words: ['If', COND, ', then:'], kids: [['then', null], ['else', 'Otherwise (if not):']], end: 'end of if' },
    print: { g: 'show', icon: '🖥️', name: 'Show a message', help: 'Text in the Serial monitor.', make: () => ({ op: 'print', text: 'hello' }), words: ['Show on the PC:', txt('text', { max: 80, label: 'message' })] },
    printsensor: { g: 'show', icon: '📈', name: 'Show a sensor reading', help: 'Its value, 0–100 %.', make: () => ({ op: 'printsensor', pin: 34 }), words: ['Show on the PC: the sensor on pin', pinF(), '(0–100 %)'] },
  };
  const B_PALETTE = [
    ['lights', [{ op: 'led' }, { op: 'led', name: 'LED off', icon: '⚫', help: 'Switches it off.', make: () => ({ op: 'led', pin: 2, on: false }) }, { op: 'dim' }]],
    ['sense', [{ op: 'if', name: 'If the button is pressed', icon: '🔘', help: 'Button from pin to GND.' }, { op: 'if', name: 'If a sensor reads low', icon: '🎚️', help: 'Light sensor, knob… (%)', make: () => ({ op: 'if', cond: { op: 'sensor_lt', pin: 34, v: 30 }, then: [], else: [] }) }, { op: 'waituntil', name: 'Wait for a button press', icon: '⏳' }]],
    ['motors', [{ op: 'servo' }, { op: 'motor' }]],
    ['sound', [{ op: 'beep' }]],
    ['time', [{ op: 'wait' }, { op: 'waituntil' }]],
    ['ctl', [{ op: 'repeat' }, { op: 'if' }]],
    ['show', [{ op: 'print' }, { op: 'printsensor' }]],
  ];
  const B_CONDS = { pressed: 'the button is pressed', released: 'the button is not pressed', sensor_lt: 'the sensor reads less than', sensor_gt: 'the sensor reads more than', high: 'the digital sensor sees something' };
  const bCondMake = (k, old) => ({ op: k, pin: Number.isFinite(Number(old && old.pin)) ? Number(old.pin) : (k.startsWith('sensor') ? 34 : 4), ...(k.startsWith('sensor') ? { v: Number(old && old.v) || 30 } : {}) });

  // ---------------------------------------------------------------- ready-made examples (with what they teach)
  const EXAMPLES = {
    mission: [
      { id: 'square', title: '🟦 Drive a square', text: 'Says hello, then 4 times: forward 40 cm and a quarter turn. Needs about 60 × 60 cm of floor.',
        program: [{ op: 'say', text: 'Watch me draw a square!' }, { op: 'repeat', n: 4, body: [{ op: 'forward', cm: 40 }, { op: 'turn', deg: 90 }] }, { op: 'say', text: 'Done!' }] },
      { id: 'patrol', title: '🚧 Patrol and avoid walls', text: 'Drives forward in short steps; when something is closer than 30 cm it turns right instead. Needs the laser sensor.',
        program: [{ op: 'while', cond: { op: 'true' }, body: [{ op: 'if', cond: { op: 'dist_lt', cm: 30 }, then: [{ op: 'say', text: 'Oops, a wall!' }, { op: 'turn', deg: 90 }], else: [{ op: 'forward', cm: 20 }] }] }] },
      { id: 'greeter', title: '👋 Greeter', text: 'Says hello, looks left and right with photos, and says goodbye.',
        program: [{ op: 'say', text: 'Hello! I am Baby Carpathron.' }, { op: 'look', dir: 'left' }, { op: 'look', dir: 'right' }, { op: 'say', text: 'Nice to meet you. Bye bye!' }] },
      { id: 'dance', title: '💃 Little dance', text: 'Turns left and right, spins once and blinks the headlight.',
        program: [{ op: 'speed', pct: 70 }, { op: 'repeat', n: 2, body: [{ op: 'turn', deg: -45 }, { op: 'turn', deg: 45 }] }, { op: 'light', v: 204 }, { op: 'turn', deg: 360 }, { op: 'light', v: 0 }, { op: 'say', text: 'Ta-da!' }] },
    ],
    firmware: [
      { id: 'blink', title: '💡 Blink an LED', text: 'The first program everyone makes: an LED goes on and off every half second.',
        program: { setup: [], loop: [{ op: 'led', pin: 2, on: true }, { op: 'wait', s: 0.5 }, { op: 'led', pin: 2, on: false }, { op: 'wait', s: 0.5 }] } },
      { id: 'button', title: '🔘 Button lights the LED', text: 'While you hold the button, the LED is on.',
        program: { setup: [], loop: [{ op: 'if', cond: { op: 'pressed', pin: 4 }, then: [{ op: 'led', pin: 2, on: true }], else: [{ op: 'led', pin: 2, on: false }] }] } },
      { id: 'night', title: '🌙 Night light', text: 'A light sensor on pin 34: when it gets dark (below 30 %) the LED switches on.',
        program: { setup: [], loop: [{ op: 'if', cond: { op: 'sensor_lt', pin: 34, v: 30 }, then: [{ op: 'led', pin: 2, on: true }], else: [{ op: 'led', pin: 2, on: false }] }, { op: 'wait', s: 0.2 }] } },
      { id: 'servo', title: '🦾 Servo wave', text: 'A servo waves: 0°, 90°, 180° and back, again and again.',
        program: { setup: [], loop: [{ op: 'servo', pin: 13, deg: 0 }, { op: 'wait', s: 1 }, { op: 'servo', pin: 13, deg: 90 }, { op: 'wait', s: 1 }, { op: 'servo', pin: 13, deg: 180 }, { op: 'wait', s: 1 }] } },
      { id: 'beep', title: '🔊 Hello beeps', text: 'At power-on the buzzer beeps 3 times, then shows "ready" on the PC.',
        program: { setup: [{ op: 'repeat', n: 3, body: [{ op: 'beep', pin: 15, hz: 2000, s: 0.15 }, { op: 'wait', s: 0.15 }] }, { op: 'print', text: 'ready' }], loop: [] } },
    ],
  };

  // ---------------------------------------------------------------- a mission and its plain-English story
  // Plain-English story of a mission: { lines: [{ d, t }], note, needsLaser }
  function missionStory(prog) {
    prog = clean(prog);
    const out = [];
    const cond = (c) => (!c ? '…' : ({ dist_lt: `something is closer than ${c.cm} cm in front`, dist_gt: `the way is free for more than ${c.cm} cm`, blocked: 'the way ahead is blocked', true: 'always (until you press Stop)', not: c.a && c.a.op === 'blocked' ? 'the way ahead is free' : `NOT (${c.a ? cond(c.a) : '…'})`, and: `${cond(c.a)} and ${cond(c.b)}`, or: `${cond(c.a)} or ${cond(c.b)}` })[c.op] || '…');
    let secs = 0;
    const walk = (list, d, mult = 1) => {
      for (const s of list || []) {
        switch (s.op) {
          case 'forward': out.push({ d, t: `Drive forward ${s.cm} cm.` }); secs += mult * (s.cm / 25 + 0.3); break;
          case 'back': out.push({ d, t: `Drive backward ${s.cm} cm.` }); secs += mult * (s.cm / 25 + 0.3); break;
          case 'turn': { const a = Math.abs(s.deg); out.push({ d, t: `Turn ${s.deg < 0 ? 'left' : 'right'} by ${a}°${a === 90 ? ' (a quarter turn)' : a === 180 ? ' (turn around)' : a === 360 ? ' (a full circle)' : ''}.` }); secs += mult * (a / 120 + 0.3); break; }
          case 'speed': out.push({ d, t: `From now on drive at ${s.pct} % speed${s.pct <= 40 ? ' (slow)' : s.pct >= 85 ? ' (fast)' : ''}.` }); break;
          case 'stop': out.push({ d, t: 'Stop the wheels.' }); break;
          case 'wait': out.push({ d, t: `Wait ${s.s} second${s.s === 1 ? '' : 's'}.` }); secs += mult * s.s; break;
          case 'say': out.push({ d, t: `Say “${s.text}”.` }); secs += mult * (0.5 + String(s.text || '').length / 14); break;
          case 'photo': out.push({ d, t: 'Take a photo.' }); secs += mult; break;
          case 'look': out.push({ d, t: `Turn to look ${s.dir === 'back' ? 'behind' : s.dir}, take a photo and turn back.` }); secs += mult * 4; break;
          case 'scan': out.push({ d, t: 'Turn a full circle taking photos and draw a map of the room (about a minute).' }); secs += mult * 60; break;
          case 'goto': out.push({ d, t: `Look for the ${s.target} with the camera and drive to it.` }); secs += mult * 30; break;
          case 'place': out.push({ d, t: `Drive to the place “${s.name}” on the room map, around the walls it knows.` }); secs += mult * 20; break;
          case 'light': out.push({ d, t: s.v ? `Switch the headlight on (${Math.round(s.v / 2.55)} %).` : 'Switch the headlight off.' }); break;
          case 'drive': { const l = Number(s.left) || 0, r = Number(s.right) || 0; out.push({ d, t: `${l === r ? (l >= 0 ? 'Drive forward' : 'Drive backward') : (l > r ? 'Turn right while driving' : 'Turn left while driving')} for ${(Number(s.ms) || 0) / 1000} s.` }); secs += mult * (Number(s.ms) || 0) / 1000; break; }
          case 'log': out.push({ d, t: `Write “${s.text}” in the log.` }); break;
          case 'repeat': out.push({ d, t: `Do this ${s.n} times:` }); walk(s.body, d + 1, mult * s.n); break;
          case 'while': out.push({ d, t: `Keep doing this as long as ${cond(s.cond)}:` }); walk(s.body, d + 1, mult * (s.cond && s.cond.op === 'true' ? 200 : 5)); break;
          case 'if': out.push({ d, t: `If ${cond(s.cond)}:` }); walk(s.then, d + 1, mult); if (s.else && s.else.length) { out.push({ d, t: 'Otherwise:' }); walk(s.else, d + 1, mult); } break;
          default: out.push({ d, t: `(a “${s.op}” step)` }); break;
        }
      }
    };
    walk(prog, 0);
    const forever = JSON.stringify(prog).includes('"op":"true"');
    const empty = (list) => (list || []).some((s) => ['repeat', 'while'].includes(s.op) && !(s.body || []).length) || (list || []).some((s) => KIDS.some((k) => Array.isArray(s[k]) && empty(s[k])));
    return { lines: out, secs, empty: empty(prog), note: !prog.length ? '' : forever ? 'It keeps going until you press ■ Stop (or Space).' : `Takes about ${secs < 60 ? `${Math.max(1, Math.round(secs))} seconds` : `${Math.round(secs / 60)} minute${secs >= 90 ? 's' : ''}`}.`, needsLaser: /dist_/.test(JSON.stringify(prog)) };
  }

  // ---------------------------------------------------------------- a board program → Arduino code (a comment on every line), story, parts
  function boardProgram(prog, boardId = 'esp32devkit') {
    const P = prog && typeof prog === 'object' && !Array.isArray(prog) ? prog : { setup: [], loop: Array.isArray(prog) ? prog : [] };
    const setupL = clean(P.setup), loopL = clean(P.loop);
    const esp = /^esp|^xiao/.test(boardId), avr = boardId === 'uno' || boardId === 'mega2560';
    const ADC = esp ? 4095 : 1023;
    const uses = { led: new Set(), dim: new Set(), button: new Set(), sensor: new Set(), digital: new Set(), servo: new Set(), motor: new Set(), beep: new Set() };
    const I = (n) => '  '.repeat(n);
    const pct = (p) => `(analogRead(${p}) * 100L / ${ADC})`;
    const oneLine = (t) => String(t ?? '').replace(/[\r\n]+/g, ' ');
    const cstr = (t) => `"${oneLine(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const nstr = (v) => String(Number(v) || 0);
    const cc = (c) => {
      c = c || {}; const p = int(c.pin);
      switch (c.op) {
        case 'pressed': uses.button.add(p); return [`digitalRead(${p}) == LOW`, `the button on pin ${p} is pressed`];
        case 'released': uses.button.add(p); return [`digitalRead(${p}) == HIGH`, `the button on pin ${p} is not pressed`];
        case 'sensor_lt': uses.sensor.add(p); return [`${pct(p)} < ${nstr(c.v)}`, `the sensor on pin ${p} (in %) is less than ${nstr(c.v)}`];
        case 'sensor_gt': uses.sensor.add(p); return [`${pct(p)} > ${nstr(c.v)}`, `the sensor on pin ${p} (in %) is more than ${nstr(c.v)}`];
        case 'high': uses.digital.add(p); return [`digitalRead(${p}) == HIGH`, `the digital sensor on pin ${p} sees something`];
        default: return ['false', '…'];
      }
    };
    const VARS = ['i', 'j', 'k', 'm', 'n'];
    const code = (list, d, rd) => list.flatMap((s) => one(s, d, rd));
    const one = (s, d, rd) => {
      const i = I(d), p = int(s.pin);
      switch (s.op) {
        case 'led': uses.led.add(p); return [`${i}digitalWrite(${p}, ${s.on ? 'HIGH' : 'LOW'});  // LED on pin ${p} ${s.on ? 'ON' : 'OFF'}`];
        case 'dim': uses.dim.add(p); return [`${i}analogWrite(${p}, ${Math.round(clampN(s.pct, 0, 100) * 2.55)});  // LED on pin ${p} at ${nstr(s.pct)} % brightness (0–255)`];
        case 'servo': uses.servo.add(p); return [`${i}servo_${p}.write(${int(clampN(s.deg, 0, 180))});  // servo on pin ${p} turns to ${int(clampN(s.deg, 0, 180))}°`];
        case 'motor': uses.motor.add(p); return [`${i}analogWrite(${p}, ${Math.round(clampN(s.pct, 0, 100) * 2.55)});  // motor on pin ${p} at ${nstr(s.pct)} % speed (through the driver)`];
        case 'beep': { uses.beep.add(p); const ms = Math.round(clampN(s.s, 0, 10) * 1000); return [`${i}tone(${p}, ${int(s.hz) || 1000}, ${ms});  // beep (${HZ[s.hz] || `${s.hz} Hz`}) on the buzzer on pin ${p}`, `${i}delay(${ms});  // wait while it beeps`]; }
        case 'wait': { const ms = Math.round(clampN(s.s, 0, 3600) * 1000); return [`${i}delay(${ms});  // wait ${nstr(s.s)} s`]; }
        case 'waituntil': { const [c, w] = cc(s.cond); return [`${i}while (!(${c})) {  // wait until ${w}`, `${i}  delay(10);  // look again in 10 ms`, `${i}}  // end of "wait until"`]; }
        case 'repeat': { const v = VARS[rd] || `i${rd}`, n = Math.max(1, int(s.n)); return [`${i}for (int ${v} = 0; ${v} < ${n}; ${v}++) {  // do this ${n} times`, ...code(s.body || [], d + 1, rd + 1), `${i}}  // end of "do this ${n} times"`]; }
        case 'if': { const [c, w] = cc(s.cond); const L = [`${i}if (${c}) {  // if ${w}`, ...code(s.then || [], d + 1, rd)]; if ((s.else || []).length) L.push(`${i}} else {  // otherwise`, ...code(s.else, d + 1, rd)); L.push(`${i}}  // end of "if"`); return L; }
        case 'print': return [`${i}Serial.println(${cstr(s.text)});  // show "${oneLine(s.text).replace(/\*\//g, '')}" on the PC`];
        case 'printsensor': uses.sensor.add(p); return [`${i}Serial.println(${pct(p)});  // show the sensor on pin ${p} (0–100 %) on the PC`];
        default: return [`${i}// (a "${s.op}" step this board can't do)`];
      }
    };
    const setup = code(setupL, 1, 0), loop = code(loopL, 1, 0);
    // the code
    const L = [`// ${BOARD_NAMES[boardId] || boardId} program made with steps in Muse Carpathron.`, '// The text after // on each line explains it; the board ignores it.', ''];
    if (uses.servo.size) L.push(esp ? '#include <ESP32Servo.h>  // servo library ("ESP32Servo")' : '#include <Servo.h>  // servo library', '');
    for (const p of uses.servo) L.push(`Servo servo_${p};  // the servo on pin ${p}`);
    L.push('', 'void setup() {  // runs once when the board switches on', '  Serial.begin(115200);  // talk to the PC at 115200 baud');
    for (const p of uses.led) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} drives an LED`);
    for (const p of uses.dim) if (!uses.led.has(p)) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} dims an LED`);
    for (const p of uses.motor) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} sets the motor speed`);
    for (const p of uses.beep) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} drives the buzzer`);
    for (const p of uses.button) L.push(`  pinMode(${p}, INPUT_PULLUP);  // button on pin ${p}: reads LOW when pressed`);
    for (const p of uses.digital) L.push(`  pinMode(${p}, INPUT);  // digital sensor on pin ${p}`);
    for (const p of uses.servo) L.push(`  servo_${p}.attach(${p});  // the servo listens on pin ${p}`);
    L.push(...setup, '}  // end of setup', '', 'void loop() {  // runs again and again, forever');
    L.push(...(loop.length ? loop : ['  // (nothing here yet: the board just waits)']), '}  // end of loop — it starts again at the top', '');
    // the story
    const story = [];
    const walk = (list, d) => {
      for (const s of list) {
        const p = int(s.pin);
        switch (s.op) {
          case 'led': story.push({ d, t: `Switch the LED on pin ${p} ${s.on ? 'ON' : 'OFF'}.` }); break;
          case 'dim': story.push({ d, t: `Set the LED on pin ${p} to ${nstr(s.pct)} % brightness.` }); break;
          case 'servo': story.push({ d, t: `Turn the servo on pin ${p} to ${nstr(s.deg)}°.` }); break;
          case 'motor': story.push({ d, t: `Run the motor on pin ${p} at ${nstr(s.pct)} % speed.` }); break;
          case 'beep': story.push({ d, t: `Beep (${HZ[s.hz] || `${s.hz} Hz`}) on the buzzer on pin ${p} for ${nstr(s.s)} s.` }); break;
          case 'wait': story.push({ d, t: `Wait ${nstr(s.s)} second${Number(s.s) === 1 ? '' : 's'}.` }); break;
          case 'waituntil': story.push({ d, t: `Wait until ${cc(s.cond)[1]}.` }); break;
          case 'repeat': story.push({ d, t: `Do this ${int(s.n)} times:` }); walk(s.body || [], d + 1); break;
          case 'if': story.push({ d, t: `If ${cc(s.cond)[1]}:` }); walk(s.then || [], d + 1); if ((s.else || []).length) { story.push({ d, t: 'Otherwise:' }); walk(s.else, d + 1); } break;
          case 'print': story.push({ d, t: `Show “${oneLine(s.text)}” on the PC (Serial monitor).` }); break;
          case 'printsensor': story.push({ d, t: `Show the sensor on pin ${p} (in %) on the PC (Serial monitor).` }); break;
          default: story.push({ d, t: `(a “${s.op}” step)` });
        }
      }
    };
    story.push({ d: 0, t: 'When the board switches on:', head: true });
    if (setupL.length) walk(setupL, 1); else story.push({ d: 1, t: 'nothing special.' });
    story.push({ d: 0, t: 'Then again and again, forever:', head: true });
    if (loopL.length) walk(loopL, 1); else story.push({ d: 1, t: 'nothing (the board just waits).' });
    // what to connect
    const parts = [];
    for (const p of uses.led) parts.push({ icon: '💡', t: `An LED on pin ${p}: long leg → pin ${p}, short leg → a 220 Ω resistor → GND.` });
    for (const p of uses.dim) if (!uses.led.has(p)) parts.push({ icon: '💡', t: `An LED on pin ${p} (dimmable): long leg → pin ${p}, short leg → 220 Ω → GND.` });
    for (const p of uses.button) parts.push({ icon: '🔘', t: `A push button between pin ${p} and GND (no resistor needed).` });
    for (const p of uses.sensor) parts.push({ icon: '🎚️', t: `A sensor or knob: its signal (OUT / middle leg) → pin ${p}, the other legs → 3.3 V and GND.${esp ? ' On ESP32 use pins 32–39 for this when Wi-Fi is on.' : ''}` });
    for (const p of uses.digital) parts.push({ icon: '📡', t: `A digital sensor (PIR motion, IR obstacle, tilt…): OUT → pin ${p}, VCC → 3.3 V (or 5 V if it needs it), GND → GND.` });
    for (const p of uses.servo) parts.push({ icon: '🦾', t: `A servo (SG90): orange → pin ${p}, red → 5 V, brown → GND.` });
    for (const p of uses.motor) parts.push({ icon: '⚙️', t: `A motor driver (L298N / TB6612): its speed input (ENA / PWMA) → pin ${p}. The motor goes on the driver, never straight on the board.` });
    for (const p of uses.beep) parts.push({ icon: '🔊', t: `A passive buzzer: + → pin ${p}, − → GND.` });
    const pins = {};
    for (const [k, set] of Object.entries(uses)) for (const p of set) pins[`${k} ${p}`] = p;
    return { code: L.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'), story, parts, pins, avr };
  }

  // ---------------------------------------------------------------- editor state
  const st = {
    mode: LS.get('mc.steps.mode', 'mission') === 'firmware' ? 'firmware' : 'mission',
    docs: null, ins: null, undo: { mission: [], firmware: [] }, editing: false, focusId: null, flash: null, drag: null,
    board: 'esp32devkit', name: '', fwName: 'my_first_program', teaching: false, sideTab: 'story', q: '', pendingEx: null,
    trace: null, runId: null, loc: new Map(), lists: new Map(),
  };
  const isM = () => st.mode === 'mission';
  const DEFS = () => (isM() ? M_DEFS : B_DEFS);
  const GROUPS = () => (isM() ? M_GROUPS : B_GROUPS);
  const doc = () => st.docs[st.mode];
  const rootKeys = () => (isM() ? ['steps'] : ['setup', 'loop']);
  const defaultIns = () => ({ owner: 'root', key: isM() ? 'steps' : 'loop', before: null });
  const cleanDoc = (m = st.mode) => (m === 'mission' ? clean(st.docs.mission.steps) : { setup: clean(st.docs.firmware.setup), loop: clean(st.docs.firmware.loop) });

  function loadDocs() {
    if (st.docs) return;
    const parse = (k) => { try { return JSON.parse(LS.get(k, '') || 'null'); } catch { return null; } };
    const m = parse('mc.steps.mission'), b = parse('mc.steps.board');
    st.docs = {
      mission: { steps: withIds(m && Array.isArray(m.steps) ? m.steps : EXAMPLES.mission[0].program) },
      firmware: { setup: withIds(b && Array.isArray(b.setup) ? b.setup : EXAMPLES.firmware[0].program.setup), loop: withIds(b && Array.isArray(b.loop) ? b.loop : EXAMPLES.firmware[0].program.loop) },
    };
    st.name = m ? String(m.name || '') : EXAMPLES.mission[0].title.replace(/^\S+\s/, '');
    st.fwName = b && b.name ? String(b.name) : EXAMPLES.firmware[0].id;
    st.board = (b && BOARD_NAMES[b.board]) ? b.board : LS.get('mc.blocks.board', st.board);
    if (!BOARD_NAMES[st.board]) st.board = 'esp32devkit';
  }
  function saveDraft() {
    LS.set('mc.steps.mission', JSON.stringify({ steps: cleanDoc('mission'), name: st.name }));
    LS.set('mc.steps.board', JSON.stringify({ ...cleanDoc('firmware'), name: st.fwName, board: st.board }));
  }

  // where every step is: id → { s, list, i, owner, key }, and every list: "owner|key" → list
  function locate() {
    st.loc = new Map(); st.lists = new Map();
    const walk = (owner, key, list) => {
      st.lists.set(`${owner}|${key}`, list);
      list.forEach((s, i) => {
        if (!s._id) s._id = newId();
        st.loc.set(s._id, { s, list, i, owner, key });
        const def = DEFS()[s.op];
        for (const [k] of (def && def.kids) || []) { if (!Array.isArray(s[k])) s[k] = []; walk(s._id, k, s[k]); }
      });
    };
    for (const k of rootKeys()) { if (!Array.isArray(doc()[k])) doc()[k] = []; walk('root', k, doc()[k]); }
  }
  const inside = (id, anc) => { for (let o = id; o && o !== 'root';) { if (o === anc) return true; const L = st.loc.get(o); o = L && L.owner; } return false; };
  function fixIns() {
    if (!st.ins) st.ins = defaultIns();
    const list = st.lists.get(`${st.ins.owner}|${st.ins.key}`);
    if (!list) st.ins = defaultIns();
    else if (st.ins.before && !list.some((s) => s._id === st.ins.before)) st.ins.before = null;
  }
  const insAt = (owner, key, before) => st.ins && st.ins.owner === owner && st.ins.key === key && (st.ins.before || null) === (before || null);

  // ---------------------------------------------------------------- changes (all undoable)
  function pushUndo() {
    const u = st.undo[st.mode];
    u.push({ doc: JSON.stringify(doc()), ins: { ...st.ins }, name: isM() ? st.name : st.fwName });
    while (u.length > 30) u.shift();
    if (E.undoBtn) E.undoBtn.disabled = false;
  }
  function undo() {
    const u = st.undo[st.mode].pop();
    if (!u) { ui().toast('Nothing to undo.'); return; }
    st.docs[st.mode] = JSON.parse(u.doc); st.ins = u.ins; st.editing = false;
    if (isM()) { st.name = u.name; if (E.nameIn) E.nameIn.value = st.name; } else { st.fwName = u.name; if (E.nameIn) E.nameIn.value = st.fwName; }
    changed(true);
  }
  function changed(redraw) {
    saveDraft();
    if (redraw) renderEditor(); else locate();
    refreshSide(); refreshExamples();
    if (E.undoBtn) E.undoBtn.disabled = !st.undo[st.mode].length;
  }
  function add(item) {
    locate(); fixIns();
    const def = DEFS()[item.op];
    const step = withIds([(item.make || def.make)()])[0];
    pushUndo();
    const list = st.lists.get(`${st.ins.owner}|${st.ins.key}`);
    const i = st.ins.before ? list.findIndex((s) => s._id === st.ins.before) : list.length;
    list.splice(i < 0 ? list.length : i, 0, step);
    if (def.kids) st.ins = { owner: step._id, key: def.kids[0][0], before: null }; // the next steps go inside
    st.flash = step._id;
    changed(true);
  }
  function remove(id) {
    const L = st.loc.get(id); if (!L) return;
    pushUndo();
    const next = L.list[L.i + 1], prev = L.list[L.i - 1];
    if (st.ins.before === id || st.ins.owner === id || inside(st.ins.owner, id)) st.ins = { owner: L.owner, key: L.key, before: next ? next._id : null };
    L.list.splice(L.i, 1);
    st.focusId = next ? next._id : prev ? prev._id : null;
    changed(true);
  }
  function duplicate(id) {
    const L = st.loc.get(id); if (!L) return;
    pushUndo();
    const copy = withIds(clean([L.s]))[0];
    L.list.splice(L.i + 1, 0, copy);
    st.flash = copy._id; st.focusId = copy._id;
    changed(true);
  }
  // where ▲ / ▼ take a step: swap with its neighbour; at the edge of a box it steps out of the box (or into the other half)
  function moveTarget(id, dir) {
    const L = st.loc.get(id); if (!L) return null;
    const j = L.i + dir;
    if (j >= 0 && j < L.list.length) return { kind: 'swap', j };
    if (L.owner !== 'root') {
      const P = st.loc.get(L.owner);
      if (P.s.op === 'if' && L.key === 'then' && dir > 0) return { kind: 'list', list: P.s.else, at: 0 };
      if (P.s.op === 'if' && L.key === 'else' && dir < 0) return { kind: 'list', list: P.s.then, at: P.s.then.length };
      return { kind: 'list', list: P.list, at: dir < 0 ? P.i : P.i + 1 };
    }
    if (!isM() && L.key === 'setup' && dir > 0) return { kind: 'list', list: doc().loop, at: 0 };
    if (!isM() && L.key === 'loop' && dir < 0) return { kind: 'list', list: doc().setup, at: doc().setup.length };
    return null;
  }
  function move(id, dir) {
    const L = st.loc.get(id); const t = moveTarget(id, dir);
    if (!L || !t) return;
    pushUndo();
    if (st.ins.before === id) st.ins.before = (L.list[L.i + 1] || {})._id || null;
    L.list.splice(L.i, 1);
    if (t.kind === 'swap') L.list.splice(t.j, 0, L.s);
    else t.list.splice(t.at - (t.list === L.list && t.at > L.i ? 1 : 0), 0, L.s);
    st.focusId = id;
    changed(true);
  }
  function moveTo(id, owner, key, before) {
    const L = st.loc.get(id); const list = st.lists.get(`${owner}|${key}`);
    if (!L || !list || owner === id || inside(owner, id) || before === id) return;
    pushUndo();
    if (st.ins.before === id) st.ins.before = (L.list[L.i + 1] || {})._id || null;
    L.list.splice(L.i, 1);
    const i = before ? list.findIndex((s) => s._id === before) : list.length;
    list.splice(i < 0 ? list.length : i, 0, L.s);
    st.focusId = id; st.flash = id;
    changed(true);
  }
  function setInsAfter(id) {
    const L = st.loc.get(id); if (!L) return;
    const next = L.list[L.i + 1];
    st.ins = { owner: L.owner, key: L.key, before: next ? next._id : null };
    st.focusId = id;
    renderEditor();
  }

  // ---------------------------------------------------------------- the page
  const E = {}; // the live elements of the tab

  async function render(el) {
    const { h } = ui();
    loadDocs();
    el.innerHTML = '';
    for (const k of Object.keys(E)) delete E[k];
    const helpOpen = LS.get('mc.steps.help', '1') !== '0';
    const how = h('section', { class: 'st-how', hidden: !helpOpen, 'aria-label': 'How it works' },
      ...[
        ['1', 'Choose what to make', 'A mission for the car, or a program for a board (ESP32, Arduino, Pico).'],
        ['2', 'Click an action on the left', 'It is added as a step where the blue “New steps go here” line is. Or start from an example.'],
        ['3', isM() ? 'Press ▶ Run on the car' : 'Press ⬆ Put it on the board', isM() ? 'Read the plan on the right first — it says in plain words what will happen.' : 'The right side tells you what it does, what to connect, and shows the code.'],
      ].map(([n, t, d]) => h('div', { class: 'st-how-step' }, h('span', { class: 'st-how-n', 'aria-hidden': 'true' }, n), h('div', {}, h('b', {}, t), h('p', {}, d)))));
    const howBtn = h('button', { class: 'st-link', 'aria-expanded': String(helpOpen), onclick: () => { const open = how.hidden; how.hidden = !open; howBtn.setAttribute('aria-expanded', String(open)); howBtn.textContent = open ? 'Hide how it works ▴' : 'How it works ▾'; LS.set('mc.steps.help', open ? '1' : '0'); } }, helpOpen ? 'Hide how it works ▴' : 'How it works ▾');
    const modeCard = (m, icon, title, sub) => h('button', { class: `st-mode${st.mode === m ? ' on' : ''}`, role: 'radio', 'aria-checked': String(st.mode === m), onclick: () => { if (st.mode === m) return; st.mode = m; st.sideTab = 'story'; st.ins = null; st.pendingEx = null; LS.set('mc.steps.mode', m); render(el); } },
      h('span', { class: 'st-mode-ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'st-mode-t' }, h('b', {}, title), h('small', {}, sub)), h('span', { class: 'st-mode-dot', 'aria-hidden': 'true' }));
    E.examples = h('div', { class: 'st-examples', role: 'list' });
    E.confirm = h('div', { class: 'st-confirm', hidden: true, role: 'alertdialog' });
    E.pal = h('aside', { class: 'st-col st-pal', 'aria-label': 'Add a step' });
    E.prog = h('div', { class: 'st-program' });
    E.undoBtn = h('button', { class: 'btn tiny', title: 'Undo the last change (Ctrl+Z)', 'aria-label': 'Undo', disabled: !st.undo[st.mode].length, onclick: () => undo() }, '↶ Undo');
    const clearBtn = h('button', { class: 'btn tiny ghost', title: 'Remove all steps (Undo brings them back)', onclick: () => { if (!JSON.stringify(cleanDoc()).match(/"op"/)) return; pushUndo(); if (isM()) doc().steps = []; else { doc().setup = []; doc().loop = []; } st.ins = null; changed(true); ui().toast('Cleared — ↶ Undo brings the steps back.'); } }, '🗑 Start over');
    E.side = h('aside', { class: 'st-col st-side', 'aria-label': isM() ? 'Run the mission' : 'Put it on a board' });
    const app = h('div', { class: `st-app ${isM() ? 'is-mission' : 'is-board'}`, onkeydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.matches('input:not([type=number]), textarea')) { e.preventDefault(); undo(); }
    } },
    h('header', { class: 'st-head' }, h('div', {}, h('h2', {}, '🧱 Build a program, step by step'), h('p', { class: 'muted' }, isM() ? 'Each step is one line that reads like a sentence. The car does them from top to bottom.' : 'Each step is one line that reads like a sentence. The board does them from top to bottom; the app writes the code.')), howBtn),
    how,
    h('div', { class: 'st-modes', role: 'radiogroup', 'aria-label': 'What do you want to make?' },
      modeCard('mission', '🚗', 'Make the car do something', 'Drive, turn, talk, look and scan — runs on Baby Carpathron right now.'),
      modeCard('firmware', '🔌', 'Program a board', 'LEDs, buttons, sensors, servos and a buzzer on an ESP32, Arduino or Pico.')),
    h('div', { class: 'st-exwrap' }, h('h3', { class: 'st-h3' }, 'Start from an example', h('small', { class: 'muted' }, ' — or build your own below')), E.examples, E.confirm),
    h('div', { class: 'st-grid' },
      E.pal,
      h('section', { class: 'st-col st-progcol', 'aria-label': 'Your program' },
        h('div', { class: 'st-colhead' }, h('h3', {}, '📝 Your program'), h('div', { class: 'st-colbtns' }, E.undoBtn, clearBtn)),
        h('p', { class: 'st-tip muted' }, 'Click a step to add the next ones after it. Hover a step for ▲ ▼ ⧉ ✕.'),
        E.prog),
      E.side));
    el.append(app);
    // the "Add a step" list stays in view while you scroll — just below the page's sticky tab bar
    const tabsBar = document.getElementById('robotTabs');
    const setTop = () => { const hgt = tabsBar && getComputedStyle(tabsBar).position === 'sticky' ? tabsBar.getBoundingClientRect().height : 0; app.style.setProperty('--st-top', `${Math.round(hgt + 10)}px`); };
    setTop();
    if (tabsBar && window.ResizeObserver) { if (st.ro) st.ro.disconnect(); st.ro = new ResizeObserver(setTop); st.ro.observe(tabsBar); }
    renderPalette(); renderExamples(); renderEditor();
    if (isM()) sideMission(); else sideBoard();
    refreshSide();
  }

  // ---- examples
  function renderExamples() {
    const { h } = ui();
    E.examples.innerHTML = '';
    const cur = JSON.stringify(cleanDoc());
    for (const ex of EXAMPLES[st.mode]) {
      const on = JSON.stringify(ex.program) === cur;
      E.examples.append(h('button', { class: `st-ex${on ? ' on' : ''}`, role: 'listitem', 'data-ex': ex.id, title: ex.text, onclick: () => pickExample(ex) }, h('b', {}, ex.title), h('small', {}, ex.text)));
    }
  }
  function refreshExamples() {
    if (!E.examples) return;
    const cur = JSON.stringify(cleanDoc());
    for (const b of E.examples.children) { const ex = EXAMPLES[st.mode].find((x) => x.id === b.dataset.ex); b.classList.toggle('on', !!ex && JSON.stringify(ex.program) === cur); }
  }
  const isEmptyDoc = () => !/"op"/.test(JSON.stringify(cleanDoc()));
  const isExampleDoc = () => EXAMPLES[st.mode].some((ex) => JSON.stringify(ex.program) === JSON.stringify(cleanDoc()));
  function pickExample(ex) {
    const { h } = ui();
    if (isEmptyDoc() || isExampleDoc()) return loadExample(ex);
    E.confirm.innerHTML = '';
    E.confirm.append(h('span', {}, `Replace your program with “${ex.title.replace(/^\S+\s/, '')}”? `, h('span', { class: 'muted' }, '(↶ Undo can bring yours back.)')),
      h('button', { class: 'btn tiny primary', onclick: () => { E.confirm.hidden = true; loadExample(ex); } }, 'Yes, load the example'),
      h('button', { class: 'btn tiny', onclick: () => { E.confirm.hidden = true; } }, 'Keep mine'));
    E.confirm.hidden = false;
    E.confirm.querySelector('.primary').focus();
  }
  function loadExample(ex) {
    pushUndo();
    if (isM()) { st.docs.mission = { steps: withIds(ex.program) }; st.name = ex.title.replace(/^\S+\s/, ''); }
    else { st.docs.firmware = { setup: withIds(ex.program.setup), loop: withIds(ex.program.loop) }; st.fwName = ex.id; }
    if (E.nameIn) E.nameIn.value = isM() ? st.name : st.fwName;
    st.ins = null;
    changed(true);
    ui().toast(`${ex.title}: ${ex.text}`);
  }

  // ---- the "Add a step" list on the left
  function renderPalette() {
    const { h } = ui();
    const list = h('div', { class: 'st-pal-list' });
    const none = h('p', { class: 'small muted st-pal-none', hidden: true }, 'No action matches. Try “turn”, “say”, “led”…');
    const search = h('input', { type: 'search', class: 'st-search', placeholder: 'Search actions…', 'aria-label': 'Search actions', value: st.q, oninput: () => { st.q = search.value; filter(); } });
    for (const [gk, items] of isM() ? M_PALETTE : B_PALETTE) {
      const g = GROUPS()[gk];
      const grp = h('div', { class: 'st-pg', style: `--gc:${g.c}` }, h('h4', {}, h('span', { 'aria-hidden': 'true' }, g.icon), ' ', g.t));
      for (const it of items) {
        const def = DEFS()[it.op];
        const name = it.name || def.name, help = it.help || def.help, icon = it.icon || def.icon;
        grp.append(h('button', { class: 'st-pc', 'data-q': `${name} ${help} ${g.t}`.toLowerCase(), title: `Add “${name}” where the blue line is`, 'aria-label': `Add step: ${name}. ${help}`, onclick: () => add(it) },
          h('span', { class: 'st-pc-ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'st-pc-t' }, h('b', {}, name), h('small', {}, help))));
      }
      list.append(grp);
    }
    function filter() {
      const q = st.q.trim().toLowerCase(); let any = false;
      for (const g of list.children) { let n = 0; for (const b of g.querySelectorAll('.st-pc')) { const on = !q || b.dataset.q.includes(q); b.hidden = !on; if (on) n++; } g.hidden = !n; if (n) any = true; }
      none.hidden = any;
    }
    E.pal.innerHTML = '';
    E.pal.append(h('div', { class: 'st-colhead' }, h('h3', {}, '➕ Add a step')), search, list, none);
    filter();
  }

  // ---- "Your program"
  function renderEditor() {
    if (!E.prog) return;
    const { h } = ui();
    locate(); fixIns();
    const active = document.activeElement;
    const keepFocus = active && E.prog.contains(active) && active.classList.contains('st-row') ? active.closest('.st-item').dataset.id : null;
    E.prog.innerHTML = '';
    if (isM()) {
      E.prog.append(h('div', { class: 'st-cap st-cap-top' }, h('span', { 'aria-hidden': 'true' }, '▶'), ' When you press ▶ Run on the car'),
        listEl('root', 'steps', doc().steps, 0, ''),
        h('div', { class: 'st-cap st-cap-end' }, h('span', { 'aria-hidden': 'true' }, '🏁'), ' The end — the car stops'));
    } else {
      E.prog.append(
        h('section', { class: 'st-sec st-sec-setup' }, h('div', { class: 'st-sec-h' }, h('b', {}, '▶ When the board switches on (once)'), h('small', {}, 'Good for a hello beep or a servo start position.')), listEl('root', 'setup', doc().setup, 0, '')),
        h('section', { class: 'st-sec st-sec-loop' }, h('div', { class: 'st-sec-h' }, h('b', {}, '🔁 Then, again and again, forever'), h('small', {}, 'The board does these steps over and over until it is switched off.')), listEl('root', 'loop', doc().loop, 0, '')));
    }
    const fid = st.focusId || keepFocus; st.focusId = null;
    if (fid) { const r = E.prog.querySelector(`.st-item[data-id="${fid}"] > .st-row`); if (r) r.focus({ preventScroll: true }); }
    if (st.flash) { const it = E.prog.querySelector(`.st-item[data-id="${st.flash}"] > .st-row`); if (it) { it.classList.add('flash'); it.scrollIntoView({ block: 'nearest' }); setTimeout(() => it.classList.remove('flash'), 1200); } st.flash = null; }
    if (st.runId) markRunning(st.runId);
  }
  function listEl(owner, key, list, depth, prefix, start = 0) {
    const { h } = ui();
    const wrap = h('div', { class: 'st-list', 'data-owner': owner, 'data-key': key });
    list.forEach((s, i) => {
      if (insAt(owner, key, s._id)) wrap.append(h('div', { class: 'st-mark', role: 'status' }, h('span', {}, '▸ New steps go here')));
      wrap.append(stepEl(s, i, depth, `${prefix}${start + i + 1}`));
    });
    const on = insAt(owner, key, null);
    const empty = !list.length;
    const label = on ? (empty && owner === 'root' ? 'Empty — click an action on the left to add the first step here' : '▸ New steps go here — click an action on the left') : (empty ? '＋ Click here, then an action, to put a step inside' : '＋ add a step here');
    const slot = h('button', { class: `st-slot${on ? ' on' : ''}${empty ? ' st-empty' : ''}`, 'aria-label': on ? 'New steps go here' : 'Put new steps here', onclick: () => { st.ins = { owner, key, before: null }; renderEditor(); } }, label);
    dropTarget(slot, () => ({ owner, key, before: null }));
    wrap.append(slot);
    return wrap;
  }
  function stepEl(s, i, depth, n) {
    const { h } = ui();
    const def = DEFS()[s.op] || { g: '', icon: '❔', name: s.op, words: [`(a “${s.op}” step — kept as it is)`] };
    const g = GROUPS()[def.g] || { c: '#7a8394' };
    const kids = def.kids || [];
    const id = s._id;
    const item = h('div', { class: `st-item${kids.length ? ' st-box' : ''}`, 'data-id': id, 'data-op': s.op, style: `--gc:${g.c}` });
    const tb = (sym, label, fn, disabled) => h('button', { class: 'st-tb', type: 'button', title: label, 'aria-label': label, disabled: !!disabled, onclick: (e) => { e.stopPropagation(); fn(); } }, sym);
    const row = h('div', { class: 'st-row', tabindex: '0', role: 'group', 'aria-label': `Step ${n}: ${rowText(def, s)}`,
      onclick: (e) => { if (e.target.closest('input, select, button, .st-handle')) return; setInsAfter(id); },
      onkeydown: (e) => {
        if (e.target !== row) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(id); }
        else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(id, e.key === 'ArrowUp' ? -1 : 1); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const rows = [...E.prog.querySelectorAll('.st-row')]; const k = rows.indexOf(row) + (e.key === 'ArrowUp' ? -1 : 1); if (rows[k]) rows[k].focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); setInsAfter(id); }
      } },
    h('span', { class: 'st-n st-handle', title: 'Drag to move this step (or use ▲ ▼)', 'aria-hidden': 'true', onmousedown: () => { item.draggable = true; } }, h('span', { class: 'st-n-num' }, n), h('span', { class: 'st-n-grip' }, '⠿')),
    h('span', { class: 'st-ic', 'aria-hidden': 'true' }, def.icon),
    h('div', { class: 'st-say' }, ...words(def, s)),
    h('div', { class: 'st-tools' },
      tb('▲', 'Move this step up (Alt+↑)', () => move(id, -1), !moveTarget(id, -1)),
      tb('▼', 'Move this step down (Alt+↓)', () => move(id, 1), !moveTarget(id, 1)),
      tb('⧉', 'Duplicate this step', () => duplicate(id)),
      tb('✕', 'Delete this step (Delete)', () => remove(id))));
    item.append(row);
    let start = 0; // "Otherwise" goes on counting after the "then" steps, so every number is different
    for (const [k, label] of kids) {
      if (label) item.append(h('div', { class: 'st-sub' }, label));
      item.append(h('div', { class: 'st-inner' }, listEl(id, k, s[k], depth + 1, `${n}.`, start)));
      start += s[k].length;
    }
    if (kids.length) item.append(h('div', { class: 'st-foot', 'aria-hidden': 'true' }, def.end || ''));
    // drag and drop (the ▲ ▼ buttons do the same)
    item.addEventListener('dragstart', (e) => { e.stopPropagation(); st.drag = id; item.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch {} });
    item.addEventListener('dragend', () => { item.draggable = false; st.drag = null; item.classList.remove('dragging'); for (const x of E.prog.querySelectorAll('.drop-before, .drop-after, .drop')) x.classList.remove('drop-before', 'drop-after', 'drop'); });
    item.addEventListener('mouseup', () => { item.draggable = false; });
    row.addEventListener('dragover', (e) => {
      if (!st.drag || st.drag === id || inside(id, st.drag)) return;
      e.preventDefault(); e.stopPropagation();
      const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      if (!st.drag || st.drag === id || inside(id, st.drag)) return;
      e.preventDefault(); e.stopPropagation();
      const after = row.classList.contains('drop-after'); row.classList.remove('drop-before', 'drop-after');
      const L = st.loc.get(id);
      let before = after ? (L.list[L.i + 1] || {})._id || null : id;
      if (before === st.drag) before = (L.list[L.i + 2] || {})._id || null;
      moveTo(st.drag, L.owner, L.key, before);
    });
    return item;
  }
  function dropTarget(el, where) {
    el.addEventListener('dragover', (e) => { const w = where(); if (!st.drag || w.owner === st.drag || inside(w.owner, st.drag)) return; e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { const w = where(); if (!st.drag) return; e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); moveTo(st.drag, w.owner, w.key, w.before); });
  }
  const rowText = (def, s) => def.words.map((w) => (typeof w === 'string' ? w : w.t === 'cond' ? condText(s.cond) : String(w.get ? w.get(s) : s[w.k]) + (w.unit ? ` ${w.unit}` : ''))).join(' ').replace(/ ,/g, ',');
  const condText = (c) => { if (!c) return '…'; if (isM()) { const k = mCondKind(c); return k === 'custom' ? 'a question' : `${M_CONDS[k]}${c.cm != null && k.startsWith('dist') ? ` ${c.cm} cm` : ''}`; } return `${B_CONDS[c.op] || '…'}${c.v != null ? ` ${c.v} %` : ''} on pin ${c.pin}`; };

  // the parts of a step's sentence: words and fields you can change
  function words(def, s) {
    const { h } = ui();
    const out = [];
    for (const w of def.words) {
      if (typeof w === 'string') out.push(h('span', { class: `st-w${w.startsWith(',') ? ' tight' : ''}` }, w));
      else if (w.t === 'cond') out.push(...condFields(def, s));
      else out.push(field(w, s));
    }
    return out;
  }
  function field(f, s, after) {
    const { h } = ui();
    const get = () => (f.get ? f.get(s) : s[f.k]);
    const put = (v) => { if (f.set) f.set(s, v); else s[f.k] = v; };
    if (f.t === 'sel') {
      const cur = String(get());
      return h('select', { class: 'st-in st-sel', 'aria-label': f.label, onchange: (e) => { pushUndo(); put(e.target.value); changed(false); if (after) after(); } },
        ...f.options.map(([v, t]) => h('option', { value: v, selected: v === cur }, t)));
    }
    if (f.t === 'txt') {
      const inp = h('input', { type: 'text', class: 'st-in st-txt', maxlength: f.max, value: String(get() ?? ''), 'aria-label': f.label, size: Math.max(6, Math.min(26, String(get() ?? '').length + 1)),
        oninput: () => { if (!st.editing) { pushUndo(); st.editing = true; } put(inp.value); inp.size = Math.max(6, Math.min(26, inp.value.length + 1)); changed(false); },
        onblur: () => { st.editing = false; } });
      return inp;
    }
    // a number with its unit; out-of-range values are shown in red and not used
    const dec = f.step < 1 ? String(f.step).split('.')[1].length : 0;
    const w = Math.max(String(f.max).length, String(f.min).length) + (dec ? dec + 1 : 0) + 1.5;
    const inp = h('input', { type: 'number', class: 'st-in st-num', min: f.min, max: f.max, step: f.step, value: String(get()), inputmode: 'decimal', 'aria-label': `${f.label} (${f.min} to ${f.max}${f.unit ? ` ${f.unit}` : ''})`, title: `${f.min} – ${f.max}${f.unit ? ` ${f.unit}` : ''}`, style: `width:${w + 1.2}ch`,
      oninput: () => {
        const v = Number(inp.value); const ok = inp.value.trim() !== '' && Number.isFinite(v) && v >= f.min && v <= f.max;
        inp.classList.toggle('bad', !ok); inp.setAttribute('aria-invalid', String(!ok));
        inp.title = ok ? `${f.min} – ${f.max}${f.unit ? ` ${f.unit}` : ''}` : `Use a number from ${f.min} to ${f.max}`;
        if (!ok) return;
        if (!st.editing) { pushUndo(); st.editing = true; }
        put(Number(v.toFixed(dec))); changed(false);
      },
      onblur: () => {
        st.editing = false;
        let v = Number(inp.value);
        if (inp.value.trim() === '' || !Number.isFinite(v)) v = Number(get());
        v = Number((Math.round(clampN(v, f.min, f.max) / f.step) * f.step).toFixed(dec));
        if (v !== Number(get())) { pushUndo(); put(v); changed(false); }
        inp.value = String(v); inp.classList.remove('bad'); inp.removeAttribute('aria-invalid');
      } });
    return h('span', { class: 'st-f' }, inp, f.unit ? h('span', { class: 'st-u' }, f.unit) : null);
  }
  function condFields(def, s) {
    const { h } = ui();
    const redraw = () => renderEditor();
    if (isM()) {
      const kinds = def.conds || Object.keys(M_CONDS);
      const k = mCondKind(s.cond);
      const opts = kinds.map((x) => [x, M_CONDS[x]]);
      if (k === 'custom') opts.unshift(['custom', 'a question (made elsewhere)']);
      const pick = field(sel('kind', opts, { label: 'question', get: () => k, set: (_, v) => { if (v !== 'custom') s.cond = mCondMake(v, s.cond); } }), s, redraw);
      pick.classList.add('st-cond');
      return k === 'dist_lt' || k === 'dist_gt' ? [pick, field(num('cm', 3, 200, 'cm', { label: 'distance', get: () => s.cond.cm, set: (_, v) => { s.cond.cm = v; } }), s)] : [pick];
    }
    if (!s.cond || !B_CONDS[s.cond.op]) s.cond = bCondMake('pressed', s.cond);
    const pick = field(sel('kind', Object.entries(B_CONDS), { label: 'question', get: () => s.cond.op, set: (_, v) => { s.cond = bCondMake(v, s.cond); } }), s, redraw);
    pick.classList.add('st-cond');
    const pin = field(num('pin', 0, 60, null, { label: 'pin number', get: () => s.cond.pin, set: (_, v) => { s.cond.pin = v; } }), s);
    const out = [pick];
    if (s.cond.op.startsWith('sensor')) out.push(field(num('v', 0, 100, '%', { label: 'percent', get: () => s.cond.v, set: (_, v) => { s.cond.v = v; } }), s));
    out.push(h('span', { class: 'st-w' }, 'on pin'), pin);
    return out;
  }

  // ---------------------------------------------------------------- right side
  const storyList = (lines) => ui().h('ol', { class: 'st-story' }, ...lines.map((l) => ui().h('li', { class: l.head ? 'head' : '', style: `--d:${l.d}` }, l.t)));

  function sideMission() {
    const { h, api, toast } = ui();
    E.story = h('div', { class: 'st-story-box' });
    E.log = h('div', { class: 'st-log', 'aria-live': 'polite' }, h('p', { class: 'small muted st-log-empty' }, 'Nothing yet. Press ▶ Run — the car tells you here what it is doing.'));
    E.nameIn = h('input', { type: 'text', placeholder: 'Name for this mission', 'aria-label': 'Mission name', value: st.name, maxlength: 40, oninput: (e) => { st.name = e.target.value; saveDraft(); } });
    const list = h('div', { class: 'st-saved' });
    const runBtn = h('button', { class: 'btn primary st-run-btn', onclick: async () => {
      locate();
      const program = cleanDoc('mission');
      if (!program.length) return toast('Add some steps first (click an action on the left).', true);
      st.trace = traceOf(doc().steps);
      const r = await api('/api/robot/missions/run', { body: { program, name: st.name || 'Steps mission' } }).catch((e) => ({ error: e.message }));
      if (r.error) { st.trace = null; return toast(r.error, true); }
    } }, '▶ Run on the car');
    const stopBtn = h('button', { class: 'btn stop', title: 'Stop the mission (Space on the Control tab)', onclick: () => api('/api/robot/missions/stop', { body: {} }) }, '■ Stop');
    const teachBtn = h('button', { class: 'btn', onclick: async () => {
      if (!st.teaching) { const r = await api('/api/robot/missions/teach', { body: { action: 'start' } }).catch((e) => ({ error: e.message })); if (r.error) return toast(r.error, true); st.teaching = true; teachLook(); toast('Recording: drive the car on the Control tab (keys, pad or controller), then come back and press again.'); return; }
      const r = await api('/api/robot/missions/teach', { body: { action: 'stop', name: st.name || '' } }).catch((e) => ({ error: e.message }));
      st.teaching = false; teachLook();
      if (r.error) return toast(r.error, true);
      toast(`Saved "${r.mission.name}" — ${r.mission.program.length} steps`); drawList();
    } });
    const teachLook = () => { teachBtn.textContent = st.teaching ? '⏺ Recording… press to save' : '⏺ Teach by driving'; teachBtn.classList.toggle('rec', st.teaching); };
    teachLook();
    async function drawList() {
      const r = await api('/api/robot/missions').catch(() => ({ missions: [] }));
      if (r.teaching && !st.teaching) { st.teaching = true; teachLook(); }
      list.innerHTML = '';
      if (!(r.missions || []).length) list.append(h('p', { class: 'small muted' }, 'No saved missions yet. Give this one a name and press 💾 Save.'));
      for (const m of r.missions || []) list.append(h('div', { class: 'st-mi' },
        h('div', { class: 'st-mi-t' }, h('b', {}, m.name), h('small', {}, `${m.kind === 'taught' ? '⏺ taught by driving' : '🧱 steps'} · ${m.steps} step${m.steps === 1 ? '' : 's'}`)),
        h('button', { class: 'btn tiny', title: `Run “${m.name}” on the car`, 'aria-label': `Run ${m.name}`, onclick: () => api('/api/robot/missions/run', { body: { name: m.name } }).then((x) => x.error && toast(x.error, true)).catch((e) => toast(e.message, true)) }, '▶'),
        h('button', { class: 'btn tiny', title: `Open “${m.name}” in the editor`, 'aria-label': `Open ${m.name} in the editor`, onclick: async () => {
          const x = await api('/api/robot/missions/get', { body: { name: m.name } }).catch((e) => ({ error: e.message }));
          if (!x || x.error || !Array.isArray(x.program)) return toast((x && x.error) || 'Could not open it.', true);
          pushUndo(); st.docs.mission = { steps: withIds(x.program) }; st.name = x.name; E.nameIn.value = x.name; st.ins = null; changed(true);
          toast(`Opened “${x.name}” — ↶ Undo brings back what you had.`);
        } }, '✎'),
        h('button', { class: 'btn tiny ghost', title: `Delete “${m.name}”`, 'aria-label': `Delete ${m.name}`, onclick: async () => { await api('/api/robot/missions/delete', { body: { name: m.name } }).catch(() => {}); drawList(); } }, '🗑')));
    }
    const save = async () => {
      const name = String(st.name || '').trim();
      if (!name) { E.nameIn.focus(); return toast('Give the mission a name first.', true); }
      const r = await api('/api/robot/missions/save', { body: { name, program: cleanDoc('mission') } }).catch((e) => ({ error: e.message }));
      if (r.error) toast(r.error, true); else { toast(`Saved "${r.mission.name}"`); drawList(); }
    };
    E.side.append(
      h('section', { class: 'st-card st-plan' }, h('h3', {}, '📖 What the robot will do'), E.story,
        h('div', { class: 'st-run' }, runBtn, stopBtn),
        h('h4', {}, '🚗 What the car is doing'), E.log),
      h('section', { class: 'st-card' }, h('h3', {}, '💾 Save this mission'),
        h('div', { class: 'st-namerow' }, E.nameIn, h('button', { class: 'btn', onclick: save }, '💾 Save')),
        h('h4', {}, '📁 My missions'), list),
      h('section', { class: 'st-card' }, h('h3', {}, '⏺ Teach & repeat'), h('p', { class: 'small muted' }, 'Press, drive the car by hand on the Control tab, press again: the drive is saved as a mission the car can repeat.'), teachBtn));
    drawList();
  }
  // which step runs at each "step" number the car reports (only while the path is certain: no "if" / "keep repeating")
  function traceOf(list) {
    const out = [];
    const walk = (l) => { for (const s of l || []) { if (out.length > 600) throw new Error('long'); out.push(s._id); if (s.op === 'repeat') { for (let k = 0; k < Math.max(0, Math.min(100, Math.round(Number(s.n) || 0))); k++) walk(s.body); } else if (s.op === 'while' || s.op === 'if') throw new Error('unsure'); } };
    try { walk(list); } catch {}
    return out;
  }
  function markRunning(id) {
    if (!E.prog) return;
    for (const x of E.prog.querySelectorAll('.st-row.running')) x.classList.remove('running');
    const r = id && E.prog.querySelector(`.st-item[data-id="${id}"] > .st-row`);
    if (r) { r.classList.add('running'); }
  }
  function onMission(d) {
    if (!d) return;
    if (!d.done && d.step && st.trace) { st.runId = st.trace[d.step - 1] || null; markRunning(st.runId); }
    if (d.done) { st.trace = null; st.runId = null; markRunning(null); }
    const log = E.log;
    if (!log || !document.body.contains(log)) return;
    const empty = log.querySelector('.st-log-empty'); if (empty) empty.remove();
    const { h } = ui();
    if (d.done) log.prepend(h('div', { class: `st-log-l ${d.ok ? 'ok' : 'warn-t'}` }, d.error ? `✕ ${d.error}` : d.stopped ? `■ stopped: ${d.stopped}` : `✓ finished (${d.steps} steps)`));
    else if (d.text) log.prepend(h('div', { class: 'st-log-l' }, d.text));
    while (log.children.length > 40) log.lastChild.remove();
  }

  function sideBoard() {
    const { h, api, toast } = ui();
    const boardSel = h('select', { 'aria-label': 'Board', onchange: (e) => { st.board = e.target.value; LS.set('mc.blocks.board', st.board); saveDraft(); refreshSide(); } }, ...Object.entries(BOARD_NAMES).map(([v, t]) => h('option', { value: v, selected: v === st.board }, t)));
    E.tabs = h('div', { class: 'st-tabs', role: 'tablist' });
    E.pane = h('div', { class: 'st-pane', role: 'tabpanel' });
    E.nameIn = h('input', { type: 'text', placeholder: 'program name', 'aria-label': 'Program name', value: st.fwName, maxlength: 40, oninput: (e) => { st.fwName = e.target.value; saveDraft(); } });
    const put = h('button', { class: 'btn primary st-run-btn', onclick: async () => {
      const last = boardProgram(cleanDoc('firmware'), st.board);
      const name = String(st.fwName || 'my_first_program').trim().replace(/[^\w]/g, '_') || 'my_first_program';
      let r = await api('/api/studio/new', { body: { name, template: 'blink', fqbn: FQBN[st.board] } }).catch((e) => ({ error: e.message }));
      if (r.error && !/already exists/.test(r.error)) return toast(r.error, true);
      r = await api('/api/studio/file', { body: { project: name, name: `${name}.ino`, content: last.code } }).catch((e) => ({ error: e.message }));
      if (/#include <ESP32Servo.h>/.test(last.code)) { toast('Installing the servo library (ESP32Servo) for this program…'); await api('/api/studio/libinstall', { body: { name: 'ESP32Servo' } }).catch(() => {}); }
      if (r.error) return toast(r.error, true);
      toast(`"${name}" is ready: connect the board with USB, then press ⬆ Upload in the Firmware studio`);
      if (window.MCstudio) window.MCstudio.openStudio({ project: name, fqbn: FQBN[st.board] });
    } }, '⬆ Put it on the board…');
    E.side.append(
      h('section', { class: 'st-card st-plan' }, h('label', { class: 'st-board' }, h('span', {}, '🔌 Board'), boardSel), E.tabs, E.pane),
      h('section', { class: 'st-card' }, h('h3', {}, '⬆ Put it on the board'),
        h('div', { class: 'st-namerow' }, E.nameIn), put,
        h('p', { class: 'small muted' }, 'Opens the program in the Firmware studio: connect the board with a USB cable, pick its port and press ⬆ Upload.')));
  }

  let sideTok = 0;
  async function refreshSide() {
    const { h, api } = ui();
    if (isM()) {
      if (!E.story) return;
      const s = missionStory(cleanDoc('mission'));
      E.story.innerHTML = '';
      E.story.append(...[s.lines.length ? storyList(s.lines) : h('p', { class: 'small muted' }, 'Your plan appears here, in plain words, as you add steps.'),
        s.note ? h('p', { class: 'st-note' }, `⏱ ${s.note}`) : null,
        s.needsLaser ? h('p', { class: 'st-note warn-t' }, '📏 This mission asks the laser distance sensor — the car needs a VL53L0X.') : null,
        s.empty ? h('p', { class: 'st-note muted' }, 'ℹ A repeat has no steps inside yet — click its “＋” line, then an action.') : null].filter(Boolean));
      return;
    }
    if (!E.pane) return;
    const tok = ++sideTok;
    const last = boardProgram(cleanDoc('firmware'), st.board);
    E.tabs.innerHTML = '';
    for (const [id, label] of [['story', '📖 What it does'], ['parts', `🧰 What to connect${last.parts.length ? ` (${last.parts.length})` : ''}`], ['code', '💻 The code']]) {
      E.tabs.append(h('button', { class: st.sideTab === id ? 'on' : '', role: 'tab', 'aria-selected': String(st.sideTab === id), onclick: () => { st.sideTab = id; refreshSide(); } }, label));
    }
    E.pane.innerHTML = '';
    if (st.sideTab === 'story') E.pane.append(storyList(last.story));
    if (st.sideTab === 'code') E.pane.append(h('p', { class: 'small muted' }, 'This is the Arduino code your steps make. You never have to type it: the text after // on each line explains what the line does.'), h('pre', { class: 'st-code' }, last.code));
    if (st.sideTab === 'parts') {
      E.pane.append(last.parts.length ? h('ul', { class: 'st-parts' }, ...last.parts.map((p) => h('li', {}, h('span', { 'aria-hidden': 'true' }, p.icon), h('span', {}, p.t)))) : h('p', { class: 'small muted' }, 'Nothing to connect yet.'),
        h('p', { class: 'small muted' }, 'Always connect GND of every part to GND of the board. Disconnect the power while wiring.'));
      const pins = Object.fromEntries(Object.entries(last.pins).filter(([, g], i, a) => a.findIndex(([, g2]) => g2 === g) === i));
      if (Object.keys(pins).length) {
        const box = h('div', { class: 'st-pins' }, h('p', { class: 'small muted' }, 'Checking the pins…'));
        E.pane.append(box);
        const r = await api('/api/robot/parts/check', { body: { board: st.board, assign: pins } }).catch(() => ({ problems: [] }));
        if (tok !== sideTok) return;
        const pr = (r.problems || []).filter((x) => !/already used/.test(x.message));
        box.innerHTML = '';
        box.append(h('h4', {}, `Pins on the ${BOARD_NAMES[st.board]}`), ...(pr.length ? pr.map((x) => h('div', { class: `small ${x.level === 'error' ? 'bad-t' : 'warn-t'}` }, `${x.level === 'error' ? '⛔ Change this pin:' : '⚠'} pin ${x.gpio} — ${x.message}`)) : [h('div', { class: 'small ok-t' }, '✓ All pins are fine for this board.')]));
      }
    }
  }

  window.MCblocks = {
    render, missionStory, boardProgram, EXAMPLES, onMission,
    missionOf: () => (st.docs ? cleanDoc('mission') : []),
    current: () => (st.docs ? { mode: st.mode, program: cleanDoc(), board: st.board } : null),
  };
  // keep the drafts when the window closes in the middle of typing
  window.addEventListener('beforeunload', () => { if (st.docs) saveDraft(); });
})();
