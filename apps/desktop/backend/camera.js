// Robot camera: takes a JPEG photo from
//  1) a snapshot URL (ESP32-CAM: http://<ip>/capture, or any IP-camera / phone camera app snapshot URL), or
//  2) the PC webcam, captured by the open Muse Carpathron window.
// Photos are saved in <workspace>/photos.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Camera {
  constructor({ getSettings, emit, log }) {
    this.getSettings = getSettings;
    this.emit = emit;
    this.log = log;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.hasWindow = () => false; // set by the server: is a desktop window connected?
  }

  folder() {
    const dir = path.join(this.getSettings().workspace, 'photos');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async capture() {
    const r = this.getSettings().robot || {};
    const carIp = String(r.carIp || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const url = String(r.cameraUrl || '').trim() || (carIp && this.carHasCamera && this.carHasCamera() ? `http://${carIp}/capture` : '');
    let buffer, source;
    if (url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) }).catch((e) => { throw new Error(`Camera at ${url} is not reachable (${e.cause?.code || e.message}).`); });
      if (!res.ok) throw new Error(`Camera at ${url} answered HTTP ${res.status}.`);
      buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 200 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error(`Camera at ${url} did not return a JPEG photo. For ESP32-CAM use http://<car-ip>/capture`);
      source = 'robot camera';
    } else {
      if (!this.hasWindow()) throw new Error('No camera: set the robot camera URL in Robot settings, or open Muse Carpathron on a phone and tick "Use this device\'s camera".');
      const c = this.pickClient ? this.pickClient() : null;
      buffer = await this.fromWindow();
      source = c && c.offersCamera ? 'phone camera' : 'PC webcam';
    }
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(this.folder(), `photo-${stamp}.jpg`);
    fs.writeFileSync(file, buffer);
    this.log(`Photo saved (${source}): ${file}`);
    this.emit('camera:photo', { path: file, source, ts: Date.now() });
    return { path: file, buffer, source };
  }

  fromWindow() {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The camera did not answer in time (is the camera page open and allowed?).')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      if (this.sendRequest) this.sendRequest({ id }); else this.emit('camera:request', { id });
    });
  }

  // Called by the window with the captured frame (or an error).
  answer(id, { dataBase64, error }) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(/not found|NotFound/i.test(error) ? 'No webcam found on this PC. Use a phone as the robot camera (open Muse Carpathron on the phone → Robot → "Use this device\'s camera"), or set an ESP32-CAM URL.' : `Camera: ${error}`));
    else p.resolve(Buffer.from(String(dataBase64 || ''), 'base64'));
    return true;
  }
}

module.exports = { Camera };
