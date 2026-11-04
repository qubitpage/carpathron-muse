// Test helper: SAM 3.1 one-bit mask encoder (port of Meta's meta-sam-parser) + an ellipse mask for fakes.
const s = require('../backend/samcontour');
const A = s.ALPHABET;
function pack(inp) {
  const len = inp.length; let rl = len; const pre = Array(5);
  for (let i = 4; i >= 0; i--) { pre[i] = A[rl % 85]; rl = Math.floor(rl / 85); }
  const out = pre; let off = 0; const full = len - (len % 4);
  const grp = (v, n) => { const d = Array(5); for (let i = 4; i >= 0; i--) { d[i] = v % 85; v = (v - d[i]) / 85; } for (let i = 0; i < n; i++) out.push(A[d[i]]); };
  while (off < full) { grp(((inp[off] << 24) | (inp[off + 1] << 16) | (inp[off + 2] << 8) | inp[off + 3]) >>> 0, 5); off += 4; }
  const rem = len - off;
  if (rem > 0) { let v = 0; for (let i = 0; i < 4; i++) v = ((v << 8) | (i < rem ? inp[off + i] : 0)) >>> 0; grp(v, rem + 1); }
  return out.join('');
}
function encodeOneBit(bits, W, H) {
  let low = 0, range = 0xffffffff; const o = [];
  const enc = (cum, f, total) => { const sc = Math.floor(range / total); low = (low + sc * cum) >>> 0; range = sc * f;
    for (;;) { if (((low ^ ((low + range) >>> 0)) >>> 0) < (1 << 24)) {} else if (range < (1 << 16)) range = ((-low) >>> 0) & 0xffff; else break; o.push(low >>> 24); low = (low << 8) >>> 0; range = (range << 8) >>> 0; } };
  const counts = new Uint16Array(8192).fill(1), PW = W + 4, pad = new Uint8Array(PW * (H + 2));
  for (let y = 0; y < H; y++) { const row = (y + 2) * PW + 2; for (let x = 0; x < W; x++) {
    const p = row + x, pr = p - PW, er = p - 2 * PW;
    const ctx = pad[p - 1] | (pad[p - 2] << 1) | (pad[pr - 2] << 2) | (pad[pr - 1] << 3) | (pad[pr] << 4) | (pad[pr + 1] << 5) | (pad[pr + 2] << 6) | (pad[er - 2] << 7) | (pad[er - 1] << 8) | (pad[er] << 9) | (pad[er + 1] << 10) | (pad[er + 2] << 11);
    const of = ctx << 1, z = counts[of], one = counts[of + 1], bit = bits[y * W + x];
    if (bit) enc(z, one, z + one); else enc(0, z, z + one);
    pad[p] = bit; counts[of + bit] = (counts[of + bit] + 14) & 0xffff;
    if (counts[of] + counts[of + 1] >= 4096) { counts[of] = (counts[of] >>> 1) || 1; counts[of + 1] = (counts[of + 1] >>> 1) || 1; } } }
  for (let i = 0; i < 4; i++) { o.push(low >>> 24); low = (low << 8) >>> 0; }
  return '!' + pack(o);
}
function ellipseMask(W, H) {
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bits[y * W + x] = ((x + 0.5 - W / 2) / (W / 2)) ** 2 + ((y + 0.5 - H / 2) / (H / 2)) ** 2 <= 1 ? 1 : 0;
  return `${H},${W},${encodeOneBit(bits, W, H)}`;
}
module.exports = { encodeOneBit, pack, ellipseMask };
