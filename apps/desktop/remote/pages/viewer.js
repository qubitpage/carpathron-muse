// Carpathron Remote — viewer: shows a remote PC and sends it your mouse and keyboard.
'use strict';
(function () {
  const { RD } = window; const rd = window.rd;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), video = $('#video'), canvas = $('#canvas'), ctx = canvas.getContext('2d', { alpha: false });
  let job = null, ch = null, pc = null, dc = null, mode = '', screenW = 0, screenH = 0, ice = [], hostName = '', ended = false, live = false;
  let frames = 0, fpsShown = 0, rtt = 0;
  let tr = null, voice = null, ui = null, call = '', control = true, lastClip = null, unread = 0, rec = null;

  const status = (text, kind) => { const el = $('#status'); el.textContent = text; el.className = 'pill ' + (kind || ''); };
  function overlay(html) { const o = $('#overlay'); if (html == null) { o.hidden = true; return; } o.innerHTML = html; o.hidden = false; }
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const REASONS = {
    password: 'Wrong password.', locked: 'Too many wrong passwords: that computer refuses connections for 10 minutes.',
    declined: 'The person at that computer declined the connection.', 'unattended-off': 'Unattended access is switched off on that computer: use its one-time password.',
    offline: 'That computer is not online (or remote control is switched off on it).', busy: 'That computer is busy, try again in a moment.', 'no-answer': 'That computer did not answer.',
    rate: 'Too many attempts from this network. Wait a few minutes.',
    license: 'This PC could not get its license from qubitpage.com (internet?). Check the connection and try again.',
    'session-limit': 'Free session ended: free (personal) use allows sessions of up to 20 minutes. Connect again to continue (up to 2 hours per day), or get a license for unlimited sessions.',
    'daily-limit': 'You have used the 2 free hours for today. Get a license ($3 per PC per month or $19.99 per year) for unlimited use, or come back tomorrow.',
    'one-session': 'Free (personal) use allows one session at a time. Close the other session first, or get a license.', 'pro-busy': 'This license already has the maximum number of sessions running. Close one, or add PCs to the license.', 'pro-hosts': 'Your Pro license controls up to 3 computers and they are all in use. Remove one in the License box of the Remote desktop window, or upgrade to Max ($5 per month or $49.99 per year) for any number of computers.', 'bad-relay': 'The relay address in Settings is not valid.',
  };

  function askPassword(msg) {
    overlay(`<form id="pwf" class="card"><h2>Connect to ${esc(job.idFmt)}</h2>${msg ? `<p class="err">${esc(msg)}</p>` : ''}
      <p class="muted">Enter the password shown on that computer (one-time password), or its personal password for unattended access.</p>
      <input id="pw" type="password" autocomplete="off" placeholder="Password" autofocus>
      <div class="row"><button type="submit" class="primary">Connect</button><button type="button" id="cancel">Cancel</button></div></form>`);
    $('#pw').focus();
    $('#cancel').onclick = () => window.close();
    $('#pwf').onsubmit = (e) => { e.preventDefault(); const v = $('#pw').value; if (v) { job.password = v; start(); } };
  }

  async function init() {
    job = await rd.viewerJob(location.hash.slice(1));
    if (!job) { overlay('<div class="card"><h2>Nothing to connect to</h2><p class="muted">Open a connection from the Remote desktop window.</p></div>'); return; }
    $('#who').textContent = job.name ? `${job.name} · ${job.idFmt}` : job.idFmt;
    $('#quality').value = job.quality || 'auto';
    $('#clipsync').checked = job.clipSync !== false;
    if (job.password) start(); else askPassword();
  }

  function start() {
    ended = false;
    overlay(`<div class="card"><div class="spin"></div><h2>Connecting to ${esc(job.idFmt)}…</h2><p class="muted" id="step">Looking for the computer</p></div>`);
    status('Connecting', 'warn');
    let ws; try { ws = new WebSocket(RD.relayUrl(job.relay)); } catch { return fail('bad-relay'); }
    ch = new RD.Channel(ws);
    let nh = '', so = '', sp = null, nv = '', kOtp = null, kPerm = null;
    ch.onclose = (e) => { stopLimit(); rd.licenseQuiet().catch(() => {}); if (e && e.code === 4429) return fail('session-limit'); if (e && e.code === 4430) return fail('daily-limit'); if (!ended) fail(live ? 'The connection was closed.' : 'The connection to the relay was lost.'); };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'connect', id: job.id, lic: job.lic || '' }));
    ch.onjson = async (m) => {
      if (m.t === 'waiting') { ice = m.ice || []; const s = $('#step'); if (s) s.textContent = 'Waiting for the computer to answer'; }
      else if (m.t === 'error') fail(m.code);
      else if (m.t === 'paired') { const s = $('#step'); if (s) s.textContent = 'Checking the password'; if (m.limit) startLimit(m.limit, m.daily); }
      else if (m.t === 'hello') {
        hostName = m.name || ''; nh = m.nh; so = m.so; sp = m.sp; nv = RD.b64(RD.rand(16));
        const msg = { t: 'auth', v: 1, nv, name: job.me || 'Carpathron user', pc: job.pc || '' };
        if (so) { kOtp = await RD.derive(job.password, so); msg.po = await RD.hmac(kOtp, 'viewer|' + nh + '|' + nv); }
        if (sp) { kPerm = await RD.derive(job.password, sp); msg.pp = await RD.hmac(kPerm, 'viewer|' + nh + '|' + nv); }
        await ch.send(msg);
        const s = $('#step'); if (s) s.textContent = 'Waiting for the person at that computer to allow the connection';
      } else if (m.t === 'denied') {
        ended = true; ch.close();
        if (m.reason === 'password') { job.password = ''; askPassword(REASONS.password); status('Not connected', 'bad'); }
        else fail(m.reason);
      } else if (m.t === 'ok') {
        let key = null;
        for (const k of [kOtp, kPerm]) if (k && RD.same(await RD.hmac(k, 'host|' + nh + '|' + nv), m.p)) { key = k; break; }
        if (!key) { ended = true; ch.close(); return fail('That computer could not prove it knows the password. Connection stopped.'); }
        ch.secure(await RD.sessionKeys(key, nh, nv, 'viewer'));
        ch.onjson = onMsg; ch.onbinary = onFrame;
        live = true;
        setupExtras();
        rd.viewerConnected(job.id, hostName).catch(() => {});
        if (job.remember) rd.remember(location.hash.slice(1), job.password).catch(() => {});
        rd.title(`${hostName || job.idFmt} — Carpathron Remote`).catch(() => {});
        $('#who').textContent = hostName ? `${hostName} · ${job.idFmt}` : job.idFmt;
        const s = $('#step'); if (s) s.textContent = 'Starting the picture';
        setInterval(() => { if (live) ch.send({ t: 'ping', ts: performance.now() }); }, 2000);
        if (job.quality && job.quality !== 'auto') ch.send({ t: 'quality', q: job.quality });
      }
    };
  }

  function fail(code) {
    ended = true; live = false; stopRec(); endCall(false, true); if (tr) tr.cancelAll();
    try { ch && ch.close(); } catch {} try { pc && pc.close(); } catch {}
    status('Not connected', 'bad');
    const limit = ['session-limit', 'daily-limit', 'one-session', 'pro-hosts'].includes(code);
    overlay(`<div class="card"><h2>${code === 'pro-hosts' ? 'Pro license: 3 computers' : limit ? 'Free use limit' : 'Not connected'}</h2><p>${esc(REASONS[code] || code || 'The connection ended.')}</p><div class="row">${code === 'daily-limit' ? '' : '<button class="primary" id="again">' + (code === 'session-limit' ? 'Connect again' : 'Try again') + '</button>'}${limit ? '<button id="buy" class="' + (code === 'daily-limit' ? 'primary' : '') + '">' + (code === 'pro-hosts' ? 'Upgrade to Max' : 'Get a license') + '</button>' : ''}<button id="close">Close</button></div></div>`);
    if ($('#again')) $('#again').onclick = () => { if (!job.password) askPassword(); else start(); };
    if ($('#buy')) $('#buy').onclick = () => rd.buy();
    $('#close').onclick = () => window.close();
  }

  // ------------------------------------------------------------ free (personal) use: time left in this session
  let limitEnd = 0, limitTimer = null, limitDaily = false;
  function startLimit(ms, daily) {
    limitEnd = Date.now() + ms; limitDaily = !!daily; stopLimit(true);
    const el = $('#limit'); el.hidden = false;
    const tick = () => {
      const left = Math.max(0, limitEnd - Date.now()); const m = Math.floor(left / 60000), sec = Math.floor(left / 1000) % 60;
      el.textContent = `Free: ${m}:${String(sec).padStart(2, '0')} left${limitDaily ? ' today' : ''}`;
      el.className = 'pill ' + (left < 120000 ? 'bad' : 'warn'); el.title = 'Free personal use: sessions up to 20 minutes, 2 hours per day. Click to get a license.';
    };
    tick(); limitTimer = setInterval(tick, 1000);
    el.onclick = () => rd.buy();
  }
  function stopLimit(keep) { clearInterval(limitTimer); limitTimer = null; if (!keep) { const el = $('#limit'); if (el) el.hidden = true; } }

  // ------------------------------------------------------------ messages from the host
  async function onMsg(m) {
    switch (m.t) {
      case 'info': {
        const sel = $('#screen'); sel.innerHTML = '';
        (m.screens || []).forEach((d) => { const o = document.createElement('option'); o.value = d.index; o.textContent = `Screen ${d.label}`; sel.appendChild(o); });
        sel.value = m.screen; sel.parentElement.hidden = (m.screens || []).length < 2;
        const d = (m.screens || [])[m.screen]; if (d) { screenW = d.w; screenH = d.h; }
        if (m.sys) $('#who').title = `${m.sys.os} (${m.sys.arch}) · ${m.sys.cpu} · ${m.sys.cores} cores · ${m.sys.ram} GB RAM · on for ${m.sys.up} h`;
        break;
      }
      case 'sdp':
        if (m.sdp && m.sdp.type === 'offer') {
          pc = new RTCPeerConnection({ iceServers: ice });
          pc.onicecandidate = (e) => { if (e.candidate) ch.send({ t: 'cand', c: e.candidate.toJSON() }); };
          pc.ontrack = (e) => { video.srcObject = e.streams[0] || new MediaStream([e.track]); video.play().catch(() => {}); };
          pc.ondatachannel = (e) => { dc = e.channel; };
          pc.onconnectionstatechange = () => { if (pc && (pc.connectionState === 'failed') && mode === 'direct') ch.send({ t: 'relay' }); };
          await pc.setRemoteDescription(m.sdp);
          const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
          ch.send({ t: 'sdp', sdp: pc.localDescription.toJSON() });
        }
        break;
      case 'cand': if (pc && m.c) pc.addIceCandidate(m.c).catch(() => {}); break;
      case 'mode':
        mode = m.m;
        if (mode === 'relay') { try { pc && pc.close(); } catch {} pc = null; dc = null; video.hidden = true; canvas.hidden = false; }
        else { video.hidden = false; canvas.hidden = true; }
        overlay(null); stage.focus();
        status(mode === 'direct' ? 'Direct' : 'Via relay', mode === 'direct' ? 'good' : 'warn');
        break;
      case 'pong': rtt = Math.round(performance.now() - m.ts); break;
      case 'perm': control = m.control !== false; $('#viewonly').hidden = control; document.body.classList.toggle('watch', !control); if (ui) ui.info(control ? 'You can control the remote computer.' : 'View only: the person at that computer lets you watch, not control.'); break;
      case 'chat': if (ui) ui.chat(hostName || 'Remote', String(m.text || '').slice(0, 4000), false); break;
      case 'clip': window.__clipIn = (window.__clipIn || 0) + 1; if (typeof m.s === 'string' && $('#clipsync').checked) { lastClip = m.s; rd.clipWrite(m.s).catch(() => {}); } break;
      case 'call': call = call === 'calling' ? 'on' : 'ringing'; if (call === 'on') ch.send({ t: 'call-join' }); ui.callState(call, hostName); openSide(true); break;
      case 'call-join': if (call === 'calling') { call = 'on'; ui.callState('on'); } break;
      case 'call-end': endCall(false); break;
      case 'au': if (call === 'on' && voice) voice.hear(m.d); break;
      default: if (tr) tr.handle(m); break;
      case 'bye': ended = true; live = false; fail(m.reason || 'The other computer ended the session.'); break;
    }
  }
  async function onFrame(bytes) {
    send({ t: 'ack' });
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) { canvas.width = bmp.width; canvas.height = bmp.height; }
      ctx.drawImage(bmp, 0, 0); bmp.close(); frames += 1; window.__frames = (window.__frames || 0) + 1;
    } catch {}
  }
  function send(o) { if (!live) return; if (o.t === 'in' && !control) return; if (dc && dc.readyState === 'open' && o.t === 'in') dc.send(JSON.stringify(o)); else ch.send(o); }
  setInterval(() => {
    if (!live) return;
    if (mode === 'direct' && pc) {
      pc.getStats().then((st) => { st.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') { const f = r.framesDecoded || 0; fpsShown = Math.max(0, f - (onFrame.lastF || 0)); onFrame.lastF = f; } }); $('#stats').textContent = `${fpsShown} fps · ${rtt} ms`; }).catch(() => {});
    } else { fpsShown = frames; frames = 0; $('#stats').textContent = `${fpsShown} fps · ${rtt} ms`; }
  }, 1000);

  // ------------------------------------------------------------ your input → remote
  function contentRect() {
    const el = mode === 'relay' ? canvas : video; const r = el.getBoundingClientRect();
    const iw = mode === 'relay' ? canvas.width : video.videoWidth, ih = mode === 'relay' ? canvas.height : video.videoHeight;
    if (!iw || !ih) return null;
    const s = Math.min(r.width / iw, r.height / ih); const w = iw * s, h = ih * s;
    return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
  }
  function norm(e) {
    const c = contentRect(); if (!c) return null;
    const x = (e.clientX - c.x) / c.w, y = (e.clientY - c.y) / c.h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x: +x.toFixed(5), y: +y.toFixed(5) };
  }
  let pendingMove = null;
  stage.addEventListener('mousemove', (e) => { if (!live) return; const p = norm(e); if (!p) return; if (!pendingMove) requestAnimationFrame(() => { send({ t: 'in', e: { k: 'mm', ...pendingMove } }); pendingMove = null; }); pendingMove = p; });
  stage.addEventListener('mousedown', (e) => { if (!live) return; stage.focus(); const p = norm(e); if (!p) return; e.preventDefault(); send({ t: 'in', e: { k: 'md', b: e.button, ...p } }); });
  window.addEventListener('mouseup', (e) => { if (!live) return; const p = norm(e) || {}; send({ t: 'in', e: { k: 'mu', b: e.button, ...p } }); });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('auxclick', (e) => e.preventDefault());
  let wy = 0, wx = 0, wt = null;
  stage.addEventListener('wheel', (e) => {
    if (!live) return; e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    wy += -e.deltaY * unit * 1.2; wx += e.deltaX * unit * 1.2;
    if (!wt) wt = setTimeout(() => { send({ t: 'in', e: { k: 'wh', dy: Math.round(wy), dx: Math.round(wx) } }); wy = wx = 0; wt = null; }, 30);
  }, { passive: false });
  const held = new Set();
  window.addEventListener('keydown', (e) => {
    if (!live || document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    e.preventDefault(); held.add(e.code); send({ t: 'in', e: { k: 'kd', code: e.code } });
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!live || !held.has(e.code)) return; e.preventDefault(); held.delete(e.code); send({ t: 'in', e: { k: 'ku', code: e.code } });
  }, true);
  window.addEventListener('blur', () => { for (const code of held) send({ t: 'in', e: { k: 'ku', code } }); held.clear(); });

  // ------------------------------------------------------------ chat, voice call, files, clipboard, recording
  function setupExtras() {
    const sendC = (o) => ch.send(o);
    tr = new RD.Transfers(sendC, rd, (ev) => ui && ui.file(ev));
    voice = new RD.Voice(sendC);
    ui = new window.PanelUI({
      sendChat: (text) => { ch.send({ t: 'chat', text }); ui.chat('You', text, true); },
      sendFile: (info) => tr.sendFile(info),
      cancel: (id) => tr.cancel(id),
      show: (p) => rd.showFile(p), openFolder: () => rd.showFile('downloads'),
      call: () => startCall(), join: () => joinCall(), hangup: () => endCall(true),
      mute: (on) => { if (voice) voice.muted = on; }, level: () => (voice && voice.on && !voice.muted ? voice.level : 0),
      onUnread: () => { if ($('#side').hidden) { unread += 1; $('#badge').textContent = unread; $('#badge').hidden = false; } },
    });
    rd.clipRead().then((t) => { lastClip = t; }).catch(() => {});
    window.__rdTest = { sendPath: async (p) => tr.sendFile(await rd.fileFromDrop(p)), voice: () => ({ tx: voice.tx, rx: voice.rx, on: voice.on }), call: () => call, control: () => control, lastClip: () => lastClip, sendClip: (t) => ch.send({ t: 'clip', s: t }) };
  }
  async function startCall() {
    try { await voice.start(); call = 'calling'; ui.callState('calling'); await ch.send({ t: 'call' }); }
    catch (e) { voice.stop(); call = ''; ui.callState(''); ui.info('The microphone could not be started: ' + (e.message || e), true); }
  }
  async function joinCall() {
    try { await voice.start(); call = 'on'; await ch.send({ t: 'call-join' }); ui.callState('on'); }
    catch (e) { voice.stop(); ui.info('The microphone could not be started: ' + (e.message || e), true); }
  }
  function endCall(tell, quiet) {
    if (!call) return; call = ''; if (voice) voice.stop();
    if (tell && live) ch.send({ t: 'call-end' }).catch(() => {});
    if (ui && !quiet) ui.callState('');
  }
  function openSide(on) {
    const s = $('#side'); s.hidden = on === undefined ? !s.hidden : !on;
    if (!s.hidden) { unread = 0; $('#badge').hidden = true; }
    $('#sidebtn').classList.toggle('on', !s.hidden);
  }
  $('#sidebtn').onclick = () => { openSide(); if (!$('#side').hidden) $('#chatin').focus(); else stage.focus(); };
  $('#clipsync').onchange = (e) => { rd.set({ clipSync: e.target.checked }).catch(() => {}); };
  // copy on this computer → paste on the remote one (checked when you come back to this window, and while it is in front)
  async function pushClip() {
    if (!live || !$('#clipsync').checked) return;
    const t = await rd.clipRead().catch(() => null); if (t == null) return;
    if (lastClip === null) { lastClip = t; return; }
    if (t && t !== lastClip) { lastClip = t; ch.send({ t: 'clip', s: t }); }
  }
  window.addEventListener('focus', pushClip);
  setInterval(() => { if (document.hasFocus()) pushClip(); }, 1500);
  // drag and drop files anywhere on the remote screen
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { if (!live || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; dragN += 1; $('#drop').hidden = false; });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#drop').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('#drop').hidden = true; if (live && ui && e.dataTransfer.files.length) { ui.sendFileList(e.dataTransfer.files); openSide(true); } });
  // record the session to Videos\Carpathron Remote\*.webm
  async function startRec() {
    const stream = mode === 'relay' ? canvas.captureStream(15) : video.srcObject; if (!stream) return;
    const name = `Carpathron Remote ${hostName || job.idFmt} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}.webm`;
    const rid = await rd.recvStart(name, 0, 'rec');
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2500000 });
    let q = Promise.resolve();
    mr.ondataavailable = (e) => { if (e.data && e.data.size) { const b = e.data; q = q.then(async () => rd.recvChunk(rid, new Uint8Array(await b.arrayBuffer()))).catch(() => {}); } };
    mr.onstop = () => { q = q.then(() => rd.recvEnd(rid, true)).then((r) => { if (ui && r && r.ok) { ui.info(`Recording saved: ${r.name}`); ui.file({ t: 'in-start', id: 'rec' + rid, name: r.name, size: 0 }); ui.file({ t: 'in-done', id: 'rec' + rid, ok: true, path: r.path, name: r.name }); } }).catch(() => {}); };
    mr.start(3000); rec = { mr, mode, started: Date.now() };
    $('#rec').textContent = '■ Stop recording'; $('#rec').classList.add('danger');
  }
  function stopRec() { if (!rec) return; try { rec.mr.stop(); } catch {} rec = null; $('#rec').textContent = '● Record'; $('#rec').classList.remove('danger'); }
  $('#rec').onclick = () => { if (rec) stopRec(); else if (live) startRec().catch((e) => ui && ui.info('Recording could not start: ' + (e.message || e), true)); };
  setInterval(() => { if (rec && rec.mode !== mode) { stopRec(); if (live) startRec().catch(() => {}); } }, 1000);

  // ------------------------------------------------------------ toolbar
  $('#screen').onchange = (e) => { send({ t: 'screen', i: Number(e.target.value) }); stage.focus(); };
  $('#quality').onchange = (e) => { send({ t: 'quality', q: e.target.value }); stage.focus(); };
  $('#keys').onchange = (e) => { if (e.target.value) send({ t: 'in', e: { k: 'combo', name: e.target.value } }); e.target.value = ''; stage.focus(); };
  $('#paste').onclick = async () => { const t = await rd.clipboard(); if (t) send({ t: 'in', e: { k: 'txt', s: t } }); stage.focus(); };
  $('#full').onclick = async () => { const on = await rd.fullscreen(!document.body.classList.contains('fs')); document.body.classList.toggle('fs', on); stage.focus(); };
  $('#end').onclick = () => { stopRec(); endCall(true, true); if (live) ch.send({ t: 'bye' }); ended = true; live = false; setTimeout(() => window.close(), 150); };
  window.addEventListener('beforeunload', () => { if (live) { try { ch.send({ t: 'bye' }); } catch {} } });

  init();
})();
