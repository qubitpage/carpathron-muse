// Board profiles: what every pin of a board can do, what it must not be used for, and where it sits on the board.
// Used by Car Settings (pin checks), the Health check, the board viewer, the parts library and the AI (board_pins).
// Facts from the vendors' pinouts (Espressif ESP32 / ESP32-S3 GPIO docs, AI-Thinker ESP32-CAM, Seeed XIAO ESP32S3,
// Arduino Uno R3 / Mega2560 Rev3, Raspberry Pi Pico datasheets).
//
// pin = { gpio, label, side, pos, caps, use, level, note }
//   side/pos: header and position on it, for the drawing (L/R = left/right header, T/B = top/bottom; pos from 0)
//   caps:  in, out, pwm, adc, adc2 (blocked while Wi-Fi is on), touch, i2c, uart, spi, dac, int (interrupt)
//   use:   what the board itself uses it for (camera, psram, flash, usb, led, sd, boot…) — null = free
//   level: 'error' = never usable for your own parts, 'warn' = usable with care, null = fine
'use strict';

const P = (gpio, label, side, pos, caps, extra = {}) => ({ gpio, label, side, pos, caps, use: null, level: null, note: '', ...extra });
const PWR = (label, side, pos, note = '') => ({ gpio: null, label, side, pos, caps: ['power'], use: 'power', level: 'error', note });

const ESP32_STRAP = {
  0: 'Boot pin: LOW at power-on starts the upload mode. Leave it free or pulled up while starting.',
  2: 'Boot pin: must be LOW or floating at power-on for uploading.',
  5: 'Boot pin: sets the boot timing; keep it free of pull-downs at power-on.',
  12: 'Boot pin: HIGH at power-on picks 1.8 V flash and the board restarts in a loop (unless the one-time "fix boot" fuse is set).',
  15: 'Boot pin: LOW at power-on silences the boot messages; harmless for most parts.',
};
const ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]);
const ADC1 = new Set([32, 33, 34, 35, 36, 39]);
const TOUCH = new Set([0, 2, 4, 12, 13, 14, 15, 27, 32, 33]);
function esp32caps(g) {
  const c = [];
  const inputOnly = g >= 34 && g <= 39;
  c.push('in'); if (!inputOnly) c.push('out', 'pwm', 'i2c');
  if (ADC1.has(g)) c.push('adc'); if (ADC2.has(g)) c.push('adc2');
  if (TOUCH.has(g)) c.push('touch');
  if (g === 25 || g === 26) c.push('dac');
  c.push('int');
  return c;
}
function esp32pin(g, label, side, pos, extra = {}) {
  const p = P(g, label, side, pos, esp32caps(g), extra);
  if (ESP32_STRAP[g] && !p.use) { p.level = p.level || 'warn'; p.note = [ESP32_STRAP[g], p.note].filter(Boolean).join(' '); }
  if (g >= 34 && g <= 39) p.note = ['Input only: no output, no internal pull-up or pull-down.', p.note].filter(Boolean).join(' ');
  if (g >= 6 && g <= 11) { p.use = 'flash'; p.level = 'error'; p.note = 'Connected to the flash chip inside the module. Never use.'; }
  return p;
}

