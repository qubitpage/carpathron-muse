/* Carpathron Remote - full control helper for Windows (what lets remote help work like the big remote tools).

   rdsvc.exe install     (installer, as administrator) register + start the "Carpathron Remote Helper" service
   rdsvc.exe uninstall   (uninstaller) stop + remove it
   rdsvc.exe             run by Windows as the service (LocalSystem, session 0)
   rdsvc.exe agent       started BY THE SERVICE in the signed-in user's session with SYSTEM rights

   The agent can do what a normal program cannot:
     - click and type into programs running as administrator (Task Manager, installers, admin consoles)
     - see and answer the administrator prompt (UAC), the lock / sign-in screen and Ctrl+Alt+Del (secure desktop)
     - send Ctrl+Alt+Del
   Security:
     - the agent listens on \\.\pipe\CarpathronRemoteAgent-<session>, readable only by SYSTEM, administrators and the
       signed-in (interactive) user, one client at a time;
     - it only accepts a client whose program file is rdinput.exe in the agent's own folder. The installer puts both in
       Program Files, which only administrators can change; rdinput.exe in turn only talks to an agent whose program is
       rdsvc.exe in its own folder;
     - rdinput.exe is started by Carpathron Remote only for a remote session the person at this PC allowed.
   Agent protocol: the same lines as rdinput.exe (M B W K T Q) plus
     S              Ctrl+Alt+Del (SendSAS)
   and it writes:   agent 1 | secure 0/1 | F <base64 jpeg of the screen, only while the secure desktop is shown> */
#include "rdcore.h"
#include <wtsapi32.h>
#include <sddl.h>
#include <stdarg.h>
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

static WCHAR selfPath[MAX_PATH], selfDir[MAX_PATH], SVC_NAME[64], SVC_SHOW[96];
static void paths(void) {
  GetModuleFileNameW(NULL, selfPath, MAX_PATH);
  lstrcpyW(selfDir, selfPath); WCHAR *s = wcsrchr(selfDir, L'\\'); if (s) *s = 0;
  wsprintfW(SVC_NAME, L"CarpathronRemoteHelper_%08lx", dirId(selfDir)); wsprintfW(SVC_SHOW, L"Carpathron Remote Helper (%08lx)", dirId(selfDir));
}

