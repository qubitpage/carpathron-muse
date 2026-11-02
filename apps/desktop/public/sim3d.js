// Practice car in 3D: a furnished virtual room (wooden floor, painted walls, a door, a window, a sofa, an armchair, a plant)
// rendered with three.js. Two views of the same scene:
//   • the car's camera (first person, 10 cm above the floor) in "Live video from the car" — it moves and turns exactly as
//     the practice car does, and every ~0.3 s the picture is sent to the practice car, so its camera, photos, the AI's eyes
//     and the Quest view all see this room;
//   • a third-person view behind the car in the Simulation card (or from above).
// Only active while the practice car is the connected car.
import * as THREE from './lib/three.module.min.js';

const S = { on: false, room: null, scene: null, car: null, wheels: [], fp: null, tp: null, pose: null, shown: { x: 0, y: 0, h: 0 }, lastFrame: 0, sending: false, mode: 'chase', poseAt: 0 };
const api = (p, o) => window.MCui.api(p, o);

// ---------------------------------------------------------------- procedural textures (no image files needed)
function tex(w, hgt, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function woodFloor() {
  return tex(512, 512, (g, w, h) => {
    const plank = 64;
    for (let y = 0; y < h; y += plank) for (let x = (y / plank) % 2 ? -128 : 0; x < w; x += 256) {
      const base = [rnd(150, 175), rnd(105, 122), rnd(68, 80)];
      g.fillStyle = `rgb(${base.map(Math.round).join(',')})`; g.fillRect(x, y, 256, plank);
      for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(80,50,25,${rnd(0.05, 0.16)})`; g.lineWidth = rnd(0.5, 2); g.beginPath(); const yy = y + rnd(4, plank - 4); g.moveTo(x, yy); g.bezierCurveTo(x + 80, yy + rnd(-3, 3), x + 170, yy + rnd(-3, 3), x + 256, yy + rnd(-2, 2)); g.stroke(); }
      g.strokeStyle = 'rgba(40,25,10,.55)'; g.lineWidth = 2; g.strokeRect(x, y, 256, plank);
    }
  }, [4, 3]);
}
function wallPaint(col) {
  return tex(256, 256, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${rnd(0.01, 0.04)})`; g.fillRect(rnd(0, w), rnd(0, h), 2, 2); } }, [3, 2]);
}
function fabric(col) {
  return tex(128, 128, (g, w, h) => { g.fillStyle = col; g.fillRect(0, 0, w, h); g.globalAlpha = 0.08; for (let i = 0; i < w; i += 3) { g.fillStyle = i % 6 ? '#000' : '#fff'; g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1); } }, [2, 2]);
}
function rugTex() {
  return tex(256, 256, (g, w, h) => { g.fillStyle = '#2f4f6b'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d9c38f'; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28); g.lineWidth = 3; g.strokeRect(34, 34, w - 68, h - 68); g.fillStyle = '#b5543c'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(w / 2, h / 2, 20 + i * 18, 0, Math.PI * 2); g.strokeStyle = i % 2 ? '#d9c38f' : '#b5543c'; g.stroke(); } });
}
function painting() {
  return tex(256, 192, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7fb2e5'); gr.addColorStop(0.6, '#f6d89a'); gr.addColorStop(1, '#4e7d3a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#2f5a2a'; g.beginPath(); g.moveTo(0, h * 0.7); g.lineTo(w * 0.3, h * 0.35); g.lineTo(w * 0.55, h * 0.65); g.lineTo(w * 0.8, h * 0.4); g.lineTo(w, h * 0.7); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(w * 0.78, h * 0.2, 16, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#6b4a2b'; g.lineWidth = 14; g.strokeRect(0, 0, w, h); });
}

// ---------------------------------------------------------------- the room (simulator cm → metres; x = east, z = south)
function buildScene(room) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);
  const W = room.w / 100, D = room.h / 100, HGT = 2.4;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const add = (mesh, x, y, z, shadow = true) => { mesh.position.set(x, y, z); mesh.castShadow = shadow; mesh.receiveShadow = true; scene.add(mesh); return mesh; };
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // floor, rug, ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ map: woodFloor(), roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2; add(floor, W / 2, 0, D / 2, false);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), std({ map: rugTex(), roughness: 0.95 })); rug.rotation.x = -Math.PI / 2; add(rug, 1.55, 0.002, 1.75, false);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ color: 0xf2f0ea })); ceil.rotation.x = Math.PI / 2; add(ceil, W / 2, HGT, D / 2, false);
  // walls (each with its own colour) + skirting boards
  const walls = [[W, 0, W / 2, 0, '#d8cdb8'], [W, Math.PI, W / 2, D, '#c9d6c4'], [D, Math.PI / 2, 0, D / 2, '#cfd8e3'], [D, -Math.PI / 2, W, D / 2, '#e3d3c9']];
  for (const [len, rot, x, z, col] of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, HGT), std({ map: wallPaint(col) })); m.rotation.y = rot; add(m, x, HGT / 2, z, false);
    const sk = box(len, 0.08, 0.015, std({ color: 0xf5f5f0 })); sk.rotation.y = rot; add(sk, x + Math.sin(rot) * 0.008, 0.04, z + Math.cos(rot) * 0.008);
  }
  // door on the north wall, window on the east wall, a painting on the west wall
  const door = box(0.85, 2.0, 0.05, std({ color: 0x8a5a33, roughness: 0.6 })); add(door, 2.95, 1.0, 0.025);
  for (let i = 0; i < 2; i++) add(box(0.66, 0.78, 0.01, std({ color: 0x7a4e2b })), 2.95, 0.55 + i * 0.95, 0.055);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), std({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 })), 2.65, 1.0, 0.07);
  const win = box(0.04, 0.9, 1.2, new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x6f9fc8, emissiveIntensity: 0.6, roughness: 0.1 })); add(win, W - 0.02, 1.45, 1.4, false);
  add(box(0.06, 0.06, 1.3, std({ color: 0xffffff })), W - 0.03, 0.97, 1.4);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.62), std({ map: painting() })); pic.rotation.y = Math.PI / 2; add(pic, 0.01, 1.5, 1.2, false);
  // furniture on the simulator's obstacle boxes: [armchair, sofa, plant]
  const [b1, b2, b3] = room.boxes.map(([x1, y1, x2, y2]) => ({ x: (x1 + x2) / 200, z: (y1 + y2) / 200, w: (x2 - x1) / 100, d: (y2 - y1) / 100 }));
  if (b1) { // armchair, facing west (towards the car start)
    const red = std({ map: fabric('#a83a32') });
    add(box(b1.w, 0.22, b1.d, red), b1.x, 0.2, b1.z);
    add(box(0.12, 0.45, b1.d, red), b1.x + b1.w / 2 - 0.06, 0.45, b1.z);
    for (const s of [-1, 1]) add(box(b1.w, 0.28, 0.1, red), b1.x, 0.38, b1.z + s * (b1.d / 2 - 0.05));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(box(0.04, 0.09, 0.04, std({ color: 0x3b2a1a })), b1.x + sx * (b1.w / 2 - 0.04), 0.045, b1.z + sz * (b1.d / 2 - 0.04));
  }
  if (b2) { // sofa, facing north
    const green = std({ map: fabric('#3f6e5a') });
    add(box(b2.w, 0.24, b2.d, green), b2.x, 0.22, b2.z);
    add(box(b2.w, 0.45, 0.14, green), b2.x, 0.5, b2.z + b2.d / 2 - 0.07);
    for (const s of [-1, 1]) add(box(0.12, 0.32, b2.d, green), b2.x + s * (b2.w / 2 - 0.06), 0.42, b2.z);
    add(box(0.3, 0.14, 0.12, std({ map: fabric('#e8c35a') })), b2.x - 0.15, 0.42, b2.z + 0.05);
  }
  if (b3) { // plant in a pot
    add(new THREE.Mesh(new THREE.CylinderGeometry(b3.w / 2, b3.w / 2.6, 0.32, 24), std({ color: 0xb4643c, roughness: 0.7 })), b3.x, 0.16, b3.z);
    const leaf = std({ color: 0x2f7d32, roughness: 0.6 });
    for (let i = 0; i < 9; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.08, 0.13), 12, 10), leaf); add(l, b3.x + rnd(-0.1, 0.1), rnd(0.42, 0.75), b3.z + rnd(-0.1, 0.1)); }
  }
  // a small table and a ball as things to find
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 32), std({ color: 0xe6e1d6, roughness: 0.4 })), 0.55, 0.45, 0.5);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.44, 12), std({ color: 0x333333 })), 0.55, 0.22, 0.5);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), std({ color: 0xffd23f, roughness: 0.35 })), 1.2, 0.06, 2.4);
  // lights
  scene.add(new THREE.HemisphereLight(0xfff6e5, 0x3a3024, 0.75));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.4); sun.position.set(W + 1.5, 3.5, 1.2); sun.target.position.set(W / 2, 0, D / 2); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 10 }); sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const lamp = new THREE.PointLight(0xffe2b0, 1.2, 6, 1.6); lamp.position.set(W / 2, HGT - 0.25, D / 2); scene.add(lamp);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c8, emissiveIntensity: 1 })), W / 2, HGT - 0.2, D / 2, false);
  return scene;
}

