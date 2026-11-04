'use strict';
// Muse Carpathron 2.3 — SAM 3.1 masks -> object contours.
// SAM 3.1 answers with "<|box;...|>" and "<|mask;...;data=H,W,~payload|>" tokens. The mask payload is Meta's own
// compact format (base85 + range coder; "~" lossless coverage bytes, "!" one-bit context model). This is a port of
// the decoder in Meta's meta-sam-parser package (SAM License), followed by a contour tracer: the outline of each
// object becomes a smooth polygon (fractions of the picture) the headset draws instead of a box.

const EXCLUDED = new Set(['"', '\\', ',', ';', '<', '>', '|']);
const ALPHABET = [];
for (let c = 0x21; c < 0x7f; c++) if (!EXCLUDED.has(String.fromCharCode(c))) ALPHABET.push(String.fromCharCode(c));
const VAL = new Int16Array(128).fill(-1);
ALPHABET.forEach((ch, i) => { VAL[ch.charCodeAt(0)] = i; });
const R85 = 85, TOP = 1 << 24, BOTTOM = 1 << 16;

function digit(ch) {
  const c = ch.charCodeAt(0), v = c < 128 ? VAL[c] : -1;
  if (v < 0 || v >= R85) throw new Error('bad mask character');
  return v;
}

function unpack(p) {
  if (p.length < 5) throw new Error('mask payload too short');
  let len = 0;
  for (let i = 0; i < 5; i++) len = len * R85 + digit(p[i]);
  const rem = len % 4;
  if (p.length !== 5 + Math.floor(len / 4) * 5 + (rem ? rem + 1 : 0)) throw new Error('mask payload length mismatch');
  const out = new Uint8Array(len);
  let src = 5, dst = 0;
  const full = len - rem;
  while (dst < full) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * R85 + digit(p[src + i]);
    src += 5;
    out[dst] = (v / 16777216) & 255; out[dst + 1] = (v >>> 16) & 255; out[dst + 2] = (v >>> 8) & 255; out[dst + 3] = v & 255;
    dst += 4;
  }
  if (rem) {
    let v = 0;
    for (let i = 0; i < 5; i++) v = v * R85 + (i < rem + 1 ? digit(p[src + i]) : R85 - 1);
    for (let i = 0; i < rem; i++) out[dst + i] = Math.floor(v / 2 ** (24 - i * 8)) & 255;
  }
  return out;
}

class RangeDecoder {
  constructor(input) {
    if (input.length < 4) throw new Error('mask payload missing finalization');
    this.inp = input; this.pos = 0; this.low = 0; this.range = 0xffffffff; this.code = 0; this.scaled = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.read()) >>> 0;
  }
  read() { if (this.pos >= this.inp.length) throw new Error('mask payload ended early'); return this.inp[this.pos++]; }
  freq(total) {
    this.scaled = Math.floor(this.range / total);
    if (!this.scaled) throw new Error('mask coding state');
    const v = Math.floor(((this.code - this.low) >>> 0) / this.scaled);
    return v >= total ? total - 1 : v;
  }
  decode(cum, f) {
    this.low = (this.low + this.scaled * cum) >>> 0;
    this.range = this.scaled * f;
    for (;;) {
      if (((this.low ^ ((this.low + this.range) >>> 0)) >>> 0) < TOP) { /* emit */ }
      else if (this.range < BOTTOM) this.range = ((-this.low) >>> 0) & (BOTTOM - 1);
      else break;
      this.code = ((this.code << 8) | this.read()) >>> 0;
      this.low = (this.low << 8) >>> 0;
      this.range = (this.range << 8) >>> 0;
    }
  }
}

function paeth(l, u, ul) {
  const e = l + u - ul, a = Math.abs(e - l), b = Math.abs(e - u), c = Math.abs(e - ul);
  if (a <= b && a <= c) return l;
  return b <= c ? u : ul;
}

