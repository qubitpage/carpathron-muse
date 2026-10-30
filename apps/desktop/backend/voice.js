// Voice commands: WhatsApp voice notes (Ogg/Opus) -> 24 kHz mono 16-bit WAV -> Meta "Muse Voice Transcribe"
// (POST /v1/asr/transcribe, same Meta API key as the chat models). No ffmpeg or local model needed.
'use strict';

let decoderMod = null;
async function decodeOggOpus(buf) {
  if (!decoderMod) decoderMod = await import('ogg-opus-decoder');
  const dec = new decoderMod.OggOpusDecoder();
  await dec.ready;
  try {
    const r = await dec.decodeFile(new Uint8Array(buf));
    if (!r || !r.channelData || !r.channelData.length || !r.samplesDecoded) throw new Error('no audio in the voice note');
    return { channels: r.channelData, sampleRate: r.sampleRate || 48000 };
  } finally { try { dec.free(); } catch {} }
}

// Mix to mono, low-pass + resample to `rate`, encode as 16-bit PCM WAV.
function toWav({ channels, sampleRate }, rate = 24000) {
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  const ratio = sampleRate / rate;
  const outLen = Math.floor(n / ratio);
  const pcm = Buffer.alloc(outLen * 2);
  const win = Math.max(1, Math.round(ratio)); // box filter over the source samples of each output sample
  for (let o = 0; o < outLen; o++) {
    const start = Math.floor(o * ratio);
    let sum = 0, cnt = 0;
    for (let k = 0; k < win && start + k < n; k++) { sum += mono[start + k]; cnt++; }
    const v = Math.max(-1, Math.min(1, cnt ? sum / cnt : 0));
    pcm.writeInt16LE(Math.round(v * 32767), o * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return { wav: Buffer.concat([h, pcm]), seconds: outLen / rate };
}

async function oggToWav(buf) { return toWav(await decodeOggOpus(buf)); }

const isWav = (buf) => buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
const isOgg = (buf) => buf.length > 4 && buf.toString('ascii', 0, 4) === 'OggS';

// Any audio file -> WAV for Muse Voice Transcribe: WAV and Ogg/Opus here in Node; MP3, M4A, WebM, FLAC… through
// the desktop app's built-in Chromium decoder.
async function anyToWav(buf, mime = '') {
  buf = Buffer.from(buf);
  if (isWav(buf)) {
    try { return normalizeWav(buf); } catch {} // e.g. 24/32-bit or float WAV: decode below
  } else if (isOgg(buf)) {
    try { return await oggToWav(buf); } catch {} // Ogg Vorbis: decode below
  }
  const decoded = await require('./render').decodeAudio(buf).catch((e) => { throw new Error(`Could not read this audio file (${mime || 'unknown type'}): ${e.message}`); });
  if (!decoded) throw new Error(`This audio format (${mime || 'unknown'}) can be converted only in the desktop app. Use WAV or OGG.`);
  return toWav(decoded);
}

// Any 16-bit PCM WAV (e.g. 44.1/48 kHz stereo from the Quest microphone) -> channels as floats.
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + len));
    p += 8 + len + (len % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('WAV must be 16-bit PCM');
  const n = Math.floor(data.length / 2 / fmt.channels);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.channels; c++) channels[c][i] = data.readInt16LE((i * fmt.channels + c) * 2) / 32768;
  return { channels, sampleRate: fmt.rate };
}
function normalizeWav(buf) { return toWav(decodeWav(buf)); }

// Returns the transcript text ('' if nothing was heard).
async function transcribe(audio, { apiKey, apiBase = 'https://api.meta.ai/v1', mime = 'audio/ogg', languageBias } = {}) {
  if (!apiKey) throw new Error('Voice notes need the Meta API key (Settings → Meta API key): they are transcribed with Muse Voice Transcribe.');
  const { wav, seconds } = await anyToWav(audio, mime);
  if (seconds < 0.2) return '';
  if (seconds > 600) throw new Error('Voice note is longer than 10 minutes.');
  const request = { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' };
  if (languageBias && languageBias.length) request.languageBias = languageBias;
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'voice.wav');
  const base = String(apiBase || 'https://api.meta.ai/v1').replace(/\/+$/, '');
  const res = await fetch(`${base}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 300);
    try { const j = JSON.parse(body); msg = j.error?.message || j.message || msg; } catch {}
    throw new Error(`Voice transcription failed (HTTP ${res.status}): ${msg}`);
  }
  let text = '';
  try {
    const j = JSON.parse(body);
    text = j.transcript || (Array.isArray(j.turns) ? j.turns.map((t) => t.transcript || '').join(' ') : '') || j.text || '';
  } catch { text = body; }
  return String(text).trim();
}

// Short spoken robot commands -> the same quick commands WhatsApp text supports (no AI call, instant).
// Anything longer goes to the AI agent, which has the robot tools.
function voiceToCommand(t) {
  const s = String(t || '').toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || s.split(' ').length > 6) return null;
  const secs = (() => {
    const m = s.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?\b/);
    if (m) return Number(m[1]);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
    for (const [w, v] of Object.entries(words)) if (new RegExp(`\\b${w}\\b`).test(s)) return v;
    return null;
  })();
  const sec = secs ? ` ${secs}` : '';
  if (/^(stop|halt|brake|freeze)\b/.test(s) || s === 'stop the car' || s === 'stop robot') return '/robot stop';
  if (/\b(scan|map)\b.*\b(room|area|around)\b|^(scan|map the room|scan room)$/.test(s)) return '/scan';
  const look = s.match(/\b(look|see|show me|what'?s|what is)\b.*\b(left|right|behind|back|front|ahead)\b/);
  if (look) return `/look ${{ behind: 'back', ahead: 'front' }[look[2]] || look[2]}`;
  const turn = s.match(/\b(turn|rotate|spin)\b.*?\b(left|right|around)\b/);
  if (turn && /\b(degrees?|around)\b/.test(s)) {
    const deg = turn[2] === 'around' ? 180 : (Number((s.match(/(\d{1,3})/) || [])[1]) || 90);
    return `/turn ${turn[2] === 'left' ? -deg : deg}`;
  }
  if (/\b(photo|picture|pic|snapshot)\b/.test(s)) return '/photo';
  if (/\b(forward|forwards|ahead|straight)\b/.test(s) || /^go$/.test(s)) return `/drive forward${sec}`;
  if (/\b(back|backward|backwards|reverse)\b/.test(s)) return `/drive back${sec}`;
  if (/\b(turn |spin |go )?left\b/.test(s)) return `/drive left${sec}`;
  if (/\b(turn |spin |go )?right\b/.test(s)) return `/drive right${sec}`;
  return null;
}

module.exports = { decodeOggOpus, toWav, oggToWav, anyToWav, decodeWav, normalizeWav, transcribe, voiceToCommand };
