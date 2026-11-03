// Parts library: common robot parts, what pins each one needs, how to power it, how to test it, and where to buy it in
// Romania. Used by Robot → 🔧 Board & parts (add-a-part wizard, interactive schematic), the pin planner and the AI.
// signals: [{ role, needs: [caps], note }]  — caps as in boards.js (in, out, pwm, adc, i2c, uart, int, i2s…)
// power: '3V3' | '5V' | 'both' | 'battery' ; mA: typical current ; bus: i2c parts share SDA/SCL with others (addr = address)
'use strict';
const { BOARDS } = require('./boards');

const PARTS = [
  { id: 'l298n', name: 'L298N motor driver', kind: 'Motors', power: 'battery', mA: 0, signals: [
    { role: 'ENA', needs: ['pwm'], note: 'speed of motor A (remove the ENA jumper)' }, { role: 'IN1', needs: ['out'] }, { role: 'IN2', needs: ['out'] },
    { role: 'ENB', needs: ['pwm'], note: 'speed of motor B (remove the ENB jumper)' }, { role: 'IN3', needs: ['out'] }, { role: 'IN4', needs: ['out'] }],
    text: 'Drives two DC motors (or two sides of a 4WD car) from 7–12 V batteries. Loses about 2 V; its 5 V output can power the board.',
    tips: ['Connect the battery minus, the driver GND and the board GND together.', 'Keep the 5V-EN jumper only when the battery is below 12 V.'], test: 'Health → wheel test, or Car settings → Motors.', buy: 'modul driver motoare L298N' },
  { id: 'tb6612', name: 'TB6612FNG motor driver', kind: 'Motors', power: 'both', mA: 2, signals: [
    { role: 'PWMA', needs: ['pwm'] }, { role: 'AIN1', needs: ['out'] }, { role: 'AIN2', needs: ['out'] }, { role: 'PWMB', needs: ['pwm'] }, { role: 'BIN1', needs: ['out'] }, { role: 'BIN2', needs: ['out'] }, { role: 'STBY', needs: ['out'], note: 'HIGH = on (or tie to 3V3)' }],
    text: 'Smaller and more efficient than the L298N (almost no voltage lost), up to 1.2 A per motor. VCC = 3V3 logic, VM = motor battery.',
    tips: ['VM up to 13.5 V.', 'STBY can go straight to 3V3 to save a pin.'], test: 'Drive each motor slowly forward and back.', buy: 'driver motoare TB6612FNG' },
  { id: 'sg90', name: 'SG90 servo', kind: 'Motors', power: '5V', mA: 250, signals: [{ role: 'signal', needs: ['pwm'], note: 'orange wire' }],
    text: 'Turns to an angle (0–180°): a camera tilt, a gripper, a sensor head.', tips: ['Power it from 5 V, not from the board\'s 3V3 pin (it pulls up to 650 mA when it starts).', 'Brown = GND, red = 5 V, orange = signal; 3.3 V signal is enough.'],
    test: 'Sweep 0 → 180 → 90° (ESP32Servo library).', lib: 'ESP32Servo', buy: 'servomotor SG90' },
  { id: 'vl53l0x', name: 'VL53L0X laser distance', kind: 'Sensors', power: '3V3', mA: 20, bus: 'i2c', addr: 0x29, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: 'Measures 3 cm – 2 m with a laser, 30 times a second. The car stops before obstacles with it.', tips: ['Shares SDA/SCL with other I2C parts.', 'Dark or shiny surfaces and sunlight shorten the range.'], test: 'Health → laser readings.', lib: 'VL53L0X (Pololu)', buy: 'senzor distanta laser VL53L0X' },
  { id: 'mpu6050', name: 'MPU-6050 gyro (GY-521)', kind: 'Sensors', power: '3V3', mA: 4, bus: 'i2c', addr: 0x68, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: 'Gyro + accelerometer: exact turns, heading for maps, bump detection.', tips: ['Mount it flat and firm in the middle of the chassis.', 'Keep the car still for a second after power-on (it measures its zero).'], test: 'Health → gyro, Calibration → Gyro zero.', buy: 'modul accelerometru giroscop MPU6050 GY-521' },
  { id: 'hcsr04', name: 'HC-SR04 ultrasonic distance', kind: 'Sensors', power: '5V', mA: 15, signals: [{ role: 'TRIG', needs: ['out'] }, { role: 'ECHO', needs: ['in'], note: '5 V signal: needs a divider (1 kΩ + 2 kΩ) on 3.3 V boards' }],
    text: '2 cm – 4 m with sound; cheap, wide beam (sees chair legs the laser misses).', tips: ['On ESP32 / Pico use the HC-SR04P (3.3 V version) or a voltage divider on ECHO.'], test: 'Print the distance every 100 ms.', buy: 'senzor ultrasonic HC-SR04' },
  { id: 'dht11', name: 'DHT11 temperature + humidity', kind: 'Sensors', power: 'both', mA: 3, signals: [{ role: 'DATA', needs: ['in', 'out'] }],
    text: 'Temperature (±2 °C) and humidity (±5 %), one reading every 2 s on a single wire.', tips: ['The 3-pin module already has its pull-up resistor.', 'Put it by a vent, away from the motor driver\'s heat.'], test: 'Print temperature and humidity every 2 s.', lib: 'DHT sensor library (Adafruit) — or the hub firmware reads it without a library', buy: 'senzor temperatura umiditate DHT11' },
  { id: 'carlink', name: 'Link to the ESP32-CAM car (serial)', kind: 'Boards', power: '5V', mA: 0, signals: [{ role: 'TX', needs: ['uart'], note: 'to ESP32 RXD through 1 kΩ, with 2 kΩ from ESP32 RXD to GND (5 V → 3.3 V)' }, { role: 'RX', needs: ['uart'], note: 'from ESP32 TXD, direct' }],
    text: 'Two wires to the car\'s ESP32-CAM (RXD/TXD) plus 5 V and GND: the Mega sends its sensor readings to the car 20 times a second.', tips: ['Unplug the 5 V wire when you upload to the Mega over USB.', 'Update the car over Wi-Fi once this link is wired (its USB serial shares those pins).'], test: 'Robot → Setup: "Mega sensor hub: connected".', buy: 'fire jumper dupont' },
  { id: 'ir-avoid', name: 'IR obstacle module', kind: 'Sensors', power: '3V3', mA: 20, signals: [{ role: 'OUT', needs: ['in'] }],
    text: 'Sees an obstacle 2–30 cm away (LOW = obstacle). The kit has two.', tips: ['Turn the knob until its LED lights at the distance you want.'], test: 'Hand in front: the value changes.', buy: 'senzor obstacole infrarosu' },
  { id: 'tcrt5000', name: 'Line follower (TCRT5000)', kind: 'Sensors', power: '3V3', mA: 20, signals: [{ role: 'OUT', needs: ['in'] }],
    text: 'Sees a black line on a light floor, 1–2 cm above the floor. Use 2 or 3 side by side.', tips: ['Mount it 1 cm above the floor.'], test: 'Move it over black tape.', buy: 'senzor urmarire linie TCRT5000' },
  { id: 'encoder', name: 'Wheel encoder', kind: 'Sensors', power: '3V3', mA: 10, signals: [{ role: 'OUT', needs: ['in', 'int'], note: 'needs an interrupt pin' }],
    text: 'Counts wheel turns: real speed and distance for each side (better maps, exact straight driving).', tips: ['One per side; a slotted disc on the motor shaft.'], test: 'Turn the wheel by hand: the count rises.', buy: 'senzor viteza encoder optic' },
  { id: 'bme280', name: 'BME280 temperature / humidity / pressure', kind: 'Sensors', power: '3V3', mA: 1, bus: 'i2c', addr: 0x76, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: 'Room climate for the robot\'s reports.', tips: ['Address 0x76 or 0x77 (SDO pin).'], test: 'Read once a second.', lib: 'Adafruit BME280', buy: 'senzor BME280' },
  { id: 'ina219', name: 'INA219 battery monitor', kind: 'Power', power: '3V3', mA: 1, bus: 'i2c', addr: 0x40, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: 'Battery voltage and current: the app can show the battery level and warn before it is empty.', tips: ['Put it between the battery plus and the motor driver.'], test: 'Voltage ≈ the battery voltage.', lib: 'Adafruit INA219', buy: 'modul INA219' },
  { id: 'ads1115', name: 'ADS1115 analog inputs', kind: 'Power', power: '3V3', mA: 1, bus: 'i2c', addr: 0x48, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: '4 extra analog inputs over I2C — for boards whose analog pins are taken or blocked by Wi-Fi (ESP32-CAM).', tips: ['Battery voltage through a 100 k / 33 k divider.'], test: 'Read A0 with a known voltage.', lib: 'Adafruit ADS1X15', buy: 'convertor ADS1115' },
  { id: 'oled', name: 'OLED display 0.96" (SSD1306)', kind: 'Display', power: '3V3', mA: 20, bus: 'i2c', addr: 0x3c, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: 'A small screen for the robot\'s eyes, its IP address or the battery.', tips: ['128×64 pixels, address 0x3C.'], test: 'Show "Hello".', lib: 'Adafruit SSD1306', buy: 'display OLED 0.96 I2C' },
  { id: 'pca9685', name: 'PCA9685 16 servo driver', kind: 'Motors', power: '5V', mA: 10, bus: 'i2c', addr: 0x40, signals: [{ role: 'SDA', needs: ['i2c'] }, { role: 'SCL', needs: ['i2c'] }],
    text: '16 servos over two I2C wires: a robot arm or a walking robot.', tips: ['Servo power (V+) from a separate 5–6 V supply.'], test: 'Move servo 0.', lib: 'Adafruit PWM Servo Driver', buy: 'driver servo PCA9685' },
  { id: 'max98357', name: 'MAX98357A speaker amplifier (I2S)', kind: 'Sound', power: '5V', mA: 300, signals: [{ role: 'BCLK', needs: ['out'] }, { role: 'LRC', needs: ['out'] }, { role: 'DIN', needs: ['out'] }],
    text: 'The robot talks and plays sounds through a 3 W speaker (I2S digital audio).', tips: ['Needs 3 free pins: not possible on the ESP32-CAM with the motors connected — use an ESP32-S3 or the phone as the robot\'s voice.'], test: 'Play a beep.', lib: 'ESP8266Audio / ESP32 I2S', buy: 'amplificator MAX98357A I2S' },
  { id: 'inmp441', name: 'INMP441 microphone (I2S)', kind: 'Sound', power: '3V3', mA: 2, signals: [{ role: 'SCK', needs: ['out'] }, { role: 'WS', needs: ['out'] }, { role: 'SD', needs: ['in'] }],
    text: 'A digital microphone: the robot hears voice commands itself.', tips: ['L/R to GND = left channel.'], test: 'Show the sound level.', buy: 'microfon INMP441' },
  { id: 'ws2812', name: 'WS2812B RGB LEDs', kind: 'Light', power: '5V', mA: 60, signals: [{ role: 'DIN', needs: ['out'] }],
    text: 'Coloured lights in a strip or ring, any number on one pin: eyes, indicators, mood.', tips: ['60 mA per LED at full white: power from 5 V.', '3.3 V data usually works for short wires.'], test: 'Rainbow.', lib: 'Adafruit NeoPixel', buy: 'banda LED WS2812B' },
  { id: 'buzzer', name: 'Passive buzzer', kind: 'Sound', power: '3V3', mA: 30, signals: [{ role: 'signal', needs: ['pwm'] }],
    text: 'Beeps and simple melodies.', tips: ['A passive buzzer plays any tone; an active one only beeps.'], test: 'Play 1 kHz for 200 ms.', buy: 'buzzer pasiv' },
  { id: 'neo6m', name: 'GPS NEO-6M', kind: 'Sensors', power: '3V3', mA: 45, signals: [{ role: 'TX', needs: ['in', 'uart'], note: 'GPS TX → board RX' }, { role: 'RX', needs: ['out', 'uart'], note: 'optional' }],
    text: 'Position outdoors (2–5 m), for outdoor robots.', tips: ['Needs open sky; first fix takes up to a minute.'], test: 'Show the NMEA sentences.', lib: 'TinyGPSPlus', buy: 'modul GPS NEO-6M' },
];
const byId = (id) => PARTS.find((p) => p.id === id);
const boot = (pin) => pin.level === 'warn';

