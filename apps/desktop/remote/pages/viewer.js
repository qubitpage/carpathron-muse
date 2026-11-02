// Carpathron Remote — viewer: shows a remote PC and sends it your mouse and keyboard.
'use strict';
let APPNAME = 'Carpathron Remote';
window.rd.state().then((st) => { APPNAME = st.app || APPNAME; const b = document.getElementById('brand'); if (b) b.textContent = APPNAME; document.title = APPNAME; }).catch(() => {});
(function () {
  const { RD } = window; const rd = window.rd;
  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), video = $('#video'), canvas = $('#canvas'), ctx = canvas.getContext('2d', { alpha: false });
  let resume = null, reconn = null, pingTimer = null; // reconnect key from the host; reconnecting state
  let job = null, ch = null, pc = null, dc = null, mode = '', screenW = 0, screenH = 0, ice = [], hostName = '', ended = false, live = false;
  let frames = 0, fpsShown = 0, rtt = 0;
  let tr = null, voice = null, ui = null, call = '', control = true, lastClip = null, unread = 0, rec = null;
  let caps = [], hostSys = null, cmdState = 'none', cmdWaiters = [], aiPanel = null, aiOn = false; const runs = new Map();

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
    'daily-limit': 'You have used the 2 free hours for today. Get a license (€3 per PC per month or €19.99 per year) for unlimited use, or come back tomorrow.',
    'one-session': 'Free (personal) use allows one session at a time. Close the other session first, or get a license.', 'pro-busy': 'This license already has the maximum number of sessions running. Close one, or add PCs to the license.', 'pro-hosts': 'Your Pro license controls up to 3 computers and they are all in use. Remove one in the License box of the Remote desktop window, or upgrade to Max (€5 per month or €49.99 per year) for any number of computers.', 'bad-relay': 'The relay address in Settings is not valid.',
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
    if (job.password || job.trust) start(); else askPassword();
  }

  function start() {
    ended = false;
    if (reconn) { overlay(`<div class="card"><div class="spin"></div><h2>Reconnecting to ${esc(hostName || job.idFmt)}…</h2><p class="muted" id="step">${esc(reconn.why)} · attempt ${reconn.n}</p><div class="row"><button id="rcstop">Stop</button></div></div>`); $('#rcstop').onclick = () => { reconn = null; fail('Reconnecting stopped.'); }; }
    else overlay(`<div class="card"><div class="spin"></div><h2>Connecting to ${esc(job.idFmt)}…</h2><p class="muted" id="step">Looking for the computer</p></div>`);
    status('Connecting', 'warn');
    let ws; try { ws = new WebSocket(RD.relayUrl(job.relay)); } catch { return fail('bad-relay'); }
    ch = new RD.Channel(ws);
    let nh = '', so = '', sp = null, nv = '', kOtp = null, kPerm = null, kRes = null;
    const myCh = ch;
    ch.onclose = (e) => {
      if (ch !== myCh) return;
      stopLimit(); rd.licenseQuiet().catch(() => {});
      if (e && e.code === 4429) return fail('session-limit'); if (e && e.code === 4430) return fail('daily-limit');
      if (ended) return;
      if (live || reconn) return reconnect(reconn ? reconn.why : 'The connection was lost');
      fail('The connection to the relay was lost.');
    };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'connect', id: job.id, lic: job.lic || '' }));
    ch.onjson = async (m) => {
      if (m.t === 'waiting') { ice = m.ice || []; const s = $('#step'); if (s) s.textContent = 'Waiting for the computer to answer'; }
      else if (m.t === 'error') { if (reconn && ['offline', 'no-answer', 'busy'].includes(m.code)) { const c = ch; ch = null; try { c.close(); } catch {} return reconnect(reconn.why); } fail(m.code); }
      else if (m.t === 'paired') { const s = $('#step'); if (s) s.textContent = 'Checking the password'; if (m.limit) startLimit(m.limit, m.daily); }
      else if (m.t === 'hello') {
        hostName = m.name || ''; nh = m.nh; so = m.so; sp = m.sp; nv = RD.b64(RD.rand(16));
        const msg = { t: 'auth', v: 1, nv, name: job.me || 'Carpathron user', pc: job.pc || '' };
        if (so) { kOtp = await RD.derive(job.password, so); msg.po = await RD.hmac(kOtp, 'viewer|' + nh + '|' + nv); }
        if (sp) { kPerm = await RD.derive(job.password, sp); msg.pp = await RD.hmac(kPerm, 'viewer|' + nh + '|' + nv); }
        if (!resume && job.trust && Array.isArray(m.sr) && m.sr.includes(job.trust.salt)) { kRes = await RD.derive(job.trust.tok, job.trust.salt); msg.pr = await RD.hmac(kRes, 'viewer|' + nh + '|' + nv); msg.rs = job.trust.salt; }
        if (resume && Array.isArray(m.sr) && m.sr.includes(resume.salt)) { kRes = await RD.derive(resume.tok, resume.salt); msg.pr = await RD.hmac(kRes, 'viewer|' + nh + '|' + nv); msg.rs = resume.salt; }
        await ch.send(msg);
        const s = $('#step'); if (s) s.textContent = 'Waiting for the person at that computer to allow the connection';
      } else if (m.t === 'denied') {
        ended = true; ch.close();
        if (m.reason === 'password' && reconn) { reconn = null; resume = null; job.password = ''; askPassword('The connection was lost and the other computer asks for its password again (its one-time password changes after every session).'); status('Not connected', 'bad'); }
        else if (m.reason === 'password' && job.trust && !job.password) { job.trust = null; askPassword('That computer does not trust this one any more. Enter its password.'); status('Not connected', 'bad'); }
        else if (m.reason === 'password') { job.password = ''; askPassword(REASONS.password); status('Not connected', 'bad'); }
        else fail(m.reason);
      } else if (m.t === 'ok') {
        let key = null;
        for (const k of [kRes, kOtp, kPerm]) if (k && RD.same(await RD.hmac(k, 'host|' + nh + '|' + nv), m.p)) { key = k; break; }
        if (!key) { ended = true; ch.close(); return fail('That computer could not prove it knows the password. Connection stopped.'); }
        ch.secure(await RD.sessionKeys(key, nh, nv, 'viewer'));
        ch.onjson = onMsg; ch.onbinary = onFrame;
        live = true;
        setupExtras();
        if (reconn) { if (ui) ui.info('Reconnected.'); reconn = null; } resume = null;
        rd.viewerConnected(job.id, hostName).catch(() => {});
        if (job.remember) rd.remember(location.hash.slice(1), job.password).catch(() => {});
        rd.title(`${hostName || job.idFmt} — ${APPNAME}`).catch(() => {});
        $('#who').textContent = hostName ? `${hostName} · ${job.idFmt}` : job.idFmt;
        const s = $('#step'); if (s) s.textContent = 'Starting the picture';
        // latency of the path the mouse really uses: the direct link when there is one, else the relay
        if (!pingTimer) pingTimer = setInterval(() => { if (!live) return; if (dc && dc.readyState === 'open') { try { dc.send(JSON.stringify({ t: 'ping', ts: performance.now(), dc: 1 })); return; } catch {} } ch.send({ t: 'ping', ts: performance.now() }); }, 2000);
        if (job.quality && job.quality !== 'auto') ch.send({ t: 'quality', q: job.quality });
      }
    };
  }

  function confirmRestart() {
    if (!control) { if (ui) ui.info('View only: you cannot restart that computer.', true); return; }
    overlay(`<div class="card"><h2>Restart ${esc(hostName || job.idFmt)}?</h2><p>Unsaved work on that computer is lost. Its programs are closed and Windows restarts in about 10 seconds. This window reconnects by itself when it is back (Windows must be signed in, Carpathron Remote must start with Windows).</p><div class="row"><button class="primary" id="rsyes">Restart</button><button id="rsno">Cancel</button></div></div>`);
    $('#rsno').onclick = () => { overlay(null); stage.focus(); };
    $('#rsyes').onclick = () => { overlay(null); ch.send({ t: 'restart' }); stage.focus(); };
  }
  function fail(code) {
    reconn = null;
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
        if (Array.isArray(m.caps)) caps = m.caps; if (m.sys) hostSys = m.sys;
        if (m.sys) $('#who').title = `${m.sys.os} (${m.sys.arch}) · ${m.sys.cpu} · ${m.sys.cores} cores · ${m.sys.ram} GB RAM · on for ${m.sys.up} h`;
        break;
      }
      case 'sdp':
        if (m.sdp && m.sdp.type === 'offer') {
          pc = new RTCPeerConnection({ iceServers: ice });
          pc.onicecandidate = (e) => { if (e.candidate) ch.send({ t: 'cand', c: e.candidate.toJSON() }); };
          pc.ontrack = (e) => { video.srcObject = e.streams[0] || new MediaStream([e.track]); video.play().catch(() => {}); };
          pc.ondatachannel = (e) => { dc = e.channel; dc.onmessage = (ev) => { try { const q = JSON.parse(ev.data); if (q && q.t === 'pong') rtt = Math.round(performance.now() - q.ts); } catch {} }; };
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
      case 'resume': if (m.tok && m.salt) resume = { tok: String(m.tok), salt: String(m.salt) }; break;
      case 'trust': if (m.tok && m.salt) { job.trust = { tok: String(m.tok), salt: String(m.salt) }; rd.rememberTrust(location.hash.slice(1), m.tok, m.salt).catch(() => {}); if (ui) ui.info('That computer trusts this one now: next time you connect without a password.'); } break;
      case 'restarting':
        if (!m.ok) { if (ui) ui.info('The restart did not start: ' + (m.error || 'unknown error'), true); break; }
        if (ui) ui.info(m.autostart ? 'The remote computer restarts. This window reconnects by itself when it is back (Windows must be signed in).' : 'The remote computer restarts. Carpathron Remote is not set to start with Windows there, so someone must open it after sign-in.');
        reconn = { until: Date.now() + 8 * 60000, n: 0, why: 'The remote computer is restarting' };
        break;
      case 'refreshed': if (ui) ui.info(`The picture was restarted (${String(m.why || '').slice(0, 80)}).`); break;
      case 'perm': control = m.control !== false; $('#viewonly').hidden = control; document.body.classList.toggle('watch', !control); if (ui) ui.info(control ? 'You can control the remote computer.' : 'View only: the person at that computer lets you watch, not control.'); break;
      case 'chat': if (ui) ui.chat(hostName || 'Remote', String(m.text || '').slice(0, 4000), false); break;
      case 'clip': window.__clipIn = (window.__clipIn || 0) + 1; if (typeof m.s === 'string' && $('#clipsync').checked) { lastClip = m.s; rd.clipWrite(m.s).catch(() => {}); } break;
      case 'call': call = call === 'calling' ? 'on' : 'ringing'; if (call === 'on') ch.send({ t: 'call-join' }); ui.callState(call, hostName); openSide(true); break;
      case 'call-join': if (call === 'calling') { call = 'on'; ui.callState('on'); } break;
      case 'call-end': endCall(false); break;
      case 'au': if (call === 'on' && voice) voice.hear(m.d); break;
      default: if (tr) tr.handle(m); break;
      case 'cmd-perm': cmdState = m.ok ? 'allowed' : (m.why === 'revoked' ? 'revoked' : 'denied'); cmdWaiters.splice(0).forEach((r) => r(m)); if (ui && m.why === 'revoked') ui.info('The person at the remote computer stopped your commands.', true); break;
      case 'run-out': { const r = runs.get(m.id); if (r && typeof m.d === 'string') { if (r.out.length < 400000) r.out += m.d; if (r.onOut) r.onOut(m.d); } break; }
      case 'run-end': { const r = runs.get(m.id); if (r) { runs.delete(m.id); r.resolve({ code: m.code, out: r.out, ms: m.ms, timedOut: !!m.timedOut, error: m.error === 'not-allowed' ? 'Commands are not allowed on that computer.' : m.error === 'busy' ? 'Too many commands are running there.' : m.error || '' }); } break; }
      case 'ai-stop': rd.aiRemoteStop().catch(() => {}); if (ui) ui.info('The person at the remote computer stopped the AI technician.', true); break;
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
  // Ctrl+V first sends this PC's clipboard; meanwhile every key event waits here in order, so the remote computer gets
  // exactly Ctrl down, V down, V up, Ctrl up (a quick Ctrl release can never overtake the V)
  let keyQ = null;
  const sendKey = (ev) => { if (keyQ) keyQ.push(ev); else send({ t: 'in', e: ev }); };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); setFull(!document.body.classList.contains('fs')); return; }
    if (!live || document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey) && !e.repeat && !keyQ && $('#clipsync').checked) {
      e.preventDefault(); held.add(e.code); keyQ = [{ k: 'kd', code: 'KeyV' }];
      const flush = () => { const q = keyQ || []; keyQ = null; for (const ev of q) send({ t: 'in', e: ev }); };
      pushClip().catch(() => {}).then(() => new Promise((r) => setTimeout(r, 250))).then(flush, flush);
      setTimeout(() => { if (keyQ) flush(); }, 3000); // never hold the keyboard longer than this
      return;
    }
    // keys without a physical key code (on-screen keyboards, IME, password managers, a remote session inside a remote session,
    // automation tools) carry only the character: send it as text instead of dropping it
    if (!e.code || e.code === 'Unidentified' || e.key === 'Process') {
      if (e.key && e.key.length <= 2 && e.key !== 'Process' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); sendKey({ k: 'txt', s: e.key }); }
      return;
    }
    e.preventDefault(); held.add(e.code); sendKey({ k: 'kd', code: e.code });
  }, true);
  // text from an input method (Chinese, Japanese, emoji picker...) arrives as a finished composition
  window.addEventListener('compositionend', (e) => { if (live && e.data && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) sendKey({ k: 'txt', s: e.data }); }, true);
  window.addEventListener('keyup', (e) => {
    if (!live || !held.has(e.code)) return; e.preventDefault(); held.delete(e.code); sendKey({ k: 'ku', code: e.code });
  }, true);
  window.addEventListener('blur', () => { for (const code of held) send({ t: 'in', e: { k: 'ku', code } }); held.clear(); });

  // ------------------------------------------------------------ chat, voice call, files, clipboard, recording
  // lost connection (network, sleep, app or PC restart): try again for a few minutes with the reconnect key
  function reconnect(why) {
    if (!reconn) reconn = { until: Date.now() + 3 * 60000, n: 0, why: why || 'The connection was lost' };
    if (Date.now() > reconn.until) { reconn = null; return fail('The connection was lost and could not be restored. Try again when the other computer is online.'); }
    live = false; stopRec(); endCall(false, true); if (tr) tr.cancelAll();
    try { pc && pc.close(); } catch {} pc = null; dc = null;
    reconn.n += 1; status('Reconnecting', 'warn');
    const n = reconn.n;
    overlay(`<div class="card"><div class="spin"></div><h2>Reconnecting to ${esc(hostName || job.idFmt)}…</h2><p class="muted">${esc(reconn.why)} · attempt ${n}</p><div class="row"><button id="rcstop">Stop</button></div></div>`);
    $('#rcstop').onclick = () => { reconn = null; fail('Reconnecting stopped.'); };
    setTimeout(() => { if (reconn && reconn.n === n && !ended) start(); }, Math.min(10000, 1500 * n));
  }
  function setupExtras() {
    const sendC = (o) => ch.send(o);
    if (ui) { tr = new RD.Transfers(sendC, rd, (ev) => ui && ui.file(ev)); voice = new RD.Voice(sendC); return; } // reconnected: keep the chat
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
    window.__rdTest = { sendPath: async (p) => tr.sendFile(await rd.fileFromDrop(p)), voice: () => ({ tx: voice.tx, rx: voice.rx, on: voice.on }), call: () => call, control: () => control, lastClip: () => lastClip, sendClip: (t) => ch.send({ t: 'clip', s: t }), dropLink: () => { try { ch.ws.close(); } catch {} }, hasResume: () => !!resume };
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

  // ------------------------------------------------------------ commands on the remote computer (after the person there allows them)
  async function cmdAllowed(ai) {
    if (!caps.includes('cmd')) throw new Error('That computer runs Carpathron Remote without commands: install Carpathron Remote DevOps there to allow commands, or work with the screen.');
    if (cmdState === 'allowed') return true;
    const ans = await new Promise((res) => { cmdWaiters.push(res); ch.send({ t: 'cmd-req', ai: !!ai }); setTimeout(() => res({ ok: false, why: 'no-answer' }), 75000); });
    if (!ans.ok) throw new Error(ans.why === 'unattended-off' ? 'Commands are switched off for unattended sessions on that computer (Settings → "Allow commands in unattended sessions").' : ans.why === 'no-answer' ? 'Nobody at that computer allowed commands (no answer).' : 'The person at that computer did not allow commands.');
    return true;
  }
  async function runCmd({ script, shell, admin, timeout, ai }, onOut) {
    if (!live) throw new Error('Not connected.');
    await cmdAllowed(ai);
    const id = RD.b64(RD.rand(9)).replace(/[^A-Za-z0-9]/g, '');
    return new Promise((resolve) => {
      runs.set(id, { out: '', resolve, onOut });
      ch.send({ t: 'run', id, script: String(script || ''), shell: shell || '', admin: !!admin, timeout: Number(timeout) || 120 });
    });
  }
  // the AI (in the app) uses the session through these calls
  function grab(maxw) {
    const el = mode === 'relay' ? canvas : video;
    const w0 = mode === 'relay' ? canvas.width : video.videoWidth, h0 = mode === 'relay' ? canvas.height : video.videoHeight;
    if (!w0 || !h0) throw new Error('No picture yet.');
    const sc = Math.min(1, (maxw || 1366) / w0); const w = Math.round(w0 * sc), h = Math.round(h0 * sc);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(el, 0, 0, w, h);
    return { b64: c.toDataURL('image/jpeg', 0.72).split(',')[1], w, h };
  }
  rd.onAgent(async (rid, op, args) => {
    let res;
    try {
      if (op === 'state') res = { live, control, cmd: cmdState, caps, name: hostName || job.idFmt, os: hostSys ? hostSys.os : '', sys: hostSys };
      else if (op === 'shot') res = grab(args.maxw);
      else if (op === 'input') {
        if (!live) throw new Error('Not connected.');
        if (!control) throw new Error('View only: the person at that computer does not let you control it. Ask them to allow control.');
        for (const e of args.events || []) { send({ t: 'in', e }); await new Promise((r) => setTimeout(r, e.k === 'txt' ? 60 : 35)); }
        res = { ok: true };
      } else if (op === 'run') res = await runCmd({ ...args, ai: true }).catch((e) => ({ code: -1, out: '', error: String(e.message || e) }));
      else if (op === 'chat') { await ch.send({ t: 'chat', text: args.text }); if (ui) ui.chat('AI technician', args.text, true); res = { ok: true }; }
      else if (op === 'ai') { aiOn = !!args.on; if (live) ch.send({ t: 'ai', on: aiOn }); $('#aipill').hidden = !aiOn; res = { ok: true }; }
      else res = { error: 'unknown ' + op };
    } catch (e) { res = { error: String(e.message || e) }; }
    rd.agentReply(rid, res).catch(() => {});
  });
  function openAi(on) {
    const a = $('#aiside'); a.hidden = on === undefined ? !a.hidden : !on;
    $('#aibtn').classList.toggle('on', !a.hidden);
    if (!a.hidden && !aiPanel) {
      aiPanel = new window.AIPanel({ root: $('#aipanel'), target: 'desktop', title: 'AI technician',
        quick: [['Check health', 'Check this computer: system overview, disks, recent errors and security. Report what is wrong and what you recommend. Do not change anything yet.'],
          ['Free disk space', 'Free up disk space on the system drive safely (temporary files, update caches, recycle bin). Do not delete the user\'s own files; show me the biggest folders instead.'],
          ['Security check', 'Check this computer for security problems and vulnerabilities: antivirus, firewall, missing updates, outdated programs, risky settings, open ports. Report and propose fixes; do not change anything yet.'],
          ['Update programs', 'Update all programs that have updates with winget, then report what was updated.'],
          ['Why is it slow?', 'Find out why this computer is slow (CPU, memory, disk, startup programs, errors) and suggest fixes.']],
        onCommand: (script, admin) => runCmd({ script, admin, timeout: 300 }) });
    }
    if (!a.hidden && aiPanel) aiPanel.refresh();
  }
  $('#aibtn').onclick = () => openAi();
  $('#aipill').onclick = () => openAi(true);

  // ------------------------------------------------------------ toolbar
  $('#screen').onchange = (e) => { send({ t: 'screen', i: Number(e.target.value) }); stage.focus(); };
  $('#quality').onchange = (e) => { send({ t: 'quality', q: e.target.value }); stage.focus(); };
  $('#keys').onchange = (e) => {
    const v = e.target.value; e.target.value = ''; stage.focus(); if (!v || !live) return;
    if (v === 'refresh') ch.send({ t: 'refresh' });
    else if (v === 'restart') confirmRestart();
    else send({ t: 'in', e: { k: 'combo', name: v } });
  };
  $('#paste').onclick = async () => { const t = await rd.clipboard(); if (t) send({ t: 'in', e: { k: 'txt', s: t } }); stage.focus(); };
  // Full screen: the bar slides down when the mouse touches the top edge; "Exit full screen" stays in the corner; Ctrl+Alt+F toggles
  async function setFull(want) {
    const on = await rd.fullscreen(!!want); document.body.classList.toggle('fs', on); document.body.classList.remove('barshow');
    $('#full').textContent = on ? 'Exit full screen' : 'Full screen'; stage.focus();
  }
  $('#full').onclick = () => setFull(!document.body.classList.contains('fs'));
  $('#fsexit').onclick = () => setFull(false);
  // actual size: moving the mouse near an edge of the window slides the view that way
  let edge = null;
  stage.addEventListener('mousemove', (e) => {
    if (!document.body.classList.contains('actual')) { edge = null; return; }
    const r = stage.getBoundingClientRect(), m = 28;
    edge = { dx: e.clientX < r.left + m ? -1 : e.clientX > r.right - m ? 1 : 0, dy: e.clientY < r.top + m ? -1 : e.clientY > r.bottom - m ? 1 : 0 };
  });
  stage.addEventListener('mouseleave', () => { edge = null; });
  setInterval(() => { if (edge && (edge.dx || edge.dy)) { stage.scrollLeft += edge.dx * 24; stage.scrollTop += edge.dy * 24; } }, 30);
  $('#scale').onclick = () => { const on = document.body.classList.toggle('actual'); $('#scale').textContent = on ? 'Fit to window' : 'Actual size'; stage.focus(); };
  window.addEventListener('mousemove', (e) => {
    if (!document.body.classList.contains('fs')) return;
    const bar = $('#bar').getBoundingClientRect();
    if (e.clientY <= 6) document.body.classList.add('barshow');
    else if (document.body.classList.contains('barshow') && e.clientY > bar.height + 30 && !$('#bar').contains(document.activeElement)) document.body.classList.remove('barshow');
  }, true);
  // keep the controls in step with the real window state (F11, the system, a late switch): there is always a way back
  const fsUi = (on) => { document.body.classList.toggle('fs', !!on); if (!on) document.body.classList.remove('barshow'); $('#full').textContent = on ? 'Exit full screen' : 'Full screen'; };
  if (rd.onFs) rd.onFs((on) => fsUi(on));

  $('#end').onclick = () => { stopRec(); endCall(true, true); if (live) ch.send({ t: 'bye' }); ended = true; live = false; setTimeout(() => window.close(), 150); };
  window.addEventListener('beforeunload', () => { if (live) { try { ch.send({ t: 'bye' }); } catch {} } });

  init();
})();
