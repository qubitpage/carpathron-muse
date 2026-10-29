// Small SSH + SFTP server for tests (ssh2 Server): password login, exec through bash, interactive shell, basic SFTP.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Server, utils: { sftp: { STATUS_CODE, OPEN_MODE } } } = require('ssh2');

function start(port, { user = 'tester', password = 'secret' } = {}) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const hostKey = null;
  const srv = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username === user && ctx.method === 'password' && ctx.password === password) return ctx.accept();
      ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (acc, _rej, info) => {
          const stream = acc();
          const p = spawn('bash', ['-c', info.command]);
          p.stdout.on('data', (d) => stream.write(d));
          p.stderr.on('data', (d) => stream.stderr.write(d));
          p.on('close', (code) => { stream.exit(code || 0); stream.end(); });
          stream.on('signal', () => p.kill('SIGKILL'));
          stream.on('close', () => { try { p.kill('SIGKILL'); } catch {} });
        });
        session.on('pty', (acc) => acc && acc());
        session.on('shell', (acc) => {
          const stream = acc();
          const p = spawn('bash', ['-i'], { env: { ...process.env, PS1: '$ ' } });
          p.stdout.on('data', (d) => stream.write(d));
          p.stderr.on('data', (d) => stream.write(d));
          stream.on('data', (d) => p.stdin.write(d));
          p.on('close', () => { try { stream.exit(0); stream.end(); } catch {} });
        });
        session.on('sftp', (acc) => {
          const sftp = acc();
          const handles = new Map(); let n = 0;
          const h = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(++n); handles.set(n, v); return b; };
          const g = (b) => handles.get(b.readUInt32BE(0));
          const attrs = (st) => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
          sftp.on('OPEN', (id, file, flags) => {
            try {
              const mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.APPEND ? 'a' : 'w') : 'r';
              const fd = fs.openSync(file, mode);
              sftp.handle(id, h({ fd, file }));
            } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
          });
          sftp.on('READ', (id, hb, offset, len) => {
            const x = g(hb); if (!x) return sftp.status(id, STATUS_CODE.FAILURE);
            const buf = Buffer.alloc(len); const r = fs.readSync(x.fd, buf, 0, len, offset);
            if (!r) return sftp.status(id, STATUS_CODE.EOF);
            sftp.data(id, buf.subarray(0, r));
          });
          sftp.on('WRITE', (id, hb, offset, data) => { const x = g(hb); fs.writeSync(x.fd, data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK); });
          sftp.on('FSTAT', (id, hb) => { const x = g(hb); sftp.attrs(id, attrs(fs.fstatSync(x.fd))); });
          sftp.on('STAT', (id, p) => { try { sftp.attrs(id, attrs(fs.statSync(p))); } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); } });
          sftp.on('LSTAT', (id, p) => { try { sftp.attrs(id, attrs(fs.lstatSync(p))); } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); } });
          sftp.on('CLOSE', (id, hb) => { const x = g(hb); if (x && x.fd !== undefined) try { fs.closeSync(x.fd); } catch {} handles.delete(hb.readUInt32BE(0)); sftp.status(id, STATUS_CODE.OK); });
          sftp.on('OPENDIR', (id, p) => { try { sftp.handle(id, h({ dir: p, list: fs.readdirSync(p), done: false })); } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); } });
          sftp.on('READDIR', (id, hb) => {
            const x = g(hb);
            if (!x || x.done) return sftp.status(id, STATUS_CODE.EOF);
            x.done = true;
            sftp.name(id, x.list.map((f) => { const st = fs.statSync(path.join(x.dir, f)); return { filename: f, longname: `${st.isDirectory() ? 'd' : '-'}rw-r--r-- 1 u g ${st.size} Jan 1 00:00 ${f}`, attrs: attrs(st) }; }));
          });
          sftp.on('REALPATH', (id, p) => sftp.name(id, [{ filename: path.resolve('/', p), longname: '', attrs: {} }]));
          sftp.on('MKDIR', (id, p) => { try { fs.mkdirSync(p); sftp.status(id, STATUS_CODE.OK); } catch { sftp.status(id, STATUS_CODE.FAILURE); } });
          sftp.on('SETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
          sftp.on('FSETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
        });
      });
    });
    client.on('error', () => {});
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve({ srv, hostKey })));
}
module.exports = { start };
