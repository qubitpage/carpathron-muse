// Carpathron Remote DevOps — remote desktop + SSH with the AI technician / DevOps agent. Main-process part.
// (Separate product from Carpathron Remote; same relay and licenses. AI: ./ai.js, commands on this PC: ./runner.js.)
//
//   preReady()        call before app 'ready' (registers the carprd:// scheme for the remote pages)
//   init(opts)        call after 'ready': { log, standalone, appName, icon, hostDefault, appAi }
//                     appAi (optional): () => ({ key, base, model }) — the host app's own AI settings (Muse Carpathron's Meta key)
//   openHome()        the Remote desktop window (your ID + password, connect to another PC)
//   isHosting()       true while this PC accepts connections (keeps the app alive in the tray)
//
// Pages (remote/pages) run in their own session ("persist:rd") with contextIsolation + sandbox and talk to this file
// only through remote/preload.js. A hidden "host" page keeps this PC registered at the relay and serves sessions;
// each "viewer" window controls one remote PC. Passwords never leave this PC: the personal password is kept only as
// a PBKDF2 key encrypted with Windows DPAPI (safeStorage); the one-time password lives in memory.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, protocol, session, utilityProcess, MessageChannelMain, desktopCapturer, screen, dialog, safeStorage, powerSaveBlocker, nativeImage, clipboard, shell } = require('electron');
const { Injector } = require('./inject');
const runner = require('./runner');

const SCHEME = 'carprd';
const PAGES = path.join(__dirname, 'pages');
const PART = 'persist:rd';
const DEFAULT_RELAY = 'wss://qubitpage.com/rd/ws';
// Automatic relay: the dedicated relay server first, qubitpage.com as a fallback (both lead to the same relay)
const AUTO_RELAYS = ['wss://relay.qubitpage.com/rd/ws', 'wss://qubitpage.com/rd/ws'];
let autoRelay = AUTO_RELAYS[AUTO_RELAYS.length - 1];
const isAuto = () => !S.relay || S.relay === DEFAULT_RELAY || S.relay === 'auto';
const relay = () => (isAuto() ? autoRelay : S.relay);
async function pickRelay() {
  if (!isAuto()) return;
  for (const r of AUTO_RELAYS) {
    const health = r.replace(/^wss:/, 'https:').replace(/\/ws$/, '/health');
    try { const res = await fetch(health, { signal: AbortSignal.timeout(6000) }); const j = await res.json(); if (j && j.ok) { if (autoRelay !== r) { autoRelay = r; log('relay:', r); if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send('rd-config'); broadcastState(); } return; } } catch {}
  }
}
const OTP_ABC = 'abcdefghijkmnpqrstuvwxyz23456789';
const ITER = 150000;
// licenses are sold on qubitpage.com (Licențe software in the CarphaCom admin); the app only opens those pages
const SHOP = 'https://qubitpage.com';
const BUY_URL = SHOP + '/software/carpathron-remote';
const ACCOUNT_URL = SHOP + '/licenses';
// shown when qubitpage.com cannot be reached; the live plans and prices come from SHOP/api/software/plans
const DEFAULT_PLANS = [
  { code: 'remote-pro-monthly', tier: 'pro', period: 'monthly', months: 1, price_cents: 300, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-pro-quarterly', tier: 'pro', period: 'quarterly', months: 3, price_cents: 799, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-pro-half-yearly', tier: 'pro', period: 'half-yearly', months: 6, price_cents: 1399, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-pro-yearly', tier: 'pro', period: 'yearly', months: 12, price_cents: 1999, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-pro-two-years', tier: 'pro', period: 'two-years', months: 24, price_cents: 2999, currency: 'EUR', recurring: false, max_pcs: 50 },
  { code: 'remote-max-monthly', tier: 'max', period: 'monthly', months: 1, price_cents: 500, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-max-quarterly', tier: 'max', period: 'quarterly', months: 3, price_cents: 1449, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-max-half-yearly', tier: 'max', period: 'half-yearly', months: 6, price_cents: 2749, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-max-yearly', tier: 'max', period: 'yearly', months: 12, price_cents: 4999, currency: 'EUR', recurring: true, max_pcs: 50 },
  { code: 'remote-max-two-years', tier: 'max', period: 'two-years', months: 24, price_cents: 9399, currency: 'EUR', recurring: false, max_pcs: 50 },
];
const PRICE = 'Pro from €3 per PC per month or €19.99 per year (3 computers) · Max from €5 per month or €49.99 per year (unlimited) · also 3 months, 6 months and 2 years';

let opts = { log: () => {}, standalone: false, appName: 'Carpathron', icon: null, hostDefault: false };
let S = null;              // settings
let file = '';
let hostWin = null, homeWin = null, bannerWin = null, sshWin = null;
const viewers = new Set();
const sessions = new Map(); // sid -> { name, how, mode, screen, started }
let otp = '', otpSalt = '';
let hostState = { state: 'off' };
let injector = null;
const inputWarned = new Set();
let blocker = null;
let sshMod = null, aiMod = null;
const agentWait = new Map(); // rid -> { wc, resolve }
function agentCall(wc, op, args, ms = 0) {
  if (!wc || wc.isDestroyed()) return Promise.reject(new Error('The viewer window was closed.'));
  const rid = rnd(8).toString('hex');
  const limit = ms || (op === 'run' ? 3700000 : 60000);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { agentWait.delete(rid); reject(new Error(`The remote computer did not answer (${op}).`)); }, limit);
    agentWait.set(rid, { wc, resolve: (r) => { clearTimeout(t); if (r && r.error && op !== 'run') reject(new Error(r.error)); else resolve(r); } });
    wc.send('rd-agent', rid, op, args || {});
  });
}
let fails = [];             // failed password attempts (time)
let lockedUntil = 0;

const log = (...a) => opts.log(`remote: ${a.join(' ')}`);
const rnd = (n) => crypto.randomBytes(n);
const newOtp = () => { const r = rnd(8); otp = [...r].map((x) => OTP_ABC[x % OTP_ABC.length]).join(''); otpSalt = rnd(16).toString('base64'); broadcastState(); };

