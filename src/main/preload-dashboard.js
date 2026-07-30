// Bridge for the dashboard window.
//
// Separate from the overlay's preload on purpose: the dashboard is the only
// surface allowed to *change* configuration, and the overlay — which renders
// whatever the mascot is told — has no business being able to.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('dash', {
  onState: fn => on('dashboard:state', fn),
  onConfig: fn => on('dashboard:config', fn),
  setConfig: patch => ipcRenderer.send('dashboard:set-config', patch),
  installHooks: () => ipcRenderer.invoke('dashboard:hooks-status'),
});
