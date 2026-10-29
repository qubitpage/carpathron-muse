// Computer use: the agent sees the screen and works with the mouse and keyboard, like a person.
//   computer_view / computer_act — the whole Windows desktop (any app), via a small resident PowerShell
//                                  helper that calls user32 (SendInput, SetCursorPos, EnumWindows…).
//   browser_view / browser_act   — a visible "Muse Browser" window inside the app (its own sign-ins),
//                                  driven through Chromium (DOM-aware: element list, text, clicks, typing).
// While the agent controls the PC a small banner shows "Muse is controlling this PC — Stop" (it is
// hidden from screenshots, so the agent never sees or clicks it).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const XY = { x: { type: 'integer', description: 'pixels in the LAST screenshot you got (it is scaled; the app converts)' }, y: { type: 'integer' } };

const COMPUTER_TOOLS = [
  { name: 'computer_view', risk: 'read', description: 'See the Windows desktop: screenshot (you get the picture), list_windows (titles, apps, positions), cursor. Use it before acting and after each action to check the result. Coordinates for computer_act are in the pixels of the latest screenshot.', parameters: obj({ action: { type: 'string', enum: ['screenshot', 'list_windows', 'cursor', 'screens'] }, screen: { type: 'integer', description: 'monitor index (0 = main)' }, region: { type: 'array', items: { type: 'integer' }, description: 'optional zoom [x1,y1,x2,y2] in screenshot pixels for small text' } }, ['action']) },
  { name: 'computer_act', risk: 'external', description: 'Control the Windows desktop with mouse and keyboard: click / double_click / right_click / move / drag (x,y → x2,y2) / scroll (direction, amount) / type (text) / key (e.g. "ctrl+s", "enter", "alt+tab", "win+r") / focus_window (window = part of the title or app name) / open_app (app = name, path, or Start-menu name) / wait (seconds). A screenshot is returned after each action. Rules: never type passwords, card or bank details; ask the user before sending, deleting, buying or confirming anything irreversible; never solve CAPTCHAs.', parameters: obj({ action: { type: 'string', enum: ['click', 'double_click', 'right_click', 'middle_click', 'move', 'drag', 'scroll', 'type', 'key', 'focus_window', 'open_app', 'wait'] }, ...XY, x2: { type: 'integer' }, y2: { type: 'integer' }, text: { type: 'string' }, keys: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer', description: 'scroll clicks (default 3)' }, window: { type: 'string' }, app: { type: 'string' }, args: { type: 'string', description: 'arguments for open_app' }, seconds: { type: 'number' }, screen: { type: 'integer' }, screenshot: { type: 'boolean', description: 'return a screenshot after the action (default true)' } }, ['action']) },
  { name: 'browser_view', risk: 'read', description: 'The Muse Browser (a visible browser window in the app with its own sign-ins): open (url), screenshot, text (readable page text), elements (numbered list of buttons, links and fields with positions — then use browser_act with index), back, forward, reload, scroll (direction, amount). Use it to test websites and web apps you build, check defects, read pages that need JavaScript, and to do web tasks step by step.', parameters: obj({ action: { type: 'string', enum: ['open', 'screenshot', 'text', 'elements', 'back', 'forward', 'reload', 'scroll', 'close'] }, url: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer' }, width: { type: 'integer', description: 'viewport width for open (e.g. 390 for phone, 1366 desktop)' } }, ['action']) },
  { name: 'browser_act', risk: 'external', description: 'Act in the Muse Browser: click (index from elements, or x,y in screenshot pixels), type (text into the focused or indexed field; clear=true replaces), key (e.g. "enter", "ctrl+a", "tab"), select (index + value for a dropdown), eval (run JavaScript in the page and get the result). A screenshot is returned after each action. Never enter passwords, card or bank details (ask the user to do it in the window), never solve CAPTCHAs, ask before submitting payments or irreversible forms.', parameters: obj({ action: { type: 'string', enum: ['click', 'double_click', 'type', 'key', 'select', 'hover', 'eval'] }, index: { type: 'integer' }, ...XY, text: { type: 'string' }, clear: { type: 'boolean' }, keys: { type: 'string' }, value: { type: 'string' }, js: { type: 'string' } }, ['action']) },
];
const COMPUTER_NAMES = new Set(COMPUTER_TOOLS.map((t) => t.name));

function electron() { try { const e = require('electron'); if (e && e.BrowserWindow) return e; } catch {} return null; }

// ------------------------------------------------------------------ Windows desktop helper (PowerShell + C#)
const CS = String.raw`
using System; using System.Text; using System.Diagnostics; using System.Drawing; using System.Drawing.Imaging;
using System.Drawing.Drawing2D; using System.Windows.Forms; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class MC {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  // A modifier left "down" (Windows key, Ctrl, Alt, Shift) turns typing into shortcuts (e.g. Win+F opens Feedback Hub):
  // release any that are held before typing, clicking or pressing a combo.
  static void ReleaseModifiers() {
    foreach (int vk in new int[] { 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x10, 0x11, 0x12 }) {
      if ((GetAsyncKeyState(vk) & 0x8000) != 0) Key((ushort)vk, true, vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5);
    }
  }

  public static void Init() { try { SetProcessDpiAwareness(2); } catch { try { SetProcessDPIAware(); } catch {} } }
  static string Q(string s) { if (s == null) return "\"\""; var b = new StringBuilder("\""); foreach (char c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append("\\u" + ((int)c).ToString("x4")); else b.Append(c); } return b.Append('"').ToString(); }

  public static string Screens() {
    var b = new StringBuilder("["); var all = Screen.AllScreens;
    for (int i = 0; i < all.Length; i++) { var r = all[i].Bounds; if (i > 0) b.Append(','); b.Append("{\"index\":" + i + ",\"x\":" + r.X + ",\"y\":" + r.Y + ",\"w\":" + r.Width + ",\"h\":" + r.Height + ",\"primary\":" + (all[i].Primary ? "true" : "false") + "}"); }
    return b.Append(']').ToString();
  }
  static Rectangle Bounds(int screen) { var all = Screen.AllScreens; if (screen < 0 || screen >= all.Length) { foreach (var s in all) if (s.Primary) return s.Bounds; return all[0].Bounds; } return all[screen].Bounds; }

  // Screenshot of one monitor (or a region of it), scaled to maxW, saved as JPEG.
  public static string Shot(int screen, int maxW, string file, int rx1, int ry1, int rx2, int ry2) {
    var r = Bounds(screen);
    var src = new Rectangle(r.X, r.Y, r.Width, r.Height);
    if (rx2 > rx1 && ry2 > ry1) src = new Rectangle(r.X + rx1, r.Y + ry1, rx2 - rx1, ry2 - ry1);
    using (var full = new Bitmap(src.Width, src.Height, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(src.X, src.Y, 0, 0, src.Size, CopyPixelOperation.SourceCopy);
      POINT c; GetCursorPos(out c);
      double scale = Math.Min(1.0, (double)maxW / src.Width);
      int w = Math.Max(1, (int)Math.Round(src.Width * scale)), h = Math.Max(1, (int)Math.Round(src.Height * scale));
      using (var outp = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
        using (var g = Graphics.FromImage(outp)) {
          g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.DrawImage(full, 0, 0, w, h);
          int cx = (int)((c.X - src.X) * scale), cy = (int)((c.Y - src.Y) * scale);   // draw the mouse pointer
          if (cx >= 0 && cy >= 0 && cx < w && cy < h) { using (var p = new Pen(Color.Red, 2)) { g.DrawLine(p, cx - 7, cy, cx + 7, cy); g.DrawLine(p, cx, cy - 7, cx, cy + 7); } }
        }
        var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), e => e.MimeType == "image/jpeg");
        var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
        outp.Save(file, enc, ps);
        return "{\"file\":" + Q(file) + ",\"w\":" + w + ",\"h\":" + h + ",\"ox\":" + src.X + ",\"oy\":" + src.Y + ",\"sw\":" + src.Width + ",\"sh\":" + src.Height + ",\"scale\":" + scale.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
      }
    }
  }

  static void Mouse(uint flags, uint data) { var i = new INPUT[1]; i[0].type = 0; i[0].u.mi.dwFlags = flags; i[0].u.mi.mouseData = data; SendInput(1, i, Marshal.SizeOf(typeof(INPUT))); }
  public static string Move(int x, int y) { SetCursorPos(x, y); return "{\"ok\":true}"; }
  public static string Click(int x, int y, string button, int count) {
    ReleaseModifiers(); SetCursorPos(x, y); System.Threading.Thread.Sleep(40);
    uint d = 0x2, u = 0x4; if (button == "right") { d = 0x8; u = 0x10; } else if (button == "middle") { d = 0x20; u = 0x40; }
    for (int k = 0; k < count; k++) { Mouse(d, 0); System.Threading.Thread.Sleep(30); Mouse(u, 0); System.Threading.Thread.Sleep(60); }
    return "{\"ok\":true}";
  }
  public static string Drag(int x, int y, int x2, int y2) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(50); Mouse(0x2, 0);
    for (int s = 1; s <= 12; s++) { SetCursorPos(x + (x2 - x) * s / 12, y + (y2 - y) * s / 12); System.Threading.Thread.Sleep(25); }
    Mouse(0x4, 0); return "{\"ok\":true}";
  }
  public static string Scroll(int x, int y, int dy, int dx) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(30);
    if (dy != 0) Mouse(0x800, unchecked((uint)(dy * 120)));
    if (dx != 0) Mouse(0x1000, unchecked((uint)(dx * 120)));
    return "{\"ok\":true}";
  }
  static void Key(ushort vk, bool up, bool ext) { var i = new INPUT[1]; i[0].type = 1; i[0].u.ki.vk = vk; i[0].u.ki.flags = (up ? 2u : 0u) | (ext ? 1u : 0u); SendInput(1, i, Marshal.SizeOf(typeof(INPUT))); }
  public static string Type(string text) {
    ReleaseModifiers(); System.Threading.Thread.Sleep(30);
    foreach (char ch in text) {
      if (ch == '\r') continue;
      if (ch == '\n') { Key(0x0D, false, false); Key(0x0D, true, false); continue; }
      if (ch == '\t') { Key(0x09, false, false); Key(0x09, true, false); continue; }
      var i = new INPUT[2]; i[0].type = 1; i[0].u.ki.scan = ch; i[0].u.ki.flags = 0x4; i[1].type = 1; i[1].u.ki.scan = ch; i[1].u.ki.flags = 0x4 | 0x2;
      SendInput(2, i, Marshal.SizeOf(typeof(INPUT))); System.Threading.Thread.Sleep(4);
    }
    return "{\"ok\":true}";
  }
  // combo like "ctrl+shift+s": press all, release in reverse
  public static string Combo(string vks, string exts) {
    var parts = vks.Split(','); var ex = exts.Split(',');
    ReleaseModifiers();
    for (int k = 0; k < parts.Length; k++) Key(ushort.Parse(parts[k]), false, ex[k] == "1");
    System.Threading.Thread.Sleep(40);
    for (int k = parts.Length - 1; k >= 0; k--) Key(ushort.Parse(parts[k]), true, ex[k] == "1");
    return "{\"ok\":true}";
  }
  public static string Cursor() { POINT p; GetCursorPos(out p); return "{\"x\":" + p.X + ",\"y\":" + p.Y + "}"; }
  public static string Windows() {
    var b = new StringBuilder("["); bool first = true; var fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); var t = sb.ToString(); if (t.Length == 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // tool windows
      RECT r; GetWindowRect(h, out r); if (r.R - r.L < 50 || r.B - r.T < 30) return true;
      uint pid; GetWindowThreadProcessId(h, out pid); string pn = ""; try { pn = Process.GetProcessById((int)pid).ProcessName; } catch {}
      if (!first) b.Append(','); first = false;
      b.Append("{\"hwnd\":" + h.ToInt64() + ",\"title\":" + Q(t) + ",\"app\":" + Q(pn) + ",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"minimized\":" + (IsIconic(h) ? "true" : "false") + ",\"active\":" + (h == fg ? "true" : "false") + "}");
      return true; }, IntPtr.Zero);
    return b.Append(']').ToString();
  }
  public static string Focus(long hwnd) {
    var h = new IntPtr(hwnd);
    if (IsIconic(h)) ShowWindow(h, 9);
    uint pid; var fgT = GetWindowThreadProcessId(GetForegroundWindow(), out pid); var me = GetCurrentThreadId();
    Key(0x12, false, false); Key(0x12, true, false);   // ALT tap lets SetForegroundWindow work
    AttachThreadInput(me, fgT, true); BringWindowToTop(h); bool ok = SetForegroundWindow(h); AttachThreadInput(me, fgT, false);
    return "{\"ok\":" + (ok ? "true" : "false") + "}";
  }
}`;

const PS_HOST = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition $env:MC_CS -ReferencedAssemblies System.Drawing, System.Windows.Forms
[MC]::Init()
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  try {
    $c = $line | ConvertFrom-Json
    $id = $c.id
    $r = switch ($c.op) {
      'screens' { [MC]::Screens() }
      'shot' { [MC]::Shot([int]$c.screen, [int]$c.maxw, [string]$c.file, [int]$c.rx1, [int]$c.ry1, [int]$c.rx2, [int]$c.ry2) }
      'move' { [MC]::Move([int]$c.x, [int]$c.y) }
      'click' { [MC]::Click([int]$c.x, [int]$c.y, [string]$c.button, [int]$c.count) }
      'drag' { [MC]::Drag([int]$c.x, [int]$c.y, [int]$c.x2, [int]$c.y2) }
      'scroll' { [MC]::Scroll([int]$c.x, [int]$c.y, [int]$c.dy, [int]$c.dx) }
      'type' { [MC]::Type([string]$c.text) }
      'combo' { [MC]::Combo([string]$c.vks, [string]$c.ext) }
      'cursor' { [MC]::Cursor() }
      'windows' { [MC]::Windows() }
      'focus' { [MC]::Focus([long]$c.hwnd) }
      default { throw "unknown op $($c.op)" }
    }
    [Console]::Out.WriteLine('{"id":' + $id + ',"ok":true,"result":' + $r + '}')
  } catch {
    $m = ($_.Exception.Message -replace '\\\\', '/' -replace '"', "'" -replace "[\\r\\n]+", ' ')
    [Console]::Out.WriteLine('{"id":' + $id + ',"ok":false,"error":"' + $m + '"}')
  }
}`;

class DesktopHelper {
  constructor(log) { this.log = log || (() => {}); this.proc = null; this.ready = null; this.waiters = new Map(); this.seq = 0; this.buf = ''; }
  start() {
    if (this.ready) return this.ready;
    if (!IS_WIN && !process.env.MC_DESKTOP_HELPER) return Promise.reject(new Error('Desktop control works on Windows (the Muse Carpathron desktop app).'));
    const cmd = process.env.MC_DESKTOP_HELPER || 'powershell.exe';
    // -EncodedCommand (UTF-16LE base64): no quoting problems with the script on the Windows command line
    const args = process.env.MC_DESKTOP_HELPER ? [] : ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS_HOST, 'utf16le').toString('base64')];
    this.ready = new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, MC_CS: CS }, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = p;
      let err = '';
      const t = setTimeout(() => reject(new Error(`desktop helper did not start: ${err.slice(-300)}`)), 30000);
      p.stderr.on('data', (d) => { err += d; });
      p.stdout.on('data', (d) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
          if (!line) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          if (j.ready) { clearTimeout(t); resolve(true); continue; }
          const w = this.waiters.get(j.id);
          if (w) { this.waiters.delete(j.id); j.ok ? w.resolve(j.result) : w.reject(new Error(j.error)); }
        }
      });
      p.on('exit', (code) => {
        clearTimeout(t);
        for (const w of this.waiters.values()) w.reject(new Error(`desktop helper stopped (${code}) ${err.slice(-200)}`));
        this.waiters.clear(); this.proc = null; this.ready = null;
        reject(new Error(`desktop helper stopped (${code}) ${err.slice(-300)}`));
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }
  async call(op, params = {}, timeoutMs = 30000) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters.delete(id); reject(new Error(`${op} timed out`)); }, timeoutMs);
      this.waiters.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.proc.stdin.write(JSON.stringify({ id, op, ...params }) + '\n');
    });
  }
  stop() { try { this.proc && this.proc.kill(); } catch {} this.proc = null; this.ready = null; }
}

// key names → Windows virtual-key codes (extended keys flagged)
const VK = { ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5B, windows: 0x5B, meta: 0x5B, cmd: 0x5B, enter: 0x0D, return: 0x0D, tab: 0x09, esc: 0x1B, escape: 0x1B, backspace: 0x08, delete: 0x2E, del: 0x2E, insert: 0x2D, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28, space: 0x20, capslock: 0x14, printscreen: 0x2C, menu: 0x5D, apps: 0x5D, volumeup: 0xAF, volumedown: 0xAE, mute: 0xAD, plus: 0xBB, minus: 0xBD, comma: 0xBC, period: 0xBE };
const EXT = new Set([0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5B, 0x5D]);
function parseKeys(keys) {
  const out = [];
  for (const raw of String(keys || '').toLowerCase().split('+').map((k) => k.trim()).filter(Boolean)) {
    let vk = VK[raw];
    if (vk === undefined && /^f([1-9]|1[0-9]|2[0-4])$/.test(raw)) vk = 0x70 + Number(raw.slice(1)) - 1;
    if (vk === undefined && /^[a-z0-9]$/.test(raw)) vk = raw.toUpperCase().charCodeAt(0);
    if (vk === undefined) throw new Error(`unknown key "${raw}" (use names like ctrl, alt, shift, win, enter, tab, esc, f5, a, 1)`);
    out.push(vk);
  }
  if (!out.length) throw new Error('no keys given');
  return { vks: out.join(','), ext: out.map((v) => (EXT.has(v) ? '1' : '0')).join(',') };
}

// ------------------------------------------------------------------ "Muse is controlling this PC" banner
let banner = null, bannerTimer = null;
function showBanner(text, onStop) {
  const e = electron();
  if (!e) return;
  try {
    if (!banner || banner.isDestroyed()) {
      const { width } = e.screen.getPrimaryDisplay().workAreaSize;
      banner = new e.BrowserWindow({ width: 380, height: 38, x: Math.round(width / 2 - 190), y: 6, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, show: false, hasShadow: false, webPreferences: { sandbox: true, contextIsolation: true } });
      banner.setAlwaysOnTop(true, 'screen-saver');
      try { banner.setContentProtection(true); } catch {}   // invisible to screenshots (the agent never sees it)
      const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:600 13px Segoe UI,sans-serif"><div style="display:flex;align-items:center;gap:10px;background:#c2410c;color:#fff;border-radius:19px;padding:8px 8px 8px 16px;box-shadow:0 2px 10px #0006"><span id="t" style="flex:1">🤖 Muse is controlling this PC</span><a href="#stop" style="background:#fff;color:#c2410c;border-radius:12px;padding:3px 12px;text-decoration:none">■ Stop</a></div></body>`;
      banner.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      banner.webContents.on('did-navigate-in-page', (_e, url) => { if (/#stop$/.test(url)) { try { banner._onStop && banner._onStop(); } catch {} hideBanner(); } });
    }
    banner._onStop = onStop;
    banner.webContents.executeJavaScript(`document.getElementById('t') && (document.getElementById('t').textContent = ${JSON.stringify('🤖 ' + text)})`).catch(() => {});
    if (!banner.isVisible()) banner.showInactive();
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, 15000);
  } catch {}
}
function hideBanner() { clearTimeout(bannerTimer); try { if (banner && !banner.isDestroyed()) { banner.destroy(); } } catch {} banner = null; }

// ------------------------------------------------------------------ Muse Browser (visible Chromium window)
class MuseBrowser {
  constructor() { this.win = null; this.scale = 1; }
  async ensure(width) {
    const e = electron();
    if (!e) throw new Error('The Muse Browser needs the Muse Carpathron desktop app.');
    if (!this.win || this.win.isDestroyed()) {
      this.win = new e.BrowserWindow({ width: width || 1280, height: 860, title: 'Muse Browser', show: false, autoHideMenuBar: true, webPreferences: { partition: 'persist:muse-browser', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      this.win.webContents.setWindowOpenHandler(({ url }) => { this.win.loadURL(url).catch(() => {}); return { action: 'deny' }; });   // popups open in the same window
      this.win.on('page-title-updated', (ev, t) => { ev.preventDefault(); this.win.setTitle(`Muse Browser — ${t}`); });
      this.win.showInactive();
    } else if (width) {
      const [, h] = this.win.getContentSize(); this.win.setContentSize(width, h);
    }
    return this.win;
  }
  wc() { if (!this.win || this.win.isDestroyed()) throw new Error('The Muse Browser is not open — use browser_view open with a url first.'); return this.win.webContents; }
  async waitLoad(ms = 20000) {
    const wc = this.wc();
    if (!wc.isLoading()) return;
    await new Promise((r) => { const t = setTimeout(r, ms); wc.once('did-stop-loading', () => { clearTimeout(t); r(); }); });
  }
  async shot(maxW = 1280) {
    const wc = this.wc();
    // a minimized or hidden window cannot be captured: bring it back without stealing focus
    if (this.win.isMinimized()) this.win.restore();
    if (!this.win.isVisible()) this.win.showInactive();
    await new Promise((r) => setTimeout(r, 250));
    let img = await wc.capturePage();
    const vw = await wc.executeJavaScript('window.innerWidth').catch(() => img.getSize().width);
    const size = img.getSize();
    if (size.width > maxW) img = img.resize({ width: maxW, quality: 'good' });
    const out = img.getSize();
    this.scale = vw / out.width;   // screenshot px → CSS px
    return { buffer: img.toJPEG(80), w: out.width, h: out.height };
  }
  async info() { const wc = this.wc(); return `${wc.getTitle()} — ${wc.getURL()}`; }
}
const ELEMENTS_JS = `(() => {
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[onclick],[contenteditable=true],label[for]';
  const out = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    el.setAttribute('data-muse-index', String(n));
    out.push({ i: n++, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', label, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    if (n >= 120) break;
  }
  return out;
})()`;

const desktop = new DesktopHelper();
const browser = new MuseBrowser();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function desktopShot(ctx, args = {}) {
  const dir = path.join(ctx.dataDir || os.tmpdir(), 'screens');
  fs.mkdirSync(dir, { recursive: true });
  // keep only the last 40 screenshots (they are temporary)
  try { const fl = fs.readdirSync(dir).sort(); for (const f of fl.slice(0, Math.max(0, fl.length - 40))) fs.unlinkSync(path.join(dir, f)); } catch {}
  const file = path.join(dir, `screen-${Date.now()}.jpg`);
  const prev = ctx.computerState || {};
  let rx = [0, 0, 0, 0];
  if (Array.isArray(args.region) && args.region.length === 4 && prev.scale) rx = args.region.map((v) => Math.round(Number(v) / prev.scale));
  const r = await desktop.call('shot', { screen: Number.isInteger(args.screen) ? args.screen : -1, maxw: rx[2] ? 1600 : 1366, file, rx1: rx[0], ry1: rx[1], rx2: rx[2], ry2: rx[3] });
  if (!rx[2]) Object.assign(ctx.computerState = ctx.computerState || {}, { scale: r.scale, ox: r.ox, oy: r.oy, w: r.w, h: r.h, screen: args.screen });
  const buffer = fs.readFileSync(r.file);
  if (ctx.onPhoto) ctx.onPhoto({ path: r.file, buffer, mime: 'image/jpeg', source: rx[2] ? 'zoomed screen region' : 'screenshot of the desktop' });
  return `${rx[2] ? 'Zoomed region' : 'Screenshot'}: ${r.w}x${r.h} px (screen ${r.sw}x${r.sh}${r.scale < 1 ? `, scaled ${Math.round(r.scale * 100)}%` : ''}). Use the pixel coordinates of this picture for computer_act${rx[2] ? ' — careful: they refer to the last FULL screenshot, not this zoom' : ''}.`;
}
function toScreen(ctx, x, y) {
  const st = ctx.computerState;
  if (!st || !st.scale) throw new Error('Take a screenshot first (computer_view screenshot), then use its coordinates.');
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw new Error('x and y are needed');
  return { x: Math.round(st.ox + Number(x) / st.scale), y: Math.round(st.oy + Number(y) / st.scale) };
}

async function findStartMenuApp(name) {
  const roots = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'), path.join(os.homedir(), 'Desktop'), path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  const want = name.toLowerCase();
  let best = null;
  const walk = (d, depth) => {
    if (depth > 4) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(lnk|url|appref-ms)$/i.test(e.name)) {
        const base = e.name.replace(/\.(lnk|url|appref-ms)$/i, '').toLowerCase();
        const score = base === want ? 3 : base.startsWith(want) ? 2 : base.includes(want) ? 1 : 0;
        if (score && (!best || score > best.score || (score === best.score && base.length < best.len))) best = { path: p, score, len: base.length };
      }
    }
  };
  for (const r of roots) walk(r, 0);
  return best && best.path;
}

async function execComputer(name, args, ctx) {
  const onStop = ctx.requestStop;
  if (name === 'computer_view' || name === 'computer_act') {
    if (name === 'computer_act') showBanner('Muse is controlling this PC', onStop);
    const a = args.action;
    if (name === 'computer_view') {
      if (a === 'screenshot') return desktopShot(ctx, args);
      if (a === 'screens') return JSON.stringify(await desktop.call('screens'), null, 1);
      if (a === 'cursor') return JSON.stringify(await desktop.call('cursor'));
      if (a === 'list_windows') {
        const list = await desktop.call('windows');
        const st = ctx.computerState;
        return list.map((w) => `${w.active ? '▶ ' : ''}"${w.title}" — ${w.app}${w.minimized ? ' (minimized)' : ''}${st && st.scale ? ` at ${Math.round((w.x - st.ox) * st.scale)},${Math.round((w.y - st.oy) * st.scale)} size ${Math.round(w.w * st.scale)}x${Math.round(w.h * st.scale)} (screenshot px)` : ''}`).join('\n') || 'No windows.';
      }
      throw new Error(`unknown action ${a}`);
    }
    let did = '';
    switch (a) {
      case 'click': case 'double_click': case 'right_click': case 'middle_click': {
        const p = toScreen(ctx, args.x, args.y);
        await desktop.call('click', { ...p, button: a === 'right_click' ? 'right' : a === 'middle_click' ? 'middle' : 'left', count: a === 'double_click' ? 2 : 1 });
        did = `${a.replace('_', ' ')} at ${args.x},${args.y}`; break;
      }
      case 'move': { const p = toScreen(ctx, args.x, args.y); await desktop.call('move', p); did = `moved to ${args.x},${args.y}`; break; }
      case 'drag': {
        const p = toScreen(ctx, args.x, args.y), q = toScreen(ctx, args.x2, args.y2);
        await desktop.call('drag', { x: p.x, y: p.y, x2: q.x, y2: q.y }); did = `dragged ${args.x},${args.y} → ${args.x2},${args.y2}`; break;
      }
      case 'scroll': {
        const st = ctx.computerState || {};
        const p = Number.isFinite(Number(args.x)) ? toScreen(ctx, args.x, args.y) : toScreen(ctx, (st.w || 1000) / 2, (st.h || 700) / 2);
        const n = Math.max(1, Math.min(30, Number(args.amount) || 3));
        const dir = args.direction || 'down';
        await desktop.call('scroll', { ...p, dy: dir === 'up' ? n : dir === 'down' ? -n : 0, dx: dir === 'right' ? n : dir === 'left' ? -n : 0 });
        did = `scrolled ${dir} ${n}`; break;
      }
      case 'type': {
        const t = String(args.text ?? '');
        if (!t) throw new Error('text is empty');
        await desktop.call('type', { text: t }, 120000); did = `typed ${t.length} characters`; break;
      }
      case 'key': { await desktop.call('combo', parseKeys(args.keys || args.text)); did = `pressed ${args.keys || args.text}`; break; }
      case 'focus_window': {
        const q = String(args.window || '').toLowerCase();
        if (!q) throw new Error('window (part of its title or app name) is needed');
        const list = await desktop.call('windows');
        const w = list.find((x) => x.title.toLowerCase() === q) || list.find((x) => x.title.toLowerCase().includes(q)) || list.find((x) => x.app.toLowerCase().includes(q));
        if (!w) throw new Error(`No window matches "${args.window}". Open windows: ${list.map((x) => `"${x.title}"`).slice(0, 20).join(', ')}`);
        await desktop.call('focus', { hwnd: w.hwnd }); did = `focused "${w.title}"`; break;
      }
      case 'open_app': {
        const app = String(args.app || '').trim();
        if (!app) throw new Error('app is needed');
        let target = app;
        if (!/[\\/]/.test(app) && !/\.(exe|bat|cmd|lnk|msc)$/i.test(app) && !/^[a-z]+:/i.test(app)) target = (await findStartMenuApp(app)) || app;
        const ps = `Start-Process -FilePath ${JSON.stringify(target).replace(/`/g, '``')}${args.args ? ` -ArgumentList ${JSON.stringify(String(args.args))}` : ''}`;
        const before = new Set((await desktop.call('windows').catch(() => [])).map((w) => w.hwnd));
        await new Promise((resolve, reject) => {
          const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
          let err = ''; p.stderr.on('data', (d) => (err += d));
          p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`could not open "${app}": ${err.trim().split('\n')[0]}`))));
          p.on('error', reject);
        });
        // wait for its window, then bring it to the front so typing goes into it
        const want = path.basename(app).replace(/\.(exe|lnk)$/i, '').toLowerCase();
        let win = null;
        for (let k = 0; k < 20 && !win; k++) {
          await sleep(500);
          const list = await desktop.call('windows').catch(() => []);
          win = list.find((w) => !before.has(w.hwnd) && (w.app.toLowerCase().includes(want) || w.title.toLowerCase().includes(want)))
            || (k >= 6 ? list.find((w) => !before.has(w.hwnd) && !/muse carpathron/i.test(w.title)) : null);
        }
        if (win) { await desktop.call('focus', { hwnd: win.hwnd }).catch(() => {}); await sleep(400); }
        did = win ? `opened ${target} — window "${win.title}" is in front` : `started ${target} (no new window seen yet: take a screenshot, it may still be loading or reuse an open window)`; break;
      }
      case 'wait': await sleep(Math.max(0.2, Math.min(30, Number(args.seconds) || 1)) * 1000); did = `waited ${args.seconds || 1}s`; break;
      default: throw new Error(`unknown action ${a}`);
    }
    if (args.screenshot === false) return `Done: ${did}.`;
    await sleep(a === 'type' || a === 'key' ? 350 : 500);
    return `Done: ${did}.\n${await desktopShot(ctx, { screen: ctx.computerState && ctx.computerState.screen })}`;
  }

  // ---------------- Muse Browser
  const shotOut = async (prefix) => {
    const s = await browser.shot();
    const dir = path.join(ctx.dataDir || os.tmpdir(), 'screens');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `browser-${Date.now()}.jpg`);
    fs.writeFileSync(file, s.buffer);
    if (ctx.onPhoto) ctx.onPhoto({ path: file, buffer: s.buffer, mime: 'image/jpeg', source: 'Muse Browser screenshot' });
    return `${prefix}${prefix ? '\n' : ''}Page: ${await browser.info()}\nScreenshot ${s.w}x${s.h} px (use these coordinates, or element indexes from browser_view elements).`;
  };
  if (name === 'browser_view') {
    const a = args.action;
    if (a === 'open') {
      let url = String(args.url || '').trim();
      if (!url) throw new Error('url is needed');
      if (!/^[a-z]+:/i.test(url)) url = /^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(url) ? `http://${url}` : (fs.existsSync(url) ? require('url').pathToFileURL(path.resolve(url)).href : `https://${url}`);
      const win = await browser.ensure(Number(args.width) || undefined);
      let note = '';
      await win.loadURL(url).catch((e) => { note = `Loading reported: ${e.message}`; });
      await browser.waitLoad();
      return shotOut(note);
    }
    if (a === 'close') { if (browser.win && !browser.win.isDestroyed()) browser.win.destroy(); return 'Muse Browser closed.'; }
    const wc = browser.wc();
    if (a === 'screenshot') return shotOut('');
    if (a === 'text') { const t = await wc.executeJavaScript('document.body ? document.body.innerText : ""'); return `Page: ${await browser.info()}\n\n${String(t).slice(0, 30000)}`; }
    if (a === 'elements') {
      const els = await wc.executeJavaScript(ELEMENTS_JS);
      const sc = browser.scale || 1;
      return `Page: ${await browser.info()}\nVisible interactive elements (index · type · label · position in screenshot px):\n` + els.map((e) => `[${e.i}] ${e.tag}${e.type ? `(${e.type})` : ''} "${e.label}" @ ${Math.round(e.x / sc)},${Math.round(e.y / sc)}`).join('\n');
    }
    if (a === 'back') { if (wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack()) (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack()); await sleep(300); await browser.waitLoad(); return shotOut('Went back.'); }
    if (a === 'forward') { if (wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward()) (wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward()); await sleep(300); await browser.waitLoad(); return shotOut('Went forward.'); }
    if (a === 'reload') { wc.reload(); await sleep(300); await browser.waitLoad(); return shotOut('Reloaded.'); }
    if (a === 'scroll') {
      const n = Math.max(1, Math.min(20, Number(args.amount) || 3));
      await wc.executeJavaScript(`window.scrollBy(0, ${args.direction === 'up' ? -1 : 1} * ${n} * Math.round(innerHeight * 0.3))`);
      return shotOut(`Scrolled ${args.direction || 'down'}.`);
    }
    throw new Error(`unknown action ${a}`);
  }
  if (name === 'browser_act') {
    const wc = browser.wc();
    const a = args.action;
    const point = async () => {
      if (Number.isInteger(args.index)) {
        const p = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-muse-index="${Number(args.index)}"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        if (!p) throw new Error(`No element with index ${args.index} — run browser_view elements again (the page changed).`);
        return p;
      }
      if (!Number.isFinite(Number(args.x))) throw new Error('index (from browser_view elements) or x,y is needed');
      const sc = browser.scale || 1;
      return { x: Math.round(Number(args.x) * sc), y: Math.round(Number(args.y) * sc) };
    };
    const mouse = async (p, count = 1) => {
      wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
      for (let k = 1; k <= count; k++) {
        wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: k });
        wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: k });
      }
    };
    let did = '';
    switch (a) {
      case 'click': case 'double_click': { const p = await point(); await mouse(p, a === 'double_click' ? 2 : 1); did = `clicked ${Number.isInteger(args.index) ? `element [${args.index}]` : `${args.x},${args.y}`}`; break; }
      case 'hover': { const p = await point(); wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); did = 'hovered'; break; }
      case 'type': {
        const t = String(args.text ?? '');
        if (Number.isInteger(args.index) || Number.isFinite(Number(args.x))) { await mouse(await point()); await sleep(120); }
        if (args.clear) { await wc.executeJavaScript(`(() => { const el = document.activeElement; if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el && el.isContentEditable) el.textContent = ''; })()`); }
        if (t) await wc.insertText(t);
        did = `typed ${t.length} characters`; break;
      }
      case 'key': {
        const parts = String(args.keys || args.text || '').split('+').map((k) => k.trim()).filter(Boolean);
        if (!parts.length) throw new Error('keys is needed');
        const mods = parts.slice(0, -1).map((m) => ({ ctrl: 'control', control: 'control', alt: 'alt', shift: 'shift', cmd: 'meta', win: 'meta', meta: 'meta' }[m.toLowerCase()] || m.toLowerCase()));
        let key = parts[parts.length - 1];
        const named = { enter: 'Return', return: 'Return', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
        key = named[key.toLowerCase()] || (key.length === 1 ? key : key[0].toUpperCase() + key.slice(1));
        wc.focus();   // key events go to the focused page
        wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
        if (key.length === 1 && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: key });
        if (key === 'Return' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
        did = `pressed ${args.keys || args.text}`; break;
      }
      case 'select': {
        if (!Number.isInteger(args.index)) throw new Error('index of the dropdown is needed');
        const ok = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-muse-index="${Number(args.index)}"]'); if (!el || el.tagName !== 'SELECT') return 'not a dropdown'; const v = ${JSON.stringify(String(args.value || ''))}; const o = [...el.options].find((o) => o.value === v || o.text.trim().toLowerCase() === v.toLowerCase()); if (!o) return 'options: ' + [...el.options].map((o) => o.text.trim()).join(' | '); el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
        if (ok !== 'ok') throw new Error(ok);
        did = `selected "${args.value}"`; break;
      }
      case 'eval': {
        const r = await wc.executeJavaScript(String(args.js || ''), true);
        let out; try { out = JSON.stringify(r, null, 1); } catch { out = String(r); }
        return `Result: ${String(out).slice(0, 20000)}`;
      }
      default: throw new Error(`unknown action ${a}`);
    }
    await sleep(600);
    await browser.waitLoad(8000);
    return shotOut(`Done: ${did}.`);
  }
  throw new Error(`unknown tool ${name}`);
}

module.exports = { COMPUTER_TOOLS, COMPUTER_NAMES, execComputer, parseKeys, desktop, browser, hideBanner, findStartMenuApp, CS, PS_HOST };
