// Robot <-> firmware HTTP API test (uses port 80 path semantics on custom ports).
const assert = require('assert');
const fake = require('./fake-car');
const { Robot } = require('../backend/robot');
(async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(500, 1), Buffer.from([0xff, 0xd9])]);
  const car = fake.start(18680, 18681, jpeg);
  const events = [];
  const robot = new Robot({ getIp: () => '127.0.0.1:18680', emit: (e, d) => events.push([e, d]) });
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(robot.status().state, 'online', 'car detected');
  assert.ok(robot.status().camera, 'camera reported');
  robot.manualDrive(50, 50, 'test');
  await new Promise((r) => setTimeout(r, 350));
  const drives = car.log.filter((x) => x.startsWith('/drive?l=50&r=50'));
  assert.ok(drives.length >= 2, `drive sent repeatedly (${drives.length})`);
  await new Promise((r) => setTimeout(r, 600)); // driver timeout -> stop
  assert.ok(car.log.slice(-3).includes('/stop'), 'stop sent after release: ' + car.log.slice(-4));
  const before = car.log.length;
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(car.log.length - before, car.log.slice(before).filter((x) => x === '/status').length, 'no traffic while idle except status');
  const r = await robot.runPlan([{ type: 'drive', left: -40, right: 40, ms: 300 }, { type: 'stop' }]);
  assert.ok(r.completed && car.log.some((x) => x === '/drive?l=-40&r=40'));
  await robot.led(120); assert.strictEqual(car.led(), 120);
  robot.close(); car.close();
  console.log('Car link (HTTP firmware API): OK —', car.log.filter((x) => x.startsWith('/drive')).length, 'drive commands');
})().catch((e) => { console.error(e); process.exit(1); });