/* a small log for support: C:\\ProgramData\\Carpathron Remote Helper.log (kept under 1 MB) */
static void slog(const char *fmt, ...) {
  WCHAR p[MAX_PATH]; if (!GetEnvironmentVariableW(L"ProgramData", p, MAX_PATH)) lstrcpyW(p, L"C:\\ProgramData");
  lstrcatW(p, L"\\Carpathron Remote Helper.log");
  WIN32_FILE_ATTRIBUTE_DATA fa; if (GetFileAttributesExW(p, GetFileExInfoStandard, &fa) && fa.nFileSizeLow > (1 << 20)) DeleteFileW(p);
  HANDLE f = CreateFileW(p, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, 0, NULL); if (f == INVALID_HANDLE_VALUE) return;
  char b[600]; SYSTEMTIME t; GetLocalTime(&t); int n = wsprintfA(b, "%04d-%02d-%02d %02d:%02d:%02d ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
  va_list a; va_start(a, fmt); n += wvsprintfA(b + n, fmt, a); va_end(a); b[n++] = '\r'; b[n++] = '\n';
  DWORD w; WriteFile(f, b, n, &w, NULL); CloseHandle(f);
}

/* ------------------------------------------------------------------ install / uninstall */
static int stopAndDelete(SC_HANDLE scm) {
  SC_HANDLE s = OpenServiceW(scm, SVC_NAME, SERVICE_ALL_ACCESS); if (!s) return 0;
  SERVICE_STATUS st; ControlService(s, SERVICE_CONTROL_STOP, &st);
  for (int i = 0; i < 50; i++) { if (QueryServiceStatus(s, &st) && st.dwCurrentState == SERVICE_STOPPED) break; Sleep(100); }
  DeleteService(s); CloseServiceHandle(s); return 1;
}
static int install(void) {
  SC_HANDLE scm = OpenSCManagerW(NULL, NULL, SC_MANAGER_ALL_ACCESS);
  if (!scm) { printf("install: needs administrator (%lu)\n", GetLastError()); return 1; }
  stopAndDelete(scm); Sleep(300);
  WCHAR cmd[MAX_PATH + 4]; wsprintfW(cmd, L"\"%s\"", selfPath);
  SC_HANDLE s = CreateServiceW(scm, SVC_NAME, SVC_SHOW, SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START,
                               SERVICE_ERROR_NORMAL, cmd, NULL, NULL, NULL, NULL, NULL);
  if (!s) { printf("install: CreateService failed (%lu)\n", GetLastError()); CloseServiceHandle(scm); return 1; }
  SERVICE_DESCRIPTIONW d; d.lpDescription = L"Lets Carpathron Remote control administrator windows, the administrator prompt and the sign-in screen during a remote session you allowed.";
  ChangeServiceConfig2W(s, SERVICE_CONFIG_DESCRIPTION, &d);
  SC_ACTION acts[3] = { { SC_ACTION_RESTART, 2000 }, { SC_ACTION_RESTART, 5000 }, { SC_ACTION_RESTART, 30000 } };
  SERVICE_FAILURE_ACTIONSW fa; ZeroMemory(&fa, sizeof fa); fa.dwResetPeriod = 3600; fa.cActions = 3; fa.lpsaActions = acts;
  ChangeServiceConfig2W(s, SERVICE_CONFIG_FAILURE_ACTIONS, &fa);
  /* Ctrl+Alt+Del from a service: Windows policy SoftwareSASGeneration (1 = services); never lower an existing value */
  HKEY k; if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", 0, NULL, 0, KEY_READ | KEY_WRITE, NULL, &k, NULL) == ERROR_SUCCESS) {
    DWORD v = 0, n = sizeof v, t = 0;
    if (RegQueryValueExW(k, L"SoftwareSASGeneration", NULL, &t, (BYTE *)&v, &n) != ERROR_SUCCESS || !(v & 1)) { v |= 1; RegSetValueExW(k, L"SoftwareSASGeneration", 0, REG_DWORD, (BYTE *)&v, sizeof v); }
    RegCloseKey(k);
  }
  StartServiceW(s, 0, NULL);
  CloseServiceHandle(s); CloseServiceHandle(scm); printf("installed\n"); return 0;
}
static int uninstall(void) {
  SC_HANDLE scm = OpenSCManagerW(NULL, NULL, SC_MANAGER_ALL_ACCESS);
  if (!scm) { printf("uninstall: needs administrator\n"); return 1; }
  stopAndDelete(scm); CloseServiceHandle(scm); printf("removed\n"); return 0;
}

