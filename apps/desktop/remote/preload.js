// Carpathron Remote — the only bridge between the remote pages and the app (contextIsolation + sandbox).
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (fn) => { const h = (_e, ...a) => fn(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
// input for this PC goes straight to the input process when it is there (not through the main thread)
let inPort = null;
ipcRenderer.on('rd-input-port', (e) => { try { if (inPort) inPort.close(); } catch {} inPort = e.ports && e.ports[0] || null; if (inPort) inPort.start(); });
const sendInput = (sid, ev) => { if (inPort) { try { inPort.postMessage({ sid: String(sid), ev }); return Promise.resolve(); } catch { inPort = null; } } return ipcRenderer.invoke('rd-input', sid, ev); };
contextBridge.exposeInMainWorld('rd', {
  // home + banner
  state: inv('rd-state'), set: inv('rd-set'), newOtp: inv('rd-new-otp'), setPassword: inv('rd-set-password'),
  openViewer: inv('rd-open-viewer'), forget: inv('rd-forget'), renameSaved: inv('rd-rename-saved'), openHome: inv('rd-open-home'),
  disconnect: inv('rd-disconnect'), onState: on('rd-state'),
  licenseActivate: inv('rd-license-activate'), licenseRelease: inv('rd-license-release'), licenseRefresh: inv('rd-license-refresh'), buy: inv('rd-buy'), plans: inv('rd-plans'), myLicenses: inv('rd-my-licenses'), licenseQuiet: inv('rd-license-quiet'), licenseUnhost: inv('rd-license-unhost'),
  // viewer
  viewerJob: inv('rd-viewer-job'), remember: inv('rd-remember'), viewerConnected: inv('rd-viewer-connected'), title: inv('rd-title'), fullscreen: inv('rd-fullscreen'), clipboard: inv('rd-clipboard'),
  // files (drag and drop / "Send file"), clipboard sync, recordings
  fileFromDrop: (file) => { let p = typeof file === 'string' ? file : ''; if (!p) { try { p = webUtils.getPathForFile(file); } catch {} } return ipcRenderer.invoke('rd-file-open', p); },
  fileRead: inv('rd-file-read'), fileClose: inv('rd-file-close'),
  recvStart: inv('rd-recv-start'), recvChunk: inv('rd-recv-chunk'), recvEnd: inv('rd-recv-end'), showFile: inv('rd-show-file'),
  clipWrite: inv('rd-clip-write'), clipRead: inv('rd-clip-read'),
  // session panel on the controlled computer
  panelCmd: inv('rd-panel-cmd'), panelOpen: inv('rd-panel-open'), panelLog: inv('rd-panel-log'), onPanelEvent: on('rd-panel-event'), onPanelOpen: on('rd-panel-open'),
  // host page
  hostConfig: inv('rd-host-config'), hostStatus: inv('rd-host-status'), authResult: inv('rd-auth-result'), locked: inv('rd-locked'),
  consent: inv('rd-consent'), screens: inv('rd-screens'), source: inv('rd-source'), session: inv('rd-session'), input: sendInput,
  panelEvent: inv('rd-panel-event'), sysinfo: inv('rd-sysinfo'), onPanelCmd: on('rd-panel-cmd'),
  onKill: on('rd-kill'), onConfig: on('rd-config'), onCtlNote: on('rd-ctl-note'), onFs: on('rd-fs'),
  // SSH terminal
  openSsh: inv('rd-open-ssh'), sshList: inv('rd-ssh-list'), sshSave: inv('rd-ssh-save'), sshDelete: inv('rd-ssh-delete'), sshForgetKey: inv('rd-ssh-forget-key'),
  sshOpen: inv('rd-ssh-open'), sshTrust: inv('rd-ssh-trust'), sshWrite: inv('rd-ssh-write'), sshResize: inv('rd-ssh-resize'), sshClose: inv('rd-ssh-close'), sshKeyFile: inv('rd-ssh-keyfile'),
  // AI technician / DevOps agent (the API key never reaches the pages)
  aiSettings: inv('rd-ai-settings'), aiSave: inv('rd-ai-save'), aiModels: inv('rd-ai-models'), aiTest: inv('rd-ai-test'),
  aiStart: inv('rd-ai-start'), aiStop: inv('rd-ai-stop'), aiReset: inv('rd-ai-reset'), aiApprove: inv('rd-ai-approve'), onAiEv: on('rd-ai-ev'),
  onAgent: on('rd-agent'), agentReply: inv('rd-agent-reply'), aiRemoteStop: inv('rd-ai-remote-stop'),
  // commands on this computer for a technician (host page)
  cmdConsent: inv('rd-cmd-consent'), run: inv('rd-run'), runKill: inv('rd-run-kill'), onRunEv: on('rd-run-ev'),
  onSshData: on('rd-ssh-data'), onSshExit: on('rd-ssh-exit'), onSshHostKey: on('rd-ssh-hostkey'), onSshReady: on('rd-ssh-ready'),
});
