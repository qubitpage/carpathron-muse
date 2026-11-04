// Robot → 🗺 Map: the room map the car learns with its laser, in 3D. Light floor = measured free, orange blocks = walls
// and furniture the laser hit, dark = not seen yet. Put the robot where it really is, name places, and send the car:
// it plans a way around what it knows (and the laser still stops it before anything new). Explore lets it learn the
// room by itself; a photo scan adds the objects the camera recognises. 2.2.2: what the car FELT (a bump, a step or
// edge, a drop) is drawn as red warning marks the routes keep away from, and 🎯 Find sends it to an object.
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { buildScene, buildCar } from './sim3d.js';

const ui = () => window.MCui;
const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y); // map metres (x right, y ahead) → three.js
const S = { el: null, ren: null, scene: null, cam: null, ctl: null, raf: 0, car: null, free: null, solid: null, marks: null, route: null, sim: null, ring: null, pickA: null,
  mode: 'go', view: 'orbit', follow: false, showSim: false, map: null, pose: { x: 0, y: 0, heading: 0 }, patrol: [], busy: null, trail: [], trailLine: null, els: {} };
const MODES = {
  go: { label: '🚗 Go here', hint: 'Click a spot on the floor (or a place) — the car plans a way around the walls it knows and drives there.' },
  pose: { label: '📍 Robot is here', hint: 'Put the robot where it really stands: click its spot, then click where it is looking.' },
  place: { label: '🚩 Name a place', hint: 'Click a spot and give it a name ("door", "charger", "kitchen") — then the car can go there by name, also from chat and voice.' },
  patrol: { label: '🔁 Patrol points', hint: 'Click 2 or more spots in order; then press ▶ Start patrol on the right. Click a point again to remove it.' },
};

function label(text, color = '#e8eaed', bg = 'rgba(13,15,18,.82)') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); g.font = '600 40px Segoe UI, Arial'; const w = Math.min(500, g.measureText(text).width + 36);
  g.fillStyle = bg; g.beginPath(); g.roundRect((512 - w) / 2, 14, w, 64, 18); g.fill(); g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, 256, 60);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(0.9, 0.17, 1); sp.renderOrder = 10; return sp;
}
function disposeAll(g) { while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); } }

