// Robot voice effect: turns a natural neural voice into a small, cheerful robot (Baby Carpathron) that is still easy to
// understand. Pure JavaScript DSP on Float32 samples (no native code):
//   pitch + formants up (a smaller "body", like a little robot)  ·  a short metallic resonance (robot shell)  ·
//   a slight electronic shimmer (ring modulation, mixed low)  ·  a small-speaker band-pass  ·  normalised loudness.
'use strict';

const PRESETS = {
  // name: { semis: pitch up in semitones (the voice is generated slower by the same ratio so the speed stays natural),
  //         comb: [delay ms, feedback, mix], ring: [Hz, mix], hp: high-pass Hz, lp: low-pass Hz, crush: 0..1 }
  baby: { label: 'Baby Carpathron (cute, clear)', semis: 4, comb: [3.2, 0.28, 0.22], ring: [0, 0], hp: 140, lp: 9000, crush: 0 },
  wall: { label: 'Little workbot (WALL-E style)', semis: 5, comb: [2.4, 0.45, 0.35], ring: [55, 0.16], hp: 180, lp: 7500, crush: 0.15 },
  tiny: { label: 'Tiny helper (higher)', semis: 7, comb: [2.0, 0.3, 0.2], ring: [0, 0], hp: 200, lp: 9500, crush: 0 },
  clear: { label: 'Clear robot (light effect)', semis: 2, comb: [4.0, 0.22, 0.15], ring: [0, 0], hp: 100, lp: 10000, crush: 0 },
  // 2.3: the companion talks like a person: the natural neural voice, only cleaned and levelled
  human: { label: 'Natural (human)', semis: 0, comb: [0, 0, 0], ring: [0, 0], hp: 70, lp: 0, crush: 0 },
};

// Linear-interpolation resampler: factor > 1 = shorter + higher (pitch and formants up together).
function resample(x, factor) {
  const n = Math.floor(x.length / factor), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = i * factor, k = Math.floor(p), f = p - k; y[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f; }
  return y;
}
function onePoleHP(x, rate, hz) { if (!hz) return x; const a = Math.exp((-2 * Math.PI * hz) / rate); const y = new Float32Array(x.length); let px = 0, py = 0; for (let i = 0; i < x.length; i++) { py = a * (py + x[i] - px); px = x[i]; y[i] = py; } return y; }
function onePoleLP(x, rate, hz) { if (!hz) return x; const a = Math.exp((-2 * Math.PI * hz) / rate); const y = new Float32Array(x.length); let py = 0; for (let i = 0; i < x.length; i++) { py = (1 - a) * x[i] + a * py; y[i] = py; } return y; }
function comb(x, rate, [ms, fb, mix]) {
  if (!mix) return x;
  const d = Math.max(1, Math.round((ms / 1000) * rate)), buf = new Float32Array(d), y = new Float32Array(x.length);
  for (let i = 0, j = 0; i < x.length; i++, j = (j + 1) % d) { const o = buf[j]; buf[j] = x[i] + o * fb; y[i] = x[i] * (1 - mix) + o * mix; }
  return y;
}
function ring(x, rate, [hz, mix]) { if (!mix || !hz) return x; const y = new Float32Array(x.length); const w = (2 * Math.PI * hz) / rate; for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - mix) + x[i] * Math.sin(w * i) * mix; return y; }
function crush(x, amt) { if (!amt) return x; const levels = Math.round(256 - amt * 200); const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) { const q = Math.round(x[i] * levels) / levels; y[i] = x[i] * (1 - amt) + q * amt; } return y; }
function normalize(x, peak = 0.89) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (!m) return x; const g = peak / m; const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * g * 1.1) / Math.tanh(1.1); return y; }
function fade(x, rate, ms = 12) { const n = Math.min(x.length / 2, Math.round((ms / 1000) * rate)); for (let i = 0; i < n; i++) { const g = i / n; x[i] *= g; x[x.length - 1 - i] *= g; } return x; }

// samples were generated at `speed` = 1 / ratio (slower), so after the pitch shift the duration is natural again
function robotize(samples, rate, preset = 'baby') {
  const p = PRESETS[preset] || PRESETS.baby;
  let y = resample(samples, Math.pow(2, p.semis / 12));
  y = onePoleHP(y, rate, p.hp);
  y = comb(y, rate, p.comb);
  y = ring(y, rate, p.ring);
  y = crush(y, p.crush);
  y = onePoleLP(y, rate, p.lp);
  return fade(normalize(y), rate);
}
const speedFor = (preset) => 1 / Math.pow(2, ((PRESETS[preset] || PRESETS.baby).semis) / 12);

// 16-bit mono WAV
function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}

module.exports = { PRESETS, robotize, speedFor, wav, resample };
