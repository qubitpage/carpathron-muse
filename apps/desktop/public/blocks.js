// Robot page → 🧱 Blocks: programming with blocks, for beginners (Blockly, Apache-2.0, bundled with the app).
//  • Mission — blocks that drive the car now: forward / turn / wait / say / photo / go to / repeat / if the way is free…
//    Run, Stop, save and load. Teach & repeat: drive by hand while recording, the car repeats it.
//  • Firmware — blocks that become Arduino C++ for a board (ESP32, Uno, Mega, Pico…): pins, LEDs, buttons, servos, beeps,
//    serial print, loops. The code is shown live, pins are checked, and it opens in the Firmware studio to upload.
(() => {
  'use strict';
  const ui = () => window.MCui;
  const st = { loaded: false, mode: 'mission', ws: null, board: 'esp32devkit', name: '', running: false, teaching: false };
  const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  function loadScripts() {
    if (window.Blockly && window.Blockly.Blocks && window.Blockly.Blocks.controls_if) return Promise.resolve();
    const one = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`could not load ${src}`)); document.head.append(s); });
    return one('lib/blockly_compressed.js').then(() => one('lib/blocks_compressed.js')).then(() => one('lib/blockly-en.js'));
  }

  // ---------------------------------------------------------------- block definitions
  function define() {
    if (st.loaded) return;
    const B = window.Blockly;
    const MOVE = 210, SENSE = 160, TALK = 290, CTRL = 120, PIN = 20, OUT = 330;
    B.common.defineBlocksWithJsonArray([
      { type: 'm_forward', message0: 'drive forward %1 cm', args0: [{ type: 'field_number', name: 'CM', value: 30, min: 1, max: 300 }], previousStatement: null, nextStatement: null, colour: MOVE, tooltip: 'Drive straight ahead. The car stops by itself before obstacles (laser).' },
      { type: 'm_back', message0: 'drive back %1 cm', args0: [{ type: 'field_number', name: 'CM', value: 20, min: 1, max: 300 }], previousStatement: null, nextStatement: null, colour: MOVE },
      { type: 'm_turn', message0: 'turn %1 %2 degrees', args0: [{ type: 'field_dropdown', name: 'DIR', options: [['right', 'R'], ['left', 'L']] }, { type: 'field_number', name: 'DEG', value: 90, min: 1, max: 360 }], previousStatement: null, nextStatement: null, colour: MOVE, tooltip: 'Turn on the spot (exact with the gyro).' },
      { type: 'm_speed', message0: 'set speed to %1 %%', args0: [{ type: 'field_number', name: 'PCT', value: 60, min: 20, max: 100 }], previousStatement: null, nextStatement: null, colour: MOVE },
      { type: 'm_stop', message0: 'stop', previousStatement: null, nextStatement: null, colour: MOVE },
      { type: 'm_wait', message0: 'wait %1 seconds', args0: [{ type: 'field_number', name: 'S', value: 1, min: 0, max: 60, precision: 0.1 }], previousStatement: null, nextStatement: null, colour: CTRL },
      { type: 'm_repeat', message0: 'repeat %1 times %2 %3', args0: [{ type: 'field_number', name: 'N', value: 4, min: 1, max: 100, precision: 1 }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CTRL },
      { type: 'm_while', message0: 'while %1 %2', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], previousStatement: null, nextStatement: null, colour: CTRL, tooltip: 'Repeats while the condition is true (at most 200 times).' },
      { type: 'm_if', message0: 'if %1 %2 else %3', args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'THEN' }, { type: 'input_statement', name: 'ELSE' }], previousStatement: null, nextStatement: null, colour: CTRL },
      { type: 'm_dist', message0: 'distance ahead %1 %2 cm', args0: [{ type: 'field_dropdown', name: 'OP', options: [['is less than', 'lt'], ['is more than', 'gt']] }, { type: 'field_number', name: 'CM', value: 30, min: 3, max: 200 }], output: 'Boolean', colour: SENSE, tooltip: 'Needs the VL53L0X laser.' },
      { type: 'm_blocked', message0: 'something blocks the way', output: 'Boolean', colour: SENSE },
      { type: 'm_not', message0: 'not %1', args0: [{ type: 'input_value', name: 'A', check: 'Boolean' }], output: 'Boolean', colour: SENSE },
      { type: 'm_true', message0: 'always', output: 'Boolean', colour: SENSE },
      { type: 'm_say', message0: 'say %1', args0: [{ type: 'field_input', name: 'TEXT', text: 'Hello!' }], previousStatement: null, nextStatement: null, colour: TALK, tooltip: 'The robot says it out loud (its speaker device).' },
      { type: 'm_photo', message0: 'take a photo', previousStatement: null, nextStatement: null, colour: TALK },
      { type: 'm_look', message0: 'look %1', args0: [{ type: 'field_dropdown', name: 'DIR', options: [['left', 'left'], ['right', 'right'], ['behind', 'back']] }], previousStatement: null, nextStatement: null, colour: TALK },
      { type: 'm_scan', message0: 'scan the room', previousStatement: null, nextStatement: null, colour: TALK },
      { type: 'm_goto', message0: 'go to the %1', args0: [{ type: 'field_input', name: 'T', text: 'door' }], previousStatement: null, nextStatement: null, colour: TALK, tooltip: 'Finds it with the camera and drives there.' },
      { type: 'm_light', message0: 'headlight %1', args0: [{ type: 'field_number', name: 'V', value: 120, min: 0, max: 255 }], previousStatement: null, nextStatement: null, colour: TALK },
      // firmware
      { type: 'a_program', message0: 'when the board starts %1 %2 then forever %3 %4', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'SETUP' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'LOOP' }], colour: PIN, tooltip: 'setup() runs once, loop() runs again and again.' },
      { type: 'a_pinmode', message0: 'pin %1 is %2', args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 60 }, { type: 'field_dropdown', name: 'MODE', options: [['an output', 'OUTPUT'], ['an input', 'INPUT'], ['an input with pull-up', 'INPUT_PULLUP']] }], previousStatement: null, nextStatement: null, colour: PIN },
      { type: 'a_write', message0: 'set pin %1 %2', args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 60 }, { type: 'field_dropdown', name: 'V', options: [['HIGH (on)', 'HIGH'], ['LOW (off)', 'LOW']] }], previousStatement: null, nextStatement: null, colour: PIN },
      { type: 'a_pwm', message0: 'set pin %1 power %2 (0–255)', args0: [{ type: 'field_number', name: 'PIN', value: 2, min: 0, max: 60 }, { type: 'input_value', name: 'V', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: PIN, tooltip: 'PWM: dims an LED, sets a motor speed.' },
      { type: 'a_read', message0: 'pin %1 is HIGH', args0: [{ type: 'field_number', name: 'PIN', value: 4, min: 0, max: 60 }], output: 'Boolean', colour: PIN },
      { type: 'a_analog', message0: 'analog value of pin %1', args0: [{ type: 'field_number', name: 'PIN', value: 34, min: 0, max: 60 }], output: 'Number', colour: PIN },
      { type: 'a_delay', message0: 'wait %1 ms', args0: [{ type: 'input_value', name: 'MS', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: CTRL },
      { type: 'a_print', message0: 'print %1', args0: [{ type: 'input_value', name: 'V' }], previousStatement: null, nextStatement: null, colour: OUT, tooltip: 'Shows it in the Serial monitor (115200).' },
      { type: 'a_servo', message0: 'servo on pin %1 to %2 °', args0: [{ type: 'field_number', name: 'PIN', value: 13, min: 0, max: 60 }, { type: 'input_value', name: 'DEG', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: OUT },
      { type: 'a_tone', message0: 'beep on pin %1 at %2 Hz for %3 ms', args0: [{ type: 'field_number', name: 'PIN', value: 15, min: 0, max: 60 }, { type: 'field_number', name: 'HZ', value: 1000, min: 31, max: 20000 }, { type: 'field_number', name: 'MS', value: 200, min: 1, max: 10000 }], previousStatement: null, nextStatement: null, colour: OUT },
      { type: 'a_millis', message0: 'milliseconds since start', output: 'Number', colour: CTRL },
    ]);
    st.loaded = true;
  }
  const MISSION_TOOLBOX = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: 'Move', colour: '210', contents: ['m_forward', 'm_back', 'm_turn', 'm_speed', 'm_stop'].map((type) => ({ kind: 'block', type })) },
    { kind: 'category', name: 'Repeat & decide', colour: '120', contents: ['m_wait', 'm_repeat', 'm_while', 'm_if'].map((type) => ({ kind: 'block', type })) },
    { kind: 'category', name: 'Sense', colour: '160', contents: ['m_dist', 'm_blocked', 'm_not', 'm_true'].map((type) => ({ kind: 'block', type })) },
    { kind: 'category', name: 'See & talk', colour: '290', contents: ['m_say', 'm_photo', 'm_look', 'm_scan', 'm_goto', 'm_light'].map((type) => ({ kind: 'block', type })) },
  ] };
  const num = (n) => ({ kind: 'block', type: 'math_number', fields: { NUM: n } });
  const FW_TOOLBOX = { kind: 'categoryToolbox', contents: [
    { kind: 'category', name: 'Program', colour: '20', contents: [{ kind: 'block', type: 'a_program' }] },
    { kind: 'category', name: 'Pins', colour: '20', contents: [{ kind: 'block', type: 'a_pinmode' }, { kind: 'block', type: 'a_write' }, { kind: 'block', type: 'a_pwm', inputs: { V: { shadow: num(128) } } }, { kind: 'block', type: 'a_read' }, { kind: 'block', type: 'a_analog' }] },
    { kind: 'category', name: 'Time', colour: '120', contents: [{ kind: 'block', type: 'a_delay', inputs: { MS: { shadow: num(500) } } }, { kind: 'block', type: 'a_millis' }] },
    { kind: 'category', name: 'Logic', colour: '210', contents: ['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean'].map((type) => ({ kind: 'block', type })) },
    { kind: 'category', name: 'Loops', colour: '120', contents: [{ kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: { shadow: num(10) } } }, { kind: 'block', type: 'controls_whileUntil' }] },
    { kind: 'category', name: 'Math', colour: '230', contents: [num(0), { kind: 'block', type: 'math_arithmetic' }] },
    { kind: 'category', name: 'Output', colour: '330', contents: [{ kind: 'block', type: 'a_print', inputs: { V: { shadow: { kind: 'block', type: 'text', fields: { TEXT: 'hello' } } } } }, { kind: 'block', type: 'a_servo', inputs: { DEG: { shadow: num(90) } } }, { kind: 'block', type: 'a_tone' }, { kind: 'block', type: 'text' }] },
    { kind: 'category', name: 'Variables', colour: '330', custom: 'VARIABLE' },
  ] };
  const STARTER = {
    mission: { blocks: { languageVersion: 0, blocks: [{ type: 'm_say', x: 30, y: 30, fields: { TEXT: 'Let us draw a square!' }, next: { block: { type: 'm_repeat', fields: { N: 4 }, inputs: { DO: { block: { type: 'm_forward', fields: { CM: 40 }, next: { block: { type: 'm_turn', fields: { DIR: 'R', DEG: 90 } } } } } } } } }] } },
    firmware: { blocks: { languageVersion: 0, blocks: [{ type: 'a_program', x: 30, y: 30, inputs: { SETUP: { block: { type: 'a_pinmode', fields: { PIN: 2, MODE: 'OUTPUT' } } }, LOOP: { block: { type: 'a_write', fields: { PIN: 2, V: 'HIGH' }, next: { block: { type: 'a_delay', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } } }, next: { block: { type: 'a_write', fields: { PIN: 2, V: 'LOW' }, next: { block: { type: 'a_delay', inputs: { MS: { shadow: { type: 'math_number', fields: { NUM: 500 } } } } } } } } } } } } } }] } },
  };

  // ---------------------------------------------------------------- blocks → mission JSON
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
        case 'm_light': return { op: 'light', v: Number(f(b, 'V')) };
        default: return null;
      }
    }
    return top.flatMap((b) => list(b));
  }

  // ---------------------------------------------------------------- blocks → Arduino C++
  function arduinoOf(ws, boardId) {
    const B = window.Blockly;
    const esp = /^esp|^xiao/.test(boardId);
    const gen = new (B.CodeGenerator || B.Generator)('Arduino');
    const O = { ATOMIC: 0, UNARY: 2, MUL: 3, ADD: 4, REL: 6, EQ: 7, AND: 11, OR: 12, NONE: 99 };
    gen.ORDER_ATOMIC = O.ATOMIC;
    const servos = new Set(), vars = new Set();
    const vname = (b) => `v_${String(b.getField('VAR').getText()).replace(/[^A-Za-z0-9_]/g, '_')}`;
    gen.scrub_ = (block, code, thisOnly) => { const next = block.nextConnection && block.nextConnection.targetBlock(); return code + (next && !thisOnly ? gen.blockToCode(next) : ''); };
    const val = (b, name, order = O.NONE, d = '0') => gen.valueToCode(b, name, order) || d;
    const body = (b, name) => gen.statementToCode(b, name);
    const F = gen.forBlock;
    F.a_program = () => '';
    F.a_pinmode = (b) => `pinMode(${b.getFieldValue('PIN')}, ${b.getFieldValue('MODE')});\n`;
    F.a_write = (b) => `digitalWrite(${b.getFieldValue('PIN')}, ${b.getFieldValue('V')});\n`;
    F.a_pwm = (b) => `analogWrite(${b.getFieldValue('PIN')}, constrain((int)(${val(b, 'V')}), 0, 255));\n`;
    F.a_read = (b) => [`(digitalRead(${b.getFieldValue('PIN')}) == HIGH)`, O.EQ];
    F.a_analog = (b) => [`analogRead(${b.getFieldValue('PIN')})`, O.ATOMIC];
    F.a_delay = (b) => `delay(${val(b, 'MS', O.NONE, '0')});\n`;
    F.a_millis = () => ['millis()', O.ATOMIC];
    F.a_print = (b) => `Serial.println(${val(b, 'V', O.NONE, '""')});\n`;
    F.a_servo = (b) => { const p = b.getFieldValue('PIN'); servos.add(p); return `servo_${p}.write(constrain((int)(${val(b, 'DEG', O.NONE, '90')}), 0, 180));\n`; };
    F.a_tone = (b) => `tone(${b.getFieldValue('PIN')}, ${b.getFieldValue('HZ')}, ${b.getFieldValue('MS')});\ndelay(${b.getFieldValue('MS')});\n`;
    F.math_number = (b) => [String(Number(b.getFieldValue('NUM'))), O.ATOMIC];
    F.math_arithmetic = (b) => { const op = { ADD: [' + ', O.ADD], MINUS: [' - ', O.ADD], MULTIPLY: [' * ', O.MUL], DIVIDE: [' / ', O.MUL], POWER: [null, O.ATOMIC] }[b.getFieldValue('OP')]; const a = val(b, 'A', op[1]), c = val(b, 'B', op[1]); return op[0] ? [`${a}${op[0]}${c}`, op[1]] : [`pow(${a}, ${c})`, O.ATOMIC]; };
    F.text = (b) => [JSON.stringify(String(b.getFieldValue('TEXT'))), O.ATOMIC];
    F.logic_boolean = (b) => [b.getFieldValue('BOOL') === 'TRUE' ? 'true' : 'false', O.ATOMIC];
    F.logic_negate = (b) => [`!${val(b, 'BOOL', O.UNARY, 'false')}`, O.UNARY];
    F.logic_compare = (b) => { const op = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' }[b.getFieldValue('OP')]; return [`${val(b, 'A', O.REL)} ${op} ${val(b, 'B', O.REL)}`, O.REL]; };
    F.logic_operation = (b) => { const and = b.getFieldValue('OP') === 'AND'; return [`${val(b, 'A', and ? O.AND : O.OR, 'false')} ${and ? '&&' : '||'} ${val(b, 'B', and ? O.AND : O.OR, 'false')}`, and ? O.AND : O.OR]; };
    F.controls_if = (b) => { let code = ''; let n = 0; for (; b.getInput(`IF${n}`); n++) code += `${n ? ' else ' : ''}if (${val(b, `IF${n}`, O.NONE, 'false')}) {\n${body(b, `DO${n}`)}}`; if (b.getInput('ELSE')) code += ` else {\n${body(b, 'ELSE')}}`; return code + '\n'; };
    F.controls_repeat_ext = (b) => { const i = `i${b.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 4)}`; return `for (int ${i} = 0; ${i} < (int)(${val(b, 'TIMES', O.NONE, '0')}); ${i}++) {\n${body(b, 'DO')}}\n`; };
    F.controls_whileUntil = (b) => { const until = b.getFieldValue('MODE') === 'UNTIL'; return `while (${until ? '!(' : ''}${val(b, 'BOOL', O.NONE, 'false')}${until ? ')' : ''}) {\n${body(b, 'DO')}  delay(1);\n}\n`; };
    F.variables_get = (b) => { vars.add(vname(b)); return [vname(b), O.ATOMIC]; };
    F.variables_set = (b) => { vars.add(vname(b)); return `${vname(b)} = ${val(b, 'VALUE')};\n`; };
    F.math_change = (b) => { vars.add(vname(b)); return `${vname(b)} += ${val(b, 'DELTA')};\n`; };
    gen.init(ws);
    const prog = ws.getTopBlocks(true).find((b) => b.type === 'a_program');
    if (!prog) return { code: '// Put a "when the board starts … then forever" block on the canvas.', pins: {} };
    const setup = gen.statementToCode(prog, 'SETUP'), loop = gen.statementToCode(prog, 'LOOP');
    const loose = ws.getTopBlocks(true).filter((b) => b !== prog && !b.outputConnection).length;
    const pins = {};
    for (const b of ws.getAllBlocks(false)) if (b.getField('PIN') && b.getRootBlock() === prog) pins[`${b.type}#${b.id.slice(0, 3)}`] = Number(b.getFieldValue('PIN'));
    const lines = [`// Made with blocks in Muse Carpathron (Robot → Blocks) for the ${({ esp32cam: 'AI-Thinker ESP32-CAM', esp32devkit: 'ESP32 DevKit', xiaoesp32s3: 'XIAO ESP32S3', uno: 'Arduino Uno', mega2560: 'Arduino Mega', pico: 'Raspberry Pi Pico' })[boardId] || boardId}`];
    if (servos.size) lines.push(esp ? '#include <ESP32Servo.h>  // library "ESP32Servo"' : '#include <Servo.h>');
    lines.push('');
    for (const p of servos) lines.push(`Servo servo_${p};`);
    for (const v of vars) lines.push(`float ${v} = 0;`);
    lines.push('', 'void setup() {', '  Serial.begin(115200);');
    for (const p of servos) lines.push(`  servo_${p}.attach(${p});`);
    lines.push(setup.replace(/\s+$/, '') || '', '}', '', 'void loop() {', loop.replace(/\s+$/, '') || '', '}', '');
    if (loose) lines.unshift(`// Note: ${loose} block group(s) are not inside the program block and are left out.`);
    return { code: lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n'), pins, servos: [...servos] };
  }

  // ---------------------------------------------------------------- the tab
  async function render(el) {
    const { h, api, toast } = ui();
    el.innerHTML = '';
    el.append(h('p', { class: 'small muted' }, 'Loading the blocks…'));
    try { await loadScripts(); define(); } catch (e) { el.innerHTML = ''; el.append(h('p', { class: 'small bad-t' }, e.message)); return; }
    const B = window.Blockly;
    el.innerHTML = '';
    const modeSel = h('div', { class: 'seg' }, ...[['mission', '🚗 Mission (drives the car)'], ['firmware', '🔌 Firmware (code for a board)']].map(([m, t]) => h('button', { class: st.mode === m ? 'on' : '', onclick: () => { saveDraft(); st.mode = m; render(el); } }, t)));
    const area = h('div', { class: 'blk-area' });
    const side = h('div', { class: 'blk-side' });
    el.append(h('p', { class: 'small muted settings-intro' }, st.mode === 'mission' ? 'Snap blocks together and press ▶ Run: the car does them one after another. The car still stops by itself before obstacles, and ■ Stop (or Space) stops it at once. Save missions to run them again, or teach one by driving.' : 'Snap blocks together to make firmware for a board — no typing. The Arduino code appears on the right as you build; pins are checked for the board you pick. "Open in Firmware studio" makes it a project you can compile and upload.'),
      h('div', { class: 'row blk-top' }, modeSel), h('div', { class: 'blk-grid' }, area, side));
    if (st.ws) { try { st.ws.dispose(); } catch {} st.ws = null; }
    const dark = B.Theme.defineTheme('mcDark', { base: B.Themes.Classic, componentStyles: { workspaceBackgroundColour: '#12161c', toolboxBackgroundColour: '#171a1f', toolboxForegroundColour: '#e8eaed', flyoutBackgroundColour: '#1d2128', flyoutForegroundColour: '#e8eaed', flyoutOpacity: 1, scrollbarColour: '#3a4250', insertionMarkerColour: '#ffffff', insertionMarkerOpacity: 0.3, cursorColour: '#d0d0d0' } });
    st.ws = B.inject(area, { media: 'lib/blockly-media/', sounds: false, toolbox: st.mode === 'mission' ? MISSION_TOOLBOX : FW_TOOLBOX, theme: dark, trashcan: true, zoom: { controls: true, wheel: true, startScale: 0.9 }, grid: { spacing: 24, length: 2, colour: '#232a33', snap: true }, renderer: 'zelos', move: { scrollbars: true, drag: true, wheel: false } });
    const draft = LS.get(`mc.blocks.${st.mode}`, '');
    try { B.serialization.workspaces.load(draft ? JSON.parse(draft) : STARTER[st.mode], st.ws); } catch { st.ws.clear(); B.serialization.workspaces.load(STARTER[st.mode], st.ws); }
    const saveDraft = () => { try { if (st.ws) LS.set(`mc.blocks.${st.mode}`, JSON.stringify(B.serialization.workspaces.save(st.ws))); } catch {} };
    st.ws.addChangeListener((e) => { if (!e.isUiEvent) { saveDraft(); if (st.mode === 'firmware') drawCode(); } });
    const resize = () => B.svgResize(st.ws);
    new ResizeObserver(resize).observe(area);

    if (st.mode === 'mission') {
      const out = h('div', { class: 'blk-log' });
      const nameIn = h('input', { placeholder: 'mission name', value: st.name, maxlength: 40, oninput: (e) => { st.name = e.target.value; } });
      const list = h('div', { class: 'list' });
      const runBtn = h('button', { class: 'btn primary', onclick: async () => {
        const program = missionOf(st.ws);
        if (!program.length) return toast('Put some blocks on the canvas first.', true);
        const r = await api('/api/robot/missions/run', { body: { program, name: st.name || 'Blocks mission' } }).catch((e) => ({ error: e.message }));
        if (r.error) return toast(r.error, true);
        out.prepend(h('div', {}, '▶ started'));
      } }, '▶ Run');
      const stopBtn = h('button', { class: 'btn stop', onclick: () => api('/api/robot/missions/stop', { body: {} }) }, '■ Stop');
      const teachBtn = h('button', { class: 'btn', onclick: async () => {
        if (!st.teaching) { await api('/api/robot/missions/teach', { body: { action: 'start' } }); st.teaching = true; teachBtn.textContent = '⏺ Recording… press to save'; teachBtn.classList.add('rec'); toast('Recording: drive the car with the keys, the pad or a controller (Control tab).'); return; }
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
      side.append(h('div', { class: 'row' }, runBtn, stopBtn),
        h('div', { class: 'row' }, nameIn, h('button', { class: 'btn', onclick: async () => { const r = await api('/api/robot/missions/save', { body: { name: st.name, program: missionOf(st.ws), blocks: B.serialization.workspaces.save(st.ws) } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else { toast(`Saved "${r.mission.name}"`); drawList(); } } }, '💾 Save')),
        h('h4', {}, 'Teach & repeat'), h('p', { class: 'small muted' }, 'Press, drive the car by hand on the Control tab (keys, pad or controller), press again: the drive is saved as a mission the car can repeat.'), teachBtn,
        h('h4', {}, 'My missions'), list, h('h4', {}, 'What the car is doing'), out);
      window.MCblocks.onMission = (d) => { if (d.done) out.prepend(h('div', { class: d.ok ? '' : 'warn-t' }, d.error ? `✕ ${d.error}` : d.stopped ? `■ stopped: ${d.stopped}` : `✓ finished (${d.steps} steps)`)); else if (d.text) out.prepend(h('div', {}, d.text)); while (out.children.length > 40) out.lastChild.remove(); };
      drawList();
    } else {
      const boardSel = h('select', { onchange: (e) => { st.board = e.target.value; LS.set('mc.blocks.board', st.board); drawCode(); } },
        ...[['esp32devkit', 'ESP32 DevKit'], ['esp32cam', 'ESP32-CAM'], ['xiaoesp32s3', 'XIAO ESP32S3'], ['uno', 'Arduino Uno'], ['mega2560', 'Arduino Mega'], ['pico', 'Raspberry Pi Pico']].map(([v, t]) => h('option', { value: v, selected: st.board === v ? '' : null }, t)));
      const pre = h('pre', { class: 'blk-code' });
      const checks = h('div', { class: 'small' });
      const nameIn = h('input', { placeholder: 'project name', value: st.fwName || 'blocks_blink', maxlength: 40, oninput: (e) => { st.fwName = e.target.value; } });
      let lastCode = '';
      var drawCode = async () => { // eslint-disable-line no-var
        const r = arduinoOf(st.ws, st.board);
        lastCode = r.code; pre.textContent = r.code;
        const pr = Object.keys(r.pins || {}).length ? await api('/api/robot/parts/check', { body: { board: st.board, assign: dedupe(r.pins) } }).catch(() => ({ problems: [] })) : { problems: [] };
        checks.innerHTML = '';
        const probs = (pr.problems || []).filter((p) => !/already used/.test(p.message));
        checks.append(...(probs.length ? probs.map((p) => h('div', { class: p.level === 'error' ? 'bad-t' : 'warn-t' }, `${p.level === 'error' ? '⛔' : '⚠'} GPIO ${p.gpio}: ${p.message}`)) : [h('div', {}, Object.keys(r.pins || {}).length ? '✓ The pins are fine for this board.' : '')]));
      };
      const dedupe = (pins) => { const seen = {}, out = {}; for (const [k, g] of Object.entries(pins)) if (!seen[g]) { seen[g] = 1; out[k] = g; } return out; };
      side.append(h('div', { class: 'row' }, h('label', { class: 'inline small' }, 'Board ', boardSel)), checks, pre,
        h('div', { class: 'row' }, nameIn, h('button', { class: 'btn primary', onclick: async () => {
          const name = String(st.fwName || 'blocks_blink').trim().replace(/[^\w]/g, '_');
          const fqbn = { esp32devkit: 'esp32:esp32:esp32', esp32cam: 'esp32:esp32:esp32cam', xiaoesp32s3: 'esp32:esp32:XIAO_ESP32S3', uno: 'arduino:avr:uno', mega2560: 'arduino:avr:mega', pico: 'rp2040:rp2040:rpipico' }[st.board];
          let r = await api('/api/studio/new', { body: { name, template: 'blink', fqbn } }).catch((e) => ({ error: e.message }));
          if (r.error && !/already exists/.test(r.error)) return toast(r.error, true);
          r = await api('/api/studio/file', { body: { project: name, name: `${name}.ino`, content: lastCode } }).catch((e) => ({ error: e.message }));
          if (r.error) return toast(r.error, true);
          toast(`Project "${name}" ready — compile and upload it in the Firmware studio`);
          window.MCstudio && window.MCstudio.openStudio({ project: name, fqbn });
        } }, '🧩 Open in Firmware studio')),
        h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(lastCode).then(() => toast('Code copied')); } }, '📋 Copy the code'));
      st.board = LS.get('mc.blocks.board', st.board);
      boardSel.value = st.board;
      drawCode();
    }
    setTimeout(resize, 50);
  }

  window.MCblocks = { render, missionOf, arduinoOf, onMission: null };
})();