function build(view) {
  S.scene = new THREE.Scene(); S.scene.background = new THREE.Color(0x0b0e12); S.scene.fog = new THREE.Fog(0x0b0e12, 9, 18);
  S.cam = new THREE.PerspectiveCamera(45, 1, 0.05, 60); S.cam.position.set(0, 4.2, 3.4);
  S.ren = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); S.ren.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  S.ren.outputColorSpace = THREE.SRGBColorSpace; S.ren.toneMapping = THREE.ACESFilmicToneMapping; S.ren.shadowMap.enabled = true; S.ren.shadowMap.type = THREE.PCFSoftShadowMap;
  view.append(S.ren.domElement);
  S.ctl = new OrbitControls(S.cam, S.ren.domElement); S.ctl.enableDamping = true; S.ctl.maxPolarAngle = Math.PI / 2 - 0.08; S.ctl.minDistance = 0.6; S.ctl.maxDistance = 14;
  S.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1a1f28, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2.5, 6, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 20 }); S.scene.add(sun);
  // the "unknown" floor: a dark plane with a 1 m grid (so distances are easy to read)
  const base = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x12161d, roughness: 1 })); base.rotation.x = -Math.PI / 2; base.position.y = -0.002; base.receiveShadow = true; base.name = 'floor'; S.scene.add(base);
  const grid = new THREE.GridHelper(12, 12, 0x34404f, 0x222a35); grid.position.y = 0.001; S.scene.add(grid);
  const fine = new THREE.GridHelper(12, 60, 0x1b222c, 0x1b222c); fine.position.y = 0.0005; fine.material.transparent = true; fine.material.opacity = 0.5; S.scene.add(fine);
  // occupancy: free floor tiles and solid blocks (instanced: thousands of cells cost one draw call each)
  const N = 240 * 240;
  S.free = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.053, 0.053).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), N); S.free.count = 0; S.free.receiveShadow = true;
  S.solid = new THREE.InstancedMesh(new THREE.BoxGeometry(0.058, 0.3, 0.058).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), N); S.solid.count = 0; S.solid.castShadow = true; S.solid.receiveShadow = true;
  S.free.frustumCulled = S.solid.frustumCulled = false;
  S.scene.add(S.free, S.solid);
  S.marks = new THREE.Group(); S.scene.add(S.marks);
  S.sim = new THREE.Group(); S.scene.add(S.sim);
  // the robot: the Baby Carpathron model, a soft ring under it and a direction arrow
  S.car = new THREE.Group();
  const model = buildCar().g; model.rotation.y = Math.PI / 2; model.scale.setScalar(1.5); model.traverse((o) => { if (o.isMesh) o.castShadow = true; }); S.car.add(model);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.235, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.8 })); ring.position.y = 0.004; S.car.add(ring); S.ring = ring;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0x6b5200 })); arrow.position.set(0, 0.02, -0.29); S.car.add(arrow);
  S.scene.add(S.car);
  S.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.8 })); S.scene.add(S.trailLine);
  S.route = new THREE.Group(); S.scene.add(S.route);
  // clicks (a drag turns the view; a click without moving is a pick)
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(); let down = null;
  S.ren.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  S.ren.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = S.ren.domElement.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v2, S.cam);
    const named = ray.intersectObjects(S.marks.children, true).find((h) => h.object.userData.place);
    if (named) return pick(named.object.userData.place.x, named.object.userData.place.y, named.object.userData.place);
    const hit = ray.intersectObject(base)[0]; if (hit) pick(hit.point.x, -hit.point.z);
  });
  const resize = () => { const w = view.clientWidth || 700, h = Math.max(340, Math.min(Math.round(w * 0.66), Math.round(window.innerHeight * 0.68))); S.ren.setSize(w, h); S.cam.aspect = w / h; S.cam.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(view); resize();
  const loop = () => {
    S.raf = requestAnimationFrame(loop);
    if (!document.body.contains(S.ren.domElement) || S.ren.domElement.offsetParent === null) return;
    S.ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 300);
    if (S.follow) S.ctl.target.lerp(S.car.position, 0.08);
    S.ctl.update(); S.ren.render(S.scene, S.cam);
  };
  loop();
}