// ---------------------------------------------------------------- secrets at rest (DPAPI on Windows)
const canEnc = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
const seal = (s) => (canEnc() ? 'e:' + safeStorage.encryptString(String(s)).toString('base64') : 'p:' + Buffer.from(String(s)).toString('base64'));
const unseal = (s) => { try { s = String(s || ''); if (s.startsWith('e:')) return safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')); if (s.startsWith('p:')) return Buffer.from(s.slice(2), 'base64').toString(); } catch {} return ''; };

function load() {
  file = path.join(app.getPath('userData'), 'remote', 'settings.json');
  try { S = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { S = {}; }
  S = Object.assign({ relay: DEFAULT_RELAY, id: '', key: '', name: os.hostname(), enabled: !!opts.hostDefault, unattended: false, perm: null, quality: 'auto', saved: [], autostart: false, viewOnly: false, clipSync: true, plugin: true }, S);
  if (!unseal(S.key)) { S.key = seal(rnd(32).toString('hex')); save(); }
  // reconnect keys of earlier sessions: after an app or PC restart they are valid 10 more minutes at most
  S.resumes = (Array.isArray(S.resumes) ? S.resumes : []).filter((r) => r && r.exp > Date.now()).map((r) => ({ ...r, exp: Math.min(r.exp, Date.now() + 10 * 60000) }));
}
function save() { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(S, null, 1)); fs.renameSync(file + '.tmp', file); } catch (e) { log('save', e.message); } }

// ---------------------------------------------------------------- license
// Free (personal use): sessions up to 20 minutes, 2 hours per day, one at a time — counted on the PC that controls.
// Pro (a key, €3 per PC per month or €19.99 per year): unlimited. The relay enforces the limits (it ends the session).
function machineId() {
  let raw = '';
  try {
    if (process.platform === 'win32') {
      const out = require('child_process').execFileSync(require('./winexe').exe('reg'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      raw = (/MachineGuid\s+REG_SZ\s+(\S+)/.exec(out) || [])[1] || '';
    } else if (process.platform === 'linux') {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { raw = fs.readFileSync(f, 'utf8').trim(); if (raw) break; } catch {} }
    } else if (process.platform === 'darwin') {
      const out = require('child_process').execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      raw = (/"IOPlatformUUID" = "([^"]+)"/.exec(out) || [])[1] || '';
    }
  } catch {}
  if (process.env.RD_MACHINE_ID) raw = process.env.RD_MACHINE_ID;
  if (!raw) { if (!S.mid) { S.mid = rnd(16).toString('hex'); save(); } raw = S.mid; }
  return crypto.createHash('sha256').update('carpathron-remote|' + raw).digest('hex');
}
function licenseBase() {
  try { const u = new URL(relay()); const proto = u.protocol === 'wss:' ? 'https:' : 'http:'; return `${proto}//${u.host}${u.pathname.replace(/\/ws\/?$/, '').replace(/\/+$/, '')}/license/`; } catch { return ''; }
}
const tokenInfo = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[0], 'base64url').toString()); } catch { return null; } };
function licToken() { const L = S.license || {}; const i = tokenInfo(L.token); return i && i.exp > Date.now() ? L.token : ''; }
async function licenseCall(action, extra) {
  const base = licenseBase(); if (!base) throw new Error('The relay address is not valid.');
  const r = await fetch(base + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine: machineId(), name: S.name, ...(extra || {}) }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({ ok: false, error: 'server' }));
  if (!j.ok) { const E = { 'unknown-key': 'This license key does not exist. Check it and try again.', expired: 'This license key has expired. Renew it on qubitpage.com.', revoked: 'This license key was cancelled.', 'no-seats': `All the PCs of this key are in use (${j.seats}). Remove it from another PC first, or add PCs to your license.`, rate: 'Too many attempts. Wait a few minutes.', 'unhost-limit': 'A Pro license can remove at most 3 computers per 30 days. Upgrade to Max for any number of computers.', 'not-pro': 'Only a Pro license has a list of computers.' }; throw new Error(E[j.error] || `License server: ${j.error || r.status}`); }
  S.license = { token: j.token || '', plan: j.plan, until: j.until || 0, seats: j.seats || 0, used: j.used || 0, key: j.key || '', period: j.period || '', sessionLimit: j.sessionLimit || 0, dayLimit: j.dayLimit || 0, usedToday: j.usedToday || 0, hostLimit: j.hostLimit || 0, hosts: j.hosts || [], checked: Date.now() };
  save(); broadcastState(); return S.license;
}
let licTimer = null;
async function refreshLicense() {
  clearTimeout(licTimer);
  try { await licenseCall('status'); } catch (e) { log('license check:', e.message); }
  licTimer = setTimeout(refreshLicense, 6 * 3600e3); if (licTimer.unref) licTimer.unref();
}
function licensePublic() {
  const L = S.license || {}; const valid = !!licToken();
  const plan = (L.plan === 'pro' || L.plan === 'max') && valid ? L.plan : L.plan ? 'free' : 'unknown';
  const left = plan === 'free' ? Math.max(0, (L.dayLimit || 0) - (L.usedToday || 0)) : 0;
  return { plan, until: L.until || 0, seats: L.seats || 0, used: L.used || 0, key: L.key || '', period: L.period || '', sessionLimit: L.sessionLimit || 0, dayLimit: L.dayLimit || 0, usedToday: L.usedToday || 0, leftToday: left, checked: L.checked || 0, buyUrl: BUY_URL, price: PRICE, hostLimit: L.hostLimit || 0, hosts: (L.hosts || []).map((h) => ({ id: h.id, idFmt: fmtId(h.id), last: h.last, name: ((S.saved || []).find((c) => c.id === h.id) || {}).name || '' })), canControl: valid && (plan === 'pro' || plan === 'max' || left > 30000) };
}

// ---------------------------------------------------------------- screens
function displays() {
  const all = screen.getAllDisplays(); const prim = screen.getPrimaryDisplay().id;
  return all.map((d, i) => {
    let phys = d.bounds;
    try { if (process.platform === 'win32') phys = screen.dipToScreenRect(null, d.bounds); else if (process.platform === 'linux' && d.scaleFactor !== 1) phys = { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor), width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) }; } catch {}
    return { index: i, id: String(d.id), primary: d.id === prim, bounds: d.bounds, phys, scale: d.scaleFactor, label: `${i + 1}${d.id === prim ? ' (main)' : ''} · ${phys.width}×${phys.height}` };
  });
}
async function sourceFor(index) {
  const ds = displays(); const d = ds[index] || ds.find((x) => x.primary) || ds[0];
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const s = srcs.find((x) => String(x.display_id) === d.id) || srcs[index] || srcs[0];
  return { sourceId: s ? s.id : '', display: d };
}

