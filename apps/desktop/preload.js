// Safe bridge between the window and Windows features (folder picker, open links).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickFolder: (start) => ipcRenderer.invoke('pick-folder', start),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  version: () => ipcRenderer.invoke('app-version'),
  focus: () => ipcRenderer.invoke('focus-window'),
  update: {
    state: () => ipcRenderer.invoke('update-state'),
    check: () => ipcRenderer.invoke('update-check'),
    install: () => ipcRenderer.invoke('update-install'),
    onChange: (cb) => { const f = (_e, st) => cb(st); ipcRenderer.on('update-state', f); return () => ipcRenderer.removeListener('update-state', f); },
  },
});
