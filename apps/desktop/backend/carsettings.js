// Car Settings + Health check for the Baby Carpathron firmware (2.2+): what every setting means, the checks before a
// change is sent, and how the car's self-test (/diag) is turned into "healthy / suspicious / not responding" with the
// likely cause and what to try. The car checks every value again itself (firmware: checkSetting), so a wrong value can
// never be saved, but here the reasons are explained in plain words and boot-pin warnings can be shown first.
'use strict';
const http = require('http');
const { BOARDS, checkPins } = require('./boards');

// ------------------------------------------------------------------ the settings, as the person sees them
// kind: pin | bool | int | select | text | password ; restart: applied at the next start ; test: a button next to it
const GROUPS = [
  { id: 'motors', title: 'Motors', intro: 'How the L298N motor driver is wired and how much power the wheels get.', fields: [
    { key: 'rEn', kind: 'pin', label: 'Right wheels: speed pin (ENA)', restart: true, need: 'pwm', help: 'The pin that sets how fast the right wheels turn (PWM). Kit wiring: GPIO 12.', test: 'right' },
    { key: 'rFwd', kind: 'pin', label: 'Right wheels: forward pin (IN1)', restart: true, need: 'out', help: 'HIGH = right wheels go forward. Kit wiring: GPIO 13.' },
    { key: 'rBack', kind: 'pin', label: 'Right wheels: backward pin (IN2)', restart: true, need: 'out', help: 'HIGH = right wheels go backward. Kit wiring: GPIO 14.' },
    { key: 'lEn', kind: 'pin', label: 'Left wheels: speed pin (ENB)', restart: true, need: 'pwm', help: 'The pin that sets how fast the left wheels turn (PWM). Kit wiring: GPIO 2.', test: 'left' },
    { key: 'lFwd', kind: 'pin', label: 'Left wheels: forward pin (IN3)', restart: true, need: 'out', help: 'HIGH = left wheels go forward. Kit wiring: GPIO 15.' },
    { key: 'lBack', kind: 'pin', label: 'Left wheels: backward pin (IN4)', restart: true, need: 'out', help: 'HIGH = left wheels go backward. Kit wiring: GPIO 33.' },
    { key: 'invL', kind: 'bool', label: 'Left wheels turn the wrong way', help: 'Turn on when "forward" makes the left wheels go backward (motor wires swapped). Same as swapping the two motor wires.' },
    { key: 'invR', kind: 'bool', label: 'Right wheels turn the wrong way', help: 'Turn on when "forward" makes the right wheels go backward.' },
    { key: 'swap', kind: 'bool', label: 'Left and right are swapped', help: 'Turn on when steering left makes the car go right: the two motor driver outputs are swapped.' },
    { key: 'minDuty', kind: 'int', label: 'Lowest power that moves the wheels', unit: '/ 255', help: 'Below this the TT motors only hum. The lowest speed (1 %) gets this power, 100 % gets 255. Raise it if the car does not start at low speed; the calibration wizard measures it.', step: 5 },
    { key: 'maxPct', kind: 'int', label: 'Top speed limit', unit: '%', help: 'Every speed is scaled down to this. 60 % is a good start for small rooms and beginners.', step: 5 },
    { key: 'trim', kind: 'int', label: 'Straight-driving trim', unit: '%', help: 'When the car pulls to one side while driving straight: raise it if it drifts left (more power to the left wheels), lower it if it drifts right. The calibration wizard measures it with the gyro.' },
    { key: 'pwmHz', kind: 'int', label: 'Motor PWM frequency', unit: 'Hz', restart: true, help: 'How often per second the speed pins switch. 1000 Hz (the kit default) gives TT motors the most force; higher is quieter but weaker on the L298N.', step: 100 },
  ] },
  { id: 'driving', title: 'Driving and safety', intro: 'How the car protects itself and the room.', fields: [
    { key: 'stopMm', kind: 'int', label: 'Stop distance in front', unit: 'mm', help: 'With the laser sensor, the car refuses to drive forward when something is closer than this. 0 = off. 150 mm stops before a wall even at full speed.', step: 10 },
    { key: 'failMs', kind: 'int', label: 'Stop when the connection is lost after', unit: 'ms', help: 'The car stops when no command arrives for this long (app closed, Wi-Fi gone). Lower = safer, but a weak Wi-Fi may then stop the car while you drive.', step: 100 },
    { key: 'turnSpd', kind: 'int', label: 'Gyro turn speed', unit: '%', help: 'Power used for exact turns ("turn right 90°"). It slows down by itself near the end.', step: 5 },
  ] },
  { id: 'camera', title: 'Camera', intro: 'The picture: size, sharpness, orientation and colours. Changes show at once in the live video.', fields: [
    { key: 'frame', kind: 'select', label: 'Picture size', options: [[0, '320 × 240 (fastest)'], [1, '480 × 320'], [2, '640 × 480 (default)'], [3, '800 × 600'], [4, '1024 × 768 (slowest)']], help: 'Bigger pictures show more detail to the AI but the video gets slower on weak Wi-Fi.' },
    { key: 'sQual', kind: 'int', label: 'Live video quality', unit: '(lower = sharper)', help: 'JPEG quality of the live video, 6 (sharp, big) to 40 (blurry, small). 16 suits most Wi-Fi.' },
    { key: 'pQual', kind: 'int', label: 'Photo quality', unit: '(lower = sharper)', help: 'JPEG quality of photos for the AI and WhatsApp, 4 to 40. 10 is sharp.' },
    { key: 'vflip', kind: 'bool', label: 'Flip the picture upside down', help: 'Turn off if the video is upside down (some ESP32-CAM V0.3 boards).' },
    { key: 'hmirror', kind: 'bool', label: 'Mirror the picture', help: 'Turn off if left and right look swapped in the video.' },
    { key: 'bright', kind: 'int', label: 'Brightness', help: 'Makes the whole picture darker (-2) or brighter (+2). Use it when the room is very dark or very bright.' },
    { key: 'contr', kind: 'int', label: 'Contrast', help: 'How strongly light and dark parts differ, -2 (flat) to +2 (strong). Raise it in a dim, grey room.' },
    { key: 'satur', kind: 'int', label: 'Colour saturation', help: 'Colour strength, -2 (greyer) to +2 (stronger colours). Stronger colours help the AI find coloured objects.' },
    { key: 'wb', kind: 'select', label: 'White balance', options: [[0, 'Automatic'], [1, 'Sunny'], [2, 'Cloudy'], [3, 'Office (fluorescent)'], [4, 'Home (warm bulbs)']], help: 'If colours look blue or orange, pick the light of the room.' },
    { key: 'ae', kind: 'int', label: 'Exposure correction', help: '-2 (darker) to +2 (brighter), applied on top of the automatic exposure. Raise it when the picture is dark against a window.' },
  ] },
  { id: 'sensors', title: 'Sensors', intro: 'The VL53L0X laser distance sensor and the MPU-6050 gyro on the I2C bus.', fields: [
    { key: 'sda', kind: 'pin', label: 'I2C data pin (SDA)', restart: true, need: 'i2c', help: 'Default GPIO 3 (RXD). On the ESP32-CAM only the serial pins are left for I2C, so the Serial Monitor stops while sensors are connected.' },
    { key: 'scl', kind: 'pin', label: 'I2C clock pin (SCL)', restart: true, need: 'i2c', help: 'Default GPIO 1 (TXD).' },
    { key: 'tofBud', kind: 'int', label: 'Laser measuring time', unit: 'ms', restart: true, help: 'Longer = steadier and further readings, slower updates. 33 ms (default) gives 30 readings per second.' },
    { key: 'tofOff', kind: 'int', label: 'Laser offset', unit: 'mm', help: 'Subtracted from every reading. The calibration wizard measures it with a target at a known distance.' },
    { key: 'gScale', kind: 'int', label: 'Gyro scale', unit: '/ 1000', help: '1000 = as measured. If a 360° turn ends short, raise it slightly; the calibration wizard measures it with the camera.' },
  ] },
  { id: 'light', title: 'Light', intro: 'The white flash LED on the ESP32-CAM (GPIO 4).', fields: [
    { key: 'ledMax', kind: 'int', label: 'Headlight brightness limit', unit: '/ 255', help: 'The LED gets hot at full power for long. 120 is plenty for driving in the dark.', step: 5 },
  ] },
  { id: 'network', title: 'Name and hotspot', intro: 'How the car shows itself.', fields: [
    { key: 'name', kind: 'text', label: 'Robot name', help: 'Shown in the app and on the car\'s own web page. Up to 31 characters.' },
    { key: 'apSsid', kind: 'text', label: 'Hotspot name', restart: true, help: 'The car makes this Wi-Fi when your Wi-Fi is not reachable (first start). Different names help when several cars are in one room.' },
    { key: 'apPass', kind: 'password', label: 'Hotspot password', restart: true, help: '8 to 63 characters. Default: carpathron.' },
  ] },
];
const STRING_KEYS = new Set(['name', 'apSsid', 'apPass']);
const FIELDS = Object.fromEntries(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, { ...f, group: g.id }])));
// the car reports lo/hi itself? No: the firmware table is the source; these mirror it for the form (keep in sync with carpathron_car.ino)
const RANGES = { rEn: [0, 39], rFwd: [0, 39], rBack: [0, 39], lEn: [0, 39], lFwd: [0, 39], lBack: [0, 39], invL: [0, 1], invR: [0, 1], swap: [0, 1], pwmHz: [100, 20000], minDuty: [0, 255], maxPct: [20, 100], trim: [-25, 25], failMs: [300, 10000], stopMm: [0, 1000], turnSpd: [50, 100], vflip: [0, 1], hmirror: [0, 1], frame: [0, 4], sQual: [6, 40], pQual: [4, 40], bright: [-2, 2], contr: [-2, 2], satur: [-2, 2], wb: [0, 4], ae: [-2, 2], sda: [0, 39], scl: [0, 39], tofBud: [20, 200], tofOff: [-100, 100], gScale: [900, 1100], ledMax: [0, 255] };
const DEFAULTS = { rEn: 12, rFwd: 13, rBack: 14, lEn: 2, lFwd: 15, lBack: 33, invL: 0, invR: 0, swap: 0, pwmHz: 1000, minDuty: 150, maxPct: 100, trim: 0, failMs: 2500, stopMm: 150, turnSpd: 70, vflip: 1, hmirror: 1, frame: 2, sQual: 16, pQual: 10, bright: 0, contr: 0, satur: 0, wb: 0, ae: 0, sda: 3, scl: 1, tofBud: 33, tofOff: 0, gScale: 1000, ledMax: 255, name: 'Baby Carpathron', apSsid: 'Carpathron-Car' };
for (const [k, r] of Object.entries(RANGES)) if (FIELDS[k]) Object.assign(FIELDS[k], { min: r[0], max: r[1], def: DEFAULTS[k] });
for (const k of STRING_KEYS) if (FIELDS[k]) FIELDS[k].def = DEFAULTS[k] || '';
const PIN_KEYS = Object.values(FIELDS).filter((f) => f.kind === 'pin').map((f) => f.key);

