// Robot page → 🔌 Devices (what is connected: boards on USB, robots on the network) and 🧩 Firmware studio
// (Arduino projects: edit, compile, upload, serial monitor, ask the AI to change the code).
(() => {
  'use strict';
  const ui = () => window.MCui;
  const BOARDS = [
    ['esp32:esp32:esp32cam', 'AI Thinker ESP32-CAM (Baby Carpathron car)'],
    ['esp32:esp32:esp32', 'ESP32 Dev Module'],
    ['esp32:esp32:esp32s3', 'ESP32-S3 Dev Module'],
    ['esp32:esp32:esp32c3', 'ESP32-C3 Dev Module'],
    ['arduino:avr:uno', 'Arduino Uno'],
    ['arduino:avr:nano', 'Arduino Nano'],
    ['arduino:avr:mega', 'Arduino Mega 2560'],
    ['arduino:renesas_uno:unor4wifi', 'Arduino Uno R4 WiFi'],
    ['rp2040:rp2040:rpipico', 'Raspberry Pi Pico'],
    ['rp2040:rp2040:rpipicow', 'Raspberry Pi Pico W'],
  ];
  const ICON = { 'carpathron-car': '🚗', esp32: '📶', 'esp32-or-arduino': '🔌', esp32s3: '📶', avr: '🟦', arduino: '🟦', megaavr: '🟦', renesas: '🟦', pico: '🍓', 'pico-boot': '🍓', 'pico-mpy': '🐍', stm32: '🔷', teensy: '🟩', adafruit: '🟪', jetson: '🟢', 'jetson-usb': '🟢', 'jetson-recovery': '🟢', 'raspberry-pi': '🍓', linux: '🐧', serial: '🔌' };
  const st = { devices: null, project: '', files: [], file: '', content: '', saved: '', fqbn: '', port: '', problems: [], log: '', serial: '', serialOn: false, outTab: 'output', busy: false };
  let devTimer = null;

  // ------------------------------------------------------------------ Devices
  async function scan() {
    const { api } = ui();
    st.devices = await api('/api/hw/devices').catch((e) => ({ error: e.message, usb: [], network: [] }));
    return st.devices;
  }
  async function renderDevices(el) {
    const { h, api, toast, openRobot } = ui();
    clearTimeout(devTimer);
    el.innerHTML = '';
    const list = h('div', { class: 'settings' }, h('p', { class: 'small muted' }, 'Looking for boards and robots…'));
    const scanBtn = h('button', { class: 'btn', onclick: async () => { scanBtn.disabled = true; await scan(); scanBtn.disabled = false; draw(); } }, '🔍 Scan again');
    el.append(h('p', { class: 'small muted settings-intro' }, 'Plug a board into USB or switch on a robot: it shows up here with the board type, the tools it needs and what you can do with it. Supported: ESP32 / ESP32-CAM, Arduino (Uno, Nano, Mega, R4), Raspberry Pi Pico, STM32, Teensy over USB; the Carpathron car, Raspberry Pi and NVIDIA Jetson on the network.'), h('div', { class: 'row' }, scanBtn), list);
    const coreOk = (core) => !core || (st.devices.cores || []).some((c) => String(c.id).toLowerCase() === String(core).toLowerCase());
    const install = (core) => h('button', { class: 'btn tiny primary', onclick: async (ev) => {
      ev.currentTarget.disabled = true; toast(`Installing ${core || 'the Arduino tools'} — several minutes the first time`);
      const r = await api('/api/hw/install', { body: { core } });
      toast(r.error || (r.ok ? `${core || 'Arduino tools'} installed` : 'Install failed — see the Firmware studio output'), !!r.error || !r.ok);
      await scan(); draw();
    } }, `⬇ Install ${core || 'Arduino tools'}`);
    function card(d) {
      const btns = [];
      if (d.type === 'usb') {
        if (d.tools === 'arduino' || d.robot) {
          if (!st.devices.cli) btns.push(install(''));
          else if (d.core && !coreOk(d.core)) btns.push(install(d.core));
          if (d.robot) btns.push(h('button', { class: 'btn tiny primary', onclick: () => openStudio({ project: 'carpathron_car', template: 'carpathron_car', fqbn: d.fqbn, port: d.address }) }, '🧩 Open the car firmware'));
          btns.push(h('button', { class: 'btn tiny', onclick: () => openStudio({ fqbn: d.fqbn || '', port: d.address, newProject: true }) }, '＋ New firmware for this board'));
          if (d.address) btns.push(h('button', { class: 'btn tiny', onclick: () => openStudio({ port: d.address, serial: true }) }, '📟 Serial monitor'));
        }
        if (d.kind === 'pico-boot') btns.push(h('button', { class: 'btn tiny', onclick: () => ui().askAgent('A Raspberry Pi Pico is connected in BOOTSEL mode. Flash the latest MicroPython .uf2 to it with pico_flash, then check it with the micropython tool.') }, '🐍 Install MicroPython (AI)'));
        if (d.kind === 'pico-mpy') btns.push(h('button', { class: 'btn tiny', onclick: () => ui().askAgent(`A Raspberry Pi Pico with MicroPython is on ${d.address}. Show me what is on it (micropython tool) and help me write main.py.`) }, '🐍 Work on it (AI)'));
        if (d.kind === 'jetson-usb') btns.push(h('button', { class: 'btn tiny', onclick: () => ui().show('remote') }, '🖥 Add as SSH server'));
      } else {
        if (d.kind === 'carpathron-car') {
          btns.push(h('button', { class: 'btn tiny primary', onclick: () => openRobot('control') }, '🎮 Drive'), h('button', { class: 'btn tiny', onclick: () => openRobot('setup') }, '⚙ Setup & firmware'));
        } else if (d.serverId) btns.push(h('button', { class: 'btn tiny', onclick: () => ui().show('remote') }, '🖥 Open on Remote'), h('button', { class: 'btn tiny', onclick: () => ui().askAgent(`Check the robot computer "${d.name}" (${d.address}) over SSH: OS, CPU/GPU, camera, I2C/GPIO, Python, ROS 2. Then tell me what we can run on it.`) }, '🤖 Inspect with AI'));
        else btns.push(h('button', { class: 'btn tiny', onclick: () => ui().show('remote') }, '🖥 Add as SSH server'));
      }
      const meta = d.type === 'usb'
        ? [d.address, d.chip, d.vid ? `USB ${d.vid}:${d.pid}` : '', d.fqbn ? `board ${d.fqbn}` : 'board: pick in the studio', d.core ? (coreOk(d.core) ? `${d.core} ✓` : `${d.core} not installed`) : ''].filter(Boolean).join(' · ')
        : [d.address, d.online === false ? 'offline' : d.online ? 'online' : '', d.firmware ? `firmware ${d.firmware}` : '', d.sensors ? `distance ${d.sensors.tof ? '✓' : '—'} · gyro ${d.sensors.imu ? '✓' : '—'}` : ''].filter(Boolean).join(' · ');
      return h('div', { class: 'item device' }, h('span', { class: 'dev-ico' }, ICON[d.kind] || '🔌'),
        h('div', { class: 'grow' }, h('b', {}, d.robot ? `${d.robot} — ${d.name}` : d.name), h('div', { class: 'meta' }, meta), d.note ? h('div', { class: 'small muted' }, d.note) : null, h('div', { class: 'row' }, ...btns)));
    }
    function draw() {
      const d = st.devices || { usb: [], network: [] };
      list.innerHTML = '';
      if (d.error) list.append(h('p', { class: 'small' }, `✕ ${d.error}`));
      list.append(h('div', { class: 'card' }, h('h3', {}, `On USB (${d.usb.length})`),
        h('p', { class: 'small muted' }, d.cli ? `Arduino tools ready · cores: ${(d.cores || []).map((c) => `${c.id} ${c.version}`).join(', ') || 'none yet'}` : 'Arduino tools (arduino-cli) not installed yet — the first "Install" sets them up.'),
        d.usb.length ? h('div', { class: 'list' }, ...d.usb.map(card)) : h('p', { class: 'small muted' }, 'Nothing on USB. Connect the board with a data cable (not charge-only). ESP32 / clone boards need the CH340 or CP210x driver.')));
      list.append(h('div', { class: 'card' }, h('h3', {}, `On the network (${d.network.length})`),
        d.network.length ? h('div', { class: 'list' }, ...d.network.map(card)) : h('p', { class: 'small muted' }, 'No robots found. The car: Setup → Find my car. Raspberry Pi / Jetson: add them on the Remote page (SSH).')));
    }
    if (!st.devices) await scan();
    draw();
    // watch for plugged / unplugged boards while this tab is open
    const tick = async () => {
      if (!document.body.contains(list) || ui().S.robotTab !== 'devices' || ui().view() !== 'robot') return;
      const before = JSON.stringify((st.devices || {}).usb || []);
      await scan();
      if (JSON.stringify(st.devices.usb) !== before) draw();
      devTimer = setTimeout(tick, 6000);
    };
    devTimer = setTimeout(tick, 6000);
  }

  // ------------------------------------------------------------------ Firmware studio
  let pending = null;
  function openStudio(opts) { pending = opts; ui().openRobot('studio'); }

  async function loadProject(name) {
    const { api } = ui();
    st.project = name;
    try { localStorage.setItem('mc.studioProject', name); } catch {}
    const r = await api(`/api/studio/files?project=${encodeURIComponent(name)}`);
    if (r.error) throw new Error(r.error);
    st.files = r.files; st.dir = r.dir;
    if (r.meta.fqbn) st.fqbn = r.meta.fqbn;
    if (r.meta.port && !st.port) st.port = r.meta.port;
    await openFile(st.files.some((f) => f.name === st.file) ? st.file : (st.files[0] || {}).name);
  }
  async function openFile(name) {
    if (!name) { st.file = ''; st.content = st.saved = ''; return; }
    const r = await ui().api(`/api/studio/file?project=${encodeURIComponent(st.project)}&name=${encodeURIComponent(name)}`);
    if (r.error) throw new Error(r.error);
    st.file = name; st.content = st.saved = r.content; st.history = r.history;
  }
  async function saveFile() {
    if (!st.project || !st.file || st.content === st.saved) return true;
    const r = await ui().api('/api/studio/file', { body: { project: st.project, name: st.file, content: st.content } });
    if (r.error) { ui().toast(r.error, true); return false; }
    st.saved = st.content;
    return true;
  }

  async function renderStudio(el) {
    const { h, api, toast, $ } = ui();
    const info = await api('/api/studio/projects');
    if (!st.devices) scan().then(() => drawPorts && drawPorts());
    const p = pending; pending = null;
    if (p && p.template === 'carpathron_car' && !info.projects.some((x) => x.name === 'carpathron_car')) { await api('/api/studio/new', { body: { template: 'carpathron_car' } }); info.projects = (await api('/api/studio/projects')).projects; }
    if (p && p.fqbn) st.fqbn = p.fqbn;
    if (p && p.port) st.port = p.port;
    let want = (p && p.project) || st.project;
    if (!want) { try { want = localStorage.getItem('mc.studioProject') || ''; } catch {} }
    if (!info.projects.some((x) => x.name === want)) want = (info.projects[0] || {}).name || '';
    if (want && want !== st.project) await loadProject(want).catch((e) => toast(e.message, true));
    else if (want) await loadProject(want).catch(() => {}); // pick up changes the AI made

    el.innerHTML = '';
    // toolbar
    const projSel = h('select', {}, ...info.projects.map((x) => h('option', { value: x.name }, x.name)));
    projSel.value = st.project;
    projSel.onchange = async () => { if (!(await saveFile())) return; await loadProject(projSel.value); renderStudio(el); };
    const newBtn = h('button', { class: 'btn', onclick: () => newProject(info.templates) }, '＋ New');
    const board = h('input', { list: 'studioBoards', value: st.fqbn, placeholder: 'board, e.g. esp32:esp32:esp32cam', style: 'min-width:220px' });
    const boardList = h('datalist', { id: 'studioBoards' }, ...BOARDS.map(([f, n]) => h('option', { value: f }, n)));
    board.onchange = () => { st.fqbn = board.value.trim(); if (st.project) api('/api/studio/meta', { body: { project: st.project, fqbn: st.fqbn, port: st.port } }); };
    const port = h('select', {});
    var drawPorts = () => {
      const usb = (st.devices && st.devices.usb) || [];
      port.innerHTML = '';
      port.append(h('option', { value: '' }, usb.length ? 'port…' : 'no board on USB'), ...usb.filter((d) => d.address).map((d) => h('option', { value: d.address }, `${d.address} — ${d.robot || d.name}`)));
      if (st.port && ![...port.options].some((o) => o.value === st.port)) port.append(h('option', { value: st.port }, `${st.port} (not seen now)`));
      port.value = st.port || '';
    };
    port.onchange = () => { st.port = port.value; if (st.project) api('/api/studio/meta', { body: { project: st.project, fqbn: st.fqbn, port: st.port } }); };
    drawPorts();
    const refresh = h('button', { class: 'btn tiny', title: 'Look for boards again', onclick: async () => { await scan(); drawPorts(); } }, '↻');
    const status = h('span', { class: 'small muted' });
    const act = async (what) => {
      if (!st.project) return toast('Create or open a project first', true);
      if (!(await saveFile())) return;
      st.fqbn = board.value.trim();
      // pin check first: pins the board cannot use stop the upload once (press Upload again to upload anyway)
      if (st.fqbn) {
        const pc = await api('/api/studio/pincheck', { body: { project: st.project, fqbn: st.fqbn } }).catch(() => null);
        if (pc && pc.board) {
          const errs = pc.problems.filter((x) => x.level === 'error'), warns = pc.problems.filter((x) => x.level === 'warn');
          st.pinNote = pc.problems.map((x) => `${x.level === 'error' ? '⛔' : '⚠'} ${x.name} → GPIO ${x.gpio}: ${x.message}`).join('\n');
          drawPinNote();
          if (what === 'upload' && errs.length && !st.pinOverride) { st.pinOverride = true; toast(`${errs.length} pin problem${errs.length > 1 ? 's' : ''} for the ${pc.board} — see below. Press Upload again to upload anyway.`, true); return; }
          if (!errs.length && !warns.length) st.pinNote = `✓ Pins checked for the ${pc.board}: ${Object.entries(pc.pins).map(([k, g]) => `${k}=${g}`).join(', ') || 'none found'}`;
          drawPinNote();
        }
      }
      st.pinOverride = false;
      st.busy = true; drawButtons(); st.outTab = 'output'; drawOut();
      const r = await api(`/api/studio/${what}`, { body: { project: st.project, fqbn: st.fqbn, port: st.port } });
      st.busy = false; drawButtons();
      if (r.error) { toast(r.error, true); return; }
      st.problems = r.problems || [];
      status.textContent = r.ok ? (what === 'compile' ? `✓ Compiled${r.size ? ` — ${r.size.bytes.toLocaleString()} bytes (${r.size.percent}% of flash)` : ''}` : '✓ Uploaded') : `✕ ${what === 'compile' ? 'Compile' : 'Upload'} failed${r.hint ? ` — ${r.hint}` : ''}`;
      drawProblems();
      if (r.ok && what === 'upload' && st.serialOn === false && st.port) { /* user can open the monitor */ }
    };
    const saveBtn = h('button', { class: 'btn', title: 'Ctrl+S', onclick: async () => { if (await saveFile()) { status.textContent = '✓ Saved'; drawTabs(); } } }, '💾 Save');
    const compileBtn = h('button', { class: 'btn', onclick: () => act('compile') }, '✔ Compile');
    const uploadBtn = h('button', { class: 'btn primary', onclick: () => act('upload') }, '⬆ Upload');
    const stopBtn = h('button', { class: 'btn', onclick: () => api('/api/studio/cancel', { body: {} }) }, '■ Stop');
    const serialBtn = h('button', { class: 'btn', onclick: () => toggleSerial() }, '📟 Serial');
    const libBtn = h('button', { class: 'btn', title: 'Find and install Arduino libraries', onclick: () => libraries() }, '📚 Libraries');
    const drawButtons = () => { compileBtn.disabled = uploadBtn.disabled = st.busy; stopBtn.hidden = !st.busy; serialBtn.textContent = st.serialOn ? '📟 Stop serial' : '📟 Serial'; };

    // files + editor
    const tabs = h('div', { class: 'studio-files' });
    const drawTabs = () => {
      tabs.innerHTML = '';
      for (const f of st.files) tabs.append(h('button', { class: f.name === st.file ? 'on' : '', onclick: async () => { if (!(await saveFile())) return; await openFile(f.name); drawEditor(); drawTabs(); } }, `${f.name}${f.name === st.file && st.content !== st.saved ? ' ●' : ''}`));
      tabs.append(h('button', { class: 'ghost', title: 'New file in this project', onclick: async () => {
        const n = await window.MCask('New file (e.g. motors.h, sensors.cpp)', '');
        if (!n) return;
        const r = await api('/api/studio/file', { body: { project: st.project, name: n, content: '' } });
        if (r.error) return toast(r.error, true);
        await loadProject(st.project); await openFile(n); drawEditor(); drawTabs();
      } }, '＋ file'));
    };
    const gutter = h('pre', { class: 'studio-gutter' });
    const ed = h('textarea', { class: 'studio-editor', spellcheck: 'false', wrap: 'off' });
    const hl = h('pre', { class: 'studio-hl', 'aria-hidden': 'true' });
    const edWrap = h('div', { class: 'studio-edwrap' }, hl, ed);
    const sug = h('div', { class: 'studio-sug', hidden: true, role: 'listbox' });
    const paint = () => { hl.innerHTML = highlight(ed.value) + '\n'; hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft; };
    const drawGutter = () => { const n = ed.value.split('\n').length; const bad = new Set(st.problems.filter((x) => x.file === st.file).map((x) => x.line)); gutter.innerHTML = ''; for (let i = 1; i <= n; i++) gutter.append(h('span', { class: bad.has(i) ? 'bad' : '' }, `${i}\n`)); };
    const drawEditor = () => { ed.value = st.content; ed.disabled = !st.file; drawGutter(); paint(); };
    ed.oninput = (e) => { const was = st.content === st.saved; st.content = ed.value; if (was !== (st.content === st.saved)) drawTabs(); drawGutter(); paint(); if (e && e.inputType && e.inputType.startsWith('insert')) suggest(false); else hideSug(); };
    ed.onscroll = () => { gutter.scrollTop = ed.scrollTop; hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft; hideSug(); };
    ed.onblur = () => setTimeout(hideSug, 150);
    // autocomplete: Arduino / ESP32 functions, keywords and the names in this file (Ctrl+Space, or while typing)
    let sugItems = [], sugIdx = 0, sugWord = '';
    function hideSug() { sug.hidden = true; sugItems = []; }
    function suggest(force) {
      const pos = ed.selectionStart, before = ed.value.slice(0, pos), m = before.match(/[A-Za-z_][\w.]*$/);
      sugWord = m ? m[0] : '';
      if (!force && sugWord.length < 2) return hideSug();
      const own = new Set((ed.value.match(/\b[A-Za-z_]\w{2,}\b/g) || []));
      const all = [...new Set([...WORDS, ...own])];
      sugItems = all.filter((w) => w.toLowerCase().startsWith(sugWord.toLowerCase()) && w !== sugWord).sort((a, b) => a.length - b.length).slice(0, 8);
      if (!sugItems.length) return hideSug();
      sugIdx = 0; drawSug();
      const lines = before.split('\n'), line = lines.length - 1, col = lines[line].length - sugWord.length;
      const cw = charW(), lh = 18;
      sug.style.left = `${Math.max(0, 12 + col * cw - ed.scrollLeft + 52)}px`; sug.style.top = `${10 + (line + 1) * lh - ed.scrollTop + 2}px`; sug.hidden = false;
    }
    function drawSug() { sug.innerHTML = ''; sugItems.forEach((w, i) => sug.append(h('div', { class: i === sugIdx ? 'on' : '', role: 'option', onmousedown: (e) => { e.preventDefault(); sugIdx = i; accept(); } }, w, DOCS[w] ? h('span', {}, DOCS[w]) : null))); }
    function accept() { const w = sugItems[sugIdx]; if (!w) return; const pos = ed.selectionStart; ed.setRangeText(w, pos - sugWord.length, pos, 'end'); hideSug(); ed.oninput(); }
    let cwCache = 0; const charW = () => { if (cwCache) return cwCache; const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(ed).font; cwCache = c.measureText('MMMMMMMMMM').width / 10 || 7.8; return cwCache; };
    ed.onkeydown = (e) => {
      if (!sug.hidden && sugItems.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); sugIdx = (sugIdx + 1) % sugItems.length; drawSug(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); sugIdx = (sugIdx + sugItems.length - 1) % sugItems.length; drawSug(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(); return; }
        if (e.key === 'Escape') { e.preventDefault(); hideSug(); return; }
      }
      if (e.ctrlKey && e.key === ' ') { e.preventDefault(); suggest(true); return; }
      if (e.key === 'Tab') { e.preventDefault(); const a = ed.selectionStart; ed.setRangeText('  ', a, ed.selectionEnd, 'end'); ed.oninput(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveBtn.click(); }
    };
    const goto = (line) => { const lines = ed.value.split('\n'); let pos = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1; ed.focus(); ed.setSelectionRange(pos, pos + (lines[line - 1] || '').length); ed.scrollTop = Math.max(0, (line - 5) * 18); };
    const probs = h('div', { class: 'studio-problems' });
    const pinNoteEl = h('pre', { class: 'studio-pins small', hidden: true });
    const drawPinNote = () => { pinNoteEl.hidden = !st.pinNote; pinNoteEl.textContent = st.pinNote || ''; };
    const drawProblems = () => {
      probs.innerHTML = '';
      for (const x of st.problems) probs.append(h('button', { class: x.kind, onclick: async () => { if (x.file !== st.file && st.files.some((f) => f.name === x.file)) { if (!(await saveFile())) return; await openFile(x.file); drawEditor(); drawTabs(); } goto(x.line); } }, `${x.kind === 'error' ? '✕' : '⚠'} ${x.file}:${x.line} — ${x.msg}`));
      if (st.problems.some((x) => x.kind === 'error')) probs.append(h('button', { class: 'fix', onclick: () => askAI(`Fix these compile errors:\n${st.problems.map((x) => `${x.file}:${x.line}: ${x.msg}`).join('\n')}`) }, '🤖 Fix the errors with AI'));
      drawGutter();
    };
    // output / serial
    const outTabs = h('div', { class: 'seg' });
    const out = h('pre', { class: 'studio-out' });
    const serialIn = h('input', { placeholder: 'send a line to the board (Enter)…' });
    const baud = h('select', {}, ...[9600, 57600, 115200, 230400, 921600].map((b) => h('option', { value: b }, `${b} baud`)));
    baud.value = '115200';
    serialIn.onkeydown = async (e) => { if (e.key === 'Enter' && serialIn.value) { await api('/api/studio/serial', { body: { action: 'send', text: serialIn.value } }); serialIn.value = ''; } };
    const serialRow = h('div', { class: 'row' }, serialIn, baud);
    // serial plotter: numbers in each line ("1 2 3", "1,2,3" or "temp:21.5 hum:40") become lines on a chart
    const plot = h('canvas', { class: 'studio-plot', hidden: true, height: 220 });
    function drawPlot() {
      const series = {}; const rows = st.serial.split('\n').slice(-301, -1);
      rows.forEach((line, i) => { const named = [...line.matchAll(/([A-Za-z_][\w ]*?)\s*[:=]\s*(-?\d+(?:\.\d+)?)/g)]; const vals = named.length ? named.map((m) => [m[1].trim(), Number(m[2])]) : (line.match(/-?\d+(?:\.\d+)?/g) || []).slice(0, 6).map((v, k) => [`value ${k + 1}`, Number(v)]); for (const [k, v] of vals) (series[k] = series[k] || []).push([i, v]); });
      const w = plot.width = plot.clientWidth || 800, H = plot.height, g = plot.getContext('2d');
      g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, H);
      const all = Object.values(series).flat(); if (!all.length) { g.fillStyle = '#959cab'; g.font = '13px sans-serif'; g.fillText('No numbers in the serial output yet. Print values, e.g. Serial.println(analogRead(34)); or "temp:21.5 hum:40".', 12, 24); return; }
      let lo = Math.min(...all.map((p) => p[1])), hi = Math.max(...all.map((p) => p[1])); if (lo === hi) { lo -= 1; hi += 1; }
      const n = Math.max(1, rows.length - 1), X = (i) => 40 + (i / n) * (w - 50), Y = (v) => H - 18 - ((v - lo) / (hi - lo)) * (H - 36);
      g.strokeStyle = '#232a33'; g.fillStyle = '#5d6673'; g.font = '11px sans-serif';
      for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v); g.beginPath(); g.moveTo(40, y); g.lineTo(w - 10, y); g.stroke(); g.fillText(String(Math.round(v * 100) / 100), 2, y + 4); }
      const COL = ['#4f8cff', '#3ddc97', '#f5b74e', '#ff5b6b', '#b07cff', '#4fd1ff'];
      Object.entries(series).slice(0, 6).forEach(([name, pts], si) => { g.strokeStyle = COL[si]; g.lineWidth = 1.6; g.beginPath(); pts.forEach(([i, v], j) => (j ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.stroke(); g.fillStyle = COL[si]; g.fillText(`${name}: ${pts[pts.length - 1][1]}`, 48 + si * 120, 12); });
    }
    const drawOut = () => {
      outTabs.innerHTML = '';
      for (const [id, label] of [['output', 'Output'], ['serial', `Serial${st.serialOn ? ' ●' : ''}`], ['plot', '📈 Plotter']]) outTabs.append(h('button', { class: st.outTab === id ? 'on' : '', onclick: () => { st.outTab = id; drawOut(); } }, label));
      out.textContent = st.outTab === 'output' ? st.log : st.serial;
      out.hidden = st.outTab === 'plot'; plot.hidden = st.outTab !== 'plot';
      serialRow.hidden = st.outTab === 'output';
      if (st.outTab === 'plot') drawPlot();
      out.scrollTop = out.scrollHeight;
    };
    async function toggleSerial() {
      if (st.serialOn) { await api('/api/studio/serial', { body: { action: 'stop' } }); st.serialOn = false; }
      else {
        if (!st.port) return toast('Pick the port first', true);
        const r = await api('/api/studio/serial', { body: { action: 'start', port: st.port, baud: baud.value } });
        if (r.error) return toast(r.error, true);
        st.serialOn = true; st.serial += `\n[monitor ${st.port} @ ${baud.value}]\n`;
      }
      st.outTab = 'serial'; drawButtons(); drawOut();
    }
    // ask the AI
    const aiBox = h('textarea', { rows: 2, placeholder: 'Ask the AI to change this firmware, e.g. "add a /beep endpoint that buzzes on GPIO 4" or "explain how the motors are driven"…' });
    async function askAI(text) {
      if (!st.project) return toast('Open a project first', true);
      if (!(await saveFile())) return;
      ui().askAgent(`Firmware project "${st.project}" in ${st.dir} (board ${st.fqbn || 'not set'}${st.port ? `, connected on ${st.port}` : ''}). ${text}\n\nWork on the files in that folder (read before editing, small edit_file changes), then compile with arduino_compile (fqbn ${st.fqbn || 'ask me'}) and fix every error until it builds. Upload with arduino_upload only if I asked for it. When done, tell me what you changed — I continue in Robot → Firmware studio.`, st.dir);
    }
    const aiBtn = h('button', { class: 'btn primary', onclick: () => { const t = aiBox.value.trim(); if (t) askAI(t); } }, '🤖 Ask AI');

    const histSel = h('select', { title: 'Earlier versions of this file (saved automatically)' }, h('option', { value: '' }, `History (${(st.history || []).length})`), ...(st.history || []).map((x) => h('option', { value: x.id }, x.at.replace('T', ' '))));
    histSel.onchange = async () => { if (!histSel.value) return; const r = await api('/api/studio/restore', { body: { project: st.project, name: st.file, id: histSel.value } }); if (r.error) toast(r.error, true); await openFile(st.file); drawEditor(); drawTabs(); toast('Restored (the current version went to history)'); };

    el.append(boardList,
      h('div', { class: 'card studio' },
        h('div', { class: 'row studio-bar' }, h('b', {}, 'Project'), projSel, newBtn, h('b', {}, 'Board'), board, h('b', {}, 'Port'), port, refresh),
        h('div', { class: 'row studio-bar' }, saveBtn, compileBtn, uploadBtn, stopBtn, serialBtn, libBtn, histSel, status),
        st.project ? h('div', { class: 'small muted' }, `📁 ${st.dir}`) : h('p', {}, 'No firmware projects yet. Press ＋ New (or open the car firmware from the Devices tab).'),
        tabs,
        h('div', { class: 'studio-code' }, gutter, edWrap, sug),
        probs, pinNoteEl,
        h('div', { class: 'row' }, aiBox, aiBtn),
        outTabs, out, plot, serialRow));
    drawTabs(); drawEditor(); drawButtons(); drawProblems(); drawOut();
    window.MCstudio._out = (kind, text) => {
      if (kind === 'log') st.log = (st.log + text).slice(-200000); else st.serial = (st.serial + text).slice(-200000);
      if ((kind === 'log' && st.outTab === 'output') || (kind === 'serial' && st.outTab === 'serial')) { out.textContent = kind === 'log' ? st.log : st.serial; out.scrollTop = out.scrollHeight; }
      if (kind === 'serial' && st.outTab === 'plot') { clearTimeout(drawPlot.t); drawPlot.t = setTimeout(drawPlot, 120); }
    };
    if (p && p.serial) toggleSerial();
    if (p && p.newProject) newProject(info.templates);
  }

  async function libraries() {
    const { h, api, toast, modal } = ui();
    const q = h('input', { placeholder: 'search, e.g. VL53L0X, Servo, NeoPixel, SSD1306' });
    const list = h('div', { class: 'list' });
    const go = async () => {
      list.innerHTML = ''; list.append(h('p', { class: 'small muted' }, 'Searching…'));
      const r = await api('/api/studio/libs', { body: { q: q.value.trim() } }).catch((e) => ({ error: e.message }));
      list.innerHTML = '';
      if (r.error) return list.append(h('p', { class: 'small' }, `✕ ${r.error}`));
      if (!r.libs.length) return list.append(h('p', { class: 'small muted' }, 'Nothing found.'));
      for (const l of r.libs) list.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', {}, `${l.name} `), h('span', { class: 'small muted' }, `${l.version} · ${l.author}`), h('div', { class: 'meta' }, l.sentence)),
        r.installed.includes(l.name) ? h('span', { class: 'pill ok' }, 'installed') : h('button', { class: 'btn tiny primary', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Installing…'; const x = await api('/api/studio/libinstall', { body: { name: l.name } }).catch((er) => ({ error: er.message })); b.textContent = x.ok ? '✓ installed' : '✕ failed'; if (!x.ok) toast(x.error || x.out || 'Install failed', true); } }, 'Install')));
    };
    q.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    modal(h('div', { class: 'libs' }, h('h3', {}, '📚 Arduino libraries'), h('p', { class: 'small muted' }, 'Libraries add ready-made code for parts (sensors, displays, servos…). Installed ones work in every project.'), h('div', { class: 'row' }, q, h('button', { class: 'btn primary', onclick: go }, 'Search')), list));
    setTimeout(() => q.focus(), 50);
  }

  async function newProject(templates) {
    const { h, api, toast, modal, closeModal } = ui();
    const name = h('input', { placeholder: 'e.g. robot_arm, line_follower', value: '' });
    const tpl = h('select', {}, ...templates.map((t) => h('option', { value: t.id }, t.label)));
    const board = h('input', { list: 'studioBoards', value: st.fqbn || '', placeholder: 'board (fqbn)' });
    tpl.onchange = () => { if (tpl.value === 'carpathron_car') { name.value = 'carpathron_car'; board.value = 'esp32:esp32:esp32cam'; } };
    modal(h('div', {}, h('h3', {}, 'New firmware project'),
      h('label', {}, 'Name', name), h('label', {}, 'Start from', tpl), h('label', {}, 'Board', board),
      h('p', { class: 'small muted' }, 'Projects live in your workspace\\firmware folder. The AI can write the rest: describe what the robot should do in the "Ask AI" box.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => {
        const r = await api('/api/studio/new', { body: { name: name.value.trim(), template: tpl.value, fqbn: board.value.trim() } });
        if (r.error) return toast(r.error, true);
        closeModal(); st.fqbn = board.value.trim() || st.fqbn; await loadProject(r.name); ui().openRobot('studio');
      } }, 'Create'), h('button', { class: 'btn', onclick: () => closeModal() }, 'Cancel'))));
  }

  // ---- C++ colours and words for the editor
  const KW = new Set('if else for while do switch case break continue return void int long float double char bool byte uint8_t uint16_t uint32_t int8_t int16_t int32_t size_t unsigned signed const static volatile struct class public private true false nullptr new delete auto String sizeof typedef enum'.split(' '));
  const AR = new Set('pinMode digitalWrite digitalRead analogRead analogWrite delay delayMicroseconds millis micros Serial begin print println printf available read write map constrain tone noTone attachInterrupt Wire WiFi setup loop HIGH LOW INPUT OUTPUT INPUT_PULLUP ledcAttach ledcWrite ledcSetup ledcAttachPin Servo attach random abs min max'.split(' '));
  const WORDS = [...AR, ...KW, 'Serial.begin', 'Serial.println', 'Serial.print', 'Wire.begin', 'WiFi.begin', 'WiFi.status', 'WL_CONNECTED', 'esp_camera_init', 'ledcWrite', 'analogReadResolution', 'Preferences', 'xTaskCreate'];
  const DOCS = { pinMode: '(pin, OUTPUT|INPUT|INPUT_PULLUP)', digitalWrite: '(pin, HIGH|LOW)', digitalRead: '(pin) → HIGH|LOW', analogRead: '(pin) → 0–4095 on ESP32', analogWrite: '(pin, 0–255)', delay: '(ms)', millis: '() → ms since start', tone: '(pin, Hz, ms)', map: '(v, inLo, inHi, outLo, outHi)', constrain: '(v, lo, hi)', 'Serial.begin': '(115200)', 'Serial.println': '(value)', 'Wire.begin': '(sda, scl) on ESP32' };
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function highlight(src) {
    const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#\w+[^\n]*)|(\b\d+(?:\.\d+)?[fFuUlL]*\b|\b0x[0-9a-fA-F]+\b)|([A-Za-z_]\w*)/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index)); last = re.lastIndex;
      const t = esc(m[0]);
      if (m[1]) out += `<span class="c">${t}</span>`; else if (m[2]) out += `<span class="s">${t}</span>`; else if (m[3]) out += `<span class="p">${t}</span>`; else if (m[4]) out += `<span class="n">${t}</span>`;
      else out += KW.has(m[5]) ? `<span class="k">${t}</span>` : AR.has(m[5]) ? `<span class="f">${t}</span>` : t;
    }
    return out + esc(src.slice(last));
  }

  window.MCstudio = {
    renderDevices, renderStudio, openStudio,
    onEvent(ev, d) {
      if (ev === 'studio:log') { if (d.start) st.log += '\n'; if (this._out) this._out('log', d.text || ''); else st.log += d.text || ''; }
      if (ev === 'studio:serial') { if (d.closed) st.serialOn = false; if (this._out) this._out('serial', d.text || ''); else st.serial += d.text || ''; }
    },
  };
})();
