// Carpathron Remote — puts the viewer's mouse and keyboard into this PC (host side, main process).
// Windows: a small resident native helper (bin/rdinput.exe, user32 SendInput; source bin/rdinput.c) reads one command
// per line from stdin, so each event costs a pipe write, not a new process (PowerShell + C# only as a fallback). Coordinates are physical pixels on the virtual desktop.
// Linux (X11): a resident `xdotool -` reads one command per line (xdotool must be installed: sudo apt install xdotool).
// Wayland desktops do not let apps move the mouse of other apps: there, log in with an X11 ("Xorg") session to be
// controlled (viewing and controlling other PCs works everywhere). Tests: events are written to RD_INJECT_LOG.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

const CS = String.raw`
using System; using System.Runtime.InteropServices;
public static class RDI {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v);
  public static void Init() { try { SetProcessDpiAwareness(2); } catch { try { SetProcessDPIAware(); } catch {} } }
  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }
  static INPUT M(uint flags, int dx, int dy, uint data) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; return i; }
  public static void Move(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    if (vw <= 1 || vh <= 1) return;
    int nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
    Send(M(0x0001 | 0x8000 | 0x4000, nx, ny, 0)); // MOVE | ABSOLUTE | VIRTUALDESK
  }
  public static void Button(int b, bool down) {
    uint f = b == 0 ? (down ? 0x0002u : 0x0004u) : b == 2 ? (down ? 0x0008u : 0x0010u) : b == 1 ? (down ? 0x0020u : 0x0040u)
           : (down ? 0x0080u : 0x0100u);
    uint data = b == 3 ? 1u : b == 4 ? 2u : 0u;
    Send(M(f, 0, 0, data));
  }
  public static void Wheel(int dy, int dx) {
    if (dy != 0) Send(M(0x0800, 0, 0, unchecked((uint)dy)));
    if (dx != 0) Send(M(0x1000, 0, 0, unchecked((uint)dx)));
  }
  public static void Key(int vk, bool down, bool ext) {
    var i = new INPUT(); i.type = 1; i.u.ki.vk = (ushort)vk; i.u.ki.scan = (ushort)MapVirtualKey((uint)vk, 0);
    i.u.ki.flags = (down ? 0u : 2u) | (ext ? 1u : 0u); Send(i);
  }
  public static void Text(string s) {
    foreach (char c in s) {
      if (c == '\r') continue;
      if (c == '\n') { Key(0x0D, true, false); Key(0x0D, false, false); continue; }
      var d = new INPUT(); d.type = 1; d.u.ki.scan = c; d.u.ki.flags = 4; Send(d);
      var u = new INPUT(); u.type = 1; u.u.ki.scan = c; u.u.ki.flags = 4 | 2; Send(u);
    }
  }
}`;

