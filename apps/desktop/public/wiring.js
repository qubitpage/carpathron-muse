// Wiring picture (Robot → 🔧 Board & parts): the board and every module drawn like real hardware, with their real pin
// names, the connector type at each end (Dupont pin header / screw terminal / servo plug) and the wires in the usual
// colours — red = +, black = GND, a different colour for every signal. Point at a wire, a pin or a module to highlight it
// and read where it goes and what it does; the table under the picture lists every wire to tick off while wiring.
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (t, a = {}, ...kids) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) if (v != null) e.setAttribute(k, v); kids.forEach((k) => e.append(typeof k === 'string' ? document.createTextNode(k) : k)); return e; };
  const SIG_COLORS = [['#f2c230', 'yellow'], ['#3ddc84', 'green'], ['#4f9dff', 'blue'], ['#ff8a3d', 'orange'], ['#e9e9e9', 'white'], ['#b07cff', 'purple'], ['#9b6b43', 'brown'], ['#ff5fa2', 'pink'], ['#8a909c', 'grey']];
  const RED = ['#e53935', 'red'], BLACK = ['#1b1b1b', 'black'];

  // What each module looks like and which pins it has. kind: power | gnd | sig. conn: header | screw | plug
  function moduleOf(part, pl) {
    const roles = (part.signals || []).map((s) => s.role);
    const sig = (r) => ({ name: r, kind: 'sig', role: r, conn: 'header' });
    switch (part.id) {
      case 'l298n': return { look: 'l298n', w: 170, pins: [
        { name: '12V', kind: 'vbat', conn: 'screw', note: 'battery +' }, { name: 'GND', kind: 'gnd', conn: 'screw', note: 'battery − and board GND' }, { name: '5V', kind: 'power5', conn: 'screw', note: 'gives 5 V to the board' },
        ...['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'].map(sig)], outs: ['OUT1', 'OUT2', 'OUT3', 'OUT4'] };
      case 'tb6612': return { look: 'driver', w: 150, pins: [{ name: 'VM', kind: 'vbat', conn: 'header', note: 'battery +' }, { name: 'VCC', kind: 'power', conn: 'header' }, { name: 'GND', kind: 'gnd', conn: 'header' }, ...roles.map(sig)], outs: ['A01', 'A02', 'B01', 'B02'] };
      case 'sg90': return { look: 'servo', w: 130, pins: [{ name: 'brown', kind: 'gnd', conn: 'plug' }, { name: 'red', kind: 'power', conn: 'plug' }, { name: 'orange', kind: 'sig', role: 'signal', conn: 'plug' }] };
      case 'hcsr04': return { look: 'sonar', w: 140, pins: [{ name: 'VCC', kind: 'power', conn: 'header' }, sig('TRIG'), sig('ECHO'), { name: 'GND', kind: 'gnd', conn: 'header' }] };
      default: return { look: part.bus === 'i2c' ? 'i2c' : 'module', w: 140, pins: [{ name: part.power === '5V' ? '5V' : 'VCC', kind: 'power', conn: 'header' }, { name: 'GND', kind: 'gnd', conn: 'header' }, ...roles.map(sig)] };
    }
  }
  const LOOK = { l298n: ['#b3261e', '#7a1a14'], driver: ['#1f4fa3', '#163a78'], servo: ['#2a5bd7', '#1b3f9a'], sonar: ['#1f6fb2', '#12507f'], i2c: ['#5b2a86', '#3e1d5c'], module: ['#1d6b48', '#124a31'], battery: ['#2b2b2b', '#151515'], motor: ['#c9c9c9', '#8d8d8d'] };

  // placed: [{ id, name, part, assign: { role: gpio } }]  · car: true adds the battery pack and the four motors
  function render(container, { board, placed, partsById, car = false, h }) {
    container.innerHTML = '';
    // pins inside the board (side X, e.g. GPIO 33 on the ESP32-CAM) are drawn under it when something uses them
    const usedG = new Set(placed.flatMap((pl) => Object.values(pl.assign || {}).map(Number)));
    const extra = board.pins.filter((p) => p.side === 'X' && usedG.has(p.gpio)).map((p, i) => ({ ...p, side: 'B', pos: 1000 + i, label: `${p.label.replace(/\s*\(.*\)/, '')}*` }));
    const boardPins = [...board.pins.filter((p) => ['L', 'R', 'T', 'B'].includes(p.side)), ...extra];
    const L = boardPins.filter((p) => p.side === 'L').sort((a, b) => a.pos - b.pos), R = boardPins.filter((p) => p.side === 'R').sort((a, b) => a.pos - b.pos);
    const T = boardPins.filter((p) => p.side === 'T').sort((a, b) => a.pos - b.pos), Bm = boardPins.filter((p) => p.side === 'B').sort((a, b) => a.pos - b.pos);
    const PSTEP = 24, rows = Math.max(L.length, R.length, 6), cols = Math.max(T.length, Bm.length);
    const BW = Math.max(190, cols * 20 + 40), BH = rows * PSTEP + 70 + (T.length ? 40 : 0) + (Bm.length ? 40 : 0);
    // modules: which side of the board they sit on (where most of their pins are)
    const mods = placed.map((pl) => ({ pl, part: partsById[pl.part] })).filter((x) => x.part && !x.pl.builtin).map((x) => ({ ...x, mod: moduleOf(x.part, x.pl) }));
    const pinSide = (g) => { const p = boardPins.find((q) => q.gpio === Number(g)); return p ? p.side : 'R'; };
    for (const m of mods) { const s = Object.values(m.pl.assign || {}).map(pinSide); m.side = s.filter((x) => x === 'L').length > s.length / 2 ? 'L' : 'R'; }
    const MODGAP = 26, modH = (m) => 44 + m.mod.pins.length * 22;
    const colH = (side) => mods.filter((m) => m.side === side).reduce((a, m) => a + modH(m) + MODGAP, 0);
    const extraLeft = car ? 200 : 0;
    const LX = 30 + extraLeft, BX = LX + 170 + 210, RX = BX + BW + 230;
    const hasMotors = car && mods.some((m) => m.mod.outs);
    const W = RX + 180 + (hasMotors ? 230 : 20);
    const H = Math.max(BH + (car ? 240 : 130), colH('L') + (car ? 260 : 60), colH('R') + (car ? 260 : 60), car ? 620 : 0);
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wiring-svg', role: 'img', 'aria-label': `Wiring of the ${board.name}` });
    const defs = sv('defs');
    defs.append(sv('filter', { id: 'wsh', x: '-20%', y: '-20%', width: '140%', height: '140%' }, sv('feDropShadow', { dx: 0, dy: 2, stdDeviation: 2.5, 'flood-color': '#000', 'flood-opacity': 0.55 })));
    svg.append(defs);
    const wiresG = sv('g', { class: 'wires' }), bodiesG = sv('g'), labelsG = sv('g');
    svg.append(bodiesG, wiresG, labelsG);
    const pt = {}; // anchor points: 'board:<label>' / '<modid>:<pin>'

    // ---- the board
    const by = car ? 60 : Math.max(60, (H - BH) / 2);
    bodiesG.append(sv('rect', { x: BX, y: by, width: BW, height: BH, rx: 12, fill: '#16405f', stroke: '#2b6c9a', 'stroke-width': 2, filter: 'url(#wsh)' }));
    bodiesG.append(sv('rect', { x: BX + BW / 2 - 38, y: by + BH / 2 - 30, width: 76, height: 60, rx: 4, fill: '#0b1520', stroke: '#3a5068' }));
    bodiesG.append(sv('text', { x: BX + BW / 2, y: by + BH / 2 + 4, 'text-anchor': 'middle', class: 'w-chip' }, board.camera ? 'camera' : board.id.startsWith('esp') || board.id.startsWith('xiao') ? 'ESP32' : board.id === 'pico' ? 'RP2040' : 'ATmega'));
    bodiesG.append(sv('text', { x: BX + BW / 2, y: by + 22, 'text-anchor': 'middle', class: 'w-title' }, board.name.replace(/\s*\(.*\)/, '')));
    const y0 = by + 50 + (T.length ? 40 : 0);
    const pinDot = (x, y, p, key) => {
      const g = sv('g', { class: 'w-pin', 'data-key': key });
      g.append(sv('rect', { x: x - 6, y: y - 6, width: 12, height: 12, rx: 2, fill: '#1a1a1a', stroke: '#c9a24a', 'stroke-width': 2 }), sv('title', {}, `${p.label}${p.gpio != null ? ` (GPIO ${p.gpio})` : ''}`));
      bodiesG.append(g);
    };
    L.forEach((p, i) => { const x = BX + 14, y = y0 + i * PSTEP; pinDot(x, y, p, `board:${p.side}${p.pos}`); labelsG.append(sv('text', { x: x + 13, y: y + 4, class: 'w-pinl' }, p.label)); pt[`board:${p.side}${p.pos}`] = { x: x - 6, y, dir: -1, gpio: p.gpio }; });
    R.forEach((p, i) => { const x = BX + BW - 14, y = y0 + i * PSTEP; pinDot(x, y, p, `board:${p.side}${p.pos}`); labelsG.append(sv('text', { x: x - 13, y: y + 4, class: 'w-pinl', 'text-anchor': 'end' }, p.label)); pt[`board:${p.side}${p.pos}`] = { x: x + 6, y, dir: 1, gpio: p.gpio }; });
    const cx0 = BX + (BW - (cols - 1) * 20) / 2;
    T.forEach((p, i) => { const x = cx0 + i * 20, y = by + 14; pinDot(x, y, p, `board:${p.side}${p.pos}`); labelsG.append(sv('text', { x: x + 4, y: y + 12, class: 'w-pinl', transform: `rotate(90 ${x + 4} ${y + 12})` }, p.label)); pt[`board:${p.side}${p.pos}`] = { x, y: y - 6, dir: 0, up: true, gpio: p.gpio }; });
    Bm.forEach((p, i) => { const x = cx0 + i * 20, y = by + BH - 14; pinDot(x, y, p, `board:${p.side}${p.pos}`); labelsG.append(sv('text', { x: x + 4, y: y - 10, class: 'w-pinl', transform: `rotate(-90 ${x + 4} ${y - 10})` }, p.label)); pt[`board:${p.side}${p.pos}`] = { x, y: y + 6, dir: 0, down: true, gpio: p.gpio }; });
    const boardPinFor = (want, side) => { // a GPIO number, or 'GND' / '5V' / '3V3' (preferring a pin on the module's side)
      if (typeof want === 'number') { const p = boardPins.find((q) => q.gpio === want); return p ? `board:${p.side}${p.pos}` : null; }
      const cands = boardPins.filter((q) => q.gpio == null && (want === 'GND' ? /^GND/.test(q.label) : want === '5V' ? /^(5V|VIN|VBUS|VSYS)$/.test(q.label) : /^3V3/.test(q.label)));
      const best = cands.find((q) => q.side === side) || cands[0];
      return best ? `board:${best.side}${best.pos}` : null;
    };

    // ---- modules
    const place = (side) => { let y = car ? 20 : Math.max(20, (H - colH(side)) / 2); for (const m of mods.filter((x) => x.side === side)) { m.x = side === 'L' ? LX : RX; m.y = y; y += modH(m) + MODGAP; } };
    place('L'); place('R');
    for (const m of mods) {
      const [fill, edge] = LOOK[m.mod.look] || LOOK.module, w = m.mod.w, hgt = modH(m), left = m.side === 'R';
      const g = sv('g', { class: 'w-mod', tabindex: 0, 'data-mod': m.pl.id });
      g.append(sv('rect', { x: m.x, y: m.y, width: w, height: hgt, rx: m.mod.look === 'servo' ? 8 : 6, fill, stroke: edge, 'stroke-width': 2, filter: 'url(#wsh)' }));
      if (m.mod.look === 'l298n') g.append(sv('rect', { x: m.x + w / 2 - 24, y: m.y + 30, width: 48, height: 26, rx: 2, fill: '#222', stroke: '#555' }), sv('text', { x: m.x + w / 2, y: m.y + 47, 'text-anchor': 'middle', class: 'w-small' }, 'heatsink'));
      if (m.mod.look === 'sonar') { g.append(sv('circle', { cx: m.x + 40, cy: m.y + hgt - 24, r: 15, fill: '#c0c6cf', stroke: '#777' }), sv('circle', { cx: m.x + w - 40, cy: m.y + hgt - 24, r: 15, fill: '#c0c6cf', stroke: '#777' })); }
      g.append(sv('text', { x: m.x + w / 2, y: m.y + 18, 'text-anchor': 'middle', class: 'w-title' }, (m.pl.name || m.part.name).replace(/\s*\(.*\)/, '').slice(0, 26)));
      m.mod.pins.forEach((p, i) => {
        const py = m.y + 40 + i * 22 + (m.mod.look === 'l298n' ? 36 : 0) * 0, px = left ? m.x : m.x + w;
        const isScrew = p.conn === 'screw';
        g.append(isScrew ? sv('rect', { x: px - 8, y: py - 8, width: 16, height: 16, rx: 2, fill: '#2e7d32', stroke: '#1b5e20' }) : sv('rect', { x: px - 5, y: py - 5, width: 10, height: 10, rx: 1.5, fill: '#1a1a1a', stroke: '#c9a24a', 'stroke-width': 1.6 }));
        if (isScrew) g.append(sv('circle', { cx: px, cy: py, r: 3.5, fill: '#9aa0a6' }));
        labelsG.append(sv('text', { x: left ? px + 12 : px - 12, y: py + 4, 'text-anchor': left ? 'start' : 'end', class: 'w-pinl w-onboard' }, p.name));
        pt[`${m.pl.id}:${p.name}`] = { x: left ? px - (isScrew ? 8 : 5) : px + (isScrew ? 8 : 5), y: py, dir: left ? -1 : 1, conn: p.conn };
      });
      if (m.mod.outs && car) m.mod.outs.forEach((o, i) => { const px = m.x + w / 2 - 66 + i * 44, py = m.y + hgt; g.append(sv('rect', { x: px - 8, y: py - 8, width: 16, height: 16, rx: 2, fill: '#2e7d32', stroke: '#1b5e20' }), sv('circle', { cx: px, cy: py, r: 3.5, fill: '#9aa0a6' }), sv('text', { x: px, y: py - 12, 'text-anchor': 'middle', class: 'w-small' }, o)); pt[`${m.pl.id}:${o}`] = { x: px, y: py + 8, dir: 0, down: true, conn: 'screw' }; });
      bodiesG.append(g);
    }

    // ---- battery and motors for the car
    if (car && mods.some((m) => m.part.id === 'l298n')) {
      const drv = mods.find((m) => m.part.id === 'l298n');
      const bx = drv.side === 'L' ? drv.x : drv.x + drv.mod.w - 170, byy = H - 110;
      const g = sv('g', { class: 'w-mod', tabindex: 0, 'data-mod': 'battery' });
      g.append(sv('rect', { x: bx, y: byy, width: 170, height: 70, rx: 8, fill: '#262626', stroke: '#111', 'stroke-width': 2, filter: 'url(#wsh)' }));
      for (let i = 0; i < 2; i++) g.append(sv('rect', { x: bx + 12, y: byy + 12 + i * 26, width: 130, height: 20, rx: 10, fill: '#3d7a3d', stroke: '#244d24' }));
      g.append(sv('text', { x: bx + 85, y: byy + 88, 'text-anchor': 'middle', class: 'w-title' }, '2 × 18650 (7.4 V) + switch'));
      pt['bat:+'] = { x: bx + 170, y: byy + 20, dir: 1 }; pt['bat:-'] = { x: bx + 170, y: byy + 48, dir: 1 };
      g.append(sv('text', { x: bx + 160, y: byy + 24, 'text-anchor': 'end', class: 'w-pinl' }, '+'), sv('text', { x: bx + 160, y: byy + 52, 'text-anchor': 'end', class: 'w-pinl' }, '−'));
      bodiesG.append(g);
      {
        const right = drv.side === 'R', mx = right ? drv.x + drv.mod.w + 60 : Math.max(20, drv.x - 190);
        [['Right motors', 'OUT1', 'OUT2', drv.y + modH(drv) + 40], ['Left motors', 'OUT3', 'OUT4', drv.y + modH(drv) + 130]].forEach(([name, a, b2, my]) => {
          const gm = sv('g', { class: 'w-mod', tabindex: 0, 'data-mod': name });
          gm.append(sv('rect', { x: mx, y: my, width: 130, height: 70, rx: 30, fill: '#f2c230', stroke: '#b58f12', 'stroke-width': 2, filter: 'url(#wsh)' }), sv('rect', { x: right ? mx + 110 : mx - 20, y: my + 22, width: 30, height: 26, rx: 3, fill: '#c9c9c9', stroke: '#888' }), sv('text', { x: mx + 65, y: my + 32, 'text-anchor': 'middle', class: 'w-titled' }, name), sv('text', { x: mx + 65, y: my + 48, 'text-anchor': 'middle', class: 'w-titled' }, 'TT motor ×2'));
          const ex = right ? mx : mx + 130, d = right ? -1 : 1;
          pt[`${name}:+`] = { x: ex, y: my + 22, dir: d }; pt[`${name}:-`] = { x: ex, y: my + 48, dir: d };
          labelsG.append(sv('text', { x: ex - d * 10, y: my + 26, 'text-anchor': right ? 'start' : 'end', class: 'w-titled' }, '+'), sv('text', { x: ex - d * 10, y: my + 52, 'text-anchor': right ? 'start' : 'end', class: 'w-titled' }, '−'));
          bodiesG.append(gm);
        });
      }
    }

    // ---- wires
    const rows2 = [];
    let ci = 0, lane = 0;
    const wire = (from, to, color, desc, connA, connB) => {
      const a = pt[from], b = pt[to];
      if (!a || !b) return;
      const out = (p, d) => ({ x: p.x + (p.dir || 0) * d, y: p.y + (p.up ? -d : p.down ? d : 0) });
      let path;
      const boardEnd = from.startsWith('board:') ? a : to.startsWith('board:') ? b : null, other = boardEnd === a ? b : a;
      if (boardEnd && boardEnd.dir && Math.sign(other.x - boardEnd.x) !== boardEnd.dir) {
        // the pin faces away from the module: go out, round the top (or bottom) of the board, then to the module
        const k = lane++, over = boardEnd.y < by + BH / 2, yy = over ? by - 10 - k * 7 : by + BH + 10 + k * 7;
        const x1 = boardEnd.x + boardEnd.dir * (16 + k * 5), x2 = boardEnd.dir > 0 ? BX - 16 - k * 5 : BX + BW + 16 + k * 5;
        const r = 8, sy = over ? -1 : 1;
        const p1 = `M${boardEnd.x},${boardEnd.y} H${x1 - boardEnd.dir * r} Q${x1},${boardEnd.y} ${x1},${boardEnd.y + sy * r} V${yy - sy * r} Q${x1},${yy} ${x1 - boardEnd.dir * r},${yy} H${x2 + boardEnd.dir * r} Q${x2},${yy} ${x2},${yy - sy * -r}`;
        const c1 = { x: x2, y: yy + sy * 40 }, o = out(other, Math.max(40, Math.abs(other.x - x2) * 0.4));
        path = `${p1} C${c1.x},${c1.y} ${o.x},${o.y} ${other.x},${other.y}`;
      } else {
        const d = Math.max(50, Math.abs(b.x - a.x) * 0.45), c1 = out(a, d), c2 = out(b, d);
        path = `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
      }
      const g = sv('g', { class: 'w-wire', tabindex: 0, 'data-from': from, 'data-to': to });
      g.append(sv('path', { d: path, class: color === BLACK ? 'w-halo light' : 'w-halo' }), sv('path', { d: path, stroke: color[0], class: 'w-line' }), sv('title', {}, desc));
      wiresG.append(g);
      rows2.push({ color, from, to, desc, conn: `${connA} → ${connB}` });
    };
    const bname = (k) => { const q = boardPins.find((x) => `board:${x.side}${x.pos}` === k); return q ? q.label : k; };
    const label = (k) => k.replace(/^board:.*$/, (m) => `${board.name.replace(/\s*\(.*\)/, '')} ${bname(m)}`).replace(/^([^:]+):/, (m, id) => { const mm = mods.find((x) => x.pl.id === id); return `${mm ? (mm.pl.name || mm.part.name).replace(/\s*\(.*\)/, '') : id} `; });
    const connName = (c) => ({ screw: 'screw terminal', plug: 'servo plug', header: 'Dupont pin' })[c] || 'Dupont pin';
    for (const m of mods) {
      for (const p of m.mod.pins) {
        const key = `${m.pl.id}:${p.name}`;
        if (p.kind === 'gnd') { const bp = boardPinFor('GND', m.side); if (bp) wire(bp, key, BLACK, `GND: ${label(bp)} ↔ ${label(key)} — every ground must be connected together`, 'Dupont', connName(p.conn)); continue; }
        if (p.kind === 'power') { const bp = boardPinFor(m.part.power === '5V' ? '5V' : m.part.power === '3V3' ? '3V3' : Number(board.logic) >= 5 ? '5V' : '3V3', m.side); if (bp) wire(bp, key, RED, `Power: ${label(bp)} → ${label(key)}`, 'Dupont', connName(p.conn)); continue; }
        if (p.kind === 'power5') { const bp = boardPinFor('5V', m.side); if (bp && car) wire(key, bp, RED, `5 V from the driver powers the board: ${label(key)} → ${label(bp)}`, connName(p.conn), 'Dupont'); continue; }
        if (p.kind === 'vbat') continue;
        const g = m.pl.assign ? m.pl.assign[p.role] : null;
        if (g == null) continue;
        const bp = boardPinFor(Number(g));
        const col = m.part.bus === 'i2c' ? (p.role === 'SDA' ? SIG_COLORS[2] : SIG_COLORS[0]) : SIG_COLORS[ci++ % SIG_COLORS.length];
        const what = (m.part.signals.find((s) => s.role === p.role) || {}).note || '';
        if (bp) wire(bp, key, col, `${p.role}: ${label(bp)} ↔ ${label(key)}${what ? ` — ${what}` : ''}`, 'Dupont', connName(p.conn));
      }
    }
    const drv = mods.find((m) => m.part.id === 'l298n');
    if (car && drv) {
      wire('bat:+', `${drv.pl.id}:12V`, RED, 'Battery + (through the switch) → L298N 12V', 'battery lead', 'screw terminal');
      wire('bat:-', `${drv.pl.id}:GND`, BLACK, 'Battery − → L298N GND (the same screw as the board GND)', 'battery lead', 'screw terminal');
      if (pt['Right motors:+']) {
        wire(`${drv.pl.id}:OUT1`, 'Right motors:+', SIG_COLORS[3], 'L298N OUT1 → right motors (+)', 'screw terminal', 'motor wire');
        wire(`${drv.pl.id}:OUT2`, 'Right motors:-', SIG_COLORS[6], 'L298N OUT2 → right motors (−). Swapped wires = wheels turn the wrong way (fix in Car settings)', 'screw terminal', 'motor wire');
        wire(`${drv.pl.id}:OUT3`, 'Left motors:+', SIG_COLORS[3], 'L298N OUT3 → left motors (+)', 'screw terminal', 'motor wire');
        wire(`${drv.pl.id}:OUT4`, 'Left motors:-', SIG_COLORS[6], 'L298N OUT4 → left motors (−)', 'screw terminal', 'motor wire');
      }
    }

    // ---- highlight on hover / focus
    const all = () => [...wiresG.children];
    const hl = (pred) => { svg.classList.add('focus'); all().forEach((g) => g.classList.toggle('on', pred(g))); };
    const clear = () => { svg.classList.remove('focus'); all().forEach((g) => g.classList.remove('on')); info.textContent = 'Point at a wire, a pin or a module to see where it goes.'; };
    const info = h('div', { class: 'small wiring-info' }, 'Point at a wire, a pin or a module to see where it goes.');
    wiresG.addEventListener('pointerover', (e) => { const g = e.target.closest('.w-wire'); if (g) { hl((x) => x === g); info.textContent = g.querySelector('title').textContent; } });
    wiresG.addEventListener('pointerout', clear);
    bodiesG.addEventListener('pointerover', (e) => {
      const m = e.target.closest('.w-mod'), p = e.target.closest('.w-pin');
      if (m) { const id = m.getAttribute('data-mod'); hl((g) => g.getAttribute('data-to').startsWith(`${id}:`) || g.getAttribute('data-from').startsWith(`${id}:`)); info.textContent = `${id === 'battery' ? 'Battery pack' : id}: highlighted wires go to it.`; }
      else if (p) { const k = p.getAttribute('data-key'); hl((g) => g.getAttribute('data-from') === k || g.getAttribute('data-to') === k); const n = all().filter((g) => g.classList.contains('on')).length; info.textContent = `${bname(k)}: ${n ? `${n} wire${n > 1 ? 's' : ''}` : 'nothing connected'}.`; }
    });
    bodiesG.addEventListener('pointerout', clear);
    svg.addEventListener('focusin', (e) => { const g = e.target.closest('.w-wire'); if (g) { hl((x) => x === g); info.textContent = g.querySelector('title').textContent; } });

    // ---- the list of wires
    const table = h('table', { class: 'wiring-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'From'), h('th', {}, 'To'), h('th', {}, 'Connector'), h('th', {}, 'What it is'))),
      h('tbody', {}, ...rows2.map((r, i) => h('tr', { tabindex: 0, onmouseenter: () => { hl((g) => g === wiresG.children[i]); info.textContent = r.desc; }, onmouseleave: clear },
        h('td', {}, h('span', { class: 'wsw', style: `background:${r.color[0]}`, title: r.color[1] }), ` ${r.color[1]}`), h('td', {}, label(r.from)), h('td', {}, label(r.to)), h('td', {}, r.conn), h('td', {}, r.desc.replace(/^[^:]+: /, ''))))));
    container.append(...[h('div', { class: 'wiring-wrap' }, svg), info, extra.length ? h('p', { class: 'small muted' }, `* ${extra.map((p) => p.label).join(', ')}: not on the board's pin headers — on the car kit it comes out on the shield / a solder pad.`) : null,
      h('p', { class: 'small muted' }, 'Colours are a suggestion — any colour works, but red for + and black for GND avoids mistakes. Dupont wires plug onto the pin headers (female–female between two boards); screw terminals take a bare wire end. Switch the power off while wiring.'),
      h('details', { class: 'wiring-list', open: true }, h('summary', {}, `All ${rows2.length} wires`), table)].filter(Boolean));
    return { wires: rows2.length };
  }
  window.MCwiring = { render, moduleOf };
})();