/* ------------------------------------------------------------------ the service: keeps one agent in the console session */
static SERVICE_STATUS_HANDLE ssh; static SERVICE_STATUS sst; static HANDLE stopEv; static HANDLE agentProc; static DWORD agentSession = (DWORD)-1;
static CRITICAL_SECTION agentLock;
static void setState(DWORD s) { sst.dwCurrentState = s; SetServiceStatus(ssh, &sst); }
static void killAgent(void) { if (agentProc) { TerminateProcess(agentProc, 0); CloseHandle(agentProc); agentProc = NULL; } agentSession = (DWORD)-1; }
static void ensureAgent(void) {
  EnterCriticalSection(&agentLock);
  DWORD sid = WTSGetActiveConsoleSessionId();
  if (agentProc && WaitForSingleObject(agentProc, 0) == WAIT_TIMEOUT && agentSession == sid) { LeaveCriticalSection(&agentLock); return; }
  killAgent();
  if (sid == 0xFFFFFFFF) { LeaveCriticalSection(&agentLock); return; }
  HANDLE me = NULL, tok = NULL;
  if (OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, &me) && DuplicateTokenEx(me, TOKEN_ALL_ACCESS, NULL, SecurityImpersonation, TokenPrimary, &tok)
      && SetTokenInformation(tok, TokenSessionId, &sid, sizeof sid)) {
    WCHAR cmd[MAX_PATH + 16]; wsprintfW(cmd, L"\"%s\" agent", selfPath);
    STARTUPINFOW si; ZeroMemory(&si, sizeof si); si.cb = sizeof si; si.lpDesktop = L"winsta0\\default";
    PROCESS_INFORMATION pi;
    if (CreateProcessAsUserW(tok, selfPath, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, selfDir, &si, &pi)) { agentProc = pi.hProcess; CloseHandle(pi.hThread); agentSession = sid; slog("agent started in session %lu (pid %lu)", sid, pi.dwProcessId); }
    else slog("agent could not start in session %lu: error %lu", sid, GetLastError());
  } else slog("SYSTEM token for session %lu failed: error %lu", sid, GetLastError());
  if (tok) CloseHandle(tok); if (me) CloseHandle(me);
  LeaveCriticalSection(&agentLock);
}
static DWORD WINAPI ctrl(DWORD c, DWORD type, LPVOID data, LPVOID ctx) {
  (void)data; (void)ctx;
  if (c == SERVICE_CONTROL_STOP || c == SERVICE_CONTROL_SHUTDOWN) { setState(SERVICE_STOP_PENDING); SetEvent(stopEv); return NO_ERROR; }
  if (c == SERVICE_CONTROL_SESSIONCHANGE && (type == WTS_CONSOLE_CONNECT || type == WTS_SESSION_LOGON || type == WTS_SESSION_UNLOCK)) { ensureAgent(); return NO_ERROR; }
  if (c == SERVICE_CONTROL_INTERROGATE) return NO_ERROR;
  return NO_ERROR;
}
static void WINAPI svcMain(DWORD argc, LPWSTR *argv) {
  (void)argc; (void)argv;
  ssh = RegisterServiceCtrlHandlerExW(SVC_NAME, ctrl, NULL); if (!ssh) return;
  ZeroMemory(&sst, sizeof sst); sst.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  sst.dwControlsAccepted = SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN | SERVICE_ACCEPT_SESSIONCHANGE;
  stopEv = CreateEventW(NULL, TRUE, FALSE, NULL); InitializeCriticalSection(&agentLock);
  setState(SERVICE_RUNNING); slog("service started (%ls)", selfDir);
  while (WaitForSingleObject(stopEv, 2000) == WAIT_TIMEOUT) ensureAgent(); /* also brings a stopped agent back */
  EnterCriticalSection(&agentLock); killAgent(); LeaveCriticalSection(&agentLock);
  setState(SERVICE_STOPPED);
}

