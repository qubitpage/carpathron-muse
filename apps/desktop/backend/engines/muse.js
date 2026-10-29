// "Meta account" engine: drives the official Muse Code agent (muse serve) through @muse-code/sdk.
// Muse Code owns the login (your Meta account), the tools, the sandbox and the sub-agents.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');


const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? 'muse.exe' : 'muse';

function registryPath() {
  if (!IS_WIN) return [];
  const out = [];
  for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const txt = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = txt.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
      if (m) out.push(...m[1].trim().split(';'));
    } catch {}
  }
  return out.map((p) => p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''));
}

// Turns a .cmd/.ps1 shim or a folder into the real executable next to it.
function realExe(p) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return exeInDir(p, 2);
    if (/\.exe$/i.test(p) || !IS_WIN) return p;
    return exeInDir(path.dirname(p), 2);
  } catch { return ''; }
}

function exeInDir(dir, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
  const exes = entries.filter((e) => e.isFile() && /^muse.*\.exe$/i.test(e.name) && !/uninst|update|setup/i.test(e.name));
  exes.sort((a, b) => (a.name.toLowerCase() === EXE ? -1 : b.name.toLowerCase() === EXE ? 1 : a.name.length - b.name.length));
  if (exes.length) return path.join(dir, exes[0].name);
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory() && /^(bin|muse|current|app|latest|\d)/i.test(e.name)) {
        const r = exeInDir(path.join(dir, e.name), depth - 1);
        if (r) return r;
      }
    }
  }
  return '';
}

function askShell() {
  if (!IS_WIN) {
    try { return execFileSync('bash', ['-lc', 'command -v muse'], { encoding: 'utf8', timeout: 8000 }).trim(); } catch { return ''; }
  }
  try {
    const cmd = "$env:Path=[Environment]::GetEnvironmentVariable('Path','User')+';'+[Environment]::GetEnvironmentVariable('Path','Machine')+';'+$env:Path; " +
      "$c=Get-Command muse -ErrorAction SilentlyContinue | Select-Object -First 1; if($c){$c.Source}";
    return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim().split(/\r?\n/)[0] || '';
  } catch { return ''; }
}

let cachedBin = '';
function findMuse(explicit) {
  if (explicit) { const r = realExe(explicit); if (r) return r; }
  if (cachedBin) { try { if (fs.statSync(cachedBin).isFile()) return cachedBin; } catch {} cachedBin = ''; }
  const home = os.homedir();
  const la = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [
    path.join(la, 'Programs', 'muse'), path.join(la, 'Programs', 'Muse'), path.join(la, 'Programs', 'muse-code'),
    path.join(home, '.local', 'bin'), path.join(home, '.muse', 'bin'), path.join(la, 'muse'), path.join(la, 'Microsoft', 'WinGet', 'Links'),
    ...(process.env.PATH || '').split(path.delimiter), ...registryPath(),
  ];
  for (const d of dirs) {
    if (!d) continue;
    const direct = path.join(d.trim(), EXE);
    try { if (fs.statSync(direct).isFile()) return (cachedBin = direct); } catch {}
  }
  for (const d of dirs.slice(0, 7)) { const r = exeInDir(d, 2); if (r) return (cachedBin = r); }
  const viaShell = askShell();
  if (viaShell) { const r = realExe(viaShell); if (r) return (cachedBin = r); }
  return '';
}

// Folders Windows protects: Muse's sandbox cannot set permissions there (error 5).
function protectedFolder(p) {
  if (!IS_WIN || !p) return false;
  const n = path.resolve(p).toLowerCase();
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.SystemRoot, process.env.ProgramData]
    .filter(Boolean).map((r) => path.resolve(r).toLowerCase());
  return roots.some((r) => n === r || n.startsWith(r + path.sep)) || /^[a-z]:\\?$/.test(n);
}

