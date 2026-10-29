// Encrypts saved passwords and keys (SSH servers). Inside the desktop app Windows DPAPI is used through
// Electron safeStorage (tied to your Windows account); the stand-alone server falls back to AES-256-GCM with
// a random key kept next to the data.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Secrets {
  constructor(dataDir) {
    this.keyFile = path.join(dataDir, 'secret.key');
    this.safe = null;
    try {
      const { safeStorage } = require('electron');
      if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) this.safe = safeStorage;
    } catch {}
  }

  _key() {
    if (this.key) return this.key;
    try { this.key = Buffer.from(fs.readFileSync(this.keyFile, 'utf8').trim(), 'base64'); } catch {}
    if (!this.key || this.key.length !== 32) {
      this.key = crypto.randomBytes(32);
      fs.writeFileSync(this.keyFile, this.key.toString('base64'), { mode: 0o600 });
    }
    return this.key;
  }

  encrypt(text) {
    if (text === undefined || text === null || text === '') return '';
    const s = String(text);
    if (this.safe) return `dpapi:${this.safe.encryptString(s).toString('base64')}`;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this._key(), iv);
    const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return `aes:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
  }

  decrypt(blob) {
    if (!blob) return '';
    const s = String(blob);
    if (s.startsWith('dpapi:')) {
      if (!this.safe) throw new Error('This secret was saved by the desktop app and can only be read there.');
      return this.safe.decryptString(Buffer.from(s.slice(6), 'base64'));
    }
    if (s.startsWith('aes:')) {
      const b = Buffer.from(s.slice(4), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', this._key(), b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    }
    return s; // legacy plain text
  }
}

module.exports = { Secrets };