// Check one change against the board before sending it. → { errors: [..], warnings: [..] }
function check(values, key, value, board = BOARDS.esp32cam) {
  const f = FIELDS[key];
  if (!f) return { errors: [`Unknown setting "${key}".`], warnings: [] };
  if (STRING_KEYS.has(key)) {
    const v = String(value == null ? '' : value).trim();
    if (key === 'apPass' && (v.length < 8 || v.length > 63)) return { errors: ['The hotspot password needs 8 to 63 characters.'], warnings: [] };
    if (!v.length || v.length > 31) return { errors: ['Use 1 to 31 characters.'], warnings: [] };
    return { errors: [], warnings: [] };
  }
  const n = Number(value);
  if (!Number.isInteger(n)) return { errors: [`${f.label}: a whole number is needed.`], warnings: [] };
  if (n < f.min || n > f.max) return { errors: [`${f.label} must be between ${f.min} and ${f.max}.`], warnings: [] };
  if (f.kind !== 'pin') return { errors: [], warnings: [] };
  const assign = {};
  for (const k of PIN_KEYS) assign[k] = Number(k === key ? n : values[k]);
  assign.headlight = 4; // fixed on the ESP32-CAM
  const needs = Object.fromEntries(PIN_KEYS.map((k) => [k, FIELDS[k].need]));
  const res = checkPins(board, assign, { needs }).filter((r) => r.name === key && !/already used/.test(r.message));
  const other = PIN_KEYS.find((k) => k !== key && Number(values[k]) === n);
  if (other) res.unshift({ level: 'error', message: `GPIO ${n} is already used by "${FIELDS[other].label}".` });
  else if (n === 4 && board.id === 'esp32cam') res.unshift({ level: 'error', message: 'GPIO 4 drives the white headlight.' });
  // the firmware only allows the pins left free by the camera
  if (board.id === 'esp32cam' && n !== 4 && ![1, 2, 3, 12, 13, 14, 15, 33].includes(n)) res.unshift({ level: 'error', message: `GPIO ${n} is not free on the ESP32-CAM. Free pins: 1, 2, 3, 12, 13, 14, 15, 33.` });
  return { errors: [...new Set(res.filter((r) => r.level === 'error').map((r) => r.message))], warnings: [...new Set(res.filter((r) => r.level === 'warn').map((r) => r.message))] };
}

