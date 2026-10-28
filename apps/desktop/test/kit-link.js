const assert = require('assert');
const { Robot } = require('../backend/robot');
const kit = require('./fake-kit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // mapping
  assert.deepStrictEqual(Robot.kitCommand(60, 60).dir, 'fwd');
  assert.deepStrictEqual(Robot.kitCommand(-60, -60).dir, 'back');
  assert.deepStrictEqual(Robot.kitCommand(-60, 60).dir, 'left');
  assert.deepStrictEqual(Robot.kitCommand(60, -60).dir, 'right');
  assert.deepStrictEqual(Robot.kitCommand(100, 35).dir, 'right');
  assert.deepStrictEqual(Robot.kitCommand(0, 0).dir, 'stop');

  // factory WEB program
  const web = kit.start('web', 18700);
  let r = new Robot({ getIp: () => '127.0.0.1:18700', emit: () => {} });
  await sleep(500);
  assert.strictEqual(r.status().firmware, 'kit-web');
  r.manualDrive(60, 60); await sleep(250);
  r.manualDrive(-60, 60); await sleep(250);
  await sleep(600);
  await r.led(100);
  console.log('kit-web commands:', web.log.join(' '));
  assert.ok(web.log.includes('car=1') && web.log.includes('car=2') && web.log.includes('car=3') && web.log.includes('flash=100'));
  assert.ok(web.log.some((x) => x.startsWith('speed=')));
  r.close(); web.close();

  // factory APP program (TCP port 100) — the robot always uses port 100, so run this part only if we can bind it
  const app = (() => { try { return kit.start('app', 18710, 100); } catch { return null; } })();
  await sleep(200);
  r = new Robot({ getIp: () => '127.0.0.1:18710', emit: () => {} });
  await sleep(500);
  assert.strictEqual(r.status().firmware, 'kit-app');
  r.manualDrive(0, 0);
  r.manualDrive(70, 70); await sleep(250);
  r.manualDrive(-50, -50); await sleep(250);
  await sleep(600);
  console.log('kit-app packets:', app.log.join(' '));
  assert.ok(app.log.includes('devc=1') && app.log.includes('devc=2') && app.log.includes('devc=0'));
  assert.ok(app.log.some((x) => x.startsWith('devd=')));
  r.close(); app.close();
  console.log('Factory firmware support: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
