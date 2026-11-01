// Calibration wizard for the Baby Carpathron car (firmware 2.2+). Each step measures one thing with the car's own sensors,
// works out the right setting and saves it on the car (or in the app), so the car drives straight, starts at low speed,
// turns exactly and measures distances right. Steps:
//   gyro       — the gyro's zero (the car must stand still)          → restarts the car if it drifts
//   deadzone   — lowest power that really moves each side of wheels  → minDuty
//   straight   — drives forward and corrects the pull to one side    → trim
//   speed      — real speed with the laser                           → app setting cmPerSec (used by "go to")
//   laser      — a target at a known distance                        → tofOff
//   turn       — a 360° turn, you say how far off it ended           → gScale
//   camera     — looks at the picture: too dark / flat / grey        → ae, contr, satur
'use strict';
const C = require('./carsettings');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Brightness / contrast / colour of a JPEG (Electron's image decoder; null when not available, e.g. plain Node).
function imageStats(buf) {
  let electron;
  try { electron = require('electron'); } catch { return null; }
  if (!electron || typeof electron !== 'object' || !electron.nativeImage) return null;
  try {
    const img = electron.nativeImage.createFromBuffer(buf).resize({ width: 64, height: 48, quality: 'good' });
    const bmp = img.toBitmap(); // BGRA
    let n = 0, sum = 0, sum2 = 0, sat = 0, warm = 0;
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2], y = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += y; sum2 += y * y; sat += Math.max(r, g, b) - Math.min(r, g, b); warm += r - b; n++;
    }
    const mean = sum / n;
    return { mean: Math.round(mean), contrast: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean))), saturation: Math.round(sat / n), warmth: Math.round(warm / n) };
  } catch { return null; }
}

class Calibrator {
  constructor(host, { imageStats: stats = imageStats, setAppRobot = () => {}, appRobot = () => ({}), log = () => {} } = {}) {
    this.host = host; this.stats = stats; this.setAppRobot = setAppRobot; this.appRobot = appRobot; this.log = log;
  }
  async status() { return C.carJson(this.host, '/status', 2500); }
  async yaw() { const s = await this.status(); return s.sensors && s.sensors.imu ? Number(s.sensors.yaw) : null; }
  async dist(n = 1) {
    const r = [];
    for (let i = 0; i < n; i++) { const s = await this.status(); const d = s.sensors && s.sensors.tof ? Number(s.sensors.dist) : -1; if (d > 0) r.push(d); if (n > 1) await sleep(40); }
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : -1;
  }
  async drive(l, r, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { await C.carJson(this.host, `/drive?l=${Math.round(l)}&r=${Math.round(r)}`, 1500).catch(() => {}); await sleep(Math.min(150, ms)); }
    await C.carJson(this.host, '/stop', 1500).catch(() => {});
    await sleep(350);
  }
  async settings() { return C.getSettings(this.host); }
  async set(changes) { return C.setMany(this.host, changes); }

  async run(step, input = {}) {
    const fn = this[`step_${step}`];
    if (!fn) throw new Error(`Unknown calibration step "${step}".`);
    const r = await fn.call(this, input);
    this.log(`Calibration ${step}: ${r.text}`);
    return { step, ...r };
  }

  async needGyro() {
    const s = await this.status();
    if (!s.sensors || !s.sensors.imu) throw new Error('This step needs the MPU-6050 gyro (Robot → Setup → Sensors). Without it, watch the car and use the Car settings by hand.');
  }
  async needLaser(minFree = 0) {
    const s = await this.status();
    if (!s.sensors || !s.sensors.tof) throw new Error('This step needs the VL53L0X laser distance sensor.');
    if (minFree) { const d = await this.dist(3); if (d > 0 && d < minFree) throw new Error(`Not enough free space in front (${Math.round(d / 10)} cm). Put the car where it has at least ${Math.round(minFree / 10)} cm in front of it.`); }
  }

  // 1) gyro zero
  async step_gyro() {
    await this.needGyro();
    const d = await C.runDiag(this.host);
    const rest = Math.abs(Number(d.imu.restDps));
    if (rest <= 0.3) return { ok: true, text: `The gyro is steady (${d.imu.restDps}°/s at rest). Nothing to change.`, measured: { restDps: d.imu.restDps } };
    await C.restart(this.host);
    await sleep(7000);
    const d2 = await C.runDiag(this.host).catch(() => null);
    const rest2 = d2 ? Math.abs(Number(d2.imu.restDps)) : null;
    return { ok: rest2 != null && rest2 <= 0.3, text: rest2 == null ? 'The car restarted to measure the gyro zero again but did not answer yet. Run this step again in a moment.' : rest2 <= 0.3 ? `The gyro drifted ${rest.toFixed(2)}°/s; the car restarted standing still and now drifts ${rest2.toFixed(2)}°/s.` : `Still drifting ${rest2.toFixed(2)}°/s after a restart: make sure the car stands completely still at start, and that the gyro board is firmly fixed.`, measured: { before: rest, after: rest2 } };
  }