// ------------------------------------------------------------------ the map from the server
const cFree = new THREE.Color(), cSolid = new THREE.Color(), m4 = new THREE.Matrix4();
function drawGrid(v) {
  const res = v.res, half = v.size / 2, cells = v.cells;
  let nf = 0, ns = 0;
  for (let k = 0; k < cells.length; k += 3) {
    const i = cells[k], j = cells[k + 1], val = cells[k + 2], x = (i - half + 0.5) * res, y = (j - half + 0.5) * res;
    if (val < 0) {
      m4.makeTranslation(x, 0.003, -y); S.free.setMatrixAt(nf, m4);
      const t = Math.min(1, -val / 60); cFree.setRGB(0.44 + 0.36 * t, 0.52 + 0.33 * t, 0.58 + 0.3 * t); S.free.setColorAt(nf, cFree); nf++;
    } else {
      const t = Math.min(1, val / 100); m4.makeScale(1, 0.55 + 0.45 * t, 1).setPosition(x, 0, -y); S.solid.setMatrixAt(ns, m4);
      cSolid.setRGB(1, 0.38 + 0.12 * (1 - t), 0.12); S.solid.setColorAt(ns, cSolid); ns++;
    }
  }
  S.free.count = nf; S.solid.count = ns;
  // the first time: look at the middle of what is known, from a distance that shows all of it
  if (!S.centered && cells.length) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let k = 0; k < cells.length; k += 3) { const x = (cells[k] - half) * res, y = (cells[k + 1] - half) * res; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    S.extent = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(2, x1 - x0, y1 - y0) };
    S.centered = true; setView(S.view);
  }
  S.free.instanceMatrix.needsUpdate = S.solid.instanceMatrix.needsUpdate = true;
  if (S.free.instanceColor) S.free.instanceColor.needsUpdate = true; if (S.solid.instanceColor) S.solid.instanceColor.needsUpdate = true;
}
function flag(p, color, kind) {
  const g = new THREE.Group(); g.position.copy(W(p.x, p.y));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0xd8dde4 })); pole.position.y = 0.21;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 })); cloth.position.set(0.07, 0.37, 0);
  const foot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })); foot.position.y = 0.005;
  const t = label(`${kind === 'object' ? '👁 ' : '🚩 '}${p.name}`, '#fff', kind === 'object' ? 'rgba(90,60,140,.85)' : 'rgba(20,90,60,.88)'); t.position.y = 0.55;
  for (const o of [pole, cloth, foot, t]) { o.userData.place = p; g.add(o); }
  return g;
}
// a spot the car felt: red disc (the zone routes keep away from) + a small warning post with what it was
const HZ = { bump: ['💥 bump', 0xff5a5f], step: ['⤵ step / edge', 0xff2d55], drop: ['⚠ drop', 0xff1f1f] };
function hazardMark(hz) {
  const [txt, color] = HZ[hz.kind] || HZ.bump, g = new THREE.Group(); g.position.copy(W(hz.x, hz.y));
  const zone = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false })); zone.position.y = 0.006;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.22, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })); ring.position.y = 0.007;
  const post = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 4), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })); post.position.y = 0.06;
  const t = label(txt, '#fff', 'rgba(150,20,30,.88)'); t.scale.set(0.7, 0.13, 1); t.position.y = 0.26;
  g.add(zone, ring, post, t); return g;
}
function drawMarks() {
  disposeAll(S.marks);
  const v = S.map; if (!v) return;
  for (const p of v.places || []) S.marks.add(flag(p, 0x2fbf71, 'place'));
  for (const o of v.objects || []) S.marks.add(flag(o, 0x9b6bff, 'object'));
  for (const hz of v.hazards || []) S.marks.add(hazardMark(hz));
  S.patrol.forEach((p, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x4f8cff, emissive: 0x1d3f8a })); b.position.copy(W(p.x, p.y, 0.015)); b.userData.place = { ...p, patrolIndex: i }; S.marks.add(b);
    const t = label(`${i + 1}`, '#fff', 'rgba(40,90,200,.9)'); t.scale.set(0.35, 0.07, 1); t.position.copy(W(p.x, p.y, 0.2)); t.userData.place = b.userData.place; S.marks.add(t);
  });
  if (S.patrol.length > 1) { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(S.patrol.map((p) => W(p.x, p.y, 0.02))), new THREE.LineDashedMaterial({ color: 0x4f8cff, dashSize: 0.08, gapSize: 0.05 })); l.computeLineDistances(); S.marks.add(l); }
  if (S.pickA) { const d = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.09, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd75e })); d.position.copy(W(S.pickA.x, S.pickA.y, 0.01)); S.marks.add(d); }
}
function drawRoute(route) {
  disposeAll(S.route);
  if (!route || !route.length) return;
  const pts = [W(S.pose.x, S.pose.y, 0.03), ...route.map((p) => W(p.x, p.y, 0.03))];
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffd75e, dashSize: 0.1, gapSize: 0.06 })); l.computeLineDistances(); S.route.add(l);
  const end = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd75e })); end.position.copy(pts[pts.length - 1]); S.route.add(end);
}
async function loadMap() {
  if (!S.free) return; // the Map tab was not opened yet
  const v = await ui().api('/api/robot/roommap').catch(() => null);
  if (!v) return;
  S.map = v; drawGrid(v); drawMarks(); drawRoute(v.route); drawSide();
}
let mapT = 0;
function mapSoon() { clearTimeout(mapT); mapT = setTimeout(loadMap, 500); }
async function loadSim() {
  disposeAll(S.sim);
  if (!S.showSim) return;
  const pr = await ui().api('/api/robot/car/practice').catch(() => null);
  if (!pr || !pr.running || !pr.room) { S.els.simNote.textContent = 'The practice room is shown only while the practice car runs.'; return; }
  const room = pr.room, st = room.start || [room.w / 2, room.h / 2];
  const furnished = buildScene(room), g = new THREE.Group();
  for (const c of [...furnished.children]) if (!c.isLight) g.add(c);
  g.rotation.y = Math.PI / 2; g.position.set(-st[1] / 100, -0.006, st[0] / 100);
  g.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } if (o.position && o.position.y > 2.2) o.visible = false; });
  S.sim.add(g); S.els.simNote.textContent = 'The real practice room is drawn see-through: compare it with what the car has learned.';
}

