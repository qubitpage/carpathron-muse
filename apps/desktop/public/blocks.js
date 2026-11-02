// Robot page → 🧱 Blocks: programming with blocks, in everyday words (Blockly, Apache-2.0, bundled with the app).
//  • Mission — blocks that drive the car now ("drive forward 30 cm", "turn right 90°", "if something is closer than 30 cm").
//  • Board program — blocks about real things ("LED on pin 2: ON", "the button on pin 4 is pressed", "servo to 90°") that
//    become Arduino code for a board. Next to the blocks the app always explains in plain English what the program will do
//    and what to connect; the code itself is hidden until you ask for it, and then every line has a comment.
(() => {
  'use strict';
  const ui = () => window.MCui;
  const st = { loaded: false, mode: 'mission', ws: null, board: 'esp32devkit', name: '', fwName: 'my_first_program', teaching: false, sideTab: 'story' };
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const BOARD_NAMES = { esp32devkit: 'ESP32 DevKit', esp32cam: 'ESP32-CAM (the car board)', xiaoesp32s3: 'XIAO ESP32S3', uno: 'Arduino Uno', mega2560: 'Arduino Mega', pico: 'Raspberry Pi Pico' };
  const FQBN = { esp32devkit: 'esp32:esp32:esp32', esp32cam: 'esp32:esp32:esp32cam', xiaoesp32s3: 'esp32:esp32:XIAO_ESP32S3', uno: 'arduino:avr:uno', mega2560: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico' };

  function loadScripts() {
    if (window.Blockly && window.Blockly.Blocks && window.Blockly.Blocks.controls_if) return Promise.resolve();
    const one = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`could not load ${src}`)); document.head.append(s); });
    return one('lib/blockly_compressed.js').then(() => one('lib/blocks_compressed.js')).then(() => one('lib/blockly-en.js'));
  }

  // ---------------------------------------------------------------- the blocks
  const C = { move: 210, decide: 120, sense: 160, talk: 290, start: 45, light: 50, input: 160, motor: 20, sound: 330, time: 120, show: 260, adv: 0 };
  function define() {
    if (st.loaded) return;
    const B = window.Blockly;
    const num = (name, value, min, max, precision) => ({ type: 'field_number', name, value, min, max, precision });
    const S = (o) => ({ previousStatement: null, nextStatement: null, ...o });
    B.common.defineBlocksWithJsonArray([
      // ---- mission (drives the car now)
      S({ type: 'm_forward', message0: '🚗 drive forward %1 cm', args0: [num('CM', 30, 1, 300)], colour: C.move, tooltip: 'Drives straight ahead this far. With the laser sensor the car stops by itself before it bumps into something.' }),
      S({ type: 'm_back', message0: '🚗 drive backward %1 cm', args0: [num('CM', 20, 1, 300)], colour: C.move, tooltip: 'Drives straight back this far.' }),
      S({ type: 'm_turn', message0: '↪ turn %1 by %2 degrees', args0: [{ type: 'field_dropdown', name: 'DIR', options: [['right', 'R'], ['left', 'L']] }, num('DEG', 90, 1, 360)], colour: C.move, tooltip: 'Turns on the spot. 90 = a quarter turn, 180 = turn around, 360 = a full circle.' }),
      S({ type: 'm_speed', message0: '🐢🐇 drive at speed %1 %%', args0: [num('PCT', 60, 20, 100)], colour: C.move, tooltip: 'How fast the next drives are: 30 = slow and careful, 100 = as fast as it goes.' }),
      S({ type: 'm_stop', message0: '⛔ stop the wheels', colour: C.move }),
      S({ type: 'm_wait', message0: '⏱ wait %1 seconds', args0: [num('S', 1, 0, 60, 0.1)], colour: C.decide, tooltip: 'Does nothing for a while (the car stands still).' }),
      S({ type: 'm_repeat', message0: '🔁 do this %1 times: %2 %3', args0: [num('N', 4, 1, 100, 1), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.decide, tooltip: 'Repeats the blocks inside this many times. 4 × (forward + turn 90°) = a square.' }),
      S({ type: 'm_while', message0: '🔁 keep doing this while %1 %2', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], colour: C.decide, tooltip: 'Repeats the blocks inside as long as the question on the right is true (at most 200 times, so it always ends).' }),
      S({ type: 'm_if', message0: '❓ if %1 then %2 otherwise %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'THEN' }, { type: 'input_statement', name: 'ELSE' }], colour: C.decide, tooltip: 'Checks the question: if it is true it does the first blocks, if not the second.' }),
      { type: 'm_dist', message0: '📏 something is %1 %2 cm in front', args0: [{ type: 'field_dropdown', name: 'OP', options: [['closer than', 'lt'], ['further than', 'gt']] }, num('CM', 30, 3, 200)], output: 'Boolean', colour: C.sense, tooltip: 'Asks the laser distance sensor. Needs the VL53L0X on the car.' },
      { type: 'm_blocked', message0: '🚧 the way ahead is blocked', output: 'Boolean', colour: C.sense, tooltip: 'True when the car refuses to drive forward because something is too close.' },
      { type: 'm_not', message0: 'NOT %1', args0: [{ type: 'input_value', name: 'A', check: 'Boolean' }], output: 'Boolean', colour: C.sense, tooltip: 'Turns the answer around: true becomes false.' },
      { type: 'm_true', message0: '♾ always (until STOP)', output: 'Boolean', colour: C.sense, tooltip: 'Always true: "keep doing this while always" repeats until you press Stop (at most 200 times).' },
      S({ type: 'm_say', message0: '💬 say %1', args0: [{ type: 'field_input', name: 'TEXT', text: 'Hello!' }], colour: C.talk, tooltip: 'The robot says it out loud.' }),
      S({ type: 'm_photo', message0: '📷 take a photo', colour: C.talk }),
      S({ type: 'm_look', message0: '👀 look %1 (and turn back)', args0: [{ type: 'field_dropdown', name: 'DIR', options: [['left', 'left'], ['right', 'right'], ['behind', 'back']] }], colour: C.talk, tooltip: 'The car turns to look, takes a photo and turns back.' }),
      S({ type: 'm_scan', message0: '🗺 scan the room and draw a map', colour: C.talk }),
      S({ type: 'm_goto', message0: '🎯 find the %1 and drive to it', args0: [{ type: 'field_input', name: 'T', text: 'door' }], colour: C.talk, tooltip: 'The camera looks for it and the car drives there in short hops.' }),
      S({ type: 'm_light', message0: '🔦 headlight brightness %1 %%', args0: [num('V', 50, 0, 100)], colour: C.talk }),
      // ---- board program (things you connect)
      { type: 'f_start', message0: '▶ At start, once: %1 %2 🔁 Then forever: %3 %4', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'SETUP' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'LOOP' }], colour: C.start, tooltip: 'Every board program has these two parts: what happens once at power-on, and what repeats all the time after that.' },
      S({ type: 'f_led', message0: '💡 LED on pin %1 → %2', args0: [num('PIN', 2, 0, 60, 1), { type: 'field_dropdown', name: 'V', options: [['ON', 'HIGH'], ['OFF', 'LOW']] }], colour: C.light, tooltip: 'Switches an LED (or anything small) on or off.' }),
      S({ type: 'f_dim', message0: '💡 LED on pin %1 brightness %2 %%', args0: [num('PIN', 2, 0, 60, 1), { type: 'input_value', name: 'P', check: 'Number' }], inputsInline: true, colour: C.light, tooltip: 'Dims an LED: 0 = off, 100 = full brightness.' }),
      { type: 'f_button', message0: '🔘 the button on pin %1 is pressed', args0: [num('PIN', 4, 0, 60, 1)], output: 'Boolean', colour: C.input, tooltip: 'True while the push button is held down. The button goes between the pin and GND.' },
      { type: 'f_sensor', message0: '🎚 sensor on pin %1 (0 – 100 %%)', args0: [num('PIN', 34, 0, 60, 1)], output: 'Number', colour: C.input, tooltip: 'Reads a knob, a light sensor or any analog sensor as 0 to 100 %.' },
      S({ type: 'f_servo', message0: '🦾 servo on pin %1 turns to %2 °', args0: [num('PIN', 13, 0, 60, 1), { type: 'input_value', name: 'DEG', check: 'Number' }], inputsInline: true, colour: C.motor, tooltip: 'A servo turns to an angle from 0 to 180 degrees and stays there.' }),
      S({ type: 'f_motor', message0: '⚙ motor (via driver) on pin %1 speed %2 %%', args0: [num('PIN', 12, 0, 60, 1), { type: 'input_value', name: 'P', check: 'Number' }], inputsInline: true, colour: C.motor, tooltip: 'Speed of a motor through a motor driver (L298N / TB6612): 0 = stop, 100 = full. Never put a motor straight on a pin.' }),
      S({ type: 'f_beep', message0: '🔊 buzzer on pin %1 beeps %2 for %3 seconds', args0: [num('PIN', 15, 0, 60, 1), { type: 'field_dropdown', name: 'HZ', options: [['high', '2000'], ['medium', '1000'], ['low', '440']] }, num('S', 0.2, 0.05, 10, 0.05)], colour: C.sound, tooltip: 'Plays a tone on a passive buzzer.' }),
      S({ type: 'f_wait', message0: '⏱ wait %1 seconds', args0: [num('S', 1, 0, 3600, 0.01)], colour: C.time, tooltip: 'Pauses the program.' }),
      S({ type: 'f_repeat', message0: '🔁 do this %1 times: %2 %3', args0: [num('N', 3, 1, 10000, 1), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C.decide }),
      S({ type: 'f_if', message0: '❓ if %1 then %2 otherwise %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'THEN' }, { type: 'input_statement', name: 'ELSE' }], colour: C.decide }),
      { type: 'f_compare', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'field_dropdown', name: 'OP', options: [['is less than', '<'], ['is more than', '>'], ['is equal to', '==']] }, { type: 'input_value', name: 'B', check: 'Number' }], inputsInline: true, output: 'Boolean', colour: C.decide, tooltip: 'Compares two numbers.' },
      { type: 'f_not', message0: 'NOT %1', args0: [{ type: 'input_value', name: 'A', check: 'Boolean' }], output: 'Boolean', colour: C.decide },
      { type: 'f_num', message0: '%1', args0: [num('N', 50, -1e9, 1e9)], output: 'Number', colour: C.decide },
      S({ type: 'f_print', message0: '🖥 show on the computer %1', args0: [{ type: 'input_value', name: 'V' }], colour: C.show, tooltip: 'Sends text or a number to the PC (Firmware studio → Serial).' }),
      { type: 'f_text', message0: '"%1"', args0: [{ type: 'field_input', name: 'T', text: 'hello' }], output: null, colour: C.show },
      // ---- advanced (the real Arduino words, for later)
      S({ type: 'a_pinmode', message0: 'pin %1 is %2', args0: [num('PIN', 2, 0, 60, 1), { type: 'field_dropdown', name: 'MODE', options: [['an output', 'OUTPUT'], ['an input', 'INPUT'], ['an input with pull-up', 'INPUT_PULLUP']] }], colour: C.adv, tooltip: 'pinMode(): the low-level way to prepare a pin.' }),
      S({ type: 'a_write', message0: 'set pin %1 %2', args0: [num('PIN', 2, 0, 60, 1), { type: 'field_dropdown', name: 'V', options: [['HIGH', 'HIGH'], ['LOW', 'LOW']] }], colour: C.adv, tooltip: 'digitalWrite()' }),
      { type: 'a_read', message0: 'pin %1 is HIGH', args0: [num('PIN', 4, 0, 60, 1)], output: 'Boolean', colour: C.adv, tooltip: 'digitalRead()' },
    ]);
    st.loaded = true;
  }
  const blk = (type, extra) => ({ kind: 'block', type, ...(extra || {}) });
  const n = (v) => ({ shadow: { type: 'f_num', fields: { N: v } } });
  const MISSION_TOOLBOX = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: '🚗 Move', colour: String(C.move), contents: ['m_forward', 'm_back', 'm_turn', 'm_speed', 'm_stop'].map((t) => blk(t)) },
    { kind: 'category', name: '🔁 Repeat & decide', colour: String(C.decide), contents: ['m_wait', 'm_repeat', 'm_while', 'm_if'].map((t) => blk(t)) },
    { kind: 'category', name: '📏 Questions', colour: String(C.sense), contents: ['m_dist', 'm_blocked', 'm_true', 'm_not'].map((t) => blk(t)) },
    { kind: 'category', name: '💬 Talk & look', colour: String(C.talk), contents: ['m_say', 'm_photo', 'm_look', 'm_scan', 'm_goto', 'm_light'].map((t) => blk(t)) },
  ] };
  const FW_TOOLBOX = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: '▶ Start', colour: String(C.start), contents: [blk('f_start')] },
    { kind: 'category', name: '💡 Lights', colour: String(C.light), contents: [blk('f_led'), blk('f_dim', { inputs: { P: n(50) } })] },
    { kind: 'category', name: '🔘 Buttons & sensors', colour: String(C.input), contents: [blk('f_button'), blk('f_sensor')] },
    { kind: 'category', name: '⚙ Motors & servos', colour: String(C.motor), contents: [blk('f_servo', { inputs: { DEG: n(90) } }), blk('f_motor', { inputs: { P: n(50) } })] },
    { kind: 'category', name: '🔊 Sound', colour: String(C.sound), contents: [blk('f_beep')] },
    { kind: 'category', name: '⏱ Time', colour: String(C.time), contents: [blk('f_wait')] },
    { kind: 'category', name: '🔁 Repeat & decide', colour: String(C.decide), contents: [blk('f_repeat'), blk('f_if'), blk('f_compare', { inputs: { A: n(50), B: n(30) } }), blk('f_not'), blk('f_num')] },
    { kind: 'category', name: '🖥 Show on the PC', colour: String(C.show), contents: [blk('f_print', { inputs: { V: { shadow: { type: 'f_text', fields: { T: 'hello' } } } } }), blk('f_text')] },
    { kind: 'category', name: '🧠 Remember (variables)', colour: '330', custom: 'VARIABLE' },
    { kind: 'category', name: '🛠 Advanced', colour: String(C.adv), contents: [blk('a_pinmode'), blk('a_write'), blk('a_read')] },
  ] };

  // ---------------------------------------------------------------- ready-made examples (with what they teach)
  const M = (type, fields, next, inputs) => ({ type, fields, inputs, next: next ? { block: next } : undefined });
  const chain = (...bs) => { for (let i = bs.length - 2; i >= 0; i--) bs[i].next = { block: bs[i + 1] }; return bs[0]; };
  const nb = (v) => ({ shadow: { type: 'f_num', fields: { N: v } } });
  const EXAMPLES = {
    mission: [
      { id: 'square', title: '🟦 Drive a square', text: 'Says hello, then 4 times: forward 40 cm and a quarter turn. Needs about 60 × 60 cm of floor.',
        blocks: chain(M('m_say', { TEXT: 'Watch me draw a square!' }), M('m_repeat', { N: 4 }, null, { DO: { block: chain(M('m_forward', { CM: 40 }), M('m_turn', { DIR: 'R', DEG: 90 })) } }), M('m_say', { TEXT: 'Done!' })) },
      { id: 'patrol', title: '🚧 Patrol and avoid walls', text: 'Drives forward in short steps; when something is closer than 30 cm it turns right instead. Needs the laser sensor.',
        blocks: M('m_while', {}, null, { COND: { block: M('m_true') }, DO: { block: M('m_if', {}, null, { COND: { block: M('m_dist', { OP: 'lt', CM: 30 }) }, THEN: { block: chain(M('m_say', { TEXT: 'Oops, a wall!' }), M('m_turn', { DIR: 'R', DEG: 90 })) }, ELSE: { block: M('m_forward', { CM: 20 }) } }) } }) },
      { id: 'greeter', title: '👋 Greeter', text: 'Says hello, looks left and right with photos, and says goodbye.',
        blocks: chain(M('m_say', { TEXT: 'Hello! I am Baby Carpathron.' }), M('m_look', { DIR: 'left' }), M('m_look', { DIR: 'right' }), M('m_say', { TEXT: 'Nice to meet you. Bye bye!' })) },
      { id: 'dance', title: '💃 Little dance', text: 'Turns left and right, spins once and blinks the headlight.',
        blocks: chain(M('m_speed', { PCT: 70 }), M('m_repeat', { N: 2 }, null, { DO: { block: chain(M('m_turn', { DIR: 'L', DEG: 45 }), M('m_turn', { DIR: 'R', DEG: 45 })) } }), M('m_light', { V: 80 }), M('m_turn', { DIR: 'R', DEG: 360 }), M('m_light', { V: 0 }), M('m_say', { TEXT: 'Ta-da!' })) },
    ],
    firmware: [
      { id: 'blink', title: '💡 Blink an LED', text: 'The first program everyone makes: an LED goes on and off every half second.',
        blocks: M('f_start', {}, null, { LOOP: { block: chain(M('f_led', { PIN: 2, V: 'HIGH' }), M('f_wait', { S: 0.5 }), M('f_led', { PIN: 2, V: 'LOW' }), M('f_wait', { S: 0.5 })) } }) },
      { id: 'button', title: '🔘 Button lights the LED', text: 'While you hold the button, the LED is on.',
        blocks: M('f_start', {}, null, { LOOP: { block: M('f_if', {}, null, { COND: { block: M('f_button', { PIN: 4 }) }, THEN: { block: M('f_led', { PIN: 2, V: 'HIGH' }) }, ELSE: { block: M('f_led', { PIN: 2, V: 'LOW' }) } }) } }) },
      { id: 'night', title: '🌙 Night light', text: 'A light sensor on pin 34: when it gets dark (below 30 %) the LED switches on.',
        blocks: M('f_start', {}, null, { LOOP: { block: chain(M('f_if', {}, null, { COND: { block: M('f_compare', { OP: '<' }, null, { A: { block: M('f_sensor', { PIN: 34 }) }, B: nb(30) }) }, THEN: { block: M('f_led', { PIN: 2, V: 'HIGH' }) }, ELSE: { block: M('f_led', { PIN: 2, V: 'LOW' }) } }), M('f_wait', { S: 0.2 })) } }) },
      { id: 'servo', title: '🦾 Servo wave', text: 'A servo waves: 0°, 90°, 180° and back, again and again.',
        blocks: M('f_start', {}, null, { LOOP: { block: chain(M('f_servo', { PIN: 13 }, null, { DEG: nb(0) }), M('f_wait', { S: 1 }), M('f_servo', { PIN: 13 }, null, { DEG: nb(90) }), M('f_wait', { S: 1 }), M('f_servo', { PIN: 13 }, null, { DEG: nb(180) }), M('f_wait', { S: 1 })) } }) },
      { id: 'beep', title: '🔊 Hello beeps', text: 'At power-on the buzzer beeps 3 times, then shows "ready" on the PC.',
        blocks: M('f_start', {}, null, { SETUP: { block: chain(M('f_repeat', { N: 3 }, null, { DO: { block: chain(M('f_beep', { PIN: 15, HZ: '2000', S: 0.15 }), M('f_wait', { S: 0.15 })) } }), M('f_print', {}, null, { V: { block: M('f_text', { T: 'ready' }) } })) } }) },
    ],
  };
  const exampleState = (ex) => ({ blocks: { languageVersion: 0, blocks: [{ ...ex.blocks, x: 30, y: 30 }] } });

  // ---------------------------------------------------------------- blocks → mission (JSON steps) and its story
  function missionOf(ws) {
    const top = ws.getTopBlocks(true).filter((b) => !b.outputConnection);
    const list = (b) => { const out = []; for (; b; b = b.getNextBlock()) { const s = stmt(b); if (s) out.push(s); } return out; };
    const cond = (b) => {
      if (!b) return { op: 'true' };
      switch (b.type) {
        case 'm_dist': return { op: b.getFieldValue('OP') === 'lt' ? 'dist_lt' : 'dist_gt', cm: Number(b.getFieldValue('CM')) };
        case 'm_blocked': return { op: 'blocked' };
        case 'm_not': return { op: 'not', a: cond(b.getInputTargetBlock('A')) };
        default: return { op: 'true' };
      }
    };
    const f = (b, k) => b.getFieldValue(k);
    function stmt(b) {
      switch (b.type) {
        case 'm_forward': return { op: 'forward', cm: Number(f(b, 'CM')) };
        case 'm_back': return { op: 'back', cm: Number(f(b, 'CM')) };
        case 'm_turn': return { op: 'turn', deg: Number(f(b, 'DEG')) * (f(b, 'DIR') === 'L' ? -1 : 1) };
        case 'm_speed': return { op: 'speed', pct: Number(f(b, 'PCT')) };
        case 'm_stop': return { op: 'stop' };
        case 'm_wait': return { op: 'wait', s: Number(f(b, 'S')) };
        case 'm_repeat': return { op: 'repeat', n: Number(f(b, 'N')), body: list(b.getInputTargetBlock('DO')) };
        case 'm_while': return { op: 'while', cond: cond(b.getInputTargetBlock('COND')), body: list(b.getInputTargetBlock('DO')) };
        case 'm_if': return { op: 'if', cond: cond(b.getInputTargetBlock('COND')), then: list(b.getInputTargetBlock('THEN')), else: list(b.getInputTargetBlock('ELSE')) };
        case 'm_say': return { op: 'say', text: f(b, 'TEXT') };
        case 'm_photo': return { op: 'photo' };
        case 'm_look': return { op: 'look', dir: f(b, 'DIR') };
        case 'm_scan': return { op: 'scan' };
        case 'm_goto': return { op: 'goto', target: f(b, 'T') };
        case 'm_light': return { op: 'light', v: Math.round(Number(f(b, 'V')) * 2.55) };
        default: return null;
      }
    }
    return top.flatMap((b) => list(b));
  }
  // Plain-English story of a mission: [{ depth, text }]
  function missionStory(prog) {
    const out = [];
    const cond = (c) => ({ dist_lt: `something is closer than ${c.cm} cm in front`, dist_gt: `the way is free for more than ${c.cm} cm`, blocked: 'the way ahead is blocked', true: 'always (until you press Stop)', not: `NOT (${c.a ? cond(c.a) : '…'})` })[c.op] || '…';
    let secs = 0;
    const walk = (list, d, mult = 1) => {
      for (const s of list) {
        switch (s.op) {
          case 'forward': out.push({ d, t: `Drive forward ${s.cm} cm.` }); secs += mult * (s.cm / 25 + 0.3); break;
          case 'back': out.push({ d, t: `Drive backward ${s.cm} cm.` }); secs += mult * (s.cm / 25 + 0.3); break;
          case 'turn': out.push({ d, t: `Turn ${s.deg < 0 ? 'left' : 'right'} by ${Math.abs(s.deg)}°${Math.abs(s.deg) === 90 ? ' (a quarter turn)' : Math.abs(s.deg) === 180 ? ' (turn around)' : Math.abs(s.deg) === 360 ? ' (a full circle)' : ''}.` }); secs += mult * (Math.abs(s.deg) / 120 + 0.3); break;
          case 'speed': out.push({ d, t: `From now on drive at ${s.pct} % speed${s.pct <= 40 ? ' (slow)' : s.pct >= 85 ? ' (fast)' : ''}.` }); break;
          case 'stop': out.push({ d, t: 'Stop the wheels.' }); break;
          case 'wait': out.push({ d, t: `Wait ${s.s} second${s.s === 1 ? '' : 's'}.` }); secs += mult * s.s; break;
          case 'say': out.push({ d, t: `Say “${s.text}”.` }); secs += mult * (0.5 + s.text.length / 14); break;
          case 'photo': out.push({ d, t: 'Take a photo.' }); secs += mult; break;
          case 'look': out.push({ d, t: `Turn to look ${s.dir === 'back' ? 'behind' : s.dir}, take a photo and turn back.` }); secs += mult * 4; break;
          case 'scan': out.push({ d, t: 'Turn a full circle taking photos and draw a map of the room (about a minute).' }); secs += mult * 60; break;
          case 'goto': out.push({ d, t: `Look for the ${s.target} with the camera and drive to it.` }); secs += mult * 30; break;
          case 'light': out.push({ d, t: s.v ? `Switch the headlight on (${Math.round(s.v / 2.55)} %).` : 'Switch the headlight off.' }); break;
          case 'repeat': out.push({ d, t: `Do this ${s.n} times:` }); walk(s.body, d + 1, mult * s.n); break;
          case 'while': out.push({ d, t: `Keep doing this as long as ${cond(s.cond)}:` }); walk(s.body, d + 1, mult * (s.cond.op === 'true' ? 200 : 5)); break;
          case 'if': out.push({ d, t: `If ${cond(s.cond)}:` }); walk(s.then, d + 1, mult); if (s.else && s.else.length) { out.push({ d, t: 'Otherwise:' }); walk(s.else, d + 1, mult); } break;
          default: break;
        }
      }
    };
    walk(prog, 0);
    const forever = JSON.stringify(prog).includes('"op":"true"');
    return { lines: out, note: !prog.length ? '' : forever ? 'It keeps going until you press ■ Stop (or Space).' : `Takes about ${secs < 60 ? `${Math.max(1, Math.round(secs))} seconds` : `${Math.round(secs / 60)} minute${secs >= 90 ? 's' : ''}`}.`, needsLaser: /dist_/.test(JSON.stringify(prog)) };
  }

  // ---------------------------------------------------------------- blocks → Arduino code (with a comment on every line), story, parts
  function boardProgram(ws, boardId) {
    const B = window.Blockly;
    const esp = /^esp|^xiao/.test(boardId), avr = boardId === 'uno' || boardId === 'mega2560';
    const ADC = esp ? 4095 : 1023;
    const gen = new (B.CodeGenerator || B.Generator)('BoardProgram');
    const O = { ATOMIC: 0, UNARY: 2, MUL: 3, ADD: 4, REL: 6, EQ: 7, AND: 11, OR: 12, NONE: 99 };
    const uses = { led: new Set(), dim: new Set(), button: new Set(), sensor: new Set(), servo: new Set(), motor: new Set(), beep: new Set(), print: false, raw: new Set() };
    const vars = new Set();
    const vname = (b) => String(b.getField('VAR').getText()).replace(/[^A-Za-z0-9_]/g, '_') || 'value';
    gen.scrub_ = (block, code, thisOnly) => { const next = block.nextConnection && block.nextConnection.targetBlock(); return code + (next && !thisOnly ? gen.blockToCode(next) : ''); };
    const val = (b, name, order = O.NONE, d = '0') => gen.valueToCode(b, name, order) || d;
    const body = (b, name) => gen.statementToCode(b, name);
    const pin = (b) => Number(b.getFieldValue('PIN'));
    const pct = (b, name) => val(b, name, O.NONE, '0');
    const isNum = (t) => /^-?\d+(\.\d+)?$/.test(t);
    const clampTxt = (t, lo, hi) => (isNum(t) ? String(Math.max(lo, Math.min(hi, Math.round(Number(t))))) : `constrain((int)(${t}), ${lo}, ${hi})`);
    const pctTo255 = (t) => (isNum(t) ? String(Math.round(Math.max(0, Math.min(100, Number(t))) * 2.55)) : `map(constrain((int)(${t}), 0, 100), 0, 100, 0, 255)`);
    const F = gen.forBlock;
    F.f_start = () => '';
    F.f_led = (b) => { uses.led.add(pin(b)); return `digitalWrite(${pin(b)}, ${b.getFieldValue('V')});  // LED on pin ${pin(b)} ${b.getFieldValue('V') === 'HIGH' ? 'ON' : 'OFF'}\n`; };
    F.f_dim = (b) => { uses.dim.add(pin(b)); return `analogWrite(${pin(b)}, ${pctTo255(pct(b, 'P'))});  // LED on pin ${pin(b)} at ${pct(b, 'P')} % brightness (0–255)\n`; };
    F.f_button = (b) => { uses.button.add(pin(b)); return [`(digitalRead(${pin(b)}) == LOW)`, O.EQ]; }; // pull-up: pressed = LOW
    F.f_sensor = (b) => { uses.sensor.add(pin(b)); return [`(analogRead(${pin(b)}) * 100L / ${ADC})`, O.MUL]; };
    F.f_servo = (b) => { uses.servo.add(pin(b)); return `servo_${pin(b)}.write(${clampTxt(val(b, 'DEG', O.NONE, '90'), 0, 180)});  // servo on pin ${pin(b)} turns to ${val(b, 'DEG', O.NONE, '90')}°\n`; };
    F.f_motor = (b) => { uses.motor.add(pin(b)); return `analogWrite(${pin(b)}, ${pctTo255(pct(b, 'P'))});  // motor on pin ${pin(b)} at ${pct(b, 'P')} % speed (through the driver)\n`; };
    F.f_beep = (b) => { uses.beep.add(pin(b)); const ms = Math.round(Number(b.getFieldValue('S')) * 1000); return `tone(${pin(b)}, ${b.getFieldValue('HZ')}, ${ms});  // beep\ndelay(${ms});  // wait while it beeps\n`; };
    F.f_wait = (b) => `delay(${Math.round(Number(b.getFieldValue('S')) * 1000)});  // wait ${b.getFieldValue('S')} s\n`;
    F.f_repeat = (b) => { const i = `i${b.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}`; return `for (int ${i} = 0; ${i} < ${Math.round(Number(b.getFieldValue('N')))}; ${i}++) {  // do this ${b.getFieldValue('N')} times\n${body(b, 'DO')}}\n`; };
    F.f_if = (b) => `if (${val(b, 'COND', O.NONE, 'false')}) {  // if …\n${body(b, 'THEN')}} else {  // otherwise …\n${body(b, 'ELSE')}}\n`;
    F.f_compare = (b) => [`${val(b, 'A', O.REL)} ${b.getFieldValue('OP')} ${val(b, 'B', O.REL)}`, O.REL];
    F.f_not = (b) => [`!(${val(b, 'A', O.NONE, 'false')})`, O.UNARY];
    F.f_num = (b) => [String(Number(b.getFieldValue('N'))), O.ATOMIC];
    F.f_print = (b) => { uses.print = true; return `Serial.println(${val(b, 'V', O.NONE, '""')});  // show it on the PC\n`; };
    F.f_text = (b) => [JSON.stringify(String(b.getFieldValue('T'))), O.ATOMIC];
    F.a_pinmode = (b) => { uses.raw.add(pin(b)); return `pinMode(${pin(b)}, ${b.getFieldValue('MODE')});\n`; };
    F.a_write = (b) => { uses.raw.add(pin(b)); return `digitalWrite(${pin(b)}, ${b.getFieldValue('V')});\n`; };
    F.a_read = (b) => { uses.raw.add(pin(b)); return [`(digitalRead(${pin(b)}) == HIGH)`, O.EQ]; };
    F.variables_get = (b) => { vars.add(vname(b)); return [vname(b), O.ATOMIC]; };
    F.variables_set = (b) => { vars.add(vname(b)); return `${vname(b)} = ${val(b, 'VALUE')};  // remember it\n`; };
    F.math_change = (b) => { vars.add(vname(b)); return `${vname(b)} += ${val(b, 'DELTA')};\n`; };
    F.math_number = (b) => [String(Number(b.getFieldValue('NUM'))), O.ATOMIC];
    F.text = (b) => [JSON.stringify(String(b.getFieldValue('TEXT'))), O.ATOMIC];
    gen.init(ws);
    const prog = ws.getTopBlocks(true).find((b) => b.type === 'f_start');
    if (!prog) return { code: '// Put the "▶ When the board switches on…" block on the canvas first.', story: [], parts: [], pins: {}, missing: true };
    const setup = gen.statementToCode(prog, 'SETUP'), loop = gen.statementToCode(prog, 'LOOP');
    const loose = ws.getTopBlocks(true).filter((b) => b !== prog && !b.outputConnection).length;
    // the code
    const L = [`// ${BOARD_NAMES[boardId] || boardId} program made with blocks in Muse Carpathron.`, '// The text after // on each line explains it; the board ignores it.', ''];
    if (uses.servo.size) L.push(esp ? '#include <ESP32Servo.h>  // servo library ("ESP32Servo")' : '#include <Servo.h>  // servo library', '');
    for (const p of uses.servo) L.push(`Servo servo_${p};  // the servo on pin ${p}`);
    for (const v of vars) L.push(`float ${v} = 0;  // a number the program remembers: ${v}`);
    L.push('', 'void setup() {  // runs once when the board switches on', '  Serial.begin(115200);  // talk to the PC at 115200 baud');
    for (const p of uses.led) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} drives an LED`);
    for (const p of uses.dim) if (!uses.led.has(p)) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} dims an LED`);
    for (const p of uses.motor) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} sets the motor speed`);
    for (const p of uses.beep) L.push(`  pinMode(${p}, OUTPUT);  // pin ${p} drives the buzzer`);
    for (const p of uses.button) L.push(`  pinMode(${p}, INPUT_PULLUP);  // button on pin ${p}: reads LOW when pressed`);
    for (const p of uses.servo) L.push(`  servo_${p}.attach(${p});  // the servo listens on pin ${p}`);
    if (setup.trim()) L.push(setup.replace(/\s+$/, ''));
    L.push('}', '', 'void loop() {  // runs again and again, forever');
    if (loop.trim()) L.push(loop.replace(/\s+$/, ''));
    L.push('}', '');
    if (loose) L.unshift(`// Note: ${loose} group(s) of blocks are outside the ▶ block and are not used.`);
    // the story
    const story = [];
    const txtC = (b) => {
      if (!b) return '…';
      switch (b.type) {
        case 'f_button': return `the button on pin ${pin(b)} is pressed`;
        case 'f_compare': return `${txtV(b.getInputTargetBlock('A'))} ${({ '<': 'is less than', '>': 'is more than', '==': 'is equal to' })[b.getFieldValue('OP')]} ${txtV(b.getInputTargetBlock('B'))}`;
        case 'f_not': return `NOT (${txtC(b.getInputTargetBlock('A'))})`;
        case 'a_read': return `pin ${pin(b)} is HIGH`;
        default: return '…';
      }
    };
    const txtV = (b) => { if (!b) return '…'; switch (b.type) { case 'f_num': case 'math_number': return String(b.getFieldValue(b.type === 'f_num' ? 'N' : 'NUM')); case 'f_sensor': return `the sensor on pin ${pin(b)} (in %)`; case 'f_text': return `“${b.getFieldValue('T')}”`; case 'variables_get': return `the remembered “${vname(b)}”`; default: return 'a value'; } };
    const walk = (b, d) => {
      for (; b; b = b.getNextBlock()) {
        switch (b.type) {
          case 'f_led': story.push({ d, t: `Switch the LED on pin ${pin(b)} ${b.getFieldValue('V') === 'HIGH' ? 'ON' : 'OFF'}.` }); break;
          case 'f_dim': story.push({ d, t: `Set the LED on pin ${pin(b)} to ${txtV(b.getInputTargetBlock('P'))} % brightness.` }); break;
          case 'f_servo': story.push({ d, t: `Turn the servo on pin ${pin(b)} to ${txtV(b.getInputTargetBlock('DEG'))}°.` }); break;
          case 'f_motor': story.push({ d, t: `Run the motor on pin ${pin(b)} at ${txtV(b.getInputTargetBlock('P'))} % speed.` }); break;
          case 'f_beep': story.push({ d, t: `Beep (${({ 2000: 'high', 1000: 'medium', 440: 'low' })[b.getFieldValue('HZ')]}) on the buzzer on pin ${pin(b)} for ${b.getFieldValue('S')} s.` }); break;
          case 'f_wait': story.push({ d, t: `Wait ${b.getFieldValue('S')} second${Number(b.getFieldValue('S')) === 1 ? '' : 's'}.` }); break;
          case 'f_repeat': story.push({ d, t: `Do this ${b.getFieldValue('N')} times:` }); walk(b.getInputTargetBlock('DO'), d + 1); break;
          case 'f_if': story.push({ d, t: `If ${txtC(b.getInputTargetBlock('COND'))}:` }); walk(b.getInputTargetBlock('THEN'), d + 1); if (b.getInputTargetBlock('ELSE')) { story.push({ d, t: 'Otherwise:' }); walk(b.getInputTargetBlock('ELSE'), d + 1); } break;
          case 'f_print': story.push({ d, t: `Show ${txtV(b.getInputTargetBlock('V'))} on the PC (Serial monitor).` }); break;
          case 'variables_set': story.push({ d, t: `Remember ${txtV(b.getInputTargetBlock('VALUE'))} as “${vname(b)}”.` }); break;
          case 'a_pinmode': story.push({ d, t: `Prepare pin ${pin(b)} (${b.getFieldValue('MODE')}).` }); break;
          case 'a_write': story.push({ d, t: `Set pin ${pin(b)} ${b.getFieldValue('V')}.` }); break;
          default: story.push({ d, t: '(a block)' });
        }
      }
    };
    story.push({ d: 0, t: 'When the board switches on:', head: true });
    if (prog.getInputTargetBlock('SETUP')) walk(prog.getInputTargetBlock('SETUP'), 1); else story.push({ d: 1, t: 'nothing special.' });
    story.push({ d: 0, t: 'Then again and again, forever:', head: true });
    if (prog.getInputTargetBlock('LOOP')) walk(prog.getInputTargetBlock('LOOP'), 1); else story.push({ d: 1, t: 'nothing (the board just waits).' });
    // what to connect
    const parts = [];
    for (const p of uses.led) parts.push({ icon: '💡', t: `An LED on pin ${p}: long leg → pin ${p}, short leg → a 220 Ω resistor → GND.` });
    for (const p of uses.dim) if (!uses.led.has(p)) parts.push({ icon: '💡', t: `An LED on pin ${p} (dimmable): long leg → pin ${p}, short leg → 220 Ω → GND.` });
    for (const p of uses.button) parts.push({ icon: '🔘', t: `A push button between pin ${p} and GND (no resistor needed).` });
    for (const p of uses.sensor) parts.push({ icon: '🎚', t: `A sensor or knob: its signal (OUT / middle leg) → pin ${p}, the other legs → 3.3 V and GND.${esp ? ' On ESP32 use pins 32–39 for this when Wi-Fi is on.' : ''}` });
    for (const p of uses.servo) parts.push({ icon: '🦾', t: `A servo (SG90): orange → pin ${p}, red → 5 V, brown → GND.` });
    for (const p of uses.motor) parts.push({ icon: '⚙', t: `A motor driver (L298N / TB6612): its speed input (ENA / PWMA) → pin ${p}. The motor goes on the driver, never straight on the board.` });
    for (const p of uses.beep) parts.push({ icon: '🔊', t: `A passive buzzer: + → pin ${p}, − → GND.` });
    const pins = {};
    for (const [k, set] of Object.entries(uses)) if (set instanceof Set) for (const p of set) pins[`${k} ${p}`] = p;
    return { code: L.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'), story, parts, pins, avr };
  }

  // ---------------------------------------------------------------- the tab
  async function render(el) {
    const { h, api, toast } = ui();
    el.innerHTML = '';
    el.append(h('p', { class: 'small muted' }, 'Loading the blocks…'));
    try { await loadScripts(); define(); } catch (e) { el.innerHTML = ''; el.append(h('p', { class: 'small bad-t' }, e.message)); return; }
    const B = window.Blockly;
    el.innerHTML = '';
    const saveDraft = () => { try { if (st.ws) LS.set(`mc.blocks2.${st.mode}`, JSON.stringify(B.serialization.workspaces.save(st.ws))); } catch {} };
    const modeSel = h('div', { class: 'seg' }, ...[['mission', '🚗 Robot mission'], ['firmware', '🔌 Board program']].map(([m, t]) => h('button', { class: st.mode === m ? 'on' : '', onclick: () => { saveDraft(); st.mode = m; st.sideTab = 'story'; render(el); } }, t)));
    const intro = st.mode === 'mission'
      ? 'Build what the car should do with blocks, read the plan on the right in plain words, then press ▶ Run. Start from an example if you like.'
      : 'Build a program for a board (ESP32, Arduino, Pico) from blocks about real things: LEDs, buttons, sensors, servos, buzzers. The right side tells you in plain words what it will do and what to connect. The code is made for you.';
    const exRow = h('div', { class: 'blk-examples' }, h('span', { class: 'small muted' }, 'Examples:'), ...EXAMPLES[st.mode].map((ex) => h('button', { class: 'chip', title: ex.text, onclick: () => { st.ws.clear(); B.serialization.workspaces.load(exampleState(ex), st.ws); if (st.mode === 'mission') { st.name = ex.title.replace(/^\S+\s/, ''); } else st.fwName = ex.id; toast(`${ex.title}: ${ex.text}`); } }, ex.title)));
    const area = h('div', { class: 'blk-area' });
    const side = h('div', { class: 'blk-side' });
    el.append(h('p', { class: 'small muted settings-intro' }, intro), h('div', { class: 'row blk-top' }, modeSel), exRow, h('div', { class: 'blk-grid' }, area, side));
    if (st.ws) { try { st.ws.dispose(); } catch {} st.ws = null; }
    const dark = B.Theme.defineTheme('mcDark2', { base: B.Themes.Classic, fontStyle: { family: 'Segoe UI, system-ui, sans-serif', size: 12 }, componentStyles: { workspaceBackgroundColour: '#12161c', toolboxBackgroundColour: '#171a1f', toolboxForegroundColour: '#e8eaed', flyoutBackgroundColour: '#1d2128', flyoutForegroundColour: '#e8eaed', flyoutOpacity: 1, scrollbarColour: '#3a4250', insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3, cursorColour: '#d0d0d0' } });
    st.ws = B.inject(area, { media: 'lib/blockly-media/', sounds: false, toolbox: st.mode === 'mission' ? MISSION_TOOLBOX : FW_TOOLBOX, theme: dark, trashcan: true, zoom: { controls: true, wheel: true, startScale: 0.95 }, grid: { spacing: 24, length: 2, colour: '#232a33', snap: true }, renderer: 'zelos', move: { scrollbars: true, drag: true, wheel: false } });
    const draft = LS.get(`mc.blocks2.${st.mode}`, '');
    try { B.serialization.workspaces.load(draft ? JSON.parse(draft) : exampleState(EXAMPLES[st.mode][0]), st.ws); } catch { st.ws.clear(); B.serialization.workspaces.load(exampleState(EXAMPLES[st.mode][0]), st.ws); }
    let refresh = () => {};
    st.ws.addChangeListener((e) => { if (!e.isUiEvent) { saveDraft(); refresh(); } });
    const resize = () => B.svgResize(st.ws);
    new ResizeObserver(resize).observe(area);
    const storyList = (lines) => h('ol', { class: 'blk-story' }, ...lines.map((l) => h('li', { class: l.head ? 'head' : '', style: `margin-left:${l.d * 18}px` }, l.t)));

    if (st.mode === 'mission') {
      const storyBox = h('div', { class: 'card blk-plan' });
      const out = h('div', { class: 'blk-log' });
      const nameIn = h('input', { placeholder: 'name for this mission', value: st.name, maxlength: 40, oninput: (e) => { st.name = e.target.value; } });
      const list = h('div', { class: 'list' });
      refresh = () => {
        const s = missionStory(missionOf(st.ws));
        storyBox.innerHTML = '';
        storyBox.append(...[h('h4', {}, '📖 What the robot will do'), s.lines.length ? storyList(s.lines) : h('p', { class: 'small muted' }, 'Drag blocks from the left into the dark area and snap them under each other. The plan appears here.'),
          s.note ? h('p', { class: 'small muted' }, `⏱ ${s.note}`) : null, s.needsLaser ? h('p', { class: 'small warn-t' }, '📏 This mission asks the laser distance sensor — the car needs a VL53L0X.') : null].filter(Boolean));
      };
      const runBtn = h('button', { class: 'btn primary', onclick: async () => {
        const program = missionOf(st.ws);
        if (!program.length) return toast('Put some blocks on the canvas first.', true);
        const r = await api('/api/robot/missions/run', { body: { program, name: st.name || 'Blocks mission' } }).catch((e) => ({ error: e.message }));
        if (r.error) return toast(r.error, true);
        out.prepend(h('div', {}, '▶ started'));
      } }, '▶ Run on the car');
      const stopBtn = h('button', { class: 'btn stop', onclick: () => api('/api/robot/missions/stop', { body: {} }) }, '■ Stop');
      const teachBtn = h('button', { class: 'btn', onclick: async () => {
        if (!st.teaching) { await api('/api/robot/missions/teach', { body: { action: 'start' } }); st.teaching = true; teachBtn.textContent = '⏺ Recording… press to save'; teachBtn.classList.add('rec'); toast('Recording: drive the car on the Control tab (keys, pad or controller), then come back and press again.'); return; }
        const r = await api('/api/robot/missions/teach', { body: { action: 'stop', name: st.name || '' } }).catch((e) => ({ error: e.message }));
        st.teaching = false; teachBtn.textContent = '⏺ Teach by driving'; teachBtn.classList.remove('rec');
        if (r.error) return toast(r.error, true);
        toast(`Saved "${r.mission.name}" — ${r.mission.program.length} steps`); drawList();
      } }, '⏺ Teach by driving');
      async function drawList() {
        const r = await api('/api/robot/missions').catch(() => ({ missions: [] }));
        if (r.teaching && !st.teaching) { st.teaching = true; teachBtn.textContent = '⏺ Recording… press to save'; teachBtn.classList.add('rec'); }
        list.innerHTML = '';
        if (!r.missions.length) list.append(h('p', { class: 'small muted' }, 'No saved missions yet.'));
        for (const m of r.missions) list.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', {}, m.name), h('div', { class: 'meta' }, `${m.kind === 'taught' ? '⏺ taught by driving' : '🧱 blocks'} · ${m.steps} steps`)),
          h('button', { class: 'btn tiny', title: 'Run', onclick: () => api('/api/robot/missions/run', { body: { name: m.name } }).then((x) => x.error && toast(x.error, true)) }, '▶'),
          m.kind === 'blocks' ? h('button', { class: 'btn tiny', title: 'Open in the editor', onclick: async () => { const x = await api('/api/robot/missions/get', { body: { name: m.name } }); if (x.blocks) { B.serialization.workspaces.load(x.blocks, st.ws); st.name = x.name; nameIn.value = x.name; } } }, '✎') : null,
          h('button', { class: 'btn tiny ghost', title: 'Delete', onclick: async () => { await api('/api/robot/missions/delete', { body: { name: m.name } }); drawList(); } }, '🗑')));
      }
      side.append(storyBox, h('div', { class: 'row' }, runBtn, stopBtn),
        h('div', { class: 'row' }, nameIn, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/robot/missions/save', { body: { name: st.name, program: missionOf(st.ws), blocks: B.serialization.workspaces.save(st.ws) } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else { toast(`Saved "${r.mission.name}"`); drawList(); } } }, '💾 Save')),
        h('h4', {}, 'What the car is doing'), out,
        h('h4', {}, '⏺ Teach & repeat'), h('p', { class: 'small muted' }, 'Press, drive the car by hand on the Control tab, press again: the drive is saved as a mission the car can repeat.'), teachBtn,
        h('h4', {}, 'My missions'), list);
      window.MCblocks.onMission = (d) => { if (d.done) out.prepend(h('div', { class: d.ok ? '' : 'warn-t' }, d.error ? `✕ ${d.error}` : d.stopped ? `■ stopped: ${d.stopped}` : `✓ finished (${d.steps} steps)`)); else if (d.text) out.prepend(h('div', {}, d.text)); while (out.children.length > 40) out.lastChild.remove(); };
      refresh(); drawList();
    } else {
      const boardSel = h('select', { onchange: (e) => { st.board = e.target.value; LS.set('mc.blocks.board', st.board); refresh(); } }, ...Object.entries(BOARD_NAMES).map(([v, t]) => h('option', { value: v }, t)));
      st.board = LS.get('mc.blocks.board', st.board); boardSel.value = st.board;
      const tabs = h('div', { class: 'seg blk-tabs' });
      const pane = h('div', { class: 'card blk-plan' });
      const nameIn = h('input', { placeholder: 'program name', value: st.fwName, maxlength: 40, oninput: (e) => { st.fwName = e.target.value; } });
      let last = null;
      refresh = async () => {
        last = boardProgram(st.ws, st.board);
        tabs.innerHTML = '';
        for (const [id, label] of [['story', '📖 What it does'], ['parts', `🧰 What to connect${last.parts.length ? ` (${last.parts.length})` : ''}`], ['code', '💻 The code']]) tabs.append(h('button', { class: st.sideTab === id ? 'on' : '', onclick: () => { st.sideTab = id; refresh(); } }, label));
        pane.innerHTML = '';
        if (last.missing) { pane.append(h('p', { class: 'small' }, 'Start with the ▶ block (category "▶ Start"), or pick an example above.')); return; }
        if (st.sideTab === 'story') pane.append(storyList(last.story));
        if (st.sideTab === 'parts') {
          pane.append(last.parts.length ? h('ul', { class: 'blk-parts' }, ...last.parts.map((p) => h('li', {}, h('span', {}, p.icon), ' ', p.t))) : h('p', { class: 'small muted' }, 'Nothing to connect yet.'),
            h('p', { class: 'small muted' }, 'Always connect GND of every part to GND of the board. Disconnect the power while wiring.'));
          const pins = Object.fromEntries(Object.entries(last.pins).filter(([, g], i, a) => a.findIndex(([, g2]) => g2 === g) === i));
          if (Object.keys(pins).length) {
            const r = await api('/api/robot/parts/check', { body: { board: st.board, assign: pins } }).catch(() => ({ problems: [] }));
            const pr = (r.problems || []).filter((x) => !/already used/.test(x.message));
            pane.append(h('h4', {}, `Pins on the ${BOARD_NAMES[st.board]}`), ...(pr.length ? pr.map((x) => h('div', { class: `small ${x.level === 'error' ? 'bad-t' : 'warn-t'}` }, `${x.level === 'error' ? '⛔ Change this pin:' : '⚠'} pin ${x.gpio} — ${x.message}`)) : [h('div', { class: 'small' }, '✓ All pins are fine for this board.')]));
          }
        }
        if (st.sideTab === 'code') pane.append(h('p', { class: 'small muted' }, 'This is the Arduino code the blocks make. You never have to type it: the text after // on each line explains what the line does.'), h('pre', { class: 'blk-code' }, last.code));
      };
      side.append(h('div', { class: 'row' }, h('label', { class: 'inline small' }, 'Board: ', boardSel)), tabs, pane,
        h('div', { class: 'row' }, nameIn, h('button', { class: 'btn primary', onclick: async () => {
          const name = String(st.fwName || 'my_first_program').trim().replace(/[^\w]/g, '_');
          let r = await api('/api/studio/new', { body: { name, template: 'blink', fqbn: FQBN[st.board] } }).catch((e) => ({ error: e.message }));
          if (r.error && !/already exists/.test(r.error)) return toast(r.error, true);
          r = await api('/api/studio/file', { body: { project: name, name: `${name}.ino`, content: last.code } }).catch((e) => ({ error: e.message }));
          if (/#include <ESP32Servo.h>/.test(last.code)) { toast('Installing the servo library (ESP32Servo) for this program…'); await api('/api/studio/libinstall', { body: { name: 'ESP32Servo' } }).catch(() => {}); }
          if (r.error) return toast(r.error, true);
          toast(`"${name}" is ready: connect the board with USB, then press ⬆ Upload in the Firmware studio`);
          window.MCstudio && window.MCstudio.openStudio({ project: name, fqbn: FQBN[st.board] });
        } }, '⬆ Put it on the board…')),
        h('p', { class: 'small muted' }, '"Put it on the board" opens the program in the Firmware studio: connect the board with a USB cable, pick its port and press ⬆ Upload.'));
      refresh();
    }
    setTimeout(resize, 50);
  }

  window.MCblocks = { render, missionOf, missionStory, boardProgram, EXAMPLES, onMission: null };
})();