// ---------------------------------------------------------------- windows
const pageUrl = (p) => `${SCHEME}://app/${p}`;
const webPrefs = () => ({ partition: PART, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false });
function harden(w) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${SCHEME}://app/`)) e.preventDefault(); });
}
function ensureHost() {
  if (!S.enabled) { if (hostWin && !hostWin.isDestroyed()) hostWin.destroy(); hostWin = null; hostState = { state: 'off' }; broadcastState(); return; }
  if (hostWin && !hostWin.isDestroyed()) { hostWin.webContents.send('rd-config'); return; }
  hostWin = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: webPrefs() });
  harden(hostWin);
  hostWin.on('closed', () => { hostWin = null; });
  hostWin.webContents.on('render-process-gone', () => { log('host page crashed, restarting'); hostWin = null; setTimeout(ensureHost, 2000); });
  hostWin.webContents.on('did-finish-load', () => givePort());
  hostWin.loadURL(pageUrl('host.html'));
}
function openHome() {
  if (homeWin && !homeWin.isDestroyed()) { if (homeWin.isMinimized()) homeWin.restore(); homeWin.show(); homeWin.focus(); return homeWin; }
  homeWin = new BrowserWindow({ width: 1000, height: 700, minWidth: 760, minHeight: 560, title: opts.standalone ? opts.appName : `${opts.appName} — Remote desktop`, backgroundColor: '#0d0f12', icon: opts.icon || undefined, autoHideMenuBar: true, show: false, webPreferences: webPrefs() });
  harden(homeWin);
  homeWin.once('ready-to-show', () => homeWin.show());
  homeWin.on('closed', () => { homeWin = null; });
  homeWin.loadURL(pageUrl('home.html'));
  return homeWin;
}
function openSsh() {
  if (sshWin && !sshWin.isDestroyed()) { if (sshWin.isMinimized()) sshWin.restore(); sshWin.show(); sshWin.focus(); return sshWin; }
  sshWin = new BrowserWindow({ width: 1100, height: 700, minWidth: 700, minHeight: 420, title: `${opts.appName} — SSH terminal`, backgroundColor: '#0d0f12', icon: opts.icon || undefined, autoHideMenuBar: true, show: false, webPreferences: webPrefs() });
  harden(sshWin);
  sshWin.once('ready-to-show', () => sshWin.show());
  sshWin.on('closed', () => { sshWin = null; });
  sshWin.loadURL(pageUrl('ssh.html'));
  return sshWin;
}
let viewerSeq = 0;
const viewerJobs = new Map(); // token -> { id, password }
function openViewer(id, password, name, remember) {
  const token = String(++viewerSeq) + rnd(8).toString('hex');
  viewerJobs.set(token, { id: String(id).replace(/\D/g, ''), password: password || '', name: name || '', remember: !!remember });
  const w = new BrowserWindow({ width: 1280, height: 820, minWidth: 640, minHeight: 420, title: `${opts.appName} — ${fmtId(id)}`, backgroundColor: '#000000', icon: opts.icon || undefined, autoHideMenuBar: true, webPreferences: webPrefs() });
  harden(w);
  viewers.add(w); w.on('closed', () => { viewers.delete(w); viewerJobs.delete(token); });
  const fsNote = (on) => { try { if (!w.isDestroyed()) w.webContents.send('rd-fs', on); } catch {} };
  w.on('enter-full-screen', () => fsNote(true)); w.on('leave-full-screen', () => fsNote(false));
  w.loadURL(pageUrl(`viewer.html#${token}`));
  return w;
}
const fmtId = (id) => String(id || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim();

// The session panel on the controlled computer: a bar at the top ("X is controlling this computer", Chat, Disconnect)
// that opens into a side panel with chat, voice call, file transfer and "let them control" (view only).
const BAR = { w: 560, h: 46 }, PANEL = { w: 400, h: 600 };
let panelOpen = false;
function placePanel() {
  if (!bannerWin || bannerWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const b = panelOpen ? { width: PANEL.w, height: Math.min(PANEL.h, wa.height - 20), x: wa.x + wa.width - PANEL.w - 10, y: wa.y + 10 } : { width: BAR.w, height: BAR.h, x: Math.round(wa.x + wa.width / 2 - BAR.w / 2), y: wa.y + 6 };
  bannerWin.setBounds(b);
}
function showBanner() {
  const list = [...sessions.values()];
  if (!list.length) { if (bannerWin && !bannerWin.isDestroyed()) bannerWin.destroy(); bannerWin = null; panelOpen = false; panelLog = []; return; }
  if (!bannerWin || bannerWin.isDestroyed()) {
    bannerWin = new BrowserWindow({ width: BAR.w, height: BAR.h, frame: false, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true, focusable: true, transparent: false, backgroundColor: '#14181e', show: false, webPreferences: webPrefs() });
    bannerWin.setAlwaysOnTop(true, 'screen-saver');
    harden(bannerWin);
    bannerWin.loadURL(pageUrl('banner.html'));
    bannerWin.once('ready-to-show', () => { placePanel(); bannerWin.showInactive(); });
    bannerWin.on('closed', () => { bannerWin = null; });
  } else bannerWin.webContents.send('rd-state');
}
let panelLog = []; // events of this run of sessions (chat, files, calls) so the panel can show them after it opens
function panelEvent(ev) {
  ev = Object.assign({ at: Date.now() }, ev);
  if (['chat', 'in-done', 'out-done', 'call', 'call-join', 'call-end', 'info', 'cmd', 'cmd-end', 'ai'].includes(ev.t)) { panelLog.push(ev); if (panelLog.length > 300) panelLog.shift(); }
  if (bannerWin && !bannerWin.isDestroyed()) {
    bannerWin.webContents.send('rd-panel-event', ev);
    if (!panelOpen && ['chat', 'call', 'in-start', 'ai'].includes(ev.t)) { panelOpen = true; placePanel(); bannerWin.webContents.send('rd-panel-open', true); }
  }
}

// ---------------------------------------------------------------- files (drag and drop, both directions) + recordings
const openFiles = new Map(); // fid -> { path, size, fd }
const recvs = new Map();     // rid -> { part, final, fd, size, got }
const received = new Set();  // files saved in this run (only these can be shown in the folder)
const safeName = (n) => (path.basename(String(n || 'file')).replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150) || 'file');
function uniquePath(dir, name) {
  const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) { const p = path.join(dir, i ? `${base} (${i})${ext}` : name); if (!fs.existsSync(p) && !fs.existsSync(p + '.part')) return p; }
}
const recvDir = (kind) => { const d = path.join(app.getPath(kind === 'rec' ? 'videos' : 'downloads'), 'Carpathron Remote'); fs.mkdirSync(d, { recursive: true }); return d; };
function sysinfo() {
  const c = os.cpus() || [];
  return { os: `${process.platform === 'win32' ? 'Windows' : os.type()} ${os.release()}`, arch: os.arch(), cpu: c[0] ? c[0].model.replace(/\s+/g, ' ').trim() : '', cores: c.length, ram: Math.round(os.totalmem() / 1073741824), up: Math.round(os.uptime() / 3600) };
}

