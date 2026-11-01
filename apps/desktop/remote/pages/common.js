// Carpathron Remote — shared protocol code for the host and viewer pages (browser side, WebCrypto only).
//
// Session protocol, after the relay has paired a viewer with a host (all JSON until "secure"):
//   host   → hello { v, name, nh, so, sp }        nh = host nonce, so = salt of the one-time password,
//                                                  sp = salt of the personal (unattended) password or null
//   viewer → auth  { nv, name, pc, po, pp }       po/pp = HMAC(PBKDF2(password, salt), "viewer"|nh|nv) for each salt
//   host   → ok    { p, how }   or  denied { reason }
//                                                  p = HMAC(key, "host"|nh|nv): the viewer checks the host knows the
//                                                  password too (a fake relay cannot pretend to be the host)
//   then both sides switch to AES-256-GCM with keys from HKDF(key, nh|nv), one key per direction, a counter as IV
//   (messages that repeat or go back in order are dropped). Binary layout: [type 1 byte][counter 8 bytes][ciphertext].
'use strict';
(function () {
  const enc = new TextEncoder(); const dec = new TextDecoder();
  const b64 = (u8) => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(String(s || '')), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const ITER = 150000;
  const OTP_ABC = 'abcdefghijkmnpqrstuvwxyz23456789';

  async function derive(password, saltB64) {
    const base = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: ITER }, base, 256));
  }
  async function hmac(keyBytes, text) {
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64(await crypto.subtle.sign('HMAC', k, enc.encode(text)));
  }
  function same(a, b) { // constant-time compare of two base64 strings
    a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false;
    let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
  }
  async function sessionKeys(keyBytes, nh, nv, role) {
    const base = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveKey']);
    const mk = (info) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(nh + '|' + nv), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const h2v = await mk('carpathron-rd h2v'); const v2h = await mk('carpathron-rd v2h');
    return role === 'host' ? { send: h2v, recv: v2h } : { send: v2h, recv: h2v };
  }
  function otp() { const r = rand(8); let s = ''; for (const x of r) s += OTP_ABC[x % OTP_ABC.length]; return s; }

  // A message channel over a relay WebSocket: plain JSON until secure(), then encrypted JSON + binary frames.
  class Channel {
    constructor(ws) {
      this.ws = ws; ws.binaryType = 'arraybuffer';
      this.keys = null; this.sc = 0n; this.rc = -1n; this.q = Promise.resolve(); this.early = [];
      this.onjson = () => {}; this.onbinary = () => {}; this.onclose = () => {};
      ws.onmessage = (e) => { this.q = this.q.then(() => this._in(e.data)).catch((err) => console.warn('rd in', err)); };
      ws.onclose = (e) => this.onclose(e);
      ws.onerror = () => {};
    }
    get open() { return this.ws.readyState === 1; }
    secure(keys) { this.keys = keys; const e = this.early; this.early = []; for (const d of e) this.q = this.q.then(() => this._in(d)).catch(() => {}); }
    async _in(data) {
      if (!this.keys) { if (typeof data === 'string') { let m; try { m = JSON.parse(data); } catch { return; } this.onjson(m); } else if (this.early.length < 64) this.early.push(data); return; }
      if (typeof data === 'string') return; // plain text after the switch is ignored
      const u = new Uint8Array(data); if (u.length < 10) return;
      const ctr = new DataView(u.buffer, u.byteOffset + 1, 8).getBigUint64(0);
      if (ctr <= this.rc) return; // replay or out of order
      const iv = new Uint8Array(12); iv.set(u.subarray(1, 9), 4);
      let plain; try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.keys.recv, u.subarray(9))); } catch { return; }
      this.rc = ctr;
      if (u[0] === 1) { let m; try { m = JSON.parse(dec.decode(plain)); } catch { return; } this.onjson(m); }
      else if (u[0] === 2) this.onbinary(plain);
    }
    async _out(type, bytes) {
      const ctr = this.sc; this.sc += 1n;
      const iv = new Uint8Array(12); new DataView(iv.buffer).setBigUint64(4, ctr);
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.keys.send, bytes));
      const out = new Uint8Array(9 + ct.length); out[0] = type; out.set(iv.subarray(4), 1); out.set(ct, 9);
      if (this.open) this.ws.send(out);
    }
    send(obj) {
      if (!this.keys) { if (this.open) this.ws.send(JSON.stringify(obj)); return Promise.resolve(); }
      return (this.q2 = (this.q2 || Promise.resolve()).then(() => this._out(1, enc.encode(JSON.stringify(obj)))));
    }
    sendBinary(u8) { return (this.q2 = (this.q2 || Promise.resolve()).then(() => this._out(2, u8))); }
    get buffered() { return this.ws.bufferedAmount; }
    close(code, why) { try { this.ws.close(code || 1000, why || 'bye'); } catch {} }
  }

  // ---------------------------------------------------------------- file transfer (both directions, inside the session)
  //   sender → f-start { id, name, size }, f-data { id, i, d (base64, 48 KB) } …, f-end { id }      (or f-cancel)
  //   receiver → f-ack { id, i } for every chunk (at most 12 chunks in flight), f-done { id, ok }
  // The app saves received files in Downloads\Carpathron Remote (never overwriting: "name (1).ext").
  const CHUNK = 48 * 1024;
  class Transfers {
    constructor(send, rd, onEvent) { this.send = send; this.rd = rd; this.on = onEvent || (() => {}); this.out = new Map(); this.inc = new Map(); }
    // fileInfo = { fid, name, size } from rd.fileFromDrop()
    async sendFile(f) {
      const id = b64(rand(9)); const t = { id, name: f.name, size: f.size, sent: 0, acked: 0, cancel: false, waiters: [] };
      this.out.set(id, t); this.on({ t: 'out-start', id, name: f.name, size: f.size });
      try {
        await this.send({ t: 'f-start', id, name: f.name, size: f.size });
        let i = 0;
        for (let off = 0; off < f.size; off += CHUNK) {
          while (i - t.acked >= 12 && !t.cancel) await new Promise((r) => t.waiters.push(r));
          if (t.cancel) throw new Error('cancelled');
          const bytes = await this.rd.fileRead(f.fid, off, Math.min(CHUNK, f.size - off));
          await this.send({ t: 'f-data', id, i, d: b64(bytes) }); i += 1; t.sent = Math.min(f.size, off + CHUNK);
          this.on({ t: 'out-progress', id, done: t.sent, size: f.size });
        }
        while (t.acked < i && !t.cancel) await new Promise((r) => t.waiters.push(r));
        if (t.cancel) throw new Error('cancelled');
        await this.send({ t: 'f-end', id });
        const ok = await new Promise((r) => { t.done = r; setTimeout(() => r(null), 60000); });
        this.on({ t: 'out-done', id, ok: ok !== false });
      } catch (e) {
        if (!t.remoteCancel) this.send({ t: 'f-cancel', id }).catch(() => {});
        this.on({ t: 'out-done', id, ok: false, error: String(e.message || e) });
      } finally { this.rd.fileClose(f.fid).catch(() => {}); this.out.delete(id); }
    }
    cancel(id) { const t = this.out.get(id); if (t) { t.cancel = true; t.waiters.splice(0).forEach((r) => r()); } const r = this.inc.get(id); if (r) { this.send({ t: 'f-cancel', id }).catch(() => {}); this._drop(id, 'cancelled'); } }
    cancelAll() { for (const id of [...this.out.keys(), ...this.inc.keys()]) this.cancel(id); }
    // returns true when the message was a file message
    handle(m) {
      if (!m || typeof m.t !== 'string' || !m.t.startsWith('f-')) return false;
      const t = this.out.get(m.id);
      if (m.t === 'f-ack' && t) { t.acked = Math.max(t.acked, m.i + 1); t.waiters.splice(0).forEach((r) => r()); return true; }
      if (m.t === 'f-done' && t && t.done) { t.done(!!m.ok); return true; }
      if (m.t === 'f-cancel') { if (t) { t.remoteCancel = true; t.cancel = true; t.waiters.splice(0).forEach((r) => r()); } if (this.inc.has(m.id)) this._drop(m.id, 'cancelled by the other side'); return true; }
      if (m.t === 'f-start') {
        const name = String(m.name || 'file').slice(0, 200); const size = Math.max(0, Number(m.size) || 0);
        const r = { name, size, got: 0, q: Promise.resolve(), rid: null };
        this.inc.set(m.id, r); this.on({ t: 'in-start', id: m.id, name, size });
        r.q = r.q.then(async () => { r.rid = await this.rd.recvStart(name, size, 'file'); }).catch((e) => this._drop(m.id, e.message || e));
        return true;
      }
      const r = this.inc.get(m.id); if (!r) return true;
      if (m.t === 'f-data') {
        r.q = r.q.then(async () => {
          if (!this.inc.has(m.id)) return;
          const bytes = unb64(m.d); await this.rd.recvChunk(r.rid, bytes); r.got += bytes.length;
          await this.send({ t: 'f-ack', id: m.id, i: m.i }); this.on({ t: 'in-progress', id: m.id, done: r.got, size: r.size });
        }).catch((e) => this._drop(m.id, e.message || e));
      } else if (m.t === 'f-end') {
        r.q = r.q.then(async () => {
          if (!this.inc.has(m.id)) return;
          const res = await this.rd.recvEnd(r.rid, true); this.inc.delete(m.id);
          await this.send({ t: 'f-done', id: m.id, ok: true }); this.on({ t: 'in-done', id: m.id, ok: true, path: res.path, name: res.name });
        }).catch((e) => this._drop(m.id, e.message || e));
      }
      return true;
    }
    _drop(id, why) {
      const r = this.inc.get(id); if (!r) return; this.inc.delete(id);
      r.q.then(() => r.rid && this.rd.recvEnd(r.rid, false)).catch(() => {});
      this.send({ t: 'f-done', id, ok: false }).catch(() => {});
      this.on({ t: 'in-done', id, ok: false, error: String(why) });
    }
  }

  // ---------------------------------------------------------------- voice call (16 kHz mono PCM inside the encrypted session)
  //   call { } invite · call-join { } · call-end { } · au { d: base64 Int16 } (only while both are in the call)
  class Voice {
    constructor(send) { this.send = send; this.mic = null; this.ctx = null; this.proc = null; this.muted = false; this.play = null; this.next = 0; this.level = 0; this.rx = 0; this.tx = 0; }
    get on() { return !!this.mic; }
    async start() {
      if (this.mic) return;
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      this.ctx = new AudioContext({ sampleRate: 16000 });
      const src = this.ctx.createMediaStreamSource(this.mic);
      this.proc = this.ctx.createScriptProcessor(1024, 1, 1);
      const sink = this.ctx.createGain(); sink.gain.value = 0;
      this.proc.onaudioprocess = (e) => {
        if (!this.mic || this.muted) return;
        const f = e.inputBuffer.getChannelData(0); const s = new Int16Array(f.length); let peak = 0;
        for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); s[i] = v * 0x7fff; peak = Math.max(peak, Math.abs(v)); }
        this.level = peak; this.tx += 1;
        this.send({ t: 'au', d: b64(new Uint8Array(s.buffer)) }).catch(() => {});
      };
      src.connect(this.proc); this.proc.connect(sink); sink.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    }
    stop() {
      try { this.mic && this.mic.getTracks().forEach((t) => t.stop()); } catch {}
      try { this.proc && (this.proc.onaudioprocess = null); } catch {}
      try { this.ctx && this.ctx.close(); } catch {}
      try { this.play && this.play.close(); } catch {}
      this.mic = null; this.ctx = null; this.proc = null; this.play = null; this.next = 0;
    }
    // play what the other side says (a small jitter buffer; if it falls behind more than 0.6 s it skips ahead)
    hear(d) {
      try {
        if (!this.play) { this.play = new AudioContext({ sampleRate: 16000 }); this.next = 0; }
        const u = unb64(d); const s = new Int16Array(u.buffer, u.byteOffset, u.byteLength >> 1);
        const buf = this.play.createBuffer(1, s.length, 16000); const ch = buf.getChannelData(0);
        for (let i = 0; i < s.length; i++) ch[i] = s[i] / 0x8000;
        const src = this.play.createBufferSource(); src.buffer = buf; src.connect(this.play.destination);
        const now = this.play.currentTime;
        if (this.next < now + 0.03 || this.next > now + 0.6) this.next = now + 0.12;
        src.start(this.next); this.next += buf.duration; this.rx += 1;
      } catch {}
    }
  }

  const fmtSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const fmtId = (id) => String(id || '').replace(/\D/g, '').replace(/(\d{3})(?=\d)/g, '$1 ').trim();
  const relayUrl = (base) => { let u = String(base || '').trim().replace(/\/+$/, ''); if (!/\/rd(\/ws)?$/.test(u)) u += '/rd'; if (!/\/ws$/.test(u)) u += '/ws'; return u; };

  window.RD = { b64, unb64, rand, derive, hmac, same, sessionKeys, otp, Channel, Transfers, Voice, fmtId, fmtSize, relayUrl, ITER };
})();