const PS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${CS}
'@
[RDI]::Init()
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine(); if ($l -eq $null) { break }
  try {
    $p = $l.Split(' ')
    switch ($p[0]) {
      'M' { [RDI]::Move([int]$p[1], [int]$p[2]) }
      'B' { [RDI]::Button([int]$p[1], $p[2] -eq '1') }
      'W' { [RDI]::Wheel([int]$p[1], [int]$p[2]) }
      'K' { [RDI]::Key([int]$p[1], $p[2] -eq '1', $p[3] -eq '1') }
      'T' { [RDI]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
    }
  } catch {}
}
`;

// KeyboardEvent.code → Windows virtual-key code (+ extended-key flag)
const VK = {};
for (let i = 0; i < 26; i++) VK['Key' + String.fromCharCode(65 + i)] = [65 + i];
for (let i = 0; i < 10; i++) { VK['Digit' + i] = [48 + i]; VK['Numpad' + i] = [96 + i]; }
for (let i = 1; i <= 24; i++) VK['F' + i] = [111 + i];
Object.assign(VK, {
  Escape: [0x1B], Tab: [0x09], CapsLock: [0x14], ShiftLeft: [0xA0], ShiftRight: [0xA1], ControlLeft: [0xA2], ControlRight: [0xA3, 1],
  AltLeft: [0xA4], AltRight: [0xA5, 1], MetaLeft: [0x5B, 1], MetaRight: [0x5C, 1], ContextMenu: [0x5D, 1], Space: [0x20], Enter: [0x0D],
  Backspace: [0x08], Delete: [0x2E, 1], Insert: [0x2D, 1], Home: [0x24, 1], End: [0x23, 1], PageUp: [0x21, 1], PageDown: [0x22, 1],
  ArrowLeft: [0x25, 1], ArrowUp: [0x26, 1], ArrowRight: [0x27, 1], ArrowDown: [0x28, 1], PrintScreen: [0x2C, 1], ScrollLock: [0x91], Pause: [0x13],
  NumLock: [0x90, 1], NumpadDivide: [0x6F, 1], NumpadMultiply: [0x6A], NumpadSubtract: [0x6D], NumpadAdd: [0x6B], NumpadDecimal: [0x6E], NumpadEnter: [0x0D, 1],
  Minus: [0xBD], Equal: [0xBB], BracketLeft: [0xDB], BracketRight: [0xDD], Backslash: [0xDC], Semicolon: [0xBA], Quote: [0xDE],
  Backquote: [0xC0], Comma: [0xBC], Period: [0xBE], Slash: [0xBF], IntlBackslash: [0xE2], IntlRo: [0xC1], IntlYen: [0xDC],
  AudioVolumeMute: [0xAD, 1], AudioVolumeDown: [0xAE, 1], AudioVolumeUp: [0xAF, 1], MediaPlayPause: [0xB3, 1],
});
const COMBOS = { // toolbar shortcuts the viewer's own Windows would otherwise catch
  win: [['MetaLeft']], alttab: [['AltLeft', 'Tab']], ctrlesc: [['ControlLeft', 'Escape']], winr: [['MetaLeft', 'KeyR']], wind: [['MetaLeft', 'KeyD']],
  ctrlshiftesc: [['ControlLeft', 'ShiftLeft', 'Escape']], winl: [['MetaLeft', 'KeyL']], printscreen: [['PrintScreen']],
};

// KeyboardEvent.code → X11 keysym (Linux)
const XK = {};
for (let i = 0; i < 26; i++) XK['Key' + String.fromCharCode(65 + i)] = String.fromCharCode(97 + i);
for (let i = 0; i < 10; i++) { XK['Digit' + i] = String(i); XK['Numpad' + i] = 'KP_' + i; }
for (let i = 1; i <= 24; i++) XK['F' + i] = 'F' + i;
Object.assign(XK, {
  Escape: 'Escape', Tab: 'Tab', CapsLock: 'Caps_Lock', ShiftLeft: 'Shift_L', ShiftRight: 'Shift_R', ControlLeft: 'Control_L', ControlRight: 'Control_R',
  AltLeft: 'Alt_L', AltRight: 'Alt_R', MetaLeft: 'Super_L', MetaRight: 'Super_R', ContextMenu: 'Menu', Space: 'space', Enter: 'Return', Backspace: 'BackSpace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowRight: 'Right', ArrowDown: 'Down',
  PrintScreen: 'Print', ScrollLock: 'Scroll_Lock', Pause: 'Pause', NumLock: 'Num_Lock', NumpadDivide: 'KP_Divide', NumpadMultiply: 'KP_Multiply',
  NumpadSubtract: 'KP_Subtract', NumpadAdd: 'KP_Add', NumpadDecimal: 'KP_Decimal', NumpadEnter: 'KP_Enter', Minus: 'minus', Equal: 'equal',
  BracketLeft: 'bracketleft', BracketRight: 'bracketright', Backslash: 'backslash', Semicolon: 'semicolon', Quote: 'apostrophe', Backquote: 'grave',
  Comma: 'comma', Period: 'period', Slash: 'slash', IntlBackslash: 'less', AudioVolumeMute: 'XF86AudioMute', AudioVolumeDown: 'XF86AudioLowerVolume',
  AudioVolumeUp: 'XF86AudioRaiseVolume', MediaPlayPause: 'XF86AudioPlay',
});
const XBTN = [1, 2, 3, 8, 9]; // left, middle, right, back, forward

class Injector {
  // notes from rdinput.exe: what Windows does not let a remote program see or click
  note(l) {
    if (!l) return;
    if (l === 'ready') return this.log('remote input helper ready');
    if (l.startsWith('F ')) { try { this.onFrame && this.onFrame(l.slice(2)); } catch {} return; }
    if (l === 'agent 1') { this.agent = true; return this.log('full control helper (service) connected: administrator windows, administrator prompt and sign-in screen can be used'); }
    if (l === 'agent 0') { this.agent = false; return this.log('full control helper (service) disconnected'); }
    if (l === 'nosas') return this.status('Ctrl+Alt+Del needs the Carpathron Remote Helper service on the remote PC (installed by the Windows installer of Carpathron Remote). Without it, use Keys → Ctrl+Shift+Esc for Task Manager or Win+L to lock.');
    if (l === 'secure 1' && this.agent) { this.secure = true; try { this.onSecure && this.onSecure(true); } catch {} return this.status('The remote PC shows a Windows security screen (administrator prompt, sign-in or Ctrl+Alt+Del). You see it here and can answer it.'); }
    if (l === 'secure 1') { this.secure = true; return this.status('The remote PC is showing a Windows security screen (an administrator prompt "Do you want to allow this app…", the lock screen or Ctrl+Alt+Del). Windows hides that screen from every remote program, so the picture stays still and clicks do not reach it. Ask the person at that PC to answer it (Yes / No or the password); the picture comes back by itself. (With the Windows installer of Carpathron Remote on that PC, its helper service lets you see and answer it from here.)'); }
    if (l === 'secure 0') { try { this.onSecure && this.onSecure(false); } catch {} if (this.secure) { this.secure = false; this.status('The Windows security screen is closed: the picture and remote control work again.'); } return; }
    if (l === 'elevated 1') { const now = Date.now(); if (!this.elevAt || now - this.elevAt > 60000) { this.elevAt = now; this.status('The window in front runs as administrator, so Windows blocks clicks and keys from Carpathron Remote into it. To control such windows, start Carpathron Remote on that PC with right-click → "Run as administrator".'); } return; }
    if (l === 'elevated 0') return;
    this.log(`remote input helper: ${l.slice(0, 200)}`);
  }
  // Ctrl+Alt+Del: only the helper service can send it (Windows reserves it)
  sas() { if (IS_WIN) this.line('S'); else this.status('Ctrl+Alt+Del is for Windows computers.'); }
  status(text) { this.log(text); try { this.onStatus && this.onStatus(text); } catch {} }
  constructor(log) { this.log = log || (() => {}); this.proc = null; this.down = new Set(); this.file = process.env.RD_INJECT_LOG || ''; }
  static support() {
    if (process.env.RD_INJECT_LOG) return { ok: true };
    if (IS_WIN) return { ok: true };
    if (IS_LINUX) {
      if (process.env.XDG_SESSION_TYPE === 'wayland' || (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)) return { ok: false, why: 'wayland' };
      try { require('child_process').execFileSync('xdotool', ['version'], { stdio: 'ignore', timeout: 3000 }); return { ok: true }; } catch { return { ok: false, why: 'xdotool' }; }
    }
    return { ok: false, why: 'os' };
  }
  start() {
    if (this.proc) return;
    if (IS_LINUX) {
      this.proc = spawn('xdotool', ['-'], { stdio: ['pipe', 'ignore', 'pipe'] });
      this.proc.on('error', (e) => { this.log(`xdotool: ${e.message}`); this.proc = null; });
      this.proc.on('exit', (c) => { this.log(`xdotool exited (${c})`); this.proc = null; });
      this.proc.stderr.on('data', (d) => this.log(`xdotool: ${String(d).slice(0, 200)}`));
      this.proc.stdin.on('error', () => {});
      return;
    }
    if (!IS_WIN) return;
    if (this.failedAt && Date.now() - this.failedAt < 5000) return; // do not retry in a tight loop
    // Windows: the small native helper bin/rdinput.exe (SendInput); PowerShell only if it is missing
    const exe = path.join(__dirname, 'bin', 'rdinput.exe').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
    let cmd, args;
    if (fs.existsSync(exe) && !this.useFallback) { cmd = exe; args = []; }
    else { const W = require('./winexe'); cmd = W.exe('powershell'); args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')]; }
    this.log(`remote input helper starting: ${cmd === exe ? 'rdinput.exe' : 'PowerShell (rdinput.exe missing: ' + exe + ')'}`);
    this.proc = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: require('./winexe').env() });
    let buf = ''; // stdout comes in chunks: only whole lines are notes (picture lines are long)
    this.proc.stdout.on('data', (d) => { buf += String(d); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); this.note(l); } if (buf.length > 8e6) buf = ''; });
    const started = Date.now(); const native = cmd === exe;
    // a helper that cannot start or dies at once (blocked by antivirus / policy, damaged system): switch to the other one
    const failed = (why) => {
      this.proc = null; this.failedAt = Date.now();
      if (native && !this.useFallback) { this.useFallback = true; this.failedAt = 0; this.status(`Remote control: the input helper was blocked on this PC (${why}); switching to the PowerShell method.`); }
      else this.status(`Remote control is not possible on this PC right now: the input helper is blocked (${why}). The antivirus or a security policy may block programs that move the mouse; allow Carpathron Remote there, or run it as administrator.`);
    };
    this.proc.on('error', (e) => { this.log(`remote input helper could not start (${cmd}): ${e.message}`); failed(e.message); });
    this.proc.on('exit', (c) => { this.log(`remote input helper exited (${c})`); if (Date.now() - started < 5000 && c !== 0) failed(`exit code ${c}`); else this.proc = null; });
    this.proc.stderr.on('data', (d) => this.log(`remote input helper: ${String(d).slice(0, 300)}`));
    this.proc.stdin.on('error', () => {});
  }
  line(s) {
    if (this.file) { try { fs.appendFileSync(this.file, s + '\n'); } catch {} return; }
    if (IS_LINUX) return this.x11(s);
    if (!IS_WIN) return;
    if (!this.proc) this.start();
    if (!this.proc) return;
    try { this.proc.stdin.write(s + '\n'); } catch {}
  }
  // ev: { k, x, y (0..1 of the shared screen), b, dx, dy, code, s, name }   rect: physical pixels of that screen
  handle(ev, rect) {
    const k = ev && ev.k;
    const px = () => [Math.round(rect.x + Math.min(1, Math.max(0, +ev.x || 0)) * (rect.width - 1)), Math.round(rect.y + Math.min(1, Math.max(0, +ev.y || 0)) * (rect.height - 1))];
    if (k === 'mm') { const [x, y] = px(); this.line(`M ${x} ${y}`); }
    else if (k === 'md' || k === 'mu') {
      const b = Math.min(4, Math.max(0, ev.b | 0));
      if (ev.x != null) { const [x, y] = px(); this.line(`M ${x} ${y}`); }
      this.line(`B ${b} ${k === 'md' ? 1 : 0}`);
      if (k === 'md') this.down.add('b' + b); else this.down.delete('b' + b);
    } else if (k === 'wh') {
      const dy = Math.max(-2400, Math.min(2400, Math.round(+ev.dy || 0))); const dx = Math.max(-2400, Math.min(2400, Math.round(+ev.dx || 0)));
      if (dy || dx) this.line(`W ${dy} ${dx}`);
    } else if (k === 'kd' || k === 'ku') {
      if (IS_LINUX && !this.file) { const x = XK[String(ev.code || '')]; if (!x) return; this.line(`X ${x} ${k === 'kd' ? 1 : 0}`); }
      else { const v = VK[String(ev.code || '')]; if (!v) return; this.line(`K ${v[0]} ${k === 'kd' ? 1 : 0} ${v[1] ? 1 : 0}`); }
      if (k === 'kd') this.down.add('k' + ev.code); else this.down.delete('k' + ev.code);
    } else if (k === 'txt') {
      const s = String(ev.s || '').slice(0, 20000); if (s) this.line(`T ${Buffer.from(s, 'utf8').toString('base64')}`);
    } else if (k === 'combo' && ev.name === 'cad') { this.sas();
    } else if (k === 'combo') {
      const c = COMBOS[String(ev.name || '')]; if (!c) return;
      for (const keys of c) { for (const code of keys) this.handle({ k: 'kd', code }, rect); for (const code of [...keys].reverse()) this.handle({ k: 'ku', code }, rect); }
    }
  }
  // the same commands for xdotool (X11)
  x11(s) {
    const p = s.split(' '); let cmd = '';
    if (p[0] === 'M') cmd = `mousemove ${p[1] | 0} ${p[2] | 0}`;
    else if (p[0] === 'B') cmd = `${p[2] === '1' ? 'mousedown' : 'mouseup'} ${XBTN[p[1] | 0] || 1}`;
    else if (p[0] === 'W') {
      const dy = p[1] | 0, dx = p[2] | 0; const cmds = [];
      const n = (v) => Math.max(1, Math.min(20, Math.round(Math.abs(v) / 120)));
      if (dy) for (let i = 0; i < n(dy); i++) cmds.push(`click ${dy > 0 ? 4 : 5}`);
      if (dx) for (let i = 0; i < n(dx); i++) cmds.push(`click ${dx > 0 ? 7 : 6}`);
      cmd = cmds.join('\n');
    } else if (p[0] === 'X') cmd = `${p[2] === '1' ? 'keydown' : 'keyup'} ${p[1]}`;
    else if (p[0] === 'T') { const t = Buffer.from(p[1], 'base64').toString('utf8'); require('child_process').execFile('xdotool', ['type', '--delay', '4', '--', t], () => {}); return; }
    if (!cmd) return;
    if (!this.proc) this.start();
    try { this.proc.stdin.write(cmd + '\n'); } catch {}
  }
  // release anything the viewer left pressed (connection dropped mid-drag or mid-shortcut)
  releaseAll(rect) {
    for (const d of [...this.down]) {
      if (d[0] === 'b') this.line(`B ${d.slice(1)} 0`);
      else this.handle({ k: 'ku', code: d.slice(1) }, rect);
    }
    this.down.clear();
  }
  stop() { try { if (this.proc) this.proc.kill(); } catch {} this.proc = null; }
}

module.exports = { Injector, VK, XK, COMBOS, PS };