function publicState() {
  return {
    host: { ...hostState, control: Injector.support(), enabled: S.enabled, id: S.id, idFmt: fmtId(S.id), otp: S.enabled ? otp : '', unattended: S.unattended, hasPerm: !!S.perm, trusted: (S.trusted || []).map((t) => ({ salt: t.salt, name: t.name, pc: t.pc, added: t.added, last: t.last || 0 })), name: S.name, locked: lockedUntil > Date.now() ? lockedUntil : 0 },
    sessions: [...sessions.entries()].map(([sid, s]) => ({ sid, ...s })),
    relay: isAuto() ? '' : S.relay, relayNow: relay(), quality: S.quality, autostart: S.autostart, viewOnly: !!S.viewOnly, clipSync: S.clipSync !== false, standalone: !!opts.standalone, store: !!process.windowsStore,
    license: licensePublic(),
    saved: (S.saved || []).map((c) => ({ id: c.id, idFmt: fmtId(c.id), name: c.name || '', last: c.last || 0, hasPw: !!c.pw })),
    version: app.getVersion(), app: opts.appName, cmdUnattended: !!S.cmdUnattended, aiReady: !!(aiMod && aiMod.ready()),
  };
}
// ---------------------------------------------------------------- mouse + keyboard in their own process (see input-worker.js)
let inputWorker = null, workerFails = 0, idChange = null, secureShown = false;
const recaptureAll = (why) => { if (hostWin && !hostWin.isDestroyed() && sessions.size) hostWin.webContents.send('rd-recapture', why); };
const noteCtl = (text) => { if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send('rd-ctl-note', text); };
function startInputWorker() {
  if (!utilityProcess || !MessageChannelMain) return false;
  let w;
  try { w = utilityProcess.fork(path.join(__dirname, 'input-worker.js'), [], { serviceName: 'Carpathron Remote input', stdio: 'ignore' }); }
  catch (e) { log(`remote control: input process could not start (${e.message})`); return false; }
  inputWorker = w;
  w.on('message', (m) => {
    if (!m) return;
    if (m.log) log(m.log);
    if (m.status) noteCtl(m.status);
    if (m.secure === 0) { secureShown = false; syncInput(); recaptureAll('the Windows security screen closed'); }
    if (m.secure === 1) { secureShown = true; syncInput(); log('remote control: Windows security screen shown through the helper service'); }
    if (m.first) { const s = sessions.get(String(m.first)); log(`remote control: first input from ${s ? s.name : m.first} (${m.k})`); }
  });
  w.on('exit', (code) => {
    if (inputWorker !== w) return;
    inputWorker = null; log(`remote control: input process stopped (${code})`);
    if (++workerFails <= 5) setTimeout(() => { if (!inputWorker && startInputWorker()) { syncInput(); givePort(); } }, 1000);
    else { log('remote control: the input process keeps stopping, using the main process'); injector = localInjector(); }
  });
  return true;
}
function localInjector() { const j = new Injector(opts.log); j.onStatus = noteCtl; return j; }
// which sessions may control, and the screen each one sees (physical pixels)
function syncInput() {
  if (!inputWorker) return;
  let ds; try { ds = displays(); } catch { return; } const allow = {};
  // while the Windows security screen is up its picture is the main screen, so input maps to the main screen too
  const main = ds.find((x) => x.primary) || ds[0];
  for (const [sid, s] of sessions) if (s.control !== false) allow[sid] = (secureShown ? main : (ds[s.screen || 0] || ds[0])).phys;
  try { inputWorker.postMessage({ type: 'sessions', allow }); } catch {}
}
// a direct line from the host page to the input process
function givePort() {
  if (!inputWorker || !hostWin || hostWin.isDestroyed()) return;
  try { const { port1, port2 } = new MessageChannelMain(); inputWorker.postMessage({ type: 'port' }, [port1]); hostWin.webContents.postMessage('rd-input-port', null, [port2]); }
  catch (e) { log(`remote control: no direct input line (${e.message})`); }
}
const workerInjector = {
  handle: (ev, _rect, sid) => { if (inputWorker) inputWorker.postMessage({ type: 'in', sid, ev }); },
  releaseAll: (rect) => { if (inputWorker) inputWorker.postMessage({ type: 'release', rect }); },
  stop: () => { const w = inputWorker; inputWorker = null; workerFails = 99; if (!w) return; try { w.postMessage({ type: 'stop' }); } catch {} setTimeout(() => { try { w.kill(); } catch {} }, 500); },
};

function broadcastState() {
  syncInput();
  for (const w of [homeWin, bannerWin, hostWin]) if (w && !w.isDestroyed()) w.webContents.send('rd-state');
}

// ---------------------------------------------------------------- consent (attended access)
async function askConsent(info) {
  const auto = process.env.RD_AUTO_CONSENT;
  if (auto) return auto === 'allow' ? 'full' : auto === 'trust' ? 'trust' : auto === 'view' ? 'view' : false;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
  try {
    const parent = (homeWin && !homeWin.isDestroyed() && homeWin.isVisible()) ? homeWin : null;
    const o = { type: 'question', buttons: ['Allow', 'Allow and always trust this computer', 'Allow viewing only', 'Deny'], defaultId: 3, cancelId: 3, noLink: true, title: opts.appName,
      message: `${String(info.name || 'Someone').slice(0, 60)} wants to control this computer`,
      detail: `They used this computer's one-time password${info.pc ? ` from "${String(info.pc).slice(0, 60)}"` : ''}.\n\nAllow: they see your screen and use your mouse and keyboard.\nAllow and always trust this computer: from now on that computer can connect any time without a password and without asking (for your own computers or your IT support; you can remove it in Remote desktop → Trusted computers).\nAllow viewing only: they only see your screen (presentation).\n\nAllow only people you trust. You can chat, call, send files or end the session any time from the bar at the top of the screen.\n\nNo answer in 60 seconds = Deny.`,
      signal: ac.signal };
    const r = parent ? await dialog.showMessageBox(parent, o) : await dialog.showMessageBox(o);
    return r.response === 0 ? 'full' : r.response === 1 ? 'trust' : r.response === 2 ? 'view' : false;
  } catch { return false; } finally { clearTimeout(t); }
}

