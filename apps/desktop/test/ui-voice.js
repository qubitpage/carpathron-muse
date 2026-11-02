// UI test of Robot → Control → 🗣 Voice: the voice list (one not downloaded → its download button), choosing a voice,
// ▶ plays a sample with the mouth moving, "Say" plays the robot voice and logs the line once (long answers too).
// MC_TEST_MODELS=<models dir> node test/ui-voice.js [screenshot dir]
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { startServer } = require('../backend/server');
const { MODELS } = require('../backend/tts');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const M = process.env.MC_TEST_MODELS;
  if (!M) { console.log('MC_TEST_MODELS not set — skipped'); return; }
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ui-voice-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-uiv-'));
  fs.mkdirSync(path.join(dataDir, 'voices'));
  fs.symlinkSync(path.join(M, MODELS.kitten.name), path.join(dataDir, 'voices', MODELS.kitten.name));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api', workspace: dataDir, port: 18744 }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const audio = []; p.on('response', (r) => { if (r.url().includes('/api/robot/voice/audio/')) audio.push(r.status()); });
  let ok = 0;
  const check = (name, cond, info) => { assert.ok(cond, `${name} ${info || ''}`); ok++; console.log(`  ✓ ${name}`); };
  try {
    await p.goto(`https://localhost:18744/?t=${srv.token}`);
    await p.waitForTimeout(800);
    await p.evaluate(() => window.MCui.openRobot('control'));
    await p.waitForSelector('#voiceCard .voice-opt', { timeout: 8000 });
    await p.locator('#voiceCard').scrollIntoViewIfNeeded();
    const opts = await p.locator('#voiceCard .voice-opt').count();
    const off = await p.locator('#voiceCard .voice-opt.off').count();
    const dl = await p.locator('#voiceCard button', { hasText: 'Download Kokoro' }).count();
    check('voice list: 6 voices, the 4 Kokoro ones wait for their download, a download button is shown', opts === 6 && off === 4 && dl === 1, `${opts}/${off}/${dl}`);
    await p.locator('#voiceCard').screenshot({ path: `${out}/1-voice-card.png` });
    await p.locator('.voice-opt', { hasText: 'Kitten — light and fast workbot' }).locator('input').check();
    await p.waitForTimeout(400);
    const chosen = await p.evaluate(async (t) => (await (await fetch('/api/robot/voice/status', { headers: { 'x-mc-token': t } })).json()).voice, srv.token);
    check('choosing a voice saves it', chosen === 'kitten', chosen);
    await p.locator('.voice-opt', { hasText: 'Kitten — light and fast workbot' }).locator('button').click();
    await p.waitForFunction(() => document.querySelector('.robot-face.live'), null, { timeout: 20000 });
    const h1 = await p.evaluate(() => Math.max(...Array.from({ length: 1 }, () => parseFloat(getComputedStyle(document.querySelector('.robot-face .mouth')).height))));
    await p.locator('#voiceCard').screenshot({ path: `${out}/2-talking.png` });
    check('▶ plays the sample; the robot face talks', audio.length === 1 && audio[0] === 200, JSON.stringify(audio));
    let maxMouth = h1;
    for (let i = 0; i < 15; i++) { await p.waitForTimeout(80); maxMouth = Math.max(maxMouth, await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.robot-face .mouth')).height))); }
    check('the mouth opens with the sound', maxMouth >= 8, `${maxMouth}px`);
    await p.waitForFunction(() => !document.querySelector('.robot-face.live'), null, { timeout: 20000 });
    await p.fill('#voiceCard input[placeholder^="Type what the robot"]', 'Hello! I am Baby Carpathron. I found the red chair, and the door is on my left. Shall we go?');
    await p.click('#voiceCard button:has-text("Say")');
    await p.waitForFunction(() => document.querySelectorAll('#voiceCard .vlog').length >= 1, null, { timeout: 30000 });
    for (let i = 0; i < 100 && audio.length < 3; i++) await p.waitForTimeout(100);
    const logs = await p.locator('#voiceCard .vlog').allTextContents();
    check('"Say": spoken in the robot voice in sentences, the line is logged once', audio.length >= 3 && logs.length === 1 && /Shall we go/.test(logs[0]), `${audio.length} ${JSON.stringify(logs)}`);
    await p.waitForTimeout(300);
    await p.locator('#voiceCard').screenshot({ path: `${out}/3-said.png` });
    check('no page errors', !errs.length, JSON.stringify(errs));
    console.log(`\nui-voice: ${ok} checks passed — screenshots in ${out}`);
  } catch (e) { console.log(`  ✗ ${e.message}`); process.exitCode = 1; }
  finally { await b.close(); await srv.close(); }
})();
