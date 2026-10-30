// What each Meta model can do, and the calls for the models that are not chat models
// (Muse Image, SAM 3.1 segmentation, Muse Voice Transcribe) plus web search grounding.
// Source: dev.meta.ai/docs/models (checked Oct 2026).
'use strict';
const fs = require('fs');
const path = require('path');

const CHAT_CAPS = ['text', 'vision', 'video', 'audio', 'pdf', 'tools', 'reasoning', 'search', 'json'];
const KNOWN = {
  'muse-wonder-1.0': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], context: 1048576, note: 'Preview — strongest reasoning' },
  'muse-spark-1.3': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], context: 1048576, note: 'Latest Spark — recommended' },
  'muse-spark-1.3-contributor': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1048576, note: 'Contributor mode' },
  'muse-spark-1.2': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1048576 },
  'muse-spark-1.2-contributor': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1048576 },
  'muse-spark-1.1': { kind: 'chat', caps: CHAT_CAPS, effort: ['minimal', 'low', 'medium', 'high', 'xhigh'], context: 1048576 },
  'muse-image-1.0': { kind: 'image', caps: ['text', 'vision', 'image-out'], note: 'Image generation and editing' },
  'sam-3.1': { kind: 'segment', caps: ['vision', 'video', 'segmentation'], note: 'Segment Anything: finds objects, returns boxes and masks' },
  'muse-voice-transcribe-1.0': { kind: 'transcribe', caps: ['audio', 'transcription'], note: 'Speech to text' },
};
const CAP_LABEL = {
  text: 'Text', vision: 'Images', video: 'Video', audio: 'Audio', pdf: 'PDF', tools: 'Tools', reasoning: 'Reasoning', search: 'Web search',
  json: 'JSON', 'image-out': 'Makes images', segmentation: 'Segmentation', transcription: 'Speech→text',
};

function capsFor(id) {
  const k = String(id || '');
  if (KNOWN[k]) return { id: k, ...KNOWN[k] };
  if (/sam/i.test(k)) return { id: k, kind: 'segment', caps: ['vision', 'segmentation'] };
  if (/image|imagine|emu/i.test(k)) return { id: k, kind: 'image', caps: ['text', 'image-out'] };
  if (/voice|asr|transcri|whisper/i.test(k)) return { id: k, kind: 'transcribe', caps: ['audio', 'transcription'] };
  if (/tts|speech/i.test(k)) return { id: k, kind: 'speech', caps: ['text', 'audio-out'] };
  // unknown chat model: assume text + tools; vision is detected on first refusal
  return { id: k, kind: 'chat', caps: ['text', 'tools'], effort: [] };
}
const has = (id, cap) => capsFor(id).caps.includes(cap);

function withCaps(list) {
  const ids = new Set(list.map((m) => m.id));
  for (const id of Object.keys(KNOWN)) if (!ids.has(id)) list.push({ id, label: id, notListed: true });
  return list.map((m) => {
    const c = capsFor(m.id);
    return { ...m, kind: c.kind, caps: c.caps, capLabels: c.caps.map((x) => CAP_LABEL[x] || x), effort: c.effort || [], note: c.note || '' };
  });
}

function mimeOf(file) {
  const e = path.extname(file).toLowerCase();
  return { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }[e] || 'application/octet-stream';
}
const dataUrl = (buf, mime) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