async function askCmdConsent(info) {
  const auto = process.env.RD_AUTO_CMD;
  if (auto) return auto === 'allow';
  if (info.how === 'personal password') return !!S.cmdUnattended; // nobody is asked on unattended sessions: the setting decides
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60000);
  try {
    const o = { type: 'question', buttons: ['Allow commands', 'Deny'], defaultId: 1, cancelId: 1, noLink: true, title: opts.appName,
      message: `${String(info.name || 'The technician').slice(0, 60)} wants to run commands on this computer${info.ai ? ' (with the AI technician)' : ''}`,
      detail: `Commands (${process.platform === 'win32' ? 'PowerShell' : 'Terminal'}) let them check and repair this computer: disks, programs, updates, security settings.\n\nThey run with your account. Anything that needs administrator rights shows a Windows prompt here that you must accept.\n\nYou see every command in the panel at the top of the screen and can stop them there. No answer in 60 seconds = Deny.`,
      signal: ac.signal };
    const r = await dialog.showMessageBox(o);
    return r.response === 0;
  } catch { return false; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- IPC
const fromRd = (e) => { try { return String(e.senderFrame ? e.senderFrame.url : e.sender.getURL()).startsWith(`${SCHEME}://app/`); } catch { return false; } };
const isHost = (e) => hostWin && !hostWin.isDestroyed() && e.sender === hostWin.webContents;
function handle(ch, fn, hostOnly) {
  ipcMain.handle(ch, async (e, ...a) => {
    if (!fromRd(e) || (hostOnly && !isHost(e))) throw new Error('not allowed');
    return fn(e, ...a);
  });
}
function setupIpc() {
  handle('rd-state', () => publicState());
  handle('rd-set', (_e, patch) => {
    const p = patch || {};
    if ('enabled' in p) S.enabled = !!p.enabled;
    if ('relay' in p) { const r = String(p.relay || '').trim(); if (!r || /^wss?:\/\/[^\s]+$/.test(r)) S.relay = r || DEFAULT_RELAY; pickRelay(); }
    if ('name' in p) S.name = String(p.name || os.hostname()).slice(0, 60);
    if ('quality' in p && ['auto', 'high', 'low'].includes(p.quality)) S.quality = p.quality;
    if ('unattended' in p) S.unattended = !!p.unattended && !!S.perm;
    if ('viewOnly' in p) S.viewOnly = !!p.viewOnly;
    if ('clipSync' in p) S.clipSync = !!p.clipSync;
    if ('cmdUnattended' in p) S.cmdUnattended = !!p.cmdUnattended;
    if ('autostart' in p && opts.standalone) { S.autostart = !!p.autostart; try { app.setLoginItemSettings({ openAtLogin: S.autostart, args: ['--hidden'] }); } catch {} }
    save(); ensureHost(); broadcastState(); return publicState();
  });
  handle('rd-new-otp', () => { newOtp(); return publicState(); });
  // change this computer's ID: a chosen 9-digit number (if free) or a new random one ('')
  handle('rd-change-id', async (_e, want) => {
    want = String(want || '').replace(/\D/g, '');
    if (want && !/^\d{9}$/.test(want)) return { ok: false, error: 'The ID must have exactly 9 digits.' };
    if (want && want === S.id) return { ok: true, id: fmtId(S.id) };
    if (!S.enabled) return { ok: false, error: 'Turn on "Accept connections" first.' };
    if (idChange) return { ok: false, error: 'Already changing the ID, wait a moment.' };
    const prev = S.id; S.id = want; save();
    const r = await new Promise((res) => { idChange = { res }; setTimeout(() => res({ ok: false, error: 'The relay did not answer. Check the internet and try again.' }), 15000); ensureHost(); });
    idChange = null;
    if (!r.ok) { S.id = prev; save(); ensureHost(); } else log(`ID changed to ${r.id}`);
    broadcastState(); return r;
  });
  handle('rd-set-password', async (_e, pw) => {
    pw = String(pw || '');
    if (!pw) { S.perm = null; S.unattended = false; save(); broadcastState(); return publicState(); }
    if (pw.length < 10) throw new Error('The personal password must have at least 10 characters.');
    const salt = rnd(16);
    const k = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256');
    S.perm = { salt: salt.toString('base64'), k: seal(k.toString('base64')) }; S.unattended = true;
    save(); broadcastState(); return publicState();
  });
  handle('rd-open-viewer', (_e, id, remember) => {
    id = String(id || '').replace(/\D/g, '');
    if (!/^\d{9}$/.test(id)) throw new Error('A Carpathron ID has 9 digits.');
    const c = (S.saved || []).find((x) => x.id === id);
    openViewer(id, c && c.pw ? unseal(c.pw) : '', c ? c.name : '', !!remember);
    return true;
  });
  handle('rd-remember', (e, token, password) => {
    const j = viewerJobs.get(String(token)); if (!j || !j.remember || !password) return false;
    let c = (S.saved || []).find((x) => x.id === j.id); if (!c) { c = { id: j.id }; S.saved.unshift(c); }
    c.pw = seal(String(password)); save(); broadcastState(); return true;
  });
  handle('rd-forget', (_e, id) => { S.saved = (S.saved || []).filter((x) => x.id !== String(id)); save(); broadcastState(); return publicState(); });
  handle('rd-rename-saved', (_e, id, name) => { const c = (S.saved || []).find((x) => x.id === String(id)); if (c) { c.name = String(name || '').slice(0, 60); save(); } broadcastState(); return publicState(); });
  handle('rd-open-home', () => { openHome(); return true; });
  handle('rd-open-ssh', () => { openSsh(); return true; });
  handle('rd-ssh-keyfile', async (e) => { const w = BrowserWindow.fromWebContents(e.sender); const r = await dialog.showOpenDialog(w, { title: 'Choose your private key file', defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] }); return r.canceled ? '' : r.filePaths[0]; });
  sshMod = require('./ssh').create({ ipcMain, BrowserWindow, getS: () => S, save, seal, unseal, log, handle });

  // ---------------------------------------------------------------- commands on THIS computer for a technician (host side)
  handle('rd-cmd-consent', async (_e, info) => askCmdConsent(info || {}), true);
  handle('rd-run', (_e, req) => {
    req = req || {}; const rid = String(req.rid || '').slice(0, 160); if (!rid) throw new Error('rid');
    const send = (k, d) => { if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send('rd-run-ev', rid, k, d); };
    log(`command for ${String(req.who || 'technician').slice(0, 60)}${req.admin ? ' (admin)' : ''}: ${String(req.script || '').split('\n')[0].slice(0, 120)}`);
    runner.run({ rid, shell: req.shell, script: req.script, admin: !!req.admin, timeout: req.timeout }, (d) => send('out', d)).then((r) => send('end', r));
    return true;
  }, true);
  handle('rd-run-kill', (_e, rid) => runner.kill(String(rid || '')), true);

  // ---------------------------------------------------------------- viewer bridge for the AI (main → viewer page → host)
  handle('rd-agent-reply', (e, rid, result) => { const p = agentWait.get(String(rid)); if (p && p.wc === e.sender) { agentWait.delete(String(rid)); p.resolve(result); } return true; });
  handle('rd-ai-remote-stop', (e) => { if (aiMod) aiMod.stopFromRemote(e.sender); return true; });
  aiMod = require('./ai').create({
    getS: () => S, save, seal, unseal, log, handle,
    desktop: { call: agentCall },
    ssh: { info: (tid) => sshMod.info(tid), exec: (tid, script, o) => sshMod.exec(tid, script, o) },
    onAiState: broadcastState,
    appAi: opts.appAi, appName: opts.appName,
  });
  handle('rd-license-activate', async (_e, key) => { await licenseCall('activate', { key: String(key || '').trim() }); return publicState(); });
  handle('rd-license-release', async () => { await licenseCall('release'); return publicState(); });
  handle('rd-license-refresh', async () => { await licenseCall('status'); return publicState(); });
  handle('rd-license-unhost', async (_e, id) => { await licenseCall('unhost', { id: String(id || '') }); return publicState(); });
  // Plans: the live list from qubitpage.com (falls back to the built-in prices when offline)
  handle('rd-plans', async () => {
    try {
      const r = await fetch(SHOP + '/api/software/plans', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.ok && Array.isArray(j.plans) && j.plans.length) return { live: true, plans: j.plans.filter((p) => p && /^[a-z0-9-]{3,60}$/.test(p.code)).map((p) => ({ code: p.code, name: String(p.name || ''), tier: p.tier === 'max' ? 'max' : 'pro', period: p.period === 'yearly' ? 'yearly' : 'monthly', months: Number(p.months) || 1, price_cents: Number(p.price_cents) || 0, currency: String(p.currency || 'USD').slice(0, 3), recurring: !!p.recurring, max_pcs: Number(p.max_pcs) || 1 })), shop: BUY_URL, account: ACCOUNT_URL };
    } catch (e) { log('plans:', e.message); }
    return { live: false, plans: DEFAULT_PLANS, shop: BUY_URL, account: ACCOUNT_URL };
  });
  // Buy: opens the plan on qubitpage.com in the browser (PayPal checkout there), with the plan and number of PCs chosen
  handle('rd-buy', (_e, code, pcs) => {
    let url = BUY_URL;
    if (code && /^[a-z0-9-]{3,60}$/.test(String(code))) url += `?plan=${encodeURIComponent(code)}&pcs=${Math.max(1, Math.min(1000, Math.floor(Number(pcs) || 1)))}#order`;
    require('electron').shell.openExternal(url); return true;
  });
  handle('rd-my-licenses', () => { require('electron').shell.openExternal(ACCOUNT_URL); return true; });
  handle('rd-license-quiet', async () => { try { await licenseCall('status'); } catch {} return true; });
  handle('rd-disconnect', (_e, sid) => { if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send('rd-kill', sid ? String(sid) : '*'); return true; });

  // viewer pages
  handle('rd-viewer-job', async (e, token) => {
    const j = viewerJobs.get(String(token)); if (!j) return null;
    try { await licenseCall('status'); } catch {} // fresh usage for today
    let trust = null; try { const c = (S.saved || []).find((x) => x.id === j.id); if (c && c.trust) trust = JSON.parse(unseal(c.trust)); } catch {}
    return { trust, id: j.id, idFmt: fmtId(j.id), password: j.password, name: j.name, remember: j.remember, lic: licToken(), buyUrl: BUY_URL, relay: relay(), me: S.name, pc: os.hostname(), quality: S.quality, clipSync: S.clipSync !== false };
  });
  handle('rd-viewer-connected', (_e, id, remoteName) => {
    id = String(id || '').replace(/\D/g, ''); if (!/^\d{9}$/.test(id)) return;
    let c = (S.saved || []).find((x) => x.id === id);
    if (!c) { c = { id }; S.saved.unshift(c); }
    if (remoteName && !c.name) c.name = String(remoteName).slice(0, 60);
    c.last = Date.now(); S.saved = [c, ...S.saved.filter((x) => x !== c)].slice(0, 50); save(); broadcastState();
  });
  handle('rd-title', (e, t) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.setTitle(String(t).slice(0, 120)); });
  handle('rd-fullscreen', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w) return false; w.setFullScreen(!!on); return !!on; }); // the switch can finish later: answer what was asked
  // Electron 44: clipboard.readText() returns a Promise — always await it
  handle('rd-clipboard', async () => String((await clipboard.readText()) || '').slice(0, 20000));

  // files: open a dropped file (path from webUtils in the preload), read it in chunks; save received files
  handle('rd-file-open', async (_e, p) => {
    p = String(p || ''); if (!p || !path.isAbsolute(p)) throw new Error('This item cannot be sent (only files from this computer).');
    const st = await fs.promises.stat(p); if (!st.isFile()) throw new Error(`${path.basename(p)} is a folder: send the files inside it, or zip it first.`);
    const fid = rnd(9).toString('hex'); openFiles.set(fid, { path: p, size: st.size, fd: await fs.promises.open(p, 'r') });
    return { fid, name: path.basename(p), size: st.size };
  });
  handle('rd-file-read', async (_e, fid, off, len) => {
    const f = openFiles.get(String(fid)); if (!f) throw new Error('file closed');
    len = Math.max(0, Math.min(Number(len) || 0, 1048576)); const buf = Buffer.alloc(len);
    const { bytesRead } = await f.fd.read(buf, 0, len, Number(off) || 0); return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  });
  handle('rd-file-close', async (_e, fid) => { const f = openFiles.get(String(fid)); openFiles.delete(String(fid)); if (f) await f.fd.close().catch(() => {}); return true; });
  handle('rd-recv-start', async (_e, name, size, kind) => {
    const final = uniquePath(recvDir(kind), safeName(name)); const part = final + '.part';
    const rid = rnd(9).toString('hex'); recvs.set(rid, { part, final, fd: await fs.promises.open(part, 'w'), size: Number(size) || 0, got: 0 });
    return rid;
  });
  handle('rd-recv-chunk', async (_e, rid, bytes) => {
    const r = recvs.get(String(rid)); if (!r) throw new Error('transfer closed');
    const b = Buffer.from(bytes); if (r.size && r.got + b.length > r.size + 16) throw new Error('more data than announced');
    await r.fd.write(b); r.got += b.length; return r.got;
  });
  handle('rd-recv-end', async (_e, rid, ok) => {
    const r = recvs.get(String(rid)); recvs.delete(String(rid)); if (!r) return { ok: false };
    await r.fd.close().catch(() => {});
    if (!ok) { await fs.promises.unlink(r.part).catch(() => {}); return { ok: false }; }
    await fs.promises.rename(r.part, r.final); received.add(r.final); log(`saved ${r.final} (${r.got} bytes)`);
    return { ok: true, path: r.final, name: path.basename(r.final) };
  });
  handle('rd-show-file', (_e, p) => { p = String(p || ''); if (received.has(p)) shell.showItemInFolder(p); else if (p === 'downloads' || p === 'rec') shell.openPath(recvDir(p === 'rec' ? 'rec' : 'file')); return true; });
  handle('rd-clip-write', (_e, text) => { if (S.clipSync !== false && typeof text === 'string') clipboard.writeText(text.slice(0, 100000)); return true; });
  handle('rd-clip-read', async () => (S.clipSync !== false ? String((await clipboard.readText()) || '').slice(0, 100000) : ''));

  // session panel (on the controlled computer) <-> host page
  handle('rd-panel-cmd', (_e, cmd) => { if (hostWin && !hostWin.isDestroyed() && cmd && typeof cmd.t === 'string') hostWin.webContents.send('rd-panel-cmd', cmd); return true; });
  handle('rd-panel-open', (_e, on) => { panelOpen = !!on; placePanel(); return panelOpen; });
  handle('rd-panel-log', () => panelLog);
  handle('rd-panel-event', (_e, ev) => { if (ev && typeof ev.t === 'string') panelEvent(ev); return true; }, true);
  handle('rd-sysinfo', () => sysinfo(), true);

  // host page only
  // ---- reconnect keys: a viewer that lost the connection (network, app or PC restart) comes back without a new
  // password or a new "Allow", for 10 minutes after the session ended (like the big remote tools)
  const liveResumes = () => (S.resumes || []).filter((r) => r.exp > Date.now());
  handle('rd-resume-add', (_e, r) => {
    if (!r || !r.salt || !r.key) return false;
    S.resumes = liveResumes().slice(-4);
    S.resumes.push({ sid: String(r.sid || ''), salt: String(r.salt), k: seal(String(r.key)), name: String(r.name || '').slice(0, 60), how: String(r.how || ''), control: r.control !== false, exp: Date.now() + 12 * 3600000 });
    save(); return true;
  }, true);
  // trusted computers: the person at this PC chose "Allow and always trust this computer"; that viewer then connects
  // any time without a password or a question (until removed here)
  handle('rd-trust-add', (_e, t) => {
    if (!t || !t.salt || !t.key) return false;
    S.trusted = (S.trusted || []).filter((x) => x.salt !== t.salt).slice(-199);
    S.trusted.push({ salt: String(t.salt), k: seal(String(t.key)), name: String(t.name || '').slice(0, 60), pc: String(t.pc || '').slice(0, 60), added: Date.now() });
    save(); broadcastState(); log(`trusted computer added: ${t.name} (${t.pc})`); return true;
  }, true);
  handle('rd-trust-used', (_e, salt) => { const t = (S.trusted || []).find((x) => x.salt === salt); if (t) { t.last = Date.now(); save(); } return true; }, true);
  handle('rd-untrust', (_e, salt) => { S.trusted = (S.trusted || []).filter((x) => x.salt !== String(salt)); save(); broadcastState(); return publicState(); });
  // the viewer side keeps the trust key of a computer with its saved entry (encrypted)
  handle('rd-remember-trust', (_e, token, tok, salt) => {
    const j = viewerJobs.get(String(token)); if (!j || !tok || !salt) return false;
    let c = (S.saved || []).find((x) => x.id === j.id); if (!c) { c = { id: j.id }; S.saved.unshift(c); }
    c.trust = seal(JSON.stringify({ tok: String(tok), salt: String(salt) })); save(); broadcastState(); return true;
  });
  handle('rd-resume-use', (_e, salt) => { S.resumes = liveResumes().filter((r) => r.salt !== salt); save(); return true; }, true);
  // restart this PC for the person controlling it (the viewer reconnects by itself afterwards)
  handle('rd-restart-pc', (_e, who) => {
    const msg = `Carpathron Remote: restart asked by ${String(who || 'the remote helper').slice(0, 60)}`;
    try {
      if (process.env.RD_INJECT_LOG) { log(`TEST: restart asked by ${who}`); return { ok: true, autostart: true }; } // tests never restart the machine
      if (process.platform === 'win32') { const W = require('./winexe'); require('child_process').spawn(W.exe('cmd'), ['/c', 'shutdown', '/r', '/t', '8', '/c', msg], { windowsHide: true, detached: true, env: W.env() }).unref(); }
      else require('child_process').spawn('systemctl', ['reboot'], { detached: true, stdio: 'ignore' }).unref();
      log(`restart of this PC asked by ${who}`); return { ok: true, autostart: process.platform !== 'win32' || !!S.autostart || !opts.standalone };
    } catch (e) { return { ok: false, error: e.message }; }
  }, true);
  handle('rd-host-config', () => ({ trusted: (S.trusted || []).map((t) => ({ salt: t.salt, k: unseal(t.k), name: t.name })), resumes: liveResumes().map((r) => ({ salt: r.salt, k: unseal(r.k), name: r.name, how: r.how, control: r.control })), relay: relay(), id: S.id, key: unseal(S.key), name: S.name, otp, otpSalt, perm: S.perm ? { salt: S.perm.salt, k: unseal(S.perm.k) } : null, unattended: S.unattended, quality: S.quality, locked: lockedUntil, forceRelay: process.env.RD_FORCE_RELAY === '1', viewOnly: !!S.viewOnly, clipSync: S.clipSync !== false }), true);
  handle('rd-host-status', (_e, st) => {
    hostState = { state: String(st && st.state || 'off'), error: st && st.error ? String(st.error) : '' };
    if (st && st.id && /^\d{9}$/.test(st.id) && st.id !== S.id) { S.id = st.id; save(); }
    if (st && st.id && idChange) idChange.res({ ok: true, id: fmtId(st.id) });
    if (st && st.error === 'id-taken') { if (idChange) idChange.res({ ok: false, error: 'This ID is already used by another computer. Choose another one.' }); else { S.id = ''; save(); } }
    broadcastState();
  }, true);
  handle('rd-auth-result', (_e, ok) => {
    const now = Date.now();
    if (ok) return { locked: 0 };
    fails = fails.filter((t) => now - t < 600000); fails.push(now);
    if (fails.length >= 5) { lockedUntil = now + 600000; fails = []; newOtp(); log('5 wrong passwords: locked for 10 minutes'); }
    broadcastState();
    return { locked: lockedUntil > now ? lockedUntil : 0 };
  }, true);
  handle('rd-locked', () => (lockedUntil > Date.now() ? lockedUntil : 0), true);
  handle('rd-consent', (_e, info) => askConsent(info || {}), true);
  handle('rd-screens', () => displays().map((d) => ({ index: d.index, label: d.label, primary: d.primary, w: d.phys.width, h: d.phys.height })), true);
  handle('rd-source', (_e, index) => sourceFor(Number(index) || 0), true);
  handle('rd-session', (_e, sid, info) => {
    sid = String(sid);
    if (info) {
      const was = sessions.get(sid) || {};
      sessions.set(sid, { ...was, name: String(info.name || was.name || 'Viewer').slice(0, 60), how: info.how || was.how || '', mode: info.mode || was.mode || '', screen: Number(info.screen ?? was.screen ?? 0), control: 'control' in info ? !!info.control : was.control !== false, call: 'call' in info ? String(info.call || '') : (was.call || ''), ai: 'ai' in info ? !!info.ai : !!was.ai, cmd: 'cmd' in info ? !!info.cmd : !!was.cmd, started: was.started || Date.now() });
      if (!blocker && sessions.size) { try { blocker = powerSaveBlocker.start('prevent-display-sleep'); } catch {} }
    } else {
      const s = sessions.get(sid); sessions.delete(sid);
      if (s && injector) { const d = displays()[s.screen || 0] || displays()[0]; injector.releaseAll(d.phys); }
      if (info === null && s && s.how === 'one-time password') newOtp(); // a used one-time password is not used twice
      if (S.resumes && S.resumes.some((r) => r.sid === sid)) { for (const r of S.resumes) if (r.sid === sid) r.exp = Math.min(r.exp, Date.now() + 10 * 60000); save(); }
      if (!sessions.size && blocker != null) { try { powerSaveBlocker.stop(blocker); } catch {} blocker = null; }
    }
    showBanner(); broadcastState();
  }, true);
  handle('rd-log-line', (_e, t) => { log(`host: ${String(t).slice(0, 300)}`); return true; }, true);
  handle('rd-input', (_e, sid, ev) => {
    const s = sessions.get(String(sid));
    if (!s || !ev || s.control === false) { if (!inputWarned.has(String(sid))) { inputWarned.add(String(sid)); log(`remote control: input ignored (${!s ? 'unknown session' : !ev ? 'empty event' : 'view only'})`); } return; }
    if (!s.inputSeen) { s.inputSeen = true; log(`remote control: first input from ${s.name} (${ev.k})`); }
    const ds = displays(); const d = ds[s.screen || 0] || ds[0];
    injector.handle(ev, d.phys, String(sid));
  }, true);
}