function decodeLossless(payload, W, H) {
  const packed = unpack(payload.slice(1));
  if (packed.length < 5) throw new Error('lossless mask truncated');
  const sel = packed[0];
  if (sel > 4) throw new Error('lossless mask predictor');
  const dec = new RangeDecoder(packed.subarray(1));
  const n = W * H, out = new Uint8Array(n), res = new Uint8Array(n);
  const zc = new Uint32Array(32).fill(1);
  const o1 = new Uint16Array(256 * 256).fill(1), o1t = new Int32Array(256).fill(256);
  const o0 = new Uint16Array(256).fill(2);
  let o0t = 512, prev = 0;
  const o2 = new Map();
  for (let off = 0; off < n; off++) {
    const x = off % W, y = (off - x) / W;
    const l = x > 0 ? +(res[off - 1] === 0) : 1, u = y > 0 ? +(res[off - W] === 0) : 1;
    const ul = x > 0 && y > 0 ? +(res[off - W - 1] === 0) : 1, ur = y > 0 && x < W - 1 ? +(res[off - W + 1] === 0) : 1;
    const zo = (l | (u << 1) | (ul << 2) | (ur << 3)) << 1;
    const z = zc[zo], nz = zc[zo + 1];
    const bit = dec.freq(z + nz) < z ? 0 : 1;
    dec.decode(bit ? z : 0, bit ? nz : z);
    zc[zo + bit] += 32;
    if (zc[zo] + zc[zo + 1] >= 16384) { zc[zo] = (zc[zo] >>> 1) || 1; zc[zo + 1] = (zc[zo + 1] >>> 1) || 1; }
    let sym = 0;
    if (bit) {
      const above = off >= W ? res[off - W] : 0, key = (prev << 8) | above;
      let sec = o2.get(key);
      if (!sec) { sec = new Uint16Array(257); o2.set(key, sec); }
      const fo = prev << 8;
      const ex = sec[0] + o1[fo] + o0[0];
      const total = sec[256] + o1t[prev] + o0t - ex;
      const target = dec.freq(total);
      let cum = 0; sym = 1;
      let f = sec[1] + o1[fo + 1] + o0[1];
      while (cum + f <= target) {
        cum += f; sym++;
        if (sym >= 256) throw new Error('lossless mask malformed');
        f = sec[sym] + o1[fo + sym] + o0[sym];
      }
      dec.decode(cum, f);
      sec[sym] = (sec[sym] + 616) & 0xffff; sec[256] = (sec[256] + 616) & 0xffff;
      if (sec[256] >= 50176) { let t = 0; for (let v = 0; v < 256; v++) { sec[v] >>>= 1; t += sec[v]; } sec[256] = t & 0xffff; }
      o1[fo + sym] = (o1[fo + sym] + 56) & 0xffff; o1t[prev] += 56;
      if (o1t[prev] >= 8192) { let t = 0; for (let v = 0; v < 256; v++) { const s = (o1[fo + v] >>> 1) || 1; o1[fo + v] = s; t += s; } o1t[prev] = t; }
      o0[sym] = (o0[sym] + 32) & 0xffff; o0t += 32;
      if (o0t >= 4096) { let t = 0; for (let v = 0; v < 256; v++) { o0[v] >>>= 1; t += o0[v]; } o0t = t; }
    }
    res[off] = sym;
    // prediction from already decoded coverage bytes
    const L = x > 0 ? out[off - 1] : 0, U = y > 0 ? out[off - W] : 0;
    let p;
    if (sel === 1) p = U;
    else if (sel === 2) p = L;
    else if (sel === 3) p = (L + U) >> 1;
    else {
      const UL = x > 0 && y > 0 ? out[off - W - 1] : 0;
      if (sel === 0) p = paeth(L, U, UL);
      else if (UL >= Math.max(L, U)) p = Math.min(L, U);
      else if (UL <= Math.min(L, U)) p = Math.max(L, U);
      else p = L + U - UL;
    }
    const delta = sym & 1 ? -((sym + 1) >> 1) : sym >> 1;
    out[off] = (p + delta) & 255;
    prev = sym;
  }
  const bits = new Uint8Array(n);
  for (let i = 0; i < n; i++) bits[i] = out[i] >= 129 ? 1 : 0;
  return bits;
}