// the Baby Carpathron: blue chassis, four yellow-hub wheels, the ESP32-CAM on a mast, the laser sensor in front
function buildCar() {
  const g = new THREE.Group();
  const m = (o) => new THREE.MeshStandardMaterial({ roughness: 0.5, ...o });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.15), m({ color: 0x2f6fd6, metalness: 0.2 })); body.position.y = 0.06; body.castShadow = true; g.add(body);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.13), m({ color: 0x1a1a1a })); deck.position.y = 0.092; g.add(deck);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), m({ color: 0x222222 })); cam.position.set(0.09, 0.115, 0); g.add(cam);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.01, 16), m({ color: 0x111111, metalness: 0.9, roughness: 0.2 })); lens.rotation.z = Math.PI / 2; lens.position.set(0.106, 0.118, 0); g.add(lens);
  const laser = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.03), m({ color: 0x7b2cbf })); laser.position.set(0.122, 0.06, 0); g.add(laser);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.026, 24), m({ color: 0x1b1b1b, roughness: 0.9 })); tyre.rotation.x = Math.PI / 2; tyre.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.028, 12), m({ color: 0xf2c230 })); hub.rotation.x = Math.PI / 2;
    w.add(tyre, hub); w.position.set(sx * 0.075, 0.033, sz * 0.09); g.add(w); wheels.push({ w, side: sz < 0 ? 'l' : 'r' });
  }
  return { g, wheels };
}

