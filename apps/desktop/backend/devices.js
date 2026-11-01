// Device discovery for the Robot page → Devices tab: boards on USB (by the USB chip's VID:PID and arduino-cli's board
// detection) and robots on the network (the Baby Carpathron car, saved SSH servers that are Raspberry Pi / Jetson boards,
// a Jetson on its USB network 192.168.55.1, raspberrypi.local / jetson.local). For each device: what it is, which
// board (FQBN) and Arduino core it needs, which firmware fits, and what to do next.
'use strict';
const dns = require('dns');
const net = require('net');

// USB chips and boards (VID:PID, upper-case hex). pid '*' = any.
const USB = [
  { vid: '1A86', pid: '*', chip: 'CH340 / CH9102 USB-serial', kind: 'esp32-or-arduino', name: 'ESP32 or Arduino-compatible board (CH340)' },
  { vid: '10C4', pid: 'EA60', chip: 'CP210x USB-serial', kind: 'esp32', name: 'ESP32 development board (CP210x)' },
  { vid: '303A', pid: '*', chip: 'Espressif native USB', kind: 'esp32s3', name: 'ESP32-S3 / C3 / C6 (native USB)' },
  { vid: '0403', pid: '*', chip: 'FTDI USB-serial', kind: 'serial', name: 'FTDI USB-serial adapter (Arduino Pro Mini, ESP-01…)' },
  { vid: '2341', pid: '0043', chip: 'Arduino', kind: 'avr', name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  { vid: '2341', pid: '0001', chip: 'Arduino', kind: 'avr', name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  { vid: '2341', pid: '0042', chip: 'Arduino', kind: 'avr', name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
  { vid: '2341', pid: '8036', chip: 'Arduino', kind: 'avr', name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo' },
  { vid: '2341', pid: '0058', chip: 'Arduino', kind: 'megaavr', name: 'Arduino Nano Every', fqbn: 'arduino:megaavr:nona4809' },
  { vid: '2341', pid: '1002', chip: 'Arduino', kind: 'renesas', name: 'Arduino Uno R4 WiFi', fqbn: 'arduino:renesas_uno:unor4wifi' },
  { vid: '2341', pid: '0069', chip: 'Arduino', kind: 'renesas', name: 'Arduino Uno R4 Minima', fqbn: 'arduino:renesas_uno:minima' },
  { vid: '2341', pid: '*', chip: 'Arduino', kind: 'arduino', name: 'Arduino board' },
  { vid: '2A03', pid: '*', chip: 'Arduino (.org)', kind: 'arduino', name: 'Arduino board' },
  { vid: '2E8A', pid: '0003', chip: 'RP2040 boot ROM', kind: 'pico-boot', name: 'Raspberry Pi Pico in BOOTSEL mode (drive RPI-RP2)' },
  { vid: '2E8A', pid: '000F', chip: 'RP2350 boot ROM', kind: 'pico-boot', name: 'Raspberry Pi Pico 2 in BOOTSEL mode (drive RP2350)' },
  { vid: '2E8A', pid: '0005', chip: 'MicroPython', kind: 'pico-mpy', name: 'Raspberry Pi Pico running MicroPython' },
  { vid: '2E8A', pid: '*', chip: 'Raspberry Pi RP2040', kind: 'pico', name: 'Raspberry Pi Pico (Arduino / C SDK)', fqbn: 'rp2040:rp2040:rpipico' },
  { vid: '0483', pid: '374B', chip: 'ST-LINK', kind: 'stm32', name: 'STM32 Nucleo / ST-LINK', fqbn: 'STMicroelectronics:stm32:Nucleo_64' },
  { vid: '0483', pid: '*', chip: 'STMicroelectronics', kind: 'stm32', name: 'STM32 board' },
  { vid: '16C0', pid: '0483', chip: 'Teensy', kind: 'teensy', name: 'Teensy (PJRC)' },
  { vid: '239A', pid: '*', chip: 'Adafruit', kind: 'adafruit', name: 'Adafruit board (CircuitPython / Arduino)' },
  { vid: '0955', pid: '7020', chip: 'NVIDIA', kind: 'jetson-usb', name: 'NVIDIA Jetson (USB device mode — SSH at 192.168.55.1)' },
  { vid: '0955', pid: '*', chip: 'NVIDIA', kind: 'jetson-recovery', name: 'NVIDIA Jetson in recovery mode (flash with SDK Manager)' },
];

// What each kind needs and can do
const KINDS = {
  'esp32-or-arduino': { core: 'esp32:esp32', fqbn: 'esp32:esp32:esp32', tools: 'arduino', note: 'The kit car (KUONGSHUN AD174, ESP32-CAM) uses this chip.' },
  esp32: { core: 'esp32:esp32', fqbn: 'esp32:esp32:esp32', tools: 'arduino' },
  esp32s3: { core: 'esp32:esp32', fqbn: 'esp32:esp32:esp32s3', tools: 'arduino' },
  serial: { tools: 'arduino' },
  avr: { core: 'arduino:avr', tools: 'arduino' },
  megaavr: { core: 'arduino:megaavr', tools: 'arduino' },
  renesas: { core: 'arduino:renesas_uno', tools: 'arduino' },
  arduino: { core: 'arduino:avr', fqbn: 'arduino:avr:uno', tools: 'arduino' },
  pico: { core: 'rp2040:rp2040', fqbn: 'rp2040:rp2040:rpipico', tools: 'arduino' },
  'pico-boot': { tools: 'uf2', note: 'Copy a .uf2 file to the drive (pico_flash tool), e.g. MicroPython, then it restarts as a normal Pico.' },
  'pico-mpy': { tools: 'micropython', note: 'Write Python with the micropython tool (mpremote): main.py runs at start.' },
  stm32: { core: 'STMicroelectronics:stm32', tools: 'arduino', note: 'Needs the STM32 core (Board manager URL is added by arduino_setup).' },
  teensy: { core: 'teensy:avr', tools: 'arduino', note: 'Needs the Teensy core from PJRC.' },
  adafruit: { tools: 'arduino', note: 'CircuitPython boards show a CIRCUITPY drive — edit code.py on it.' },
  'jetson-usb': { tools: 'ssh', note: 'Connect over SSH: ssh <user>@192.168.55.1 (Remote page → add server).' },
  'jetson-recovery': { tools: 'sdkmanager', note: 'Flash JetPack with NVIDIA SDK Manager (dev_install / open_ide sdkmanager).' },
};

const hex = (v) => String(v || '').replace(/^0x/i, '').toUpperCase().padStart(4, '0');
function identify(vid, pid) {
  const V = hex(vid), P = hex(pid);
  const m = USB.find((u) => u.vid === V && (u.pid === P || u.pid === '*') && u.pid !== '*') || USB.find((u) => u.vid === V && u.pid === '*');
  if (!m) return null;
  return { ...m, ...(KINDS[m.kind] || {}), fqbn: m.fqbn || (KINDS[m.kind] || {}).fqbn || null };
}

// arduino-cli `board list --format json` → devices
function fromBoardList(json) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  const list = j.detected_ports || j.ports || (Array.isArray(j) ? j : []);
  return list.map((d) => {
    const port = d.port || d;
    const props = port.properties || {};
    const board = (d.matching_boards || d.boards || [])[0];
    const id = props.vid ? identify(props.vid, props.pid) : null;
    if (!id && !board && !/^COM\d+|ttyUSB|ttyACM/.test(port.address || '')) return null;
    if (!id && !board && !props.vid) return null; // built-in serial ports (COM1) are not boards
    return {
      type: 'usb', address: port.address, protocol: port.protocol || 'serial', vid: props.vid ? hex(props.vid) : null, pid: props.pid ? hex(props.pid) : null,
      name: board ? board.name : id ? id.name : 'USB serial device', chip: id ? id.chip : '', kind: id ? id.kind : 'serial',
      fqbn: (board && board.fqbn) || (id && id.fqbn) || null, core: id && id.core || (board && board.fqbn ? board.fqbn.split(':').slice(0, 2).join(':') : null),
      tools: id ? id.tools : 'arduino', note: id ? id.note || '' : '',
    };
  }).filter(Boolean);
}

// Windows fallback without arduino-cli: PnP devices with a COM port, or known VID (Pico in BOOTSEL has no COM port)
function fromPnp(json) {
  let arr; try { arr = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((d) => {
    const m = String(d.DeviceID || d.PNPDeviceID || '').match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i);
    if (!m) return null;
    const id = identify(m[1], m[2]);
    if (!id) return null;
    const com = String(d.Name || '').match(/\((COM\d+)\)/);
    return { type: 'usb', address: com ? com[1] : null, protocol: com ? 'serial' : 'usb', vid: hex(m[1]), pid: hex(m[2]), name: id.name, chip: id.chip, kind: id.kind, fqbn: id.fqbn, core: id.core || null, tools: id.tools, note: id.note || '' };
  }).filter(Boolean).filter((d, i, a) => a.findIndex((x) => x.vid === d.vid && x.pid === d.pid && x.address === d.address) === i);
}

const tcpOpen = (host, port, ms = 700) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  const done = (ok) => { s.destroy(); resolve(ok); };
  s.setTimeout(ms, () => done(false));
  s.on('connect', () => done(true)); s.on('error', () => done(false));
});
const lookup = (name, ms = 1500) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), ms);
  dns.lookup(name, { family: 4 }, (e, addr) => { clearTimeout(t); resolve(e ? null : addr); });
});

