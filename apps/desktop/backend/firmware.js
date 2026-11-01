// Robot firmware: the app ships the Baby Carpathron car firmware (repo folder firmware/, packaged as resources/firmware)
// and can put it on the car by itself: copy the sketch into the workspace (the previous copy is kept as a backup),
// find the car's USB port, compile for the AI Thinker ESP32-CAM, upload, then check the car comes back on Wi-Fi with
// the new version. Used by the robot_firmware tool and Settings → Devices & robots → "Update car firmware".
'use strict';
const fs = require('fs');
const path = require('path');

const SKETCH = 'carpathron_car';
const FQBN = 'esp32:esp32:esp32cam:PartitionScheme=min_spiffs'; // AI Thinker ESP32-CAM (PSRAM on) with two 1.9 MB app slots, so it can be updated over Wi-Fi and undone
const FQBN_BOARD = 'esp32:esp32:esp32cam';
const USB_VIDS = { '0x1A86': 'CH340', '0x10C4': 'CP210x', '0x0403': 'FTDI', '0x303A': 'ESP32 USB' };

// The firmware folder that came with the app (packaged) or with the source code (development).
function bundledDir() {
  const cands = [];
  if (process.resourcesPath) cands.push(path.join(process.resourcesPath, 'firmware', SKETCH));
  cands.push(path.join(__dirname, '..', '..', '..', 'firmware', SKETCH));
  return cands.find((d) => fs.existsSync(path.join(d, `${SKETCH}.ino`))) || null;
}
const versionOf = (text) => { const m = String(text || '').match(/#define\s+FW_VERSION\s+"([^"]+)"/); return m ? m[1] : null; };
const installDir = (settings) => path.join(settings.workspace, 'firmware', SKETCH);
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

// Copy the bundled sketch into the workspace. A different existing copy goes to firmware/backup-<time>/ first.
function prepare(settings) {
  const src = bundledDir();
  if (!src) throw new Error('The car firmware is not included in this installation.');
  const dst = installDir(settings);
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile());
  let backup = null;
  if (fs.existsSync(dst)) {
    const same = files.every((f) => fs.existsSync(path.join(dst, f)) && fs.readFileSync(path.join(dst, f)).equals(fs.readFileSync(path.join(src, f))));
    if (!same) {
      backup = path.join(settings.workspace, 'firmware', `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.renameSync(dst, backup);
    }
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return { dir: dst, version: versionOf(fs.readFileSync(path.join(dst, `${SKETCH}.ino`), 'utf8')), backup };
}

// The car's USB serial port from `arduino-cli board list --format json` output: a USB-serial chip (CH340 on the kit).
function pickPort(listJson) {
  let j; try { j = JSON.parse(listJson); } catch { return null; }
  const ports = (j.detected_ports || j.ports || (Array.isArray(j) ? j : [])).map((p) => p.port || p);
  const serial = ports.filter((p) => /serial/i.test(p.protocol || '') || /^COM\d+|ttyUSB|ttyACM|cu\./.test(p.address || ''));
  const known = serial.find((p) => p.properties && Object.keys(USB_VIDS).includes(String(p.properties.vid || '').toUpperCase().replace(/^0X/, '0x')));
  const usb = known || serial.find((p) => p.properties && p.properties.vid) || null;
  return usb ? { address: usb.address, chip: usb.properties && USB_VIDS[String(usb.properties.vid).toUpperCase().replace(/^0X/, '0x')] || 'USB serial' } : null;
}

// Wi-Fi updates: a random key made on this PC, compiled into the car (ota_key.h next to the sketch, never in git).
// Only firmware sent with this key is accepted by the car.
function otaKey(dataDir) {
  const f = path.join(dataDir, 'car-ota-key');
  try { const k = fs.readFileSync(f, 'utf8').trim(); if (/^[a-f0-9]{32}$/.test(k)) return k; } catch {}
  const k = require('crypto').randomBytes(16).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, k, { mode: 0o600 });
  return k;
}
function writeKey(sketchDir, key) {
  fs.writeFileSync(path.join(sketchDir, 'ota_key.h'), `// Made by Muse Carpathron: the key this PC uses to update the car over Wi-Fi. Do not share or commit.\n#define OTA_KEY "${key}"\n`);
}
// Built firmware files, newest last: <dataDir>/firmware-builds/<version>-<time>/carpathron_car.ino.bin
const buildsDir = (dataDir) => path.join(dataDir, 'firmware-builds');
function listBuilds(dataDir) {
  const d = buildsDir(dataDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).map((n) => {
    const bin = path.join(d, n, `${SKETCH}.ino.bin`);
    if (!fs.existsSync(bin)) return null;
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(d, n, 'build.json'), 'utf8')); } catch {}
    return { name: n, bin, size: fs.statSync(bin).size, version: meta.version || n.split('-')[0], at: meta.at || fs.statSync(bin).mtime.toISOString(), source: meta.source || '' };
  }).filter(Boolean).sort((a, b) => a.at.localeCompare(b.at));
}
function newBuildDir(dataDir, version) {
  const d = path.join(buildsDir(dataDir), `${version || 'custom'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  fs.mkdirSync(d, { recursive: true });
  // keep the last 8 builds
  const all = listBuilds(dataDir);
  for (const b of all.slice(0, Math.max(0, all.length - 8))) try { fs.rmSync(path.dirname(b.bin), { recursive: true, force: true }); } catch {}
  return d;
}
// Send a firmware file to the car over Wi-Fi. → { ok, error }
function sendOta(host, binPath, key, { timeoutMs = 120000, onProgress } = {}) {
  const http = require('http');
  return new Promise((resolve) => {
    const [h, port] = String(host).split(':');
    const size = fs.statSync(binPath).size;
    const req = http.request({ host: h, port: Number(port) || 80, path: '/ota', method: 'POST', timeout: timeoutMs, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'X-OTA-Key': key } }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(body); } catch {} resolve(j || { ok: res.statusCode < 300, error: body.slice(0, 200) }); });
    });
    req.on('timeout', () => req.destroy(new Error('the car stopped answering during the upload')));
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    let sent = 0;
    const rs = fs.createReadStream(binPath, { highWaterMark: 16384 });
    rs.on('data', (c) => { sent += c.length; if (onProgress) onProgress(Math.round((sent * 100) / size)); });
    rs.pipe(req);
  });
}
async function otaInfo(host, timeoutMs = 3000) {
  const r = await fetch(`http://${host}/ota`, { signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 404) return { ota: false, older: true };
  return r.json();
}
async function rollback(host, key) {
  const r = await fetch(`http://${host}/ota?rollback=1`, { headers: { 'X-OTA-Key': key }, signal: AbortSignal.timeout(4000) }).catch((e) => ({ ok: false, json: async () => ({ ok: false, error: e.message }) }));
  return r.json().catch(() => ({ ok: false, error: 'no answer' }));
}

module.exports = { SKETCH, FQBN, FQBN_BOARD, otaKey, writeKey, buildsDir, listBuilds, newBuildDir, sendOta, otaInfo, rollback, bundledDir, versionOf, installDir, prepare, pickPort, cmpVersion };
