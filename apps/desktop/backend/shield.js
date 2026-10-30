// Carpathron Shield: security for the apps you build and the servers you publish them to.
//  - project scan: before publishing, finds secrets in code, .env files, private keys, public source maps,
//    open Firebase rules, Supabase tables without row-level security, debug mode
//  - server scan: firewall, SSH (incl. post-quantum key exchange), updates, brute-force attempts, exposed
//    databases, world-readable .env files, web roots (Linux over SSH)
//  - site scan: HTTPS, headers, exposed files, API keys inside the site's JavaScript, public source maps and
//    (deep) whether its Supabase tables / Firebase database can be read by anyone
//  - fixes: built-in recipes run over SSH with backups; firewall and SSH changes undo themselves automatically
//    if the app cannot log in again afterwards (dead-man switch), so a fix can never lock the user out
//  - monitor: light checks from this PC over SSH every few minutes (nothing is installed on the server)
// Only for projects, servers and sites the user owns or manages.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { SERVER_CHECK, analyseServer, securityCheck } = require('./devtools');

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const SEV_ORDER = { critical: 0, warning: 1, info: 2, ok: 3 };
const ICON = { critical: '✗', warning: '⚠', info: 'ℹ', ok: '✓' };
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const mask = (s) => { s = String(s); return s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ---------------------------------------------------------------- secrets
// "hard" secrets: must never be in a public repo or in files a browser can download
const SECRET_PATTERNS = [
  { id: 'private-key', title: 'Private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'aws-key', title: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', title: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/ },
  { id: 'anthropic-key', title: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{30,}/ },
  { id: 'openai-key', title: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, not: /\bsk-ant-/ },
  { id: 'stripe-secret', title: 'Stripe secret key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { id: 'slack-token', title: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'meta-token', title: 'Meta / WhatsApp access token', re: /\bEAA[A-Za-z0-9]{90,}/ },
  { id: 'npm-token', title: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b|_authToken=(?!\$\{)[A-Za-z0-9_-]{20,}/ },
  { id: 'db-url', title: 'Database URL with password', re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:@/'"`]+:([^\s@/'"`]{3,})@[^\s'"`]+/ },
];
// public by design (but worth a note): Google browser keys in Firebase configs
const SOFT_PATTERNS = [
  { id: 'google-key', title: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];
const GENERIC_RE = /\b(pass(?:word)?|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i;
const PLACEHOLDER_RE = /^(x+|\*+|\.+|-+)$|your|example|changeme|change[_-]me|placeholder|dummy|sample|redacted|<|>|\$\{|\{\{|process\.env|os\.environ|getenv|import\.meta|env\(|todo|xxxx|1234567|abcdef|password|secret/i;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
function jwtPayload(t) { try { return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; } }

// Finds secrets in one text. Returns [{ id, title, value, index, hard }]
function findSecrets(text) {
  const out = [];
  const seen = new Set();
  const push = (x) => { const k = `${x.id}:${x.value}`; if (!seen.has(k)) { seen.add(k); out.push(x); } };
  for (const p of SECRET_PATTERNS) {
    const re = new RegExp(p.re.source, 'g');
    let m, n = 0;
    while ((m = re.exec(text)) && n < 5) {
      if (p.not && p.not.test(text.slice(Math.max(0, m.index - 1), m.index + 10))) continue;
      const value = p.id === 'db-url' ? m[1] : m[0];
      if (p.id === 'db-url' && PLACEHOLDER_RE.test(value)) continue;
      push({ id: p.id, title: p.title, value, index: m.index, hard: true }); n++;
    }
  }
  let m;
  JWT_RE.lastIndex = 0;
  while ((m = JWT_RE.exec(text))) {
    const pl = jwtPayload(m[0]);
    if (pl && pl.role === 'service_role') push({ id: 'supabase-service-role', title: 'Supabase service_role key (bypasses all database rules)', value: m[0], index: m.index, hard: true });
    else if (pl && pl.role === 'anon') push({ id: 'supabase-anon', title: 'Supabase anon key', value: m[0], index: m.index, hard: false, anon: true, ref: pl.ref || '' });
  }
  for (const p of SOFT_PATTERNS) { const r = new RegExp(p.re.source, 'g'); let x; let n = 0; while ((x = r.exec(text)) && n < 3) { push({ id: p.id, title: p.title, value: x[0], index: x.index, hard: false }); n++; } }
  const g = new RegExp(GENERIC_RE.source, 'gi');
  let n = 0;
  while ((m = g.exec(text)) && n < 5) {
    const val = m[2];
    if (PLACEHOLDER_RE.test(val) || /^[a-z_]+$/i.test(val) && val.length < 12) continue; // variable names, placeholders
    if (out.some((o) => o.hard && Math.abs(o.index - m.index) < 200)) continue;
    const kind = { pass: 'password', passwd: 'password', pwd: 'password', password: 'password', secret: 'secret', apikey: 'API key', accesstoken: 'access token', authtoken: 'auth token', clientsecret: 'client secret', privatekey: 'private key' }[m[1].toLowerCase().replace(/[_-]/g, '')] || m[1];
    push({ id: 'hardcoded-secret', title: `Hard-coded ${kind}`, value: val, index: m.index, hard: false, generic: true }); n++;
  }
  return out;
}
const lineAt = (text, i) => { let n = 1; for (let k = 0; k < i && k < text.length; k++) if (text.charCodeAt(k) === 10) n++; return n; };

// ---------------------------------------------------------------- files to scan
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', '.cache', '.idea', '.vs', '.vscode-test', '.gradle', '.pytest_cache', '.mypy_cache', '.turbo', '.parcel-cache', 'coverage', '.terraform']);
const SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock|go\.sum)$/;
const MAX_FILES = 8000, MAX_BYTES = 2 * 1024 * 1024;
const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults)$/i;
const KEY_FILE = /(^|\/)(id_rsa|id_ecdsa|id_ed25519|id_dsa)$|\.(p12|pfx|keystore|jks|ppk)$|(^|\/)\.git-credentials$/i;
const DB_FILE = /\.(sqlite3?|db)$/i;
const PUBLIC_DIR_RE = /(^|\/)(dist|build|public|static|www|out|html|htdocs|public_html|wwwroot|assets|_next\/static)(\/|$)/i;
const WEBROOT_RE = /^(\/var\/www|\/usr\/share\/nginx\/html|\/srv\/www|\/srv\/http)(\/|$)|(^|\/)(public_html|htdocs|wwwroot)(\/|$)/i;

function globToRe(pat, dirOnly) {
  const anchored = pat.startsWith('/') || pat.replace(/\/$/, '').includes('/');
  pat = pat.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '*') {
      if (pat[i + 1] === '*') { if (pat[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i++; } }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}${dirOnly ? '/' : '(?:/|$)'}`);
}
// Minimal .gitignore support (root file): patterns, **, negation, dir-only, anchored.
function gitignoreRules(root) {
  let text = '';
  try { text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch { return []; }
  const rules = [];
  for (let l of text.split(/\r?\n/)) {
    l = l.replace(/\s+$/, '');
    if (!l || l.startsWith('#')) continue;
    const neg = l.startsWith('!');
    if (neg) l = l.slice(1);
    const dirOnly = l.endsWith('/');
    if (dirOnly) l = l.slice(0, -1);
    if (!l) continue;
    rules.push({ neg, re: globToRe(l, dirOnly) });
  }
  return rules;
}
function isIgnored(rules, rel, isDir) {
  let ign = false;
  const probe = isDir ? `${rel}/` : rel;
  for (const r of rules) if (r.re.test(probe)) ign = !r.neg;
  return ign;
}
// Files that git would publish (respects all .gitignore files) when the folder is a git repo.
function gitFiles(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  try {
    const r = spawnSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0) return null;
    return r.stdout.split('\0').filter(Boolean).filter((f) => !f.split('/').some((p) => SKIP_DIRS.has(p)));
  } catch { return null; }
}
async function listFiles(root, { useGitignore }) {
  const st = await fsp.stat(root);
  if (st.isFile()) return { base: path.dirname(root), files: [path.basename(root)], truncated: false };
  if (useGitignore) { const g = gitFiles(root); if (g) return { base: root, files: g.slice(0, MAX_FILES), truncated: g.length > MAX_FILES, git: true }; }
  const rules = useGitignore ? gitignoreRules(root) : [];
  const files = [];
  let truncated = false;
  const walk = async (dir, rel) => {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (SKIP_DIRS.has(e.name) || isIgnored(rules, r, true)) continue; await walk(path.join(dir, e.name), r); }
      else if (e.isFile() && !isIgnored(rules, r, false)) files.push(r);
    }
  };
  await walk(root, '');
  return { base: root, files, truncated };
}

// ---------------------------------------------------------------- results
function summarize(r) {
  const counts = { critical: 0, warning: 0, info: 0, ok: 0 };
  for (const f of r.findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  r.findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  r.counts = counts;
  r.score = Math.max(0, 100 - counts.critical * 20 - counts.warning * 6);
  r.grade = r.score >= 90 ? 'A' : r.score >= 75 ? 'B' : r.score >= 60 ? 'C' : r.score >= 40 ? 'D' : 'F';
  r.at = Date.now();
  return r;
}
function renderReport(r) {
  const label = { project: 'Project', server: 'Server', site: 'Website' }[r.kind] || r.kind;
  const lines = [`## Carpathron Shield — ${label} ${r.target}`, `Score ${r.score}/100 (${r.grade}) · ${r.counts.critical} critical · ${r.counts.warning} warnings${r.note ? `\n${r.note}` : ''}`, ''];
  for (const f of r.findings) {
    lines.push(`${ICON[f.severity]} ${f.title}${f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}${f.detail ? `\n   ${f.detail}` : ''}${f.fix && f.fix.text ? `\n   → ${f.fix.text}` : ''}${f.fix && f.fix.id ? `\n   ⚡ one-click fix: shield_fix fix="${f.fix.id}"` : ''}`);
  }
  if (!r.findings.length) lines.push('✓ Nothing found.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- project scan
async function scanProject(dir, { purpose = 'review', remotePath = '' } = {}) {
  const root = path.resolve(String(dir || ''));
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const webroot = purpose === 'server' && WEBROOT_RE.test(String(remotePath || ''));
  const { base, files, truncated, git } = await listFiles(root, { useGitignore: purpose === 'github' });
  const findings = [];
  const isPublic = (rel) => webroot || (/\.(m?js|cjs|html?|css|map|json|txt|xml|svg)$/i.test(rel) && (PUBLIC_DIR_RE.test(rel) || (!rel.includes('/') && /\.html?$/i.test(rel))));
  // where would a leak go? public = anyone on the internet can read it
  const sevFor = (rel, hard) => {
    if (purpose === 'github') return hard ? 'critical' : 'warning';
    if (isPublic(rel)) return hard ? 'critical' : 'warning';
    return 'warning';
  };
  const add = (f) => findings.push({ id: f.id || slug(f.title), ...f });
  const maps = [];
  const sqlTables = new Map(); // table -> file
  const rlsOn = new Set();
  let supabase = false;
  let scanned = 0;
  for (const rel of files) {
    const abs = path.join(base, rel);
    if (SKIP_FILES.test(rel)) continue;
    let st;
    try { st = await fsp.stat(abs); } catch { continue; }
    if (!st.isFile()) continue;
    const name = path.basename(rel);
    // sensitive files by name
    if (ENV_FILE.test(rel) && !ENV_TEMPLATE.test(rel)) {
      let body = '';
      try { body = (await fsp.readFile(abs, 'utf8')).slice(0, 200000); } catch {}
      const vals = body.split(/\r?\n/).filter((l) => /^\s*[A-Za-z_][\w.]*\s*=\s*\S/.test(l) && !/=\s*["']?\s*["']?\s*$/.test(l));
      if (vals.length) {
        const pub = purpose === 'github' || isPublic(rel) || webroot;
        add({ id: `env-file:${rel}`, severity: pub ? 'critical' : 'warning', title: pub ? 'Environment file with secrets would be published' : purpose === 'server' ? 'Environment file with secrets is uploaded' : 'Environment file with secrets in the project', file: rel, detail: `${vals.length} value${vals.length === 1 ? '' : 's'} (e.g. ${vals.slice(0, 3).map((l) => l.split('=')[0].trim()).join(', ')})`, fix: { text: purpose === 'github' ? 'add .env* to .gitignore (keep a .env.example without values) and rotate any key that was ever pushed' : 'keep it outside the web root with chmod 600, or set the values as environment variables on the server' } });
      }
      if (/^\s*(APP_DEBUG|DEBUG)\s*=\s*(true|1|yes)\s*$/im.test(body)) add({ id: `debug-env:${rel}`, severity: 'warning', title: 'Debug mode is on in the environment file', file: rel, fix: { text: 'set APP_DEBUG=false / DEBUG=0 for production (debug pages leak code, paths and secrets)' } });
      scanned++;
      continue;
    }
    if (KEY_FILE.test(rel)) { add({ id: `key-file:${rel}`, severity: purpose === 'server' && !isPublic(rel) ? 'warning' : 'critical', title: 'Private key / certificate store in the project', file: rel, fix: { text: 'remove it from the project folder (store keys in the app or the server keyring) and replace the key if it was ever published' } }); continue; }
    if (DB_FILE.test(rel)) { add({ id: `db-file:${rel}`, severity: isPublic(rel) ? 'critical' : 'warning', title: 'Database file in the project', file: rel, detail: `${Math.round(st.size / 1024)} KB — it may contain user data`, fix: { text: 'keep databases out of published folders (add *.db / *.sqlite to .gitignore)' } }); continue; }
    if (/\.map$/i.test(rel)) { if (purpose !== 'github' && isPublic(rel)) maps.push(rel); continue; }
    if (st.size > MAX_BYTES) continue;
    let buf;
    try { buf = await fsp.readFile(abs); } catch { continue; }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const text = buf.toString('utf8');
    scanned++;
    // secrets in the content
    for (const s of findSecrets(text)) {
      if (s.anon) { supabase = true; continue; }
      if (s.id === 'google-key') { if (isPublic(rel)) add({ id: `google-key:${rel}`, severity: 'info', title: 'Google API key in public code', file: rel, line: lineAt(text, s.index), detail: `${mask(s.value)} — normal for Firebase web configs`, fix: { text: 'restrict the key to your domains and APIs in Google Cloud Console' } }); continue; }
      const sev = s.generic ? 'warning' : sevFor(rel, true);
      add({ id: `${s.id}:${rel}:${lineAt(text, s.index)}`, severity: sev, title: `${s.title}${isPublic(rel) && purpose !== 'github' ? ' in a file browsers can download' : ''}`, file: rel, line: lineAt(text, s.index), detail: `value ${mask(s.value)}`, fix: { text: s.generic ? 'move it to an environment variable (.env, not committed) and read it at runtime' : 'remove it from the code, load it from an environment variable on the server, and revoke/rotate this key — treat it as leaked' } });
    }
    if (/supabase/i.test(text) && /createClient|supabase\.co/.test(text)) supabase = true;
    // database rules
    if (/(^|\/)(firestore|storage)\.rules$/.test(rel) && /allow\s+read\s*,\s*write\s*(;|:\s*if\s+true)|allow\s+(read|write)\s*:\s*if\s+true/i.test(text)) add({ id: `firebase-rules:${rel}`, severity: 'critical', title: 'Firebase rules let anyone read or write', file: rel, fix: { text: 'require auth, e.g. allow read, write: if request.auth != null && request.auth.uid == userId;' } });
    if (/(^|\/)database\.rules\.json$/.test(rel) && /"\.(read|write)"\s*:\s*true/.test(text)) add({ id: `firebase-rtdb:${rel}`, severity: 'critical', title: 'Firebase Realtime Database rules are public', file: rel, fix: { text: 'use ".read": "auth != null" (and per-user rules)' } });
    if (/\.sql$/i.test(rel)) {
      const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][\w]*)"?/gi;
      let m; while ((m = ct.exec(text))) if (!sqlTables.has(m[1].toLowerCase())) sqlTables.set(m[1].toLowerCase(), rel);
      const rl = /alter\s+table\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z_][\w]*)"?\s+enable\s+row\s+level\s+security/gi;
      while ((m = rl.exec(text))) rlsOn.add(m[1].toLowerCase());
      if (/auth\.uid\(\)|supabase/i.test(text)) supabase = true;
    }
    // debug flags
    if (/(^|\/)settings\.py$/.test(rel) && /^\s*DEBUG\s*=\s*True\b/m.test(text)) add({ id: `django-debug:${rel}`, severity: 'warning', title: 'Django DEBUG = True', file: rel, line: lineAt(text, text.search(/^\s*DEBUG\s*=\s*True/m)), fix: { text: 'DEBUG = os.environ.get("DEBUG") == "1" and never 1 in production' } });
    if (/\.py$/.test(rel) && /\.run\([^)]*debug\s*=\s*True/.test(text)) add({ id: `flask-debug:${rel}`, severity: 'warning', title: 'Flask app runs with debug=True', file: rel, line: lineAt(text, text.search(/\.run\([^)]*debug\s*=\s*True/)), fix: { text: 'the debugger allows running code from the browser — turn it off in production' } });
  }
  if (maps.length) add({ id: 'source-maps', severity: 'warning', title: `${maps.length} source map${maps.length === 1 ? '' : 's'} would be public`, file: maps.slice(0, 4).join(', ') + (maps.length > 4 ? ', …' : ''), detail: 'source maps let anyone download your original source code', fix: { text: 'build without source maps for production (Vite: build.sourcemap=false, Next.js: productionBrowserSourceMaps=false) or do not upload *.map' } });
  if (supabase && sqlTables.size) {
    const open = [...sqlTables.keys()].filter((t) => !rlsOn.has(t));
    if (open.length) add({ id: 'supabase-rls', severity: 'warning', title: `Supabase tables without row-level security: ${open.slice(0, 8).join(', ')}${open.length > 8 ? '…' : ''}`, file: [...new Set(open.map((t) => sqlTables.get(t)))].slice(0, 3).join(', '), detail: 'without RLS anyone with the public anon key can read (and often change) these tables', fix: { text: 'alter table <name> enable row level security; then add policies like using (auth.uid() = user_id)' } });
  }
  if (purpose === 'github' && !git) {
    const envs = files.filter((f) => ENV_FILE.test(f) && !ENV_TEMPLATE.test(f));
    if (!fs.existsSync(path.join(root, '.gitignore'))) add({ id: 'no-gitignore', severity: envs.length ? 'critical' : 'warning', title: 'No .gitignore file', detail: 'without it .env files, keys, builds and node_modules get published', fix: { text: 'add a .gitignore with at least: node_modules/ .env* !.env.example dist/ build/ *.pem *.key *.keystore *.db' } });
  }
  const r = summarize({ kind: 'project', target: root, purpose, scannedFiles: scanned, findings });
  if (truncated) r.note = `Only the first ${MAX_FILES} files were scanned.`;
  return r;
}

// ---------------------------------------------------------------- server scan
const SHIELD_EXTRA = String.raw`
echo "== WHOAMI"; id -u; (sudo -n true 2>/dev/null && echo sudo-ok || echo sudo-no)
echo "== PKG"; if command -v apt-get >/dev/null 2>&1; then echo apt; elif command -v dnf >/dev/null 2>&1; then echo dnf; elif command -v yum >/dev/null 2>&1; then echo yum; else echo unknown; fi
echo "== SSHVER"; ssh -V 2>&1 | head -1
echo "== KEX"; (sudo -n sshd -T 2>/dev/null || sshd -T 2>/dev/null) | grep -i '^kexalgorithms' | head -1
echo "== SSHPORT"; (sudo -n sshd -T 2>/dev/null || sshd -T 2>/dev/null) | awk '/^port /{print $2}' | head -3
echo "== SSHINCLUDE"; grep -cE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config 2>/dev/null || echo 0
echo "== AUTHFAIL"; ( (sudo -n journalctl -q -u ssh -u sshd --since "-24h" --no-pager 2>/dev/null || journalctl -q -u ssh -u sshd --since "-24h" --no-pager 2>/dev/null || sudo -n tail -n 20000 /var/log/auth.log 2>/dev/null || tail -n 20000 /var/log/auth.log 2>/dev/null) | grep -cE 'Failed password|Invalid user|authentication failure' )
echo "== ENVPERM"; for d in /var/www /srv /opt /home; do [ -d "$d" ] && find "$d" -maxdepth 5 -type f \( -name '.env' -o -name '.env.*' \) -perm -o+r 2>/dev/null | grep -vE '\.(example|sample|template)$' | head -10; done
echo "== NGINX"; if command -v nginx >/dev/null 2>&1; then (sudo -n nginx -T 2>/dev/null || nginx -T 2>/dev/null) | grep -cE 'location\s+~\*?\s+/\\\.'; else echo none; fi
echo "== UFW"; command -v ufw >/dev/null 2>&1 && echo yes || echo no
echo "== FIREWALLD"; command -v firewall-cmd >/dev/null 2>&1 && echo yes || echo no
echo "== END"
`;
const FIX_FOR = [
  [/No active firewall/, 'firewall'], [/SSH allows root login/, 'ssh-root'], [/SSH password login is enabled/, 'ssh-password'],
  [/security updates pending|package updates pending/, 'updates'], [/Automatic security updates/, 'auto-updates'], [/fail2ban is not running/, 'fail2ban'],
];
function sections(out) {
  const sec = {};
  let cur = null;
  for (const l of String(out).split('\n')) { const m = l.match(/^== (\w+)/); if (m) { cur = m[1]; sec[cur] = []; } else if (cur && l.trim() && !/^\[exit code/.test(l.trim())) sec[cur].push(l.trim()); }
  return sec;
}
function analyseShield(out) {
  const base = analyseServer(out);
  const sec = sections(out);
  const findings = [];
  for (const line of base.findings) {
    const [head, ...rest] = line.split('\n');
    const sym = head[0];
    const severity = sym === '✗' ? 'critical' : sym === '⚠' ? 'warning' : sym === '✓' ? 'ok' : 'info';
    const title = head.slice(2).trim();
    const fixText = rest.join(' ').replace(/^\s*→\s*/, '').trim();
    const fx = FIX_FOR.find(([re]) => re.test(title));
    findings.push({ id: fx ? fx[1] : slug(title), severity, title, fix: fixText || fx ? { text: fixText, id: fx && severity !== 'ok' ? fx[1] : undefined } : undefined });
  }
  const env = {
    root: (sec.WHOAMI || [])[0] === '0', sudo: (sec.WHOAMI || []).includes('sudo-ok'), pkg: (sec.PKG || [])[0] || 'unknown',
    sshPort: Number((sec.SSHPORT || [])[0]) || 22, sshInclude: Number((sec.SSHINCLUDE || [])[0]) > 0,
    ufw: (sec.UFW || [])[0] === 'yes', firewalld: (sec.FIREWALLD || [])[0] === 'yes',
  };
  // post-quantum SSH (harvest-now-decrypt-later protection for everything sent over SSH)
  const kex = ((sec.KEX || [])[0] || '').toLowerCase();
  const ver = ((sec.SSHVER || [])[0] || '').match(/OpenSSH_(\d+)\.(\d+)/);
  if (/mlkem768x25519/.test(kex)) findings.push({ id: 'pq-ssh', severity: 'ok', title: 'SSH uses post-quantum key exchange (ML-KEM)' });
  else if (/sntrup761x25519/.test(kex)) findings.push({ id: 'pq-ssh', severity: 'ok', title: 'SSH uses post-quantum key exchange (sntrup761)', fix: { text: 'OpenSSH 10+ prefers the standardised ML-KEM (mlkem768x25519-sha256)' } });
  else if (kex || (ver && Number(ver[1]) < 9)) findings.push({ id: 'pq-ssh', severity: 'warning', title: `SSH key exchange is not post-quantum${ver ? ` (OpenSSH ${ver[1]}.${ver[2]})` : ''}`, detail: 'recorded SSH sessions could be decrypted later by a quantum computer', fix: { text: 'upgrade OpenSSH to 9.0+ (10.0+ uses ML-KEM by default) — usually by upgrading the OS release' } });
  // brute force
  const fails = Number((sec.AUTHFAIL || [])[0]) || 0;
  const f2b = (sec.FAIL2BAN || []).some((l) => /^active/.test(l));
  if (fails > 50 && !f2b) findings.push({ id: 'bruteforce', severity: 'warning', title: `${fails} failed SSH logins in the last 24 h`, detail: 'someone is guessing passwords and nothing blocks them', fix: { text: 'install fail2ban and use SSH keys only', id: 'fail2ban' } });
  else if (fails > 0) findings.push({ id: 'bruteforce', severity: 'info', title: `${fails} failed SSH logins in the last 24 h${f2b ? ' (fail2ban is blocking repeat offenders)' : ''}` });
  // secrets readable by every user on the server
  if ((sec.ENVPERM || []).length) findings.push({ id: 'env-perms', severity: 'warning', title: `${sec.ENVPERM.length} .env file${sec.ENVPERM.length === 1 ? ' is' : 's are'} readable by every user`, detail: sec.ENVPERM.slice(0, 5).join(', '), fix: { text: 'chmod o-r on them (the app user still reads them)', id: 'env-perms' } });
  const ng = (sec.NGINX || [])[0];
  if (ng && ng !== 'none' && Number(ng) === 0) findings.push({ id: 'nginx-dotfiles', severity: 'warning', title: 'nginx does not block hidden files (/.env, /.git)', fix: { text: 'add to every server block: location ~ /\\.(?!well-known) { deny all; }' } });
  const publicPorts = [...new Set(((base.listen || '').split('\n')).filter((l) => /(^|\s)(0\.0\.0\.0|\*|\[::\]|::):\d+/.test(l)).map((l) => Number((l.match(/:(\d+)\s/) || [])[1])).filter(Boolean))].sort((a, b) => a - b);
  return { findings, os: base.os, env, publicPorts };
}

// ---------------------------------------------------------------- site scan
async function fetchText(u, { maxBytes = 3 * 1024 * 1024, headers = {}, timeoutMs = 12000 } = {}) {
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Carpathron-Shield', ...headers } });
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) return { res, text: '' };
  const text = await res.text();
  return { res, text: text.slice(0, maxBytes) };
}
async function probeSupabase(ref, anon) {
  const base = `https://${ref}.supabase.co/rest/v1`;
  const h = { apikey: anon, Authorization: `Bearer ${anon}` };
  const open = [];
  let tables = [];
  try {
    const { res, text } = await fetchText(`${base}/`, { headers: { ...h, Accept: 'application/openapi+json' } });
    if (res.ok) tables = Object.keys((JSON.parse(text) || {}).paths || {}).map((p) => p.replace(/^\//, '')).filter((t) => t && !t.startsWith('rpc/') && !t.includes('/'));
  } catch {}
  for (const t of tables.slice(0, 30)) {
    try {
      const { res, text } = await fetchText(`${base}/${encodeURIComponent(t)}?select=*&limit=1`, { headers: h, timeoutMs: 8000 });
      if (res.ok) { const j = JSON.parse(text); if (Array.isArray(j) && j.length) open.push(t); }
    } catch {}
  }
  return { tables, open };
}
async function scanSite(input, { deep = false } = {}) {
  let u = String(input || '').trim();
  if (!u) throw new Error('Give a url or domain');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  const findings = [];
  // baseline checks (certificate, redirect, headers, exposed files) from security_check
  const base = await securityCheck({ url: url.href }, {});
  for (const l of base.split('\n')) {
    const sym = l[0];
    if (!'✓✗⚠'.includes(sym) || /^Summary/.test(l)) continue;
    const [t, fix] = l.slice(2).split(/\s→\s/);
    const severity = sym === '✗' ? 'critical' : sym === '⚠' ? 'warning' : 'ok';
    findings.push({ id: slug(t.replace(/\d+/g, '')), severity, title: t.trim(), fix: fix ? { text: fix.trim() } : undefined });
  }
  // the JavaScript the site sends to every visitor
  let page;
  try { page = await fetchText(url.href); } catch (e) { return summarize({ kind: 'site', target: url.origin, findings: [...findings, { id: 'unreachable', severity: 'critical', title: `Site did not answer (${e.message})` }] }); }
  const finalUrl = new URL(page.res.url || url.href);
  const srcs = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => { try { return new URL(m[1], finalUrl); } catch { return null; } }).filter((x) => x && x.host === finalUrl.host).slice(0, 25);
  const inline = [...page.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const bundles = [{ name: finalUrl.pathname || '/', text: inline }];
  for (const s of srcs) { try { const r = await fetchText(s.href); if (r.res.ok) bundles.push({ name: s.pathname, text: r.text, url: s.href }); } catch {} }
  let supa = null, fb = null, mapsOpen = [];
  for (const b of bundles) {
    for (const s of findSecrets(b.text)) {
      if (s.anon) { const ref = (b.text.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/) || [])[1] || s.ref; if (ref) supa = { ref, anon: s.value }; continue; }
      if (s.id === 'google-key') { findings.push({ id: `google-key:${b.name}`, severity: 'info', title: 'Google API key in the site JavaScript', file: b.name, detail: `${mask(s.value)} — normal for Firebase`, fix: { text: 'restrict it to your domain and the needed APIs in Google Cloud Console' } }); continue; }
      if (s.generic) { findings.push({ id: `hardcoded:${b.name}`, severity: 'warning', title: `${s.title} in the site JavaScript`, file: b.name, detail: `value ${mask(s.value)}`, fix: { text: 'secrets never belong in browser code — move the call to your server' } }); continue; }
      findings.push({ id: `${s.id}:${b.name}`, severity: 'critical', title: `${s.title} is in the site JavaScript — anyone can copy it`, file: b.name, detail: `value ${mask(s.value)}`, fix: { text: 'revoke/rotate this key NOW, then move the code that uses it to your server' } });
    }
    const fbm = b.text.match(/https:\/\/([a-z0-9-]+(?:-default-rtdb)?\.(?:firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app))/);
    if (fbm) fb = fbm[1];
    const sm = b.url && b.text.match(/\/\/[#@] sourceMappingURL=([^\s'"]+)/);
    if (sm && !/^data:/.test(sm[1])) {
      try { const mu = new URL(sm[1], b.url); const r = await fetchText(mu.href, { maxBytes: 200000 }); if (r.res.ok && /"sources"\s*:/.test(r.text)) mapsOpen.push(mu.pathname); } catch {}
    }
  }
  if (mapsOpen.length) findings.push({ id: 'public-source-maps', severity: 'warning', title: `Source maps are public (${mapsOpen.length})`, file: mapsOpen.slice(0, 3).join(', '), detail: 'anyone can download your original source code', fix: { text: 'build without source maps for production or block *.map in the web server' } });
  if (supa) {
    if (deep) {
      const p = await probeSupabase(supa.ref, supa.anon);
      if (p.open.length) findings.push({ id: 'supabase-open', severity: 'critical', title: `Supabase tables readable by anyone: ${p.open.join(', ')}`, detail: `checked ${p.tables.length} table${p.tables.length === 1 ? '' : 's'} with the public anon key from your site (1 row each, nothing kept). Write access was not tested.`, fix: { text: 'enable row-level security on these tables and add policies (e.g. using (auth.uid() = user_id))' } });
      else findings.push({ id: 'supabase-open', severity: 'ok', title: `Supabase: no table returned data to anonymous visitors${p.tables.length ? ` (${p.tables.length} checked)` : ''}` });
    } else findings.push({ id: 'supabase-detected', severity: 'info', title: `Supabase project ${supa.ref} detected`, fix: { text: 'run a deep scan to check whether its tables can be read by anyone' } });
  }
  if (fb && deep) {
    try {
      const r = await fetchText(`https://${fb}/.json?shallow=true`, { maxBytes: 100000 });
      if (r.res.ok && !/permission denied/i.test(r.text)) findings.push({ id: 'firebase-open', severity: 'critical', title: `Firebase Realtime Database ${fb} is readable by anyone`, fix: { text: 'set ".read": "auth != null" (and per-user rules) in the database rules' } });
      else findings.push({ id: 'firebase-open', severity: 'ok', title: `Firebase Realtime Database ${fb} refuses anonymous reads` });
    } catch {}
  }
  if (bundles.length > 1 && !findings.some((f) => /in the site JavaScript/.test(f.title))) findings.push({ id: 'bundle-secrets', severity: 'ok', title: `No secret keys in the site JavaScript (${bundles.length - 1} file${bundles.length === 2 ? '' : 's'} checked)` });
  return summarize({ kind: 'site', target: url.origin, deep: !!deep, findings });
}

// ---------------------------------------------------------------- fixes
const BK = '/var/backups/carpathron-shield';
const deadmanSeconds = () => Math.max(2, Number(process.env.MC_SHIELD_DEADMAN) || 150); // tests shorten it
const FIXES = {
  fail2ban: {
    title: 'Block password guessing with fail2ban', lockout: false,
    plan: (e) => {
      const install = e.pkg === 'apt' ? 'DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban' : e.pkg === 'dnf' || e.pkg === 'yum' ? `${e.pkg} install -y epel-release >/dev/null 2>&1 || true; ${e.pkg} install -y fail2ban` : null;
      if (!install) throw new Error('Unknown package manager on this server (apt or dnf needed).');
      const jail = `[sshd]\nenabled = true\nport = ${e.sshPort}\nmaxretry = 5\nfindtime = 10m\nbantime = 1h\n`;
      return { commands: [install, 'mkdir -p /etc/fail2ban/jail.d', `printf %s ${shq(jail)} > /etc/fail2ban/jail.d/carpathron-shield.local`, 'systemctl enable --now fail2ban', 'systemctl restart fail2ban', 'sleep 2; fail2ban-client status sshd | head -5'], undo: ['rm -f /etc/fail2ban/jail.d/carpathron-shield.local', 'systemctl restart fail2ban || true'], files: [] };
    },
  },
  'auto-updates': {
    title: 'Install security updates automatically', lockout: false,
    plan: (e) => {
      if (e.pkg === 'apt') {
        const conf = 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n';
        return { commands: ['DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades', `printf %s ${shq(conf)} > /etc/apt/apt.conf.d/20auto-upgrades`, 'systemctl enable --now unattended-upgrades || true', 'echo auto-updates on'], files: ['/etc/apt/apt.conf.d/20auto-upgrades'], undo: 'restore' };
      }
      if (e.pkg === 'dnf') return { commands: ['dnf install -y dnf-automatic', "sed -i 's/^upgrade_type.*/upgrade_type = security/; s/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf", 'systemctl enable --now dnf-automatic.timer'], files: ['/etc/dnf/automatic.conf'], undo: 'restore' };
      throw new Error('Unknown package manager on this server.');
    },
  },
  updates: {
    title: 'Install pending updates now', lockout: false, caution: 'Services may restart; a reboot may be needed afterwards.',
    plan: (e) => {
      if (e.pkg === 'apt') return { commands: ['export DEBIAN_FRONTEND=noninteractive; apt-get update -q && apt-get -y -q -o Dpkg::Options::=--force-confold upgrade', '[ -f /var/run/reboot-required ] && echo "reboot required" || echo "no reboot needed"'], files: [] };
      if (e.pkg === 'dnf' || e.pkg === 'yum') return { commands: [`${e.pkg} -y upgrade --security || ${e.pkg} -y upgrade`], files: [] };
      throw new Error('Unknown package manager on this server.');
    },
  },
  firewall: {
    title: 'Turn on the firewall (SSH + web stay open)', lockout: true,
    plan: (e, opts) => {
      const ports = [...new Set([e.sshPort, 80, 443, ...(opts.allowPorts || [])].map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))];
      if (e.ufw || e.pkg === 'apt') {
        return { commands: [...(e.ufw ? [] : ['DEBIAN_FRONTEND=noninteractive apt-get install -y ufw']), ...ports.map((p) => `ufw allow ${p}/tcp`), 'ufw --force enable', 'ufw status numbered | head -20'], undo: ['ufw --force disable'], files: [], ports };
      }
      if (e.firewalld || e.pkg === 'dnf' || e.pkg === 'yum') {
        return { commands: [...(e.firewalld ? [] : [`${e.pkg} install -y firewalld`]), 'systemctl enable --now firewalld', ...ports.map((p) => `firewall-cmd --permanent --add-port=${p}/tcp`), 'firewall-cmd --reload', 'firewall-cmd --list-ports'], undo: ['systemctl stop firewalld'], files: [], ports };
      }
      throw new Error('No ufw or firewalld available on this server.');
    },
  },
  'ssh-root': {
    title: 'Allow root SSH login only with keys', lockout: true, needsKey: true,
    plan: (e) => sshDropIn(e, '00-carpathron-shield-root.conf', 'PermitRootLogin prohibit-password\n'),
  },
  'ssh-password': {
    title: 'Turn off SSH password logins (keys only)', lockout: true, needsKey: true,
    plan: (e) => sshDropIn(e, '00-carpathron-shield-password.conf', 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n'),
  },
  'env-perms': {
    title: 'Make .env files private to their owner', lockout: false,
    plan: () => ({ commands: [String.raw`for d in /var/www /srv /opt /home; do [ -d "$d" ] && find "$d" -maxdepth 5 -type f \( -name '.env' -o -name '.env.*' \) -perm -o+r ! -name '*.example' ! -name '*.sample' ! -name '*.template' -print -exec chmod o-r {} +; done; echo done`], files: [] }),
  },
};
function sshDropIn(e, file, body) {
  if (!e.sshInclude) throw new Error('This server\'s sshd_config does not include /etc/ssh/sshd_config.d/*.conf, so Shield cannot change it safely. Ask the agent to make the change by hand.');
  const f = `/etc/ssh/sshd_config.d/${file}`;
  return {
    commands: [`printf %s ${shq(body)} > ${f}`, `if ! sshd -t; then rm -f ${f}; echo "sshd config test failed — change removed"; exit 1; fi`, 'systemctl reload ssh 2>/dev/null || systemctl reload sshd', `echo "${file} active"`],
    undo: [`rm -f ${f}`, 'systemctl reload ssh 2>/dev/null || systemctl reload sshd'], files: [],
  };
}
const FIX_IDS = Object.keys(FIXES);

// ---------------------------------------------------------------- monitor
const MONITOR_CHECK = (min) => String.raw`
echo "== PORTS"; ss -tlnH 2>/dev/null | awk '{print $5}' | grep -E '^(0\.0\.0\.0|\*|\[::\]|::):[0-9]+$' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un
echo "== AUTHFAIL"; ( (sudo -n journalctl -q -u ssh -u sshd --since "-${min}min" --no-pager 2>/dev/null || journalctl -q -u ssh -u sshd --since "-${min}min" --no-pager 2>/dev/null) | grep -cE 'Failed password|Invalid user|authentication failure' )
echo "== BANNED"; (sudo -n fail2ban-client status sshd 2>/dev/null || fail2ban-client status sshd 2>/dev/null) | awk -F: '/Total banned/{gsub(/[ \t]/,"",$2);print $2}'
echo "== LOAD"; cut -d' ' -f1 /proc/loadavg; nproc
echo "== DISK"; df -P / | awk 'NR==2{print $5}'
echo "== LOGINS"; last -i -n 10 2>/dev/null | awk '$1!="reboot" && $1!="wtmp" && NF>3 {print $1" "$3}' | head -10
echo "== END"
`;
const RISKY_PORTS = { 3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 27017: 'MongoDB', 9200: 'Elasticsearch', 11211: 'Memcached', 2375: 'Docker API', 5984: 'CouchDB', 3000: 'dev server', 5000: 'dev server', 8080: 'admin / dev server', 9000: 'admin panel' };

class Shield {
  constructor({ store, remote, log, emit, dataDir }) {
    this.store = store; this.remote = remote; this.log = log || (() => {}); this.emit = emit || (() => {});
    this.dir = dataDir ? path.join(dataDir, 'shield') : null;
    if (this.dir) try { fs.mkdirSync(this.dir, { recursive: true }); } catch {}
    const st = this.cfg();
    if (!st.monitors) st.monitors = {};
    if (!Array.isArray(st.history)) st.history = [];
    this.timers = new Map();
    this.busy = new Set();
    this.state = new Map(); // serverId -> runtime monitor state
    this.events = this.readJson('events.json', []);
    this.last = this.readJson('last.json', {});
  }
  cfg() { if (!this.store.settings.shield) this.store.settings.shield = {}; return this.store.settings.shield; }
  readJson(f, def) { if (!this.dir) return def; try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); } catch { return def; } }
  writeJson(f, v) { if (!this.dir) return; try { fs.writeFileSync(path.join(this.dir, f), JSON.stringify(v)); } catch {} }
  remember(key, r) {
    this.last[key] = r;
    const keys = Object.keys(this.last).sort((a, b) => (this.last[b].at || 0) - (this.last[a].at || 0));
    for (const k of keys.slice(40)) delete this.last[k];
    this.writeJson('last.json', this.last);
    this.emit('shield:scan', { key, summary: { kind: r.kind, target: r.target, score: r.score, grade: r.grade, counts: r.counts, at: r.at } });
    return r;
  }

  // ------------------------------------------------------------ scans
  async scanProject(dir, opts = {}) { const r = await scanProject(dir, opts); return this.remember(`project:${r.target}`, r); }
  async scanSite(url, opts = {}) { const r = await scanSite(url, opts); return this.remember(`site:${r.target}`, r); }
  async serverEnv(ref) {
    const s = this.remote.need(ref);
    const e = await this.remote.connect(s);
    if (e.os === 'windows') throw new Error(`${s.name} is a Windows server. Shield server scans, fixes and monitoring support Linux servers for now; use security_check for the website.`);
    return s;
  }
  async scanServer(ref, { signal } = {}) {
    const s = await this.serverEnv(ref);
    const out = await this.remote.exec(s.id, SERVER_CHECK + SHIELD_EXTRA, { timeoutMs: 150000, signal });
    const a = analyseShield(out);
    const r = summarize({ kind: 'server', target: `${s.name} (${s.username}@${s.host})`, serverId: s.id, os: a.os, env: a.env, publicPorts: a.publicPorts, findings: a.findings });
    r.canFix = a.env.root || a.env.sudo;
    if (!r.canFix) r.note = 'One-click fixes need root or passwordless sudo on this server.';
    const m = this.cfg().monitors[s.id];
    if (m && !m.baseline) { m.baseline = a.publicPorts; this.store.saveSettings(); }
    return this.remember(`server:${s.id}`, r);
  }
  // Publish gate: blocks when the scan finds critical problems.
  async gate(local, { purpose, remotePath } = {}) {
    const r = await this.scanProject(local, { purpose, remotePath });
    const crit = r.findings.filter((f) => f.severity === 'critical');
    if (!crit.length) return { blocked: false, result: r };
    const list = crit.slice(0, 10).map((f) => `✗ ${f.title}${f.file ? ` — ${f.file}${f.line ? `:${f.line}` : ''}` : ''}${f.fix && f.fix.text ? `\n   → ${f.fix.text}` : ''}`).join('\n');
    return { blocked: true, result: r, message: `Carpathron Shield stopped this publish: ${crit.length} critical problem${crit.length === 1 ? '' : 's'} in ${r.target}.\n${list}${crit.length > 10 ? `\n… and ${crit.length - 10} more` : ''}\nFix them and publish again. Only if the user explicitly confirms the risk, call the publish again with allow_risky: true.` };
  }

  // ------------------------------------------------------------ fixes
  async fixPlan(ref, fixId, opts = {}) {
    const fx = FIXES[fixId];
    if (!fx) throw new Error(`Unknown fix "${fixId}". Available: ${FIX_IDS.join(', ')}`);
    const s = await this.serverEnv(ref);
    const out = await this.remote.exec(s.id, SHIELD_EXTRA, { timeoutMs: 60000 });
    const a = analyseShield(`== LISTENING\n${out}`);
    const e = a.env;
    if (!e.root && !e.sudo) throw new Error(`Shield needs root or passwordless sudo on ${s.name} to apply fixes (logged in as ${s.username}).`);
    if (fx.needsKey && !(s.keyId || s.privateKey || s.keyPath)) throw new Error(`${s.name} logs in with a password. Install an SSH key first (Remote → 🔑 Install key), otherwise this change would lock the app out.`);
    const plan = fx.plan(e, opts);
    const last = this.last[`server:${s.id}`];
    let blocked = [];
    if (fixId === 'firewall' && last && last.publicPorts) blocked = last.publicPorts.filter((p) => !plan.ports.includes(p));
    return { server: s, env: e, fix: fx, plan, blocked, preview: { fix: fixId, title: fx.title, server: s.name, commands: plan.commands, undo: Array.isArray(plan.undo) ? plan.undo : plan.undo === 'restore' ? [`restore ${plan.files.join(', ')} from ${BK}`] : [], lockoutProtection: fx.lockout, caution: fx.caution || '', willBlockPorts: blocked } };
  }
  async preview(ref, fixId, opts = {}) { return (await this.fixPlan(ref, fixId, opts)).preview; }
  async applyFix(ref, fixId, opts = {}) {
    const { server: s, env: e, fix: fx, plan } = await this.fixPlan(ref, fixId, opts);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${fixId}`;
    const bdir = `${BK}/${id}`;
    const token = crypto.randomBytes(6).toString('hex');
    const undoCmds = Array.isArray(plan.undo) ? plan.undo : plan.undo === 'restore' ? plan.files.map((f) => `if [ -e ${shq(`${bdir}${f}`)} ]; then cp -a ${shq(`${bdir}${f}`)} ${shq(f)}; else rm -f ${shq(f)}; fi`) : [];
    const lines = ['set -e', `mkdir -p ${shq(bdir)}`, ...plan.files.map((f) => `if [ -e ${shq(f)} ]; then mkdir -p ${shq(path.posix.dirname(bdir + f))} && cp -a ${shq(f)} ${shq(bdir + f)}; fi`)];
    if (undoCmds.length) lines.push(`printf '%s\\n' ${undoCmds.map(shq).join(' ')} > ${shq(`${bdir}/undo.sh`)}`);
    if (fx.lockout && undoCmds.length) {
      // dead-man switch: undo automatically in 150 s unless the app confirms it can still log in
      lines.push(`nohup bash -c ${shq(`sleep ${deadmanSeconds()}; if [ ! -f ${BK}/${token}.ok ]; then bash ${bdir}/undo.sh; echo "auto-undone" > ${bdir}/auto-undone; fi`)} >/dev/null 2>&1 &`);
    }
    lines.push('set +e', ...plan.commands);
    const script = lines.join('\n');
    const wrapped = e.root ? script : `sudo -n bash -c ${shq(script)}`;
    this.log(`Shield: applying ${fixId} on ${s.name}`);
    const out = await this.remote.exec(s.id, wrapped, { timeoutMs: 600000, signal: opts.signal });
    const failed = /\[exit code [1-9]\d*\]\s*$/.test(out);
    let verified = null;
    if (fx.lockout && undoCmds.length) {
      // log in again over a NEW connection; only then cancel the automatic undo
      this.remote.disconnect(s.id);
      try {
        await this.remote.connect(s, { timeoutMs: 20000 });
        await this.remote.exec(s.id, e.root ? `touch ${BK}/${token}.ok` : `sudo -n touch ${BK}/${token}.ok`, { timeoutMs: 20000 });
        verified = true;
      } catch (err) {
        verified = false;
        this.log(`Shield: could not log in to ${s.name} after ${fixId} (${err.message}); the server undoes the change by itself within 150 s`);
      }
    }
    const entry = { id, serverId: s.id, server: s.name, fix: fixId, title: fx.title, at: Date.now(), ok: !failed && verified !== false, backup: bdir, undo: undoCmds.length > 0 };
    const st = this.cfg();
    st.history.unshift(entry); st.history = st.history.slice(0, 100);
    this.store.saveSettings();
    this.event({ serverId: s.id, server: s.name, severity: entry.ok ? 'ok' : 'warning', title: entry.ok ? `Fix applied: ${fx.title}` : `Fix did not finish: ${fx.title}`, detail: verified === false ? 'The app could not log in again, so the server will undo the change by itself within 2.5 minutes.' : '' });
    return { ...entry, verified, output: out };
  }
  async undo(historyId) {
    const st = this.cfg();
    const h = st.history.find((x) => x.id === historyId);
    if (!h) throw new Error('Unknown fix');
    if (!h.undo) throw new Error('This fix cannot be undone automatically.');
    const s = await this.serverEnv(h.serverId);
    const out = await this.remote.exec(s.id, `if [ "$(id -u)" = 0 ]; then bash ${shq(`${h.backup}/undo.sh`)}; else sudo -n bash ${shq(`${h.backup}/undo.sh`)}; fi; echo undone`, { timeoutMs: 120000 });
    h.undone = Date.now(); this.store.saveSettings();
    this.event({ serverId: s.id, server: s.name, severity: 'info', title: `Fix undone: ${h.title}` });
    return { ok: /undone/.test(out), output: out };
  }

  // ------------------------------------------------------------ monitor
  event(ev) {
    const e = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), ...ev };
    this.events.unshift(e);
    this.events = this.events.slice(0, 300);
    clearTimeout(this._saveEv); this._saveEv = setTimeout(() => this.writeJson('events.json', this.events), 500);
    this.emit('shield:event', e);
    return e;
  }
  monitorStart(ref, { intervalMin, urls } = {}) {
    const s = this.remote.need(ref);
    const m = this.cfg().monitors[s.id] || (this.cfg().monitors[s.id] = {});
    m.enabled = true;
    if (intervalMin !== undefined) m.intervalMin = Math.max(1, Math.min(60, Number(intervalMin) || 5));
    if (!m.intervalMin) m.intervalMin = 5;
    if (Array.isArray(urls)) m.urls = urls.map((u) => String(u).trim()).filter(Boolean).slice(0, 5);
    this.store.saveSettings();
    this.schedule(s.id);
    this.event({ serverId: s.id, server: s.name, severity: 'info', title: `Monitoring started (every ${m.intervalMin} min)` });
    return this.monitorStatus(s.id);
  }
  monitorStop(ref) {
    const s = this.remote.find(ref) || { id: ref, name: ref };
    const m = this.cfg().monitors[s.id];
    if (m) { m.enabled = false; this.store.saveSettings(); }
    clearInterval(this.timers.get(s.id)); this.timers.delete(s.id);
    this.event({ serverId: s.id, server: s.name, severity: 'info', title: 'Monitoring stopped' });
    return this.monitorStatus(s.id);
  }
  resetBaseline(ref) {
    const s = this.remote.need(ref);
    const m = this.cfg().monitors[s.id];
    if (m) { delete m.baseline; this.store.saveSettings(); }
    this.state.delete(s.id);
  }
  schedule(id) {
    clearInterval(this.timers.get(id));
    const m = this.cfg().monitors[id];
    if (!m || !m.enabled) return;
    this.timers.set(id, setInterval(() => this.tick(id).catch(() => {}), m.intervalMin * 60000));
    setTimeout(() => this.tick(id).catch(() => {}), 500);
  }
  resume() { for (const [id, m] of Object.entries(this.cfg().monitors)) if (m.enabled && this.remote.find(id)) this.schedule(id); }
  stopAll() { for (const t of this.timers.values()) clearInterval(t); this.timers.clear(); }
  monitorStatus(id) {
    const m = this.cfg().monitors[id] || {};
    const rt = this.state.get(id) || {};
    return { serverId: id, enabled: !!m.enabled, intervalMin: m.intervalMin || 5, urls: m.urls || [], baseline: m.baseline || null, lastTick: rt.lastTick || 0, lastOk: rt.lastOk || 0, down: !!rt.down };
  }
  status() {
    return {
      servers: this.remote.publicList().map((s) => ({ ...s, monitor: this.monitorStatus(s.id), lastScan: this.summaryOf(this.last[`server:${s.id}`]) })),
      scans: Object.entries(this.last).map(([key, r]) => ({ key, ...this.summaryOf(r) })).sort((a, b) => b.at - a.at),
      events: this.events.slice(0, 120),
      history: this.cfg().history.slice(0, 50),
      fixes: FIX_IDS.map((id) => ({ id, title: FIXES[id].title, lockout: FIXES[id].lockout })),
    };
  }
  summaryOf(r) { return r ? { kind: r.kind, target: r.target, score: r.score, grade: r.grade, counts: r.counts, at: r.at } : null; }
  async tick(id) {
    if (this.busy.has(id)) return;
    const m = this.cfg().monitors[id];
    const s = this.remote.find(id);
    if (!s) { clearInterval(this.timers.get(id)); this.timers.delete(id); return; }
    if (!m || !m.enabled) return;
    this.busy.add(id);
    const rt = this.state.get(id) || { fails: 0, logins: null, banned: null, flags: {}, exposed: new Set() };
    this.state.set(id, rt);
    rt.lastTick = Date.now();
    const ev = (severity, title, detail) => this.event({ serverId: id, server: s.name, severity, title, detail });
    try {
      let out;
      try { out = await this.remote.exec(s.id, MONITOR_CHECK(m.intervalMin), { timeoutMs: 60000 }); }
      catch (err) {
        rt.fails++;
        if (rt.fails === 2 && !rt.down) { rt.down = true; ev('critical', `${s.name} is not reachable`, err.message); }
        return;
      }
      if (rt.down) ev('ok', `${s.name} is reachable again`);
      rt.fails = 0; rt.down = false; rt.lastOk = Date.now();
      const sec = sections(out);
      // open ports vs. the baseline
      const ports = (sec.PORTS || []).map(Number).filter(Boolean);
      if (!m.baseline) { m.baseline = ports; this.store.saveSettings(); ev('info', `Baseline saved: public ports ${ports.join(', ') || 'none'}`); }
      else {
        const added = ports.filter((p) => !m.baseline.includes(p));
        const gone = m.baseline.filter((p) => !ports.includes(p));
        for (const p of added) ev(RISKY_PORTS[p] ? 'critical' : 'warning', `New public port ${p}${RISKY_PORTS[p] ? ` (${RISKY_PORTS[p]})` : ''} opened on ${s.name}`, 'If you did not open it, check what listens there: ss -tlnp');
        for (const p of gone) ev('info', `Port ${p} is no longer open on ${s.name}`);
        if (added.length || gone.length) { m.baseline = ports; this.store.saveSettings(); }
      }
      const fails = Number((sec.AUTHFAIL || [])[0]) || 0;
      if (fails >= 20) ev('warning', `${fails} failed SSH logins in ${m.intervalMin} min on ${s.name}`, 'Password guessing. Shield fixes: fail2ban, ssh-password.');
      const banned = Number((sec.BANNED || [])[0]);
      if (!isNaN(banned) && (sec.BANNED || []).length) { if (rt.banned !== null && banned > rt.banned) ev('info', `fail2ban blocked ${banned - rt.banned} more IP${banned - rt.banned === 1 ? '' : 's'} on ${s.name}`); rt.banned = banned; }
      const [load, cpus] = (sec.LOAD || []).map(Number);
      if (load && cpus && load > cpus * 2) { if (!rt.flags.load) { rt.flags.load = true; ev('warning', `High load on ${s.name} (${load} on ${cpus} CPUs)`); } } else if (load < cpus) rt.flags.load = false;
      const disk = Number(String((sec.DISK || [])[0] || '').replace('%', ''));
      if (disk >= 90) { if (!rt.flags.disk) { rt.flags.disk = true; ev('warning', `Disk ${disk}% full on ${s.name}`); } } else if (disk && disk < 85) rt.flags.disk = false;
      const logins = (sec.LOGINS || []).filter((l) => /\S+ \d{1,3}(\.\d{1,3}){3}|\S+ [0-9a-f:]+:/.test(l));
      if (rt.logins === null) rt.logins = new Set(logins);
      else for (const l of logins) if (!rt.logins.has(l)) { rt.logins.add(l); const [u, ip] = l.split(' '); ev('info', `New SSH login on ${s.name}: ${u} from ${ip}`, 'If this was not you or your team, change passwords and keys now.'); }
      // websites served from this server: files that must never be public
      for (const site of m.urls || []) {
        for (const p of ['/.env', '/.git/HEAD']) {
          const key = `${site}${p}`;
          let hit = false;
          try {
            const base = /^https?:\/\//.test(site) ? site : `https://${site}`;
            const r = await fetch(new URL(p, base), { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Carpathron-Shield-monitor' } });
            const body = r.status === 200 ? (await r.text()).slice(0, 300) : '';
            hit = r.status === 200 && (p === '/.env' ? /^\s*[A-Z_][A-Z0-9_]*\s*=/m.test(body) && !/<html/i.test(body) : /^ref:/.test(body));
          } catch {}
          if (hit && !rt.exposed.has(key)) { rt.exposed.add(key); ev('critical', `${p} is publicly readable on ${site}`, 'Anyone can download it. Block hidden files in the web server and rotate the secrets inside.'); }
          if (!hit) rt.exposed.delete(key);
        }
      }
      this.emit('shield:status', this.monitorStatus(id));
    } finally { this.busy.delete(id); }
  }
}

// ---------------------------------------------------------------- agent tools
const SHIELD_TOOLS = [
  { name: 'shield_scan', risk: 'read', description: 'Carpathron Shield security scan with structured findings and fixes. target "project": a local folder or file BEFORE publishing (API keys and passwords in code, .env files, private keys, database files, public source maps, open Firebase rules, Supabase tables without row-level security, debug mode); purpose "github" respects .gitignore, purpose "server" treats web roots and build folders as public. target "server": a saved Linux SSH server (firewall, SSH root/password login, post-quantum SSH key exchange, updates, password-guessing attempts, exposed databases, world-readable .env files, web root leaks, nginx hidden-file rules). target "site": a website (HTTPS, headers, exposed files, secret keys inside its JavaScript, public source maps; deep=true also checks whether its Supabase tables or Firebase database can be read by anyone). Only for projects, servers and sites the user owns or manages.', parameters: obj({ target: { type: 'string', enum: ['project', 'server', 'site'] }, path: { type: 'string', description: 'project folder or file (target project)' }, purpose: { type: 'string', enum: ['github', 'server', 'review'], description: 'where the project is going (default review)' }, remote_path: { type: 'string', description: 'upload destination on the server, if known (web roots are public)' }, server: { type: 'string', description: 'saved server name (target server)' }, url: { type: 'string', description: 'site url or domain (target site)' }, deep: { type: 'boolean', description: 'site: also test Supabase/Firebase public access (read-only, 1 row)' } }, ['target']) },
  { name: 'shield_fix', risk: 'exec', description: `Apply a built-in Carpathron Shield fix on a saved Linux server, with backups. Firewall and SSH changes undo themselves automatically if the app cannot log in again (lockout protection). Fixes: ${FIX_IDS.join(', ')}. Run shield_scan first, tell the user what will change, then apply; for problems without a built-in fix make the change yourself with ssh_exec.`, parameters: obj({ server: { type: 'string' }, fix: { type: 'string', enum: FIX_IDS }, allow_ports: { type: 'array', items: { type: 'integer' }, description: 'firewall: extra TCP ports to keep open besides SSH, 80 and 443' }, preview: { type: 'boolean', description: 'only show the commands, change nothing' } }, ['server', 'fix']) },
  { name: 'shield_monitor', risk: 'write', description: 'Carpathron Shield live monitoring of a saved Linux server from this PC over SSH (nothing is installed on the server): action start / stop / status / events. Alerts appear in the Shield page: new open ports, password-guessing bursts, new SSH logins, full disk, high load, the server going down, and /.env or /.git exposed on the given websites.', parameters: obj({ action: { type: 'string', enum: ['start', 'stop', 'status', 'events'] }, server: { type: 'string' }, interval_minutes: { type: 'integer' }, urls: { type: 'array', items: { type: 'string' }, description: 'websites on this server to watch for exposed files' } }, ['action']) },
];
const SHIELD_NAMES = new Set(SHIELD_TOOLS.map((t) => t.name));

async function execShield(name, a, ctx) {
  const sh = ctx.shield;
  if (!sh) throw new Error('Carpathron Shield is not available here.');
  if (name === 'shield_scan') {
    if (a.target === 'project') { ctx.status && ctx.status('Shield: scanning the project…'); const p = path.resolve(ctx.workspace || '.', String(a.path || '.')); return renderReport(await sh.scanProject(p, { purpose: a.purpose || 'review', remotePath: a.remote_path })); }
    if (a.target === 'server') { const srv = a.server || ctx.remoteServer; if (!srv) throw new Error('Which server? Give its saved name.'); ctx.status && ctx.status('Shield: scanning the server…'); return renderReport(await sh.scanServer(srv, { signal: ctx.signal })); }
    if (a.target === 'site') { ctx.status && ctx.status('Shield: scanning the website…'); return renderReport(await sh.scanSite(a.url, { deep: !!a.deep })); }
    throw new Error('target must be project, server or site');
  }
  if (name === 'shield_fix') {
    const srv = a.server || ctx.remoteServer;
    const opts = { allowPorts: a.allow_ports, signal: ctx.signal };
    if (a.preview) { const p = await sh.preview(srv, a.fix, opts); return `Shield fix "${p.title}" on ${p.server} would run:\n${p.commands.map((c) => `  $ ${c}`).join('\n')}${p.willBlockPorts.length ? `\nIt would close public ports: ${p.willBlockPorts.join(', ')} (pass allow_ports to keep them).` : ''}${p.lockoutProtection ? '\nLockout protection: undone automatically if the app cannot log in again.' : ''}${p.caution ? `\nNote: ${p.caution}` : ''}`; }
    ctx.status && ctx.status(`Shield: applying ${a.fix}…`);
    const r = await sh.applyFix(srv, a.fix, opts);
    return `${r.ok ? '✓' : '✕'} ${r.title} on ${r.server}${r.verified === true ? ' — logged in again successfully, change kept' : r.verified === false ? ' — could NOT log in again: the server undoes the change by itself within 2.5 minutes' : ''}.\nBackup: ${r.backup}${r.undo ? ' (undo available in the Shield page)' : ''}\n\n${r.output.slice(-4000)}\n\nRun shield_scan on the server again to confirm.`;
  }
  if (name === 'shield_monitor') {
    const srv = a.server || ctx.remoteServer;
    if (a.action === 'events') { const ev = sh.events.filter((e) => !srv || e.serverId === (sh.remote.find(srv) || {}).id).slice(0, 30); return ev.length ? ev.map((e) => `${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')} ${ICON[e.severity] || '·'} ${e.title}${e.detail ? ` — ${e.detail}` : ''}`).join('\n') : 'No Shield events yet.'; }
    if (!srv) throw new Error('Which server?');
    if (a.action === 'start') { const st = sh.monitorStart(srv, { intervalMin: a.interval_minutes, urls: a.urls }); return `Monitoring ${srv} every ${st.intervalMin} min${st.urls.length ? ` (+ ${st.urls.join(', ')})` : ''}. Alerts show in the Shield page.`; }
    if (a.action === 'stop') { sh.monitorStop(srv); return `Stopped monitoring ${srv}.`; }
    const st = sh.monitorStatus((sh.remote.need(srv)).id);
    return JSON.stringify(st, null, 2);
  }
  throw new Error(`unknown tool ${name}`);
}

module.exports = { Shield, SHIELD_TOOLS, SHIELD_NAMES, execShield, scanProject, scanSite, analyseShield, findSecrets, renderReport, FIXES, FIX_IDS, SHIELD_EXTRA, MONITOR_CHECK, globToRe, gitignoreRules, isIgnored };
