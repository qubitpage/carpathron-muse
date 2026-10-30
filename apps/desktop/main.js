// Muse Carpathron — Windows desktop app (Electron shell around the local backend).
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, Menu, ipcMain, dialog, Tray, nativeImage, session } = require('electron');
const { startServer } = require('./backend/server');
const updates = require('./updater');

let win = null;
let tray = null;
let srv = null;
let quitting = false;

// The app was called "Muse Carpathron" before 1.7.0. Keep its data folder (chats, settings, servers, encrypted keys)
// so updates from older versions keep everything; Electron would otherwise use a folder named after the new productName.
try { app.setPath('userData', path.join(app.getPath('appData'), 'Muse Carpathron')); } catch {}

const logFile = () => path.join(app.getPath('userData'), 'muse-carpathron.log');
function log(text) {
  const line = `${new Date().toISOString()} ${text}\n`;
  try { fs.appendFileSync(logFile(), line); } catch {}
}

// Never work from the install folder (C:\Program Files\...): child processes would inherit it.
try { const home = path.join(app.getPath('home'), 'MuseCarpathron'); fs.mkdirSync(home, { recursive: true }); process.chdir(home); } catch {}

// Log unexpected errors instead of crashing or failing silently.
process.on('uncaughtException', (e) => log(`uncaught: ${e && e.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandled rejection: ${e && e.stack || e}`));

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

  // Trust only our own local certificate.
  // Fallback for the verify proc below: still only our exact certificate, never "any certificate on localhost".
  app.on('certificate-error', (event, _wc, url, _err, cert, cb) => {
    let ok = false;
    try {
      const n = (x) => String(x || '').replace(/\r/g, '').trim();
      ok = !!srv && url.startsWith(`https://localhost:${srv.port}`) && n(cert && cert.data) === n(fs.readFileSync(path.join(app.getPath('userData'), 'data', 'cert.pem'), 'utf8'));
    } catch {}
    if (ok) { event.preventDefault(); cb(true); } else cb(false);
  });

  ipcMain.handle('pick-folder', async (_e, start) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: start || undefined, title: 'Attach a folder' });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('open-path', (_e, p) => shell.openPath(String(p)));
  ipcMain.handle('open-external', (_e, u) => { if (/^https?:\/\//.test(String(u))) shell.openExternal(String(u)); });
  ipcMain.handle('app-version', () => app.getVersion());
  updates.setup({ ipcMain, log, autoEnabled: () => !srv || srv.store.settings.autoUpdate !== false });
  ipcMain.handle('focus-window', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } });

  async function createWindow() {
    try {
      srv = await startServer({ dataDir: path.join(app.getPath('userData'), 'data'), log, version: app.getVersion() });
    } catch (e) {
      log(`startup failed: ${e.stack || e.message}`);
      const busy = e.code === 'EADDRINUSE';
      dialog.showErrorBox('Muse Carpathron', busy
        ? 'Port 8443 is already used by another program (maybe the old Carpathron Control Center). Close it and start Muse Carpathron again.'
        : `Muse Carpathron could not start:\n${e.message}\n\nLog: ${logFile()}`);
      app.quit();
      return;
    }
    // Trust exactly our own local certificate for the window (pages, API and the live WebSocket).
    try {
      const norm = (x) => String(x || '').replace(/\r/g, '').trim();
      const ours = norm(fs.readFileSync(path.join(app.getPath('userData'), 'data', 'cert.pem'), 'utf8'));
      session.defaultSession.setCertificateVerifyProc((req, cb) => {
        if ((req.hostname === 'localhost' || req.hostname === '127.0.0.1') && norm(req.certificate && req.certificate.data) === ours) return cb(0);
        cb(-3); // use Chromium's normal verification for everything else
      });
    } catch (e) { log(`cert trust: ${e.message}`); }
    // Allow the webcam only for our own page (robot photos when the car has no camera).
    const ours = (u) => String(u || '').startsWith(`https://localhost:${srv.port}`);
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm === 'media' && ours(details && details.requestingUrl ? details.requestingUrl : wc.getURL())));
    session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && ours(origin));
    Menu.setApplicationMenu(null);
    win = new BrowserWindow({
      width: 1360, height: 880, minWidth: 960, minHeight: 620,
      title: 'Muse Carpathron',
      backgroundColor: '#0d0f12',
      icon: path.join(__dirname, 'public', 'icon.png'),
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
    });
    win.once('ready-to-show', () => win.show());
    win.loadURL(`https://localhost:${srv.port}/?t=${encodeURIComponent(srv.token)}`);
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`https://localhost:${srv.port}`)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12' && (!app.isPackaged || process.env.CARPATHRON_DEVTOOLS === '1')) win.webContents.toggleDevTools();
      if (input.type === 'keyDown' && input.key === 'F5') win.webContents.reload();
    });
    // Closing the window keeps WhatsApp + robot running in the tray when WhatsApp is enabled.
    win.on('close', (e) => {
      const keep = srv && (srv.store.settings.whatsapp.personal.enabled || srv.store.settings.whatsapp.cloud.enabled);
      if (!quitting && keep) { e.preventDefault(); win.hide(); }
    });
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'public', 'tray.png')).resize({ width: 16, height: 16 }));
      tray.setToolTip('Muse Carpathron');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Muse Carpathron', click: () => { win.show(); win.focus(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { quitting = true; app.quit(); } },
      ]));
      tray.on('click', () => { win.show(); win.focus(); });
    } catch (e) { log(`tray: ${e.message}`); }
  }

  app.whenReady().then(createWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (e) => {
    if (srv) { e.preventDefault(); const s = srv; srv = null; s.close().catch(() => {}).finally(() => app.exit(0)); }
  });
}