function makeRenderer(w, hgt) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(w, hgt, false); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  return r;
}

async function start(room) {
  S.room = room; S.scene = buildScene(room);
  const car = buildCar(); S.car = car.g; S.wheels = car.wheels; S.scene.add(S.car);
  S.fpCam = new THREE.PerspectiveCamera(62, 4 / 3, 0.02, 30);
  S.tpCam = new THREE.PerspectiveCamera(55, 4 / 3, 0.02, 40);
  S.fp = makeRenderer(640, 480); S.fp.domElement.className = 'sim3d-fp';
  S.tp = makeRenderer(800, 500); S.tp.domElement.className = 'sim3d-tp';
  S.on = true;
}

function mount() {
  const wrap = document.querySelector('#liveCard .video-wrap'), img = document.getElementById('carVideo');
  if (wrap && !wrap.contains(S.fp.domElement)) { wrap.insertBefore(S.fp.domElement, wrap.firstChild); }
  if (img) img.hidden = true;
  const card = document.querySelector('.sim-card');
  if (card && !card.contains(S.tp.domElement)) {
    card.append(S.tp.domElement);
    const bar = document.createElement('div'); bar.className = 'sim3d-bar';
    for (const [m, t] of [['chase', '🎥 Behind the car'], ['top', '🗺 From above'], ['room', '🏠 Whole room']]) { const b = document.createElement('button'); b.className = `btn tiny ${S.mode === m ? 'primary' : ''}`; b.textContent = t; b.onclick = () => { S.mode = m; bar.querySelectorAll('button').forEach((x) => x.classList.toggle('primary', x === b)); }; bar.append(b); }
    card.append(bar);
  }
  card && card.classList.add('sim3d-on');
  const lab = document.getElementById('simLabel'); if (lab) lab.textContent = 'Practice car — 3D room';
}
function unmount() {
  if (S.fp && S.fp.domElement.parentNode) S.fp.domElement.remove();
  const img = document.getElementById('carVideo'); if (img) img.hidden = false;
  const card = document.querySelector('.sim-card');
  if (card) { card.classList.remove('sim3d-on'); card.querySelectorAll('.sim3d-tp, .sim3d-bar').forEach((x) => x.remove()); }
}

