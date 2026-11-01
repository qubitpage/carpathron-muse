// Tests for Carpathron Shield: secret detection, project scans and the publish gate, website scans, server scans
// over SSH, fix previews, fixes with backup / undo / lockout protection (dead-man switch), monitoring, API routes.
'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.MC_SHIELD_DEADMAN = '3'; // the automatic undo fires after 3 s instead of 150 s
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const fakeSsh = require('./fake-ssh');
const { startServer } = require('../backend/server');
const shieldMod = require('../backend/shield');
const { findSecrets, scanProject, scanSite, analyseShield, globToRe, Shield, FIXES, execShield, SHIELD_TOOLS } = shieldMod;
const { execX } = require('../backend/xtools');
const { execGitHub } = require('../backend/github');

const PORT = 18640, SSH_PORT = 18642, WEB_PORT = 18643;
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✗ ${name}\n    ${e.stack || e}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'s'.repeat(43)}`;
const SERVICE = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'service_role' });
const ANON = jwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: 'anon' });
const STRIPE = 'sk_live_' + '51HqLyjWDarjtT1zdp7dcXyZ'; // split so this file is not itself a "leak"
const ids = (r) => r.findings.map((f) => `${f.severity}:${f.title}`).join('\n');

function leakyApp() {
  const root = tmp('shield-app-');
  write(root, '.env', 'OPENAI_API_KEY=abc123def456ghi789\nDB_URL=postgres://app:Sup3rS3cret@db:5432/app\n');
  write(root, '.env.example', 'OPENAI_API_KEY=\n');
  write(root, 'dist/assets/index.js', `const k='${SERVICE}';fetch('/x')\n//# sourceMappingURL=index.js.map\n`);
  write(root, 'dist/assets/index.js.map', '{"version":3,"sources":["../src/a.ts"]}');
  write(root, 'supabase/migrations/001.sql', 'create table todos (id int);\ncreate table profiles (id uuid);\nalter table profiles enable row level security;\n-- auth.uid()\n');
  write(root, 'src/config.js', 'export const apiKey = "Zx9fP2kLm8QwErTy";\nexport const other = process.env.API_KEY;\n');
  write(root, 'firestore.rules', 'service cloud.firestore { match /databases/{db}/documents { match /{d=**} { allow read, write: if true; } } }');
  write(root, 'backend/settings.py', 'DEBUG = True\n');
  write(root, 'package-lock.json', '{"integrity":"sha512-AKIAABCDEFGHIJKLMNOP"}');
  return root;
}

