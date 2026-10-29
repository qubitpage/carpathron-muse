// Remote servers over SSH (VPS / dedicated servers): saved once with encrypted credentials, connections are
// kept open and reused, so the agent can work on a server like on this PC (commands, files, interactive shells).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('ssh2');

const MAX_OUT = 60000;
const posix = path.posix;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
const clip = (s, n = MAX_OUT) => (s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} characters]` : s);

class Remote {
  constructor({ store, secrets, log, emit }) {
    this.store = store;
    this.secrets = secrets;
    this.log = log || (() => {});
    this.emit = emit || (() => {});
    this.conns = new Map(); // serverId -> { client, ready: Promise, os, home }
    this.shells = new Map(); // shellId -> { serverId, stream, buf, closed }
    if (!Array.isArray(this.store.settings.servers)) this.store.settings.servers = [];
  }

  // ------------------------------------------------------------ saved servers
  servers() { return this.store.settings.servers || []; }
  publicList() {
    return this.servers().map((s) => ({
      id: s.id, name: s.name, host: s.host, port: s.port, username: s.username, defaultPath: s.defaultPath || '',
      auth: s.privateKey || s.keyPath ? 'key' : s.password ? 'password' : 'agent', keyPath: s.keyPath || '',
      hasPassword: !!s.password, hasKey: !!s.privateKey, hasPassphrase: !!s.passphrase,
      fingerprint: s.fingerprint || '', os: s.os || '', connected: this.conns.has(s.id) && !!this.conns.get(s.id).ok,
      lastUsed: s.lastUsed || 0,
    }));
  }
  find(ref) {
    const r = String(ref || '').trim().toLowerCase();
    if (!r) return null;
    return this.servers().find((s) => s.id === ref) || this.servers().find((s) => (s.name || '').toLowerCase() === r)
      || this.servers().find((s) => (s.host || '').toLowerCase() === r || `${s.username}@${s.host}`.toLowerCase() === r) || null;
  }
  need(ref) {
    const s = this.find(ref);
    if (!s) {
      const names = this.servers().map((x) => x.name).join(', ') || 'none saved yet';
      throw new Error(`Unknown server "${ref}". Saved servers: ${names}. Add servers in Settings → Remote servers.`);
    }
    return s;
  }

  save(input) {
    const list = this.servers();
    let s = input.id ? list.find((x) => x.id === input.id) : null;
    const isNew = !s;
    if (!s) s = { id: crypto.randomUUID(), createdAt: Date.now() };
    const host = String(input.host ?? s.host ?? '').trim();
    if (!host) throw new Error('Host is required');
    s.name = String(input.name || s.name || host).trim().slice(0, 60);
    s.host = host;
    s.port = Math.max(1, Math.min(65535, Number(input.port || s.port || 22)));
    s.username = String(input.username ?? s.username ?? 'root').trim() || 'root';
    s.defaultPath = String(input.defaultPath ?? s.defaultPath ?? '').trim();
    s.keyPath = String(input.keyPath ?? s.keyPath ?? '').trim();
    if (typeof input.password === 'string' && input.password) s.password = this.secrets.encrypt(input.password);
    if (typeof input.privateKey === 'string' && input.privateKey.trim()) s.privateKey = this.secrets.encrypt(input.privateKey.trim() + '\n');
    if (typeof input.passphrase === 'string' && input.passphrase) s.passphrase = this.secrets.encrypt(input.passphrase);
    if (input.clearPassword) delete s.password;
    if (input.clearKey) delete s.privateKey;
    if (input.resetFingerprint || (!isNew && (input.host || input.port))) delete s.fingerprint;
    if (isNew) list.push(s);
    this.store.settings.servers = list;
    this.store.saveSettings();
    this.disconnect(s.id);
    return this.publicList().find((x) => x.id === s.id);
  }

  remove(id) {
    this.disconnect(id);
    this.store.settings.servers = this.servers().filter((s) => s.id !== id);
    this.store.saveSettings();
  }

  // ------------------------------------------------------------ connections
  disconnect(id) {
    const c = this.conns.get(id);
    if (c) { this.conns.delete(id); try { c.client.end(); } catch {} }
    for (const [sid, sh] of this.shells) if (sh.serverId === id) this.shells.delete(sid);
  }
  closeAll() { for (const id of [...this.conns.keys()]) this.disconnect(id); }

  async connect(ref, { timeoutMs = 20000 } = {}) {
    const s = typeof ref === 'object' ? ref : this.need(ref);
    const cur = this.conns.get(s.id);
    if (cur && cur.ok) return cur;
    if (cur && cur.pending) return cur.pending;
    const entry = { client: new Client(), ok: false };
    this.conns.set(s.id, entry);
    entry.pending = new Promise((resolve, reject) => {
      const cfg = {
        host: s.host, port: s.port || 22, username: s.username || 'root',
        readyTimeout: timeoutMs, keepaliveInterval: 15000, keepaliveCountMax: 4, tryKeyboard: true,
        hostHash: 'sha256',
        hostVerifier: (fp) => {
          const hex = Buffer.isBuffer(fp) ? fp.toString('hex') : String(fp);
          if (!s.fingerprint) { s.fingerprint = hex; this.store.saveSettings(); this.log(`SSH ${s.name}: host key saved (${hex.slice(0, 16)}…)`); return true; }
          if (s.fingerprint === hex) return true;
          entry.hostKeyChanged = true;
          return false;
        },
      };
      try {
        if (s.password) cfg.password = this.secrets.decrypt(s.password);
        if (s.privateKey) cfg.privateKey = this.secrets.decrypt(s.privateKey);
        else if (s.keyPath) cfg.privateKey = fs.readFileSync(s.keyPath.replace(/^~(?=$|[\\/])/, os.homedir()));
        if (s.passphrase) cfg.passphrase = this.secrets.decrypt(s.passphrase);
      } catch (e) { reject(new Error(`Cannot read the saved credentials for ${s.name}: ${e.message}`)); return; }
      if (!cfg.password && !cfg.privateKey) {
        if (process.platform === 'win32') cfg.agent = 'pageant';
        else if (process.env.SSH_AUTH_SOCK) cfg.agent = process.env.SSH_AUTH_SOCK;
      }
      const c = entry.client;
      c.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => cfg.password || '')));
      c.on('ready', async () => {
        entry.ok = true;
        try {
          const r = await this._run(c, 'uname -s 2>/dev/null || echo WINDOWS', 15000);
          entry.os = /linux|darwin|bsd|sunos|aix/i.test(r.stdout) ? r.stdout.trim().toLowerCase() : 'windows';
          const hr = await this._run(c, entry.os === 'windows' ? 'echo %USERPROFILE%' : 'printf %s "$HOME"', 15000);
          entry.home = hr.stdout.trim() || (entry.os === 'windows' ? 'C:\\' : '/root');
        } catch { entry.os = 'linux'; entry.home = '/root'; }
        s.os = entry.os; s.lastUsed = Date.now(); this.store.saveSettings();
        this.log(`SSH connected: ${s.name} (${s.username}@${s.host}:${s.port}, ${entry.os})`);
        this.emit('remote:status', this.publicList());
        resolve(entry);
      });
      c.on('error', (e) => {
        this.conns.delete(s.id);
        if (entry.hostKeyChanged) reject(new Error(`The host key of ${s.name} (${s.host}) CHANGED since it was saved. This can mean the server was reinstalled — or that someone is intercepting the connection. If you reinstalled it, open Settings → Remote servers → Reset host key.`));
        else if (/authentication/i.test(e.message)) reject(new Error(`SSH login to ${s.name} failed: wrong user, password or key (${e.message}).`));
        else reject(new Error(`SSH ${s.name}: ${e.message}`));
      });
      c.on('close', () => { if (this.conns.get(s.id) === entry) this.conns.delete(s.id); this.emit('remote:status', this.publicList()); });
      c.connect(cfg);
    });
    try { return await entry.pending; } finally { delete entry.pending; }
  }

  _run(client, command, timeoutMs, { signal, onData } = {}) {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '', stderr = '', done = false, timedOut = false, stopped = false;
        const finish = (code) => { if (done) return; done = true; clearTimeout(t); signal?.removeEventListener('abort', onAbort); resolve({ stdout, stderr, code, timedOut, stopped }); };
        const kill = () => { try { stream.signal('KILL'); } catch {} try { stream.close(); } catch {} };
        const t = setTimeout(() => { timedOut = true; kill(); setTimeout(() => finish(null), 1500); }, timeoutMs);
        const onAbort = () => { stopped = true; kill(); setTimeout(() => finish(null), 800); };
        signal?.addEventListener('abort', onAbort, { once: true });
        stream.on('data', (d) => { if (stdout.length < MAX_OUT * 2) stdout += d.toString('utf8'); onData?.(d); });
        stream.stderr.on('data', (d) => { if (stderr.length < MAX_OUT) stderr += d.toString('utf8'); });
        stream.on('close', (code) => finish(code));
      });
    });
  }

  // Runs a command in a folder on the server. Returns readable output like the local run_command.
  async exec(ref, command, { cwd, timeoutMs = 120000, signal } = {}) {
    const s = this.need(ref);
    const e = await this.connect(s);
    let full;
    if (e.os === 'windows') full = `powershell -NoLogo -NoProfile -NonInteractive -Command ${JSON.stringify(`${cwd ? `Set-Location -LiteralPath ${psq(cwd)}; ` : ''}${command}`)}`;
    else full = `${cwd ? `cd ${shq(cwd)} && ` : ''}${command}`;
    if (e.os !== 'windows') full = `bash -lc ${shq(full)}`;
    const r = await this._run(e.client, full, timeoutMs, { signal });
    s.lastUsed = Date.now();
    let out = (r.stdout + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '')).trim() || '(no output)';
    out = clip(out);
    if (r.timedOut) out += `\n[stopped after ${Math.round(timeoutMs / 1000)} s timeout]`;
    else if (r.stopped) out += '\n[stopped by user]';
    else out += `\n[exit code ${r.code}]`;
    return out;
  }

  async sftp(ref) {
    const e = await this.connect(ref);
    if (e.sftp) return e.sftp;
    e.sftp = await new Promise((resolve, reject) => e.client.sftp((err, sf) => (err ? reject(err) : resolve(sf))));
    e.sftp.on('close', () => { e.sftp = null; });
    return e.sftp;
  }

  async home(ref) { return (await this.connect(ref)).home; }
  async resolve(ref, p, cwd) {
    const e = await this.connect(ref);
    let x = String(p || '').trim();
    if (!x) return cwd || e.home;
    if (x === '~' || x.startsWith('~/')) x = e.home + x.slice(1);
    if (e.os === 'windows') return /^[a-z]:[\\/]/i.test(x) ? x : path.win32.resolve(cwd || e.home, x);
    return x.startsWith('/') ? posix.normalize(x) : posix.resolve(cwd || e.home, x);
  }

  async readFile(ref, file) {
    const sf = await this.sftp(ref);
    return new Promise((resolve, reject) => sf.readFile(file, (err, buf) => (err ? reject(new Error(`${file}: ${err.message}`)) : resolve(buf))));
  }
  async stat(ref, file) {
    const sf = await this.sftp(ref);
    return new Promise((resolve, reject) => sf.stat(file, (err, st) => (err ? reject(new Error(`${file}: ${err.message}`)) : resolve(st))));
  }
  async mkdirp(ref, dir) {
    const e = await this.connect(ref);
    if (e.os === 'windows') { await this.exec(ref, `New-Item -ItemType Directory -Force -Path ${psq(dir)} | Out-Null`); return; }
    await this._run(e.client, `mkdir -p ${shq(dir)}`, 30000);
  }
  async writeFile(ref, file, data) {
    const e = await this.connect(ref);
    await this.mkdirp(ref, e.os === 'windows' ? path.win32.dirname(file) : posix.dirname(file));
    const sf = await this.sftp(ref);
    await new Promise((resolve, reject) => sf.writeFile(file, data, (err) => (err ? reject(new Error(`${file}: ${err.message}`)) : resolve())));
  }
  async list(ref, dir) {
    const sf = await this.sftp(ref);
    return new Promise((resolve, reject) => sf.readdir(dir, (err, list) => (err ? reject(new Error(`${dir}: ${err.message}`)) : resolve(list))));
  }
  async upload(ref, local, remote) {
    const st = await fsp.stat(local);
    const e = await this.connect(ref);
    await this.mkdirp(ref, e.os === 'windows' ? path.win32.dirname(remote) : posix.dirname(remote));
    if (st.isDirectory()) {
      let n = 0;
      const walk = async (l, r) => {
        await this.mkdirp(ref, r);
        for (const ent of await fsp.readdir(l, { withFileTypes: true })) {
          if (ent.name === 'node_modules' || ent.name === '.git') continue;
          const lp = path.join(l, ent.name), rp = e.os === 'windows' ? path.win32.join(r, ent.name) : posix.join(r, ent.name);
          if (ent.isDirectory()) await walk(lp, rp); else if (ent.isFile()) { await this._put(ref, lp, rp); n++; }
        }
      };
      await walk(local, remote);
      return `Uploaded folder ${local} → ${remote} (${n} files; node_modules and .git skipped)`;
    }
    await this._put(ref, local, remote);
    return `Uploaded ${local} → ${remote} (${st.size} bytes)`;
  }
  async _put(ref, local, remote) {
    const sf = await this.sftp(ref);
    await new Promise((resolve, reject) => sf.fastPut(local, remote, (err) => (err ? reject(new Error(`${remote}: ${err.message}`)) : resolve())));
  }
  async download(ref, remote, local) {
    const sf = await this.sftp(ref);
    await fsp.mkdir(path.dirname(local), { recursive: true });
    await new Promise((resolve, reject) => sf.fastGet(remote, local, (err) => (err ? reject(new Error(`${remote}: ${err.message}`)) : resolve())));
    const st = await fsp.stat(local);
    return `Downloaded ${remote} → ${local} (${st.size} bytes)`;
  }

  // ------------------------------------------------------------ interactive shells (stay open between tool calls)
  async shellStart(ref, { cols = 160, rows = 48 } = {}) {
    const s = this.need(ref);
    const e = await this.connect(s);
    const stream = await new Promise((resolve, reject) => e.client.shell({ term: 'xterm-256color', cols, rows }, (err, st) => (err ? reject(err) : resolve(st))));
    const id = `sh-${crypto.randomBytes(3).toString('hex')}`;
    const sh = { id, serverId: s.id, server: s.name, stream, buf: '', closed: false, at: Date.now() };
    const strip = (t) => t.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r(?!\n)/g, '');
    stream.on('data', (d) => { sh.buf += strip(d.toString('utf8')); if (sh.buf.length > 400000) sh.buf = sh.buf.slice(-200000); });
    stream.stderr?.on('data', (d) => { sh.buf += strip(d.toString('utf8')); });
    stream.on('close', () => { sh.closed = true; });
    this.shells.set(id, sh);
    await new Promise((r) => setTimeout(r, 700));
    return id;
  }
  async shellSend(id, input, { waitMs = 1500, signal } = {}) {
    const sh = this.shells.get(id);
    if (!sh) throw new Error(`No open shell "${id}". Start one with action "start".`);
    if (sh.closed) throw new Error(`Shell ${id} was closed by the server.`);
    if (input !== undefined && input !== null) {
      let data = String(input);
      data = data.replace(/\{ctrl-c\}/gi, '\x03').replace(/\{ctrl-d\}/gi, '\x04').replace(/\{ctrl-z\}/gi, '\x1a').replace(/\{enter\}/gi, '\r').replace(/\{tab\}/gi, '\t').replace(/\{esc\}/gi, '\x1b');
      if (!/[\r\n\x03\x04\x1a]$/.test(data)) data += '\n';
      sh.stream.write(data);
    }
    return this.shellRead(id, { waitMs, signal });
  }
  async shellRead(id, { waitMs = 1500, signal } = {}) {
    const sh = this.shells.get(id);
    if (!sh) throw new Error(`No open shell "${id}".`);
    // wait until output settles (no new data for 600 ms) or waitMs passes
    const end = Date.now() + Math.max(200, Math.min(120000, waitMs));
    let last = sh.buf.length, quietSince = Date.now();
    while (Date.now() < end && !signal?.aborted && !sh.closed) {
      await new Promise((r) => setTimeout(r, 150));
      if (sh.buf.length !== last) { last = sh.buf.length; quietSince = Date.now(); }
      else if (Date.now() - quietSince > 600 && Date.now() - (end - waitMs) > 400) break;
    }
    const out = sh.buf; sh.buf = '';
    return `${clip(out.trim() || '(no new output)', 30000)}${sh.closed ? '\n[shell closed]' : ''}`;
  }
  shellClose(id) {
    const sh = this.shells.get(id);
    if (!sh) return false;
    try { sh.stream.end('exit\n'); sh.stream.close(); } catch {}
    this.shells.delete(id);
    return true;
  }
  shellList() { return [...this.shells.values()].map((s) => ({ id: s.id, server: s.server, closed: s.closed, since: s.at })); }

  async test(ref) {
    const s = typeof ref === 'object' ? ref : this.need(ref);
    this.disconnect(s.id);
    const e = await this.connect(s);
    const out = await this.exec(s.id, e.os === 'windows' ? 'hostname; whoami' : 'hostname; whoami; uname -srm; (cat /etc/os-release 2>/dev/null | grep PRETTY_NAME) ; df -h / | tail -1');
    return { ok: true, os: e.os, home: e.home, output: out };
  }
}

module.exports = { Remote, shq, psq };