// ---------------------------------------------------------------- scheme + startup
function preReady() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}
const MIME = { '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serve(req) {
  const u = new URL(req.url);
  if (u.host !== 'app') return new Response('not found', { status: 404 });
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'home.html';
  const full = path.join(PAGES, rel);
  if (!full.startsWith(PAGES + path.sep) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return new Response('not found', { status: 404 });
  const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' wss: ws:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  return new Response(fs.readFileSync(full), { headers: { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' } });
}

function init(o) {
  opts = Object.assign(opts, o || {});
  load();
  // mouse + keyboard in their own process; the people controlling this PC are told (in their chat) when they cannot be used
  injector = startInputWorker() ? workerInjector : localInjector();
  try { for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => { syncInput(); recaptureAll('the screens changed'); }); } catch {}
  try { const { powerMonitor } = require('electron'); powerMonitor.on('unlock-screen', () => recaptureAll('the PC was unlocked')); powerMonitor.on('resume', () => recaptureAll('the PC woke up')); } catch {}
  newOtp();
  const ses = session.fromPartition(PART);
  ses.protocol.handle(SCHEME, serve);
  // screen capture + microphone (voice call) for the host page; microphone only for viewer windows; never the camera
  const isHostWc = (wc) => !!hostWin && !hostWin.isDestroyed() && wc === hostWin.webContents;
  const isViewerWc = (wc) => [...viewers].some((w) => !w.isDestroyed() && w.webContents === wc);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    if (perm !== 'media') return cb(false);
    const types = (details && details.mediaTypes) || [];
    if (isHostWc(wc)) return cb(true); // screen capture + microphone of the voice call
    cb(isViewerWc(wc) && types.length > 0 && types.every((t) => t === 'audio'));
  });
  ses.setPermissionCheckHandler((wc, perm, _o, details) => perm === 'media' && (isHostWc(wc) || (isViewerWc(wc) && (!details || !details.mediaType || details.mediaType === 'audio'))));
  setupIpc();
  pickRelay().finally(() => { ensureHost(); refreshLicense(); });
  setInterval(pickRelay, 10 * 60000).unref();
  screen.on('display-added', broadcastState); screen.on('display-removed', broadcastState);
  app.on('before-quit', () => { try { if (injector) injector.stop(); } catch {} });
  if (opts.standalone) { try { app.setLoginItemSettings({ openAtLogin: !!S.autostart, args: ['--hidden'] }); } catch {} }
  log(`ready (hosting ${S.enabled ? 'on' : 'off'}, relay ${relay()})`);
}