// ------------------------------------------------------------------ AI-Thinker ESP32-CAM (the Baby Carpathron car)
const camUse = { use: 'camera', level: 'error', note: 'Used by the camera.' };
const esp32cam = {
  id: 'esp32cam', name: 'AI-Thinker ESP32-CAM', fqbn: 'esp32:esp32:esp32cam', chip: 'ESP32 (dual core 240 MHz), 4 MB PSRAM, 4 MB flash',
  logic: 3.3, wifi: true, bluetooth: true, camera: 'OV2640', maxPinMa: 20, absMaxPinMa: 40,
  size: { w: 27, h: 40 }, // mm
  summary: 'Small ESP32 board with a camera and Wi-Fi. The camera uses most pins: only 8 GPIOs are left, and 4 of them are boot pins.',
  limits: [
    'No analog input while Wi-Fi is on: the free pins are ADC2 (blocked by Wi-Fi) and the ADC1 pins belong to the camera.',
    'GPIO 1 / 3 are the USB serial port: using them for sensors stops the Serial Monitor.',
    'Power it with 5 V on the 5V pin; 3.3 V supplies cause camera errors and restarts.',
    'Pins give about 20 mA safely (40 mA absolute maximum): LEDs yes, motors and relays only through a driver.',
  ],
  pins: [
    PWR('5V', 'L', 0, 'Power input: 5 V from the battery regulator or the USB adapter.'),
    PWR('GND', 'L', 1),
    esp32pin(12, 'IO12', 'L', 2, { note: 'SD card data 2 when an SD card is used.' }),
    esp32pin(13, 'IO13', 'L', 3, { note: 'SD card data 3 when an SD card is used. The best spare pin.' }),
    esp32pin(15, 'IO15', 'L', 4, { note: 'SD card command when an SD card is used.' }),
    esp32pin(14, 'IO14', 'L', 5, { note: 'SD card clock when an SD card is used.' }),
    esp32pin(2, 'IO2', 'L', 6, { note: 'SD card data 0 when an SD card is used.' }),
    esp32pin(4, 'IO4', 'L', 7, { use: 'led', level: 'warn', note: 'Drives the bright white flash LED (through a transistor). Also SD card data 1.' }),
    PWR('3V3', 'R', 0, 'Power: 3.3 V output for small sensors (about 300 mA spare at most).'),
    esp32pin(16, 'IO16', 'R', 1, { use: 'psram', level: 'error', note: 'Used by the 4 MB PSRAM memory. Never use.' }),
    esp32pin(0, 'IO0', 'R', 2, { use: 'camera', level: 'error', note: 'Camera clock (XCLK) and the upload-mode button pin. Connect to GND only to upload.' }),
    PWR('GND', 'R', 3),
    PWR('VCC', 'R', 4, 'Power OUTPUT (3.3 V or 5 V by a solder jumper), not an input.'),
    esp32pin(3, 'U0RXD', 'R', 5, { level: 'warn', note: 'GPIO 3, serial RX: the USB serial port. Usable for a sensor (I2C SDA here), but the Serial Monitor stops.' }),
    esp32pin(1, 'U0TXD', 'R', 6, { level: 'warn', note: 'GPIO 1, serial TX: the USB serial port. Usable for a sensor (I2C SCL here), but the Serial Monitor stops.' }),
    PWR('GND', 'R', 7),
    // not on the headers
    esp32pin(33, 'IO33 (LED)', 'X', 0, { use: 'led', level: 'warn', note: 'The small red LED on the back (on when LOW). Not on the header pins; the car kit\'s carrier board reaches it.' }),
    ...[[5, 'Y2'], [18, 'Y3'], [19, 'Y4'], [21, 'Y5'], [36, 'Y6'], [39, 'Y7'], [34, 'Y8'], [35, 'Y9'], [25, 'VSYNC'], [23, 'HREF'], [22, 'PCLK'], [26, 'SIOD'], [27, 'SIOC'], [32, 'PWDN']]
      .map(([g, n], i) => esp32pin(g, `IO${g} (${n})`, 'C', i, { ...camUse, note: `Camera ${n}. Not on the header pins.` })),
  ],
};

// ------------------------------------------------------------------ ESP32 DevKitC (38 pins)
const devkitL = [['3V3', null], ['EN', null], [36, 'VP'], [39, 'VN'], [34], [35], [32], [33], [25], [26], [27], [14], [12], ['GND', null], [13], [9, 'D2'], [10, 'D3'], [11, 'CMD'], ['5V', null]];
const devkitR = [['GND', null], [23], [22], [1, 'TX'], [3, 'RX'], [21], ['GND', null], [19], [18], [5], [17], [16], [4], [0], [2], [15], [8, 'D1'], [7, 'D0'], [6, 'CLK']];
const devPin = (side) => ([a, b], i) => (typeof a === 'string'
  ? PWR(a, side, i, a === 'EN' ? 'Reset (EN): pull LOW to restart the board.' : a === '5V' ? 'Power input 5 V (or USB).' : '')
  : esp32pin(a, b ? `${b} (${a})` : `IO${a}`, side, i, a === 1 || a === 3 ? { level: 'warn', note: 'USB serial port: the Serial Monitor stops if you use it.' } : {}));
