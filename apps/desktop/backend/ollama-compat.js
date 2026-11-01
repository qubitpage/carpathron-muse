// Compatibility runner for Meta's Llama 3.2 Vision (architecture "mllama").
// Ollama 0.30+ runs models with llama.cpp, which never implemented mllama ("unknown model architecture: 'mllama'").
// Ollama 0.24.0 still runs it with its own engine. Muse Glimmer needs Ollama 0.32.8+, so instead of downgrading we keep
// the main Ollama and run a private copy of 0.24.0 next to it, only for mllama models:
//  - downloaded once from GitHub (ollama-windows-amd64.zip) into %LOCALAPPDATA%\Carpathron\ollama-0.24.0
//  - started on 127.0.0.1:11435 with the SAME model folder (no second download of the model)
//  - only one of the two servers keeps a model on the GPU at a time (8 GB cards): the other one is asked to unload first
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const VERSION = '0.24.0';
const PORT = 11435;
const URL_ZIP = `https://github.com/ollama/ollama/releases/download/v${VERSION}/ollama-windows-amd64.zip`;
const COMPAT_FAMILIES = /^(mllama)$/i;

const needsCompat = (details) => {
  const fams = [details && details.family, ...((details && details.families) || [])].filter(Boolean);
  return fams.some((f) => COMPAT_FAMILIES.test(String(f)));
};

class CompatOllama {
  constructor({ main, emit, log, dir, url }) {
    this.main = main; // the main Ollama (for the model folder and to free the GPU)
    this.emit = emit || (() => {}); this.log = log || (() => {});
    this._dir = dir; this._url = url || URL_ZIP;
    this.installing = null;
    this.models = new Set(); // model names that need this runner (filled by Ollama.status())
  }
  dir() { return this._dir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Carpathron', `ollama-${VERSION}`); }
  exe() {
    for (const n of ['ollama.exe', 'ollama']) { const f = path.join(this.dir(), n); if (fs.existsSync(f)) return f; }
    return null;
  }
  root() { return `http://127.0.0.1:${PORT}`; }
  base() { return `${this.root()}/v1`; }
  uses(name) { return this.models.has(String(name)) || this.models.has(String(name).replace(/:latest$/, '')) || this.models.has(`${name}:latest`); }

  async api(p, { method = 'GET', body, timeoutMs = 10000 } = {}) {
    const res = await fetch(`${this.root()}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (!res.ok) throw new Error((j && j.error) || `${res.status} ${text.slice(0, 200)}`);
    return j;
  }

  async status() {
    const out = { version: VERSION, port: PORT, installed: !!this.exe(), running: false, installing: this.installing, models: [...this.models] };
    try { await this.api('/api/version', { timeoutMs: 1500 }); out.running = true; } catch {}
    return out;
  }

  // Download and unpack Ollama 0.24.0 (about 1–2 GB with the CUDA libraries). Progress goes to the UI as local:compat.
  install() {
    if (this.installing && this.installing.status === 'downloading') return { started: false, message: 'Already downloading.' };
    if (process.platform !== 'win32' && !this._dir) throw new Error('The compatibility runner is set up automatically on Windows only.');
    const st = this.installing = { status: 'downloading', completed: 0, total: 0, message: `Downloading Ollama ${VERSION}…` };
    const tick = () => this.emit('local:compat', { ...st });
    (async () => {
      const dir = this.dir();
      fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(dir, 'ollama.zip');
      try {
        const res = await fetch(this._url, { redirect: 'follow' });
        if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
        st.total = Number(res.headers.get('content-length')) || 0;
        const out = fs.createWriteStream(zip);
        let last = 0;
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          st.completed += chunk.length;
          if (Date.now() - last > 500) { last = Date.now(); tick(); }
        }
        await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
        st.status = 'unpacking'; st.message = 'Unpacking…'; tick();
        await this.unzip(zip, dir);
        try { fs.unlinkSync(zip); } catch {}
        if (!this.exe()) throw new Error('ollama.exe was not found in the download');
        st.message = 'Starting…'; tick();
        let note = '';
        await this.start().catch((e) => { note = ` — but it did not start yet: ${e.message}`; });
        st.status = 'done'; st.message = `Compatibility runner (Ollama ${VERSION}) is ready${note}`;
        this.log(st.message);
      } catch (e) {
        st.status = 'error'; st.message = e.message;
        try { fs.unlinkSync(zip); } catch {}
      } finally {
        tick();
        setTimeout(() => { if (this.installing === st) this.installing = null; }, 60000);
      }
    })();
    return { started: true };
  }

  unzip(zip, dir) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`], { windowsHide: true, timeout: 600000 }, (e, so, se) => (e ? reject(new Error(String(se || e.message).slice(0, 300))) : resolve()));
      } else {
        execFile('unzip', ['-o', '-q', zip, '-d', dir], { timeout: 600000 }, (e, so, se) => (e ? reject(new Error(String(se || e.message).slice(0, 300))) : resolve()));
      }
    });
  }

  async start() {
    try { await this.api('/api/version', { timeoutMs: 1500 }); return { ok: true, already: true }; } catch {}
    const exe = this.exe();
    if (!exe) throw new Error(`The compatibility runner is not set up yet (Settings → AI models → Local models → "Set up").`);
    const env = { ...process.env, OLLAMA_HOST: `127.0.0.1:${PORT}`, OLLAMA_MODELS: this.main.modelsDir(), OLLAMA_KEEP_ALIVE: '2m', OLLAMA_CONTEXT_LENGTH: '8192' };
    const child = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.unref();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { const v = await this.api('/api/version', { timeoutMs: 1500 }); this.log(`compatibility runner: Ollama ${v.version} on port ${PORT}`); return { ok: true, version: v.version }; } catch {}
    }
    throw new Error('The compatibility runner did not start within 20 seconds.');
  }
  async ensureRunning() {
    try { await this.api('/api/version', { timeoutMs: 1500 }); return true; } catch {}
    if (!this.exe()) return false;
    try { await this.start(); return true; } catch { return false; }
  }

  // Free the GPU: unload every model this server holds (keep_alive 0).
  async unloadAll() {
    try {
      const ps = await this.api('/api/ps', { timeoutMs: 2000 });
      for (const m of ps.models || []) await this.api('/api/generate', { method: 'POST', body: { model: m.name, keep_alive: 0 }, timeoutMs: 20000 }).catch(() => {});
      return (ps.models || []).length;
    } catch { return 0; }
  }
}

module.exports = { CompatOllama, needsCompat, VERSION, PORT };