/* ------------------------------------------------------------------ the agent (SYSTEM, in the user's session) */
static HANDLE pipe = INVALID_HANDLE_VALUE; static CRITICAL_SECTION wlock; static volatile LONG secureNow = 0, connected = 0;
static void out(const char *s, size_t n) { EnterCriticalSection(&wlock); DWORD w; if (pipe != INVALID_HANDLE_VALUE) WriteFile(pipe, s, (DWORD)n, &w, NULL); LeaveCriticalSection(&wlock); }
static void outs(const char *s) { out(s, strlen(s)); }
/* follow the desktop that receives input (Default, or Winlogon for UAC / lock screen / Ctrl+Alt+Del) */
static void followDesk(void) {
  HDESK d = OpenInputDesktop(0, FALSE, GENERIC_ALL); if (!d) return;
  if (!SetThreadDesktop(d)) { CloseDesktop(d); return; }
  static HDESK cur = NULL; if (cur && cur != d) CloseDesktop(cur); cur = d;
}
static int isSecure(void) {
  int secure = 0; HDESK d = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (d) { WCHAR n[64] = {0}; DWORD k = 0; if (GetUserObjectInformationW(d, UOI_NAME, n, sizeof n, &k) && lstrcmpiW(n, L"Default")) secure = 1; CloseDesktop(d); }
  return secure;
}
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
typedef struct { unsigned char *p; size_t n, cap; } Buf;
static void bufw(void *ctx, void *data, int size) { Buf *b = ctx; if (b->n + size > b->cap) { b->cap = (b->n + size) * 2; b->p = realloc(b->p, b->cap); } memcpy(b->p + b->n, data, size); b->n += size; }
/* one JPEG of the primary screen, as seen on the current input desktop */
static void sendFrame(void) {
  int w = GetSystemMetrics(SM_CXSCREEN), h = GetSystemMetrics(SM_CYSCREEN); if (w <= 0 || h <= 0) return;
  int ow = w > 1600 ? 1600 : w, oh = (int)((double)h * ow / w);
  HDC sdc = GetDC(NULL); HDC mdc = CreateCompatibleDC(sdc);
  BITMAPINFO bi; ZeroMemory(&bi, sizeof bi); bi.bmiHeader.biSize = sizeof bi.bmiHeader; bi.bmiHeader.biWidth = ow; bi.bmiHeader.biHeight = -oh; bi.bmiHeader.biPlanes = 1; bi.bmiHeader.biBitCount = 24; bi.bmiHeader.biCompression = BI_RGB;
  void *bits = NULL; HBITMAP bm = CreateDIBSection(sdc, &bi, DIB_RGB_COLORS, &bits, NULL, 0);
  if (bm && bits) {
    HGDIOBJ old = SelectObject(mdc, bm); SetStretchBltMode(mdc, HALFTONE);
    StretchBlt(mdc, 0, 0, ow, oh, sdc, 0, 0, w, h, SRCCOPY | CAPTUREBLT);
    CURSORINFO ci; ci.cbSize = sizeof ci; if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING)) DrawIcon(mdc, (int)((double)ci.ptScreenPos.x * ow / w), (int)((double)ci.ptScreenPos.y * oh / h), ci.hCursor);
    SelectObject(mdc, old);
    int stride = ((ow * 3 + 3) & ~3); unsigned char *rgb = malloc((size_t)ow * oh * 3);
    if (rgb) {
      for (int y = 0; y < oh; y++) { unsigned char *s = (unsigned char *)bits + (size_t)y * stride, *d = rgb + (size_t)y * ow * 3; for (int x = 0; x < ow; x++) { d[0] = s[2]; d[1] = s[1]; d[2] = s[0]; s += 3; d += 3; } }
      Buf jb = { 0 }; stbi_write_jpg_to_func(bufw, &jb, ow, oh, 3, rgb, 70); free(rgb);
      if (jb.n) {
        size_t en = 4 * ((jb.n + 2) / 3); char *line = malloc(en + 4);
        if (line) {
          size_t o = 0; line[o++] = 'F'; line[o++] = ' ';
          for (size_t i = 0; i < jb.n; i += 3) {
            unsigned v = jb.p[i] << 16 | (i + 1 < jb.n ? jb.p[i + 1] << 8 : 0) | (i + 2 < jb.n ? jb.p[i + 2] : 0);
            line[o++] = B64[v >> 18 & 63]; line[o++] = B64[v >> 12 & 63]; line[o++] = i + 1 < jb.n ? B64[v >> 6 & 63] : '='; line[o++] = i + 2 < jb.n ? B64[v & 63] : '=';
          }
          line[o++] = '\n'; out(line, o); free(line);
        }
      }
      free(jb.p);
    }
  }
  if (bm) DeleteObject(bm); DeleteDC(mdc); ReleaseDC(NULL, sdc);
}
/* while a client is connected: report the secure desktop and stream it (the normal capture cannot see it) */
static DWORD WINAPI watcher(LPVOID u) {
  (void)u; int last = 0;
  for (;;) {
    if (connected) {
      int s = isSecure();
      if (s != last) { last = s; secureNow = s; outs(s ? "secure 1\n" : "secure 0\n"); }
      if (s) { followDesk(); sendFrame(); Sleep(300); continue; }
    } else last = 0;
    Sleep(500);
  }
  return 0;
}
static int clientAllowed(HANDLE p) {
  ULONG pid = 0; if (!GetNamedPipeClientProcessId(p, &pid)) return 0;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid); if (!h) return 0;
  WCHAR img[MAX_PATH]; DWORD n = MAX_PATH; int ok = 0;
  if (QueryFullProcessImageNameW(h, 0, img, &n)) { WCHAR want[MAX_PATH]; wsprintfW(want, L"%s\\rdinput.exe", selfDir); ok = lstrcmpiW(img, want) == 0; }
  CloseHandle(h); return ok;
}
static void sas(void) {
  typedef VOID (WINAPI *SendSASf)(BOOL);
  HMODULE m = LoadLibraryW(L"sas.dll"); SendSASf f = m ? (SendSASf)GetProcAddress(m, "SendSAS") : NULL;
  if (f) f(FALSE); else outs("nosas\n");
}
static int agent(void) {
  dpi(); InitializeCriticalSection(&wlock);
  DWORD sid = 0; ProcessIdToSessionId(GetCurrentProcessId(), &sid);
  WCHAR name[96]; wsprintfW(name, L"\\\\.\\pipe\\CarpathronRemoteAgent-%08lx-%lu", dirId(selfDir), sid);
  SECURITY_ATTRIBUTES sa; ZeroMemory(&sa, sizeof sa); sa.nLength = sizeof sa;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)", SDDL_REVISION_1, &sa.lpSecurityDescriptor, NULL)) return 1;
  CreateThread(NULL, 0, watcher, NULL, 0, NULL);
  static char line[65536]; int first = 1;
  for (;;) {
    HANDLE p = CreateNamedPipeW(name, PIPE_ACCESS_DUPLEX | (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0), PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                                1, 1 << 20, 1 << 16, 0, &sa);
    if (p == INVALID_HANDLE_VALUE) { slog("agent: pipe busy or blocked (error %lu), stopping", GetLastError()); return 2; } /* someone else owns this name: do not run */
    first = 0;
    if (!ConnectNamedPipe(p, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) { CloseHandle(p); continue; }
    if (!clientAllowed(p)) { slog("agent: refused a program that is not rdinput.exe of this app"); DisconnectNamedPipe(p); CloseHandle(p); continue; }
    EnterCriticalSection(&wlock); pipe = p; LeaveCriticalSection(&wlock);
    InterlockedExchange(&connected, 1); outs("agent 1\n");
    size_t used = 0; DWORD got;
    while (ReadFile(p, line + used, (DWORD)(sizeof line - 1 - used), &got, NULL) && got) {
      used += got; line[used] = 0; char *s = line, *nl;
      while ((nl = strchr(s, '\n'))) {
        *nl = 0; if (nl > s && nl[-1] == '\r') nl[-1] = 0;
        followDesk();
        int a = 0, b = 0, c = 0;
        switch (s[0]) {
          case 'M': if (sscanf(s + 1, "%d %d", &a, &b) == 2) move(a, b); break;
          case 'B': if (sscanf(s + 1, "%d %d", &a, &b) == 2) button(a, b); break;
          case 'W': if (sscanf(s + 1, "%d %d", &a, &b) == 2) { if (a) mouse(MOUSEEVENTF_WHEEL, 0, 0, (DWORD)a); if (b) mouse(MOUSEEVENTF_HWHEEL, 0, 0, (DWORD)b); } break;
          case 'K': if (sscanf(s + 1, "%d %d %d", &a, &b, &c) >= 2) key(a, b, c); break;
          case 'T': if (s[1] == ' ') text(s + 2); break;
          case 'S': sas(); break;
        }
        s = nl + 1;
      }
      used = strlen(s); memmove(line, s, used + 1);
      if (used >= sizeof line - 2) used = 0; /* an endless line: drop it */
    }
    InterlockedExchange(&connected, 0);
    EnterCriticalSection(&wlock); pipe = INVALID_HANDLE_VALUE; LeaveCriticalSection(&wlock);
    DisconnectNamedPipe(p); CloseHandle(p);
  }
}

int wmain(int argc, wchar_t **argv) {
  paths(); setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && !lstrcmpiW(argv[1], L"install")) return install();
  if (argc > 1 && !lstrcmpiW(argv[1], L"uninstall")) return uninstall();
  if (argc > 1 && !lstrcmpiW(argv[1], L"agent")) return agent();
  SERVICE_TABLE_ENTRYW t[] = { { SVC_NAME, svcMain }, { NULL, NULL } };
  if (!StartServiceCtrlDispatcherW(t)) { printf("Carpathron Remote Helper: this program runs as a Windows service (rdsvc.exe install).\n"); return 1; }
  return 0;
}
