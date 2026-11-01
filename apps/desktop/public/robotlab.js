// Robot page → 🛠 Car settings (every setting of the car explained, checked before it is saved, like a modern BIOS
// screen) and 🩺 Health (the car tests itself: camera, memory, Wi-Fi, laser, gyro, each wheel — healthy / suspicious /
// not responding, the likely cause and a fix you can apply with one click). Also the practice car (simulator).
(() => {
  'use strict';
  const ui = () => window.MCui;
  const st = { schema: null, settings: null, edits: {}, group: 'motors', checks: { errors: {}, warnings: {} }, health: null, history: [], practice: null, busy: false };
  const ICON = { ok: '✅', warn: '⚠️', bad: '⛔', info: 'ℹ️', skip: '⏸' };
  const WORD = { ok: 'Healthy', warn: 'Check this', bad: 'Not working', info: 'Note', skip: 'Off' };
  const USE_NAME = { headlight: 'headlight', rEn: 'R speed', rFwd: 'R fwd', rBack: 'R back', lEn: 'L speed', lFwd: 'L fwd', lBack: 'L back', sda: 'I2C SDA', scl: 'I2C SCL' };

  async function loadSchema() { if (!st.schema) st.schema = await ui().api('/api/robot/car/schema'); return st.schema; }
  const fields = () => st.schema.groups.flatMap((g) => g.fields);
  const field = (k) => fields().find((f) => f.key === k);
  const current = () => (st.settings ? { ...st.settings.values, ...st.settings.strings } : {});
  const valueOf = (k) => (k in st.edits ? st.edits[k] : current()[k]);

  // ------------------------------------------------------------------ the board drawing (pins coloured by use)
  function boardSvg(board, assign, { onPin } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (t, a, ...kids) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); kids.forEach((k) => e.append(k)); return e; };
    const L = board.pins.filter((p) => p.side === 'L'), R = board.pins.filter((p) => p.side === 'R');
    const rows = Math.max(L.length, R.length), H = 96 + rows * 28, W = 520, PX = { L: 200, R: 320 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'board-svg', role: 'img', 'aria-label': `${board.name} pins` });
    svg.append(el('rect', { x: 186, y: 8, width: 148, height: H - 16, rx: 10, class: 'pcb' }));
    svg.append(el('rect', { x: 225, y: 18, width: 70, height: 46, rx: 4, class: 'chip' }));
    svg.append(el('text', { x: 260, y: 45, class: 'chip-t', 'text-anchor': 'middle' }, board.camera ? 'camera' : 'chip'));
    const byGpio = {}; for (const [k, g] of Object.entries(assign || {})) if (g != null) (byGpio[g] = byGpio[g] || []).push(k);
    const draw = (list, side) => list.forEach((p) => {
      const y = 88 + p.pos * 28, x = PX[side], left = side === 'L';
      const used = p.gpio != null ? byGpio[p.gpio] : null;
      const cls = p.use === 'power' ? 'pw' : used ? (used.length > 1 ? 'clash' : 'used') : p.level === 'error' ? 'res' : 'free';
      const g = el('g', { class: `pin ${cls}${p.level === 'warn' ? ' boot' : ''}`, tabindex: 0 });
      g.append(el('circle', { cx: x, cy: y, r: 7 }));
      g.append(el('text', { x: left ? x + 13 : x - 13, y: y + 4, 'text-anchor': left ? 'start' : 'end', class: 'lbl' }, p.label));
      if (used) g.append(el('text', { x: left ? x - 16 : x + 16, y: y + 4, 'text-anchor': left ? 'end' : 'start', class: 'use' }, used.map((k) => USE_NAME[k] || k).join(' + ')));
      const tip = el('title', {}); tip.textContent = `${p.label}${p.gpio != null ? ` (GPIO ${p.gpio})` : ''}: ${p.note || p.use || ''}`; g.append(tip);
      if (onPin) { g.addEventListener('click', () => onPin(p)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') onPin(p); }); }
      svg.append(g);
    });
    draw(L, 'L'); draw(R, 'R');
    return svg;
  }

  // ------------------------------------------------------------------ practice car (simulator) strip
  function practiceStrip(after) {
    const { h, api, toast } = ui();
    const box = h('div', { class: 'practice-strip' });
    const FAULTS = [['noCamera', 'Camera not found'], ['deadRight', 'Right motor dead'], ['invertLeft', 'Left motor wires reversed'], ['swapSides', 'Left/right swapped'], ['noisyTof', 'Noisy laser'], ['gyroDrift', 'Gyro drifts'], ['weakWifi', 'Weak Wi-Fi'], ['noPsram', 'No PSRAM']];
    async function draw() {
      st.practice = await api('/api/robot/car/practice').catch(() => ({ running: false }));
      const p = st.practice;
      box.innerHTML = '';
      if (!p.running) {
        box.append(h('span', { class: 'small muted' }, 'No car here? Try everything on the practice car — a simulated Baby Carpathron in a virtual room.'),
          h('button', { class: 'btn tiny', onclick: async () => { await api('/api/robot/car/practice', { body: {} }); toast('Practice car started'); await draw(); after && after(); } }, '🧪 Use the practice car'));
        return;
      }
      const sel = h('select', { 'aria-label': 'Practise a fault', onchange: async () => { await api('/api/robot/car/practice', { body: { faults: sel.value ? { [sel.value]: true } : {}, use: false } }); toast(sel.value ? 'Fault switched on: run the health check' : 'Practice car healthy again'); after && after(); } },
        h('option', { value: '' }, 'Healthy'), ...FAULTS.map(([k, t]) => h('option', { value: k, selected: p.faults && p.faults[k] ? '' : null }, t)));
      box.append(h('span', { class: 'pill ok' }, `🧪 Practice car ${p.host}`), h('label', { class: 'inline small' }, 'Practise a fault: ', sel),
        h('button', { class: 'btn tiny', onclick: async () => { await api('/api/robot/car/practice', { body: { stop: true } }); toast('Practice car stopped. Set your real car\'s address on the Control tab.'); await draw(); after && after(); } }, 'Stop'));
    }
    draw();
    return box;
  }

  // ------------------------------------------------------------------ 🛠 Car settings
  async function renderSettings(el) {
    const { h, api, toast } = ui();
    el.innerHTML = '';
    await loadSchema();
    const head = h('div', { class: 'carset-head' });
    const body = h('div', { class: 'carset' });
    el.append(h('p', { class: 'small muted settings-intro' }, 'Everything the car can be set to, explained. Values are checked before they reach the car (pins the camera needs, pins used twice, boot pins), and the car checks them again itself. Settings marked ↻ start working after a restart of the car.'),
      practiceStrip(() => renderSettings(el)), head, body);
    try { st.settings = await api('/api/robot/car/settings'); } catch (e) { st.settings = { error: e.message }; }
    if (st.settings.error) {
      body.append(h('div', { class: 'card' }, h('h3', {}, 'The car is not connected'), h('p', { class: 'small' }, st.settings.error),
        h('p', { class: 'small muted' }, 'Car settings need the Carpathron firmware 2.2 on the car. Robot → Setup → "Update car firmware" puts it on over USB.')));
      return;
    }
    st.edits = {};
    st.checks = { errors: {}, warnings: {} };
    const nav = h('nav', { class: 'carset-nav', role: 'tablist' });
    const pane = h('div', { class: 'carset-pane' });
    const bar = h('div', { class: 'carset-bar' });
    body.append(nav, pane);
    el.append(bar);

    let checkT = null;
    async function recheck() {
      clearTimeout(checkT);
      checkT = setTimeout(async () => {
        st.checks = Object.keys(st.edits).length ? await api('/api/robot/car/check', { body: { values: current(), changes: st.edits } }).catch(() => ({ errors: {}, warnings: {} })) : { errors: {}, warnings: {} };
        drawPane(); drawBar();
      }, 150);
    }
    function setEdit(k, v) {
      const f = field(k), cur = current()[k];
      const val = f.kind === 'text' || f.kind === 'password' ? String(v) : Number(v);
      if (val === cur || (f.kind === 'password' && !val)) delete st.edits[k]; else st.edits[k] = val;
      recheck(); drawBar();
    }
    function input(f) {
      const v = valueOf(f.key);
      if (f.kind === 'bool') return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: Number(v) ? '' : null, onchange: (e) => setEdit(f.key, e.target.checked ? 1 : 0) }), h('span', {}, Number(v) ? 'On' : 'Off'));
      if (f.kind === 'select') return h('select', { onchange: (e) => setEdit(f.key, e.target.value) }, ...f.options.map(([n, t]) => h('option', { value: n, selected: Number(v) === n ? '' : null }, t)));
      if (f.kind === 'pin') {
        const free = [1, 2, 3, 12, 13, 14, 15, 33];
        return h('select', { onchange: (e) => setEdit(f.key, e.target.value) }, ...free.map((n) => h('option', { value: n, selected: Number(v) === n ? '' : null }, `GPIO ${n}${n === 1 ? ' (TX)' : n === 3 ? ' (RX)' : ''}`)));
      }
      if (f.kind === 'text') return h('input', { value: v || '', maxlength: 31, oninput: (e) => setEdit(f.key, e.target.value) });
      if (f.kind === 'password') return h('input', { type: 'password', placeholder: 'unchanged', autocomplete: 'new-password', maxlength: 63, oninput: (e) => setEdit(f.key, e.target.value) });
      const range = f.max - f.min <= 400;
      const num = h('input', { type: 'number', min: f.min, max: f.max, step: f.step || 1, value: v, class: 'num', oninput: (e) => { if (rng) rng.value = e.target.value; setEdit(f.key, e.target.value); } });
      const rng = range ? h('input', { type: 'range', min: f.min, max: f.max, step: f.step || 1, value: v, oninput: (e) => { num.value = e.target.value; setEdit(f.key, e.target.value); } }) : null;
      return h('div', { class: 'num-row' }, rng, num, f.unit ? h('span', { class: 'small muted' }, f.unit) : null);
    }
    function drawNav() {
      nav.innerHTML = '';
      for (const g of st.schema.groups) {
        const n = g.fields.filter((f) => f.key in st.edits).length, bad = g.fields.some((f) => st.checks.errors[f.key]);
        nav.append(h('button', { role: 'tab', class: g.id === st.group ? 'on' : '', 'aria-selected': g.id === st.group ? 'true' : 'false', onclick: () => { st.group = g.id; drawNav(); drawPane(); } },
          g.title, n ? h('span', { class: `count ${bad ? 'bad' : ''}` }, String(n)) : null));
      }
    }
    function drawPane() {
      drawNav();
      const g = st.schema.groups.find((x) => x.id === st.group) || st.schema.groups[0];
      pane.innerHTML = '';
      pane.append(h('p', { class: 'small muted' }, g.intro));
      const active = st.settings.active || {};
      for (const f of g.fields) {
        const err = st.checks.errors[f.key], warn = st.checks.warnings[f.key];
        const changed = f.key in st.edits, def = f.def;
        const isDefault = def !== undefined && String(valueOf(f.key)) === String(def);
        pane.append(h('div', { class: `setting ${changed ? 'changed' : ''} ${err ? 'error' : ''}` },
          h('div', { class: 'setting-l' },
            h('b', {}, f.label, f.restart ? h('span', { class: 'restart', title: 'Starts working after a restart of the car' }, ' ↻') : null),
            h('div', { class: 'small muted' }, f.help),
            f.key in active ? h('div', { class: 'small warn-t' }, `In use until the restart: ${active[f.key]}`) : null,
            err ? h('div', { class: 'small bad-t' }, '⛔ ', err.join(' ')) : null,
            warn ? h('div', { class: 'small warn-t' }, '⚠ ', warn.join(' ')) : null),
          h('div', { class: 'setting-r' }, input(f),
            f.kind !== 'password' && def !== undefined && !isDefault ? h('button', { class: 'btn tiny ghost', title: `Default: ${def}`, onclick: () => { setEdit(f.key, def); drawPane(); } }, '↺ default') : null)));
      }
      if (g.id === 'motors' || g.id === 'sensors') {
        const assign = {};
        for (const k of ['rEn', 'rFwd', 'rBack', 'lEn', 'lFwd', 'lBack', 'sda', 'scl']) assign[k] = Number(valueOf(k));
        assign.headlight = 4;
        const info = h('p', { class: 'small muted' }, `Click a pin to see what it can do. Green = used by the car, red = used twice (or a power pin), amber ring = boot pin, grey = taken by the camera or memory.${[assign.lBack, assign.rBack, assign.lFwd, assign.rFwd, assign.lEn, assign.rEn].includes(33) ? ' GPIO 33 is not on the header: on the kit it is wired on the car\'s shield.' : ''}`);
        pane.append(h('div', { class: 'card board-card' }, h('h3', {}, `${st.schema.board.name}: where the wires go`), boardSvg(st.schema.board, assign, {
          onPin: (p) => { info.textContent = `${p.label}${p.gpio != null ? ` — GPIO ${p.gpio}` : ''}: ${p.note || (p.use === 'power' ? 'power pin' : 'free pin')} ${p.caps && p.caps.length ? `Can do: ${p.caps.join(', ')}.` : ''}`; },
        }), info));
      }
    }
    function drawBar() {
      const n = Object.keys(st.edits).length, bad = Object.keys(st.checks.errors).length;
      const needsRestart = Object.keys(st.edits).some((k) => field(k).restart) || st.settings.restartPending;
      bar.innerHTML = '';
      bar.append(...[h('span', { class: 'small' }, n ? `${n} change${n > 1 ? 's' : ''} not saved yet${bad ? ` · ${bad} to fix first` : ''}` : st.settings.restartPending ? 'Saved. Some changes start after a restart.' : `Car firmware ${st.settings.fw} · all saved`),
        h('span', { class: 'grow' }),
        n ? h('button', { class: 'btn', onclick: () => { st.edits = {}; st.checks = { errors: {}, warnings: {} }; drawPane(); drawBar(); } }, 'Undo changes') : null,
        n ? h('button', { class: 'btn primary', disabled: bad || st.busy ? '' : null, onclick: save }, needsRestart ? '💾 Save to the car' : '💾 Save (works at once)') : null,
        st.settings.restartPending ? h('button', { class: 'btn primary', onclick: restart }, '↻ Restart the car now') : null,
        h('button', { class: 'btn ghost tiny', onclick: reset }, 'Factory settings')].filter(Boolean));
    }
    async function save() {
      st.busy = true; drawBar();
      const r = await api('/api/robot/car/settings', { body: { changes: st.edits } }).catch((e) => ({ error: e.message }));
      st.busy = false;
      if (r.error || r.ok === false) { if (r.errors) { st.checks = { errors: r.errors, warnings: r.warnings || {} }; drawPane(); } toast(r.error || 'Fix the marked settings first', true); drawBar(); return; }
      toast(r.needsRestart ? 'Saved on the car. Restart it to use the new pins / hotspot.' : 'Saved — the car uses it already');
      st.settings = await api('/api/robot/car/settings');
      st.edits = {}; st.checks = { errors: {}, warnings: {} };
      drawPane(); drawBar();
    }
    async function restart() {
      await api('/api/robot/car/restart', { body: {} });
      toast('The car restarts (about 5 seconds)…');
      setTimeout(() => renderSettings(el), 6500);
    }
    async function reset() {
      if (!confirmBox('Put every car setting back to the kit defaults? Wi-Fi stays saved.')) return;
      await api('/api/robot/car/reset', { body: {} });
      toast('Factory settings: the car restarts…');
      setTimeout(() => renderSettings(el), 6500);
    }
    drawPane(); drawBar();
  }
  // inline confirm (no browser dialogs): second click within 4 s confirms
  let confirmAt = 0;
  function confirmBox(text) {
    if (Date.now() - confirmAt < 4000) { confirmAt = 0; return true; }
    confirmAt = Date.now(); ui().toast(`${text} Click again to confirm.`);
    return false;
  }

  // ------------------------------------------------------------------ 🩺 Health
  async function renderHealth(el) {
    const { h, api, toast, askAgent } = ui();
    el.innerHTML = '';
    const out = h('div', { class: 'health-list' });
    const hist = h('div', { class: 'card' });
    const run = async (motors) => {
      btnA.disabled = btnB.disabled = true;
      out.innerHTML = '';
      out.append(h('p', { class: 'small muted' }, motors ? 'Testing… the car moves each side for a moment.' : 'Testing… (about 3 seconds)'));
      const r = await api('/api/robot/car/diag', { body: { motors } }).catch((e) => ({ error: e.message }));
      btnA.disabled = btnB.disabled = false;
      st.health = r;
      draw(); drawHistory();
    };
    const btnA = h('button', { class: 'btn primary', onclick: () => run(false) }, '🩺 Check the car');
    const btnB = h('button', { class: 'btn', onclick: () => run(true) }, '🛞 Check + test the wheels');
    const calCard = h('div', { class: 'card cal-card' });
    el.append(h('p', { class: 'small muted settings-intro' }, 'The car tests its own parts and Muse explains the result: camera, memory, Wi-Fi, the sensor bus, the laser, the gyro and — if you allow it — each side of wheels. Give the car about 30 cm of free space (or lift it) for the wheel test.'),
      practiceStrip(() => {}), h('div', { class: 'row' }, btnA, btnB), out, calCard, hist);
    drawCalibration(calCard, drawHistory);
    const FIX = [[/turn on "Left wheels turn the wrong way" and "Right wheels/, { invL: 1, invR: 1 }], [/turn on "Left wheels turn the wrong way"/, { invL: 1 }], [/turn on "Right wheels turn the wrong way"/, { invR: 1 }], [/turn on "Left and right are swapped"/, { swap: 1 }],
      [/raise "Lowest power that moves the wheels"/, null]];
    function draw() {
      const r = st.health;
      out.innerHTML = '';
      if (!r) return;
      if (r.error) { out.append(h('div', { class: 'card' }, h('p', { class: 'small' }, `✕ ${r.error}`))); return; }
      out.append(h('div', { class: `health-sum ${r.summary}` }, h('b', {}, r.summary === 'ok' ? '✅ The car is healthy' : r.summary === 'warn' ? '⚠️ The car works, some things need a look' : '⛔ Something on the car does not work'), h('span', { class: 'small muted' }, ` firmware ${r.fw || '?'} · ${new Date(r.at).toLocaleTimeString()}`)));
      for (const it of r.items) {
        const fixBtn = (() => {
          const m = FIX.find(([re]) => re.test(it.fix || ''));
          if (!m || !m[1]) return null;
          return h('button', { class: 'btn tiny primary', onclick: async (e) => {
            e.currentTarget.disabled = true;
            const cur = st.settings && st.settings.values ? st.settings.values : (await api('/api/robot/car/settings')).values;
            const changes = {}; for (const [k, v] of Object.entries(m[1])) changes[k] = cur[k] ? 0 : v; // the switch flips
            const res = await api('/api/robot/car/settings', { body: { changes } }).catch((x) => ({ error: x.message }));
            toast(res.ok ? 'Fixed on the car. Run the wheel test again to confirm.' : (res.error || 'Not saved'), !res.ok);
          } }, '🔧 Apply this fix');
        })();
        out.append(h('div', { class: `health-item ${it.status}` }, h('span', { class: 'h-ico', title: WORD[it.status] }, ICON[it.status]),
          h('div', { class: 'grow' }, h('b', {}, it.title), it.detail ? h('div', { class: 'small muted' }, it.detail) : null, it.fix ? h('div', { class: 'small' }, '👉 ', it.fix) : null, fixBtn ? h('div', { class: 'row' }, fixBtn) : null)));
      }
      const problems = r.items.filter((x) => x.status === 'bad' || x.status === 'warn');
      if (problems.length) out.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => askAgent(`My Baby Carpathron health check found:\n${problems.map((p) => `- ${p.title}: ${p.detail} ${p.fix}`).join('\n')}\nHelp me troubleshoot it step by step. You can run robot_diagnose again after each step.`) }, '🤖 Troubleshoot with Muse')));
    }
    async function drawHistory() {
      st.history = await api('/api/robot/car/history').catch(() => []);
      hist.innerHTML = '';
      hist.append(h('h3', {}, '📒 Robot passport'), h('p', { class: 'small muted' }, 'What changed on the car and what each check found, newest first.'));
      const rows = st.history.slice(-25).reverse();
      if (!rows.length) { hist.append(h('p', { class: 'small muted' }, 'Nothing yet.')); return; }
      hist.append(h('div', { class: 'list' }, ...rows.map((e) => h('div', { class: 'item' }, h('span', {}, e.kind === 'health' ? ICON[e.summary] || '🩺' : e.kind === 'reset' ? '↺' : e.kind === 'firmware' ? '⬆' : e.kind === 'calibration' ? '🎯' : '🛠'),
        h('div', { class: 'grow' }, h('b', {}, e.kind === 'health' ? (e.problems && e.problems.length ? e.problems.join(' · ') : 'Health check: all fine') : e.kind === 'reset' ? 'Factory settings' : e.kind === 'calibration' ? `Calibration ${e.step}: ${e.text}` : e.kind === 'firmware' ? `Firmware ${({ update: 'flashed over USB', wifi: 'sent over Wi-Fi', build: 'built', undo: 'undone' })[e.action] || e.action}${e.ok ? '' : ' — failed'}` : Object.entries(e.changes || {}).map(([k, v]) => `${k}: ${e.before ? e.before[k] : '?'} → ${v}`).join(', ')),
          h('div', { class: 'meta' }, new Date(e.at).toLocaleString()))))));
    }
    draw(); drawHistory();
  }

  // ------------------------------------------------------------------ 🎯 Calibration wizard
  async function drawCalibration(card, after) {
    const { h, api, toast } = ui();
    const r = await api('/api/robot/car/calibrate').catch(() => ({ steps: [] }));
    card.innerHTML = '';
    card.append(h('h3', {}, '🎯 Calibration'), h('p', { class: 'small muted' }, 'Each step measures one thing with the car\'s own sensors and saves the right setting, so the car starts at low speed, drives straight, turns exactly and measures distances right. Do them in this order the first time; repeat one whenever something changes (new batteries, new wheels, a moved sensor). Every result goes into the robot passport and can be changed back in Car settings.'));
    const NEED = { gyro: '🧭 gyro', laser: '📏 laser', camera: '📷 camera' };
    r.steps.forEach((st, i) => {
      const res = h('div', { class: 'small cal-res' });
      const inputs = {};
      const fields = Object.entries(st.input || {}).map(([k, label]) => { inputs[k] = h('input', { type: 'number', class: 'num', value: k === 'knownMm' ? 200 : 0, 'aria-label': label }); return h('label', { class: 'inline small' }, `${label} `, inputs[k]); });
      const go = async (phase) => {
        btn.disabled = true; if (apply) apply.disabled = true;
        res.className = 'small cal-res'; res.textContent = st.moves ? '⏳ Measuring… the car moves.' : '⏳ Measuring…';
        const input = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, Number(el.value)]));
        if (st.twoPhase) input.phase = phase;
        const out = await api('/api/robot/car/calibrate', { body: { step: st.id, input } }).catch((e) => ({ error: e.message }));
        btn.disabled = false; if (apply) apply.disabled = !(out && out.waiting) && st.twoPhase && phase === 'run';
        if (out.error) { res.className = 'small cal-res bad-t'; res.textContent = `✕ ${out.error}`; return; }
        res.className = `small cal-res ${out.ok ? '' : 'warn-t'}`;
        res.textContent = `${out.waiting ? '👉' : out.ok ? '✓' : '⚠'} ${out.text}`;
        if (!out.waiting) { toast(out.ok ? `${st.title}: done` : `${st.title}: see the note`, !out.ok); after && after(); }
      };
      const btn = h('button', { class: 'btn', onclick: () => go('run') }, st.twoPhase ? '▶ Turn 360°' : '▶ Start');
      const apply = st.twoPhase ? h('button', { class: 'btn primary', disabled: '', onclick: () => go('apply') }, 'Apply') : null;
      card.append(h('div', { class: 'fw-step cal-step' }, h('span', { class: 'fw-n' }, String(i + 1)),
        h('div', { class: 'grow' }, h('b', {}, st.title, ' ', h('span', { class: 'pill' }, NEED[st.needs] || st.needs), st.moves ? h('span', { class: 'pill warn' }, 'moves') : null),
          h('div', { class: 'small muted' }, st.text), fields.length ? h('div', { class: 'row' }, ...fields) : null, res),
        h('div', { class: 'cal-btns' }, btn, apply)));
    });
  }

  // ------------------------------------------------------------------ ⬆ Car firmware: build · USB · Wi-Fi · check · undo
  function firmwareCard() {
    const { h, api, toast } = ui();
    const out = h('pre', { class: 'shield-cmds', hidden: true });
    const builds = h('div', { class: 'small muted' });
    window.MCfirmware = (t) => { out.hidden = false; out.textContent = `⏳ ${t}`; };
    const btns = [];
    const run = (action, busyText) => async () => {
      btns.forEach((b) => { b.disabled = true; });
      out.hidden = false; out.textContent = `⏳ ${busyText}`;
      const r = await api('/api/robot/firmware', { body: { action } }).catch((e) => ({ error: e.message }));
      btns.forEach((b) => { b.disabled = false; });
      out.textContent = r.error ? `✕ ${r.error}` : `${r.ok ? '✓' : '✕'} ${r.text}`;
      if (!r.error) toast(r.ok ? 'Done' : 'It did not work — see the details below', !r.ok);
      drawBuilds();
    };
    const step = (n, title, text, label, action, busy, primary) => {
      const b = h('button', { class: `btn ${primary ? 'primary' : ''}`, onclick: run(action, busy) }, label);
      btns.push(b);
      return h('div', { class: 'fw-step' }, h('span', { class: 'fw-n' }, n), h('div', { class: 'grow' }, h('b', {}, title), h('div', { class: 'small muted' }, text)), b);
    };
    async function drawBuilds() {
      const r = await api('/api/robot/firmware').catch(() => ({ builds: [] }));
      builds.textContent = r.builds.length ? `Kept on this PC: ${r.builds.slice(-4).reverse().map((b) => `${b.version} (${new Date(b.at).toLocaleString()})`).join(' · ')}` : 'No firmware built on this PC yet.';
    }
    drawBuilds();
    return h('div', { class: 'card fw-card' }, h('h3', {}, '⬆ Car firmware'),
      h('p', { class: 'small muted' }, 'Firmware is the program inside the car. Muse Carpathron brings the newest one. Building turns the code into a file for the car\'s chip; flashing writes that file into the car. The first time it has to be over the USB cable; after that it also works over Wi-Fi, and the car keeps the previous firmware so you can go back.'),
      step('1', 'Check', 'Which firmware the car has, which one the app brings, and whether Wi-Fi updates are ready.', '🔎 Check', 'check', 'Checking…'),
      step('2', 'Build (optional)', 'Only compile, to see that the code is fine. Nothing is sent to the car.', '🔨 Build', 'build', 'Building… (first time: installs the ESP32 tools, several minutes)'),
      step('3', 'Flash over USB', 'Car connected to this PC with the USB-C data cable. Needed once (it also adds the space for Wi-Fi updates). If it hangs on "Connecting…", hold the BOOT button.', '🔌 Flash over USB', 'update', 'Flashing over USB… (first time: installs the ESP32 tools, several minutes)', true),
      step('4', 'Flash over Wi-Fi', 'No cable: the new firmware goes through your Wi-Fi. The car checks the file before it switches.', '📶 Flash over Wi-Fi', 'wifi', 'Building and sending over Wi-Fi…'),
      step('5', 'Undo', 'Something wrong after an update? The car goes back to the firmware it had before.', '↩ Undo last update', 'undo', 'Going back to the previous firmware…'),
      builds, out);
  }

  window.MClab = { renderSettings, renderHealth, boardSvg, firmwareCard };
})();
