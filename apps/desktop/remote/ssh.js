// Carpathron Remote — SSH terminal (like PuTTY): saved connections, password or key login, host key check,
// several terminals in tabs. Main-process part; the window is pages/ssh.html.
//
// Secrets (passwords, private keys, passphrases) are sealed with the same DPAPI / safeStorage functions as the
// rest of Carpathron Remote. A server's host key is remembered the first time (after you accept its fingerprint);
// if it ever changes, the connection is stopped and you are warned.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

function create({ ipcMain, BrowserWindow, getS, save, seal, unseal, log, handle }) {
  let Client = null;
  const sshLib = () => { if (!Client) Client = require('ssh2').Client; return Client; };
  const S = () => { const s = getS(); s.ssh = s.ssh || []; return s; };
  const terms = new Map(); // tid -> { client, stream, wc, conn, trust }
  const pub = (c) => ({ id: c.id, name: c.name, host: c.host, port: c.port, user: c.user, auth: c.auth, keyPath: c.keyPath || '', hasPw: !!c.pw, hasKey: !!c.key, hasPass: !!c.pass, fp: c.fp || '', last: c.last || 0 });
  const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

  handle('rd-ssh-list', () => S().ssh.map(pub));
  handle('rd-ssh-save', (_e, c) => {
    c = c || {}; const s = S();
    let x = c.id ? s.ssh.find((y) => y.id === c.id) : null;
    const host = clean(c.host, 255); const user = clean(c.user, 100); const port = Math.max(1, Math.min(65535, Number(c.port) || 22));
    if (!host || /\s/.test(host)) throw new Error('Enter the server address (name or IP).');
    if (!user) throw new Error('Enter the user name.');
    if (!x) { x = s.ssh.find((y) => y.host === host && y.user === user && y.port === port); }
    if (!x) { x = { id: crypto.randomBytes(8).toString('hex') }; s.ssh.unshift(x); }
    if ((x.host && x.host !== host) || (x.port && x.port !== port)) x.fp = ''; // a different server: its key is checked again
    Object.assign(x, { name: clean(c.name, 60) || `${user}@${host}`, host, port, user, auth: c.auth === 'key' ? 'key' : 'password' });
    if (c.password !== undefined) x.pw = c.password ? seal(String(c.password)) : '';
    if (c.keyText !== undefined) x.key = c.keyText ? seal(String(c.keyText)) : '';
    if (c.keyPath !== undefined) x.keyPath = clean(c.keyPath, 500);
    if (c.passphrase !== undefined) x.pass = c.passphrase ? seal(String(c.passphrase)) : '';
    save(); return pub(x);
  });
  handle('rd-ssh-delete', (_e, id) => { const s = S(); s.ssh = s.ssh.filter((y) => y.id !== String(id)); save(); return s.ssh.map(pub); });
  handle('rd-ssh-forget-key', (_e, id) => { const x = S().ssh.find((y) => y.id === String(id)); if (x) { x.fp = ''; save(); } return true; });

  // open a terminal. extra = { password, passphrase } typed now (not saved). Returns { tid }.
  handle('rd-ssh-open', async (e, id, extra, cols, rows) => {
    const c = S().ssh.find((y) => y.id === String(id)); if (!c) throw new Error('This connection does not exist any more.');
    extra = extra || {};
    const tid = crypto.randomBytes(8).toString('hex');
    const wc = e.sender; const send = (ch, ...a) => { if (!wc.isDestroyed()) wc.send(ch, tid, ...a); };
    const t = { wc, conn: c, client: null, stream: null };
    terms.set(tid, t);
    const cfg = { host: c.host, port: c.port, username: c.user, readyTimeout: 20000, keepaliveInterval: 20000, hostHash: 'sha256', tryKeyboard: true };
    if (c.auth === 'key') {
      let key = unseal(c.key);
      if (!key && c.keyPath) { try { key = fs.readFileSync(c.keyPath, 'utf8'); } catch (err) { throw new Error(`The key file could not be read: ${err.message}`); } }
      if (!key) throw new Error('This connection has no private key: edit it and paste the key or choose the key file.');
      cfg.privateKey = key; const pp = extra.passphrase || unseal(c.pass); if (pp) cfg.passphrase = pp;
    } else {
      const pw = extra.password || unseal(c.pw); if (!pw) throw new Error('password-needed');
      cfg.password = pw;
    }
    // host key: remembered the first time (after the user accepts the fingerprint), refused if it changes
    cfg.hostVerifier = (hash, cb) => {
      const fp = 'SHA256:' + Buffer.from(hash, 'hex').toString('base64').replace(/=+$/, '');
      if (c.fp && c.fp === fp) return cb(true);
      if (c.fp && c.fp !== fp) { send('rd-ssh-exit', `WARNING: the server's host key has CHANGED (now ${fp}, before ${c.fp}). This can be an attack, or the server was reinstalled. The connection was stopped. If you reinstalled it yourself, use "Forget host key" on this connection and connect again.`); return cb(false); }
      t.trust = (ok) => { t.trust = null; if (ok) { c.fp = fp; save(); } cb(!!ok); };
      send('rd-ssh-hostkey', fp);
    };
    const client = new (sshLib())(); t.client = client;
    client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => cfg.password || '')));
    client.on('ready', () => {
      c.last = Date.now(); save();
      client.shell({ term: 'xterm-256color', cols: Number(cols) || 100, rows: Number(rows) || 30 }, (err, stream) => {
        if (err) { send('rd-ssh-exit', 'The server did not open a shell: ' + err.message); client.end(); return; }
        t.stream = stream;
        stream.on('data', (d) => send('rd-ssh-data', d.toString('utf8')));
        stream.stderr.on('data', (d) => send('rd-ssh-data', d.toString('utf8')));
        stream.on('close', () => { send('rd-ssh-exit', 'The session ended.'); client.end(); });
        send('rd-ssh-ready', `${c.user}@${c.host}`);
        log(`ssh: connected ${c.user}@${c.host}:${c.port}`);
      });
    });
    client.on('error', (err) => {
      const m = String(err.message || err);
      send('rd-ssh-exit', /authentication/i.test(m) ? 'Login failed: wrong user name, password or key.' : /ENOTFOUND|EAI_AGAIN/.test(m) ? `The server "${c.host}" was not found (check the address).` : /ECONNREFUSED/.test(m) ? `The server refused the connection on port ${c.port} (is SSH running there?).` : /Timed out|ETIMEDOUT/.test(m) ? 'The server did not answer in time.' : m);
    });
    client.on('close', () => { terms.delete(tid); });
    wc.once('destroyed', () => { try { client.end(); } catch {} });
    client.connect(cfg);
    return { tid };
  });
  handle('rd-ssh-trust', (_e, tid, ok) => { const t = terms.get(String(tid)); if (t && t.trust) t.trust(!!ok); return true; });
  handle('rd-ssh-write', (_e, tid, data) => { const t = terms.get(String(tid)); if (t && t.stream) t.stream.write(String(data)); return true; });
  handle('rd-ssh-resize', (_e, tid, cols, rows) => { const t = terms.get(String(tid)); if (t && t.stream) { try { t.stream.setWindow(Number(rows) || 30, Number(cols) || 100, 0, 0); } catch {} } return true; });
  handle('rd-ssh-close', (_e, tid) => { const t = terms.get(String(tid)); if (t) { try { t.client.end(); } catch {} terms.delete(String(tid)); } return true; });
  return { count: () => terms.size };
}
module.exports = { create };
