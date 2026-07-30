// Context-isolated bridge. The overlay gets exactly three inbound channels
// and one outbound call — nothing else of Electron is reachable from the page.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const handler = (_event, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('mascot', {
  /** Lets clicks through the overlay except while the cursor is on a mascot. */
  setInteractive: value => ipcRenderer.send('mascot:interactive', !!value),

  /** Reports what the rig is actually playing, for the dashboard and doctor. */
  reportAnimation: (name, bodyFill) => ipcRenderer.send('mascot:animation', { name, bodyFill }),

  /** Reports the line the mascot just spoke, so it can be asserted on. */
  reportBubble: (text, ruleId) => ipcRenderer.send('mascot:bubble', { text, ruleId }),

  onMetrics: fn => on('mascot:metrics', fn),
  onReaction: fn => on('mascot:reaction', fn),
  onRelease: fn => on('mascot:release', fn),
  onConfig: fn => on('mascot:config', fn),
});