const esp32devkit = {
  id: 'esp32devkit', name: 'ESP32 DevKitC (WROOM-32)', fqbn: 'esp32:esp32:esp32', chip: 'ESP32 (dual core 240 MHz), 4 MB flash',
  logic: 3.3, wifi: true, bluetooth: true, camera: null, maxPinMa: 20, absMaxPinMa: 40, size: { w: 28, h: 55 },
  summary: 'The classic ESP32 board: about 20 free pins, Wi-Fi and Bluetooth. Default I2C on 21 (SDA) / 22 (SCL).',
  limits: ['ADC2 pins cannot read analog values while Wi-Fi is on; use 32–39 (ADC1).', 'GPIO 34–39 are inputs only.', 'On WROVER modules GPIO 16 / 17 belong to the PSRAM.'],
  pins: [...devkitL.map(devPin('L')), ...devkitR.map(devPin('R'))],
};

// ------------------------------------------------------------------ Seeed XIAO ESP32S3 Sense (camera)
const xiao = [[1, 'D0'], [2, 'D1'], [3, 'D2'], [4, 'D3'], [5, 'D4'], [6, 'D5'], [43, 'D6'], [44, 'D7'], [7, 'D8'], [8, 'D9'], [9, 'D10']];
const esp32s3 = {
  id: 'xiaoesp32s3', name: 'Seeed XIAO ESP32S3 Sense', fqbn: 'esp32:esp32:XIAO_ESP32S3', chip: 'ESP32-S3 (dual core 240 MHz), 8 MB PSRAM, 8 MB flash',
  logic: 3.3, wifi: true, bluetooth: true, camera: 'OV2640 / OV3660', maxPinMa: 20, absMaxPinMa: 40, size: { w: 21, h: 18 },
  summary: 'Tiny ESP32-S3 with a camera, native USB and 6 free analog-capable pins (D0–D5). A good next brain for a camera robot.',
  limits: ['Boot pins on the S3: GPIO 0, 3, 45, 46 (D2 = GPIO 3).', 'D8–D10 are shared with the SD card slot.', 'The camera pins (10–18, 38–40, 47, 48) are inside the board.'],
  pins: [
    ...xiao.slice(0, 7).map(([g, n], i) => P(g, `${n} (GPIO ${g})`, 'L', i, g <= 6 ? ['in', 'out', 'pwm', 'adc', 'touch', 'i2c', 'int'] : ['in', 'out', 'pwm', 'uart', 'int'],
      g === 3 ? { level: 'warn', note: 'Boot pin on the ESP32-S3: keep it free of pull-downs at power-on.' } : g === 5 ? { note: 'Default I2C SDA.' } : g === 6 ? { note: 'Default I2C SCL.' } : g === 43 || g === 44 ? { note: 'Serial TX / RX.' } : {})),
    PWR('5V', 'R', 0), PWR('GND', 'R', 1), PWR('3V3', 'R', 2),
    ...xiao.slice(7).map(([g, n], i) => P(g, `${n} (GPIO ${g})`, 'R', 3 + i, ['in', 'out', 'pwm', 'adc', 'touch', 'spi', 'int'], { level: 'warn', note: 'Shared with the SD card slot (SPI).' })),
  ],
};