// Robots and boards on the network
async function networkDevices({ settings, servers = [], robotStatus }) {
  const out = [];
  const car = robotStatus || {};
  if (settings.robot && settings.robot.carIp) {
    out.push({ type: 'network', kind: 'carpathron-car', name: 'Baby Carpathron car (ESP32-CAM)', address: settings.robot.carIp, online: car.state === 'online', firmware: car.firmware === 'carpathron' ? `Carpathron ${car.version || '(older than 2.0)'}` : car.firmware || 'unknown', sensors: car.sensors || null, fqbn: 'esp32:esp32:esp32cam', core: 'esp32:esp32', tools: 'carpathron', note: 'Firmware: carpathron_car (bundled). Update over USB from the Setup tab or the Firmware studio.' });
  }
  for (const s of servers) {
    const text = `${s.name} ${s.host} ${s.os || ''}`.toLowerCase();
    const kind = /jetson|tegra|orin|nano|xavier/.test(text) ? 'jetson' : /raspberry|raspi|rpi|pi\d?\b/.test(text) ? 'raspberry-pi' : null;
    if (kind) out.push({ type: 'network', kind, name: `${kind === 'jetson' ? 'NVIDIA Jetson' : 'Raspberry Pi'} — ${s.name}`, address: `${s.username}@${s.host}`, serverId: s.id, tools: 'ssh', note: 'Saved SSH server: open it on the Remote page, or ask the agent to work on it (code, ROS 2, camera, GPIO).' });
  }
  const probes = [
    { host: '192.168.55.1', kind: 'jetson', name: 'NVIDIA Jetson on USB network (192.168.55.1)' },
  ];
  for (const n of ['raspberrypi.local', 'jetson.local', 'ubuntu.local']) probes.push({ name: n, mdns: n, kind: n.startsWith('jetson') ? 'jetson' : n.startsWith('raspberry') ? 'raspberry-pi' : 'linux' });
  await Promise.all(probes.map(async (p) => {
    const ip = p.host || await lookup(p.mdns);
    if (!ip || out.some((d) => String(d.address).endsWith(ip))) return;
    if (await tcpOpen(ip, 22)) out.push({ type: 'network', kind: p.kind, name: p.mdns ? `${p.kind === 'jetson' ? 'NVIDIA Jetson' : p.kind === 'raspberry-pi' ? 'Raspberry Pi' : 'Linux board'} (${p.mdns})` : p.name, address: ip, tools: 'ssh', note: 'SSH is open: add it on the Remote page (user + password or key), then the agent can work on it.' });
  }));
  return out;
}

module.exports = { USB, KINDS, identify, fromBoardList, fromPnp, networkDevices, hex };