let lastCheck = 0, active = false;
async function poll() {
  try {
    if (performance.now() - lastCheck > 1500 || !active) { // is the practice car the connected car?
      lastCheck = performance.now();
      const st = await api('/api/robot'), full = await api('/api/robot/car/practice');
      active = !!(full.running && st.state === 'online' && full.host === st.ip);
      if (active && !S.on && full.room) await start(full.room);
    }
    if (active && S.on) { const p = await api('/api/robot/car/practice/pose'); if (p.running) { S.pose = p; mount(); } else active = false; }
  } catch { active = false; }
  if (!active && S.on) unmount();
  setTimeout(poll, active ? 60 : 1500);
}

let spin = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (!S.on || !S.pose || !S.fp.domElement.isConnected) return;
  // smooth towards the latest pose (the practice car moves continuously)
  const tx = S.pose.x / 100, tz = S.pose.y / 100, th = (S.pose.heading * Math.PI) / 180;
  const k = 0.35;
  S.shown.x += (tx - S.shown.x) * k; S.shown.y += (tz - S.shown.y) * k;
  let dh = th - S.shown.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); S.shown.h += dh * k;
  const { x, y: z, h } = S.shown;
  S.car.position.set(x, 0, z); S.car.rotation.y = -h;
  spin += 0.02; for (const w of S.wheels) w.w.rotation.z -= ((w.side === 'l' ? S.pose.l : S.pose.r) / 100) * 0.4;
  // first person: the ESP32-CAM, 12 cm above the floor, looking ahead and a little down
  const dx = Math.cos(h), dz = Math.sin(h);
  S.fpCam.position.set(x + dx * 0.1, 0.12, z + dz * 0.1);
  S.fpCam.lookAt(x + dx * 2, 0.06, z + dz * 2);
  if (S.pose.camera === false) { S.fp.setClearColor(0x000000); S.fp.clear(); } else S.fp.render(S.scene, S.fpCam);
  // third person
  if (S.mode === 'chase') { S.tpCam.position.set(x - dx * 0.75, 0.42, z - dz * 0.75); S.tpCam.lookAt(x + dx * 0.4, 0.05, z + dz * 0.4); }
  else if (S.mode === 'top') { S.tpCam.position.set(x, 2.2, z + 0.001); S.tpCam.lookAt(x, 0, z); }
  else { S.tpCam.position.set(S.room.w / 200, 4.2, S.room.h / 100 + 2.2); S.tpCam.lookAt(S.room.w / 200, 0, S.room.h / 200); }
  if (S.tp.domElement.isConnected) S.tp.render(S.scene, S.tpCam);
  // send the camera picture to the practice car (its /capture and video stream), ~3 times a second
  if (!S.sending && t - S.lastFrame > 300 && S.pose.camera !== false) {
    S.lastFrame = t; S.sending = true;
    S.fp.domElement.toBlob((b) => { if (!b) { S.sending = false; return; } fetch('/api/robot/car/practice/frame', { method: 'POST', body: b, credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' } }).catch(() => {}).finally(() => { S.sending = false; }); }, 'image/jpeg', 0.8);
  }
}
requestAnimationFrame(frame);
const boot = () => { if (window.MCui) poll(); else setTimeout(boot, 400); };
boot();
window.MCsim3d = { state: S };
