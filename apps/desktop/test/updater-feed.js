// Auto-update test (run inside Electron): a local "qubitpage.com" that answers like the real route
// (/downloads/carpathron/<channel>.yml served, installers redirected to the release host), then electron-updater
// checks the "muse" channel, finds a newer version, follows the redirect and downloads + verifies the installer.
'use strict';
const http = require('http');
const crypto = require('crypto');
const { app } = require('electron');
app.on('window-all-closed', () => {});

const exe = crypto.randomBytes(300 * 1024);
const sha512 = crypto.createHash('sha512').update(exe).digest('base64');
const yml = `version: 99.0.0
files:
  - url: Muse-Carpathron-Setup-99.0.0.exe
    sha512: ${sha512}
    size: ${exe.length}
path: Muse-Carpathron-Setup-99.0.0.exe
sha512: ${sha512}
releaseDate: '2026-10-30T10:00:00.000Z'
`;
const hits = [];
const srv = http.createServer((req, res) => {
  const url = req.url.split('?')[0];   // electron-updater adds ?noCache=...
  hits.push(url);
  // Windows asks for muse.yml; this test runs on Linux, where electron-updater asks for muse-linux.yml
  if (url === '/downloads/carpathron/muse.yml' || url === '/downloads/carpathron/muse-linux.yml') { res.writeHead(200, { 'content-type': 'text/yaml' }); return res.end(yml); }
  if (url.startsWith('/downloads/carpathron/') && url.endsWith('.exe')) {   // like the route: redirect to the release host
    res.writeHead(302, { location: `http://127.0.0.1:${srv.address().port}/release-host/${url.split('/').pop()}` }); return res.end();
  }
  if (url === '/release-host/Muse-Carpathron-Setup-99.0.0.exe') { res.writeHead(200, { 'content-length': exe.length }); return res.end(exe); }
  res.writeHead(404); res.end();
});

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };

app.whenReady().then(() => srv.listen(0, '127.0.0.1', async () => {
  const { NsisUpdater } = require('electron-updater');
  const feed = `http://127.0.0.1:${srv.address().port}/downloads/carpathron`;
  // an installed app has resources/app-update.yml (written by electron-builder); a dev run reads dev-app-update.yml
  const devCfg = require('path').join(app.getAppPath(), 'dev-app-update.yml');
  require('fs').writeFileSync(devCfg, `provider: generic\nurl: ${feed}\nchannel: muse\nupdaterCacheDirName: muse-carpathron-updater-test\n`);
  process.on('exit', () => { try { require('fs').unlinkSync(devCfg); } catch {} });
  const u = new NsisUpdater({ provider: 'generic', url: feed, channel: 'muse' });
  u.forceDevUpdateConfig = true;
  u.autoDownload = true;
  u.logger = null;
  let available = null;
  u.on('update-available', (i) => { available = i; });
  const done = new Promise((resolve) => { u.on('update-downloaded', resolve); u.on('error', (e) => resolve({ error: e })); });
  try {
    const r = await u.checkForUpdates();
    ok(r && r.updateInfo && r.updateInfo.version === '99.0.0', `found version ${r && r.updateInfo && r.updateInfo.version} on channel muse`);
    const d = await Promise.race([done, new Promise((res) => setTimeout(() => res({ error: new Error('timeout') }), 30000))]);
    ok(!d.error, `downloaded and verified the installer through the redirect${d.error ? ': ' + d.error.message : ''}`);
    ok(hits.some((h) => /\/downloads\/carpathron\/muse(-linux)?\.yml$/.test(h)) && hits.some((h) => h.startsWith('/release-host/')), `requests: ${hits.join(' ')}`);
    ok(!!available, 'update-available event');
  } catch (e) { ok(false, e.message); }
  console.log(fails ? `${fails} FAILED` : 'updater: all passed');
  app.exit(fails ? 1 : 0);
}));
