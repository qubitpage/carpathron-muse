// Robot page → 🧊 3D plan view: the room as the car knows it — floor grid (1 m squares), the laser outline of the last
// room scan as low walls, the objects the camera named, the car where it is now (from its wheels and gyro) with its
// path. Drag to orbit, wheel to zoom. Click the floor and press "Go there": the car turns and drives to that point.
// With the practice car, the true virtual room is drawn faintly so you can compare what the car mapped with reality.
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { buildScene, buildCar } from './sim3d.js';

const ui = () => window.MCui;
const S = { scene: null, cam: null, ren: null, ctl: null, car: null, trail: null, trailPts: [], mapGroup: null, simGroup: null, target: null, el: null, raf: 0, follow: false, pose: { x: 0, y: 0, heading: 0 }, mapId: '' };
const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y); // pose metres (x right, y ahead) → three.js

function label(text, color = '#e8eaed') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.font = '600 26px Segoe UI, Arial'; g.fillStyle = 'rgba(13,15,18,.75)';
  const w = Math.min(250, g.measureText(text).width + 20); g.fillRect((256 - w) / 2, 10, w, 42); g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, 128, 40);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.scale.set(0.8, 0.2, 1); return sp;
}
function wall(a, b, h, mat) {
  const len = a.distanceTo(b); if (len < 0.01) return null;
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.03), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5); m.position.y = h / 2;
  m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); return m;
}

function build(el) {
  S.el = el;
  const box = el.querySelector('.p3d-view');
  S.scene = new THREE.Scene(); S.scene.background = new THREE.Color(0x0d0f12);
  S.cam = new THREE.PerspectiveCamera(50, 1, 0.05, 100); S.cam.position.set(0, 4.5, 4.5);
  S.ren = new THREE.WebGLRenderer({ antialias: true }); S.ren.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); S.ren.outputColorSpace = THREE.SRGBColorSpace; S.ren.toneMapping = THREE.ACESFilmicToneMapping;
  box.append(S.ren.domElement);
  S.ctl = new OrbitControls(S.cam, S.ren.domElement); S.ctl.enableDamping = true; S.ctl.maxPolarAngle = Math.PI / 2 - 0.05; S.ctl.target.set(0, 0, 0);
  S.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x202530, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(3, 6, 2); S.scene.add(sun);
  const grid = new THREE.GridHelper(10, 10, 0x3a4a5e, 0x232a33); S.scene.add(grid);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ visible: false })); floor.rotation.x = -Math.PI / 2; floor.name = 'floor'; S.scene.add(floor);
  // the car: body + an arrow nose
  // the Baby Carpathron model (same as the practice car), a bit bigger so it is easy to see; nose = direction
  S.car = new THREE.Group();
  const model = buildCar().g; model.rotation.y = Math.PI / 2; model.scale.setScalar(1.6); S.car.add(model);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0xffd75e, emissive: 0x6b5200 }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.25, -0.12); S.car.add(arrow);
  S.scene.add(S.car);
  S.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x3ddc97 })); S.scene.add(S.trail);
  S.target = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 24), new THREE.MeshBasicMaterial({ color: 0xffd75e, side: THREE.DoubleSide })); S.target.rotation.x = -Math.PI / 2; S.target.visible = false; S.scene.add(S.target);
  S.mapGroup = new THREE.Group(); S.scene.add(S.mapGroup);
  S.simGroup = new THREE.Group(); S.scene.add(S.simGroup);
  // click the floor = pick a point
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  let down = null;
  S.ren.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  S.ren.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // it was a drag
    const r = S.ren.domElement.getBoundingClientRect();
    v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v2, S.cam);
    const hit = ray.intersectObject(floor)[0];
    if (!hit) return;
    S.target.position.set(hit.point.x, 0.005, hit.point.z); S.target.visible = true;
    const x = hit.point.x, y = -hit.point.z;
    el.querySelector('.p3d-pick').textContent = `Point: ${x.toFixed(2)} m right, ${y.toFixed(2)} m ahead — ${Math.hypot(x - S.pose.x, y - S.pose.y).toFixed(2)} m from the car`;
    el.querySelector('.p3d-go').disabled = false;
    S.pick = { x, y };
  });
  const resize = () => { const w = box.clientWidth || 600, h = Math.max(300, Math.round(w * 0.6)); S.ren.setSize(w, h); S.cam.aspect = w / h; S.cam.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(box); resize();
  const loop = () => { S.raf = requestAnimationFrame(loop); if (!document.body.contains(S.ren.domElement) || S.ren.domElement.offsetParent === null) return; S.ctl.update(); S.ren.render(S.scene, S.cam); };
  loop();
}

function clear(g) { while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); } }

