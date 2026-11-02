const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maluti', {
  info: () => ipcRenderer.invoke('maluti:info'),
  setRemote: url => ipcRenderer.invoke('maluti:set-remote', url),
  printSilent: html => ipcRenderer.invoke('maluti:print-silent', html),
  updateSettings: s => ipcRenderer.invoke('maluti:update-settings', s),
  updateCheck: () => ipcRenderer.invoke('maluti:update-check'),
  updateApply: () => ipcRenderer.invoke('maluti:update-apply'),
  onUpdateProgress: fn => ipcRenderer.on('maluti:update-progress', (e, p) => fn(p)),
  onUpdateAvailable: fn => ipcRenderer.on('maluti:update-available', (e, s) => fn(s))
});
