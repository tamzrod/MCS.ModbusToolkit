const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('mcsDesktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:get-status'),
  getDiagnostics: () => ipcRenderer.invoke('runtime:diagnostics'),
  getRuntimePaths: () => ipcRenderer.invoke('runtime:get-paths'),
  startAll: () => ipcRenderer.invoke('runtime:start-all'),
  stopAll: () => ipcRenderer.invoke('runtime:stop-all'),
  simulatorCall: (operation, payload) => ipcRenderer.invoke('runtime:simulator-call', operation, payload),
  replicatorCall: (operation, payload) => ipcRenderer.invoke('runtime:replicator-call', operation, payload),
  onRuntimeStatus: callback => ipcRenderer.on('runtime:status', (_event, value) => callback(value)),
  onRuntimeActivity: callback => ipcRenderer.on('runtime:activity', (_event, value) => callback(value)),
  onRuntimeLog: callback => ipcRenderer.on('runtime:log', (_event, value) => callback(value))
});
