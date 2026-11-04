// SAM 3.1 mask decoder + contours: one-bit masks round-trip through a port of Meta's encoder; Meta's published
// lossless example decodes to one clean blob; records parse; the object prompt is well formed.
const s = require('../backend/samcontour');
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok  ' : 'FAIL') + ' ' + m); if (!c) fail++; };
const { encodeOneBit } = require('./samenc');
for (let k = 0; k < 5; k++) {
  const W = 20 + k * 17, H = 15 + k * 11, cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2.6;
  const bits = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bits[y * W + x] = Math.hypot((x - cx) * (1 + 0.3 * k), y - cy) < r + 3 * Math.sin(x / 3) ? 1 : 0;
  const data = `${H},${W},${encodeOneBit(bits, W, H)}`;
  const m = s.decodeMask(data);
  ok(m.w === W && m.h === H && Buffer.compare(Buffer.from(m.bits), Buffer.from(bits)) === 0, `one-bit ${W}x${H} round trip`);
  const poly = s.contour(m.bits, W, H);
  ok(poly.length >= 6 && poly.length <= 64, `contour ${poly.length} points`);
}
// Meta's lossless example (meta-sam-parser docs): 27 x 60 mask
const lp = "27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
const lm = s.decodeMask(lp); const on = lm.bits.reduce((a, b) => a + b, 0);
ok(lm.w === 60 && lm.h === 27 && on > 100 && on < 60 * 27, `lossless example decodes (${on} of ${60 * 27} pixels on)`);
const t = `<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.9|><|mask;x=0;y=0;c=0.9;data=${lp.slice(0)}|>,1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>`;
const recs = s.parseRecords(t);
ok(recs.length === 2 && recs[0].id === 0 && recs[1].id === 1 && recs[0].mask && !recs[1].mask, 'records parse (ids, mask with its box)');
const sh = s.recordShape(recs[0], 320, 334);
ok(sh && sh.poly.length >= 12 && sh.poly.every((v) => v >= 0 && v <= 1) && Math.abs(sh.box[0] - 211 / 320) < 1e-6, `shape: ${sh.poly.length / 2} contour points inside the box`);
const px = sh.poly.filter((_, i) => i % 2 === 0), py = sh.poly.filter((_, i) => i % 2 === 1);
ok(Math.min(...px) >= 211 / 320 - 0.01 && Math.max(...px) <= 271 / 320 + 0.01 && Math.min(...py) >= 228 / 334 - 0.01 && Math.max(...py) <= 255 / 334 + 0.01, 'contour stays on the object');
ok(s.objectPrompt([[0.1, 0.2, 0.3, 0.4]], 640, 480) === '<0f>0<|box;x1=64;y1=96;x2=255;y2=287;w=640;h=480|>', 'object prompt');
const jpg = require('fs').readFileSync(__dirname + '/sample.jpg'); const js = s.jpegSize(jpg);
ok(js && js.w > 0 && js.h > 0, `jpeg size ${js && js.w}x${js && js.h}`);
console.log(fail ? `${fail} FAILED` : 'ALL OK'); process.exit(fail ? 1 : 0);
