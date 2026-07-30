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

// Narrower than this and it is not somewhere a mascot can stand — usually the
// few pixels a neighbouring display's window spills onto this one.
const MIN_PLATFORM_W = 120;

const windows = new Map();   // display.id -> { win, area }
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
  // Exactly one overlay reports what it is doing back to the store. With every
  // overlay reporting, two displays with different window layouts overwrite
  // each other's entry and the readings appear to flicker.
  //
  // This must key off the actual primary display, not creation order: on this
  // machine getAllDisplays() returns the secondary first, so ordering picked
  // the overlay that sees almost no windows.
  const primary = display.id === screen.getPrimaryDisplay().id;
  win.once('ready-to-show', () => {
    if (visible) win.showInactive();
    win.webContents.send('mascot:role', { primary });
  });

  windows.set(display.id, { win, area: display.workArea });
  return win;
}

function destroyAll() {
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.destroy();
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
  // While a mascot is being dragged the cursor routinely leaves its hit box,
  // so hover alone can't decide this: a drag pins the overlay interactive
  // until the button comes up, or the pet would be dropped mid-throw.
  const dragging = new Set();

  const applyInput = (win, wantInput) => {
    if (!win || win.isDestroyed()) return;
    if (wantInput) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  };

  ipcMain.on('mascot:interactive', (event, wantInput) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (dragging.has(win.id)) return;   // drag wins until it ends
    applyInput(win, wantInput);
  });

  ipcMain.on('mascot:dragging', (event, isDragging) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (isDragging) dragging.add(win.id);
    else dragging.delete(win.id);
    applyInput(win, isDragging);
  });

  screen.on('display-added', scheduleRebuild);
  screen.on('display-removed', scheduleRebuild);
  screen.on('display-metrics-changed', scheduleRebuild);

  rebuild();
}

function broadcast(channel, payload) {
  for (const { win } of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Turns screen-space window rectangles into per-overlay platforms.
 *
 * Each overlay covers one display's work area and thinks in its own local
 * coordinates, so the rects are translated and clipped per window. Only the
 * top edge is sent: that is the only part a mascot can stand on.
 */
function sendPlatforms(rects) {
  for (const { win, area } of windows.values()) {
    if (win.isDestroyed()) continue;

    const platforms = [];
    for (const r of rects) {
      const x0 = r.x - area.x;
      const x1 = r.x + r.w - area.x;
      const y = r.y - area.y;
      // A window on a neighbouring display can overlap this one by a few
      // pixels; an 8px sliver is not a ledge anyone can stand on, and it
      // crowds out the real platforms.
      const overlap = Math.min(x1, area.width) - Math.max(x0, 0);
      if (overlap < MIN_PLATFORM_W) continue;
      if (y >= area.height) continue;
      // A maximized window's top edge sits a few pixels above the work area
      // (the invisible resize border), so rejecting y <= 0 would discard every
      // maximized window — which is most of them. Clamp instead.
      platforms.push({
        x0: Math.max(0, x0),
        x1: Math.min(area.width, x1),
        y: Math.max(0, y),
        // Bottom edge too, so the sides can be climbed: on a desktop of
        // maximized windows every ledge is a full screen height up, and
        // without climbing the mascot could never reach any of them.
        y1: Math.min(area.height, y + r.h),
        // Whether each side is a real edge on this display or a clipped one.
        leftOpen: x0 >= 0,
        rightOpen: x1 <= area.width,
      });
    }
    win.webContents.send('mascot:platforms', platforms);
  }
}

function setVisible(next) {
  visible = next;
  for (const { win } of windows.values()) {
    if (win.isDestroyed()) continue;
    if (visible) win.showInactive();
    else win.hide();
  }
}

const isVisible = () => visible;

module.exports = { init, broadcast, sendPlatforms, setVisible, isVisible, rebuild, destroyAll };