// ------------------------------------------------------------------ talking to the car
function carJson(ip, pathAndQuery, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const [h, port] = String(ip).split(':');
    const req = http.get({ host: h, port: Number(port) || 80, path: pathAndQuery, timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 65536) body += d; });
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error('The car does not know this yet: update its firmware to 2.2 (Robot → Setup → Update car firmware).'));
        if (res.statusCode >= 400) return reject(new Error(`The car answered HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('The car sent an answer that is not JSON (older firmware?). Update the car firmware to 2.2.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The car did not answer in time (is it on and on the same Wi-Fi?)')));
    req.on('error', (e) => reject(new Error(/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(e.message) ? 'The car is not reachable: is it switched on and on the same Wi-Fi?' : e.message)));
  });
}
const getSettings = (ip) => carJson(ip, '/settings');
// Several numbers at once, checked together on the car (so two pins can swap places).
async function setMany(ip, changes) {
  const parts = Object.entries(changes).filter(([k]) => !STRING_KEYS.has(k)).map(([k, v]) => `${k}:${Math.round(Number(v))}`);
  if (!parts.length) return getSettings(ip);
  const r = await carJson(ip, `/settings?many=${encodeURIComponent(parts.join(','))}`);
  if (r.ok === false) throw new Error(r.error || 'refused by the car');
  return r;
}
// Check a set of changes together. → { errors: {key: [..]}, warnings: {key: [..]}, ok }
function checkAll(values, changes, board = BOARDS.esp32cam) {
  const merged = { ...values, ...changes }, errors = {}, warnings = {};
  for (const [k, v] of Object.entries(changes)) {
    const r = check(merged, k, v, board);
    if (r.errors.length) errors[k] = r.errors;
    if (r.warnings.length) warnings[k] = r.warnings;
  }
  return { errors, warnings, ok: !Object.keys(errors).length };
}
async function setSetting(ip, key, value) {
  const q = STRING_KEYS.has(key) ? `s=${encodeURIComponent(String(value))}` : `v=${Math.round(Number(value))}`;
  const r = await carJson(ip, `/settings?set=${encodeURIComponent(key)}&${q}`);
  if (r.ok === false) throw new Error(r.error || 'refused by the car');
  return r;
}
const restart = (ip) => carJson(ip, '/settings?restart=1', 3000).catch(() => ({ ok: true, restarting: true }));
const factoryReset = (ip) => carJson(ip, '/settings?reset=1', 3000).catch(() => ({ ok: true, restarting: true }));
const runDiag = (ip, { motors = false } = {}) => carJson(ip, `/diag${motors ? '?motors=1' : ''}`, motors ? 15000 : 10000);

// ------------------------------------------------------------------ health: the self-test in plain words
// status: ok | warn | bad | info | skip
const CAMERA_ERRORS = {
  0x105: ['The camera was not found.', 'Check that the camera ribbon cable is pushed fully into its socket (latch closed), that the board is "AI Thinker ESP32-CAM", and that it gets a steady 5 V.'],
  0x20001: ['The camera chip did not answer.', 'Reseat the ribbon cable; a cracked cable or a dead camera module are the next suspects.'],
  0x20002: ['The camera refused the picture size.', 'Pick a smaller picture size in Car Settings → Camera.'],
  0x20003: ['The camera refused the picture format.', 'Update the car firmware; if it stays, the camera module is not an OV2640.'],
  0x20004: ['This camera model is not supported.', 'Use an OV2640 camera module.'],
  0x103: ['Not enough memory to start the camera.', 'The PSRAM was not found: in the Firmware studio pick the board "AI Thinker ESP32-CAM" (PSRAM on) and upload again.'],
};
function health(d, { settings, robotTurnMs } = {}) {
  const items = [];
  const add = (part, status, title, detail = '', fix = '', data = null) => items.push({ part, status, title, detail, fix, data });
  // camera
  const c = d.camera || {};
  if (c.ok) add('camera', c.fps >= 4 ? 'ok' : 'warn', c.fps >= 4 ? `Camera works (${c.fps} pictures per second)` : `Camera is slow (${c.fps} pictures per second)`,
    `Sensor id 0x${Number(c.pid || 0).toString(16)}${Number(c.pid) === 0x26 ? ' (OV2640)' : ''}.`, c.fps >= 4 ? '' : 'A smaller picture size or a weaker video quality makes it faster; so does a stronger Wi-Fi signal.');
  else { const e = CAMERA_ERRORS[c.error] || ['The camera did not start.', 'Reseat the camera ribbon cable and power the board with a steady 5 V.']; add('camera', 'bad', e[0], `Error code 0x${Number(c.error || 0).toString(16)}.`, e[1]); }
  // memory
  const m = d.memory || {};
  add('memory', m.psram ? 'ok' : 'warn', m.psram ? `Extra memory found (${Math.round((m.psramFree || 0) / 1024)} KB free)` : 'No extra memory (PSRAM) found',
    `Free working memory: ${Math.round((m.heapFree || 0) / 1024)} KB.`, m.psram ? '' : 'The firmware was uploaded for a board without PSRAM: pick "AI Thinker ESP32-CAM" in the Firmware studio and upload again. Photos and video are smaller without it.');
  // Wi-Fi
  const w = d.wifi || {};
  if (w.mode === 'hotspot' && !w.connected) add('wifi', 'warn', 'The car runs its own hotspot', 'It could not join your Wi-Fi.', 'Robot → Setup → Wi-Fi, or open http://192.168.4.1/setup from a phone on the "Carpathron-Car" network.');
  else { const r = Number(w.rssi); add('wifi', r >= -60 ? 'ok' : r >= -75 ? 'warn' : 'bad', `Wi-Fi signal ${r} dBm (${r >= -60 ? 'good' : r >= -75 ? 'fair' : 'weak'})`, '', r >= -60 ? '' : 'Video may stutter and the car may stop when the link drops: move the car or the router closer, or lower the picture size.'); }
  // last restart
  const rr = d.reset || {};
  const crash = ['crash', 'watchdog'].includes(rr.name);
  add('power', crash ? 'warn' : 'ok', crash ? 'The car restarted after a crash last time' : `Last start: ${({ 'power-on': 'switched on', software: 'restarted by the app or a setting', 'reset-pin': 'reset button' })[rr.name] || rr.name}`,
    'The car has the brownout restart switched off (motors dip the batteries), so a power dip shows up as a stutter or a crash, not as its own reason.', crash ? 'If it happens while the motors start: charge the 18650 batteries or use fresh ones; otherwise tell Muse what you were doing.' : '');
  // I2C bus
  const i = d.i2c || {};
  const devs = i.devices || [];
  const known = { 0x29: 'VL53L0X laser', 0x68: 'MPU-6050 gyro', 0x69: 'MPU-6050 gyro (AD0 high)', 0x3c: 'OLED display', 0x40: 'PCA9685 servo driver', 0x48: 'ADS1115 analog converter', 0x76: 'BME280 / BMP280', 0x77: 'BME280 / BMP280', 0x27: 'LCD backpack', 0x57: 'EEPROM' };
  if (i.mode === 'off') add('i2c', 'skip', 'Sensors are switched off (sensor mode "none")');
  else if (i.mode === 'ir') add('i2c', 'info', 'Sensor mode: IR obstacle modules', `Left ${d.ir && d.ir.left ? 'sees an obstacle' : 'free'}, right ${d.ir && d.ir.right ? 'sees an obstacle' : 'free'}.`, 'Hold a hand in front of each module: its value should change.');
  else if (!i.active) add('i2c', 'info', 'No I2C sensors answered at start', `Looked on GPIO ${i.sda} (SDA) / ${i.scl} (SCL).`, 'If a VL53L0X or MPU-6050 is connected: check SDA/SCL are not swapped, 3V3 and GND are connected, then restart the car.');
  else add('i2c', 'ok', `I2C bus: ${devs.length} device${devs.length === 1 ? '' : 's'} found`, devs.map((a) => `0x${a.toString(16)}${known[a] ? ` ${known[a]}` : ' (unknown part)'}`).join(', '), '');
  // laser
  const t = d.tof || {};
  if (t.ok) {
    const noisy = t.samples > 3 && t.sd > Math.max(10, t.mean * 0.05);
    if (!t.samples) add('tof', 'warn', 'Laser: nothing within 2 m', `${t.outOfRange} readings out of range.`, 'Normal in a big empty space. If a wall is close: the sensor may be covered or its window dirty.');
    else add('tof', noisy ? 'warn' : 'ok', noisy ? `Laser readings are unsteady (${Math.round(t.mean)} mm ± ${t.sd})` : `Laser works: ${Math.round(t.mean)} mm ahead (± ${t.sd} mm)`, `${t.samples} readings, ${t.min}–${t.max} mm; stops ${t.stopMm} mm before obstacles.`, noisy ? 'Point it at a flat wall to compare; shiny or dark surfaces and sunlight make readings jump. A longer laser measuring time steadies them.' : '');
  } else if (i.active && i.mode !== 'ir') add('tof', devs.includes(0x29) ? 'bad' : 'info', devs.includes(0x29) ? 'Laser found on the bus but it does not measure' : 'No laser distance sensor', '', devs.includes(0x29) ? 'Restart the car; if it stays, the VL53L0X module may be damaged.' : 'Optional part: a VL53L0X makes the car stop before obstacles and lets the map use real distances.');
  // gyro
  const g = d.imu || {};
  if (g.ok) {
    const clone = g.whoAmI >= 0 && g.whoAmI !== 0x68;
    const drifting = Math.abs(g.restDps) > 0.5, noisy = g.noiseDps > 0.6;
    add('imu', drifting || noisy ? 'warn' : clone ? 'info' : 'ok', drifting ? 'Gyro drifts while standing still' : noisy ? 'Gyro readings are noisy' : `Gyro works (heading ${Math.round(g.yaw)}°)`,
      `Chip id 0x${Number(g.whoAmI).toString(16)}${clone ? ' (a compatible clone chip — works fine)' : ''}; rest ${g.restDps}°/s, noise ${g.noiseDps}°/s.`,
      drifting ? 'The car moved while it measured its zero at start: restart it standing still (Calibration redoes this).' : noisy ? 'Fix the gyro board firmly to the car: vibrations add noise.' : '');
  } else if (i.active && i.mode !== 'ir') add('imu', 'info', 'No gyro (MPU-6050)', '', 'Optional part: a gyro gives exact turns and the heading for maps.');
  // motors (only when asked: the car moves). Each side alone: left forward pivots the car right (+°), right forward
  // pivots it left (−°). One side wrong → that side is reversed. Both wrong → the sides are swapped, or both are
  // reversed: a short drive with both sides tells them apart (the laser gets closer when the car really goes forward).
  if (d.motors) {
    const res = {};
    for (const side of ['left', 'right']) {
      const r = d.motors[side];
      if (!r) { res[side] = 'none'; continue; }
      const deg = Number(r.turnDeg);
      res[side] = Math.abs(deg) < 6 ? 'dead' : Math.sign(deg) === (side === 'left' ? 1 : -1) ? 'ok' : 'wrong';
    }
    const b = d.motors.both, closer = b && b.distBefore > 0 && b.distAfter > 0 ? b.distBefore - b.distAfter : null;
    const bothWrong = res.left === 'wrong' && res.right === 'wrong';
    for (const side of ['left', 'right']) {
      const r = d.motors[side], name = side === 'left' ? 'Left wheels' : 'Right wheels', inv = `"${side === 'left' ? 'Left' : 'Right'} wheels turn the wrong way"`;
      if (res[side] === 'none') { add(`motor-${side}`, 'info', `${name}: not measured`, 'Needs the gyro to measure the turn.', 'Watch the wheels during the test instead.'); continue; }
      const deg = Number(r.turnDeg), dir = `${Math.abs(deg).toFixed(0)}° ${deg > 0 ? 'right' : 'left'}`;
      if (res[side] === 'dead') add(`motor-${side}`, 'bad', `${name}: did not move`, `The car turned ${deg}°.`, `Check: batteries charged and switch on; the ${side} motor wires on the L298N; the speed pin. If they hum without turning, raise "Lowest power that moves the wheels".`, r);
      else if (res[side] === 'ok') add(`motor-${side}`, 'ok', `${name} work`, `The car turned ${dir}, as expected.`, '', r);
      else {
        let fix;
        if (!bothWrong) fix = `They run backward: turn on ${inv}.`;
        else if (closer != null && closer > 15) fix = 'Left and right are swapped (driving straight still goes forward): turn on "Left and right are swapped".';
        else if (closer != null && closer < -15) fix = 'Both sides run backward: turn on "Left wheels turn the wrong way" and "Right wheels turn the wrong way".';
        else fix = 'Both sides look wrong: either left and right are swapped ("Left and right are swapped") or both run backward (both "turn the wrong way" switches). Drive forward a little: if the car goes forward, it is the swap.';
        add(`motor-${side}`, 'warn', `${name}: turned the wrong way`, `The car turned ${dir}.`, fix, r);
      }
    }
  }
  // boot fix
  const pins = d.pins || {};
  if (Object.values(pins).includes(12)) add('boot', d.bootFix ? 'ok' : 'warn', d.bootFix ? 'Boot fix done (GPIO 12 is safe)' : 'Boot fix not done', 'GPIO 12 drives the right wheels and is also a boot pin.', d.bootFix ? '' : 'If the car sometimes does not start with all wires plugged in: Firmware studio → Serial Monitor → type fixboot (one-time).');
  const order = { bad: 0, warn: 1, info: 2, ok: 3, skip: 4 };
  const summary = items.some((x) => x.status === 'bad') ? 'bad' : items.some((x) => x.status === 'warn') ? 'warn' : 'ok';
  return { summary, items: items.sort((a, b) => order[a.status] - order[b.status]), at: Date.now(), fw: d.fw };
}

module.exports = { GROUPS, FIELDS, STRING_KEYS, DEFAULTS, PIN_KEYS, check, checkAll, carJson, getSettings, setSetting, setMany, restart, factoryReset, runDiag, health };