  // 2) lowest power that moves the wheels
  async step_deadzone() {
    await this.needGyro();
    const before = (await this.settings()).values;
    await this.set({ minDuty: 0, maxPct: 100, trim: 0 });
    const found = {};
    try {
      for (const side of ['left', 'right']) {
        for (let p = 15; p <= 100; p += 5) {
          const y0 = await this.yaw();
          await this.drive(side === 'left' ? p : 0, side === 'right' ? p : 0, 450);
          const dy = Math.abs((await this.yaw()) - y0);
          if (dy >= 4) { found[side] = Math.round((255 * p) / 100); break; }
        }
      }
    } finally {
      await this.set({ minDuty: before.minDuty, maxPct: before.maxPct, trim: before.trim });
    }
    if (!found.left || !found.right) return { ok: false, text: `${!found.left ? 'The left' : 'The right'} wheels did not move even at full power. Run the health check (🛞 wheel test) first: batteries, wires, the speed pin.`, measured: found };
    const minDuty = clamp(Math.max(found.left, found.right) + 8, 60, 230);
    await this.set({ minDuty });
    return { ok: true, text: `The wheels start moving at power ${found.left} (left) and ${found.right} (right) of 255. "Lowest power" is now ${minDuty} (was ${before.minDuty}), so even 1 % speed moves the car.`, applied: { minDuty }, before: { minDuty: before.minDuty }, measured: found };
  }

  // 3) straight driving
  async step_straight() {
    await this.needGyro();
    const s = await this.status();
    if (s.sensors.tof) await this.needLaser(700);
    const before = (await this.settings()).values;
    let trim = before.trim, last = null;
    const tries = [];
    for (let i = 0; i < 4; i++) {
      const y0 = await this.yaw();
      await this.drive(60, 60, 1200);
      const dy = (await this.yaw()) - y0; // + = pulled right = left side stronger
      tries.push({ trim, pull: Math.round(dy * 10) / 10 });
      last = dy;
      await this.drive(-60, -60, 1200); // come back
      if (Math.abs(dy) < 2) break;
      trim = clamp(Math.round(trim - dy * 0.6), -25, 25);
      await this.set({ trim });
    }
    const ok = Math.abs(last) < 2;
    return { ok, text: ok ? `The car now drives straight (pull ${last.toFixed(1)}° over about 40 cm). Trim ${trim} % (was ${before.trim}).` : `Still pulls ${last.toFixed(1)}° with trim ${trim}. Check that a wheel is not rubbing and the tyres sit straight; a weak motor can need a trim beyond the range.`, applied: { trim }, before: { trim: before.trim }, measured: { tries } };
  }

  // 4) real speed with the laser → the app's cm per second (used by go to)
  async step_speed() {
    await this.needLaser(800);
    const speed = Number(this.appRobot().driveSpeed) || 60;
    const d0 = await this.dist(5);
    await this.drive(speed, speed, 1000);
    const d1 = await this.dist(5);
    await this.drive(-speed, -speed, 1000);
    if (d0 <= 0 || d1 <= 0) return { ok: false, text: 'The laser lost the target: point the car at a wall 1–2 m away and try again.' };
    const cmPerSec = clamp(Math.round((d0 - d1) / 10), 5, 200);
    if (cmPerSec < 6) return { ok: false, text: `The car moved only ${Math.round((d0 - d1) / 10)} cm in 1 s at ${speed} %. Check the batteries and "Lowest power".` };
    const before = Number(this.appRobot().cmPerSec) || 40;
    this.setAppRobot({ cmPerSec });
    return { ok: true, text: `At ${speed} % the car drives ${cmPerSec} cm per second (it was set to ${before}). "Go to" now plans its hops with this.`, applied: { cmPerSec }, before: { cmPerSec: before }, measured: { from: Math.round(d0), to: Math.round(d1) } };
  }

  // 5) laser offset: a target at a known distance
  async step_laser({ knownMm = 200 } = {}) {
    await this.needLaser();
    knownMm = clamp(Number(knownMm) || 200, 50, 1000);
    const before = (await this.settings()).values;
    const mean = await this.dist(20);
    if (mean <= 0) return { ok: false, text: 'The laser sees nothing: put a flat, light-coloured box straight in front of the sensor.' };
    const tofOff = clamp(Math.round(before.tofOff + (mean - knownMm)), -100, 100);
    await this.set({ tofOff });
    return { ok: true, text: `The laser read ${Math.round(mean)} mm for a target at ${knownMm} mm. Offset is now ${tofOff} mm (was ${before.tofOff}).`, applied: { tofOff }, before: { tofOff: before.tofOff }, measured: { mean: Math.round(mean), knownMm } };
  }

