// "Robot eyes" VR mode for Meta Quest 3S (WebXR immersive-vr, plain WebGL, no libraries).
// You sit inside the robot: the car's live camera fills a big screen in front of you,
// thumbsticks drive, and (optional) head steering turns the car when you turn your head,
// so the camera follows your gaze like a robot head. A status panel shows speed, signal and help.
//
// Controls (Touch controllers):
//   Tank:   left stick = left wheels, right stick = right wheels      Arcade: right stick drives
//   A / X           STOP (always)
//   B               take a photo (saved, shown on the panel)
//   Y               head steering on/off
//   Right trigger   hold for turbo (100 %), otherwise max speed = the Speed slider
//   Left grip       look behind (car turns 180°, photo, turns back)
//   Both grips      scan the room
'use strict';
(() => {
  const M = {
    persp: null,
    mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
    rotY(r) { const c = Math.cos(r), s = Math.sin(r); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    trs(x, y, z, sx, sy) { return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, x, y, z, 1]); },
  };
  // yaw (radians, + = turned left / counter-clockwise seen from above) of an XR orientation quaternion
  const yawOf = (q) => Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function program(gl) {
    const vs = `attribute vec2 p; uniform mat4 mvp; varying vec2 uv; void main(){ uv = vec2(p.x*0.5+0.5, 0.5-p.y*0.5); gl_Position = mvp*vec4(p,0.0,1.0); }`;
    const fs = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float dim; void main(){ vec4 c = texture2D(tex, uv); gl_FragColor = vec4(c.rgb*dim, c.a); }`;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    return { pr, buf, mvp: gl.getUniformLocation(pr, 'mvp'), dim: gl.getUniformLocation(pr, 'dim'), p: gl.getAttribLocation(pr, 'p') };
  }
  function texture(gl) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 14, 20, 255]));
    return t;
  }

  async function start({ send, api, settings, mode = 'tank', speedPct = 100, onNote = () => {} }) {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser');
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: false, antialias: true });
    try { if (gl.makeXRCompatible) await gl.makeXRCompatible(); session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) }); }
    catch (e) { try { await session.end(); } catch {} throw e; }
    let space;
    try { space = await session.requestReferenceSpace('local'); } catch { space = null; }

    // live video from the car (same-origin MJPEG proxy, so WebGL may read it)
    const video = new Image();
    video.src = `/api/robot/stream?v=${Date.now()}`;
    video.onerror = () => setTimeout(() => { video.src = `/api/robot/stream?v=${Date.now()}`; }, 1500);
    const panel = document.createElement('canvas'); panel.width = 1024; panel.height = 256;
    const pctx = panel.getContext('2d');

    const P = program(gl), videoTex = texture(gl), panelTex = texture(gl);
    const r = settings.robot || {};
    const degPerMsAtFull = 360 / (Number(r.turnMs360) || 2400) / ((Number(r.turnSpeed) || 70) / 100); // calibrated turn rate
    const st = { headSteer: true, screenYaw: null, lastSend: 0, stopped: false, wasMoving: false, prevBtn: {}, info: 'Robot eyes ready', infoAt: 0, l: 0, r: 0, busy: false, lastT: 0, rssi: null };
    const DEAD = 0.15, dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD)), cl = (v) => Math.max(-100, Math.min(100, v));
    const say = (t) => { st.info = t; st.infoAt = performance.now(); };
    const action = async (label, fn) => { if (st.busy) return; st.busy = true; say(label + '…'); try { say(await fn()); } catch (e) { say(e.message); } finally { st.busy = false; } };
    const statusTimer = setInterval(() => api('/api/robot').then((s) => { st.rssi = s.rssi; st.online = s.state === 'online'; }).catch(() => {}), 2000);

    function drawPanel() {
      pctx.fillStyle = '#0d0f12'; pctx.fillRect(0, 0, 1024, 256);
      pctx.fillStyle = '#e8eaed'; pctx.font = '600 38px Segoe UI, Arial'; pctx.fillText('Baby Carpathron · robot eyes', 28, 52);
      pctx.font = '30px Segoe UI, Arial'; pctx.fillStyle = st.online === false ? '#ff5b6b' : '#3fb37f';
      pctx.fillText(`${st.online === false ? 'car offline' : 'car online'}${st.rssi ? ` · Wi-Fi ${st.rssi} dBm` : ''} · wheels L ${Math.round(st.l)} / R ${Math.round(st.r)} · head steering ${st.headSteer ? 'ON' : 'off'}`, 28, 100);
      pctx.fillStyle = '#ffb347'; pctx.fillText(performance.now() - st.infoAt < 6000 ? st.info : '', 28, 150);
      pctx.fillStyle = '#9aa0a6'; pctx.font = '24px Segoe UI, Arial';
      pctx.fillText(`${mode === 'tank' ? 'Sticks: left/right wheels' : 'Right stick drives'} · A/X STOP · B photo · Y head steering · trigger turbo`, 28, 200);
      pctx.fillText('Left grip: look behind · both grips: scan the room · turn your head to turn the car', 28, 236);
      gl.bindTexture(gl.TEXTURE_2D, panelTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel);
    }

    let panelAt = 0;
    const onFrame = (t, frame) => {
      session.requestAnimationFrame(onFrame);
      const dt = st.lastT ? Math.min(100, t - st.lastT) : 16; st.lastT = t;
      const pose = space && frame.getViewerPose ? frame.getViewerPose(space) : null;
      const headYaw = pose ? yawOf(pose.transform.orientation) : 0;
      if (st.screenYaw === null && pose) st.screenYaw = headYaw;

      // ---- input
      let ly = 0, ry = 0, rx = 0, stop = false, turbo = false, btn = {};
      for (const src of session.inputSources) {
        const gp = src.gamepad; if (!gp) continue;
        const x = dz(gp.axes[2] || 0), y = dz(gp.axes[3] || 0);
        const h = src.handedness;
        if (h === 'left') ly = -y;
        if (h === 'right') { ry = -y; rx = x; }
        const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        if (b(4)) { stop = true; const hp = gp.hapticActuators && gp.hapticActuators[0]; if (hp && hp.pulse) hp.pulse(0.6, 80); }
        if (h === 'right') { btn.B = b(5); turbo = (gp.buttons[0] && gp.buttons[0].value > 0.5); btn.RG = b(1); }
        if (h === 'left') { btn.Y = b(5); btn.LG = b(1); }
      }
      const pressed = (k) => btn[k] && !st.prevBtn[k];
      if (pressed('Y')) { st.headSteer = !st.headSteer; say(`Head steering ${st.headSteer ? 'ON' : 'off'}`); }
      if (pressed('B')) action('Taking photo', async () => { const r2 = await api('/api/camera/capture', { body: {} }); return r2.error ? r2.error : 'Photo saved'; });
      if (btn.LG && btn.RG && (pressed('LG') || pressed('RG'))) action('Scanning the room (the car turns a full circle)', async () => { await api('/api/robot/scan', { body: { steps: 8 } }); return 'Room scan started — the map appears on the Robot page'; });
      else if (pressed('LG') && !btn.RG) action('Looking behind', async () => { const r2 = await api('/api/robot/look', { body: { direction: 'back' } }); return r2.ok ? 'Looked behind (photo saved)' : r2.error; });
      st.prevBtn = btn;

      // ---- drive
      const max = turbo ? 100 : speedPct;
      let left = mode === 'tank' ? ly * max : (ry + rx) * max, right = mode === 'tank' ? ry * max : (ry - rx) * max;
      // head steering: if you look more than 15° away from the screen and are not using the sticks, the car turns towards your gaze
      let steering = 0;
      if (st.headSteer && pose && st.screenYaw !== null && Math.abs(left) < 2 && Math.abs(right) < 2 && !st.busy) {
        const off = wrap(headYaw - st.screenYaw); // + = you look left
        const deg = (off * 180) / Math.PI;
        // start turning past 15°, keep turning until the car faces within 3° of your gaze (no jitter)
        if (Math.abs(deg) > 15) st.steerOn = true;
        if (Math.abs(deg) < 3) st.steerOn = false;
        if (st.steerOn) {
          const spd = Math.min(75, 45 + Math.abs(deg) / 2);
          steering = Math.sign(deg) * spd; // + = turn left
          left = -steering; right = steering;
          // the car (and its camera) turns, so the screen follows your head at the car's calibrated turn rate
          const turned = ((degPerMsAtFull * (spd / 100) * dt) * Math.PI) / 180;
          st.screenYaw = wrap(st.screenYaw + Math.sign(off) * Math.min(Math.abs(off), turned));
        }
      }
      left = cl(left); right = cl(right);
      st.l = left; st.r = right;
      if (stop) { if (!st.stopped) { send({ type: 'stop', by: 'quest' }); st.stopped = true; say('STOP'); } }
      else {
        st.stopped = false;
        if (t - st.lastSend >= 50) {
          st.lastSend = t;
          const moving = Math.abs(left) > 1 || Math.abs(right) > 1;
          if (moving || st.wasMoving) send({ type: 'drive', left: moving ? left : 0, right: moving ? right : 0, by: 'quest' });
          st.wasMoving = moving;
        }
      }

      // ---- draw
      const layer = session.renderState.baseLayer;
      if (layer) gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0.03, 0.04, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (video.complete && video.naturalWidth) {
        gl.bindTexture(gl.TEXTURE_2D, videoTex);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch {}
      }
      if (t - panelAt > 200) { panelAt = t; drawPanel(); }
      if (!pose || !layer) return;
      gl.useProgram(P.pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, P.buf);
      gl.enableVertexAttribArray(P.p);
      gl.vertexAttribPointer(P.p, 2, gl.FLOAT, false, 0, 0);
      const world = M.rotY(st.screenYaw || 0);
      const screenM = M.mul(world, M.trs(0, 0.05, -2.2, 1.6, 1.2));   // 3.2 m x 2.4 m screen, 2.2 m away (4:3 like the camera)
      const panelM = M.mul(world, M.trs(0, -1.32, -2.0, 0.9, 0.225)); // status panel below it
      for (const view of pose.views) {
        const vp = layer.getViewport(view);
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        const pv = M.mul(view.projectionMatrix, view.transform.inverse.matrix);
        gl.uniform1f(P.dim, st.online === false ? 0.45 : 1.0);
        gl.bindTexture(gl.TEXTURE_2D, videoTex);
        gl.uniformMatrix4fv(P.mvp, false, M.mul(pv, screenM));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.uniform1f(P.dim, 1.0);
        gl.bindTexture(gl.TEXTURE_2D, panelTex);
        gl.uniformMatrix4fv(P.mvp, false, M.mul(pv, panelM));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
    session.requestAnimationFrame(onFrame);
    session.addEventListener('end', () => { send({ type: 'stop', by: 'quest' }); clearInterval(statusTimer); video.src = ''; onNote('Left robot eyes — car stopped.'); });
    return session;
  }

  window.MCRobotEyes = { start, _math: { M, yawOf, wrap } };
})();
