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
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (t, a = {}, ...kids) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v); kids.forEach((k) => e.append(typeof k === 'string' ? document.createTextNode(k) : k)); return e; };
  // Any board profile: L/R headers as columns, T/B headers as rows, pins inside the board (X/C) listed under it.
  // assign = { name: gpio } (names shown next to the pin), opts.selected = gpio to highlight
  function boardSvg(board, assign, { onPin, selected, names = USE_NAME } = {}) {
    const side = (s) => board.pins.filter((p) => p.side === s).sort((a, b) => a.pos - b.pos);
    const L = side('L'), R = side('R'), T = side('T'), B = side('B');
    const rows = Math.max(L.length, R.length), cols = Math.max(T.length, B.length);
    const STEP = 28, CSTEP = 24, LBLW = 110;
    const bw = Math.max(150, cols * CSTEP + 40), bh = Math.max(90, rows * STEP + 40) + (T.length ? 60 : 0) + (B.length ? 60 : 0);
    const ox = LBLW + 10, oy = T.length ? 92 : 14;
    const W = ox + bw + LBLW + 10, H = oy + bh + (B.length ? 92 : 14);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'board-svg', role: 'img', 'aria-label': `${board.name} pins` });
    svg.append(sv('rect', { x: ox, y: oy, width: bw, height: bh, rx: 10, class: 'pcb' }));
    svg.append(sv('rect', { x: ox + bw / 2 - 40, y: oy + bh / 2 - 26, width: 80, height: 52, rx: 4, class: 'chip' }));
    svg.append(sv('text', { x: ox + bw / 2, y: oy + bh / 2 + 4, class: 'chip-t', 'text-anchor': 'middle' }, board.camera ? 'camera' : board.id.startsWith('esp') || board.id.startsWith('xiao') ? 'ESP32' : board.id === 'pico' ? 'RP2040' : 'ATmega'));
    const byGpio = {}; for (const [k, g] of Object.entries(assign || {})) if (g != null && !Number.isNaN(Number(g))) (byGpio[Number(g)] = byGpio[Number(g)] || []).push(k);
    const put = (p, x, y, lx, ly, anchor, ux, uy, uanchor, rot, urot) => {
      const used = p.gpio != null ? byGpio[p.gpio] : null;
      const cls = p.use === 'power' ? 'pw' : used ? (used.length > 1 ? 'clash' : 'used') : p.level === 'error' ? 'res' : 'free';
      const g = sv('g', { class: `pin ${cls}${p.level === 'warn' ? ' boot' : ''}${selected != null && p.gpio === selected ? ' sel' : ''}`, tabindex: 0, 'data-gpio': p.gpio });
      g.append(sv('circle', { cx: x, cy: y, r: 7 }));
      g.append(sv('text', { x: lx, y: ly, 'text-anchor': anchor, class: 'lbl', transform: rot ? `rotate(${rot} ${lx} ${ly})` : null }, p.label));
      if (used) g.append(sv('text', { x: ux, y: uy, 'text-anchor': uanchor, class: 'use', transform: urot ? `rotate(${urot} ${ux} ${uy})` : null }, used.map((k) => names[k] || k).join(' + ')));
      g.append(sv('title', {}, `${p.label}${p.gpio != null ? ` (GPIO ${p.gpio})` : ''}: ${p.note || p.use || 'free'}`));
      if (onPin) { g.addEventListener('click', () => onPin(p)); g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPin(p); } }); }
      svg.append(g);
    };
    const y0 = oy + (T.length ? 60 : 0) + 24;
    L.forEach((p, i) => { const x = ox + 12, y = y0 + i * STEP; put(p, x, y, x + 13, y + 4, 'start', x - 16, y + 4, 'end'); });
    R.forEach((p, i) => { const x = ox + bw - 12, y = y0 + i * STEP; put(p, x, y, x - 13, y + 4, 'end', x + 16, y + 4, 'start'); });
    const x0 = ox + (bw - (cols - 1) * CSTEP) / 2;
    T.forEach((p, i) => { const x = x0 + i * CSTEP, y = oy + 12; put(p, x, y, x - 4, y + 14, 'start', x + 4, y - 12, 'start', 90, -90); });
    B.forEach((p, i) => { const x = x0 + i * CSTEP, y = oy + bh - 12; put(p, x, y, x + 4, y - 14, 'start', x - 4, y + 12, 'start', -90, 90); });
    return svg;
  }

  // Interactive schematic: the board's used pins on the left, each part as a box on the right, one coloured wire per
  // connection (power red, ground grey, I2C blue, PWM purple, signal green). Hover a part or a wire to highlight it.
  function schematicSvg(board, placed, partsById) {
    const items = placed.map((pl) => ({ pl, part: partsById[pl.part] })).filter((x) => x.part);
    const conns = [];
    items.forEach(({ pl, part }, pi) => {
      const power = part.power === 'battery' ? 'BAT+' : part.power === '5V' ? '5V' : board.logic === '5V' ? '5V' : '3V3';
      conns.push({ pi, role: part.power === 'battery' ? 'VM' : 'VCC', from: power, kind: 'power' }, { pi, role: 'GND', from: 'GND', kind: 'gnd' });
      for (const s of part.signals) if (pl.assign && pl.assign[s.role] != null) conns.push({ pi, role: s.role, from: Number(pl.assign[s.role]), kind: part.bus === 'i2c' ? 'i2c' : s.needs.includes('pwm') ? 'pwm' : 'sig' });
    });
    const nets = [...new Set(conns.map((c) => String(c.from)))].sort((a, b) => (isNaN(a) ? -1 : Number(a)) - (isNaN(b) ? -1 : Number(b)));
    const netY = Object.fromEntries(nets.map((n, i) => [n, 40 + i * 26]));
    const label = (n) => { if (isNaN(n)) return n; const p = board.pins.find((x) => x.gpio === Number(n)); return p ? p.label : `GPIO ${n}`; };
    let y = 30; const boxes = items.map(({ pl, part }, pi) => { const pins = conns.filter((c) => c.pi === pi); const b = { pi, y, h: 26 + pins.length * 20, pins, name: pl.name || part.name }; y += b.h + 16; return b; });
    const W = 720, H = Math.max(y + 10, 40 + nets.length * 26 + 20), BX = 20, BW = 130, PX = 500, PW = 200;
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'schem-svg', role: 'img', 'aria-label': 'Wiring schematic' });
    svg.append(sv('rect', { x: BX, y: 14, width: BW, height: H - 28, rx: 8, class: 'sch-board' }), sv('text', { x: BX + BW / 2, y: 30, class: 'sch-title', 'text-anchor': 'middle' }, board.name.replace(/\s*\(.*\)/, '')));
    for (const n of nets) svg.append(sv('text', { x: BX + BW - 8, y: netY[n] + 4, 'text-anchor': 'end', class: 'sch-pin' }, label(n)), sv('circle', { cx: BX + BW, cy: netY[n], r: 3.5, class: 'sch-dot' }));
    let lane = 0;
    for (const b of boxes) {
      const g = sv('g', { class: 'sch-part', tabindex: 0 });
      g.append(sv('rect', { x: PX, y: b.y, width: PW, height: b.h, rx: 8, class: 'sch-box' }), sv('text', { x: PX + 10, y: b.y + 17, class: 'sch-title' }, b.name));
      b.pins.forEach((c, i) => {
        const py = b.y + 36 + i * 20, ly = netY[String(c.from)], lx = BX + BW + 30 + (lane++ % 12) * 22;
        g.append(sv('path', { d: `M${BX + BW} ${ly} H${lx} V${py} H${PX}`, class: `wire ${c.kind}` }));
        g.append(sv('circle', { cx: PX, cy: py, r: 3.5, class: 'sch-dot' }), sv('text', { x: PX + 10, y: py + 4, class: 'sch-pin' }, `${c.role} ← ${label(String(c.from))}`));
      });
      svg.append(g);
    }
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

  // ------------------------------------------------------------------ 🔧 Board & parts
  const CAR_BUILD = (v = {}) => ([
    { id: 'motors', name: 'L298N motor driver (car)', part: 'l298n', fixed: true, assign: { ENA: v.rEn ?? 12, IN1: v.rFwd ?? 13, IN2: v.rBack ?? 14, ENB: v.lEn ?? 2, IN3: v.lFwd ?? 15, IN4: v.lBack ?? 33 } },
    { id: 'sensors', name: 'VL53L0X + MPU-6050 (I2C)', part: 'vl53l0x', fixed: true, assign: { SDA: v.sda ?? 3, SCL: v.scl ?? 1 } },
    { id: 'headlight', name: 'Headlight LED (on the board)', part: 'buzzer', fixed: true, builtin: true, assign: { signal: 4 } },
  ]);
  const pst = { data: null, board: 'esp32cam', builds: {}, sel: null, wizard: null };
  async function renderParts(el) {
    const { h, api, toast, askAgent } = ui();
    el.innerHTML = '';
    if (!pst.data) pst.data = await api('/api/robot/parts');
    pst.builds = await api('/api/robot/build').catch(() => ({}));
    const partsById = Object.fromEntries(pst.data.parts.map((p) => [p.id, p]));
    const boardsById = Object.fromEntries(pst.data.boards.map((b) => [b.id, b]));
    let carVals = null;
    if (pst.board === 'esp32cam') { const cs = await api('/api/robot/car/settings').catch(() => null); if (cs && cs.values) carVals = cs.values; }
    const placed = () => [...(pst.board === 'esp32cam' ? CAR_BUILD(carVals || {}) : []), ...((pst.builds[pst.board] || {}).parts || [])];
    const assignOf = () => { const a = {}; for (const pl of placed()) for (const [r, g] of Object.entries(pl.assign || {})) a[`${pl.id}.${r}`] = g; return a; };
    const names = () => { const n = {}; for (const pl of placed()) for (const r of Object.keys(pl.assign || {})) n[`${pl.id}.${r}`] = `${pl.builtin ? 'headlight' : (partsById[pl.part] || {}).name ? `${pl.id === 'motors' ? 'motor' : pl.id} ${r}` : r}`; return n; };
    const save = async () => { await api('/api/robot/build', { body: { board: pst.board, parts: (pst.builds[pst.board] || {}).parts || [] } }); };

    const pick = h('select', { 'aria-label': 'Board', onchange: () => { pst.board = pick.value; pst.sel = null; pst.wizard = null; renderParts(el); } },
      ...pst.data.boards.map((b) => h('option', { value: b.id, selected: b.id === pst.board ? '' : null }, b.name)));
    const board = boardsById[pst.board];
    const info = h('div', { class: 'card pin-info' });
    const drawing = h('div', { class: 'card board-card' });
    const buildCard = h('div', { class: 'card' });
    const schem = h('div', { class: 'card' });
    el.append(h('p', { class: 'small muted settings-intro' }, 'Pick a board to see what every pin can do. Add the parts of your robot: Muse picks free pins that can do the job, warns about boot pins and pins used twice, draws the wiring and writes the starter code. On the Baby Carpathron car (ESP32-CAM) the car\'s own wiring is already in, and you can test a free pin on the real car.'),
      h('div', { class: 'row parts-top' }, h('label', { class: 'inline' }, 'Board ', pick), h('span', { class: 'small muted' }, board.chip)),
      h('div', { class: 'parts-grid' }, h('div', {}, drawing, info), h('div', {}, buildCard, schem)));

    function drawBoard() {
      drawing.innerHTML = '';
      drawing.append(h('h3', {}, board.name), h('p', { class: 'small muted' }, board.summary),
        board.limits && board.limits.length ? h('ul', { class: 'small limits' }, ...board.limits.map((l) => h('li', {}, l))) : null,
        boardSvg(board, assignOf(), { names: names(), selected: pst.sel, onPin: (p) => { pst.sel = p.gpio; drawBoard(); drawInfo(p); } }),
        h('p', { class: 'small muted' }, 'Green = used by your build · red = used twice or power · amber ring = boot pin (careful) · grey = taken by the board itself. Click a pin.'));
      const inner = board.pins.filter((p) => p.side === 'C' || p.side === 'X');
      if (inner.length) drawing.append(h('details', { class: 'small' }, h('summary', {}, `${inner.length} pins inside the board (not on the headers)`), h('div', { class: 'chips' }, ...inner.map((p) => h('button', { class: 'chip', onclick: () => drawInfo(p) }, p.label)))));
    }
    const CAP = { in: 'input', out: 'output', pwm: 'PWM (speed / servo / dimming)', adc: 'analog input', adc2: 'analog (not with Wi-Fi on)', touch: 'touch', i2c: 'I2C', uart: 'serial (UART)', spi: 'SPI', dac: 'analog output (DAC)', int: 'interrupt', power: 'power' };
    function drawInfo(p) {
      info.innerHTML = '';
      if (!p) { info.append(h('p', { class: 'small muted' }, 'Click a pin on the board to see what it can do and what uses it.')); return; }
      const users = placed().flatMap((pl) => Object.entries(pl.assign || {}).filter(([, g]) => Number(g) === p.gpio).map(([r]) => `${pl.name || pl.id}: ${r}`));
      info.append(h('h3', {}, `${p.label}${p.gpio != null ? ` — GPIO ${p.gpio}` : ''}`),
        h('div', { class: 'chips' }, ...(p.caps || []).map((c) => h('span', { class: 'chip' }, CAP[c] || c))),
        p.note ? h('p', { class: `small ${p.level === 'error' ? 'bad-t' : p.level === 'warn' ? 'warn-t' : ''}` }, p.note) : null,
        h('p', { class: 'small' }, users.length ? `Used by: ${users.join(', ')}` : p.level === 'error' ? 'Not usable for your parts.' : 'Free.'));
      if (pst.board === 'esp32cam' && p.gpio != null && [1, 2, 3, 12, 13, 14, 15, 33].includes(p.gpio)) {
        const res = h('span', { class: 'small' });
        const t = (mode) => h('button', { class: 'btn tiny', onclick: async () => { res.textContent = '…'; const r = await api('/api/robot/car/pin', { body: { gpio: p.gpio, mode } }).catch((e) => ({ error: e.message })); res.textContent = r.error ? `✕ ${r.error}` : r.ok === false ? `✕ ${r.error}` : mode === 'read' ? `level ${r.level} ${r.level ? '(HIGH — nothing pulls it down)' : '(LOW — something connects it to GND)'}` : mode === 'blink' ? 'blinked 6 times' : `${mode.toUpperCase()} for 3 s`; } }, ({ read: '🔍 Read', high: '⬆ HIGH 3 s', low: '⬇ LOW 3 s', blink: '✨ Blink' })[mode]);
        info.append(h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Test on the car:'), t('read'), t('high'), t('low'), t('blink'), res),
          h('p', { class: 'small muted' }, 'Read: a button or a sensor output on this pin changes the level. HIGH / Blink: an LED (with a 220 Ω resistor) or a buzzer on it lights / beeps — the wire is right.'));
      }
    }
    function drawBuild() {
      buildCard.innerHTML = '';
      const list = placed();
      buildCard.append(h('h3', {}, `My robot on the ${board.name.replace(/\s*\(.*\)/, '')}`));
      buildCard.append(h('div', { class: 'list' }, ...list.map((pl) => {
        const part = partsById[pl.part] || {};
        return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', {}, pl.name || part.name), h('div', { class: 'meta' }, Object.entries(pl.assign || {}).map(([r, g]) => `${r} → ${(board.pins.find((x) => x.gpio === Number(g)) || {}).label || `GPIO ${g}`}`).join(' · '))),
          pl.fixed ? h('span', { class: 'pill' }, carVals ? 'from the car' : 'car wiring') : h('button', { class: 'btn tiny ghost', onclick: async () => { pst.builds[pst.board].parts = pst.builds[pst.board].parts.filter((x) => x.id !== pl.id); await save(); renderParts(el); } }, 'Remove'));
      })));
      if (!list.length) buildCard.append(h('p', { class: 'small muted' }, 'No parts yet.'));
      const codeOut = h('pre', { class: 'shield-cmds', hidden: true });
      buildCard.append(h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { pst.wizard = { step: 1 }; drawWizard(); } }, '＋ Add a part'),
        h('button', { class: 'btn', onclick: async () => { const r = await api('/api/robot/parts/code', { body: { board: pst.board, placed: list.filter((x) => !x.builtin) } }); codeOut.hidden = false; codeOut.textContent = r.code || r.error; } }, '📋 Starter code'),
        h('button', { class: 'btn', onclick: () => askAgent(`Write Arduino firmware for my ${board.name} (FQBN ${board.fqbn}) with this wiring:\n${list.map((pl) => `- ${pl.name || (partsById[pl.part] || {}).name}: ${Object.entries(pl.assign || {}).map(([r, g]) => `${r}=GPIO ${g}`).join(', ')}`).join('\n')}\nCheck the pins with board_pins first, then create the project in the Firmware studio folder, compile it and fix every error.`) }, '🤖 Ask Muse to write the firmware')),
        codeOut, wiz);
    }
    const wiz = h('div', { class: 'wizard' });
    async function drawWizard() {
      wiz.innerHTML = '';
      const w = pst.wizard;
      if (!w) return;
      if (w.step === 1) {
        const kinds = [...new Set(pst.data.parts.map((p) => p.kind))];
        wiz.append(h('h3', {}, 'Add a part — 1. What is it?'),
          ...kinds.map((k) => h('div', {}, h('div', { class: 'small muted kind' }, k), h('div', { class: 'part-grid' }, ...pst.data.parts.filter((p) => p.kind === k).map((p) => h('button', { class: 'part-btn', onclick: async () => {
            const used = {}; for (const pl of placed()) for (const g of Object.values(pl.assign || {})) used[g] = pl.id;
            const busPl = placed().find((pl) => pl.assign && pl.assign.SDA != null);
            const r = await api('/api/robot/parts/plan', { body: { board: pst.board, part: p.id, used, i2c: busPl ? { sda: busPl.assign.SDA, scl: busPl.assign.SCL } : null } });
            pst.wizard = { step: 2, part: p, plan: r, assign: { ...(r.assign || {}) }, name: p.name }; drawWizard();
          } }, h('b', {}, p.name), h('span', { class: 'small muted' }, p.text)))))),
          h('button', { class: 'btn ghost', onclick: () => { pst.wizard = null; drawWizard(); } }, 'Cancel'));
        return;
      }
      const p = w.part;
      const free = board.pins.filter((x) => x.gpio != null && x.level !== 'error');
      const rows = p.signals.map((sg) => h('div', { class: 'row' }, h('span', { class: 'sig' }, sg.role), h('select', { onchange: (e) => { w.assign[sg.role] = Number(e.target.value); check(); } },
        h('option', { value: '' }, '—'), ...free.map((x) => h('option', { value: x.gpio, selected: Number(w.assign[sg.role]) === x.gpio ? '' : null }, `${x.label}${x.label.includes(String(x.gpio)) ? '' : ` (GPIO ${x.gpio})`}${x.level === 'warn' ? ' ⚠' : ''}`))),
        sg.note ? h('span', { class: 'small muted' }, sg.note) : null));
      const checks = h('div', { class: 'small' });
      async function check() {
        const a = {}, needs = {};
        for (const pl of placed()) for (const [r, g] of Object.entries(pl.assign || {})) a[`${pl.id}.${r}`] = g;
        for (const sg of p.signals) if (w.assign[sg.role] != null) { a[`new.${sg.role}`] = w.assign[sg.role]; needs[`new.${sg.role}`] = sg.needs.find((c) => ['out', 'pwm', 'adc', 'i2c', 'in'].includes(c)); }
        const r = await api('/api/robot/parts/check', { body: { board: pst.board, assign: a, needs } });
        const mine = (r.problems || []).filter((x) => x.name.startsWith('new.') && !(p.bus === 'i2c' && /already used/.test(x.message)));
        w.errors = mine.filter((x) => x.level === 'error').length;
        checks.innerHTML = '';
        checks.append(...(w.plan.notes || []).map((n) => h('div', { class: 'warn-t' }, '⚠ ', n)), ...mine.map((x) => h('div', { class: x.level === 'error' ? 'bad-t' : 'warn-t' }, x.level === 'error' ? '⛔ ' : '⚠ ', `${x.name.slice(4)}: ${x.message}`)));
        if (!mine.length && !(w.plan.notes || []).length) checks.append(h('div', {}, '✓ These pins are fine.'));
        addBtn.disabled = !!w.errors || p.signals.some((sg) => w.assign[sg.role] == null && !/optional/.test(sg.note || ''));
      }
      const nameIn = h('input', { value: w.name, maxlength: 40, oninput: (e) => { w.name = e.target.value; } });
      const addBtn = h('button', { class: 'btn primary', onclick: async () => {
        const b = pst.builds[pst.board] = pst.builds[pst.board] || { parts: [] };
        let id = p.id, n = 2; while (placed().some((x) => x.id === id)) id = `${p.id}${n++}`;
        b.parts.push({ id, name: w.name || p.name, part: p.id, assign: Object.fromEntries(Object.entries(w.assign).filter(([, g]) => g != null && !Number.isNaN(g))) });
        await save(); toast(`${w.name || p.name} added`); pst.wizard = null; renderParts(el);
      } }, '✓ Add to my robot');
      wiz.append(h('h3', {}, `Add a part — 2. ${p.name}`), h('p', { class: 'small' }, p.text),
        h('div', { class: 'small muted' }, `Power: ${p.power === 'battery' ? 'motor battery (7–12 V)' : p.power}${p.mA ? `, about ${p.mA} mA` : ''}${p.addr ? ` · I2C address 0x${p.addr.toString(16)}` : ''}${p.lib ? ` · library: ${p.lib}` : ''}${p.buy ? ` · eMAG: "${p.buy}"` : ''}`),
        ...(p.tips || []).map((t) => h('div', { class: 'small' }, '💡 ', t)),
        w.plan.ok === false ? h('div', { class: 'small bad-t' }, (w.plan.notes || []).join(' ')) : null,
        h('label', { class: 'inline small' }, 'Name ', nameIn), h('div', { class: 'sig-rows' }, ...rows), checks,
        h('div', { class: 'small muted' }, `How to test: ${p.test}`),
        h('div', { class: 'row' }, addBtn, h('button', { class: 'btn ghost', onclick: () => { pst.wizard = null; drawWizard(); } }, 'Cancel')));
      check();
    }
    function drawSchem() {
      schem.innerHTML = '';
      const list = placed().filter((x) => !x.builtin);
      schem.append(h('h3', {}, '🔌 Wiring'), h('p', { class: 'small muted' }, 'Every wire from the board to each part: red = power, grey = ground, blue = I2C (shared), purple = PWM, green = signal. Hover a part to follow its wires. Connect all grounds together.'),
        list.length ? schematicSvg(board, list, partsById) : h('p', { class: 'small muted' }, 'Add a part to see its wiring.'));
    }
    drawBoard(); drawInfo(pst.sel != null ? board.pins.find((x) => x.gpio === pst.sel) : null); drawBuild(); drawWizard(); drawSchem();
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

  window.MClab = { renderSettings, renderHealth, renderParts, boardSvg, schematicSvg, firmwareCard };
})();