// ------------------------------------------------------------------ Arduino Uno R3
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11]);
const avrPin = (pwmSet, ints) => (n, side, pos, extra = {}) => P(n, `D${n}`, side, pos, ['in', 'out', ...(pwmSet.has(n) ? ['pwm'] : []), ...(ints.includes(n) ? ['int'] : [])], extra);
const unoD = avrPin(UNO_PWM, [2, 3]);
const uno = {
  id: 'uno', name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', chip: 'ATmega328P 16 MHz, 2 KB RAM, 32 KB flash',
  logic: 5, wifi: false, bluetooth: false, camera: null, maxPinMa: 20, absMaxPinMa: 40, size: { w: 69, h: 53 },
  summary: 'The beginner board: 5 V logic, 14 digital pins (6 with PWM), 6 analog inputs. No Wi-Fi: pair it with an ESP32 for wireless.',
  limits: ['5 V logic: 3.3 V sensors need a level shifter on their inputs.', 'D0 / D1 are the USB serial port (uploading uses them).', 'Only 2 KB of RAM.'],
  pins: [
    ...Array.from({ length: 14 }, (_, n) => unoD(n, 'T', 13 - n, n <= 1 ? { level: 'warn', note: `Serial ${n ? 'TX' : 'RX'}: used for uploading and the Serial Monitor.` } : n === 13 ? { note: 'On-board LED "L".' } : n >= 10 ? { note: `SPI ${['SS', 'MOSI', 'MISO', 'SCK'][n - 10]}.` } : {})),
    ...Array.from({ length: 6 }, (_, i) => P(14 + i, `A${i}`, 'B', i + 3, ['in', 'out', 'adc', ...(i >= 4 ? ['i2c'] : [])], i === 4 ? { note: 'I2C SDA.' } : i === 5 ? { note: 'I2C SCL.' } : {})),
    PWR('5V', 'B', 0), PWR('3V3', 'B', 1, '3.3 V output, 50 mA at most.'), PWR('GND', 'B', 2),
  ],
};

// ------------------------------------------------------------------ Arduino Mega 2560 Rev3
const MEGA_PWM = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46]);
const megaD = avrPin(MEGA_PWM, [2, 3, 18, 19, 20, 21]);
const megaNote = (n) => ({
  0: 'Serial RX (USB): used for uploading and the Serial Monitor.', 1: 'Serial TX (USB): used for uploading and the Serial Monitor.',
  13: 'On-board LED "L".', 14: 'Serial3 TX.', 15: 'Serial3 RX.', 16: 'Serial2 TX.', 17: 'Serial2 RX.', 18: 'Serial1 TX.', 19: 'Serial1 RX.',
  20: 'I2C SDA.', 21: 'I2C SCL.', 50: 'SPI MISO.', 51: 'SPI MOSI.', 52: 'SPI SCK.', 53: 'SPI SS.',
}[n] || '');
const mega2560 = {
  id: 'mega2560', name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega', chip: 'ATmega2560 16 MHz, 8 KB RAM, 256 KB flash',
  logic: 5, wifi: false, bluetooth: false, camera: null, maxPinMa: 20, absMaxPinMa: 40, size: { w: 101, h: 53 },
  summary: 'Many pins for many parts: 54 digital (15 PWM), 16 analog, 4 serial ports, I2C on 20 / 21. No Wi-Fi or camera: pair it with the ESP32-CAM over a serial port.',
  limits: ['5 V logic: connect 3.3 V boards (ESP32) through a level shifter or a divider on the Mega TX line.', 'D0 / D1 are the USB serial port.', 'The 3.3 V pin gives 50 mA at most.'],
  pins: [
    ...Array.from({ length: 22 }, (_, n) => megaD(n, 'T', 21 - n, { level: n <= 1 ? 'warn' : null, note: megaNote(n) })),
    ...Array.from({ length: 32 }, (_, i) => megaD(22 + i, 'R', i, { note: megaNote(22 + i) })),
    ...Array.from({ length: 16 }, (_, i) => P(54 + i, `A${i}`, 'B', i + 3, ['in', 'out', 'adc', ...(i >= 8 ? ['int'] : [])])),
    PWR('5V', 'B', 0), PWR('3V3', 'B', 1, '3.3 V output, 50 mA at most.'), PWR('GND', 'B', 2),
  ].map((p) => { if (p.use === 'power') return p; if ([20, 21].includes(p.gpio)) p.caps = [...new Set([...(p.caps || []), 'i2c'])]; if ([14, 15, 16, 17, 18, 19].includes(p.gpio)) p.caps = [...new Set([...(p.caps || []), 'uart'])]; return p; }),
};

