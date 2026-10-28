// Simulated Meta Quest 3S: fake WebXR (passthrough "immersive-ar") + Touch controllers -> checks the car receives drive commands.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const car = require('./fake-car').start(18980, 18981, Buffer.alloc(300));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-xr-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ port: 18982, robot: { carIp: '127.0.0.1:18980' } }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const ctx = await b.newContext({ viewport: { width: 1000, height: 800 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64; Quest 3S) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.0 Chrome/132.0 VR Safari/537.36' });
  await ctx.addInitScript(() => {
    const pads = { left: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })), hapticActuators: [{ pulse: () => Promise.resolve(true) }] },
                   right: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 7 }, () => ({ pressed: false, value: 0 })), hapticActuators: [{ pulse: () => Promise.resolve(true) }] } };
    window.__pads = pads;
    class FakeSession extends EventTarget {
      constructor() { super(); this.inputSources = [{ handedness: 'left', gamepad: pads.left }, { handedness: 'right', gamepad: pads.right }]; this.renderState = {}; this.cbs = []; this.t = 0;
        this.timer = setInterval(() => { const c = this.cbs; this.cbs = []; this.t += 16; c.forEach((f) => f(this.t, { getViewerPose: () => null })); }, 16); }
      updateRenderState(s) { this.renderState = { ...this.renderState, ...s }; }
      requestAnimationFrame(f) { this.cbs.push(f); return 1; }
      requestReferenceSpace() { return Promise.resolve({}); }
      end() { clearInterval(this.timer); this.dispatchEvent(new Event('end')); return Promise.resolve(); }
    }
    window.XRWebGLLayer = class { constructor() { this.framebuffer = null; } };
    const proto = WebGLRenderingContext.prototype;
    proto.makeXRCompatible = function () { return Promise.resolve(); };
    Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: (m) => Promise.resolve(m === 'immersive-ar' || m === 'immersive-vr'), requestSession: () => { window.__session = new FakeSession(); return Promise.resolve(window.__session); } } });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`https://localhost:18982/?t=${srv.token}`); await p.waitForTimeout(800);
  await p.click('#nav button[data-view="robot"]'); await p.waitForTimeout(800);
  console.log('XR note:', await p.textContent('#xrNote'), '| button enabled:', await p.isEnabled('#btnEnterXR'));
  await p.click('#btnEnterXR'); await p.waitForTimeout(300);
  const drives = () => car.log.filter((x) => x.startsWith('/drive'));
  // tank: push both sticks forward
  await p.evaluate(() => { __pads.left.axes[3] = -1; __pads.right.axes[3] = -1; }); await p.waitForTimeout(500);
  console.log('tank forward ->', drives().slice(-1)[0]);
  // spin: left back, right forward
  await p.evaluate(() => { __pads.left.axes[3] = 0.8; __pads.right.axes[3] = -0.8; }); await p.waitForTimeout(400);
  console.log('tank spin left ->', drives().slice(-1)[0]);
  // A button = STOP
  await p.evaluate(() => { __pads.right.buttons[4].pressed = true; }); await p.waitForTimeout(300);
  console.log('A pressed -> last cmds:', car.log.slice(-2).join(' '), '| motors:', JSON.stringify(srv.robot.current));
  await p.evaluate(() => { __pads.right.buttons[4].pressed = false; __pads.left.axes[3] = 0; __pads.right.axes[3] = 0; });
  // leave XR -> stop
  await p.evaluate(() => { __pads.left.axes[3] = -1; __pads.right.axes[3] = -1; }); await p.waitForTimeout(300);
  await p.evaluate(() => window.__session.end()); await p.waitForTimeout(400);
  console.log('after exit ->', car.log.slice(-1)[0], '| motors:', JSON.stringify(srv.robot.current));
  console.log('page errors:', JSON.stringify(errs));
  await b.close(); car.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