function decodeOneBit(payload, W, H) {
  const dec = new RangeDecoder(unpack(payload.slice(1)));
  const counts = new Uint16Array(4096 * 2).fill(1);
  const PW = W + 4, pad = new Uint8Array(PW * (H + 2)), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = (y + 2) * PW + 2;
    for (let x = 0; x < W; x++) {
      const p = row + x, pr = p - PW, er = p - 2 * PW;
      const ctx = pad[p - 1] | (pad[p - 2] << 1) | (pad[pr - 2] << 2) | (pad[pr - 1] << 3) | (pad[pr] << 4) | (pad[pr + 1] << 5) | (pad[pr + 2] << 6)
        | (pad[er - 2] << 7) | (pad[er - 1] << 8) | (pad[er] << 9) | (pad[er + 1] << 10) | (pad[er + 2] << 11);
      const o = ctx << 1, z = counts[o], one = counts[o + 1];
      const bit = dec.freq(z + one) < z ? 0 : 1;
      if (bit) dec.decode(z, one); else dec.decode(0, z);
      pad[p] = bit; out[y * W + x] = bit;
      counts[o + bit] = (counts[o + bit] + 14) & 0xffff;
      if (counts[o] + counts[o + 1] >= 4096) { counts[o] = (counts[o] >>> 1) || 1; counts[o + 1] = (counts[o + 1] >>> 1) || 1; }
    }
  }
  return out;
}

// "H,W,~payload" -> { w, h, bits }
function decodeMask(data) {
  const a = data.indexOf(','), b = data.indexOf(',', a + 1);
  const H = Number(data.slice(0, a)), W = Number(data.slice(a + 1, b)), p = data.slice(b + 1);
  if (!(H > 0 && W > 0) || H * W > 4e6) throw new Error('mask size');
  if (p[0] === '~') return { w: W, h: H, bits: decodeLossless(p, W, H) };
  if (p[0] === '!') return { w: W, h: H, bits: decodeOneBit(p, W, H) };
  throw new Error('unknown mask encoding');
}

// SAM text -> [{ id, box: {x1,y1,x2,y2,w,h,conf}, mask }]
function parseRecords(text) {
  const recs = [];
  const re = /(\d+)?<\|(box|mask);([^|]*)\|>/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    if (m[2] === 'box') {
      const f = {};
      for (const kv of m[3].split(';')) { const i = kv.indexOf('='); if (i > 0) f[kv.slice(0, i).trim()] = Number(kv.slice(i + 1)); }
      recs.push({ id: m[1] != null ? Number(m[1]) : recs.length, box: { x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, w: f.w, h: f.h, conf: Number.isFinite(f.c) ? f.c : null }, mask: null });
    } else if (recs.length) {
      const i = m[3].indexOf('data=');
      if (i >= 0) recs[recs.length - 1].mask = m[3].slice(i + 5);
    }
  }
  return recs;
}

