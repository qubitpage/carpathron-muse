// Robot firmware: the app ships the Baby Carpathron car firmware (repo folder firmware/, packaged as resources/firmware)
// and can put it on the car by itself: copy the sketch into the workspace (the previous copy is kept as a backup),
// find the car's USB port, compile for the AI Thinker ESP32-CAM, upload, then check the car comes back on Wi-Fi with
// the new version. Used by the robot_firmware tool and Settings → Devices & robots → "Update car firmware".
'use strict';
const fs = require('fs');
const path = require('path');

const SKETCH = 'carpathron_car';
const FQBN = 'esp32:esp32:esp32cam'; // AI Thinker ESP32-CAM (PSRAM on); the kit's ESP32-CAM board
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

module.exports = { SKETCH, FQBN, bundledDir, versionOf, installDir, prepare, pickPort, cmpVersion };
