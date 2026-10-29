// GitHub plugin: account (token stored encrypted), repositories, publishing a folder (git push), releases with
// uploaded files, issues and pull requests, and a generic API call. Uses the GitHub REST API + the local git.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const apiBase = () => process.env.MC_GITHUB_API || 'https://api.github.com';
const gitBase = () => process.env.MC_GITHUB_GIT || 'https://github.com';
const uploadsBase = () => process.env.MC_GITHUB_UPLOADS || 'https://uploads.github.com';
const IS_WIN = process.platform === 'win32';
const clip = (s, n = 20000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… [truncated ${s.length - n} characters]` : s; };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

const GH_TOOLS = [
  { name: 'github_account', risk: 'read', description: 'Show the connected GitHub account (login, name, plan) and its organizations. Use first to know the owner for new repositories.', parameters: obj({}) },
  { name: 'github_repos', risk: 'read', description: 'List repositories of the connected account (or an owner/org), newest first; optional text filter.', parameters: obj({ owner: { type: 'string' }, filter: { type: 'string' } }) },
  { name: 'github_create_repo', risk: 'write', description: 'Create a new GitHub repository (personal or in an organization).', parameters: obj({ name: { type: 'string' }, org: { type: 'string', description: 'organization login; empty = your account' }, private: { type: 'boolean' }, description: { type: 'string' }, homepage: { type: 'string' } }, ['name']) },
  { name: 'github_publish', risk: 'write', description: 'Publish a local folder to GitHub: git init if needed, commit all changes, set the remote and push (creates the repository first if it does not exist). Uses the saved token; commits use the saved author name/email.', parameters: obj({ path: { type: 'string', description: 'local folder' }, repo: { type: 'string', description: 'owner/name' }, branch: { type: 'string', description: 'default main' }, message: { type: 'string' }, private: { type: 'boolean', description: 'when the repo must be created' }, force: { type: 'boolean', description: 'force-push (overwrites remote history) — only if the user asked' } }, ['path', 'repo']) },
  { name: 'github_clone', risk: 'write', description: 'Clone a GitHub repository (private ones too) to a local folder.', parameters: obj({ repo: { type: 'string' }, path: { type: 'string' } }, ['repo']) },
  { name: 'github_release', risk: 'write', description: 'Create a GitHub release (tag created from the branch if missing) and upload files as release assets (installers, APKs, zips — up to 2 GB each). Returns the release and download URLs.', parameters: obj({ repo: { type: 'string' }, tag: { type: 'string' }, name: { type: 'string' }, notes: { type: 'string', description: 'Markdown release notes' }, files: { type: 'array', items: { type: 'string' } }, target: { type: 'string', description: 'branch or commit for a new tag (default: default branch)' }, draft: { type: 'boolean' }, prerelease: { type: 'boolean' }, latest: { type: 'boolean' } }, ['repo', 'tag']) },
  { name: 'github_issues', risk: 'write', description: 'Work with issues: action list | get | create | comment | close.', parameters: obj({ repo: { type: 'string' }, action: { type: 'string', enum: ['list', 'get', 'create', 'comment', 'close'] }, number: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' }, state: { type: 'string' } }, ['repo', 'action']) },
  { name: 'github_pulls', risk: 'write', description: 'Work with pull requests: action list | get | create | merge | comment.', parameters: obj({ repo: { type: 'string' }, action: { type: 'string', enum: ['list', 'get', 'create', 'merge', 'comment'] }, number: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, method: { type: 'string', enum: ['merge', 'squash', 'rebase'] } }, ['repo', 'action']) },
  { name: 'github_api', risk: 'write', description: 'Call any GitHub REST API endpoint (e.g. GET /repos/{owner}/{repo}/actions/runs, PATCH /repos/{owner}/{repo}). Returns JSON.', parameters: obj({ method: { type: 'string' }, path: { type: 'string' }, body: { type: 'object' } }, ['path']) },
];

class GitHub {
  constructor({ store, secrets, log }) { this.store = store; this.secrets = secrets; this.log = log || (() => {}); }
  cfg() { return this.store.settings.github || {}; }
  token() {
    const c = this.cfg();
    const t = c.token ? this.secrets.decrypt(c.token) : '';
    if (!t) throw new Error('GitHub is not connected. Open Plugins → GitHub and paste a token (it is stored encrypted on this PC).');
    return t;
  }
  publicInfo() { const c = this.cfg(); return { connected: !!c.token, login: c.login || '', name: c.name || '', email: c.email || '', scopes: c.scopes || '' }; }
  async connect(token, { name, email } = {}) {
    const r = await fetch(`${apiBase()}/user`, { headers: this.headers(token) });
    if (!r.ok) throw new Error(`GitHub refused the token (${r.status}). Check that it is valid and not expired.`);
    const u = await r.json();
    let em = email || this.cfg().email || '';
    if (!em) { try { const e = await (await fetch(`${apiBase()}/user/emails`, { headers: this.headers(token) })).json(); em = (Array.isArray(e) && (e.find((x) => x.primary) || e[0]) || {}).email || ''; } catch {} }
    if (!em) em = `${u.id}+${u.login}@users.noreply.github.com`;
    this.store.settings.github = { token: this.secrets.encrypt(token), login: u.login, name: name || this.cfg().name || u.name || u.login, email: em, scopes: r.headers.get('x-oauth-scopes') || 'fine-grained' };
    this.store.saveSettings();
    return this.publicInfo();
  }
  // ---- Sign in through the browser
  // A) OAuth device flow (needs the client ID of an OAuth App with "Device flow" enabled).
  async deviceStart(clientId, scopes = 'repo workflow read:org') {
    const base = process.env.MC_GITHUB_WEB || 'https://github.com';
    const r = await fetch(`${base}/login/device/code`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, scope: scopes }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.device_code) throw new Error(`GitHub device login could not start: ${j.error_description || j.error || r.status}. Check the OAuth App client ID and that "Enable Device Flow" is ticked.`);
    const flow = { clientId, ...j, status: 'pending', started: Date.now() };
    this.flow = flow;
    (async () => {
      let wait = (j.interval || 5) * 1000;
      while (flow.status === 'pending' && Date.now() - flow.started < (j.expires_in || 900) * 1000) {
        await new Promise((res) => setTimeout(res, wait));
        if (flow.status !== 'pending') return;
        try {
          const t = await fetch(`${base}/login/oauth/access_token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, device_code: j.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
          const x = await t.json();
          if (x.access_token) { await this.connect(x.access_token); flow.status = 'done'; this.log(`GitHub: signed in through the browser as ${this.cfg().login}`); return; }
          if (x.error === 'slow_down') wait += 5000;
          else if (x.error && x.error !== 'authorization_pending') { flow.status = 'error'; flow.error = x.error_description || x.error; return; }
        } catch (e) { flow.error = e.message; }
      }
      if (flow.status === 'pending') { flow.status = 'expired'; }
    })();
    return { user_code: j.user_code, verification_uri: j.verification_uri, expires_in: j.expires_in };
  }
  deviceStatus() { const f = this.flow; return f ? { status: f.status, error: f.error || '', login: this.cfg().login || '' } : { status: 'none' }; }

  // B) GitHub CLI: "gh auth login --web" opens the browser; then the token is imported from gh.
  ghDir() { return path.join(this.store.dataDir || os.tmpdir(), 'tools', 'gh'); }
  findGh() {
    const cands = ['gh'];
    const own = path.join(this.ghDir(), 'bin', IS_WIN ? 'gh.exe' : 'gh');
    if (process.env.MC_GH_BIN) return process.env.MC_GH_BIN;
    cands.unshift(own);
    if (IS_WIN) cands.splice(1, 0, path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'GitHub CLI', 'gh.exe'));
    for (const c of cands) { if (c === 'gh') return 'gh'; try { if (fs.statSync(c).isFile()) return c; } catch {} }
    return 'gh';
  }
  run(cmd, args, timeoutMs = 20000) {
    return new Promise((resolve) => {
      let child, out = '';
      try { child = spawn(cmd, args, { windowsHide: true, env: this.ghEnv() }); } catch (e) { resolve({ code: -1, out: e.message }); return; }
      const t = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
      child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: e.message }); });
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out: out.trim() }); });
    });
  }
  // Downloads the official GitHub CLI (zip from github.com/cli/cli releases) into the app's data folder.
  // No administrator rights, no winget, no extra window.
  async ghInstall(onStatus = () => {}) {
    if ((await this.ghStatus()).installed) return this.findGh();
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const plat = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'macOS' : 'linux';
    const ext = plat === 'linux' ? '.tar.gz' : '.zip';
    onStatus('Finding the latest GitHub CLI…');
    let j, asset;
    // 1) the release page redirect (no API rate limit), 2) the REST API
    try {
      const r = await fetch(process.env.MC_GH_LATEST || 'https://github.com/cli/cli/releases/latest', { redirect: 'manual', headers: { 'User-Agent': 'Muse-Carpathron' }, signal: AbortSignal.timeout(30000) });
      const tag = ((r.headers.get('location') || '').match(/\/tag\/(v[\d.]+)/) || [])[1];
      if (tag) { const v = tag.slice(1); const name = `gh_${v}_${plat}_${arch}${ext}`; j = { tag_name: tag }; asset = { name, size: 0, browser_download_url: `https://github.com/cli/cli/releases/download/${tag}/${name}` }; }
    } catch {}
    if (!asset) {
      const rel = await fetch(process.env.MC_GH_RELEASES || 'https://api.github.com/repos/cli/cli/releases/latest', { headers: { 'User-Agent': 'Muse-Carpathron', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
      if (!rel.ok) throw new Error(`Could not reach GitHub to download the GitHub CLI (HTTP ${rel.status}).`);
      j = await rel.json();
      asset = (j.assets || []).find((a) => a.name.endsWith(`_${plat}_${arch}${ext}`));
    }
    if (!asset) throw new Error(`No GitHub CLI download for ${plat}/${arch} in ${(j && j.tag_name) || 'the latest release'}.`);
    onStatus(`Downloading GitHub CLI ${j.tag_name || ''}…`);
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Muse-Carpathron' }, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`GitHub CLI download failed (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dir = this.ghDir();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(path.join(dir, 'bin'), { recursive: true });
    onStatus('Unpacking…');
    if (ext === '.zip') {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buf);
      const entry = Object.values(zip.files).find((f) => !f.dir && /(^|\/)bin\/gh(\.exe)?$/.test(f.name));
      if (!entry) throw new Error('The GitHub CLI download did not contain gh.');
      await fsp.writeFile(path.join(dir, 'bin', path.basename(entry.name)), await entry.async('nodebuffer'), { mode: 0o755 });
    } else {
      const tgz = path.join(dir, 'gh.tar.gz'); await fsp.writeFile(tgz, buf);
      const r = await this.run('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1'], 60000);
      if (r.code !== 0) throw new Error(`Could not unpack the GitHub CLI: ${r.out}`);
      await fsp.unlink(tgz).catch(() => {});
    }
    const st = await this.ghStatus();
    if (!st.installed) throw new Error('The GitHub CLI was downloaded but does not start.');
    this.log(`github: installed ${st.version} in ${dir}`);
    return this.findGh();
  }

  // "gh auth login --web" in the background: the one-time code and the URL are shown in the app,
  // the user authorizes in the browser, then the token is imported automatically.
  ghLoginStart() {
    if (this.gh && ['installing', 'starting', 'code'].includes(this.gh.status)) return this.ghLoginStatus();
    const st = this.gh = { status: 'installing', message: 'Checking the GitHub CLI…', code: '', url: '', error: '', login: '', out: '' };
    (async () => {
      try {
        const bin = await this.ghInstall((m) => { st.message = m; });
        if (st.status === 'cancelled') return;
        st.status = 'starting'; st.message = 'Asking GitHub for a sign-in code…';
        const child = spawn(bin, ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--scopes', 'repo,workflow,read:org', '--skip-ssh-key'],
          { windowsHide: true, env: this.ghEnv({ GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_BROWSER: IS_WIN ? 'cmd /c rem' : 'true' }) });
        st.child = child;
        const onData = (d) => {
          st.out = (st.out + d).slice(-4000);
          // "! First copy your one-time code: ABCD-1234" (older gh) or "! One-time code (ABCD-1234) copied to clipboard" (gh 2.80+)
          const c = st.out.match(/one-time code[^A-Z0-9]{0,40}([A-Z0-9]{4}-[A-Z0-9]{4})/i);
          const u = st.out.match(/https:\/\/github\.com\/login\/device\S*/);
          if (c && !st.code) { st.code = c[1]; st.url = u ? u[0] : 'https://github.com/login/device'; st.status = 'code'; st.message = 'Enter the code on GitHub and click Authorize.'; }
          if (/Press Enter/i.test(String(d))) { try { child.stdin.write('\n'); } catch {} }
        };
        child.stdout.on('data', onData); child.stderr.on('data', onData);
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 15 * 60 * 1000);
        setTimeout(() => { if (st.status === 'starting') st.message = `Still waiting for GitHub… ${st.out.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`; }, 15000);
        const code = await new Promise((r) => { child.on('error', (e) => { st.out += e.message; r(-1); }); child.on('close', r); });
        clearTimeout(timer); st.child = null;
        if (st.status === 'cancelled') return;
        if (code !== 0) throw new Error(`GitHub CLI login did not finish: ${st.out.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `exit ${code}`}`);
        const info = await this.ghImport();
        st.status = 'done'; st.login = info.login; st.message = `Connected as ${info.login}`;
      } catch (e) { if (st.status !== 'cancelled') { st.status = 'error'; st.error = e.message; } this.log(`github: gh login failed: ${e.message}`); }
    })();
    return this.ghLoginStatus();
  }
  // a GH_TOKEN / GITHUB_TOKEN in the environment would make gh refuse to log in and override the stored login
  ghEnv(extra = {}) { const e = { ...process.env, ...extra }; for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST']) delete e[k]; return e; }
  ghLoginStatus() { const s = this.gh; return s ? { status: s.status, message: s.message, code: s.code, url: s.url, error: s.error, login: s.login } : { status: 'none' }; }
  ghLoginCancel() { const s = this.gh; if (s) { s.status = 'cancelled'; if (s.child) try { s.child.kill(); } catch {} } return { ok: true }; }

  async ghStatus() { const v = await this.run(this.findGh(), ['--version']); return { installed: v.code === 0, version: v.code === 0 ? v.out.split('\n')[0] : '' }; }
  async ghImport() {
    const r = await this.run(this.findGh(), ['auth', 'token', '-h', 'github.com']);
    if (r.code !== 0 || !/^(gh[opusr]_|github_pat_)\w+/.test(r.out)) throw new Error(r.code === -1 ? 'GitHub CLI is not installed yet.' : `Not signed in with the GitHub CLI yet (${r.out.slice(0, 200)}). Finish the browser login first.`);
    return this.connect(r.out.split(/\s+/)[0]);
  }

  updateAuthor({ name, email }) { const c = this.cfg(); if (name !== undefined) c.name = String(name).trim(); if (email !== undefined) c.email = String(email).trim(); this.store.settings.github = c; this.store.saveSettings(); return this.publicInfo(); }
  disconnect() { delete this.store.settings.github; this.store.saveSettings(); }
  headers(token) { return { Authorization: `Bearer ${token || this.token()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MuseCarpathron' }; }

  async api(method, p, body, { raw = false } = {}) {
    const url = /^https?:/.test(p) ? p : `${apiBase()}${p.startsWith('/') ? '' : '/'}${p}`;
    const r = await fetch(url, { method: method || 'GET', headers: { ...this.headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw) return r;
    const txt = await r.text();
    let j; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { text: txt }; }
    if (!r.ok) throw new Error(`GitHub ${method || 'GET'} ${p}: ${r.status} ${j.message || txt.slice(0, 200)}${j.errors ? ' ' + JSON.stringify(j.errors).slice(0, 300) : ''}`);
    return j;
  }
  parseRepo(repo) {
    const m = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m) return { owner: m[1], name: m[2] };
    const login = this.cfg().login;
    if (login && /^[\w.-]+$/.test(String(repo || ''))) return { owner: login, name: String(repo) };
    throw new Error(`Give the repository as owner/name (got "${repo}")`);
  }
  async ensureRepo(owner, name, { private: priv = true, description } = {}) {
    try { return await this.api('GET', `/repos/${owner}/${name}`); } catch (e) { if (!/404/.test(e.message)) throw e; }
    const body = { name, private: !!priv, description: description || '', auto_init: false };
    const created = owner.toLowerCase() === (this.cfg().login || '').toLowerCase() ? await this.api('POST', '/user/repos', body) : await this.api('POST', `/orgs/${owner}/repos`, body);
    this.log(`GitHub: created ${created.full_name}`);
    return created;
  }

  git(args, cwd, { signal, auth = false } = {}) {
    return new Promise((resolve) => {
      const pre = auth ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${this.token()}`).toString('base64')}`] : [];
      let child;
      try { child = spawn('git', [...pre, ...args], { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); }
      catch (e) { resolve({ code: -1, out: e.message }); return; }
      let out = '';
      child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
      const kill = () => { try { child.kill(); } catch {} };
      signal?.addEventListener('abort', kill, { once: true });
      child.on('error', (e) => resolve({ code: -1, out: /ENOENT/.test(e.message) ? 'git is not installed. Install it (winget install --id Git.Git -e) and try again.' : e.message }));
      child.on('close', (code) => { signal?.removeEventListener('abort', kill); resolve({ code, out: out.replace(/AUTHORIZATION: basic [A-Za-z0-9+/=]+/g, 'AUTHORIZATION: ***') }); });
    });
  }

  async publish({ path: dir, repo, branch = 'main', message, private: priv = true, force = false }, signal) {
    const { owner, name } = this.parseRepo(repo);
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) throw new Error(`Folder not found: ${dir}`);
    const log = [];
    const run = async (args, opts = {}) => { const r = await this.git(args, dir, { signal, ...opts }); log.push(`$ git ${args.join(' ')}\n${r.out.trim()}`); return r; };
    const info = await this.ensureRepo(owner, name, { private: priv });
    if (!fs.existsSync(path.join(dir, '.git'))) { const r = await run(['init', '-b', branch]); if (r.code) throw new Error(log.join('\n')); }
    const c = this.cfg();
    await run(['config', 'user.name', c.name || c.login]);
    await run(['config', 'user.email', c.email || `${c.login}@users.noreply.github.com`]);
    await run(['add', '-A']);
    const s = await run(['status', '--porcelain']);
    if (s.out.trim()) { const r = await run(['commit', '-m', message || 'Update']); if (r.code) throw new Error(log.join('\n')); }
    const cur = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)).out.trim();
    if (cur && cur !== branch && cur !== 'HEAD') await run(['branch', '-M', branch]);
    const url = `${gitBase()}/${owner}/${name}.git`;
    const hasOrigin = (await this.git(['remote'], dir)).out.split(/\s+/).includes('origin');
    await run(hasOrigin ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
    const p = await run(['push', ...(force ? ['--force'] : []), '-u', 'origin', branch], { auth: true });
    if (p.code) throw new Error(`Push failed:\n${clip(log.join('\n\n'), 6000)}${/rejected|fetch first|non-fast-forward/.test(p.out) ? '\nThe GitHub repository has commits that are not in this folder. Pull first (git pull --rebase origin ' + branch + ') or, only if the user wants to overwrite GitHub, use force.' : ''}`);
    return `Published ${dir} → ${info.html_url} (branch ${branch}).\n\n${clip(log.join('\n\n'), 8000)}`;
  }

  async clone({ repo, path: dir }, cwd, signal) {
    const { owner, name } = this.parseRepo(repo);
    const target = path.resolve(cwd, dir || name);
    const r = await this.git(['clone', `${gitBase()}/${owner}/${name}.git`, target], cwd, { signal, auth: true });
    if (r.code) throw new Error(r.out);
    return `Cloned ${owner}/${name} to ${target}\n${r.out.trim()}`;
  }

  async release(a, ws) {
    const { owner, name } = this.parseRepo(a.repo);
    let rel;
    try { rel = await this.api('GET', `/repos/${owner}/${name}/releases/tags/${encodeURIComponent(a.tag)}`); } catch (e) { if (!/404/.test(e.message)) throw e; }
    if (!rel) {
      rel = await this.api('POST', `/repos/${owner}/${name}/releases`, { tag_name: a.tag, name: a.name || a.tag, body: a.notes || '', draft: !!a.draft, prerelease: !!a.prerelease, ...(a.target ? { target_commitish: a.target } : {}), make_latest: a.latest === false ? 'false' : 'true' });
    } else if (a.notes || a.name) {
      rel = await this.api('PATCH', `/repos/${owner}/${name}/releases/${rel.id}`, { ...(a.name ? { name: a.name } : {}), ...(a.notes ? { body: a.notes } : {}) });
    }
    const out = [`Release ${rel.name || rel.tag_name}: ${rel.html_url}`];
    for (const f of a.files || []) {
      const file = path.resolve(ws, f);
      const st = await fsp.stat(file);
      const fname = path.basename(file);
      const old = (rel.assets || []).find((x) => x.name === fname);
      if (old) await this.api('DELETE', `/repos/${owner}/${name}/releases/assets/${old.id}`);
      const up = `${uploadsBase()}/repos/${owner}/${name}/releases/${rel.id}/assets?name=${encodeURIComponent(fname)}`;
      const r = await fetch(up, { method: 'POST', headers: { ...this.headers(), 'Content-Type': 'application/octet-stream', 'Content-Length': String(st.size) }, body: fs.createReadStream(file), duplex: 'half' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Upload of ${fname} failed: ${r.status} ${j.message || ''}`);
      out.push(`Uploaded ${fname} (${Math.round(st.size / 1048576)} MB): ${j.browser_download_url}`);
    }
    out.push(`Latest download link pattern: https://github.com/${owner}/${name}/releases/latest/download/<file name>`);
    return out.join('\n');
  }
}

