// UI test of Robot → 🧱 Blocks (the step builder): add steps from the list on the left, edit their fields, nest a step
// inside "Repeat", move / duplicate / delete / undo, the plain-English story, every example in both modes, running the
// square on the practice car, save + open a mission, the Arduino code of every board example, no overlapping steps and
// nothing wider than its box at 1280×860 and 1024×768.
// node test/ui-blocks.js [screenshot dir]
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs'), os = require('os'), path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { startServer } = require('../backend/server');
const { chromium } = require(process.env.PW || 'playwright');
const PORT = 18790;
(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'ui-blocks-'));
  fs.mkdirSync(out, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-uib-'));
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-uibws-'));
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ apiKey: 'x', apiBase: 'http://127.0.0.1:1/v1', engine: 'api', workspace: ws, port: PORT }));
  const srv = await startServer({ dataDir, log: () => {} });
  const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  let ok = 0;
  const check = (name, cond, info) => { assert.ok(cond, `${name} ${info || ''}`); ok++; console.log(`  ✓ ${name}`); };
  const R = '#robotBlocks';
  const prog = () => p.evaluate(() => window.MCblocks.current().program);
  const story = () => p.locator(`${R} .st-story-box`).textContent();
  const rows = () => p.locator(`${R} .st-program .st-row`).count();
  const row = (op, n = 0) => p.locator(`${R} .st-item[data-op="${op}"] > .st-row`).nth(n);
  const add = async (name) => { await p.locator(`${R} .st-pc`, { has: p.locator(`b:text-is("${name}")`) }).first().click(); await p.waitForTimeout(80); };
  const tool = async (op, n, label) => { const r = row(op, n); await r.hover(); await r.locator(`button[aria-label^="${label}"]`).click(); await p.waitForTimeout(80); };
  const api = (pth, body) => p.evaluate(async ([t, pth2, b2]) => (await fetch(pth2, { method: b2 ? 'POST' : 'GET', headers: { 'x-mc-token': t, 'Content-Type': 'application/json' }, body: b2 ? JSON.stringify(b2) : undefined })).json(), [srv.token, pth, body]);
  // no two step rows overlap, and nothing in the tab is wider than its box
  const layout = () => p.evaluate(() => {
    const rs = [...document.querySelectorAll('#robotBlocks .st-row')].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    let overlaps = 0;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], c = rs[j]; if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) overlaps++; }
    const wide = [...document.querySelectorAll('#robotBlocks .st-app, #robotBlocks .st-app *:not(pre):not(pre *):not(select):not(option):not(input)')]
      .filter((e) => e.clientWidth && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto').map((e) => `${e.tagName}.${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    const page = document.querySelector('#view-robot');
    return { rows: rs.length, overlaps, wide, pageWide: page.scrollWidth > page.clientWidth + 1 };
  });
  const layoutOk = async (where) => { const l = await layout(); check(`${where}: ${l.rows} step rows, none overlap, nothing too wide`, l.rows > 0 && !l.overlaps && !l.wide.length && !l.pageWide, JSON.stringify(l)); };
  try {
    await p.goto(`https://localhost:${PORT}/?t=${srv.token}`);
    await p.waitForTimeout(800);
    await p.evaluate(() => window.MCui.openRobot('blocks'));
    await p.waitForSelector(`${R} .st-program .st-row`, { timeout: 10000 });
    check('first visit: "How it works" is open and the first example (square) is loaded', await p.locator(`${R} .st-how`).isVisible() && /Do this 4 times/.test(await story()) && await p.locator(`${R} .st-ex.on[data-ex="square"]`).count() === 1);
    check('Blockly is not loaded any more', await p.evaluate(() => !window.Blockly && !document.querySelector('.blocklySvg')));
    await p.screenshot({ path: `${out}/1-mission-1280.png` });
    await layoutOk('square at 1280');
    // "How it works" folds and remembers it
    await p.click(`${R} .st-head .st-link`);
    check('"How it works" folds away and is remembered', await p.locator(`${R} .st-how`).isHidden() && await p.evaluate(() => localStorage.getItem('mc.steps.help')) === '0');
    await p.click(`${R} .st-head .st-link`);

    // ---- build a program by clicking
    await p.click(`${R} button:has-text("Start over")`);
    check('Start over: empty program explains what to do', await rows() === 0 && /add the first step/.test(await p.locator(`${R} .st-slot.on`).textContent()));
    await add('Drive forward');
    check('click "Drive forward" → step 1 "Drive forward 30 cm"', await rows() === 1 && /Drive forward 30 cm/.test(await story()));
    const cm = row('forward').locator('input.st-num');
    await cm.fill('999');
    check('a number out of range turns red and is not used', await cm.evaluate((e) => e.classList.contains('bad')) && /Drive forward 30 cm/.test(await story()));
    await cm.fill('55'); await cm.blur();
    check('editing the number changes the plan', /Drive forward 55 cm/.test(await story()) && !(await cm.evaluate((e) => e.classList.contains('bad'))));
    await add('Repeat');
    check('after "Repeat", new steps go inside it', await p.locator(`${R} .st-item[data-op="repeat"] .st-slot.on`).count() === 1);
    await add('Turn right');
    await row('repeat').locator('input.st-num').fill('3'); await row('repeat').locator('input.st-num').blur();
    let pr = await prog();
    check('"Turn right" is nested inside "Repeat 3 times"', pr.length === 2 && pr[1].op === 'repeat' && pr[1].n === 3 && pr[1].body.length === 1 && pr[1].body[0].op === 'turn' && pr[1].body[0].deg === 90, JSON.stringify(pr));
    await row('turn').locator('select').selectOption('L');
    pr = await prog();
    check('turn direction left → deg −90, story says left', pr[1].body[0].deg === -90 && /Do this 3 times:\s*Turn left by 90°/.test(await story()));
    await p.click(`${R} .st-list[data-owner="root"] > .st-slot`);
    await add('Say something');
    await row('say').locator('input').fill('Hi there');
    pr = await prog();
    check('clicking the last "＋" line puts the next step at the end', pr.length === 3 && pr[2].op === 'say' && pr[2].text === 'Hi there' && /Say “Hi there”/.test(await story()));
    await p.screenshot({ path: `${out}/2-built-1280.png` });
    await layoutOk('built program');
    // move, duplicate, delete, undo
    await tool('say', 0, 'Move this step up');
    pr = await prog();
    check('▲ moves "Say" above the repeat', pr.map((s) => s.op).join() === 'forward,say,repeat', pr.map((s) => s.op).join());
    await tool('say', 0, 'Move this step down');
    check('▼ moves it back', (await prog()).map((s) => s.op).join() === 'forward,repeat,say');
    await tool('turn', 0, 'Move this step up');
    pr = await prog();
    check('▲ on the first step inside a box moves it out, above the box', pr.map((s) => s.op).join() === 'forward,turn,repeat,say' && pr[2].body.length === 0, JSON.stringify(pr));
    await p.click(`${R} button:has-text("Undo")`);
    check('↶ Undo puts it back inside', (await prog())[1].body.length === 1);
    await tool('forward', 0, 'Duplicate');
    check('⧉ duplicates the step', (await prog()).filter((s) => s.op === 'forward').length === 2);
    await tool('forward', 1, 'Delete');
    check('✕ deletes it', (await prog()).filter((s) => s.op === 'forward').length === 1);
    await p.click(`${R} button:has-text("Undo")`);
    check('Undo brings the deleted step back', (await prog()).filter((s) => s.op === 'forward').length === 2);
    await row('forward', 0).focus();
    await p.keyboard.press('Control+z');
    check('Ctrl+Z undoes the duplicate', (await prog()).filter((s) => s.op === 'forward').length === 1);
    await row('say').focus();
    await p.keyboard.press('Alt+ArrowUp');
    check('Alt+↑ moves the focused step up', (await prog()).map((s) => s.op).join() === 'forward,say,repeat');
    await row('say').focus();
    await p.keyboard.press('Delete');
    check('Delete removes the focused step', (await prog()).map((s) => s.op).join() === 'forward,repeat');
    await p.fill(`${R} .st-search`, 'headlight');
    check('the search box filters the actions', await p.locator(`${R} .st-pc:visible`).count() === 1);
    await p.fill(`${R} .st-search`, '');
    // drag a step (the ⠿ handle) to the end
    await p.locator(`${R} .st-item[data-op="forward"] > .st-row .st-handle`).dragTo(p.locator(`${R} .st-list[data-owner="root"] > .st-slot`));
    await p.waitForTimeout(150);
    check('dragging the ⠿ handle moves a step', (await prog()).map((s) => s.op).join() === 'repeat,forward', (await prog()).map((s) => s.op).join());

    // ---- every mission example (an edited program asks first)
    const exM = await p.evaluate(() => window.MCblocks.EXAMPLES.mission.map((e) => e.id));
    const stories = {};
    for (const [i, id] of exM.entries()) {
      await p.click(`${R} .st-ex[data-ex="${id}"]`);
      if (i === 0) { check('loading an example over your own program asks first', await p.locator(`${R} .st-confirm`).isVisible()); await p.click(`${R} .st-confirm button:has-text("Yes, load")`); }
      await p.waitForTimeout(150);
      stories[id] = await story();
      const ex = await p.evaluate((x) => window.MCblocks.EXAMPLES.mission.find((e) => e.id === x).program, id);
      check(`example "${id}" loads exactly`, JSON.stringify(await prog()) === JSON.stringify(ex));
    }
    check('example stories in plain words', /Do this 4 times/.test(stories.square) && /closer than 30 cm/.test(stories.patrol) && /Stop/.test(stories.patrol) && /laser distance/.test(stories.patrol) && /look left/.test(stories.greeter) && /Turn left by 45°/.test(stories.dance));
    await p.click(`${R} .st-ex[data-ex="patrol"]`); await p.waitForTimeout(150);
    await row('if').hover();
    await p.screenshot({ path: `${out}/3-patrol-1280.png` });
    await layoutOk('patrol (nested if inside keep-repeating)');

    // ---- run the square on the practice car
    const pc = await api('/api/robot/car/practice', {});
    check('practice car started', pc.running === true, JSON.stringify(pc));
    await p.waitForTimeout(1500);
    await p.click(`${R} .st-ex[data-ex="square"]`); await p.waitForTimeout(150);
    await p.evaluate(() => { window.__sawRunning = 0; new MutationObserver(() => { if (document.querySelector('#robotBlocks .st-row.running')) window.__sawRunning++; }).observe(document.querySelector('#robotBlocks'), { subtree: true, attributes: true, attributeFilter: ['class'] }); });
    await p.click(`${R} button:has-text("▶ Run on the car")`);
    await p.waitForFunction(() => /finished|stopped|✕/.test(document.querySelector('#robotBlocks .st-log').textContent), null, { timeout: 120000 });
    const log = await p.locator(`${R} .st-log`).textContent();
    check('the square runs on the practice car and finishes', /✓ finished/.test(log), log.slice(0, 200));
    check('the running step was highlighted', await p.evaluate(() => window.__sawRunning > 0) && await p.locator(`${R} .st-row.running`).count() === 0);
    await p.screenshot({ path: `${out}/4-ran-1280.png` });

    // ---- save + open a mission
    await p.fill(`${R} input[aria-label="Mission name"]`, 'Test square');
    await p.click(`${R} button:has-text("💾 Save")`);
    await p.waitForSelector(`${R} .st-mi:has-text("Test square")`, { timeout: 5000 });
    const saved = await api('/api/robot/missions/get', { name: 'Test square' });
    check('💾 Save stores the steps on the PC', JSON.stringify(saved.program) === JSON.stringify(await p.evaluate(() => window.MCblocks.EXAMPLES.mission[0].program)));
    await p.click(`${R} .st-ex[data-ex="greeter"]`); await p.waitForTimeout(150);
    await p.click(`${R} .st-mi:has-text("Test square") button[aria-label^="Open"]`); await p.waitForTimeout(300);
    check('✎ opens a saved mission into the editor', (await prog())[1].op === 'repeat' && await p.inputValue(`${R} input[aria-label="Mission name"]`) === 'Test square');

    // ---- board programs
    await p.click(`${R} .st-mode:has-text("Program a board")`);
    await p.waitForSelector(`${R} .st-tabs button`, { timeout: 10000 });
    check('board mode: the two fixed parts are shown', await p.locator(`${R} .st-sec`).count() === 2 && /switches on/.test(await p.locator(`${R} .st-sec-setup`).textContent()));
    const exF = await p.evaluate(() => window.MCblocks.EXAMPLES.firmware.map((e) => e.id));
    const fw = {};
    for (const id of exF) {
      await p.click(`${R} .st-ex[data-ex="${id}"]`);
      if (await p.locator(`${R} .st-confirm`).isVisible()) await p.click(`${R} .st-confirm button:has-text("Yes, load")`);
      await p.waitForTimeout(150);
      await p.click(`${R} .st-tabs button:has-text("What it does")`);
      const st = await p.locator(`${R} .st-pane`).textContent();
      await p.click(`${R} .st-tabs button:has-text("What to connect")`);
      await p.waitForSelector(`${R} .st-pins h4`, { timeout: 8000 });
      const parts = await p.locator(`${R} .st-pane`).textContent();
      const nParts = await p.locator(`${R} .st-parts li`).count();
      await p.click(`${R} .st-tabs button:has-text("The code")`);
      const code = await p.locator(`${R} .st-code`).textContent();
      fw[id] = { story: st, parts, nParts, code };
      fs.writeFileSync(`${out}/fw-${id}.ino`, code);
    }
    check('blink: story, parts and code', /Switch the LED on pin 2 ON/.test(fw.blink.story) && /220 Ω/.test(fw.blink.parts) && fw.blink.nParts === 1 && /pinMode\(2, OUTPUT\)/.test(fw.blink.code) && /digitalWrite\(2, HIGH\);  \/\/ LED on pin 2 ON/.test(fw.blink.code) && /delay\(500\)/.test(fw.blink.code));
    check('button: pull-up button', /button on pin 4 is pressed/.test(fw.button.story) && /INPUT_PULLUP/.test(fw.button.code) && /if \(digitalRead\(4\) == LOW\)/.test(fw.button.code) && /push button/.test(fw.button.parts));
    check('night light: analog sensor in %', /sensor on pin 34/.test(fw.night.story) && /analogRead\(34\) \* 100L \/ 4095\) < 30/.test(fw.night.code) && fw.night.nParts === 2);
    check('servo: ESP32Servo', /#include <ESP32Servo.h>/.test(fw.servo.code) && /servo_13.attach\(13\)/.test(fw.servo.code) && /servo_13.write\(180\)/.test(fw.servo.code) && /SG90/.test(fw.servo.parts));
    check('beeps: tone in setup, Serial', /tone\(15, 2000, 150\)/.test(fw.beep.code) && /for \(int i = 0; i < 3; i\+\+\)/.test(fw.beep.code) && /Serial.println\("ready"\)/.test(fw.beep.code) && /Show “ready” on the PC/.test(fw.beep.story));
    check('every code line has a comment', Object.values(fw).every((f) => f.code.split('\n').every((l) => !l.trim() || /\/\/|^#include/.test(l) || l.trim() === '')));
    // build a board program by clicking, and change the board
    await p.click(`${R} button:has-text("Start over")`);
    await add('Turn a servo');
    await add('Beep');
    await p.click(`${R} .st-sec-setup .st-slot`);
    await add('Switch an LED');
    const bp = await prog();
    check('board steps go where you click (setup / forever)', bp.setup.length === 1 && bp.setup[0].op === 'led' && bp.loop.map((s) => s.op).join() === 'servo,beep', JSON.stringify(bp));
    await p.selectOption(`${R} select[aria-label="Board"]`, 'uno');
    await p.click(`${R} .st-tabs button:has-text("The code")`);
    check('on an Arduino Uno the servo uses Servo.h', /#include <Servo.h>/.test(await p.locator(`${R} .st-code`).textContent()));
    await p.selectOption(`${R} select[aria-label="Board"]`, 'esp32devkit');
    await p.click(`${R} .st-ex[data-ex="night"]`);
    if (await p.locator(`${R} .st-confirm`).isVisible()) await p.click(`${R} .st-confirm button:has-text("Yes, load")`);
    await p.click(`${R} .st-tabs button:has-text("What it does")`); await p.waitForTimeout(150);
    await p.screenshot({ path: `${out}/5-board-1280.png` });
    await layoutOk('board night light at 1280');
    await p.click(`${R} .st-tabs button:has-text("What to connect")`); await p.waitForSelector(`${R} .st-pins h4`);
    await p.locator(`${R} .st-side`).screenshot({ path: `${out}/6-connect.png` });

    // ---- 1024 × 768 (the sidebar leaves ~700 px)
    await p.setViewportSize({ width: 1024, height: 768 });
    await p.waitForTimeout(300);
    await p.locator(`${R} .st-grid`).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/7-board-1024.png` });
    await layoutOk('board at 1024');
    await p.click(`${R} .st-mode:has-text("Make the car")`); await p.waitForTimeout(200);
    await p.click(`${R} .st-ex[data-ex="patrol"]`); await p.waitForTimeout(200);
    await p.locator(`${R} .st-progcol`).scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/8-patrol-1024.png` });
    await layoutOk('patrol at 1024');
    // a full-length picture of the whole tab
    await p.setViewportSize({ width: 1280, height: 2000 });
    await p.click(`${R} .st-ex[data-ex="square"]`); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('#view-robot').scrollTo(0, 0));
    await p.screenshot({ path: `${out}/9-full-1280.png` });

    // ---- the drafts survive a reload
    await p.reload(); await p.waitForTimeout(800);
    await p.evaluate(() => window.MCui.openRobot('blocks')); await p.waitForSelector(`${R} .st-program .st-row`);
    check('the draft and the mode are kept after a reload', (await p.evaluate(() => window.MCblocks.current().mode)) === 'mission' && (await prog())[1].op === 'repeat');

    // ---- optional: compile the board examples
    let cli = ''; try { cli = execFileSync('which', ['arduino-cli']).toString().trim(); } catch {}
    if (cli) {
      for (const id of exF) {
        const dir = path.join(out, `sk_${id}`); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `sk_${id}.ino`), fw[id].code);
        execFileSync(cli, ['compile', '--fqbn', 'esp32:esp32:esp32', dir], { stdio: 'pipe' });
      }
      check('every board example compiles for esp32:esp32:esp32', true);
    } else console.log('  (arduino-cli not installed — compile check skipped)');

    check('no page errors', !errs.length, JSON.stringify(errs));
    console.log(`\nui-blocks: ${ok} checks passed — screenshots in ${out}`);
  } catch (e) { console.log(`  ✗ ${e.message}`); await p.screenshot({ path: `${out}/x-failure.png` }).catch(() => {}); process.exitCode = 1; }
  finally { await b.close(); await srv.close(); }
})();
