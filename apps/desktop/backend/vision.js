// Eyes for the agent and the robot. Picks the model that looks at photos and asks it simple questions:
//  - describe(images, question): what the pictures show (for chat models that cannot see, e.g. Llama 3.1 8B)
//  - locate(photo, target):     is <target> in this photo, where (left / centre / right) and how far
//  - view(photo):               objects in one robot photo with position and distance (room map, offline)
// The model: Settings → visionModel ("auto" = the chat model if it sees; a local vision model when the chat model is
// local or the cloud is unreachable; otherwise Muse Spark). Local vision models (Ollama) get ONE image per request.
'use strict';
const models = require('./models');

const POS = { 'far left': -25, left: -20, 'slightly left': -9, centre: 0, center: 0, middle: 0, 'slightly right': 9, right: 20, 'far right': 25 };

// first {...} in a reply, tolerant of code fences and trailing text
function parseJson(text) {
  const t = String(text || '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
// Width and height of a JPEG (from its SOF marker), or null.
function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
// First box in a model reply ([x1,y1,x2,y2] or "bbox_2d"), as 0..1. Qwen-VL uses 0-1000; larger numbers are pixels.
function parseBox(text, buffer) {
  const t = String(text || '');
  const m = t.match(/bbox_2d"?\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/) || t.match(/"box"\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/) || t.match(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/);
  if (!m) return null;
  let [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  let sx = 1000, sy = 1000;
  if (Math.max(x1, y1, x2, y2) > 1000) { const d = jpegSize(buffer) || { w: 640, h: 480 }; sx = d.w; sy = d.h; } // pixel coordinates
  else if (Math.max(x1, y1, x2, y2) <= 1) { sx = 1; sy = 1; } // already 0..1
  const c = (v, k) => Math.max(0, Math.min(1, v / k));
  let b = [c(x1, sx), c(y1, sy), c(x2, sx), c(y2, sy)];
  if (b[0] > b[2]) b = [b[2], b[1], b[0], b[3]];
  if (b[1] > b[3]) b = [b[0], b[3], b[2], b[1]];
  if (b[2] - b[0] < 0.005 || b[3] - b[1] < 0.005) return null;
  return b;
}
const truthy = (v) => v === true || /^(true|yes|da)$/i.test(String(v || '').trim());
function bearingOf(o) {
  if (Number.isFinite(Number(o.bearing))) return Math.max(-30, Math.min(30, Number(o.bearing)));
  const p = String(o.position || o.where || '').toLowerCase().replace(/[-_]/g, ' ').trim();
  if (p in POS) return POS[p];
  if (/left/.test(p)) return /slight|bit|little/.test(p) ? -9 : -20;
  if (/right/.test(p)) return /slight|bit|little/.test(p) ? 9 : 20;
  return 0;
}
const metres = (v, d = 1.5) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.min(8, n) : d; };

class Vision {
  constructor({ api, getSettings, ollama, log }) {
    Object.assign(this, { api, getSettings, ollama, log: log || (() => {}) });
  }

  // Local models the user enabled that can see (Ollama reports "vision"). Llama 3.2 Vision (Meta) first, then other
  // dedicated vision models (faster than a big chat model), then the rest (e.g. Glimmer).
  localVisionModels() {
    const names = this.ollama ? this.ollama.enabledModels() : [];
    const rank = (n) => (/llama3\.2-vision/i.test(n) ? 0 : /vision|vl\b|-vl|llava|moondream/i.test(n) ? 1 : 2); // Meta first, then other dedicated vision models
    return names.filter((n) => models.has(`local:${n}`, 'vision')).sort((a, b) => rank(a) - rank(b)).map((n) => `local:${n}`);
  }

  // Which model looks at photos for a chat that uses chatModel.
  pick(chatModel) {
    const s = this.getSettings();
    const want = s.visionModel || 'auto';
    if (want !== 'auto') return want;
    if (chatModel && models.has(chatModel, 'vision')) return chatModel;
    const local = this.localVisionModels();
    if ((models.isLocal(chatModel) || this.offline) && local.length) return local[0];
    if (s.apiKey) return 'muse-spark-1.3';
    return local[0] || null;
  }

  // One question about one or more images. Local models get one image per call (Ollama vision models take one).
  async ask(images, prompt, { chatModel, signal, model, effort } = {}) {
    model = model || this.pick(chatModel);
    if (!model) throw new Error('No model can look at photos: add the Meta API key, or download a vision model in Settings → AI models → Local models (e.g. llama3.2-vision:11b).');
    const one = async (m, imgs) => {
      const content = [{ type: 'text', text: prompt }];
      for (const im of imgs) content.push({ type: 'image_url', image_url: { url: `data:${im.mime || 'image/jpeg'};base64,${im.buffer.toString('base64')}` } });
      const r = await this.api.complete({ model: m, messages: [{ role: 'user', content }], signal, ...(effort && models.isLocal(m) ? { effort } : {}) });
      return String(r.content || '').trim();
    };
    const run = async (m) => {
      if (!models.isLocal(m) || images.length <= 1) return one(m, images);
      const out = [];
      for (let i = 0; i < images.length; i++) out.push(`Picture ${i + 1}: ${await one(m, [images[i]])}`);
      return out.join('\n');
    };
    try { return { model, text: await run(model) }; } catch (e) {
      // fall back to the other local vision models in order (e.g. Llama 3.2 Vision → Qwen3-VL 2B → Glimmer);
      // this also covers the cloud being unreachable
      let err = e;
      for (const m of this.localVisionModels().filter((x) => x !== model)) {
        if (signal && signal.aborted) break;
        this.log(`vision: ${model} failed (${err.message}); trying ${m}`);
        try { const text = await run(m); this.lastFallback = { from: model, to: m, reason: err.message }; return { model: m, text }; } catch (e2) { err = e2; }
      }
      throw e;
    }
  }

  async describe(images, question, opts = {}) {
    const { model, text } = await this.ask(images, `Describe this picture for an assistant that cannot see it: what it shows, every important object (name it), where things are (left / centre / right, near / far), any visible text, and anything relevant to this request: "${String(question || '').slice(0, 300)}". Be factual and short.`, opts);
    return { model, text };
  }

  // Is the target in this robot photo? → { visible, bearing (degrees, - = left), distance_m, what }
  async locate(photo, target, opts = {}) {
    const prompt = `This photo is from a small robot car's front camera (about 60° wide, 10 cm above the floor). Is there "${target}" in it?\nReply with JSON only, no other text:\n{"visible": true or false, "position": "left" | "slightly left" | "centre" | "slightly right" | "right", "distance_m": number (metres from the car, estimate), "free_m": number (metres the car can drive straight ahead before touching a wall, furniture or any obstacle), "what": "short description of what you see"}`;
    const { model, text } = await this.ask([photo], prompt, opts);
    const j = parseJson(text);
    if (!j) {
      const no = /\b(no|not visible|cannot see|don't see|do not see)\b/i.test(text);
      return { visible: !no && new RegExp(String(target).split(/\s+/)[0], 'i').test(text), bearing: 0, distance_m: 1.5, what: text.slice(0, 200), model, raw: true };
    }
    return { visible: truthy(j.visible), bearing: bearingOf(j), distance_m: metres(j.distance_m), free_m: j.free_m == null ? null : Math.max(0, Math.min(6, metres(j.free_m, 0))), what: String(j.what || '').slice(0, 200), model };
  }

  // The model that measures (boxes + where the floor ends). Qwen3-VL is trained to give exact boxes; Llama 3.2 Vision
  // keeps describing. Settings → measureModel overrides.
  pickMeasure(chatModel) {
    const s = this.getSettings();
    if (s.measureModel && s.measureModel !== 'auto') return s.measureModel;
    const grounding = (this.ollama ? this.ollama.enabledModels() : []).filter((n) => /qwen[\d.]*-?vl/i.test(n) && models.has(`local:${n}`, 'vision'));
    return grounding.length ? `local:${grounding[0]}` : this.pick(chatModel);
  }

  // Measure in one robot photo: where the target is (box) and where the free floor ahead ends. Coordinates 0..1.
  // Distances come from the floor geometry (geometry.js), not from the model's guess. Two short "Detect …" prompts in
  // Qwen-VL's own style (one long combined prompt made Qwen3-VL 2B answer nothing), thinking off.
  async measure(photo, target, opts = {}) {
    const model = opts.model || this.pickMeasure(opts.chatModel);
    const t = await this.ground(photo, target, { ...opts, model });
    const ob = await this.ground(photo, 'the nearest obstacle standing on the floor straight ahead of the camera, in the middle of the picture (a wall, furniture, a box or any object)', { ...opts, model });
    // the obstacle only limits the way ahead when it is in the middle third of the picture
    const inPath = ob.box && ob.box[0] < 0.67 && ob.box[2] > 0.33;
    return { visible: !!t.box, box: t.box, floorEndY: inPath ? ob.box[3] : null, obstacle: ob.box ? ob.label : '', what: t.label || (t.box ? target : `no ${target}`), model: t.model };
  }

  // "Detect X" → { box: [x1, y1, x2, y2] in 0..1 or null, label }
  async ground(photo, what, opts = {}) {
    const { model, text } = await this.ask([photo], `Detect ${what}. Output its bbox_2d as JSON. If it is not in the picture, output [].`, { ...opts, effort: 'none' });
    const box = parseBox(text, photo.buffer);
    let label = '';
    try { const j = JSON.parse(String(text).replace(/```(?:json)?/g, '').trim()); const o = Array.isArray(j) ? j[0] : j; label = (o && (o.label || o.name)) || ''; } catch {}
    return { box, label: String(label).slice(0, 80), model, raw: text };
  }

  // Objects in one robot photo (room map with a local model, one photo at a time).
  async view(photo, opts = {}) {
    const prompt = 'This photo is from a small robot car\'s front camera (about 60° wide, 10 cm above the floor). List the main objects.\nReply with JSON only, no other text:\n{"description": "one short sentence", "objects": [{"name": "chair", "position": "left" | "slightly left" | "centre" | "slightly right" | "right", "distance_m": 1.2}], "free_m": metres the car can drive straight ahead before hitting something}';
    const { model, text } = await this.ask([photo], prompt, opts);
    const j = parseJson(text) || { description: text.slice(0, 200), objects: [] };
    return {
      model,
      description: String(j.description || '').slice(0, 200),
      free_m: Math.max(0, Math.min(6, metres(j.free_m, 1))),
      objects: (Array.isArray(j.objects) ? j.objects : []).slice(0, 8).map((o) => ({ name: String(o.name || '?').slice(0, 30), bearing: bearingOf(o), distance_m: metres(o.distance_m, 1) })),
    };
  }
}

module.exports = { Vision, parseJson, bearingOf, parseBox, jpegSize };
