// "📖 Explain": board code (Arduino C++) explained in everyday words, line by line, plus a short summary of what the
// program uses (pins, Wi-Fi, USB messages, libraries). Works offline, instantly, with no AI. Used by the Firmware studio.
(function (root) {
  'use strict';
  const LIBS = {
    'WiFi.h': 'Wi-Fi (join a network or make a hotspot)', 'Wire.h': 'I2C — the 2-wire bus (SDA + SCL) many sensors and screens use',
    'SPI.h': 'SPI — a fast 4-wire bus for SD cards and some screens', 'Servo.h': 'servo motors (turn to an angle)', 'ESP32Servo.h': 'servo motors on ESP32 boards (turn to an angle)',
    'esp_camera.h': 'the camera', 'WebServer.h': 'a small web server (pages and commands from the browser)', 'esp_http_server.h': 'a fast web server (the car\'s control and video)',
    'Preferences.h': 'the permanent memory (settings survive power-off)', 'EEPROM.h': 'the permanent memory (settings survive power-off)', 'Update.h': 'updating its own firmware over Wi-Fi',
    'ArduinoOTA.h': 'updating its firmware over Wi-Fi', 'DHT.h': 'the DHT temperature and humidity sensor', 'Adafruit_NeoPixel.h': 'NeoPixel colour LEDs',
    'FastLED.h': 'colour LED strips', 'LiquidCrystal_I2C.h': 'a text LCD screen on I2C', 'Adafruit_SSD1306.h': 'a small OLED screen', 'VL53L0X.h': 'the VL53L0X laser distance sensor',
    'Adafruit_VL53L0X.h': 'the VL53L0X laser distance sensor', 'MPU6050.h': 'the MPU6050 gyro (turning and tilt)', 'Adafruit_MPU6050.h': 'the MPU6050 gyro (turning and tilt)',
    'BluetoothSerial.h': 'Bluetooth messages', 'SD.h': 'the SD memory card', 'SD_MMC.h': 'the SD memory card', 'FS.h': 'files', 'math.h': 'maths', 'Arduino.h': 'the basic Arduino commands',
  };
  const PINWORD = /^(?:[A-Z][A-Z0-9_]*|\d+)$/;
  const secs = (ms) => { const n = Number(ms); if (!Number.isFinite(n)) return `${ms} milliseconds`; if (n >= 1000) return `${+(n / 1000).toFixed(2)} second${n === 1000 ? '' : 's'}`; return `${n} millisecond${n === 1 ? '' : 's'} (${+(n / 1000).toFixed(3)} s)`; };
  const pinName = (p, names) => { p = String(p).trim(); if (/^\d+$/.test(p)) return `pin ${p}`; return names[p] != null ? `pin ${names[p]} ("${p}")` : `the pin called "${p}"`; };
  // a condition in words: (digitalRead(BTN) == LOW && dist < 20) → "pin 4 ("BTN") reads LOW and dist is less than 20"
  // drop grouping brackets "( … )" but keep call brackets like digitalRead( … )
  function ungroup(c) {
    const st = [], drop = new Set();
    for (let i = 0; i < c.length; i++) { if (c[i] === '(') st.push([i, i > 0 && /[\w]/.test(c[i - 1])]); else if (c[i] === ')') { const o = st.pop(); if (o && !o[1]) { drop.add(o[0]); drop.add(i); } } }
    return [...c].filter((_, i) => !drop.has(i)).join('');
  }
  function words(c, names) {
    return ungroup(String(c).trim())
      .replace(/digitalRead\(\s*([^)]+)\)/g, (m, p) => `${pinName(p, names)} reads`)
      .replace(/analogRead\(\s*([^)]+)\)/g, (m, p) => `the level on ${pinName(p, names)}`)
      .replace(/millis\(\)/g, 'the time since start (ms)')
      .replace(/\s*==\s*/g, ' is ').replace(/\s*!=\s*/g, ' is not ').replace(/\s*>=\s*/g, ' is at least ').replace(/\s*<=\s*/g, ' is at most ')
      .replace(/\s*>\s*/g, ' is more than ').replace(/\s*<\s*/g, ' is less than ').replace(/\s*&&\s*/g, ' and ').replace(/\s*\|\|\s*/g, ' or ')
      .replace(/!\s*(\w)/g, 'not $1').replace(/\bHIGH\b/g, 'HIGH (on)').replace(/\bLOW\b/g, 'LOW (off / pressed)').replace(/\btrue\b/g, 'yes').replace(/\bfalse\b/g, 'no')
      .replace(/\s+/g, ' ').replace(/ reads is not /g, ' does not read ').replace(/ reads is /g, ' reads ').replace(/^\((.*)\)$/, '$1');
  }
  // "if (a && (b)) rest" → ["a && (b)", "rest"]  (the condition up to its matching bracket)
  function cond(t) {
    const i = t.indexOf('(');
    if (i < 0) return null;
    let d = 0;
    for (let k = i; k < t.length; k++) { if (t[k] === '(') d++; else if (t[k] === ')' && --d === 0) return [t.slice(i + 1, k), t.slice(k + 1).trim()]; }
    return null;
  }
  // one statement → a sentence (or null)
  function sentence(s, names, ctx) {
    let m;
    s = s.trim();
    if ((m = s.match(/^pinMode\(\s*([^,]+),\s*(\w+)\s*\)/))) {
      const p = pinName(m[1], names);
      if (m[2] === 'OUTPUT') return `Make ${p} an output: the board will switch it on and off (for an LED, buzzer, relay or motor driver).`;
      if (m[2] === 'INPUT_PULLUP') return `Make ${p} an input for a button or switch: it reads HIGH when nothing is pressed and LOW when pressed (wire the button between the pin and GND).`;
      if (m[2] === 'INPUT_PULLDOWN') return `Make ${p} an input that reads LOW until something connects it to 3.3 V.`;
      return `Make ${p} an input: the board will read it (a sensor or button).`;
    }
    if ((m = s.match(/^digitalWrite\(\s*([^,]+),\s*([^)]+)\)/))) { const v = m[2].trim(); return v === 'HIGH' ? `Switch ${pinName(m[1], names)} ON (3.3 V comes out).` : v === 'LOW' ? `Switch ${pinName(m[1], names)} OFF (0 V).` : `Set ${pinName(m[1], names)} to ${words(v, names)}.`; }
    if ((m = s.match(/^(?:analogWrite|ledcWrite)\(\s*([^,]+),\s*([^)]+)\)/))) return `Give ${pinName(m[1], names)} part power: ${m[2].trim()} out of 255 (0 = off, 255 = full) — used for dimming LEDs and motor speed.`;
    if ((m = s.match(/^delay\(\s*([^)]+)\)/))) return `Wait ${secs(m[1])}. The board does nothing else meanwhile.`;
    if ((m = s.match(/^delayMicroseconds\(\s*([^)]+)\)/))) return `Wait ${m[1]} microseconds (millionths of a second).`;
    if ((m = s.match(/^Serial\.begin\(\s*(\d+)/))) return `Start sending messages to the PC over the USB cable (speed ${m[1]} — set the same in 📟 Serial).`;
    if ((m = s.match(/^Serial\.print(ln|f)?\((.*)\)$/))) return `Send a message to the PC: ${m[2].length > 60 ? m[2].slice(0, 57) + '…' : m[2]} (see it in 📟 Serial${m[1] === 'ln' ? ', then a new line' : ''}).`;
    if ((m = s.match(/^(\w+)\.attach\(\s*([^,)]+)/)) && ctx.servos.has(m[1])) return `The servo "${m[1]}" has its signal wire (orange/yellow) on ${pinName(m[2], names)}.`;
    if ((m = s.match(/^(\w+)\.write\(\s*([^)]+)\)/)) && ctx.servos.has(m[1])) return `Turn the servo "${m[1]}" to ${m[2].trim()} degrees (0 = one end, 90 = middle, 180 = other end).`;
    if ((m = s.match(/^tone\(\s*([^,]+),\s*([^,)]+)(?:,\s*([^)]+))?\)/))) return `Beep on ${pinName(m[1], names)} at ${m[2].trim()} Hz (higher number = higher sound)${m[3] ? ` for ${secs(m[3])}` : ''}.`;
    if ((m = s.match(/^noTone\(\s*([^)]+)\)/))) return `Stop the beep on ${pinName(m[1], names)}.`;
    if ((m = s.match(/^WiFi\.begin\(\s*([^,)]+)/))) return `Join the Wi-Fi network ${m[1].trim()} (name and password).`;
    if ((m = s.match(/^WiFi\.softAP\(\s*([^,)]+)/))) return `Make its own Wi-Fi hotspot called ${m[1].trim()} — phones and PCs can connect to it directly.`;
    if (/^WiFi\.mode\(/.test(s)) return 'Choose how Wi-Fi works (join a network, make a hotspot, or both).';
    if ((m = s.match(/^Wire\.begin\(\s*([^,)]*)(?:,\s*([^)]+))?\)/))) return m[1] ? `Start the I2C bus for sensors: SDA (data) on ${pinName(m[1], names)}, SCL (clock) on ${pinName(m[2], names)}.` : 'Start the I2C bus for sensors (on the board\'s usual SDA and SCL pins).';
    if (/^esp_camera_init\(/.test(s) || /=\s*esp_camera_init\(/.test(s)) return 'Start the camera with the settings above.';
    if ((m = s.match(/^(\w+)\.on\(\s*"([^"]+)"/))) return `When someone opens the web address ${m[2]} on the board, run the code given here.`;
    if (/httpd_register_uri_handler/.test(s)) return 'Add a web address the board answers (a command or a page).';
    if ((m = s.match(/^(\w+)\.begin\(\s*"([^"]+)"/)) && ctx.prefs.has(m[1])) return `Open the permanent memory drawer "${m[2]}" (things saved here survive power-off).`;
    if ((m = s.match(/^(\w+)\.put\w*\(\s*"([^"]+)"/)) && ctx.prefs.has(m[1])) return `Save "${m[2]}" in the permanent memory.`;
    if ((m = s.match(/^(\w+)\s*=\s*(\w+)\.get\w*\(\s*"([^"]+)"/)) && ctx.prefs.has(m[2])) return `Load "${m[3]}" from the permanent memory into ${m[1]}.`;
    if (/^ESP\.restart\(\)/.test(s)) return 'Restart the board.';
    if ((m = s.match(/^(\w+)\s*=\s*digitalRead\(\s*([^)]+)\)/))) return `Read ${pinName(m[2], names)} (HIGH = on, LOW = off/pressed) and remember it as ${m[1]}.`;
    if ((m = s.match(/^(?:int|long|float|uint\w*)?\s*(\w+)\s*=\s*analogRead\(\s*([^)]+)\)/))) return `Measure the voltage on ${pinName(m[2], names)} as a number from 0 (0 V) to 4095 (3.3 V) and remember it as ${m[1]}.`;
    if ((m = s.match(/^(?:int|long|float|uint\w*)?\s*(\w+)\s*=\s*map\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/))) return `Convert ${m[2].trim()} from the range ${m[3].trim()}…${m[4].trim()} to ${m[5].trim()}…${m[6].trim()} and call it ${m[1]}.`;
    if ((m = s.match(/^(?:unsigned long|long|int)?\s*(\w+)\s*=\s*millis\(\)/))) return `Remember the time now (milliseconds since start) as ${m[1]}.`;
    if ((m = s.match(/^(\w+)\s*\+\+$/)) || (m = s.match(/^(\w+)\s*\+=\s*1$/))) return `Add 1 to ${m[1]}.`;
    if ((m = s.match(/^(\w+)\s*=\s*!\s*\1$/))) return `Flip ${m[1]} (yes becomes no, no becomes yes).`;
    if (/^return\b/.test(s)) return null;
    if (/^break$/.test(s)) return 'Stop repeating here (leave the loop).';
    return null;
  }

  function explain(src) {
    const lines = String(src || '').split('\n');
    const out = [], names = {}, pins = {}, libs = [], ctx = { servos: new Set(), prefs: new Set() };
    let wifi = false, serial = false, web = false, cam = false, depth = 0, inBlock = false, fn = '';
    // first pass: names for pins and objects
    for (const raw of lines) {
      const t = raw.replace(/\/\/.*$/, '').trim();
      let m;
      if ((m = t.match(/^#define\s+(\w+)\s+(-?\d+)\b/)) || (m = t.match(/^(?:static\s+)?(?:const(?:expr)?\s+)?(?:int|uint8_t|byte|int8_t|gpio_num_t)\s+(\w+)\s*=\s*(-?\d+)\s*;/))) names[m[1]] = Number(m[2]);
      if ((m = t.match(/^(?:Servo)\s+(\w+)/))) ctx.servos.add(m[1]);
      if ((m = t.match(/^Preferences\s+(\w+)/))) ctx.prefs.add(m[1]);
    }
    lines.forEach((raw, i) => {
      const n = i + 1;
      let t = raw.trim(), m;
      if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
      if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return; }
      const code = t.replace(/\/\/.*$/, '').trim();
      const note = (text, kind = '') => out.push({ line: n, text, kind });
      const tail = (rest) => { rest = rest.replace(/^\{/, '').replace(/\}\s*$/, '').trim(); if (!rest) return ''; if (/^return\b/.test(rest)) return ' stop here (skip the rest of this part).'; const x = sentence(rest.replace(/;\s*$/, ''), names, ctx); return x ? ` ${x}` : ' (do the step written after it)'; };
      if (!code) return;
      if ((m = code.match(/^#include\s*([<"])([^>"]+)[>"]/))) {
        const f = m[2], what = LIBS[f], nm = f.replace(/\.h$/, '');
        libs.push(f);
        note(what ? `Uses the ${nm} library: ready-made code for ${what}.` : /\/|^esp_|^freertos|^driver|^soc|^lwip|^nvs|^rom|^ESPmDNS|^HTTPClient|^WiFiClient|^Arduino/.test(f) ? `Uses built-in ESP32 system code (${nm}) — comes with the board, nothing to install.` : m[1] === '"' ? `Uses the file ${f} from this project (more of this program's code or settings).` : `Uses the ${nm} library (ready-made code someone else wrote — install it with 📚 Libraries if Compile says it is missing).`, 'lib');
        m = [null, f]; if (/WiFi/.test(m[1])) wifi = true; if (/camera/.test(m[1])) cam = true; return;
      }
      if ((m = code.match(/^#define\s+(\w+)\s+(.+)$/))) { const v = m[2].trim(); note(PINWORD.test(v) && /PIN|LED|BTN|BUTTON|SERVO|BUZZ|TRIG|ECHO|SDA|SCL|EN|IN\d|MOTOR|RELAY|SENSOR/i.test(m[1]) ? `The name ${m[1]} means pin ${v} — change the number here if you wire it to another pin.` : `The name ${m[1]} means ${v}.`, 'name'); if (/PIN|LED|BTN|BUTTON|SERVO|BUZZ|TRIG|ECHO|SDA|SCL/i.test(m[1]) && /^\d+$/.test(v)) pins[v] = m[1]; return; }
      if ((m = code.match(/^(?:static\s+)?(?:const(?:expr)?\s+)?(?:int|uint8_t|byte|int8_t|gpio_num_t)\s+(\w+)\s*=\s*(-?\d+)\s*;/)) && depth === 0) { note(/PIN|LED|BTN|BUTTON|SERVO|BUZZ|TRIG|ECHO|SDA|SCL|EN|MOTOR|RELAY|SENSOR/i.test(m[1]) ? `The name ${m[1]} means pin ${m[2]} — change the number here if you wire it to another pin.` : `${m[1]} starts as ${m[2]}.`, 'name'); if (/PIN|LED|BTN|BUTTON|SERVO|BUZZ|TRIG|ECHO|SDA|SCL/i.test(m[1])) pins[m[2]] = m[1]; return; }
      if ((m = code.match(/^Servo\s+(\w+)\s*;/))) { note(`A servo motor called "${m[1]}".`, 'name'); return; }
      // steps written on the same line after "{" (void loop() { digitalWrite(…); delay(…); })
      const inline = () => { const i = code.indexOf('{'); if (i < 0) return; for (const st of code.slice(i + 1).split(/;\s*/).map((x) => x.replace(/\}\s*$/, '').trim()).filter(Boolean)) { const x = sentence(st, names, ctx); if (x) note(x); } };
      if ((m = code.match(/^void\s+setup\s*\(\s*\)/))) { fn = 'setup'; note('▶ setup: the steps below run ONCE, when the board switches on or restarts.', 'part'); inline(); }
      else if ((m = code.match(/^void\s+loop\s*\(\s*\)/))) { fn = 'loop'; note('🔁 loop: the steps below run again and again, forever, as long as the board has power.', 'part'); inline(); }
      else if (depth === 0 && (m = code.match(/^(?:static\s+)?(?:void|int|bool|float|long|String|esp_err_t|uint\w+|double)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/))) { fn = m[1]; note(`🧩 ${m[1]}: a helper with its own steps; they run each time the code says ${m[1]}(…).`, 'part'); }
      else if (/^(?:\}\s*)?else\s+if\s*\(/.test(code) && (m = cond(code))) note(`…otherwise, if ${words(m[0], names)}:${tail(m[1])}`, 'flow');
      else if (/^(?:\}\s*)?else\s*\{?$/.test(code)) note('…otherwise (if not):', 'flow');
      else if (/^if\s*\(/.test(code) && (m = cond(code))) note(`If ${words(m[0], names)}:${tail(m[1])}`, 'flow');
      else if ((m = code.match(/^for\s*\(\s*(?:int|byte|uint8_t)?\s*(\w+)\s*=\s*([^;]+);\s*\1\s*(<=?)\s*([^;]+);\s*\1(\+\+|\s*\+=\s*\d+)\s*\)/))) {
        const from = m[2].trim(), to = m[4].trim(), count = /^\d+$/.test(from) && /^\d+$/.test(to) && m[5] === '++' ? Number(to) - Number(from) + (m[3] === '<=' ? 1 : 0) : null;
        const last = Number(to) - (m[3] === '<' ? 1 : 0), seq = count != null && count <= 5 ? Array.from({ length: count }, (_, k) => Number(from) + k).join(', ') : `${from}, ${Number(from) + 1}, … ${last}`;
        const body = ((cond(code) || [])[1] || '').replace(/^\{/, '').replace(/\}\s*$/, '').split(/;\s*/).map((x) => x.trim()).filter(Boolean).map((x) => sentence(x, names, ctx)).filter(Boolean);
        note((count != null ? `Repeat ${count} times (${m[1]} counts ${seq}):` : `Repeat, with ${m[1]} going from ${from} up to ${to}:`) + (body.length ? ` ${body.join(' Then: ')}` : ''), 'flow');
      }
      else if (/^while\s*\(/.test(code) && (m = cond(code))) note(m[0].trim() === 'true' || m[0].trim() === '1' ? 'Repeat forever:' : `Keep repeating as long as ${words(m[0], names)}:${tail(m[1])}`, 'flow');
      else {
        for (const st of code.split(/;\s*/).map((x) => x.replace(/^\}\s*/, '').replace(/\s*\}$/, '').trim()).filter(Boolean)) {
          const s = sentence(st, names, ctx);
          if (s) note(s);
        }
      }
      if (/Serial\.begin/.test(code)) serial = true;
      if (/WiFi\.(begin|softAP)/.test(code)) wifi = true;
      if (/server\.on|httpd_register_uri_handler|httpd_start/.test(code)) web = true;
      if (/esp_camera_init/.test(code)) cam = true;
      if ((m = code.match(/pinMode\(\s*(\w+)/))) { const g = /^\d+$/.test(m[1]) ? m[1] : names[m[1]]; if (g != null && !pins[g]) pins[g] = /^\d+$/.test(m[1]) ? 'used' : m[1]; }
      depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
    });
    const uses = [];
    const pinList = Object.entries(pins).map(([g, nm]) => (nm === 'used' ? `pin ${g}` : `pin ${g} (${nm})`));
    if (pinList.length) uses.push(`pins ${pinList.join(', ').replace(/pin /g, '')}`);
    if (ctx.servos.size) uses.push(`${ctx.servos.size} servo${ctx.servos.size > 1 ? 's' : ''}`);
    if (wifi) uses.push('Wi-Fi'); if (web) uses.push('a web server'); if (cam) uses.push('the camera'); if (serial) uses.push('messages to the PC over USB');
    if (ctx.prefs.size) uses.push('the permanent memory');
    const summary = uses.length ? `This program uses ${uses.join(', ')}.` : 'This program does not use any pins yet.';
    return { summary, notes: out, libs };
  }
  const api = { explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MCexplain = api;
})(typeof window !== 'undefined' ? window : globalThis);
