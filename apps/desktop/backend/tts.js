// The robot's voice: offline neural speech (sherpa-onnx with Kokoro or KittenTTS voices, Apache-2.0) + the robot effect.
// The voice model downloads once (Robot → Control → 🗣 Voice) into <data>/voices and then works without internet.
// Sentences are made in a separate process (ttsworker.js) so the app never stutters.
'use strict';
const fs = require('fs');
const path = require('path');
const { fork, execFile } = require('child_process');
const crypto = require('crypto');

const MODELS = {
  kokoro: { id: 'kokoro', kind: 'kokoro', name: 'kokoro-int8-en-v0_19', file: 'model.int8.onnx', mb: 103, label: 'Kokoro (most natural, 100 MB)', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2' },
  kitten: { id: 'kitten', kind: 'kitten', name: 'kitten-nano-en-v0_1-fp16', file: 'model.fp16.onnx', mb: 27, label: 'KittenTTS (light and fast, 27 MB)', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2' },
};
const VOICES = {
  bella: { label: 'Bella — cute robot', model: 'kokoro', sid: 1, preset: 'baby' },
  michael: { label: 'Michael — WALL-E style workbot', model: 'kokoro', sid: 6, preset: 'wall' },
  emma: { label: 'Emma — British cute robot', model: 'kokoro', sid: 7, preset: 'baby' },
  sky: { label: 'Sky — clear robot', model: 'kokoro', sid: 4, preset: 'clear' },
  kitten: { label: 'Kitten — light and fast workbot', model: 'kitten', sid: 0, preset: 'wall' },
  kittenf: { label: 'Kitten — light and fast, female', model: 'kitten', sid: 3, preset: 'clear' },
};

class Tts {
  constructor({ dataDir, getSettings, log = () => {} }) {
    this.dataDir = dataDir; this.getSettings = getSettings; this.log = log;
    this.dir = path.join(dataDir, 'voices'); this.outDir = path.join(this.dir, 'out');
    fs.mkdirSync(this.outDir, { recursive: true });
    this.worker = null; this.pending = new Map(); this.downloads = {};
  }
  engineDir() {
    const c = [];
    if (process.env.MC_VOICE_ENGINE_DIR) c.push(process.env.MC_VOICE_ENGINE_DIR);
    if (process.resourcesPath) c.push(path.join(process.resourcesPath, 'voice-engine', 'node_modules'));
    c.push(path.join(__dirname, '..', 'build', 'voice-engine', 'node_modules'));
    return c.find((d) => fs.existsSync(path.join(d, 'sherpa-onnx-node', 'package.json'))) || null;
  }
  modelDir(id) { return path.join(this.dir, MODELS[id].name); }
  installed(id) { const m = MODELS[id]; return fs.existsSync(path.join(this.modelDir(id), m.file)) && fs.existsSync(path.join(this.modelDir(id), 'tokens.txt')); }
  voiceId() { const v = (this.getSettings().robot || {}).voice; return VOICES[v] ? v : 'bella'; }
  status() {
    return { engine: !!this.engineDir(), voice: this.voiceId(), voices: Object.entries(VOICES).map(([id, v]) => ({ id, ...v, ready: this.installed(v.model) })),
      models: Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, { label: m.label, mb: m.mb, installed: this.installed(id), downloading: this.downloads[id] || null }])) };
  }
  ready(voiceId = this.voiceId()) { const v = VOICES[voiceId]; return !!(v && this.engineDir() && this.installed(v.model)); }

  // ---- download a voice model (once)
  async download(id, onProgress = () => {}) {
    const m = MODELS[id];
    if (!m) throw new Error('unknown voice model');
    if (this.installed(id)) return { ok: true, already: true };
    if (this.downloads[id]) throw new Error('already downloading');
    this.downloads[id] = { pct: 0 };
    const tmp = path.join(this.dir, `${m.name}.tar.bz2.part`);
    try {
      const res = await fetch(m.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
      const total = Number(res.headers.get('content-length')) || m.mb * 1e6;
      const out = fs.createWriteStream(tmp);
      let got = 0, last = 0;
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        const pct = Math.floor((got * 100) / total);
        if (pct !== last) { last = pct; this.downloads[id] = { pct }; onProgress(pct); }
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      this.downloads[id] = { pct: 100, unpacking: true }; onProgress(100);
      // 2.2.2: unpack the .bz2 here (pure JavaScript) — Windows' own tar.exe often cannot run "bzip2 -d" — then let
      // tar unpack the plain .tar, which every tar can do
      const plain = tmp.replace(/\.tar\.bz2\.part$/, '.tar.part');
      await new Promise((resolve, reject) => {
        const src = fs.createReadStream(tmp), dst = fs.createWriteStream(plain);
        src.on('error', reject); dst.on('error', reject); dst.on('finish', resolve);
        src.pipe(require('unbzip2-stream')()).on('error', (e) => reject(new Error(`unpacking failed: the download is damaged (${e.message || e})`))).pipe(dst);
      });
      try {
        await new Promise((resolve, reject) => execFile(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', plain, '-C', this.dir], { timeout: 600000 }, (e) => (e ? reject(new Error(`unpacking failed: ${e.message}`)) : resolve())));
      } finally { try { fs.unlinkSync(plain); } catch {} }
      if (!this.installed(id)) throw new Error('the voice files are incomplete after unpacking');
      this.log(`Robot voice ${m.label} installed`);
      return { ok: true };
    } finally { try { fs.unlinkSync(tmp); } catch {} delete this.downloads[id]; }
  }

  // ---- speak: text → WAV file in the robot voice
  ensureWorker() {
    if (this.worker) return this.worker;
    const eng = this.engineDir();
    if (!eng) throw new Error('the speech engine is not included in this installation');
    // the native libraries sit next to the addon; the system loader must be told where (PATH on Windows)
    const lib = path.join(eng, `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', MC_VOICE_ENGINE: eng };
    const key = process.platform === 'win32' ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH' : process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
    env[key] = env[key] ? `${lib}${path.delimiter}${env[key]}` : lib;
    const w = fork(path.join(__dirname, 'ttsworker.js'), [], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let err = '';
    w.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    w.on('message', (m) => { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.t); m.ok ? p.resolve(m) : p.reject(new Error(m.error)); } });
    w.on('exit', (code) => { for (const p of this.pending.values()) p.reject(new Error(`speech worker stopped (${code}) ${err.slice(-300)}`)); this.pending.clear(); this.worker = null; });
    return (this.worker = w);
  }
  async speak(text, { voice = this.voiceId(), rate = 1 } = {}) {
    const v = VOICES[voice] || VOICES.bella, m = MODELS[v.model];
    if (!this.installed(v.model)) throw new Error('voice not downloaded');
    const id = crypto.randomBytes(6).toString('hex'), out = path.join(this.outDir, `${id}.wav`);
    this.cleanup();
    const w = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('speech took too long')); }, 60000);
      this.pending.set(id, { resolve: (r) => resolve({ ...r, id, url: `/api/robot/voice/audio/${id}.wav` }), reject, t });
      w.send({ id, text, sid: v.sid, preset: v.preset, rate, out, model: { id: m.id, kind: m.kind, file: m.file, dir: this.modelDir(v.model) } });
    });
  }
  file(name) { return /^[a-f0-9]{12}\.wav$/.test(name) && fs.existsSync(path.join(this.outDir, name)) ? path.join(this.outDir, name) : null; }
  cleanup() { try { const now = Date.now(); for (const f of fs.readdirSync(this.outDir)) { const p = path.join(this.outDir, f); if (now - fs.statSync(p).mtimeMs > 10 * 60000) fs.unlinkSync(p); } } catch {} }
  close() { try { this.worker && this.worker.kill(); } catch {} }
}

module.exports = { Tts, VOICES, MODELS };
