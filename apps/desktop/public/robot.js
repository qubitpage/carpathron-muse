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
  const keyDir = () => {
    const up = keys.has('w') || keys.has('arrowup'), dn = keys.has('s') || keys.has('arrowdown');
    const lf = keys.has('a') || keys.has('arrowleft'), rt = keys.has('d') || keys.has('arrowright');
    if (up && lf) return 'fl'; if (up && rt) return 'fr'; if (dn && lf) return 'bl'; if (dn && rt) return 'br';
    if (up) return 'f'; if (dn) return 'b'; if (lf) return 'l'; if (rt) return 'r'; return null;
  };
  setInterval(() => {
    const dir = padDir || (visible ? keyDir() : null);
    if (dir) { const s = Number(speed.value); send({ type: 'drive', left: DIRS[dir][0] * s, right: DIRS[dir][1] * s }); wasDriving = true; }
    else if (wasDriving) { send({ type: 'drive', left: 0, right: 0 }); wasDriving = false; }
    document.querySelectorAll('#pad button[data-dir]').forEach((b) => b.classList.toggle('active', b.dataset.dir === dir));
  }, 50);
  document.querySelectorAll('#pad button[data-dir]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { padDir = b.dataset.dir; b.setPointerCapture(e.pointerId); });
    const end = () => { if (padDir === b.dataset.dir) padDir = null; };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); b.addEventListener('lostpointercapture', end);
  });
  $('#btnRobotStop').onclick = () => { padDir = null; keys.clear(); send({ type: 'stop' }); };
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  window.addEventListener('keydown', (e) => {
    if (!visible || typing()) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); keys.clear(); send({ type: 'stop' }); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.add(k); }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); padDir = null; });

  $('#carForm').onsubmit = async (e) => {
    e.preventDefault();
    await window.MCapi('/api/settings', { body: { robot: { carIp: $('#carIp').value.trim() } } });
    window.MCtoast('Car address saved');
  };

  function setBar(el, v) { const p = Math.abs(v) / 2; el.style.width = p + '%'; el.style.left = v >= 0 ? '50%' : (50 - p) + '%'; el.classList.toggle('neg', v < 0); }
  function onMotors(m) { motors = m; setBar($('#barL'), m.left); setBar($('#barR'), m.right); $('#valL').textContent = Math.round(m.left); $('#valR').textContent = Math.round(m.right); $('#motorSrc').textContent = m.source; }
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
  let ledT;
  $('#carLed').oninput = (e) => { clearTimeout(ledT); ledT = setTimeout(() => window.MCapi('/api/robot/led', { body: { v: Number(e.target.value) } }).catch(() => {}), 120); };
  function onStatus(st) {
    setVideo(st.state === 'online' && !!st.camera);
    const pill = $('#robotPill');
    const fwName = { 'kit-web': ' · factory program', 'kit-app': ' · factory program (APP)', carpathron: '' }[st.firmware] || '';
    const label = { online: `car online · ${st.ip}${fwName}${st.rssi ? ` · Wi-Fi ${st.rssi} dBm` : ''}`, connecting: `connecting to ${st.ip}…`, offline: `car offline · ${st.ip} (retrying)`, simulated: 'simulation (no car IP)' }[st.state] || st.state;
    pill.textContent = label;
    pill.className = 'pill ' + ({ online: 'ok', offline: 'bad' }[st.state] || 'warn');
    $('#simLabel').textContent = st.state === 'online' ? 'Simulation — mirrors the real car' : 'Simulation — virtual Baby Carpathron';
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
    const qc = $('#questCard'); qc.parentNode.prepend(qc); qc.classList.add('quest-first');
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
      else if (ev === 'robot:map') { showMap(d.id); $('#btnScan').disabled = false; }
    },
  };
  // pause keyboard driving when leaving the robot page
  document.querySelectorAll('#nav button, #btnNewChat').forEach((b) => b.addEventListener('click', () => { visible = b.dataset.view === 'robot'; }));
  document.getElementById('chatList').addEventListener('click', () => { visible = false; setVideo(false); });
  document.querySelectorAll('#nav button, #btnNewChat').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view !== 'robot') setVideo(false); }));
})();
