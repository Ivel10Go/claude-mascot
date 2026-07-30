// One transparent, always-on-top, click-through window per display.
//
// Two Electron constraints shape this file:
//   * `transparent` can only be set at construction, so a display change
//     means rebuilding the window rather than resizing it;
//   * a full-screen overlay would swallow every click, so the window starts
//     in ignore-mouse mode with `forward: true` (which still delivers move
//     events to the renderer) and only becomes solid for the instants the
//     renderer reports the cursor is over a mascot.

const path = require('node:path');
const { BrowserWindow, screen, ipcMain } = require('electron');

const OVERLAY_HTML = path.join(__dirname, '..', 'renderer', 'overlay', 'index.html');
const PRELOAD = path.join(__dirname, 'preload.js');

const windows = new Map();   // display.id -> BrowserWindow
let visible = true;
let rebuildTimer = null;

function createForDisplay(display) {
  // workArea rather than bounds: the mascot should stand on the taskbar's
  // top edge, not behind it.
  const { x, y, width, height } = display.workArea;

  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Keeps the overlay from stealing focus from whatever the user is doing
    // when they poke the mascot.
    focusable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Electron throttles occluded windows; an always-visible overlay must
      // opt out or the animation stutters whenever it loses "focus".
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(OVERLAY_HTML);
  win.once('ready-to-show', () => { if (visible) win.showInactive(); });

  windows.set(display.id, win);
  return win;
}

function destroyAll() {
  for (const win of windows.values()) if (!win.isDestroyed()) win.destroy();
  windows.clear();
}

function rebuild() {
  destroyAll();
  for (const display of screen.getAllDisplays()) createForDisplay(display);
}

/** Display changes arrive in bursts (docking, resolution switches). */
function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuild(); }, 400);
}

function init() {
  ipcMain.on('mascot:interactive', (event, wantInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (wantInput) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  });

  screen.on('display-added', scheduleRebuild);
  screen.on('display-removed', scheduleRebuild);
  screen.on('display-metrics-changed', scheduleRebuild);

  rebuild();
}

function broadcast(channel, payload) {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setVisible(next) {
  visible = next;
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    if (visible) win.showInactive();
    else win.hide();
  }
}

const isVisible = () => visible;

module.exports = { init, broadcast, setVisible, isVisible, rebuild, destroyAll };