async function loadMap() {
  const { api } = ui();
  const maps = await api('/api/robot/maps').catch(() => []);
  clear(S.mapGroup);
  const info = S.el.querySelector('.p3d-map');
  if (!maps.length) { info.textContent = 'No room scan yet: Robot head & room map → Scan the room. With the laser + gyro the scan also measures the walls.'; return; }
  const id = maps[0].id; S.mapId = id;
  const map = await fetch(`/api/robot/maps/${encodeURIComponent(id)}/map.json`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null);
  if (!map) return;
  const o = map.pose || { x: 0, y: 0, heading: 0 }, ph = ((o.heading || 0) * Math.PI) / 180;
  const at = (deg, m) => { const r = (deg * Math.PI) / 180 + ph; return W(o.x + Math.sin(r) * m, o.y + Math.cos(r) * m); };
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.85 });
  let walls = 0;
  if (map.sweep) {
    const sw = map.sweep;
    for (let i = 0; i < sw.length; i++) {
      const a = sw[i], b = sw[(i + 1) % sw.length];
      if (a.m && b.m && Math.abs(a.m - b.m) < 0.35 && (b.deg - a.deg + 360) % 360 <= 10) { const m = wall(at(a.deg, a.m), at(b.deg, b.m), 0.3, wallMat); if (m) { S.mapGroup.add(m); walls++; } }
      if (a.m) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), wallMat); d.position.copy(at(a.deg, a.m)); d.position.y = 0.02; S.mapGroup.add(d); }
    }
  }
  for (const l of map.landmarks || []) {
    const p = W(l.x, l.y);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12), new THREE.MeshStandardMaterial({ color: l.from === 'laser' ? 0xffb347 : 0xb07cff }));
    pin.position.set(p.x, 0.2, p.z); S.mapGroup.add(pin);
    const t = label(`${l.name} ${l.distance_m} m`); t.position.set(p.x, 0.55, p.z); S.mapGroup.add(t);
  }
  const spot = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.07, 20), new THREE.MeshBasicMaterial({ color: 0x4f8cff, side: THREE.DoubleSide })); spot.rotation.x = -Math.PI / 2; spot.position.copy(W(o.x, o.y, 0.004)); S.mapGroup.add(spot);
  info.textContent = `Room scan ${id.replace('T', ' ')}: ${map.sweep ? `laser outline (${walls} wall pieces)` : 'no laser outline (needs the laser + gyro)'}, ${(map.landmarks || []).length} objects${(map.landmarks || []).some((l) => l.from === 'laser') ? ' (orange = distance measured by the laser)' : ''}.`;
}

async function loadSim() {
  const { api } = ui();
  clear(S.simGroup);
  const pr = await api('/api/robot/car/practice').catch(() => null);
  if (!pr || !pr.running || !pr.room) return;
  const room = pr.room, st = room.start || [room.w / 2, room.h / 2];
  const P = (xs, ys) => W((ys - st[1]) / 100, (xs - st[0]) / 100); // simulator cm (heading 0 = +x) → map metres
  void P;
  // the furnished practice room, turned into the map's frame (the map's "ahead" = the simulator's east)
  const furnished = buildScene(room), g = new THREE.Group();
  for (const c of [...furnished.children]) if (!c.isLight && !(c.isObject3D && c.type === 'DirectionalLight')) g.add(c);
  g.rotation.y = Math.PI / 2; g.position.set(-st[1] / 100, -0.004, st[0] / 100);
  g.traverse((o) => { if (o.material && o.position.y > 2.2) o.visible = false; }); // no ceiling and lamp from above
  S.simGroup.add(g);
}

async function tick() {
  if (!S.el || !document.body.contains(S.el)) return;
  const st = await ui().api('/api/robot').catch(() => null);
  if (st && st.pose) {
    S.pose = st.pose;
    S.car.position.copy(W(st.pose.x, st.pose.y));
    S.car.rotation.y = -(st.pose.heading * Math.PI) / 180;
    const last = S.trailPts[S.trailPts.length - 1];
    if (!last || last.distanceTo(S.car.position) > 0.03) { S.trailPts.push(S.car.position.clone().setY(0.01)); if (S.trailPts.length > 1000) S.trailPts.shift(); S.trail.geometry.setFromPoints(S.trailPts); }
    if (S.follow) S.ctl.target.lerp(S.car.position, 0.3);
  }
  setTimeout(tick, 400);
}

async function render(el) {
  const { h, api, toast } = ui();
  if (S.el === el && S.ren) { loadMap(); loadSim(); return; }
  el.innerHTML = '';
  const go = h('button', { class: 'btn primary p3d-go', disabled: '', onclick: async () => {
    if (!S.pick) return; go.disabled = true;
    const r = await api('/api/robot/goto-point', { body: S.pick }).catch((e) => ({ error: e.message }));
    toast(r.error || r.text, !!r.error); go.disabled = false;
  } }, '🚗 Go there');
  el.append(h('h3', {}, '🧊 3D plan view'),
    h('p', { class: 'small muted' }, 'The room as the car knows it: the laser outline of the last scan (orange walls), the objects the camera named, and the car where it is now with its path (green). Drag to turn the view, scroll to zoom. Click the floor, then Go there.'),
    h('div', { class: 'p3d-view' }),
    h('div', { class: 'row' }, go,
      h('button', { class: 'btn', onclick: () => { loadMap(); loadSim(); } }, '↻ Latest scan'),
      h('button', { class: 'btn', onclick: async () => { await api('/api/robot/pose', { body: { reset: true } }); S.trailPts = []; S.trail.geometry.setFromPoints([]); toast('The car\'s position is now the centre (0, 0), facing up'); } }, '⌖ Car is here (reset)'),
      h('label', { class: 'toggle small' }, h('input', { type: 'checkbox', onchange: (e) => { S.follow = e.target.checked; } }), h('span', {}, 'Follow the car'))),
    h('div', { class: 'small p3d-pick muted' }, 'Click the floor to pick a point.'),
    h('div', { class: 'small muted p3d-map' }, ''));
  build(el);
  loadMap(); loadSim(); tick();
}

window.MC3d = { render };
const tryRender = () => { const el = document.getElementById('plan3dCard'); if (window.MCui && el) render(el); else setTimeout(tryRender, 400); };
tryRender();