// outer outline of the biggest blob (Moore neighbour tracing), then simplified
function contour(bits, W, H) {
  // biggest 4-connected blob
  const lab = new Int32Array(W * H);
  let best = 0, bestN = 0, cur = 0;
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!bits[s] || lab[s]) continue;
    cur++; let n = 0; stack.push(s); lab[s] = cur;
    while (stack.length) {
      const q = stack.pop(); n++;
      const x = q % W, y = (q - x) / W;
      if (x > 0 && bits[q - 1] && !lab[q - 1]) { lab[q - 1] = cur; stack.push(q - 1); }
      if (x < W - 1 && bits[q + 1] && !lab[q + 1]) { lab[q + 1] = cur; stack.push(q + 1); }
      if (y > 0 && bits[q - W] && !lab[q - W]) { lab[q - W] = cur; stack.push(q - W); }
      if (y < H - 1 && bits[q + W] && !lab[q + W]) { lab[q + W] = cur; stack.push(q + W); }
    }
    if (n > bestN) { bestN = n; best = cur; }
  }
  if (!best || bestN < 6) return [];
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && lab[y * W + x] === best;
  let start = -1;
  for (let i = 0; i < W * H; i++) if (lab[i] === best) { start = i; break; }
  const sx = start % W, sy = (start - sx) / W;
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [[sx, sy]];
  let x = sx, y = sy, dir = 7, guard = 4 * (W + H) * 8;
  do {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8, nx = x + D[d][0], ny = y + D[d][1];
      if (on(nx, ny)) { x = nx; y = ny; dir = d; found = true; break; }
    }
    if (!found) break;
    pts.push([x, y]);
  } while ((x !== sx || y !== sy) && --guard > 0);
  return simplify(pts, Math.max(1.0, Math.max(W, H) / 90));
}

// closed outline: split at the point farthest from the start, simplify both halves (Douglas-Peucker)
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const [x0, y0] = pts[0];
  let far = 1, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - x0, pts[i][1] - y0); if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), eps), b = dp(pts.slice(far), eps);
  const out = a.concat(b.slice(1));
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// one SAM record -> { box: [x,y,w,h] (0..1), poly: [x0,y0,x1,y1,...] (0..1) }
function recordShape(rec, frameW, frameH) {
  const b = rec.box, FW = b.w > 2 ? b.w : frameW, FH = b.h > 2 ? b.h : frameH;
  if (![b.x1, b.y1, b.x2, b.y2].every(Number.isFinite) || !FW || !FH) return null;
  const c = (v) => Math.max(0, Math.min(1, v));
  const box = [c(b.x1 / FW), c(b.y1 / FH), c((b.x2 + 1 - b.x1) / FW), c((b.y2 + 1 - b.y1) / FH)];
  let poly = [];
  if (rec.mask) {
    try {
      const m = decodeMask(rec.mask);
      // the mask covers the box (its own size); scale onto the box
      const sx = (b.x2 + 1 - b.x1) / m.w, sy = (b.y2 + 1 - b.y1) / m.h;
      for (const [x, y] of contour(m.bits, m.w, m.h).slice(0, 64)) poly.push(Math.round(c((b.x1 + (x + 0.5) * sx) / FW) * 1000) / 1000, Math.round(c((b.y1 + (y + 0.5) * sy) / FH) * 1000) / 1000);
    } catch { poly = []; }
  }
  return { box, poly, conf: b.conf };
}

// object prompt for SAM: our boxes (0..1) -> "<0f>0<|box;...|>,1<|box;...|>"
function objectPrompt(boxes, W, H) {
  const view = `w=${W};h=${H}`;
  const segs = boxes.map((bx, i) => {
    const x1 = Math.max(0, Math.min(W - 2, Math.floor(bx[0] * W))), y1 = Math.max(0, Math.min(H - 2, Math.floor(bx[1] * H)));
    const x2 = Math.max(x1 + 1, Math.min(W - 1, Math.ceil((bx[0] + bx[2]) * W - 1e-6) - 1)), y2 = Math.max(y1 + 1, Math.min(H - 1, Math.ceil((bx[1] + bx[3]) * H - 1e-6) - 1));
    return `${i}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};${view}|>`;
  });
  return `<0f>${segs.join(',')}`;
}

// JPEG size from the SOF marker (no image library needed)
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const mk = buf[i + 1];
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

module.exports = { decodeMask, decodeLossless, decodeOneBit, parseRecords, contour, recordShape, objectPrompt, jpegSize, unpack, ALPHABET };
