// Carpathron Remote — host page (hidden window): keeps this PC registered at the relay and serves sessions.
'use strict';
(function () {
  const { RD } = window; const rd = window.rd;
  let cfg = null; let ctl = null; let retry = 1000; let ice = [{ urls: ['stun:stun.l.google.com:19302'] }]; let stopping = false;
  const sessions = new Map();
  window.__rdHost = sessions; // for the automated tests
  const panel = (ev) => rd.panelEvent(ev).catch(() => {});
  let lastClip = null;
  // clipboard sync: what is copied on this computer goes to the viewers (they paste it there), and the other way
  setInterval(async () => {
    if (!cfg || !cfg.clipSync) return;
    const live = [...sessions.values()].filter((s) => s.ch && s.ch.keys && !s.ended); if (!live.length) return;
    const t = await rd.clipRead().catch(() => null); if (t == null) return;
    if (lastClip === null) { lastClip = t; return; }
    if (t && t !== lastClip) { lastClip = t; for (const s of live) s.ch.send({ t: 'clip', s: t }); }
  }, 1500);
  setInterval(() => { const v = [...sessions.values()].find((x) => x.voice && x.voice.on); if (v) panel({ t: 'level', v: v.voice.muted ? 0 : v.voice.level }); }, 200);
  // commands from the session panel (chat, call, files, let them control)
  rd.onPanelCmd(async (cmd) => {
    const list = [...sessions.values()].filter((s) => s.ch && s.ch.keys && !s.ended && (!cmd.sid || cmd.sid === s.sid));
    if (!list.length) return;
    if (cmd.t === 'chat') { const text = String(cmd.text || '').slice(0, 4000); if (!text) return; for (const s of list) s.ch.send({ t: 'chat', text }); panel({ t: 'chat', me: true, from: 'You', text }); }
    else if (cmd.t === 'file') list[0].tr.sendFile(cmd.file);
    else if (cmd.t === 'cancel') for (const s of list) s.tr.cancel(cmd.id);
    else if (cmd.t === 'call') for (const s of list) s.startCall().catch((e) => panel({ t: 'call-error', sid: s.sid, error: String(e.message || e) }));
    else if (cmd.t === 'join') for (const s of list) s.joinCall().catch((e) => panel({ t: 'call-error', sid: s.sid, error: String(e.message || e) }));
    else if (cmd.t === 'hangup') for (const s of list) s.endCall(true);
    else if (cmd.t === 'mute') { for (const s of list) if (s.voice) s.voice.muted = !!cmd.on; }
    else if (cmd.t === 'control') { for (const s of list) s.setControl(!!cmd.on); }
    else if (cmd.t === 'cmd-revoke') { for (const s of list) s.revokeCmd(); }
    else if (cmd.t === 'ai-stop') { for (const s of list) if (s.ai) { s.ch.send({ t: 'ai-stop' }); panel({ t: 'info', sid: s.sid, text: 'You stopped the AI technician.' }); } }
  });
  // output of commands run for a technician: batched, then sent through the encrypted session
  rd.onRunEv((rid, kind, d) => {
    const sid = rid.split(':')[0]; const s = sessions.get(sid); if (!s) return;
    const id = rid.slice(sid.length + 1); const job = s.runs.get(id); if (!job) return;
    if (kind === 'out') { job.buf += d; if (!job.t) job.t = setTimeout(() => s.flushRun(id), 250); }
    else if (kind === 'end') { s.flushRun(id); s.runs.delete(id); s.ch.send({ t: 'run-end', id, code: d.code, ms: d.ms, timedOut: !!d.timedOut, truncated: !!d.truncated }); panel({ t: 'cmd-end', sid, id, code: d.code }); }
  });
  const status = (state, extra) => rd.hostStatus(Object.assign({ state }, extra || {})).catch(() => {});

  // ------------------------------------------------------------ relay registration (one control socket)
  async function connect() {
    cfg = await rd.hostConfig();
    if (ctl) { try { ctl.onclose = null; ctl.close(); } catch {} }
    status('connecting');
    let ws; try { ws = new WebSocket(RD.relayUrl(cfg.relay)); } catch (e) { status('error', { error: 'bad-relay' }); return later(); }
    ctl = ws;
    // a connection that hangs (server down, proxy waiting) is dropped after 20 s and tried again
    const hang = setTimeout(() => { if (ctl === ws && !ws.registered) { try { ws.close(); } catch {} if (ctl === ws) { ctl = null; status('offline'); later(); } } }, 20000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'register', id: cfg.id || undefined, key: cfg.key, name: cfg.name }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'registered') { ws.registered = true; clearTimeout(hang); retry = 1000; if (m.ice && m.ice.length) ice = m.ice; status('ready', { id: m.id }); }
      else if (m.t === 'incoming') startSession(m.sid);
      else if (m.t === 'ice' && m.ice) ice = m.ice;
      else if (m.t === 'error') { status('error', { error: m.code }); if (m.code === 'id-taken') cfg.id = ''; }
    };
    ws.onclose = () => { if (ctl === ws) { ctl = null; if (!stopping) { status('offline'); later(); } } };
    ws.onerror = () => {};
  }
  let laterTimer = null;
  function later() { clearTimeout(laterTimer); laterTimer = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); }
  setInterval(() => { if (ctl && ctl.readyState === 1) ctl.send(JSON.stringify({ t: 'ice' })); }, 6 * 3600 * 1000);
  rd.onConfig(() => { retry = 1000; connect(); });
  rd.onCtlNote((text) => { for (const s of sessions.values()) if (s.how && s.ch) s.ch.send({ t: 'chat', text: '⚠ ' + String(text) }).catch(() => {}); });
  rd.onKill((sid) => { for (const [id, s] of sessions) if (sid === '*' || sid === id) s.end('The host ended the session.'); });

  // ------------------------------------------------------------ one viewer session
  function startSession(sid) {
    const s = new HostSession(sid); sessions.set(sid, s); s.run().catch((e) => s.end(String(e && e.message || e)));
  }

  class HostSession {
    constructor(sid) { this.sid = sid; this.ch = null; this.pc = null; this.dc = null; this.stream = null; this.screen = 0; this.mode = ''; this.name = 'Viewer'; this.ended = false; this.authed = false; this.jpegQ = 0.7; this.frameW = 1600; this.control = true; this.call = ''; this.tr = null; this.voice = null; this.cmd = 'none'; this.runs = new Map(); this.ai = false; }
    async run() {
      this.locked = await rd.locked();
      cfg = await rd.hostConfig(); // latest one-time password and settings
      this.nh = RD.b64(RD.rand(16));
      const ws = new WebSocket(RD.relayUrl(cfg.relay));
      this.ch = new RD.Channel(ws);
      this.ch.onclose = () => this.end();
      this.ch.onjson = (m) => this.onPlain(m).catch((e) => this.end(String(e.message || e)));
      await new Promise((res, rej) => { ws.onopen = res; setTimeout(() => rej(new Error('relay timeout')), 15000); });
      ws.send(JSON.stringify({ t: 'join', sid: this.sid, id: cfg.id, key: cfg.key }));
    }
    async onPlain(m) {
      if (m.t === 'paired') {
        // free (personal use) session: the host ends it on time too, so a direct WebRTC link cannot outlive it
        if (m.limit > 0) this.limitTimer = setTimeout(() => this.end(m.daily ? 'The free daily limit (2 hours) was reached.' : 'The free 20-minute session ended.'), m.limit + 3000);
        if (this.locked && this.locked > Date.now()) { await this.ch.send({ t: 'denied', reason: 'locked', until: this.locked }); return this.end(); }
        return this.ch.send({ t: 'hello', v: 1, name: cfg.name, nh: this.nh, so: cfg.otpSalt, sp: cfg.perm ? cfg.perm.salt : null, sr: (cfg.resumes || []).map((r) => r.salt).concat((cfg.trusted || []).map((t) => t.salt)) });
      }
      if (m.t !== 'auth' || this.authed) return;
      this.authed = true;
      this.name = String(m.name || 'Viewer').slice(0, 60);
      const nv = String(m.nv || '');
      let key = null; let how = '';
      if (cfg.otp && m.po) { const k = await RD.derive(cfg.otp, cfg.otpSalt); if (RD.same(await RD.hmac(k, 'viewer|' + this.nh + '|' + nv), m.po)) { key = k; how = 'one-time password'; } }
      if (!key && cfg.perm && m.pp) { const k = RD.unb64(cfg.perm.k); if (RD.same(await RD.hmac(k, 'viewer|' + this.nh + '|' + nv), m.pp)) { key = k; how = 'personal password'; } }
      let resumed = null; // a viewer coming back after a lost connection / a restart, with its reconnect key
      let trustedBy = null; // a computer the person here chose to always trust
      if (!key && m.pr && m.rs) { const t = (cfg.trusted || []).find((x) => x.salt === m.rs); if (t && RD.same(await RD.hmac(RD.unb64(t.k), 'viewer|' + this.nh + '|' + nv), m.pr)) { key = RD.unb64(t.k); how = 'trusted computer'; trustedBy = t; rd.trustUsed(t.salt).catch(() => {}); } }
      if (!key && m.pr && m.rs) { const r = (cfg.resumes || []).find((x) => x.salt === m.rs); if (r) { const k = RD.unb64(r.k); if (RD.same(await RD.hmac(k, 'viewer|' + this.nh + '|' + nv), m.pr)) { key = k; how = r.how || 'reconnect'; resumed = r; } } }
      if (!key) { const r = await rd.authResult(false); await this.ch.send({ t: 'denied', reason: r.locked ? 'locked' : 'password', until: r.locked || 0 }); return this.end(); }
      if (resumed) rd.resumeUse(resumed.salt).catch(() => {}); // one use only: a new key comes with this session
      if (how === 'personal password' && !cfg.unattended && !resumed && !trustedBy) { await this.ch.send({ t: 'denied', reason: 'unattended-off' }); return this.end(); }
      this.control = !cfg.viewOnly; // presentation mode: everyone who connects can only watch
      if (resumed) this.control = this.control && resumed.control !== false;
      let trustNew = false;
      if (how === 'one-time password' && !resumed) {
        const ok = await rd.consent({ name: this.name, pc: m.pc });
        if (!ok) { await this.ch.send({ t: 'denied', reason: 'declined' }); return this.end(); }
        if (ok === 'view') this.control = false;
        if (ok === 'trust') trustNew = true;
      }
      await rd.authResult(true);
      this.how = how;
      const proof = await RD.hmac(key, 'host|' + this.nh + '|' + nv);
      await this.ch.send({ t: 'ok', p: proof, how });
      this.ch.secure(await RD.sessionKeys(key, this.nh, nv, 'host'));
      this.ch.onjson = (q) => this.onMsg(q);
      this.ch.onbinary = () => {};
      const send = (o) => this.ch.send(o);
      this.tr = new RD.Transfers(send, rd, (ev) => panel(Object.assign({ sid: this.sid, who: this.name }, ev)));
      this.voice = new RD.Voice(send);
      if (lastClip === null) lastClip = await rd.clipRead().catch(() => '');
      await rd.session(this.sid, { name: this.name, how, mode: 'starting', screen: 0, control: this.control });
      await this.ch.send({ t: 'perm', control: this.control });
      { // the reconnect key for this session (only the viewer gets it, inside the encrypted channel)
        const tok = RD.b64(RD.rand(24)), salt = RD.b64(RD.rand(16)), rk = await RD.derive(tok, salt);
        await rd.resumeAdd({ sid: this.sid, salt, key: RD.b64(rk), name: this.name, how, control: this.control });
        await this.ch.send({ t: 'resume', tok, salt });
      }
      if (resumed) panel({ t: 'info', sid: this.sid, who: this.name, text: `${this.name} reconnected.` });
      if (trustNew) { // a permanent key for that viewer: next time no password and no question
        const tok = RD.b64(RD.rand(32)), salt = RD.b64(RD.rand(16)), tk = await RD.derive(tok, salt);
        await rd.trustAdd({ salt, key: RD.b64(tk), name: this.name, pc: String(m.pc || '') });
        await this.ch.send({ t: 'trust', tok, salt });
      }
      panel({ t: 'info', sid: this.sid, who: this.name, text: `${this.name} connected (${this.control ? 'can control' : 'view only'}).` });
      await this.startMedia();
    }
    async capture(index) {
      const src = await rd.source(index);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.sourceId, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } } });
      const t = stream.getVideoTracks()[0]; try { t.contentHint = 'detail'; } catch {}
      t.onended = () => { if (!this.ended && this.stream === stream) this.recapture('the capture ended'); };
      return stream;
    }
    // Windows can stop a screen capture (display off / on, lock and unlock, sleep, a resolution or graphics driver change):
    // start a new capture and put it into the running connection, so the picture never stays frozen
    async recapture(why) {
      if (this.ended || this.recapturing || !this.stream) return;
      this.recapturing = true; this.lastRecap = Date.now();
      try {
        const old = this.stream; const fresh = await this.capture(this.screen);
        if (this.ended) { fresh.getTracks().forEach((t) => t.stop()); return; }
        this.stream = fresh; this.lastFrames = -1; this.lastFrameAt = Date.now();
        if (this.sender) await this.sender.replaceTrack(fresh.getVideoTracks()[0]);
        if (this.video) { this.video.srcObject = fresh; this.video.play().catch(() => {}); }
        old.getTracks().forEach((t) => { t.onended = null; t.stop(); });
        rd.logLine && rd.logLine(`picture restarted (${why})`);
        this.ch.send({ t: 'refreshed', why }).catch(() => {});
      } catch (e) { rd.logLine && rd.logLine(`picture restart failed (${why}): ${e && e.message}`); }
      finally { this.recapturing = false; }
    }
    // watchdog: the viewer moved the mouse (the cursor is in the picture) but the capture gave no new frame -> restart it
    // the Windows security screen (administrator prompt, sign-in, Ctrl+Alt+Del) cannot be captured normally: while it is up,
    // the picture comes from the helper service (JPEG frames) through a canvas
    setSecure(on) {
      if (this.ended || !this.stream || !!on === !!this.secureOn) return;
      this.secureOn = !!on;
      if (on) {
        if (!this.secCanvas) { this.secCanvas = document.createElement('canvas'); this.secCanvas.width = 1280; this.secCanvas.height = 720; this.secCtx = this.secCanvas.getContext('2d', { alpha: false }); }
        this.secTrack = this.secCanvas.captureStream(8).getVideoTracks()[0];
        if (this.sender) this.sender.replaceTrack(this.secTrack).catch(() => {});
      } else {
        if (this.sender) this.sender.replaceTrack(this.stream.getVideoTracks()[0]).catch(() => {});
        try { this.secTrack && this.secTrack.stop(); } catch {} this.secTrack = null;
      }
    }
    async secureFrame(b64) {
      if (!this.secureOn || !this.secCtx) return;
      try {
        const bmp = await createImageBitmap(new Blob([RD.unb64(b64)], { type: 'image/jpeg' }));
        if (this.secCanvas.width !== bmp.width || this.secCanvas.height !== bmp.height) { this.secCanvas.width = bmp.width; this.secCanvas.height = bmp.height; }
        this.secCtx.drawImage(bmp, 0, 0); bmp.close();
        if (this.secTrack && this.secTrack.requestFrame) this.secTrack.requestFrame();
      } catch {}
    }
    async watch() {
      if (this.ended || !this.stream || this.secureOn) return;
      const t = this.stream.getVideoTracks()[0]; if (!t) return;
      if (t.readyState === 'ended') return this.recapture('the capture ended');
      let n = null;
      try { if (t.stats && typeof t.stats.totalFrames === 'number') n = t.stats.totalFrames; } catch {}
      if (n === null && this.pc) { try { (await this.pc.getStats(t)).forEach((r) => { if (r.type === 'media-source' && typeof r.frames === 'number') n = r.frames; }); } catch {} }
      if (n === null) return;
      const now = Date.now();
      if (n !== this.lastFrames) { this.lastFrames = n; this.lastFrameAt = now; return; }
      if (now - (this.lastIn || 0) < 3000 && now - (this.lastFrameAt || now) > 4000 && now - (this.lastRecap || 0) > 10000) this.recapture('no new picture while the mouse moved');
    }
    async startMedia() {
      this.screens = await rd.screens();
      this.screen = Math.max(0, this.screens.findIndex((d) => d.primary));
      this.stream = await this.capture(this.screen);
      this.watchTimer = setInterval(() => this.watch().catch(() => {}), 1000);
      await rd.session(this.sid, { screen: this.screen });
      await this.ch.send({ t: 'info', screens: this.screens, screen: this.screen, name: cfg.name, sys: await rd.sysinfo().catch(() => null), caps: ['cmd', 'ai'] });
      // WebRTC first (direct, low latency). If no route is found in time, frames go through the relay instead.
      const pc = this.pc = new RTCPeerConnection({ iceServers: ice });
      this.sender = pc.addTrack(this.stream.getVideoTracks()[0], this.stream);
      const dc = this.dc = pc.createDataChannel('ctl', { ordered: true });
      dc.onmessage = (e) => { let q; try { q = JSON.parse(e.data); } catch { return; } this.onMsg(q); };
      pc.onicecandidate = (e) => { if (e.candidate) this.ch.send({ t: 'cand', c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected' && this.mode !== 'direct' && this.mode !== 'relay') { this.mode = 'direct'; clearTimeout(this.fallback); this.applyQuality(); rd.session(this.sid, { mode: 'direct' }); this.ch.send({ t: 'mode', m: 'direct' }); }
        if ((st === 'failed' || st === 'disconnected') && this.mode === 'direct') { this.mode = ''; this.toRelay(); }
      };
      if (cfg.forceRelay) return this.toRelay();
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      await this.ch.send({ t: 'sdp', sdp: pc.localDescription.toJSON() });
      this.fallback = setTimeout(() => { if (this.mode !== 'direct') this.toRelay(); }, 12000);
    }
    applyQuality() {
      if (!this.sender) return;
      const q = this.quality || cfg.quality || 'auto';
      const p = this.sender.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = q === 'high' ? 12000000 : q === 'low' ? 1200000 : 5000000;
      p.encodings[0].maxFramerate = q === 'low' ? 15 : 30;
      p.degradationPreference = 'maintain-resolution';
      this.sender.setParameters(p).catch(() => {});
      this.jpegQ = q === 'high' ? 0.8 : q === 'low' ? 0.5 : 0.65; this.frameW = q === 'high' ? 1920 : q === 'low' ? 1280 : 1600;
    }
    // ---------- relay fallback: JPEG frames through the encrypted relay pipe, one frame in flight at a time
    toRelay() {
      if (this.mode === 'relay' || this.ended) return;
      this.mode = 'relay'; clearTimeout(this.fallback);
      rd.session(this.sid, { mode: 'relay' }); this.ch.send({ t: 'mode', m: 'relay' });
      this.applyQuality();
      try { if (this.pc) this.pc.close(); } catch {} this.pc = null; this.dc = null; this.sender = null;
      this.video = document.createElement('video'); this.video.muted = true; this.video.srcObject = this.stream; this.video.play().catch(() => {});
      this.canvas = document.createElement('canvas'); this.ctx2 = this.canvas.getContext('2d', { alpha: false });
      this.inflight = 0; this.lastHash = ''; this.pump();
    }
    async pump() {
      if (this.ended || this.mode !== 'relay') return;
      const src = this.secureOn && this.secCanvas ? this.secCanvas : this.video;
      const vw = src === this.video ? this.video.videoWidth : src.width, vh = src === this.video ? this.video.videoHeight : src.height;
      if (this.inflight >= 2 || this.ch.buffered > 2e6 || !vw) { setTimeout(() => this.pump(), 15); return; }
      const sc = Math.min(1, this.frameW / vw);
      const w = Math.round(vw * sc), h = Math.round(vh * sc);
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.ctx2.drawImage(src, 0, 0, w, h);
      const blob = await new Promise((r) => this.canvas.toBlob(r, 'image/jpeg', this.jpegQ));
      if (!blob || this.ended) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      this.inflight += 1; await this.ch.sendBinary(bytes);
      setTimeout(() => this.pump(), 30);
    }
    async switchScreen(i) {
      i = Number(i) || 0; if (!this.screens[i] || i === this.screen) return;
      const old = this.stream; this.stream = await this.capture(i); this.screen = i;
      if (this.sender) await this.sender.replaceTrack(this.stream.getVideoTracks()[0]);
      if (this.video) this.video.srcObject = this.stream;
      old.getTracks().forEach((t) => t.stop());
      await rd.session(this.sid, { screen: i });
      this.ch.send({ t: 'info', screens: this.screens, screen: i });
    }
    async onMsg(m) {
      if (this.ended || !m) return;
      switch (m.t) {
        case 'sdp': if (this.pc && m.sdp && m.sdp.type === 'answer') await this.pc.setRemoteDescription(m.sdp).catch(() => {}); break;
        case 'cand': if (this.pc && m.c) await this.pc.addIceCandidate(m.c).catch(() => {}); break;
        case 'in': if (this.control) { rd.input(this.sid, m.e); if (m.e && (m.e.k === 'mm' || m.e.k === 'md')) this.lastIn = Date.now(); } break;
        case 'refresh': this.recapture('asked by the viewer'); break;
        case 'restart': if (this.control) { const r = await rd.restartPc(this.name).catch((e) => ({ ok: false, error: e.message })); this.ch.send({ t: 'restarting', ok: r.ok, autostart: r.autostart, error: r.error || '' }); if (r.ok) panel({ t: 'info', sid: this.sid, who: this.name, text: `${this.name} restarts this computer in a few seconds.` }); } break;
        case 'chat': panel({ t: 'chat', sid: this.sid, from: this.name, text: String(m.text || '').slice(0, 4000) }); break;
        case 'clip': window.__clipIn = (window.__clipIn || 0) + 1; if (cfg.clipSync && typeof m.s === 'string') { lastClip = m.s; rd.clipWrite(m.s).catch(() => {}); } break;
        case 'call': this.call = this.call === 'calling' ? 'on' : 'ringing'; if (this.call === 'on') this.ch.send({ t: 'call-join' }); else panel({ t: 'call', sid: this.sid, from: this.name }); rd.session(this.sid, { call: this.call }); break;
        case 'call-join': if (this.call === 'calling') { this.call = 'on'; panel({ t: 'call-join', sid: this.sid, from: this.name }); rd.session(this.sid, { call: 'on' }); } break;
        case 'call-end': this.endCall(false); break;
        case 'au': if (this.call === 'on') this.voice.hear(m.d); break;
        case 'ack': this.inflight = Math.max(0, this.inflight - 1); break;
        case 'screen': await this.switchScreen(m.i); break;
        case 'quality': this.quality = ['auto', 'high', 'low'].includes(m.q) ? m.q : 'auto'; this.applyQuality(); break;
        case 'relay': this.toRelay(); break;
        case 'ping': if (m.dc && this.dc && this.dc.readyState === 'open') { try { this.dc.send(JSON.stringify({ t: 'pong', ts: m.ts })); } catch {} } else this.ch.send({ t: 'pong', ts: m.ts }); break;
        case 'bye': this.end(); break;
        case 'cmd-req': await this.askCmd(!!m.ai); break;
        case 'run': {
          const id = String(m.id || '').slice(0, 40); if (!id) break;
          if (this.cmd !== 'allowed') { this.ch.send({ t: 'run-end', id, code: -1, error: 'not-allowed' }); break; }
          if (this.runs.size >= 4) { this.ch.send({ t: 'run-end', id, code: -1, error: 'busy' }); break; }
          this.runs.set(id, { buf: '', t: null });
          const script = String(m.script || '').slice(0, 200000);
          panel({ t: 'cmd', sid: this.sid, id, who: this.ai ? `${this.name} (AI)` : this.name, admin: !!m.admin, text: script.slice(0, 2000) });
          rd.run({ rid: this.sid + ':' + id, shell: m.shell, script, admin: !!m.admin, timeout: m.timeout, who: this.name }).catch((e) => { this.runs.delete(id); this.ch.send({ t: 'run-end', id, code: -1, error: String(e.message || e) }); });
          break;
        }
        case 'run-kill': if (this.runs.has(String(m.id))) rd.runKill(this.sid + ':' + String(m.id)); break;
        case 'ai': this.ai = !!m.on; rd.session(this.sid, { ai: this.ai }); panel({ t: 'ai', sid: this.sid, who: this.name, on: this.ai, text: this.ai ? `${this.name} started the AI technician on this computer.` : 'The AI technician stopped.' }); break;
        default: if (this.tr) this.tr.handle(m);
      }
    }
    async startCall() { await this.voice.start(); this.call = 'calling'; await this.ch.send({ t: 'call' }); rd.session(this.sid, { call: 'calling' }); panel({ t: 'call-state', sid: this.sid, state: 'calling' }); }
    async joinCall() { if (this.call !== 'ringing') return; await this.voice.start(); this.call = 'on'; await this.ch.send({ t: 'call-join' }); rd.session(this.sid, { call: 'on' }); panel({ t: 'call-join', sid: this.sid, from: 'You' }); }
    endCall(tell) {
      if (!this.call) return; const was = this.call; this.call = '';
      if (this.voice) this.voice.stop();
      if (tell && this.ch) this.ch.send({ t: 'call-end' }).catch(() => {});
      if (!this.ended) rd.session(this.sid, { call: '' });
      panel({ t: 'call-end', sid: this.sid, from: tell ? 'You' : this.name, was });
    }
    async askCmd(ai) {
      if (this.cmd === 'allowed') return this.ch.send({ t: 'cmd-perm', ok: true });
      if (this.cmd === 'asking') return;
      this.cmd = 'asking';
      const ok = await rd.cmdConsent({ name: this.name, how: this.how, ai }).catch(() => false);
      if (this.ended) return;
      this.cmd = ok ? 'allowed' : 'none';
      rd.session(this.sid, { cmd: !!ok });
      this.ch.send({ t: 'cmd-perm', ok: !!ok, why: ok ? '' : (this.how === 'personal password' ? 'unattended-off' : 'declined') });
      panel({ t: 'info', sid: this.sid, text: ok ? `${this.name} can run commands on this computer. You see each one here.` : `Commands from ${this.name} were not allowed.` });
    }
    flushRun(id) { const j = this.runs.get(id); if (!j) return; clearTimeout(j.t); j.t = null; if (j.buf) { const d = j.buf; j.buf = ''; this.ch.send({ t: 'run-out', id, d }); } }
    revokeCmd() {
      this.cmd = 'none'; for (const id of this.runs.keys()) rd.runKill(this.sid + ':' + id);
      this.ch.send({ t: 'cmd-perm', ok: false, why: 'revoked' }); rd.session(this.sid, { cmd: false });
      panel({ t: 'info', sid: this.sid, text: `Commands from ${this.name} are no longer allowed.` });
    }
    setControl(on) { this.control = !!on; this.ch.send({ t: 'perm', control: this.control }); rd.session(this.sid, { control: this.control }); panel({ t: 'info', sid: this.sid, text: this.control ? `${this.name} can control this computer.` : `${this.name} can only watch now (view only).` }); }
    end(reason) {
      if (this.ended) return; this.ended = true;
      try { this.endCall(false); } catch {} try { this.tr && this.tr.cancelAll(); } catch {}
      clearTimeout(this.fallback); clearTimeout(this.limitTimer); clearInterval(this.watchTimer);
      try { for (const id of this.runs.keys()) rd.runKill(this.sid + ':' + id); } catch {}
      try { if (reason && this.ch && this.ch.keys) this.ch.send({ t: 'bye', reason }); } catch {}
      setTimeout(() => { try { this.ch && this.ch.close(1000, 'end'); } catch {} }, 200);
      try { this.pc && this.pc.close(); } catch {}
      try { this.stream && this.stream.getTracks().forEach((t) => t.stop()); } catch {}
      sessions.delete(this.sid);
      if (this.how) rd.session(this.sid, null).catch(() => {});
    }
  }

  // the system says the picture may be stale (unlocked, woke up, screens changed, security screen closed)
  // tests only: stop the live capture as Windows would (the watchdog must restart it)
  if (rd.isTest) window.__killCapture = () => { for (const s of sessions.values()) if (s.stream) s.stream.getVideoTracks().forEach((t) => t.stop()); };
  if (rd.onHelper) rd.onHelper((m) => {
    if (!m) return;
    for (const s of sessions.values()) { if (!s.authed) continue; if (m.t === 'secure') s.setSecure(m.on); else if (m.t === 'frame') s.secureFrame(m.b64); }
  });
  if (rd.onRecapture) rd.onRecapture((why) => { for (const s of sessions.values()) if (s.authed && s.stream) setTimeout(() => s.recapture(why || 'system'), 800); });

  connect();
})();
