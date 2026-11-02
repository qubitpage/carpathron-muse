/* Carpathron Remote - input helper for Windows (no PowerShell).
   Reads one command per line on stdin and puts it into this PC with SendInput:
     M x y        move the mouse to physical pixel x,y of the virtual desktop
     B b d        mouse button b (0 left, 1 middle, 2 right, 3 back, 4 forward), d 1 = down, 0 = up
     W dy dx      wheel (120 = one notch)
     K vk d e     key: virtual-key code, d 1 = down / 0 = up, e 1 = extended key
     T base64     type this UTF-8 text
     Q            quit
   Prints "ready" when it starts, and these notes for the app:
     secure 1 / secure 0   Windows switched to / away from its secure desktop (administrator prompt, lock screen,
                           Ctrl+Alt+Del): a normal program can neither see nor click it
     elevated 1 / 0        the window in front belongs to a program running as administrator: Windows blocks
                           clicks and keys from a program that is not (UIPI) */
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
static int selfElevated = 0, lastElev = -1;
static int elevatedPid(DWORD pid) {
  int r = 0; HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid), t = NULL;
  if (!h) return GetLastError() == ERROR_ACCESS_DENIED; /* a protected or SYSTEM program: also out of reach */
  if (OpenProcessToken(h, TOKEN_QUERY, &t)) { TOKEN_ELEVATION e; DWORD n = 0; if (GetTokenInformation(t, TokenElevation, &e, sizeof e, &n)) r = e.TokenIsElevated != 0; CloseHandle(t); }
  CloseHandle(h); return r;
}
static void checkFront(void) {
  if (selfElevated) return;
  HWND w = GetForegroundWindow(); DWORD pid = 0; if (!w) return; GetWindowThreadProcessId(w, &pid);
  int e = pid ? elevatedPid(pid) : 0;
  if (e != lastElev) { lastElev = e; printf("elevated %d\n", e); }
}
static DWORD WINAPI watchDesktop(LPVOID unused) {
  int last = 0; (void)unused;
  for (;;) {
    int secure = 0; HDESK d = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    if (!d) secure = 1;
    else { WCHAR name[64] = {0}; DWORD n = 0; if (GetUserObjectInformationW(d, UOI_NAME, name, sizeof name, &n) && lstrcmpiW(name, L"Default")) secure = 1; CloseDesktop(d); }
    if (secure != last) { last = secure; printf("secure %d\n", secure); }
    Sleep(700);
  }
  return 0;
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
int main(void) {
  static char line[65536];
  dpi();
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("ready\n");
  { HANDLE t = NULL; if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &t)) { TOKEN_ELEVATION e; DWORD n = 0; if (GetTokenInformation(t, TokenElevation, &e, sizeof e, &n)) selfElevated = e.TokenIsElevated != 0; CloseHandle(t); } }
  CreateThread(NULL, 0, watchDesktop, NULL, 0, NULL);
  while (fgets(line, sizeof line, stdin)) {
    char *p = line; size_t L = strlen(p); while (L && (p[L - 1] == '\n' || p[L - 1] == '\r')) p[--L] = 0;
    int a = 0, b = 0, c = 0;
    switch (p[0]) {
      case 'M': if (sscanf(p + 1, "%d %d", &a, &b) == 2) move(a, b); break;
      case 'B': if (sscanf(p + 1, "%d %d", &a, &b) == 2) { if (b) checkFront(); button(a, b); } break;
      case 'W': if (sscanf(p + 1, "%d %d", &a, &b) == 2) { if (a) mouse(MOUSEEVENTF_WHEEL, 0, 0, (DWORD)a); if (b) mouse(MOUSEEVENTF_HWHEEL, 0, 0, (DWORD)b); } break;
      case 'K': if (sscanf(p + 1, "%d %d %d", &a, &b, &c) >= 2) { if (b) checkFront(); key(a, b, c); } break;
      case 'T': if (p[1] == ' ') text(p + 2); break;
      case 'Q': return 0;
    }
  }
  return 0;
}