  // 6) gyro scale: phase "run" turns 360°, phase "apply" takes how far off it ended
  async step_turn({ phase = 'run', errorDeg = 0 } = {}) {
    await this.needGyro();
    if (phase === 'run') {
      await C.carJson(this.host, '/turn?deg=360');
      for (let i = 0; i < 120; i++) { await sleep(150); const s = await this.status(); if (!s.sensors.turning) break; }
      return { ok: true, waiting: true, text: 'The car turned what the gyro thinks is 360°. Did it end facing exactly the same way? Enter how many degrees it went too far (+) or stopped short (−), then Apply.' };
    }
    const err = clamp(Number(errorDeg) || 0, -90, 90);
    const before = (await this.settings()).values;
    const gScale = clamp(Math.round((before.gScale * (360 + err)) / 360), 900, 1100);
    await this.set({ gScale });
    return { ok: true, text: `The car really turned ${360 + err}° when the gyro said 360°. Gyro scale is now ${gScale} (was ${before.gScale}): turns are exact now. Run it again to check.`, applied: { gScale }, before: { gScale: before.gScale } };
  }

  // 7) camera picture
  async step_camera() {
    const before = (await this.settings()).values;
    const vals = { ae: before.ae, bright: before.bright, contr: before.contr, satur: before.satur };
    const shots = [];
    for (let i = 0; i < 4; i++) {
      const buf = await new Promise((resolve, reject) => {
        const http = require('http');
        const [h, port] = this.host.split(':');
        http.get({ host: h, port: Number(port) || 80, path: '/capture', timeout: 6000 }, (res) => { const ch = []; res.on('data', (d) => ch.push(d)); res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(ch)) : reject(new Error('the camera did not give a picture')))); }).on('error', reject);
      });
      const st = this.stats(buf);
      if (!st) return { ok: false, text: 'Picture analysis needs the desktop app (it uses its image decoder).' };
      shots.push(st);
      const ch = {};
      if (st.mean < 85 && vals.ae < 2) ch.ae = ++vals.ae; else if (st.mean < 85 && vals.bright < 2) ch.bright = ++vals.bright;
      else if (st.mean > 180 && vals.ae > -2) ch.ae = --vals.ae; else if (st.mean > 180 && vals.bright > -2) ch.bright = --vals.bright;
      if (st.contrast < 32 && vals.contr < 2) ch.contr = ++vals.contr;
      if (st.saturation < 18 && vals.satur < 2) ch.satur = ++vals.satur;
      if (!Object.keys(ch).length) break;
      await this.set(ch);
      await sleep(900);
    }
    const last = shots[shots.length - 1];
    const changed = Object.fromEntries(Object.entries(vals).filter(([k, v]) => v !== before[k]));
    const warm = last.warmth > 30 ? ' Colours look orange: try White balance "Home".' : last.warmth < -30 ? ' Colours look blue: try White balance "Cloudy" or "Office".' : '';
    return { ok: true, text: `${Object.keys(changed).length ? `Adjusted ${Object.entries(changed).map(([k, v]) => `${k} ${before[k]} → ${v}`).join(', ')}.` : 'The picture is fine as it is.'} Brightness ${last.mean}/255, contrast ${last.contrast}, colour ${last.saturation}.${warm}`, applied: changed, before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]])), measured: { shots } };
  }
}

const STEPS = [
  { id: 'gyro', title: 'Gyro zero', needs: 'gyro', moves: false, text: 'Keep the car completely still. If the gyro drifts, the car restarts to measure its zero again.' },
  { id: 'deadzone', title: 'Lowest power that moves the wheels', needs: 'gyro', moves: true, text: 'Each side of wheels gets more and more power until the car really moves. Then even the slowest speed moves the car. Lift it slightly or give it 20 cm around.' },
  { id: 'straight', title: 'Drive straight', needs: 'gyro', moves: true, text: 'The car drives about 40 cm forward and back, up to 4 times, and corrects the pull to one side. Needs 70 cm of free floor in front.' },
  { id: 'speed', title: 'Real speed', needs: 'laser', moves: true, text: 'Point the car at a wall 1–2 m away. It drives 1 s forward and back and measures how far it went, for "go to".' },
  { id: 'laser', title: 'Laser distance', needs: 'laser', moves: false, input: { knownMm: 'Distance of the target from the sensor (mm)' }, text: 'Put a flat box straight in front of the laser at a distance you measured with a ruler (for example 200 mm).' },
  { id: 'turn', title: 'Exact turns', needs: 'gyro', moves: true, twoPhase: true, input: { errorDeg: 'Degrees too far (+) or short (−)' }, text: 'Mark where the car points (a line of tape). It turns 360°: tell how far off it ended and the gyro scale is corrected.' },
  { id: 'camera', title: 'Camera picture', needs: 'camera', moves: false, text: 'Point the camera at the room as it will drive. Brightness, contrast and colour are adjusted until the picture is clear.' },
];

module.exports = { Calibrator, STEPS, imageStats };
