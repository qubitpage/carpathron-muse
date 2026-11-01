// Automatic updates from qubitpage.com for the installer (EXE) builds.
// Feed: https://qubitpage.com/downloads/carpathron/<channel>.yml (channel "muse" or "store", set in package.json
// build.publish and baked into resources/app-update.yml by electron-builder).
// The Microsoft Store (MSIX) build never self-updates: the Store updates it (process.windowsStore).
'use strict';
const { app, BrowserWindow } = require('electron');

const SIX_HOURS = 6 * 60 * 60 * 1000;
const state = { enabled: false, status: 'idle', version: '', progress: 0, error: '', checkedAt: 0, reason: '' };
let updater = null;
let logFn = () => {};
let wantsAuto = () => true;

function publish() {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('update-state', { ...state }); } catch {}
  }
}

function set(patch) { Object.assign(state, patch); publish(); }

// Turns updater errors into something a user can act on. "No feed yet" (404) and being offline are normal, not errors.
function failed(e) {
  const m = String(e && e.message || e);
  if (/HttpError: 404|Cannot find channel|404 Not Found/i.test(m)) return set({ status: 'nofeed', error: '' });
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|socket hang up|getaddrinfo/i.test(m)) return set({ status: 'offline', error: '' });
  set({ status: 'error', error: m.split('\n')[0].replace(/\s*Headers:.*$/i, '').slice(0, 160) });
}

function supported() {
  if (process.windowsStore) return 'Microsoft Store version: the Store installs updates.';
  if (!app.isPackaged) return 'Development run: no updates.';
  if (process.platform !== 'win32') return 'Updates are for the Windows app.';
  if (process.env.CARPATHRON_NO_UPDATES === '1') return 'Updates switched off (CARPATHRON_NO_UPDATES).';
  return '';
}

async function check(manual = false) {
  if (!updater) return { ...state };
  if (!manual && !wantsAuto()) return { ...state };
  if (['checking', 'downloading', 'ready'].includes(state.status)) return { ...state };
  set({ status: 'checking', error: '' });
  try {
    await updater.checkForUpdates();
  } catch (e) {
    failed(e);
    logFn(`update check failed: ${e && e.message}`);
  }
  state.checkedAt = Date.now();
  return { ...state };
}

function setup({ ipcMain, log, autoEnabled }) {
  logFn = log || logFn;
  wantsAuto = autoEnabled || wantsAuto;
  ipcMain.handle('update-state', () => ({ ...state }));
  ipcMain.handle('update-check', () => check(true));
  ipcMain.handle('update-install', () => {
    if (state.status !== 'ready' || !updater) return false;
    logFn(`installing update ${state.version}`);
    setImmediate(() => updater.quitAndInstall(true, true));   // silent install, start the app again
    return true;
  });
  const why = supported();
  if (why) { state.reason = why; return; }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
  } catch (e) {
    state.reason = `Updater missing: ${e.message}`;
    return;
  }
  state.enabled = true;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;      // a downloaded update is installed the next time you close the app
  updater.allowDowngrade = false;
  updater.logger = { info: (m) => logFn(`update: ${m}`), warn: (m) => logFn(`update warn: ${m}`), error: (m) => logFn(`update error: ${m}`), debug: () => {} };
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'current', version: '' }));
  updater.on('update-available', (i) => set({ status: 'downloading', version: i && i.version || '', progress: 0 }));
  updater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p && p.percent || 0) }));
  updater.on('update-downloaded', (i) => { set({ status: 'ready', version: i && i.version || state.version, progress: 100 }); logFn(`update ${state.version} downloaded`); });
  updater.on('error', (e) => failed(e));
  setTimeout(() => check(false), 20 * 1000);       // first check shortly after start
  setInterval(() => check(false), SIX_HOURS).unref();
}

module.exports = { setup, check, state, failed };