async function execGitHub(name, args, ctx) {
  const gh = ctx.github;
  if (!gh) return null;
  const R = (a) => (a.repo ? gh.parseRepo(a.repo) : null);
  switch (name) {
    case 'github_account': {
      const u = await gh.api('GET', '/user');
      const orgs = await gh.api('GET', '/user/orgs').catch(() => []);
      return `Logged in as ${u.login} (${u.name || ''}), public repos ${u.public_repos}, private ${u.total_private_repos ?? '?'}. Organizations: ${orgs.map((o) => o.login).join(', ') || 'none'}. Commit author: ${gh.cfg().name} <${gh.cfg().email}>`;
    }
    case 'github_repos': {
      const list = args.owner && args.owner !== gh.cfg().login
        ? await gh.api('GET', `/users/${args.owner}/repos?per_page=100&sort=updated`).catch(() => gh.api('GET', `/orgs/${args.owner}/repos?per_page=100&sort=updated`))
        : await gh.api('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member,collaborator');
      const f = String(args.filter || '').toLowerCase();
      return list.filter((r) => !f || r.full_name.toLowerCase().includes(f)).slice(0, 60).map((r) => `${r.full_name}${r.private ? ' (private)' : ''} · ${r.default_branch} · updated ${String(r.pushed_at || '').slice(0, 10)}${r.description ? ' · ' + r.description : ''}`).join('\n') || 'No repositories.';
    }
    case 'github_create_repo': {
      const owner = args.org || gh.cfg().login;
      const r = await gh.ensureRepo(owner, args.name, { private: args.private !== false, description: args.description });
      return `Repository ready: ${r.html_url} (${r.private ? 'private' : 'public'})`;
    }
    case 'github_publish': return gh.publish({ ...args, path: path.resolve(ctx.workspace, String(args.path || '.')) }, ctx.signal);
    case 'github_clone': return gh.clone(args, ctx.workspace, ctx.signal);
    case 'github_release': return gh.release(args, ctx.workspace);
    case 'github_issues': {
      const { owner, name: n } = R(args);
      const base = `/repos/${owner}/${n}/issues`;
      switch (args.action) {
        case 'list': { const l = await gh.api('GET', `${base}?state=${args.state || 'open'}&per_page=50`); return l.filter((i) => !i.pull_request).map((i) => `#${i.number} [${i.state}] ${i.title} (${i.user.login})`).join('\n') || 'No issues.'; }
        case 'get': { const i = await gh.api('GET', `${base}/${args.number}`); const c = await gh.api('GET', `${base}/${args.number}/comments`); return `#${i.number} ${i.title} [${i.state}]\n${i.body || ''}\n\n${c.map((x) => `— ${x.user.login}: ${x.body}`).join('\n')}`; }
        case 'create': { const i = await gh.api('POST', base, { title: args.title, body: args.body || '' }); return `Created issue #${i.number}: ${i.html_url}`; }
        case 'comment': { const c = await gh.api('POST', `${base}/${args.number}/comments`, { body: args.body }); return `Commented: ${c.html_url}`; }
        case 'close': { await gh.api('PATCH', `${base}/${args.number}`, { state: 'closed' }); return `Closed #${args.number}`; }
        default: throw new Error('Unknown action');
      }
    }
    case 'github_pulls': {
      const { owner, name: n } = R(args);
      const base = `/repos/${owner}/${n}/pulls`;
      switch (args.action) {
        case 'list': { const l = await gh.api('GET', `${base}?state=${args.state || 'open'}&per_page=50`); return l.map((p) => `#${p.number} [${p.state}] ${p.title} (${p.head.ref} → ${p.base.ref})`).join('\n') || 'No pull requests.'; }
        case 'get': { const p = await gh.api('GET', `${base}/${args.number}`); return `#${p.number} ${p.title} [${p.state}${p.merged ? ', merged' : ''}] ${p.head.ref} → ${p.base.ref}\n${p.body || ''}\nmergeable: ${p.mergeable}`; }
        case 'create': { const p = await gh.api('POST', base, { title: args.title, body: args.body || '', head: args.head, base: args.base || 'main' }); return `Created PR #${p.number}: ${p.html_url}`; }
        case 'merge': { const m = await gh.api('PUT', `${base}/${args.number}/merge`, { merge_method: args.method || 'merge' }); return m.merged ? `Merged #${args.number} (${m.sha})` : JSON.stringify(m); }
        case 'comment': { const c = await gh.api('POST', `/repos/${owner}/${n}/issues/${args.number}/comments`, { body: args.body }); return `Commented: ${c.html_url}`; }
        default: throw new Error('Unknown action');
      }
    }
    case 'github_api': return clip(JSON.stringify(await gh.api(String(args.method || 'GET').toUpperCase(), String(args.path), args.body), null, 2));
    default: return null;
  }
}

module.exports = { GitHub, GH_TOOLS, execGitHub };