// ------------------------------------------------------------------ clicks on the map
async function pick(x, y, named) {
  const { api, toast } = ui();
  x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
  if (S.mode === 'go') {
    const body = named && named.name ? { name: named.name } : { x, y };
    const r = await api(named && named.name ? '/api/robot/roommap/gotoplace' : '/api/robot/roommap/goto', { body }).catch((e) => ({ error: e.message }));
    if (r.error) return toast(r.error, true);
    status(`🚗 Going to ${named && named.name ? named.name : `the spot (${x}, ${y})`}…`);
  } else if (S.mode === 'pose') {
    if (!S.pickA) { S.pickA = { x, y }; drawMarks(); hint('Now click where the robot is looking.'); return; }
    const a = S.pickA; S.pickA = null;
    const heading = Math.round(((Math.atan2(x - a.x, y - a.y) * 180) / Math.PI + 360) % 360);
    const r = await api('/api/robot/roommap/pose', { body: { x: a.x, y: a.y, heading } }).catch((e) => ({ error: e.message }));
    if (r.error) return toast(r.error, true);
    S.trail = []; toast(`The robot is now at (${a.x}, ${a.y}), looking ${heading}°`); hint(MODES.pose.hint); drawMarks(); poll(true);
  } else if (S.mode === 'place') {
    const name = await window.MCask('Name this place (e.g. door, charger, kitchen)', '');
    if (!name) return;
    const r = await api('/api/robot/roommap/place', { body: { name, x, y } }).catch((e) => ({ error: e.message }));
    if (r.error) return toast(r.error, true); loadMap();
  } else if (S.mode === 'patrol') {
    if (named && named.patrolIndex != null) S.patrol.splice(named.patrolIndex, 1); else S.patrol.push(named ? { x: named.x, y: named.y } : { x, y });
    drawMarks(); drawSide();
  }
}
function setMode(m) { S.mode = m; S.pickA = null; drawMarks(); for (const b of S.els.modes.children) b.classList.toggle('on', b.dataset.mode === m); hint(MODES[m].hint); }
const hint = (t) => { S.els.hint.textContent = t; };
const status = (t) => { S.els.status.textContent = t; };
function setView(v) {
  S.view = v; for (const b of S.els.views.children) b.classList.toggle('on', b.dataset.view === v);
  S.follow = v === 'follow';
  const e = S.extent || { cx: 0, cy: 0, size: 3 }, d = e.size * 1.1 + 0.6;
  const t = v === 'follow' ? S.car.position : W(e.cx, e.cy);
  S.ctl.target.set(t.x, 0, t.z);
  if (v === 'top') S.cam.position.set(t.x, d * 1.25, t.z + 0.001);
  else if (v === 'follow') S.cam.position.set(t.x, 1.6, t.z + 1.6);
  else S.cam.position.set(t.x, d * 0.85, t.z + d * 0.75);
  S.ctl.update();
}

// ------------------------------------------------------------------ the robot's position (fast while on this tab)
let pollT = 0;
async function poll(once) {
  clearTimeout(pollT);
  if (!S.el || !document.body.contains(S.el)) return;
  if (!S.el.offsetParent && !once) { pollT = setTimeout(poll, 1000); return; }
  const st = await ui().api('/api/robot').catch(() => null);
  if (st && st.pose) {
    S.pose = st.pose;
    S.car.position.copy(W(st.pose.x, st.pose.y)); S.car.rotation.y = -(st.pose.heading * Math.PI) / 180;
    const last = S.trail[S.trail.length - 1], here = S.car.position.clone().setY(0.012);
    if (!last || last.distanceTo(here) > 0.03) { S.trail.push(here); if (S.trail.length > 800) S.trail.shift(); S.trailLine.geometry.setFromPoints(S.trail); }
    if (S.els.safety) S.els.safety.textContent = feelText(st.sensors, st.state);
    S.els.where.textContent = `${st.state === 'online' ? '🟢' : '⚪'} Robot at ${st.pose.x.toFixed(2)} m right, ${st.pose.y.toFixed(2)} m ahead, facing ${Math.round(((st.pose.heading % 360) + 360) % 360)}°${st.state === 'online' ? '' : ' — not connected'}`;
  }
  if (!once) pollT = setTimeout(poll, 300);
}