function safeCwd(p) {
  const fallback = path.join(os.homedir(), 'MuseCarpathron');
  const dir = p && !protectedFolder(p) ? p : fallback;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

function subjectSummary(req) {
  const s = req.subject || {};
  switch (s.kind) {
    case 'shell': return `Run: ${s.command || req.rawArgs}`;
    case 'fileAccess': return `${s.access === 'write' ? 'Write' : 'Read'} file ${s.path || ''}`;
    case 'network': return `Network access to ${s.protocol ? s.protocol + '://' : ''}${s.host || ''}${s.port ? ':' + s.port : ''}`;
    case 'process': return `Control process ${s.target || ''}`;
    default: return `${req.toolName || s.toolName || 'tool'}: ${String(req.rawArgs || '').slice(0, 300)}`;
  }
}

class MuseEngine {
  constructor({ getSettings, log }) {
    this.getSettings = getSettings;
    this.log = log;
    this.client = null;
    this.conn = null;
    this.sessions = new Map(); // museSessionId -> Session
    this.starting = null;
    this.binPath = '';
    this.lastError = '';
    this.info = null;
  }

  resolveBin() {
    const now = Date.now();
    if (this.binPath && now - (this._binAt || 0) < 30000) return this.binPath;
    this._binAt = now;
    this.binPath = findMuse(this.getSettings().museBin);
    return this.binPath;
  }

  async ensure() {
    if (this.client) return this.client;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const bin = this.resolveBin();
      if (!bin) throw new Error('Muse Code is not installed (muse.exe not found). Install it from Settings → "Install Muse Code", or set its path.');
      const sdk = await import('@muse-code/sdk');
      const s = this.getSettings();
      // museSandbox: 'auto' (default) = use the OS sandbox when the host can enforce it, otherwise run without it;
      // 'on' = always sandbox (commands fail if it is unavailable); 'off' = never sandbox.
      const mode = s.museSandbox || 'auto';
      const start = async (noSandbox) => {
        const stderr = [];
        const args = ['serve'];
        if (noSandbox) args.push('--disable-sandbox');
        if (s.museTrustWorkspace !== false) args.push('--trust-workspace');
        const hs = sdk.spawnMspConnection({
          command: bin, args, cwd: safeCwd(s.workspace),
          onStderr: (c) => { stderr.push(c); if (stderr.length > 50) stderr.shift(); },
        });
        try {
          // sessionMcp: lets sessions receive the app's tools (MCP bridge). userInputDialogs: false — this app cannot
          // show Muse's question dialogs, so Muse must not wait on one (it would hang the turn).
          return await hs.initialize({ clientInfo: { name: 'muse_carpathron', title: 'Carpathron Robotics & Coding', version: '1.5.0' }, capabilities: { requestedCapabilities: ['sessionMcp'], userInputDialogs: false } });
        } catch (e) {
          await hs.close().catch(() => {});
          throw new Error(`Could not start Muse Code (${bin}): ${e.message}${stderr.length ? '\n' + stderr.join('').slice(-800) : ''}`);
        }
      };
      const off = mode === 'off' || (mode === 'auto' && this.noSandboxNext);
      let spawned = await start(off);
      this.sandbox = off ? (mode === 'off' ? 'off' : 'off (sandbox failed)') : (spawned.initializeResult.sandboxAvailability || 'unknown');
      // Muse Code's stdio host on Windows can report the sandbox as unavailable even after
      // "muse sandbox windows setup" succeeded; then every shell command fails. Run without it instead.
      if (mode === 'auto' && spawned.initializeResult.sandboxAvailability === 'unavailable') {
        this.log(`Muse Code: OS sandbox unavailable for the app host${spawned.initializeResult.sandboxUnavailableReason ? ` (${spawned.initializeResult.sandboxUnavailableReason})` : ''} — restarting it without the sandbox (approvals still apply).`);
        try { await spawned.close(); } catch {}
        spawned = await start(true);
        this.sandbox = 'off (unavailable)';
      }
      this.conn = spawned.connection;
      this.info = spawned.initializeResult;
      this.granted = spawned.initializeResult.grantedCapabilities || [];
      this.client = new sdk.MuseClient(spawned.connection, { durability: sdk.readSessionDurability(spawned.initializeResult), host: spawned });
      this.client.exit.then((x) => {
        this.log(`Muse Code host exited (${x.kind})`);
        this.client = null; this.conn = null; this.sessions.clear();
      }).catch(() => {});
      this.log(`Muse Code connected: ${this.info.serverInfo?.name || 'muse'} ${this.info.serverInfo?.version || ''} (${bin}), sandbox: ${this.sandbox}, capabilities: ${(this.granted || []).join(', ') || 'none'}`);
      return this.client;
    })();
    try { return await this.starting; }
    catch (e) { this.lastError = e.message; throw e; }
    finally { this.starting = null; }
  }

  async status() {
    const bin = this.resolveBin();
    return { installed: !!bin, bin, connected: !!this.client, version: this.info?.serverInfo?.version || '', lastError: this.lastError, sandbox: this.sandbox || '' };
  }

  async listModels(sessionId) {
    await this.ensure();
    const r = await this.conn.request('model/list', sessionId ? { sessionId } : {});
    return (r.models || []).map((m) => ({ id: m.modelId, label: m.displayLabel || m.modelId, isDefault: !!m.isDefault, isActive: !!m.isActive, description: m.description || '' }));
  }

  // Opens (or resumes) the Muse session for a conversation.
  async session(conv, { onApproval, model, mode, bridge, extraMcp }) {
    const client = await this.ensure();
    if (conv.museSessionId && this.sessions.has(conv.museSessionId)) return this.sessions.get(conv.museSessionId);
    let session;
    if (protectedFolder(conv.workspace)) {
      throw new Error(`The attached folder "${conv.workspace}" is a protected Windows folder (Program Files / Windows), so Muse Code cannot work there. Click the 📁 folder chip and choose a folder in your user files, e.g. Documents.`);
    }
    try { fs.mkdirSync(conv.workspace, { recursive: true }); } catch {}
    const approvalMode = { auto: 'allowAll', ask: 'promptUnmatched', plan: 'denyUnmatched' }[mode];
    if (conv.museSessionId) {
      try {
        session = await client.resumeSession({ sessionId: conv.museSessionId, onApproval, onApprovalError: (f) => this.log(`Muse approval error: ${f.kind}`) });
      } catch (e) { this.log(`Could not resume Muse session, starting a new one: ${e.message}`); }
    }
    if (!session) {
      const opts = { workspaceRoot: path.resolve(conv.workspace) };
      if (model) opts.modelId = model;
      if ((this.granted || []).includes('sessionMcp')) {
        const servers = { ...(extraMcp || {}), ...(bridge ? { carpathron: bridge } : {}) };
        if (Object.keys(servers).length) opts.config = { mcpServers: servers };
      }
      const profile = mode === 'full' ? await this.pickFullProfile() : (this.getSettings().musePermissionProfile || null);
      if (profile) opts.permissionProfile = profile;
      const attempts = [
        approvalMode ? { ...opts, approvalMode } : opts,
        opts.permissionProfile ? (({ permissionProfile, ...o }) => (approvalMode ? { ...o, approvalMode } : o))(opts) : null,
        opts.config ? (({ config, permissionProfile, ...o }) => (approvalMode ? { ...o, approvalMode } : o))(opts) : null,
        (({ config, permissionProfile, ...o }) => o)(opts),
      ].filter(Boolean);
      let lastErr;
      for (const a of attempts) {
        try { session = await client.startSession(a); break; }
        catch (e) { lastErr = e; this.log(`Muse session start with [${Object.keys(a).join(', ')}] refused: ${e.message}`); }
      }
      if (!session) throw lastErr;
      session.onApproval(onApproval);
      session.onApprovalError?.((f) => this.log(`Muse approval error: ${f.kind}`));
      conv.museSessionId = session.sessionId;
    }
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async setModel(sessionId, modelId) {
    await this.ensure();
    return this.conn.command('session/setModel', { sessionId, model: { modelId } });
  }

  async setMode(sessionId, mode) {
    const m = { auto: 'allowAll', ask: 'promptUnmatched', plan: 'denyUnmatched' }[mode];
    if (!m || !this.conn) return;
    try { await this.conn.command('session/setApprovalMode', { sessionId, mode: m }); } catch (e) { this.log(`Muse approval mode not changed: ${e.message}`); }
  }

  async interrupt(sessionId) {
    if (!this.conn) return;
    try { await this.conn.command('turn/interrupt', { sessionId }); } catch (e) { this.log(`Interrupt failed: ${e.message}`); }
  }

  // Opens a visible PowerShell window with a script. (Not "cmd /c start": Node quotes the window title so
  // Windows tried to run the title words — "Windows cannot find 'sandbox'".)
  static openConsole(name, lines, cwd) {
    const file = path.join(os.tmpdir(), `muse-carpathron-${name}.ps1`);
    fs.writeFileSync(file, '\ufeff' + [`$Host.UI.RawUI.WindowTitle = 'Carpathron Robotics & Coding - ${name}'`, ...lines].join('\r\n'), 'utf8');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd, detached: true, windowsHide: false, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  }

  // Opens a PowerShell window running Muse Code so the user can sign in with Meta.
  openLogin() {
    const bin = this.resolveBin();
    if (!bin) throw new Error('Muse Code is not installed.');
    const cwd = safeCwd(this.getSettings().workspace);
    if (!IS_WIN) { spawn(bin, [], { cwd, detached: true, stdio: 'ignore' }).unref(); return; }
    const q = (x) => x.replace(/'/g, "''");
    MuseEngine.openConsole('sign-in', [
      `Set-Location -LiteralPath '${q(cwd)}'`,
      "Write-Host 'Sign in with your Meta account below. When you see the Muse prompt you are signed in: type /exit and close this window.' -ForegroundColor Green",
      `& '${q(bin)}'`,
    ], cwd);
  }

  // One-time Windows sandbox setup ("muse sandbox windows setup" asks for administrator rights once).
  openSandboxSetup() {
    const bin = this.resolveBin();
    if (!bin) throw new Error('Muse Code is not installed.');
    if (!IS_WIN) throw new Error('Only needed on Windows.');
    const cwd = safeCwd(this.getSettings().workspace);
    const q = (x) => x.replace(/'/g, "''");
    MuseEngine.openConsole('sandbox-setup', [
      `Set-Location -LiteralPath '${q(cwd)}'`,
      "Write-Host 'Muse Code - one-time Windows sandbox setup' -ForegroundColor Green",
      "Write-Host 'If Windows asks for permission (UAC), click YES.' -ForegroundColor Yellow",
      `$m = '${q(bin)}'`,
      '& $m sandbox windows setup',
      "Write-Host ''",
      "Write-Host 'Check:' -ForegroundColor Cyan",
      '& $m sandbox windows check',
      "Write-Host ''",
      "Write-Host 'Done. Go back to Carpathron Robotics & Coding and press Settings -> Test (it restarts Muse Code). If commands still fail, the app runs Muse Code without the sandbox automatically.' -ForegroundColor Green",
    ], cwd);
  }

  // Opens a PowerShell window that runs Meta's official installer.
  static openInstaller() {
    if (!IS_WIN) throw new Error('Installer helper is for Windows.');
    const cwd = safeCwd();
    MuseEngine.openConsole('install-muse-code', [
      "Write-Host 'Installing Meta Muse Code (official installer from dev.meta.ai)...' -ForegroundColor Green",
      'irm https://dev.meta.ai/install.ps1 | iex',
      "Write-Host ''",
      "Write-Host 'Done. Go back to Carpathron Robotics & Coding and press Re-check.' -ForegroundColor Green",
    ], cwd);
  }

  // Forget a session that stopped responding; the next message starts a new one.
  dropSession(conv) {
    if (!conv || !conv.museSessionId) return;
    this.sessions.delete(conv.museSessionId);
    conv.museSessionId = null;
  }

  // Permission profiles the Muse Code host offers (e.g. a full-access profile).
  async permissionProfiles() {
    await this.ensure();
    try {
      const r = await this.conn.request('permissionProfile/list', {});
      const rows = r.profiles || r.items || r.rows || (Array.isArray(r) ? r : []);
      return rows.map((p) => ({ id: p.id || p.profileId || p.name, label: p.displayLabel || p.label || p.name || p.id, description: p.description || '', available: p.available !== false && p.status !== 'unavailable' }));
    } catch (e) { this.log(`Muse permission profiles not available: ${e.message}`); return []; }
  }

  async pickFullProfile() {
    try {
      const want = this.getSettings().musePermissionProfile;
      const list = await this.permissionProfiles();
      if (want) return list.find((p) => p.id === want) ? want : null;
      const full = list.find((p) => p.available && /full|danger|unrestricted|bypass|yolo|no.?sandbox|trusted|unsandbox/i.test(`${p.id} ${p.label}`));
      return full ? full.id : null;
    } catch { return null; }
  }

  async close() {
    const c = this.client;
    this.client = null; this.conn = null; this.sessions.clear();
    if (c) await c.close().catch(() => {});
  }
}

module.exports = { MuseEngine, findMuse, subjectSummary, protectedFolder, safeCwd };