// ------------------------------------------------------------------ Raspberry Pi Pico / Pico W
const picoL = [0, 1, 'GND', 2, 3, 4, 5, 'GND', 6, 7, 8, 9, 'GND', 10, 11, 12, 13, 'GND', 14, 15];
const picoR = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 28, 'GND', 27, 26, 'RUN', 22, 'GND', 21, 20, 19, 18, 'GND', 17, 16];
const picoPin = (side) => (g, i) => (typeof g === 'string' ? PWR(g, side, i, { VBUS: 'USB 5 V.', VSYS: 'Power input 1.8–5.5 V.', '3V3': '3.3 V output, 300 mA.', RUN: 'Pull LOW to reset.' }[g] || '')
  : P(g, `GP${g}`, side, i, ['in', 'out', 'pwm', 'i2c', 'uart', 'spi', 'int', ...(g >= 26 ? ['adc'] : [])], g >= 26 ? { note: `ADC${g - 26}.` } : {}));
const pico = {
  id: 'pico', name: 'Raspberry Pi Pico / Pico W', fqbn: 'rp2040:rp2040:rpipico', chip: 'RP2040 dual core 133 MHz, 264 KB RAM, 2 MB flash',
  logic: 3.3, wifi: 'Pico W only', bluetooth: 'Pico W only', camera: null, maxPinMa: 12, absMaxPinMa: 16, size: { w: 21, h: 51 },
  summary: 'Cheap, fast and flexible: 26 GPIOs, every pin can do PWM, I2C / SPI / UART on many pins, 3 analog inputs. Arduino or MicroPython.',
  limits: ['3.3 V logic, not 5 V tolerant.', 'About 12 mA per pin.', 'GP23–25 and GP29 are used inside the board (power, VBUS sense, LED).'],
  pins: [...picoL.map(picoPin('L')), ...picoR.map(picoPin('R')), P(25, 'GP25 (LED)', 'X', 0, ['out'], { use: 'led', level: 'warn', note: 'On-board LED (Pico). On the Pico W the LED is on the Wi-Fi chip.' })],
};

const BOARDS = { esp32cam, esp32devkit, xiaoesp32s3: esp32s3, uno, mega2560, pico };
const byFqbn = (fqbn) => { const base = String(fqbn || '').split(':').slice(0, 3).join(':'); return Object.values(BOARDS).find((b) => b.fqbn === base) || null; };
const pinOf = (board, gpio) => (board.pins || []).find((p) => p.gpio === Number(gpio)) || null;

// Check a set of pin assignments { name: gpio } against a board.
// → [{ level: 'error'|'warn', name, gpio, message }]  (ESPHome style: errors block, warnings can be acknowledged)
function checkPins(board, assign, { needs = {} } = {}) {
  const out = [];
  const seen = new Map();
  for (const [name, gpio] of Object.entries(assign)) {
    if (gpio == null || gpio === '' || Number(gpio) < 0) continue;
    const p = pinOf(board, gpio);
    if (!p) { out.push({ level: 'error', name, gpio, message: `GPIO ${gpio} is not a pin of the ${board.name}.` }); continue; }
    if (seen.has(Number(gpio))) out.push({ level: 'error', name, gpio, message: `GPIO ${gpio} is already used by ${seen.get(Number(gpio))}.` });
    seen.set(Number(gpio), name);
    if (p.level === 'error') { out.push({ level: 'error', name, gpio, message: `${p.label}: ${p.note || 'reserved by the board.'}` }); continue; }
    const need = needs[name];
    if (need === 'adc' && (p.caps || []).includes('adc2') && !(p.caps || []).includes('adc')) out.push({ level: 'warn', name, gpio, message: `${p.label} reads analog values only while Wi-Fi is off (ADC2). With Wi-Fi use GPIO 32–39.` });
    else if (need && !(p.caps || []).includes(need)) out.push({ level: 'error', name, gpio, message: `${p.label} cannot do ${({ out: 'output', pwm: 'PWM', adc: 'analog input', i2c: 'I2C', in: 'input' })[need] || need}.` });
    else if (p.level === 'warn') out.push({ level: 'warn', name, gpio, message: `${p.label}: ${p.note}` });
  }
  return out;
}