// Pick pins for a part on a board, avoiding pins that are reserved or already used, preferring plain pins over boot pins.
// used: { gpio: 'what uses it' }. I2C parts reuse the board's I2C pins when an I2C bus is already in use.
function plan(boardId, partId, used = {}, { i2c } = {}) {
  const board = BOARDS[boardId], part = byId(partId);
  if (!board || !part) throw new Error(!board ? `Unknown board ${boardId}` : `Unknown part ${partId}`);
  const usedG = new Map(Object.entries(used).map(([g, w]) => [Number(g), w]));
  const notes = [], assign = {};
  if (part.bus === 'i2c' && i2c && i2c.sda != null && i2c.scl != null) {
    assign.SDA = i2c.sda; assign.SCL = i2c.scl;
    notes.push(`Shares the I2C bus (SDA GPIO ${i2c.sda}, SCL GPIO ${i2c.scl}) at address 0x${part.addr.toString(16)}.`);
    return { part, assign, notes, ok: true };
  }
  const free = board.pins.filter((p) => p.gpio != null && p.level !== 'error' && !usedG.has(p.gpio));
  const prefI2C = board.i2c || null; // default I2C pins of the board, when it has them
  for (const s of part.signals) {
    const anyUart = /ESP32/i.test(board.chip) || board.id === 'uno'; // ESP32: UART on any pin (GPIO matrix); Uno: SoftwareSerial
    const can = (p, c) => p.caps.includes(c) || (c === 'int' && /ESP32|RP2040/i.test(board.chip) && p.caps.includes('in')) || (c === 'uart' && anyUart && p.caps.includes('in'));
    let cands = free.filter((p) => s.needs.every((c) => can(p, c)) && !Object.values(assign).includes(p.gpio));
    const score = (p) => (boot(p) ? 2 : 0) + (p.use ? 1 : 0);
    cands.sort((a, b) => score(a) - score(b));
    if (prefI2C && part.bus === 'i2c') { const want = s.role === 'SDA' ? prefI2C.sda : prefI2C.scl; const m = cands.find((p) => p.gpio === want); if (m) cands = [m, ...cands.filter((p) => p !== m)]; }
    const pick = cands[0];
    if (!pick) return { part, assign, ok: false, notes: [...notes, `No free pin can do "${s.role}" (${s.needs.join(' + ')}) on the ${board.name}. Free a pin, use an I2C expander (PCA9685 / ADS1115) or a bigger board.`] };
    assign[s.role] = pick.gpio;
    if (boot(pick) || pick.use) notes.push(`${s.role} on ${pick.label}: ${pick.note || pick.use}`);
    if (s.needs.includes('uart') && board.id === 'uno') notes.push(`${s.role}: use SoftwareSerial on these pins (pins 0/1 are the USB serial).`);
  }
  if (part.power === '5V' && Number(board.logic) < 5) notes.push('Powered from 5 V but the board works at 3.3 V: check that its output signals are 3.3 V safe.');
  if (part.mA >= 200) notes.push(`Draws up to ${part.mA} mA: power it from the 5 V supply, not from a board pin.`);
  return { part, assign, notes, ok: true };
}

