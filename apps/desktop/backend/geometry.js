// Distances from one camera, without a distance sensor: the car's camera is a known height above a flat floor, so the
// row where something touches the floor tells how far away it is (lower in the picture = closer):
//     distance = height / tan(angle below the horizon)
//     angle    = (y - 0.5) * vertical field of view + camera tilt
// y is 0 at the top of the picture and 1 at the bottom. The tilt is found once with "Calibrate distance" (an object
// placed at a known distance). Accurate to a few centimetres up close, less far away — good enough to stop in time.
'use strict';

const DEFAULTS = { heightCm: 10, vfovDeg: 46, hfovDeg: 60, tiltDeg: 0 };
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function cfgOf(robot = {}) {
  return {
    heightCm: Number(robot.camHeightCm) > 0 ? Number(robot.camHeightCm) : DEFAULTS.heightCm,
    vfovDeg: Number(robot.camVfovDeg) > 0 ? Number(robot.camVfovDeg) : DEFAULTS.vfovDeg,
    hfovDeg: DEFAULTS.hfovDeg,
    tiltDeg: Number.isFinite(Number(robot.camTiltDeg)) ? Number(robot.camTiltDeg) : DEFAULTS.tiltDeg,
  };
}

// cm from the camera to the floor point at picture row y (0..1). Infinity at or above the horizon.
function floorDistanceCm(y, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...cfg };
  const below = (Math.min(1, Math.max(0, y)) - 0.5) * c.vfovDeg + c.tiltDeg;
  if (below <= 0.3) return Infinity;
  return c.heightCm / Math.tan(rad(below));
}

// The tilt that makes row y (0..1) be `cm` away.
function calibrateTilt(y, cm, cfg = DEFAULTS) {
  const c = { ...DEFAULTS, ...cfg };
  return deg(Math.atan(c.heightCm / cm)) - (y - 0.5) * c.vfovDeg;
}

// degrees from the picture centre for column x (0..1): - = left, + = right
const bearingOf = (x, cfg = DEFAULTS) => (Math.min(1, Math.max(0, x)) - 0.5) * ({ ...DEFAULTS, ...cfg }).hfovDeg;

// How different two photos are (0 = identical, 1 = completely different), from a 32×24 grey thumbnail.
// Used to notice that the car did not move (it is pushing against something). null when it cannot be measured.
// 32×24 grey thumbnail of a JPEG, brightness-normalised (auto-exposure changes do not count as "different"). null = cannot decode.
function thumb(buf) {
  let electron;
  try { electron = require('electron'); } catch { return null; }
  if (!electron || typeof electron !== 'object' || !electron.nativeImage) return null;
  try {
    const bmp = electron.nativeImage.createFromBuffer(buf).resize({ width: 32, height: 24, quality: 'good' }).toBitmap();
    const g = new Float32Array(32 * 24);
    let mean = 0;
    for (let i = 0; i < g.length; i++) { g[i] = (bmp[i * 4] + bmp[i * 4 + 1] + bmp[i * 4 + 2]) / 3; mean += g[i]; }
    mean /= g.length;
    if (!mean) return null;
    for (let i = 0; i < g.length; i++) g[i] = (g[i] / mean) * 128;
    return g;
  } catch { return null; }
}
function thumbDiff(ga, gb) {
  if (!ga || !gb || ga.length !== gb.length) return null;
  let sum = 0;
  for (let i = 0; i < ga.length; i++) sum += Math.abs(ga[i] - gb[i]);
  return Math.min(1, sum / ga.length / 255);
}
function frameDiff(a, b) { return thumbDiff(thumb(a), thumb(b)); }

// Repeat period of a sequence of views taken while spinning in equal steps: the P where view i looks most like view
// i+P on average (all pairs together, so one odd photo or a light change does not matter). Returns a fractional P
// (parabolic refinement) or null. diff(i, j) gives the difference of views i and j.
function spinPeriod(n, diff, minP = 3) {
  const score = [];
  for (let P = minP; P <= Math.floor((n - 1) * 0.75); P++) {
    let s = 0, k = 0;
    for (let i = 0; i + P < n; i++) { const d = diff(i, i + P); if (d != null) { s += d; k++; } }
    // also compare with nearby shifts: being one step off a full circle must score worse than exactly one
    if (k >= 2) score[P] = s / k;
  }
  const ps = Object.keys(score).map(Number);
  if (!ps.length) return null;
  const min = Math.min(...ps.map((p) => score[p]));
  // the first period whose score is close to the best (2P, 3P also match — take the shortest)
  const P = ps.find((p) => score[p] <= min * 1.15 && (score[p - 1] == null || score[p] <= score[p - 1]) && (score[p + 1] == null || score[p] <= score[p + 1])) || ps.find((p) => score[p] === min);
  const a = score[P - 1], b = score[P], c = score[P + 1];
  let frac = 0;
  if (a != null && c != null && a + c - 2 * b > 1e-9) frac = Math.max(-0.5, Math.min(0.5, (a - c) / (2 * (a + c - 2 * b))));
  return { period: P + frac, score };
}

module.exports = { DEFAULTS, cfgOf, floorDistanceCm, calibrateTilt, bearingOf, frameDiff, thumb, thumbDiff, spinPeriod };