(async () => {
  console.log('Carpathron Shield tests');

  await step('secret detection: real keys found, placeholders and env lookups ignored, Supabase roles told apart', async () => {
    const t = [
      'aws = "AKIAIOSFODNN7EXAMPLE"', 'gh = "ghp_' + 'a'.repeat(36) + '"', `stripe = "${STRIPE}"`, '-----BEGIN OPENSSH PRIVATE KEY-----',
      'url = "mongodb+srv://admin:hunter22x@cluster0.example.net/db"', `svc = "${SERVICE}"`, `anon = "${ANON}"`,
      'password = "your-password-here"', 'api_key = process.env.KEY', 'secret: "${SECRET}"', 'auth_token = "Ax93kLm2PqZ7wE"',
    ].join('\n');
    const f = findSecrets(t);
    const got = new Set(f.map((x) => x.id));
    for (const id of ['aws-key', 'github-token', 'stripe-secret', 'private-key', 'db-url', 'supabase-service-role', 'supabase-anon', 'hardcoded-secret']) assert.ok(got.has(id), `${id} in ${[...got]}`);
    assert.ok(!f.some((x) => /your-password|process\.env|\$\{SECRET\}/.test(x.value)), 'placeholders are not secrets');
    assert.ok(f.find((x) => x.id === 'supabase-anon').hard === false, 'the anon key is public by design');
    assert.strictEqual(f.find((x) => x.id === 'db-url').value, 'hunter22x', 'only the password part is reported (masked later)');
    assert.deepStrictEqual(findSecrets('const x = 1; // nothing here'), []);
  });

  await step('.gitignore patterns: names, folders, globs, anchored paths, **', async () => {
    const m = (pat, p, dir = false) => globToRe(pat.replace(/\/$/, ''), pat.endsWith('/')).test(dir ? `${p}/` : p);
    assert.ok(m('.env', '.env') && m('.env', 'api/.env') && !m('.env', '.env.example'));
    assert.ok(m('.env*', '.env.local') && m('*.pem', 'certs/server.pem'));
    assert.ok(m('dist/', 'dist', true) && m('dist/', 'dist/a.js') && !m('dist/', 'dist.js'));
    assert.ok(m('/build', 'build/x') && !m('/build', 'src/build/x'));
    assert.ok(m('**/secrets/*.json', 'a/b/secrets/k.json') && m('docs/**/*.md', 'docs/a/b.md'));
    const { gitignoreRules, isIgnored } = shieldMod;
    const root = tmp('shield-gi-');
    write(root, '.gitignore', '# comment\n.env*\n!.env.example\nnode_modules/\n');
    const rules = gitignoreRules(root);
    assert.ok(isIgnored(rules, '.env.local') && !isIgnored(rules, '.env.example') && isIgnored(rules, 'node_modules', true));
  });

  await step('project scan: severity follows where the code goes (GitHub, server web root, review)', async () => {
    const root = leakyApp();
    const gh = await scanProject(root, { purpose: 'github' });
    let s = ids(gh);
    assert.ok(/critical:Environment file with secrets would be published/.test(s), s);
    assert.ok(/critical:Supabase service_role key/.test(s), s);
    assert.ok(/critical:Firebase rules let anyone read or write/.test(s), s);
    assert.ok(/warning:Supabase tables without row-level security: todos/.test(s) && !/profiles/.test(gh.findings.find((f) => f.id === 'supabase-rls').title), s);
    assert.ok(/warning:Hard-coded API key/.test(s) && /warning:Django DEBUG/.test(s), s);
    assert.ok(/critical:No \.gitignore/.test(s), 'no .gitignore + .env present = critical');
    assert.ok(!/AKIA/.test(JSON.stringify(gh)), 'lock files are skipped');
    assert.ok(!JSON.stringify(gh).includes(SERVICE), 'secret values are masked in results');
    assert.ok(gh.score < 50 && gh.grade === 'F' || gh.grade === 'D', `${gh.score} ${gh.grade}`);
    // with a .gitignore that hides .env, GitHub publishing no longer includes it
    write(root, '.gitignore', 'node_modules/\n.env\n');
    const gh2 = await scanProject(root, { purpose: 'github' });
    assert.ok(!gh2.findings.some((f) => f.id.startsWith('env-file')), ids(gh2));
    // upload to a private app folder: .env is a warning; the bundle with the key is still critical (browsers download it)
    const srvApp = await scanProject(root, { purpose: 'server', remotePath: '/home/app/api' });
    s = ids(srvApp);
    assert.ok(/warning:Environment file with secrets is uploaded/.test(s) && /critical:Supabase service_role key .* in a file browsers can download/.test(s), s);
    assert.ok(/warning:1 source map would be public/.test(s), s);
    // upload into a web root: everything is public
    const web = await scanProject(root, { purpose: 'server', remotePath: '/var/www/html' });
    assert.ok(/critical:Environment file with secrets would be published/.test(ids(web)), ids(web));
    // a clean folder passes
    const clean = tmp('shield-clean-');
    write(clean, 'index.html', '<html><script src="app.js"></script></html>');
    write(clean, 'app.js', 'console.log("hi")');
    const c = await scanProject(clean, { purpose: 'server', remotePath: '/var/www/html' });
    assert.strictEqual(c.counts.critical + c.counts.warning, 0, ids(c));
    assert.strictEqual(c.score, 100);
  });

  // ---- a small website that leaks
  const site = http.createServer((req, res) => {
    const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
    if (req.url === '/') return send(200, 'text/html', '<html><head><script type="module" src="/assets/app.js"></script><script>window.cfg={u:"https://abcdefghijklmnopqrst.supabase.co"}</script></head><body>shop</body></html>', { Server: 'nginx/1.18.0' });
    if (req.url === '/assets/app.js') return send(200, 'text/javascript', `const supa="https://abcdefghijklmnopqrst.supabase.co",anon="${ANON}";const stripe="${STRIPE}";\n//# sourceMappingURL=app.js.map`);
    if (req.url === '/assets/app.js.map') return send(200, 'application/json', '{"version":3,"sources":["../src/main.ts"],"mappings":""}');
    if (req.url === '/.env') return send(200, 'text/plain', 'DB_PASSWORD=secret\nSTRIPE_KEY=x\n');
    send(404, 'text/html', '<html>not found</html>');
  });
  await new Promise((r) => site.listen(WEB_PORT, '127.0.0.1', r));

  await step('website scan: secret key in the JavaScript, public source maps, exposed .env, Supabase detected', async () => {
    const r = await scanSite(`http://127.0.0.1:${WEB_PORT}/`, { deep: false });
    const s = ids(r);
    assert.ok(/critical:Stripe secret key is in the site JavaScript/.test(s), s);
    assert.ok(/warning:Source maps are public \(1\)/.test(s), s);
    assert.ok(/critical:Publicly readable: \/\.env/.test(s), s);
    assert.ok(/info:Supabase project abcdefghijklmnopqrst detected/.test(s), s);
    assert.ok(!JSON.stringify(r).includes(STRIPE), 'key value masked');
    assert.strictEqual(r.kind, 'site');
    assert.ok(r.counts.critical >= 2 && r.grade !== 'A');
  });

  await step('server analysis: post-quantum SSH, password guessing, world-readable .env, nginx hidden files, fix ids', async () => {
    const out = (o) => ['== OS', 'Ubuntu 24.04 LTS', '== LISTENING', 'tcp 0.0.0.0:22 users:(("sshd"))', 'tcp 0.0.0.0:6379 users:(("redis"))', '== FIREWALL', 'Status: inactive',
      '== SSHD', 'permitrootlogin yes', 'passwordauthentication yes', '== UPDATES', '3', '9', '== AUTOUPDATES', '0', '== FAIL2BAN', 'inactive', '== DISK', '/dev/sda1 50G 10G 40G 20% /', '== REBOOT', 'no',
      '== WHOAMI', '0', 'sudo-ok', '== PKG', 'apt', '== SSHVER', o.ver, '== KEX', o.kex, '== SSHPORT', '2222', '== SSHINCLUDE', '1', '== AUTHFAIL', String(o.fails),
      '== ENVPERM', ...(o.env || []), '== NGINX', o.nginx, '== UFW', 'yes', '== FIREWALLD', 'no', '== END'].join('\n');
    let a = analyseShield(out({ ver: 'OpenSSH_9.6p1 Ubuntu', kex: 'kexalgorithms sntrup761x25519-sha512@openssh.com,curve25519-sha256', fails: 340, env: ['/var/www/shop/.env'], nginx: '0' }));
    const s = a.findings.map((f) => `${f.severity}:${f.id}:${f.title}`).join('\n');
    assert.ok(/ok:pq-ssh:SSH uses post-quantum key exchange \(sntrup761\)/.test(s), s);
    assert.ok(/warning:bruteforce:340 failed SSH logins/.test(s), s);
    assert.ok(/warning:env-perms:1 \.env file is readable by every user/.test(s), s);
    assert.ok(/warning:nginx-dotfiles/.test(s), s);
    const fx = (id) => (a.findings.find((f) => f.id === id) || {}).fix || {};
    assert.strictEqual(fx('firewall').id, 'firewall'); assert.strictEqual(fx('ssh-root').id, 'ssh-root'); assert.strictEqual(fx('ssh-password').id, 'ssh-password');
    assert.strictEqual(fx('fail2ban').id, 'fail2ban'); assert.strictEqual(fx('bruteforce').id, 'fail2ban'); assert.strictEqual(fx('updates').id, 'updates');
    assert.deepStrictEqual({ root: a.env.root, sudo: a.env.sudo, pkg: a.env.pkg, sshPort: a.env.sshPort, sshInclude: a.env.sshInclude, ufw: a.env.ufw }, { root: true, sudo: true, pkg: 'apt', sshPort: 2222, sshInclude: true, ufw: true });
    assert.deepStrictEqual(a.publicPorts, [22, 6379]);
    a = analyseShield(out({ ver: 'OpenSSH_10.0p2', kex: 'kexalgorithms mlkem768x25519-sha256,curve25519-sha256', fails: 0, nginx: '2' }));
    assert.ok(a.findings.some((f) => f.id === 'pq-ssh' && f.severity === 'ok' && /ML-KEM/.test(f.title)) && !a.findings.some((f) => f.id === 'nginx-dotfiles' || f.id === 'bruteforce'));
    a = analyseShield(out({ ver: 'OpenSSH_8.2p1', kex: 'kexalgorithms curve25519-sha256,ecdh-sha2-nistp256', fails: 4, nginx: 'none' }));
    assert.ok(a.findings.some((f) => f.id === 'pq-ssh' && f.severity === 'warning' && /OpenSSH 8\.2/.test(f.title)));
    assert.ok(a.findings.some((f) => f.id === 'bruteforce' && f.severity === 'info'));
  });

  await step('fix recipes: commands per package manager, firewall keeps SSH (custom port) + web open, SSH needs sshd_config.d', async () => {
    const e = { pkg: 'apt', sshPort: 2222, ufw: false, firewalld: false, sshInclude: true };
    const fw = FIXES.firewall.plan(e, { allowPorts: [8443, 'x', 99999] });
    assert.deepStrictEqual(fw.ports, [2222, 80, 443, 8443]);
    assert.ok(fw.commands.indexOf('ufw allow 2222/tcp') < fw.commands.indexOf('ufw --force enable'), 'SSH is allowed BEFORE the firewall turns on');
    assert.ok(/apt-get install -y ufw/.test(fw.commands[0]));
    const fd = FIXES.firewall.plan({ ...e, pkg: 'dnf' }, {});
    assert.ok(fd.commands.some((c) => /firewall-cmd --permanent --add-port=2222\/tcp/.test(c)));
    const f2 = FIXES.fail2ban.plan(e);
    assert.ok(f2.commands.some((c) => /port = 2222/.test(c)) && f2.undo.length);
    const sp = FIXES['ssh-password'].plan(e);
    assert.ok(sp.commands.some((c) => /sshd -t/.test(c)) && sp.commands.some((c) => /PasswordAuthentication no/.test(c)));
    assert.throws(() => FIXES['ssh-root'].plan({ ...e, sshInclude: false }), /does not include/);
    assert.throws(() => FIXES.updates.plan({ pkg: 'unknown' }), /Unknown package manager/);
  });

  // ---- the app with a real SSH server
  const sshHome = tmp('shield-ssh-home-');
  await fakeSsh.start(SSH_PORT, { home: sshHome });
  const dataDir = tmp('shield-data-');
  const ws = tmp('shield-ws-');
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ workspace: ws, port: PORT, apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api' }));
  const srv = await startServer({ dataDir, log: () => {} });
  const base = `https://localhost:${PORT}`;
  const api = async (p, body, method) => {
    const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'x-mc-token': srv.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  const box = await api('/api/servers', { name: 'shieldbox', host: '127.0.0.1', port: SSH_PORT, username: 'tester', password: 'secret' });
  const isRoot = process.getuid && process.getuid() === 0;
  const ctx = { workspace: ws, remote: srv.remote, shield: srv.shield, github: srv.github, status: () => {} };

  await step('publish gate: ssh_upload and github_publish are blocked on critical findings; allow_risky and clean folders pass', async () => {
    const app = leakyApp();
    const remoteDir = tmp('shield-remote-');
    await assert.rejects(execX('ssh_upload', { server: 'shieldbox', local_path: app, remote_path: path.join(remoteDir, 'site') }, ctx), /Carpathron Shield stopped this publish[\s\S]*service_role/);
    assert.ok(!fs.existsSync(path.join(remoteDir, 'site')), 'nothing was uploaded');
    const ok = await execX('ssh_upload', { server: 'shieldbox', local_path: app, remote_path: path.join(remoteDir, 'site'), allow_risky: true }, ctx);
    assert.ok(/Uploaded folder/.test(ok) && /Uploaded despite \d+ critical Shield finding/.test(ok), ok);
    const clean = tmp('shield-clean2-');
    write(clean, 'index.html', '<h1>hi</h1>');
    const c = await execX('ssh_upload', { server: 'shieldbox', local_path: clean, remote_path: path.join(remoteDir, 'clean') }, ctx);
    assert.ok(/Shield: no problems found/.test(c), c);
    await assert.rejects(execGitHub('github_publish', { path: app, repo: 'msrusu87/leaky' }, ctx), /Carpathron Shield stopped this publish/);
  });

  await step('server scan over SSH: structured result, saved for the Shield page, served by the API', async () => {
    const r = await srv.shield.scanServer('shieldbox');
    assert.strictEqual(r.kind, 'server');
    assert.ok(Array.isArray(r.findings) && r.findings.length > 3, ids(r));
    assert.ok(typeof r.score === 'number' && /^[A-F]$/.test(r.grade));
    assert.strictEqual(r.serverId, box.id);
    assert.strictEqual(r.canFix, isRoot || r.env.sudo);
    const st = await api('/api/shield');
    assert.ok(st.servers.find((s) => s.id === box.id).lastScan.grade === r.grade);
    assert.ok(st.fixes.some((f) => f.id === 'firewall' && f.lockout));
    const viaApi = await api('/api/shield/scan', { target: 'project', path: leakyApp(), purpose: 'github' });
    assert.ok(viaApi.counts.critical >= 3, JSON.stringify(viaApi.counts));
    const report = await execShield('shield_scan', { target: 'server', server: 'shieldbox' }, ctx);
    assert.ok(/## Carpathron Shield — Server shieldbox/.test(report) && /Score \d+\/100/.test(report), report);
  });

  await step('fix preview shows the commands and changes nothing; SSH fixes refuse password-only servers', async () => {
    if (!isRoot) { console.log('    (skipped: needs root on the test machine to act as the server)'); return; }
    const p = await api('/api/shield/fix/preview', { server: box.id, fix: 'fail2ban' });
    assert.ok(!p.error && p.commands.some((c) => /fail2ban/.test(c)) && p.lockoutProtection === false, JSON.stringify(p));
    const fw = await srv.shield.preview('shieldbox', 'firewall', { allowPorts: [8080] });
    assert.ok(fw.commands.some((c) => /8080/.test(c)) && fw.lockoutProtection === true, JSON.stringify(fw));
    const sp = await api('/api/shield/fix/preview', { server: box.id, fix: 'ssh-password' });
    assert.ok(/logs in with a password\. Install an SSH key first/.test(sp.error), JSON.stringify(sp));
    const pv = await execShield('shield_fix', { server: 'shieldbox', fix: 'fail2ban', preview: true }, ctx);
    assert.ok(/would run:/.test(pv), pv);
    assert.strictEqual(srv.shield.cfg().history.length, 0, 'preview applies nothing');
  });

  await step('fix with backup, history and undo; lockout protection keeps the change after logging in again', async () => {
    if (!isRoot) { console.log('    (skipped: needs root on the test machine)'); return; }
    const marker = path.join(tmp('shield-fix-'), 'hardened');
    const conf = write(path.dirname(marker), 'app.conf', 'old=1\n');
    FIXES['test-lockout'] = { title: 'Test hardening', lockout: true, plan: () => ({ commands: [`echo on > ${marker}`, `echo new=2 > ${conf}`], undo: [`rm -f ${marker}`], files: [conf] }) };
    const r = await srv.shield.applyFix('shieldbox', 'test-lockout', {});
    assert.ok(r.ok && r.verified === true, JSON.stringify(r));
    assert.ok(fs.existsSync(marker) && fs.readFileSync(conf, 'utf8') === 'new=2\n');
    assert.ok(fs.readFileSync(path.join(r.backup, conf), 'utf8') === 'old=1\n', 'the changed file was backed up first');
    await sleep(4500);
    assert.ok(fs.existsSync(marker), 'confirmed by the new login, so the dead-man switch did NOT undo it');
    const hist = (await api('/api/shield')).history;
    assert.strictEqual(hist[0].fix, 'test-lockout');
    const u = await api('/api/shield/undo', { id: r.id });
    assert.ok(u.ok && !fs.existsSync(marker), JSON.stringify(u));
    assert.ok((await api('/api/shield')).history[0].undone);
  });

  await step('lockout protection: when the app cannot log in again the server undoes the change by itself', async () => {
    if (!isRoot) { console.log('    (skipped: needs root on the test machine)'); return; }
    const marker = path.join(tmp('shield-lock-'), 'firewall-on');
    FIXES['test-lockout'] = { title: 'Test risky change', lockout: true, plan: () => ({ commands: [`echo on > ${marker}`], undo: [`rm -f ${marker}`], files: [] }) };
    const rem = srv.remote;
    const origConnect = rem.connect.bind(rem), origDisconnect = rem.disconnect.bind(rem);
    let armed = false;
    rem.disconnect = (id) => { armed = true; return origDisconnect(id); };
    rem.connect = async (...a) => { if (armed) { armed = false; throw new Error('Connection refused (simulated lockout)'); } return origConnect(...a); };
    let r;
    try { r = await srv.shield.applyFix('shieldbox', 'test-lockout', {}); }
    finally { rem.connect = origConnect; rem.disconnect = origDisconnect; }
    assert.ok(r.verified === false && r.ok === false, JSON.stringify(r));
    assert.ok(fs.existsSync(marker), 'the change ran');
    await sleep(5000);
    assert.ok(!fs.existsSync(marker), 'the dead-man switch undid it');
    assert.ok(fs.existsSync(path.join(r.backup, 'auto-undone')), 'and left a note in the backup folder');
    assert.ok(srv.shield.events.some((e) => /Fix did not finish: Test risky change/.test(e.title) && /undo the change by itself/.test(e.detail)));
    delete FIXES['test-lockout'];
  });

  await step('monitor: baseline, new risky port, password-guessing burst, full disk, new login, server down / back, exposed .env', async () => {
    const outputs = [];
    const fakeRemote = {
      list: [{ id: 's1', name: 'web1', username: 'root', host: '203.0.113.5' }],
      find(id) { return this.list.find((s) => s.id === id || s.name === id) || null; },
      need(id) { const s = this.find(id); if (!s) throw new Error('unknown'); return s; },
      publicList() { return this.list; },
      async exec() { const o = outputs.shift(); if (o instanceof Error) throw o; return o; },
    };
    const store = { settings: {}, saveSettings() {} };
    const emitted = [];
    const sh = new Shield({ store, remote: fakeRemote, emit: (e, d) => emitted.push([e, d]) });
    const mk = ({ ports, fails = 0, disk = '40%', logins = [], banned = '' }) => ['== PORTS', ...ports, '== AUTHFAIL', String(fails), '== BANNED', banned, '== LOAD', '0.3', '4', '== DISK', disk, '== LOGINS', ...logins, '== END', '[exit code 0]'].join('\n');
    const cfg = sh.cfg();
    cfg.monitors.s1 = { enabled: true, intervalMin: 5, urls: [`http://127.0.0.1:${WEB_PORT}`] };
    outputs.push(mk({ ports: ['22', '80'], logins: ['root 198.51.100.7'], banned: '3' }));
    await sh.tick('s1');
    assert.ok(sh.events.some((e) => /Baseline saved: public ports 22, 80/.test(e.title)));
    assert.ok(sh.events.some((e) => e.severity === 'critical' && /\/\.env is publicly readable/.test(e.title)), 'exposed .env on the watched site');
    const n1 = sh.events.length;
    outputs.push(mk({ ports: ['22', '80', '6379'], fails: 42, disk: '93%', logins: ['root 198.51.100.7', 'deploy 203.0.113.99'], banned: '7' }));
    await sh.tick('s1');
    const t = sh.events.slice(0, sh.events.length - n1).map((e) => `${e.severity}:${e.title}`).join('\n');
    assert.ok(/critical:New public port 6379 \(Redis\) opened on web1/.test(t), t);
    assert.ok(/warning:42 failed SSH logins in 5 min on web1/.test(t), t);
    assert.ok(/warning:Disk 93% full on web1/.test(t), t);
    assert.ok(/info:New SSH login on web1: deploy from 203\.0\.113\.99/.test(t), t);
    assert.ok(/info:fail2ban blocked 4 more IPs on web1/.test(t), t);
    assert.ok(!/\.env is publicly readable/.test(t), 'the same exposure is not reported twice');
    assert.deepStrictEqual(cfg.monitors.s1.baseline, [22, 80, 6379], 'after alerting, the new port joins the baseline');
    outputs.push(new Error('timeout'), new Error('timeout'));
    await sh.tick('s1'); await sh.tick('s1');
    assert.ok(sh.events[0].severity === 'critical' && /web1 is not reachable/.test(sh.events[0].title));
    outputs.push(mk({ ports: ['22', '80', '6379'], disk: '93%', logins: ['root 198.51.100.7', 'deploy 203.0.113.99'], banned: '7' }));
    await sh.tick('s1');
    assert.ok(sh.events.some((e) => /web1 is reachable again/.test(e.title)));
    assert.strictEqual(sh.events.filter((e) => /Disk 93%/.test(e.title)).length, 1, 'disk alert is not repeated while it stays full');
    assert.ok(emitted.some(([e]) => e === 'shield:event') && emitted.some(([e]) => e === 'shield:status'));
    sh.stopAll();
  });

  await step('monitor API: start, status, stop for a saved server; agent sees the Shield tools with the right risks', async () => {
    const st = await api('/api/shield/monitor', { server: box.id, action: 'start', intervalMin: 30, urls: ['example.invalid'] });
    assert.ok(st.enabled && st.intervalMin === 30 && st.urls[0] === 'example.invalid', JSON.stringify(st));
    await sleep(1500);
    const all = await api('/api/shield');
    assert.ok(all.servers.find((s) => s.id === box.id).monitor.enabled);
    assert.ok(all.events.some((e) => /Monitoring started/.test(e.title)));
    const off = await api('/api/shield/monitor', { server: box.id, action: 'stop' });
    assert.ok(!off.enabled);
    const specs = srv.agent.toolSpecs({ id: 'x', workspace: ws });
    const by = Object.fromEntries(specs.map((t) => [t.name, t.risk]));
    assert.deepStrictEqual([by.shield_scan, by.shield_fix, by.shield_monitor], ['read', 'exec', 'write']);
    assert.ok(srv.agent.bridgeTools().some((t) => t.name === 'shield_scan'), 'Muse Code gets the tools through the bridge too');
    assert.ok(SHIELD_TOOLS.every((t) => t.parameters && t.description.length > 80));
    const sk = (await api('/api/skills')).map((x) => x.name);
    assert.ok(sk.includes('secure-publish'));
  });

  site.close();
  await srv.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
