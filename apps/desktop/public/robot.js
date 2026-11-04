// Robot panel: drive pad, keyboard, simulation and Meta Quest (WebXR) drive mode.
'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const send = (o) => window.MCsend(o);
  const DIRS = { f: [1, 1], b: [-1, -1], l: [-1, 1], r: [1, -1], fl: [0, 1], fr: [1, 0], bl: [0, -1], br: [-1, 0] };
  let padDir = null, wasDriving = false, visible = false;
  const keys = new Set();
  let motors = { left: 0, right: 0, source: 'idle' };

  const speed = $('#speed');
  try { const v = localStorage.getItem('mc.speed'); if (v) speed.value = v; } catch (_) {}
  $('#speedOut').textContent = speed.value;
  speed.oninput = () => { $('#speedOut').textContent = speed.value; try { localStorage.setItem('mc.speed', speed.value); } catch (_) {} };
  // Smooth driving: keys and a game controller set a target throttle / steering; the car follows it with a short ramp
  // (no jerks, no wheelies), steering while driving makes a curve (both sides keep turning), on the spot it pivots.
  // W/S or ↑/↓ = forward / back · A/D or ←/→ = steer · Q/E = spin on the spot · Shift = full speed · 1–5 = speed 20–100 %
  // Space = stop. Controller: left stick (or triggers) to drive, B / circle = stop.
  const ctl = { thr: 0, steer: 0, src: '' };
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  const toward = (v, t, up, down, dt) => { const rate = Math.abs(t) > Math.abs(v) && Math.sign(t) !== -Math.sign(v) ? up : down; const d = t - v; return Math.abs(d) <= rate * dt ? t : v + Math.sign(d) * rate * dt; };
  function padInput() {
    const gp = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find((g) => g && g.connected && g.axes.length >= 2);
    if (!gp) return null;
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    const thr = rt || lt ? rt - lt : -dz(gp.axes[1]);
    const steer = dz(gp.axes[0]);
    const stop = gp.buttons[1] && gp.buttons[1].pressed;
    if (stop) return { stop: true };
    return thr || steer ? { thr, steer, boost: gp.buttons[0] && gp.buttons[0].pressed } : { idle: true };
  }
  let lastT = performance.now(), padStop = false;
  setInterval(() => {
    const now = performance.now(), dt = Math.min(0.2, (now - lastT) / 1000); lastT = now;
    const k = (x) => keys.has(x);
    const pad = padInput();
    if (pad && pad.stop) { if (!padStop) { send({ type: 'stop' }); ctl.thr = ctl.steer = 0; } padStop = true; return; }
    padStop = false;
    let thrT = 0, steerT = 0, spin = 0, boost = k('shift'), src = '';
    if (visible) {
      thrT = (k('w') || k('arrowup') ? 1 : 0) - (k('s') || k('arrowdown') ? 1 : 0);
      steerT = (k('d') || k('arrowright') ? 1 : 0) - (k('a') || k('arrowleft') ? 1 : 0);
      spin = (k('e') ? 1 : 0) - (k('q') ? 1 : 0);
      if (thrT || steerT || spin) src = 'keys';
    }
    if (pad && !pad.idle && !src) { thrT = pad.thr; steerT = pad.steer; boost = boost || pad.boost; src = 'controller'; }
    if (padDir) { // the on-screen pad drives directly
      const s = Number(speed.value); send({ type: 'drive', left: DIRS[padDir][0] * s, right: DIRS[padDir][1] * s }); wasDriving = true; ctl.thr = ctl.steer = 0;
    } else {
      if (spin) { thrT = 0; steerT = spin; }
      ctl.thr = toward(ctl.thr, thrT, 3.5, 7, dt);      // 0 → full in ~0.3 s, stops in ~0.15 s
      ctl.steer = toward(ctl.steer, steerT, 6, 9, dt);
      const s = boost ? 100 : Number(speed.value);
      let l, r;
      if (Math.abs(ctl.thr) < 0.05) { l = ctl.steer; r = -ctl.steer; }          // pivot on the spot
      else { const k2 = 0.55 * Math.abs(ctl.thr); l = ctl.thr + ctl.steer * k2; r = ctl.thr - ctl.steer * k2; const m = Math.max(1, Math.abs(l), Math.abs(r)); l /= m; r /= m; }
      if (Math.abs(l) > 0.01 || Math.abs(r) > 0.01) { send({ type: 'drive', left: Math.round(clamp1(l) * s), right: Math.round(clamp1(r) * s) }); wasDriving = true; ctl.src = src; }
      else if (wasDriving) { send({ type: 'drive', left: 0, right: 0 }); wasDriving = false; }
    }
    const shown = padDir || (ctl.thr > 0.05 ? (ctl.steer > 0.2 ? 'fr' : ctl.steer < -0.2 ? 'fl' : 'f') : ctl.thr < -0.05 ? (ctl.steer > 0.2 ? 'br' : ctl.steer < -0.2 ? 'bl' : 'b') : ctl.steer > 0.2 ? 'r' : ctl.steer < -0.2 ? 'l' : null);
    document.querySelectorAll('#pad button[data-dir]').forEach((b) => b.classList.toggle('active', b.dataset.dir === shown));
  }, 50);
  document.querySelectorAll('#pad button[data-dir]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { padDir = b.dataset.dir; b.setPointerCapture(e.pointerId); });
    const end = () => { if (padDir === b.dataset.dir) padDir = null; };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('lostpointercapture', end);
  });
  $('#btnRobotStop').onclick = () => { padDir = null; keys.clear(); ctl.thr = ctl.steer = 0; send({ type: 'stop' }); };
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const SPEEDS = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 100 };
  window.addEventListener('keydown', (e) => {
    if (!visible || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); keys.clear(); ctl.thr = ctl.steer = 0; send({ type: 'stop' }); return; }
    if (SPEEDS[k]) { speed.value = SPEEDS[k]; speed.oninput(); return; }
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); padDir = null; });

  $('#carForm').onsubmit = async (e) => {
    e.preventDefault();
    await window.MCapi('/api/settings', { body: { robot: { carIp: $('#carIp').value.trim() } } });
    window.MCtoast('Car address saved');
  };

  function setBar(el, v) { const p = Math.abs(v) / 2; el.style.width = p + '%'; el.style.left = v >= 0 ? '50%' : (50 - p) + '%'; el.classList.toggle('neg', v < 0); }
  function onMotors(m) { motors = m; try { hudMotors(m); } catch (_) {} setBar($('#barL'), m.left); setBar($('#barR'), m.right); $('#valL').textContent = Math.round(m.left); $('#valR').textContent = Math.round(m.right); $('#motorSrc').textContent = m.source; }
  $('#btnFindCar').onclick = async () => {
    const info = $('#findInfo'); const btn = $('#btnFindCar');
    btn.disabled = true; info.textContent = 'Searching your network (≈10 s)…';
    try {
      const r = await window.MCapi('/api/robot/find', { body: {} });
      if (!r.found.length) info.textContent = 'No car found. Is it switched on and set up on your Wi-Fi (http://192.168.4.1/setup from its hotspot)?';
      else if (r.found.length === 1) { info.textContent = `Found Baby Carpathron at ${r.carIp} ✓`; $('#carIp').value = r.carIp; }
      else info.textContent = `Found ${r.found.length}: ${r.found.map((f) => f.ip).join(', ')} — type the one you want.`;
    } catch (e) { info.textContent = e.message; } finally { btn.disabled = false; }
  };
  async function showPair() {
    const el = $('#questPair');
    if (sessionTypeKnown()) { el.innerHTML = ''; return; } // already on the Quest
    try {
      const a = await window.MCapi('/api/access');
      el.innerHTML = '';
      const url = a.pairUrls[0];
      if (!url) { el.textContent = 'Connect this PC to Wi-Fi to pair the Quest.'; return; }
      if (!a.lanAccess) {
        const btn = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Allow phones and Quest on this network' });
        btn.onclick = async () => { await window.MCapi('/api/settings', { body: { lanAccess: true } }); showPair(); };
        el.append(Object.assign(document.createElement('div'), { className: 'small muted', textContent: 'The Quest and phones connect over Wi-Fi. Network access is off (only this PC can connect).' }), btn);
        return;
      }
      el.append(
        Object.assign(document.createElement('div'), { className: 'small muted', textContent: 'On the Quest 3S: open the Browser, go to' }),
        Object.assign(document.createElement('div'), { className: 'pairurl', textContent: url }),
        Object.assign(document.createElement('div'), { className: 'small muted', textContent: 'accept the certificate warning (Advanced → Proceed), then enter the PIN:' }),
        Object.assign(document.createElement('div'), { className: 'pin', textContent: a.pin.replace(/(\d{3})/, '$1 ') }),
        Object.assign(document.createElement('div'), { className: 'small muted', textContent: `PIN valid ${Math.max(1, Math.round(a.pinExpiresIn / 60))} min, works once. Same steps for a phone.` }));
    } catch { el.innerHTML = ''; } // not on the PC
  }
  const sessionTypeKnown = () => /OculusBrowser|Quest/i.test(navigator.userAgent);
  let videoOn = false;
  function setVideo(on) {
    const card = $('#liveCard'), img = $('#carVideo');
    card.hidden = !on;
    if (on && visible && !videoOn) { img.src = '/api/robot/stream?v=' + Date.now(); videoOn = true; }
    if ((!on || !visible) && videoOn) { img.removeAttribute('src'); videoOn = false; }
  }
  // 2.2.5: the Meta Quest view (what the headset user sees), shown while the headset sends it
  let questOn = false, questOffT = null;
  async function questPoll() {
    try {
      const v = await (await fetch('/api/avatar/view', { credentials: 'same-origin' })).json();
      const wrap = $('#questWrap'), img = $('#questVideo'), mode = $('#questMode'), wait = $('#questWait');
      if (v.live) {
        clearTimeout(questOffT); questOffT = null;
        mode.textContent = v.mode === 'room' ? 'Carpathron in my room · live' : v.mode === 'tour' ? 'virtual tour · live' : v.mode === 'robot' ? 'robot · live' : 'live';
        mode.classList.add('ok');
        if (!questOn) { wrap.hidden = false; wait.hidden = true; img.src = '/api/avatar/view.mjpg?v=' + Date.now(); questOn = true; }
      } else if (questOn && !questOffT) {
        questOffT = setTimeout(() => { wrap.hidden = true; wait.hidden = false; mode.textContent = 'waiting for the headset'; mode.classList.remove('ok'); img.removeAttribute('src'); questOn = false; questOffT = null; }, 6000);
      }
    } catch (_) {}
  }
  setInterval(questPoll, 2000); questPoll();
  // 2.3: what you say to Carpathron in the headset and what he answers (shown under the Quest view)
  const feed = [];
  function onCompanion(d) {
    const el = $('#companionFeed'); if (!el || !d) return;
    feed.push(d); if (feed.length > 4) feed.shift();
    el.hidden = false; el.innerHTML = '';
    for (const x of feed) {
      if (x.heard) { const y = document.createElement('div'); y.className = 'cf-you'; y.textContent = x.heard; el.append(y); }
      const c = document.createElement('div'); c.className = 'cf-bot';
      c.textContent = x.say + (x.action && x.action !== 'none' ? `  ·  ${x.action}${x.target ? ' ' + x.target : ''}${x.mode === 'real' ? ' (the car)' : ''}` : '');
      el.append(c);
    }
    el.scrollTop = el.scrollHeight;
  }
  // 2.3.5: his voice on the PC speakers too (on by default while the Quest view is shown), so a PC screen recording
  // of the headset view has what he says; the headset plays the same files
  const voiceHere = $('#questVoiceHere');
  try { if (voiceHere) voiceHere.checked = localStorage.getItem('mc.questVoice') !== '0'; } catch (_) {}
  if (voiceHere) voiceHere.onchange = () => { try { localStorage.setItem('mc.questVoice', voiceHere.checked ? '1' : '0'); } catch (_) {} };
  let vq = Promise.resolve();
  function onCompanionVoice(d) {
    if (!d || !Array.isArray(d.audio) || !questOn || !voiceHere || !voiceHere.checked) return;
    for (const u of d.audio) {
      const src = String(u).replace(/^\/avatar\/speech\//, '/api/avatar/speech/');
      vq = vq.then(() => new Promise((done) => { const a = new Audio(src); a.onended = done; a.onerror = done; a.play().catch(done); }));
    }
  }
  $('#btnQuestFull').onclick = () => { const w = $('#questVideo'); (w.requestFullscreen || w.webkitRequestFullscreen || (() => {})).call(w); };
  let ledT;
  $('#carLed').oninput = (e) => { clearTimeout(ledT); ledT = setTimeout(() => window.MCapi('/api/robot/led', { body: { v: Number(e.target.value) } }).catch(() => {}), 120); };
  // Driving display over the live video: heading tape, distance ahead with a colour bar, Wi-Fi, blocked warning, wheels.
  const hudOn = $('#hudOn');
  try { hudOn.checked = localStorage.getItem('mc.hud') !== '0'; } catch (_) {}
  const hudShow = () => { $('#hud').hidden = !hudOn.checked; };
  hudOn.onchange = () => { try { localStorage.setItem('mc.hud', hudOn.checked ? '1' : '0'); } catch (_) {} hudShow(); };
  hudShow();
  (() => { const tape = $('#hudTape'); for (let d = -360; d <= 720; d += 15) { const deg = ((d % 360) + 360) % 360; const t = document.createElement('span'); t.textContent = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] || (deg % 45 === 0 ? String(deg) : '|'); t.className = deg % 45 === 0 ? 'big' : ''; t.style.left = `${(d + 360) * 4}px`; tape.append(t); } })();
  function hud(st) {
    const sn = st.sensors || {};
    const yaw = sn.imu ? Number(sn.yaw) || 0 : null;
    $('#hudHead').textContent = yaw == null ? 'no gyro' : `${Math.round(((yaw % 360) + 360) % 360)}°`;
    $('#hudTape').style.transform = `translateX(${-((yaw || 0) + 360) * 4}px)`;
    $('#hudTape').parentElement.style.opacity = yaw == null ? 0.25 : 1;
    const d = sn.tof ? Number(sn.dist) : null;
    const pct = d == null || d < 0 ? 0 : Math.max(0, Math.min(100, 100 - (d / 2000) * 100));
    $('#hudDistFill').style.width = `${pct}%`;
    $('#hudDistFill').className = d != null && d > 0 && d < 300 ? 'near' : d != null && d > 0 && d < 700 ? 'mid' : 'far';
    $('#hudDist').textContent = d == null ? (sn.ir ? `IR ${sn.irLeft ? '⛔' : '✓'} ${sn.irRight ? '⛔' : '✓'}` : 'no distance sensor') : d < 0 ? 'clear > 2 m' : `${Math.round(d / 10)} cm`;
    $('#hudBlock').hidden = !sn.blocked;
    const r = st.rssi;
    $('#hudLink').textContent = r ? `Wi-Fi ${r >= -60 ? '▂▄▆█' : r >= -70 ? '▂▄▆' : r >= -78 ? '▂▄' : '▂'} ${r} dBm` : 'Wi-Fi —';
    $('#hudLink').className = `hud-chip ${r && r < -75 ? 'bad' : ''}`;
  }
  function hudMotors(m) { const set = (el, v) => { el.style.height = `${Math.abs(v) / 2}%`; el.style.bottom = v >= 0 ? '50%' : `${50 - Math.abs(v) / 2}%`; el.classList.toggle('neg', v < 0); }; set($('#hudL'), m.left); set($('#hudR'), m.right); }
  function onStatus(st) {
    hud(st);
    setVideo(st.state === 'online' && !!st.camera);
    const pill = $('#robotPill');
    const fwName = { 'kit-web': ' · factory program', 'kit-app': ' · factory program (APP)', carpathron: '' }[st.firmware] || '';
    const label = { online: `car online · ${st.ip}${fwName}${st.rssi ? ` · Wi-Fi ${st.rssi} dBm` : ''}`, connecting: `connecting to ${st.ip}…`, offline: `car offline · ${st.ip} (retrying)`, simulated: 'simulation (no car IP)' }[st.state] || st.state;
    pill.textContent = label;
    pill.className = 'pill ' + ({ online: 'ok', offline: 'bad' }[st.state] || 'warn');
    if (!document.querySelector('.sim-card.sim3d-on')) $('#simLabel').textContent = st.state === 'online' ? 'Simulation — mirrors the real car' : 'Simulation — virtual Baby Carpathron';
    if (st.motors) onMotors(st.motors);
  }

  // simulation
  const cv = $('#sim'), ctx = cv.getContext('2d');
  let bot, trail;
  const reset = () => { bot = { x: 0, y: 0, a: -Math.PI / 2 }; trail = []; };
  reset();
  $('#btnSimReset').onclick = reset;
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const vl = motors.left / 100 * 0.7, vr = motors.right / 100 * 0.7;
    const v = (vl + vr) / 2, w = (vr - vl) / 0.15;
    bot.a += w * dt * 0.55; bot.x += Math.cos(bot.a) * v * dt * 200; bot.y += Math.sin(bot.a) * v * dt * 200;
    if (v || w) { trail.push([bot.x, bot.y]); if (trail.length > 1500) trail.shift(); }
    if (visible) draw();
    requestAnimationFrame(loop);
  }
  function draw() {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const W = cv.width / dpr, H = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const ox = W / 2 - bot.x, oy = H / 2 - bot.y, g = 40;
    ctx.strokeStyle = '#17212c'; ctx.lineWidth = 1;
    for (let x = ((ox % g) + g) % g; x < W; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = ((oy % g) + g) % g; y < H; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(61,220,151,.45)'; ctx.lineWidth = 2; ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy))); ctx.stroke();
    ctx.save(); ctx.translate(bot.x + ox, bot.y + oy); ctx.rotate(bot.a + Math.PI / 2);
    ctx.fillStyle = '#26323f'; for (const [wx, wy] of [[-17, -14], [11, -14], [-17, 6], [11, 6]]) ctx.fillRect(wx, wy, 6, 12);
    ctx.fillStyle = '#0f2a1f'; ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-12, -20, 24, 36, 6); else ctx.rect(-12, -20, 24, 36); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3ddc97'; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(6, -6); ctx.lineTo(-6, -6); ctx.fill();
    ctx.restore();
  }
  requestAnimationFrame(loop);

  // Quest WebXR
  let xrMode = 'tank', sessionType = null;
  document.querySelectorAll('#xrMode button').forEach((b) => (b.onclick = () => { xrMode = b.dataset.mode; document.querySelectorAll('#xrMode button').forEach((x) => x.classList.toggle('on', x === b)); }));
  (async () => {
    const note = $('#xrNote');
    if (!navigator.xr) return;
    try {
      if (await navigator.xr.isSessionSupported('immersive-ar')) sessionType = 'immersive-ar';
      else if (await navigator.xr.isSessionSupported('immersive-vr')) sessionType = 'immersive-vr';
    } catch {}
    if (sessionType) { $('#btnEnterXR').disabled = false; note.textContent = sessionType === 'immersive-ar' ? 'Ready — passthrough: you see the real car. A or X = STOP.' : 'Ready — VR mode. A or X = STOP.'; }
    try { if (await navigator.xr.isSessionSupported('immersive-vr')) $('#btnRobotEyes').disabled = false; } catch {}
  })();
  // On the Quest browser: put the Quest card first, big buttons.
  if (/OculusBrowser|Quest/i.test(navigator.userAgent)) {
    const qc = $('#questCtlCard'); qc.parentNode.prepend(qc); qc.classList.add('quest-first');
  }
  let lastSettings = {};
  $('#btnRobotEyes').onclick = async () => {
    try {
      await window.MCRobotEyes.start({ send, api: window.MCapi, settings: lastSettings, mode: xrMode, speedPct: Number(speed.value) || 100, onNote: (t) => ($('#xrNote').textContent = t) });
      $('#xrNote').textContent = 'Robot eyes running — take the headset off or press the Meta button to leave (the car stops).';
    } catch (e) { $('#xrNote').textContent = 'Could not start VR: ' + e.message; }
  };
  const DEAD = 0.15, dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD)), cl = (v) => Math.max(-100, Math.min(100, v));
  $('#btnEnterXR').onclick = async () => {
    let session;
    try { session = await navigator.xr.requestSession(sessionType, { optionalFeatures: ['local-floor'] }); }
    catch (e) { $('#xrNote').textContent = 'Could not start XR: ' + e.message; return; }
    let gl;
    try {
      const canvas = document.createElement('canvas');
      gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
      if (gl.makeXRCompatible) await gl.makeXRCompatible();
      session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    } catch (e) {
      $('#xrNote').textContent = 'Could not start the headset view: ' + e.message;
      try { await session.end(); } catch {}
      return;
    }
    let lastSend = 0, stopped = false, wasMoving = false;
    const frame = (t) => {
      session.requestAnimationFrame(frame);
      const layer = session.renderState.baseLayer;
      if (layer) gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      if (sessionType === 'immersive-ar') gl.clearColor(0, 0, 0, 0); else gl.clearColor(0.02, 0.06, 0.12, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      let ly = 0, ry = 0, rx = 0, stop = false;
      for (const src of session.inputSources) {
        const gp = src.gamepad; if (!gp) continue;
        const x = dz(gp.axes[2] || 0), y = dz(gp.axes[3] || 0);
        if (src.handedness === 'left') ly = -y;
        if (src.handedness === 'right') { ry = -y; rx = x; }
        if (gp.buttons[4] && gp.buttons[4].pressed) { stop = true; const hp = gp.hapticActuators && gp.hapticActuators[0]; if (hp && hp.pulse) hp.pulse(0.6, 80); }
      }
      if (stop) { if (!stopped) { send({ type: 'stop', by: 'quest' }); stopped = true; } return; }
      stopped = false;
      if (t - lastSend < 50) return;
      lastSend = t;
      let left = xrMode === 'tank' ? ly * 100 : (ry + rx) * 100, right = xrMode === 'tank' ? ry * 100 : (ry - rx) * 100;
      left = cl(left); right = cl(right);
      const moving = Math.abs(left) > 1 || Math.abs(right) > 1;
      if (moving || wasMoving) send({ type: 'drive', left: moving ? left : 0, right: moving ? right : 0, by: 'quest' });
      wasMoving = moving;
    };
    session.requestAnimationFrame(frame);
    session.addEventListener('end', () => send({ type: 'stop', by: 'quest' }));
  };

  const camKey = 'mc-cam-offer';
  window.MCcamOffer = () => { try { return localStorage.getItem(camKey) === '1'; } catch { return false; } };
  $('#camOffer').checked = window.MCcamOffer();
  $('#camOffer').onchange = async (e) => {
    try { localStorage.setItem(camKey, e.target.checked ? '1' : '0'); } catch {}
    if (e.target.checked) {
      try { const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } }); st.getTracks().forEach((t) => t.stop()); }
      catch (err) { window.MCtoast(`Camera not available here: ${err.message}`, true); e.target.checked = false; try { localStorage.setItem(camKey, '0'); } catch {} return; }
    }
    window.MCreconnect();
    window.MCtoast(e.target.checked ? 'This device is now the robot camera' : 'Camera turned off on this device');
  };
  $('#camForm').onsubmit = async (e) => {
    e.preventDefault();
    await window.MCapi('/api/settings', { body: { robot: { cameraUrl: $('#camUrl').value.trim() } } });
    window.MCtoast('Camera saved');
  };
  function showPhoto(p, source) {
    const img = $('#camPreview');
    img.src = window.MCphotoUrl(p) + '&v=' + Date.now();
    img.hidden = false;
    $('#camInfo').textContent = `${source || ''} · ${new Date().toLocaleTimeString()} · ${p}`;
  }
  $('#btnPhoto').onclick = async () => {
    $('#btnPhoto').disabled = true; $('#camInfo').textContent = 'Taking photo…';
    try {
      const r = await window.MCapi('/api/camera/capture', { body: {} });
      if (r.error) { $('#camInfo').textContent = r.error; window.MCtoast(r.error, true); } else showPhoto(r.path, r.source);
    } finally { $('#btnPhoto').disabled = false; }
  };

  // ---- robot head (look) + room map + turn calibration
  document.querySelectorAll('#headCard [data-look]').forEach((b) => {
    b.onclick = async () => {
      const dir = b.dataset.look;
      $('#scanInfo').textContent = `Looking ${dir}…`;
      document.querySelectorAll('#headCard [data-look]').forEach((x) => (x.disabled = true));
      try {
        const r = await window.MCapi('/api/robot/look', { body: { direction: dir } });
        if (!r.ok) { $('#scanInfo').textContent = r.error; window.MCtoast(r.error, true); }
        else { showPhoto(r.path, `looked ${dir}`); $('#scanInfo').textContent = `Looked ${dir} and turned back.`; }
      } finally { document.querySelectorAll('#headCard [data-look]').forEach((x) => (x.disabled = false)); }
    };
  });
  function showMap(id) {
    const img = $('#mapImg');
    img.src = `/api/robot/maps/${encodeURIComponent(id)}/map.svg?v=${Date.now()}`;
    img.hidden = false;
  }
  $('#btnScan').onclick = async () => {
    $('#btnScan').disabled = true;
    $('#scanInfo').textContent = 'Starting the room scan…';
    const r = await window.MCapi('/api/robot/scan', { body: { steps: 8 } }).catch((e) => ({ error: e.message }));
    if (!r || r.error) { $('#scanInfo').textContent = (r && r.error) || 'failed'; $('#btnScan').disabled = false; }
  };
  $('#turnForm').onsubmit = async (e) => {
    e.preventDefault();
    await window.MCapi('/api/settings', { body: { robot: { turnMs360: Number($('#turnMs').value), turnSpeed: Number($('#turnSpeed').value) } } });
    window.MCtoast('Turn calibration saved');
  };
  const turnTest = async (deg) => {
    const r = await window.MCapi('/api/robot/turn', { body: { degrees: deg } });
    window.MCtoast(r.ok ? `Turned ${deg}°` : r.error, !r.ok);
  };
  $('#btnTurnTest').onclick = () => turnTest(360);
  $('#btnTurn90').onclick = () => turnTest(90);
  async function loadLastMap() {
    try { const maps = await window.MCapi('/api/robot/maps'); if (maps && maps[0]) { showMap(maps[0].id); $('#scanInfo').textContent = `Last map: ${maps[0].id.replace('T', ' ')}`; } } catch {}
  }

  window.MCRobot = {
    onCompanion,
    onCompanionVoice,
    onPhoto: (d) => showPhoto(d.path, d.source),
    show: async (S) => {
      visible = true;
      showPair();
      $('#carIp').value = (S.settings.robot && S.settings.robot.carIp) || '';
      $('#camUrl').value = (S.settings.robot && S.settings.robot.cameraUrl) || '';
      lastSettings = S.settings;
      $('#turnMs').value = (S.settings.robot && S.settings.robot.turnMs360) || 2400;
      $('#turnSpeed').value = (S.settings.robot && S.settings.robot.turnSpeed) || 70;
      loadLastMap();
      try { onStatus(await window.MCapi('/api/robot')); } catch {}
    },
    onEvent: (ev, d) => {
      if (ev === 'robot:status') onStatus(d);
      else if (ev === 'robot:motors') onMotors(d);
      else if (ev === 'robot:scan') { $('#scanInfo').textContent = d.text; if (d.error || /ready/.test(d.text)) $('#btnScan').disabled = false; }
      else if (ev === 'robot:map') { showMap(d.id); $('#btnScan').disabled = false; const p3 = document.getElementById('plan3dCard'); if (window.MC3d && p3) window.MC3d.render(p3); }
    },
  };
  // pause keyboard driving when leaving the robot page
  document.querySelectorAll('#nav button, #btnNewChat').forEach((b) => b.addEventListener('click', () => { visible = b.dataset.view === 'robot'; }));
  document.getElementById('chatList').addEventListener('click', () => { visible = false; setVideo(false); });
  document.querySelectorAll('#nav button, #btnNewChat').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view !== 'robot') setVideo(false); }));
})();