// Wires for the schematic: one per signal + power + ground. color by kind.
function wires(boardId, placed) {
  const board = BOARDS[boardId];
  const out = [];
  for (const pl of placed) {
    const part = byId(pl.part);
    if (!part) continue;
    const pw = part.power === 'battery' ? 'battery +' : part.power === '5V' ? '5V' : part.power === '3V3' ? '3V3' : Number(board.logic) >= 5 ? '5V' : '3V3';
    out.push({ part: pl.id, from: pw, to: part.power === 'battery' ? '+12V' : 'VCC', kind: 'power' });
    out.push({ part: pl.id, from: 'GND', to: 'GND', kind: 'gnd' });
    for (const [role, gpio] of Object.entries(pl.assign || {})) out.push({ part: pl.id, from: gpio, to: role, kind: part.bus === 'i2c' ? 'i2c' : /EN|PWM/.test(role) || part.signals.find((s) => s.role === role && s.needs.includes('pwm')) ? 'pwm' : 'signal' });
  }
  return out;
}

// Arduino starter code for a build (pins as #defines + the setup lines each part needs).
function starterCode(boardId, placed) {
  const board = BOARDS[boardId];
  const lines = [`// ${board.name} — wiring made in Muse Carpathron (Robot → Board & parts)`, ''];
  const libs = new Set();
  for (const pl of placed) {
    const part = byId(pl.part);
    if (!part) continue;
    if (part.lib) libs.add(part.lib);
    lines.push(`// ${pl.name || part.name}`);
    for (const [role, gpio] of Object.entries(pl.assign || {})) lines.push(`#define ${(pl.id + '_' + role).toUpperCase().replace(/[^A-Z0-9_]/g, '_')} ${gpio}`);
  }
  lines.push('', libs.size ? `// Libraries (Firmware studio → Libraries): ${[...libs].join(', ')}` : '', '', 'void setup() {', '  Serial.begin(115200);');
  for (const pl of placed) {
    const part = byId(pl.part); if (!part) continue;
    const P = (r) => (pl.id + '_' + r).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (part.bus === 'i2c') {
      if (!lines.some((l) => l.includes('Wire.begin'))) {
        if (/ESP32/i.test(board.chip)) lines.push(`  Wire.begin(${P('SDA')}, ${P('SCL')});`);
        else if (/RP2040/i.test(board.chip)) lines.push(`  Wire.setSDA(${P('SDA')}); Wire.setSCL(${P('SCL')}); Wire.begin();`);
        else lines.push('  Wire.begin(); // fixed I2C pins on this board');
      }
    }
    else for (const s of part.signals) lines.push(`  pinMode(${P(s.role)}, ${s.needs.includes('in') && !s.needs.includes('out') ? 'INPUT' : 'OUTPUT'});`);
  }
  lines.push('}', '', 'void loop() {', '}', '');
  if (lines.some((l) => l.includes('Wire.begin'))) lines.unshift('#include <Wire.h>');
  return lines.join('\n');
}

module.exports = { PARTS, byId, plan, wires, starterCode };
