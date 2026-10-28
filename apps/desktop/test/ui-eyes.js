// Simulated Meta Quest 3S in "Robot eyes" VR: fake immersive-vr session with head pose + Touch controllers.
// Checks: live video reaches the WebGL screen, sticks drive, head turn steers the car, buttons work, exit stops the car.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  // a real little JPEG for the video stream
  const jpeg = fs.readFileSync(process.env.JPEG || path.join(__dirname, 'sample.jpg'));
  const car = require('./fake-car').start(18990, 18991, jpeg);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-eyes-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18992, robot: { carIp: '127.0.0.1:18990', turnMs360: 1200, turnSpeed: 70 } }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3S) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.0 Chrome/132.0 VR Safari/537.36' });
  await ctx.addInitScript(() => {
    const pad = () => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })), hapticActuators: [{ pulse: () => Promise.resolve(true) }] });
    const pads = { left: pad(), right: pad() };
    window.__pads = pads;
    window.__head = 0; // yaw radians, + = looking left
    window.__frames = 0; window.__videoUploads = 0;
    const persp = (() => { const f = 1 / Math.tan(0.8), n = 0.1, fa = 100; return new Float32Array([f, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0]); })();
    const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    class FakeSession extends EventTarget {
      constructor() { super(); this.inputSources = [{ handedness: 'left', gamepad: pads.left }, { handedness: 'right', gamepad: pads.right }]; this.renderState = {}; this.cbs = []; this.t = 0;
        this.timer = setInterval(() => { const c = this.cbs; this.cbs = []; this.t += 16; window.__frames++;
          const y = window.__head, q = { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) };
          const pose = { transform: { orientation: q }, views: [{ projectionMatrix: persp, transform: { inverse: { matrix: ident } } }] };
          c.forEach((f) => f(this.t, { getViewerPose: () => pose })); }, 16); }
      updateRenderState(s) { this.renderState = { ...this.renderState, ...s }; }
      requestAnimationFrame(f) { this.cbs.push(f); return 1; }
      requestReferenceSpace() { return Promise.resolve({}); }
      end() { clearInterval(this.timer); this.dispatchEvent(new Event('end')); return Promise.resolve(); }
    }
    window.XRWebGLLayer = class { constructor() { this.framebuffer = null; } getViewport() { return { x: 0, y: 0, width: 500, height: 500 }; } };
    const proto = WebGLRenderingContext.prototype;
    proto.makeXRCompatible = function () { return Promise.resolve(); };
    const orig = proto.texImage2D;
    proto.texImage2D = function (...a) { if (a.length === 6 && a[5] instanceof HTMLImageElement) window.__videoUploads++; return orig.apply(this, a); };
    Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: (m) => Promise.resolve(m === 'immersive-vr' || m === 'immersive-ar'), requestSession: (m) => { window.__mode = m; window.__session = new FakeSession(); return Promise.resolve(window.__session); } } });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`https://localhost:18992/?t=${srv.token}`); await p.waitForTimeout(800);
  await p.click('#nav button[data-view="robot"]'); await p.waitForTimeout(1500);
  const first = await p.evaluate(() => document.querySelector('.robot-grid').firstElementChild.id);
  assert.strictEqual(first, 'questCard', 'on the Quest the Quest card comes first');
  assert.ok(await p.isEnabled('#btnRobotEyes'), 'Robot eyes button enabled');
  await p.click('#btnRobotEyes'); await p.waitForTimeout(1500);
  assert.strictEqual(await p.evaluate(() => window.__mode), 'immersive-vr');
  const up = await p.evaluate(() => window.__videoUploads);
  assert.ok(up > 5, `live video is drawn on the VR screen (${up} frames uploaded)`);
  const last = () => srv.robot.current;
  // sticks: tank forward
  await p.evaluate(() => { __pads.left.axes[3] = -1; __pads.right.axes[3] = -1; }); await p.waitForTimeout(400);
  assert.ok(last().left > 90 && last().right > 90 && last().source === 'quest', JSON.stringify(last()));
  await p.evaluate(() => { __pads.left.axes[3] = 0; __pads.right.axes[3] = 0; }); await p.waitForTimeout(500);
  assert.strictEqual(last().left, 0, 'sticks released -> stop');
  // head steering: look 40° to the left -> car spins left, screen follows until it catches up
  const seen = [];
  const watch = setInterval(() => seen.push({ ...last() }), 10);
  await p.evaluate(() => { window.__head = 40 * Math.PI / 180; }); await p.waitForTimeout(600);
  clearInterval(watch);
  const turning = seen.find((m) => m.left !== 0) || {};
  assert.ok(turning.left < 0 && turning.right > 0, 'head left -> car turns left: ' + JSON.stringify(turning));
  await p.waitForTimeout(2500);
  assert.strictEqual(last().left, 0, 'car stops turning once it faces where you look: ' + JSON.stringify(last()));
  // A = stop while driving
  await p.evaluate(() => { __pads.right.axes[3] = -1; __pads.left.axes[3] = -1; }); await p.waitForTimeout(300);
  await p.evaluate(() => { __pads.right.buttons[4].pressed = true; }); await p.waitForTimeout(300);
  assert.strictEqual(last().left, 0, 'A = STOP');
  await p.evaluate(() => { __pads.right.buttons[4].pressed = false; __pads.left.axes[3] = 0; __pads.right.axes[3] = 0; });
  // B = photo
  const caps = car.log.filter((x) => x === '/capture').length;
  await p.evaluate(() => { __pads.right.buttons[5].pressed = true; }); await p.waitForTimeout(150);
  await p.evaluate(() => { __pads.right.buttons[5].pressed = false; }); await p.waitForTimeout(800);
  assert.ok(car.log.filter((x) => x === '/capture').length > caps, 'B took a photo');
  // exit while driving -> stop
  await p.evaluate(() => { __pads.left.axes[3] = -1; __pads.right.axes[3] = -1; }); await p.waitForTimeout(300);
  await p.evaluate(() => window.__session.end()); await p.waitForTimeout(500);
  assert.strictEqual(last().left, 0, 'leaving VR stops the car');
  assert.deepStrictEqual(errs, [], 'no page errors');
  await p.screenshot({ path: process.env.SHOT || path.join(os.tmpdir(), 'eyes.png') });
  console.log('Robot eyes VR: OK — video frames', up, '| head steering, sticks, A stop, B photo, exit stop all work');
  await b.close(); car.close(); await srv.close(); process.exit(0);
})().catch(async (e) => { console.error(e); process.exit(1); });
