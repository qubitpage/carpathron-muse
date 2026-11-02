/* Carpathron Remote - shared input code for rdinput.exe and rdsvc.exe (SendInput, DPI, Unicode text) */
#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef HRESULT (WINAPI *SetAwareness)(int);
typedef BOOL (WINAPI *SetCtx)(HANDLE);

static void dpi(void) {
  HMODULE u = GetModuleHandleA("user32.dll");
  SetCtx c = u ? (SetCtx)GetProcAddress(u, "SetProcessDpiAwarenessContext") : NULL;
  if (c && c((HANDLE)-4)) return; /* per-monitor v2 */
  HMODULE s = LoadLibraryA("shcore.dll");
  SetAwareness a = s ? (SetAwareness)GetProcAddress(s, "SetProcessDpiAwareness") : NULL;
  if (a && a(2) == S_OK) return;
  SetProcessDPIAware();
}
static void sendone(INPUT *in) { SendInput(1, in, sizeof(INPUT)); }
static void mouse(DWORD flags, LONG dx, LONG dy, DWORD data) {
  INPUT in; ZeroMemory(&in, sizeof in); in.type = INPUT_MOUSE;
  in.mi.dwFlags = flags; in.mi.dx = dx; in.mi.dy = dy; in.mi.mouseData = data; sendone(&in);
}
static void move(int x, int y) {
  int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
  int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN), vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (vw <= 1 || vh <= 1) return;
  SetCursorPos(x, y); /* exact position (works for every monitor layout) */
  LONG nx = (LONG)((x - vx) * 65535.0 / (vw - 1) + 0.5), ny = (LONG)((y - vy) * 65535.0 / (vh - 1) + 0.5);
  mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, nx, ny, 0); /* so apps see a real move */
}
static void button(int b, int down) {
  DWORD f; DWORD data = 0;
  if (b == 0) f = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  else if (b == 2) f = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  else if (b == 1) f = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  else { f = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; data = b == 3 ? XBUTTON1 : XBUTTON2; }
  mouse(f, 0, 0, data);
}
static void key(int vk, int down, int ext) {
  INPUT in; ZeroMemory(&in, sizeof in); in.type = INPUT_KEYBOARD;
  in.ki.wVk = (WORD)vk; in.ki.wScan = (WORD)MapVirtualKeyW((UINT)vk, MAPVK_VK_TO_VSC);
  in.ki.dwFlags = (down ? 0 : KEYEVENTF_KEYUP) | (ext ? KEYEVENTF_EXTENDEDKEY : 0); sendone(&in);
}
static int b64v(int c) {
  if (c >= 'A' && c <= 'Z') return c - 'A'; if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52; if (c == '+') return 62; if (c == '/') return 63; return -1;
}
static void text(const char *b64) {
  size_t n = strlen(b64); unsigned char *buf = malloc(n + 4); size_t o = 0; int acc = 0, bits = 0;
  if (!buf) return;
  for (size_t i = 0; i < n; i++) { int v = b64v((unsigned char)b64[i]); if (v < 0) continue; acc = (acc << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; buf[o++] = (unsigned char)((acc >> bits) & 0xFF); } }
  int wn = MultiByteToWideChar(CP_UTF8, 0, (char *)buf, (int)o, NULL, 0);
  WCHAR *w = malloc(sizeof(WCHAR) * (wn + 1));
  if (w) {
    MultiByteToWideChar(CP_UTF8, 0, (char *)buf, (int)o, w, wn);
    for (int i = 0; i < wn; i++) {
      if (w[i] == L'\r') continue;
      if (w[i] == L'\n') { key(VK_RETURN, 1, 0); key(VK_RETURN, 0, 0); continue; }
      INPUT in[2]; ZeroMemory(in, sizeof in);
      in[0].type = in[1].type = INPUT_KEYBOARD; in[0].ki.wScan = in[1].ki.wScan = w[i];
      in[0].ki.dwFlags = KEYEVENTF_UNICODE; in[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
      SendInput(2, in, sizeof(INPUT));
    }
    free(w);
  }
  free(buf);
}

/* one helper per installed app: names come from the app's folder (several Carpathron apps can be installed side by side) */
static unsigned long dirId(const WCHAR *dir) {
  unsigned long h = 2166136261u; for (const WCHAR *p = dir; *p; p++) { WCHAR c = *p; if (c >= L'A' && c <= L'Z') c += 32; h = (h ^ (unsigned long)c) * 16777619u; }
  return h & 0xFFFFFFFFu;
}