// default I2C pins (Wire without arguments)
Object.assign(BOARDS.esp32devkit, { i2c: { sda: 21, scl: 22 } }); Object.assign(BOARDS.xiaoesp32s3, { i2c: { sda: 5, scl: 6 } });
Object.assign(BOARDS.uno, { i2c: { sda: 18, scl: 19 } }); Object.assign(BOARDS.mega2560, { i2c: { sda: 20, scl: 21 } }); Object.assign(BOARDS.pico, { i2c: { sda: 4, scl: 5 } });
Object.assign(BOARDS.esp32cam, { i2c: { sda: 3, scl: 1 } });

// Pins a sketch uses: pinMode / digitalWrite / analogRead / analogWrite / tone / attach / Wire.begin(sda, scl) with a
// number or a #define / const int name. → { name: gpio } plus what each pin must be able to do.
function pinsInCode(text) {
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const names = {};
  for (const m of src.matchAll(/#define\s+(\w+)\s+(\d+)\b/g)) names[m[1]] = Number(m[2]);
  for (const m of src.matchAll(/\b(?:const\s+|constexpr\s+|static\s+)*(?:int|uint8_t|byte|unsigned|uint16_t|int8_t)\s+(\w+)\s*=\s*(\d+)\s*;/g)) if (!(m[1] in names)) names[m[1]] = Number(m[2]);
  const val = (t) => (/^\d+$/.test(t) ? Number(t) : t in names ? names[t] : null);
  const NEED = { pinMode: null, digitalWrite: 'out', digitalRead: 'in', analogWrite: 'pwm', analogRead: 'adc', tone: 'out', attach: 'pwm', ledcAttachPin: 'pwm', ledcAttach: 'pwm' };
  const assign = {}, needs = {}, seen = {};
  const add = (gpio, label, need) => {
    if (gpio == null || Number.isNaN(gpio)) return;
    let key = seen[gpio];
    if (!key) { key = `${label}`; let i = 2; while (key in assign) key = `${label}#${i++}`; seen[gpio] = key; assign[key] = gpio; }
    if (need && (!needs[key] || need === 'adc' || need === 'pwm')) needs[key] = need;
  };
  for (const m of src.matchAll(/\b(pinMode|digitalWrite|digitalRead|analogWrite|analogRead|tone|ledcAttachPin|ledcAttach|\.attach)\s*\(\s*([A-Za-z_]\w*|\d+)\s*(?:,\s*(OUTPUT|INPUT|INPUT_PULLUP)?)?/g)) {
    const fn = m[1].replace('.', ''), g = val(m[2]);
    const need = fn === 'pinMode' ? (m[3] === 'OUTPUT' ? 'out' : 'in') : NEED[fn];
    add(g, /^\d+$/.test(m[2]) ? `${fn}(${m[2]})` : m[2], need);
  }
  for (const m of src.matchAll(/Wire\d?\.begin\s*\(\s*([A-Za-z_]\w*|\d+)\s*,\s*([A-Za-z_]\w*|\d+)/g)) { add(val(m[1]), 'I2C SDA', 'i2c'); add(val(m[2]), 'I2C SCL', 'i2c'); }
  return { assign, needs };
}

module.exports = { BOARDS, byFqbn, pinOf, checkPins, pinsInCode };