class Media {
  constructor({ getSettings }) { this.getSettings = getSettings; }
  base() { return String(this.getSettings().apiBase || 'https://api.meta.ai/v1').replace(/\/+$/, ''); }
  key() {
    const k = this.getSettings().apiKey;
    if (!k) throw new Error('This needs the Meta API key (Settings → Meta API key).');
    return k;
  }
  async post(p, body, { signal, accept = 'application/json', timeoutMs = 180000 } = {}) {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const res = await fetch(`${this.base()}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept, Authorization: `Bearer ${this.key()}` }, body: JSON.stringify(body), signal: sig });
    const txt = await res.text();
    if (!res.ok) {
      let m = txt; try { const j = JSON.parse(txt); m = j.error?.message || j.message || txt; } catch {}
      throw new Error(`Meta API ${res.status} on ${p}: ${String(m).slice(0, 400)}`);
    }
    return txt;
  }

  // Muse Image: new image from a prompt, or an edit of given images.
  async image({ prompt, inputs = [], size, n = 1, format = 'png', model = 'muse-image-1.0', signal }) {
    const body = { model, prompt: String(prompt), n: Math.max(1, Math.min(4, Number(n) || 1)), output_format: format };
    if (size) body.size = String(size);
    let p = '/images/generations';
    if (inputs.length) {
      p = '/images/edits';
      body.images = inputs.slice(0, 10).map((f) => ({ image_url: dataUrl(fs.readFileSync(f), mimeOf(f)) }));
    }
    const j = JSON.parse(await this.post(p, body, { signal }));
    const out = [];
    for (const d of j.data || []) {
      if (d.b64_json) out.push(Buffer.from(d.b64_json, 'base64'));
      else if (d.url) { const r = await fetch(d.url, { signal }); out.push(Buffer.from(await r.arrayBuffer())); }
    }
    if (!out.length) throw new Error('Muse Image returned no image.');
    return { images: out, format: j.output_format || format };
  }

  // SAM 3.1: segment objects named in `prompt` (or point/box tokens) in an image or video.
  async segment({ file, prompt, model = 'sam-3.1', signal }) {
    const mime = mimeOf(file);
    const media = mime.startsWith('video/')
      ? { type: 'input_video', video_url: dataUrl(fs.readFileSync(file), mime) }
      : { type: 'input_image', image_url: dataUrl(fs.readFileSync(file), mime) };
    const body = { model, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: String(prompt || 'object') }, media] }], stream: false, metadata: { include_confidence: 'true' } };
    const raw = await this.post('/responses', body, { signal });
    let text = '';
    try {
      const j = JSON.parse(raw);
      text = j.output_text || (j.output || []).flatMap((o) => o.content || []).map((c) => c.text || '').join('');
    } catch { text = raw; }
    return parseSam(text);
  }

  // Muse Voice Transcribe for a WAV/OGG file.
  async transcribe(file) {
    const voice = require('./voice');
    const s = this.getSettings();
    return voice.transcribe(fs.readFileSync(file), { apiKey: s.apiKey, apiBase: s.apiBase, mime: mimeOf(file) });
  }

  // Web search with Meta search grounding (Responses API). Returns { answer, sources: [{title,url,snippet}] }.
  async search({ query, model, size = 'medium', signal }) {
    const s = this.getSettings();
    const body = {
      model: model && has(model, 'search') ? model : (has(s.model, 'search') ? s.model : 'muse-spark-1.3'),
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Search the web and answer with facts and sources: ${query}` }] }],
      tools: [{ type: 'web_search', search_context_size: size }],
      include: ['web_search_call.results'],
      stream: false,
    };
    const j = JSON.parse(await this.post('/responses', body, { signal, timeoutMs: 120000 }));
    const sources = []; const seen = new Set();
    let answer = '';
    for (const o of j.output || []) {
      if (o.type === 'web_search_call') for (const r of o.results || []) if (r.url && !seen.has(r.url)) { seen.add(r.url); sources.push({ title: r.title || r.url, url: r.url, snippet: r.snippet || '' }); }
      if (o.type === 'message') for (const c of o.content || []) {
        if (c.text) answer += c.text;
        for (const a of c.annotations || []) if (a.url && !seen.has(a.url)) { seen.add(a.url); sources.push({ title: a.title || a.url, url: a.url, snippet: '' }); }
      }
    }
    if (!answer && j.output_text) answer = j.output_text;
    return { answer, sources };
  }
}

// SAM output: one line per frame, records like <|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|> and <|mask;...;data=H,W,~payload|>
function parseSam(text) {
  const boxes = [];
  const re = /<\|box;([^|]*)\|>/g;
  let m;
  while ((m = re.exec(text))) {
    const f = Object.fromEntries(m[1].split(';').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k, Number(v)]));
    boxes.push({ x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, w: f.w, h: f.h, conf: Number.isFinite(f.c) ? f.c : null });
  }
  const masks = (text.match(/<\|mask;/g) || []).length;
  return { boxes, masks, raw: text };
}

module.exports = { KNOWN, capsFor, has, withCaps, Media, parseSam, mimeOf, dataUrl, CAP_LABEL };