// for apps that include Carpathron Remote as a plugin (Plugins page): a short status, and turning the plugin off
function pluginState() {
  const L = licensePublic();
  return { enabled: S.plugin !== false, hosting: !!S.enabled, state: hostState.state, id: S.id ? fmtId(S.id) : '', relay: relay(), plan: L.plan, leftToday: L.leftToday, dayLimit: L.dayLimit, until: L.until, hostLimit: L.hostLimit, hosts: L.hosts.length, sessions: sessions.size, ssh: (S.ssh || []).length, buyUrl: BUY_URL, price: PRICE };
}
function setPlugin(on) {
  S.plugin = !!on;
  if (!S.plugin) { S.enabled = false; for (const w of [homeWin, sshWin, ...viewers]) if (w && !w.isDestroyed()) w.close(); }
  save(); ensureHost(); broadcastState(); return pluginState();
}
module.exports = { preReady, init, openHome, openSsh, openViewer, pluginState, setPlugin, pluginEnabled: () => !!S && S.plugin !== false, isHosting: () => !!(S && S.enabled), sessionsCount: () => sessions.size, _test: { fakeAgent: (line) => { if (inputWorker) inputWorker.postMessage({ type: 'fake', line }); }, publicState, displays, otp: () => otp, setPerm: (pw) => { const salt = rnd(16); S.perm = { salt: salt.toString('base64'), k: seal(crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256').toString('base64')) }; S.unattended = true; save(); }, settings: () => S, ensureHost } };