function feelText(s, state) {
  if (state !== 'online') return 'The car is not connected.';
  if (!s) return 'No sensor data (car firmware 2.x needed).';
  const cm = (mm) => (mm > 0 ? `${Math.round(mm / 10)} cm` : 'clear');
  const parts = [];
  parts.push(s.linkLost ? '⚠ Mega link lost — forward is blocked until it is back' : s.tof ? `Ahead: ${cm(s.dist)} (stops at ${Math.round((s.stopMm || 150) / 10)} cm)` : '⚠ No distance sensor');
  if (s.sideEyes) parts.push(`Sides: ${cm(s.sideL)} left · ${cm(s.sideR)} right`);
  if (s.lean != null) parts.push(`Lean: ${s.lean}° from level`);
  parts.push(s.cliffSensor ? (s.cliff ? '⚠ No floor ahead!' : 'Floor ahead: ok') : 'Drop sensor: not fitted');
  if (s.bumps != null) parts.push(`Felt so far: ${s.bumps | 0} bumps · ${s.tiltStops | 0} steps · ${s.cliffStops | 0} drops`);
  return parts.join('  ·  ');
}

// ------------------------------------------------------------------ the side panel
function drawSide() {
  const { h, api, toast } = ui(); const v = S.map; if (!v) return;
  const E = S.els;
  E.stats.innerHTML = '';
  E.stats.append(h('div', { class: 'rm-stat' }, h('b', {}, `${v.stats.freeM2} m²`), h('span', {}, 'floor learned')), h('div', { class: 'rm-stat' }, h('b', {}, `${v.stats.wallM} m`), h('span', {}, 'walls & things')), h('div', { class: 'rm-stat' }, h('b', {}, `${(v.places || []).length}`), h('span', {}, 'named places')));
  const busy = v.busy || S.busy;
  for (const b of E.jobBtns) b.disabled = !!busy;
  E.stop.classList.toggle('pulse', !!busy);
  if (busy) status(`⏳ The car is ${busy}…`); else if (/^⏳/.test(E.status.textContent)) status('Ready.');
  E.places.innerHTML = '';
  const all = [...(v.places || []).map((p) => ({ ...p, kind: 'place' })), ...(v.objects || []).map((p) => ({ ...p, kind: 'object' }))];
  if (!all.length) E.places.append(h('p', { class: 'small muted' }, 'No places yet. Choose 🚩 Name a place and click the map — or scan with photos: the camera names the objects it sees.'));
  for (const p of all) E.places.append(h('div', { class: 'rm-place' }, h('span', { class: `rm-dot ${p.kind}` }), h('span', { class: 'grow' }, p.name, h('small', { class: 'muted' }, p.kind === 'object' ? '  seen by the camera' : `  ${p.x}, ${p.y} m`)),
    p.kind === 'object' ? h('button', { class: 'btn tiny', title: `Find the ${p.name} (map + camera)`, onclick: () => S.findGo && S.findGo(p.name) }, '🎯 Find') :
    h('button', { class: 'btn tiny', title: `Go to ${p.name}`, onclick: async () => { const r = await api('/api/robot/roommap/gotoplace', { body: { name: p.name } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else status(`🚗 Going to ${p.name}…`); } }, '▶ Go'),
    p.kind === 'place' ? h('button', { class: 'btn tiny ghost', title: 'Remove', onclick: async () => { await api('/api/robot/roommap/unplace', { body: { name: p.name } }); loadMap(); } }, '✕') : null));
  if (E.findList) { E.findList.innerHTML = ''; for (const n of [...new Set(all.map((p) => p.name))]) E.findList.append(h('option', { value: n })); }
  E.patrolList.textContent = S.patrol.length ? S.patrol.map((p, i) => `${i + 1}: (${p.x}, ${p.y})`).join('   ') : 'No points yet: choose 🔁 Patrol points and click the map.';
  E.patrolGo.disabled = S.patrol.length < 2 || !!busy;
}

async function render(el) {
  const { h, api, toast } = ui();
  if (S.el === el && S.ren) { loadMap(); poll(); return; }
  S.el = el; el.innerHTML = '';
  const E = S.els;
  const view = h('div', { class: 'rm-view' });
  E.modes = h('div', { class: 'seg rm-modes', role: 'toolbar', 'aria-label': 'What a click on the map does' }, ...Object.entries(MODES).map(([m, d]) => h('button', { 'data-mode': m, class: m === S.mode ? 'on' : '', onclick: () => setMode(m) }, d.label)));
  E.views = h('div', { class: 'seg rm-views', 'aria-label': 'View' }, ...[['orbit', '🧊 3D'], ['top', '⬇ From above'], ['follow', '🎥 Follow robot']].map(([v, t]) => h('button', { 'data-view': v, class: v === S.view ? 'on' : '', onclick: () => setView(v) }, t)));
  E.hint = h('div', { class: 'rm-hint' }, MODES[S.mode].hint);
  E.status = h('div', { class: 'rm-status small' }, '');
  E.where = h('div', { class: 'rm-where small muted' }, '');
  const legend = h('div', { class: 'rm-legend small' }, ...[['free', 'measured floor'], ['solid', 'wall / furniture'], ['unknown', 'not seen yet'], ['robot', 'robot'], ['place', 'named place'], ['object', 'object the camera named'], ['hazard', 'bump / step / drop the car felt'], ['route', 'planned way']].map(([c, t]) => h('span', {}, h('i', { class: `rm-key ${c}` }), t)));
  const job = (path, body, text) => h('button', { class: 'btn', onclick: async () => { const r = await api(path, { body: body() }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else { S.busy = text; status(`⏳ ${text}…`); drawSide(); } } });
  const rounds = h('select', { 'aria-label': 'How many spots to explore' }, ...[3, 6, 10].map((n) => h('option', { value: n, selected: n === 6 ? '' : null }, `${n} spots`)));
  const exploreBtn = job('/api/robot/roommap/explore', () => ({ rounds: Number(rounds.value) }), 'exploring the room'); exploreBtn.classList.add('primary'); exploreBtn.textContent = '🧭 Explore by itself';
  const measureBtn = job('/api/robot/roommap/measure', () => ({}), 'measuring all around'); measureBtn.textContent = '🔄 Measure all around here';
  const scanBtn = h('button', { class: 'btn', onclick: async () => { const r = await api('/api/robot/scan', { body: { steps: 8 } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else status('📷 Scanning with photos: the camera names what it sees (about a minute)…'); } }, '📷 Scan with photos');
  E.stop = h('button', { class: 'btn stop rm-stop', onclick: async () => { await api('/api/robot/roommap/stop', { body: {} }); S.busy = null; status('■ Stopped.'); mapSoon(); } }, '■ Stop');
  // 🎯 Find: an object the camera named (or a place), or any word — not on the map yet = it scans and explores for it
  E.findList = h('datalist', { id: 'rmFindList' });
  E.findIn = h('input', { type: 'text', list: 'rmFindList', placeholder: 'e.g. chair, door, cage, shoe…', 'aria-label': 'What to find', style: 'flex:1;min-width:0' });
  const findGo = async (name) => {
    name = String(name || E.findIn.value || '').trim(); if (!name) return toast('Type what the car should find.', true);
    const r = await api('/api/robot/roommap/find', { body: { name } }).catch((e) => ({ error: e.message }));
    if (r.error) toast(r.error, true); else { S.busy = `finding the ${name}`; status(`🎯 Finding the ${name}…`); drawSide(); }
  };
  E.findBtn = h('button', { class: 'btn primary', onclick: () => findGo() }, '🎯 Find it');
  E.findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') findGo(); });
  S.findGo = findGo;
  E.safety = h('div', { class: 'rm-safety small' }, '');
  E.jobBtns = [exploreBtn, measureBtn, scanBtn, E.findBtn];
  E.stats = h('div', { class: 'rm-stats' });
  E.places = h('div', { class: 'rm-places' });
  E.patrolList = h('div', { class: 'small muted rm-plist' });
  const loops = h('input', { type: 'number', min: 1, max: 20, value: 1, style: 'width:64px', 'aria-label': 'Rounds' });
  E.patrolGo = h('button', { class: 'btn primary', onclick: async () => { const r = await api('/api/robot/roommap/patrol', { body: { points: S.patrol, loops: Number(loops.value) } }).catch((e) => ({ error: e.message })); if (r.error) toast(r.error, true); else { S.busy = 'patrolling'; status('🔁 Patrolling…'); drawSide(); } } }, '▶ Start patrol');
  E.simNote = h('div', { class: 'small muted' }, '');
  const simBox = h('input', { type: 'checkbox', onchange: (e) => { S.showSim = e.target.checked; loadSim(); } });
  el.append(h('div', { class: 'rm-layout' },
    h('div', { class: 'card rm-main' },
      h('div', { class: 'rm-bar' }, E.modes, E.views), E.hint, view, legend, h('div', { class: 'rm-foot' }, E.where, E.status)),
    h('div', { class: 'rm-side' },
      h('div', { class: 'card' }, h('h3', {}, '🧠 Learn the room'),
        h('p', { class: 'small muted' }, 'The car learns the room with its laser while it drives. To learn it on purpose:'),
        h('div', { class: 'rm-learn' }, h('div', { class: 'row' }, exploreBtn, rounds), measureBtn, scanBtn, E.stop), E.stats,
        h('p', { class: 'small muted' }, 'Explore = measure all around, drive to the nearest unknown part, measure again… Needs a distance sensor (the Mega hub\'s HC-SR04 eyes or the VL53L0X laser); the gyro (MPU-6050) makes it much more exact.')),
      h('div', { class: 'card' }, h('h3', {}, '🎯 Find an object'),
        h('p', { class: 'small muted' }, 'A mission: on the map → the car drives there around what it knows, then the camera guides the last part. Not on the map yet → it scans with photos and explores until it sees it.'),
        h('div', { class: 'row' }, E.findIn, E.findBtn), E.findList),
      h('div', { class: 'card' }, h('h3', {}, '🛡 What the car feels'), E.safety,
        h('p', { class: 'small muted' }, 'Car firmware 2.4 + Mega hub 1.1: it stops and backs off by itself after a bump, a step or an edge (and a drop, with the drop sensor), and never drives forward without its distance sensor.')),
      h('div', { class: 'card' }, h('h3', {}, '🚩 Places'), E.places),
      h('div', { class: 'card' }, h('h3', {}, '🔁 Patrol'), E.patrolList, h('div', { class: 'row' }, h('label', { class: 'inline small' }, 'Rounds ', loops), E.patrolGo, h('button', { class: 'btn ghost', onclick: () => { S.patrol = []; drawMarks(); drawSide(); } }, 'Clear'))),
      h('div', { class: 'card' }, h('h3', {}, '🗺 This map'),
        h('label', { class: 'toggle small' }, simBox, h('span', {}, 'Show the practice room see-through (practice car)')), E.simNote,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: async () => { if (!(await window.MCconfirm('Start a new, empty map? The old one is kept as a file in the maps folder.'))) return; await api('/api/robot/roommap/reset', { body: {} }); S.patrol = []; S.trail = []; S.centered = false; loadMap(); } }, '🗑 Start a new map')),
        h('p', { class: 'small muted' }, 'The map is saved by itself (workspace → maps → room-map.json). If the robot looks wrong on the map after you moved it by hand, use 📍 Robot is here.')))));
  build(view);
  setMode(S.mode);
  loadMap(); loadSim(); poll();
}

function onEvent(d) {
  if (!S.el) return;
  if (d.text) status(`⏳ ${d.text}`);
  if (d.route) { S.map && (S.map.route = d.route); drawRoute(d.route); }
  if ('busy' in d) { S.busy = d.busy; if (!d.busy) drawRoute(null); }
  if (d.result) { status(`${d.result.ok ? '✓' : '⚠'} ${d.result.text}`); S.busy = null; }
  mapSoon();
}

window.MCroommap = { render, onEvent, onMap: () => mapSoon() };
