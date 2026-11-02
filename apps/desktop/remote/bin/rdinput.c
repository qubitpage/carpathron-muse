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
#include "rdcore.h"
static volatile LONG viaAgent = 0; static HANDLE agentPipe = INVALID_HANDLE_VALUE; static CRITICAL_SECTION alock;
static int selfElevated = 0, lastElev = -1;
static int elevatedPid(DWORD pid) {
  int r = 0; HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid), t = NULL;
  if (!h) return GetLastError() == ERROR_ACCESS_DENIED; /* a protected or SYSTEM program: also out of reach */
  if (OpenProcessToken(h, TOKEN_QUERY, &t)) { TOKEN_ELEVATION e; DWORD n = 0; if (GetTokenInformation(t, TokenElevation, &e, sizeof e, &n)) r = e.TokenIsElevated != 0; CloseHandle(t); }
  CloseHandle(h); return r;
}
static void checkFront(void) {
  if (selfElevated || viaAgent) return;
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
    if (viaAgent) { last = 0; Sleep(700); continue; } /* the agent reports it (and can show it) */
    if (secure != last) { last = secure; printf("secure %d\n", secure); }
    Sleep(700);
  }
  return 0;
}
/* ---- the full control agent (rdsvc.exe, installed as a service): used when it is there and really ours */
static WCHAR myDir[MAX_PATH];
static int serverIsOurs(HANDLE p) {
  ULONG pid = 0; if (!GetNamedPipeServerProcessId(p, &pid)) return 0;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid); if (!h) return 0;
  WCHAR img[MAX_PATH], want[MAX_PATH]; DWORD n = MAX_PATH; int ok = 0;
  if (QueryFullProcessImageNameW(h, 0, img, &n)) { wsprintfW(want, L"%s\\rdsvc.exe", myDir); ok = lstrcmpiW(img, want) == 0; }
  CloseHandle(h); return ok;
}
static DWORD WINAPI agentReader(LPVOID u) {
  HANDLE p = (HANDLE)u; static char buf[1 << 16]; DWORD got;
  while (ReadFile(p, buf, sizeof buf, &got, NULL) && got) fwrite(buf, 1, got, stdout);
  EnterCriticalSection(&alock); if (agentPipe == p) { agentPipe = INVALID_HANDLE_VALUE; InterlockedExchange(&viaAgent, 0); CloseHandle(p); printf("agent 0\n"); } LeaveCriticalSection(&alock);
  return 0;
}
static void tryAgent(void) {
  static DWORD lastTry = 0; DWORD now = GetTickCount();
  if (viaAgent || (lastTry && now - lastTry < 5000)) return; lastTry = now;
  DWORD sid = 0; ProcessIdToSessionId(GetCurrentProcessId(), &sid);
  WCHAR name[96]; wsprintfW(name, L"\\\\.\\pipe\\CarpathronRemoteAgent-%08lx-%lu", dirId(myDir), sid);
  HANDLE p = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, NULL);
  if (p == INVALID_HANDLE_VALUE) return;
  if (!serverIsOurs(p)) { CloseHandle(p); return; }
  EnterCriticalSection(&alock); agentPipe = p; InterlockedExchange(&viaAgent, 1); LeaveCriticalSection(&alock);
  CreateThread(NULL, 0, agentReader, p, 0, NULL);
}
static int toAgent(const char *line) {
  int ok = 0; EnterCriticalSection(&alock);
  if (viaAgent && agentPipe != INVALID_HANDLE_VALUE) { DWORD w; size_t n = strlen(line); ok = WriteFile(agentPipe, line, (DWORD)n, &w, NULL) && WriteFile(agentPipe, "\n", 1, &w, NULL); }
  LeaveCriticalSection(&alock); return ok;
}
int main(void) {
  static char line[65536];
  dpi();
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("ready\n");
  { HANDLE t = NULL; if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &t)) { TOKEN_ELEVATION e; DWORD n = 0; if (GetTokenInformation(t, TokenElevation, &e, sizeof e, &n)) selfElevated = e.TokenIsElevated != 0; CloseHandle(t); } }
  InitializeCriticalSection(&alock);
  GetModuleFileNameW(NULL, myDir, MAX_PATH); { WCHAR *z = wcsrchr(myDir, L'\\'); if (z) *z = 0; }
  tryAgent();
  CreateThread(NULL, 0, watchDesktop, NULL, 0, NULL);
  while (fgets(line, sizeof line, stdin)) {
    char *p = line; size_t L = strlen(p); while (L && (p[L - 1] == '\n' || p[L - 1] == '\r')) p[--L] = 0;
    if (p[0] == 'Q') return 0;
    tryAgent();
    if (viaAgent && toAgent(p)) continue;
    if (p[0] == 'S') { printf("nosas\n"); continue; }
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
