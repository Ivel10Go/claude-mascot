// The dashboard: one normal window, opened from the tray.
//
// It is created lazily and hidden rather than destroyed on close, so reopening
// is instant and the renderer keeps its state. Pushes stop while it is hidden
// — a window nobody is looking at should cost nothing.

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');

const HTML = path.join(__dirname, '..', 'renderer', 'dashboard', 'index.html');
const PRELOAD = path.join(__dirname, 'preload-dashboard.js');

const PUSH_MS = 1500;

let win = null;
let timer = null;
// show() before the window's first paint is a no-op, so a request that arrives
// during construction has to be remembered and replayed on ready-to-show.
let wantVisible = false;
let getState = null;
let getConfig = null;
let setConfig = null;

function push() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.webContents.send('dashboard:state', getState());
}

function create() {
  win = new BrowserWindow({
    // Tall enough to reach the animation switches without scrolling: the
    // panel below the fold was, in practice, a panel nobody knew existed.
    width: 1040,
    height: 940,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#1b1815',
    title: 'Claude Mascot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(HTML).catch(err => console.error('[dashboard] load failed:', err.message));
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error(`[dashboard] did-fail-load ${code} ${desc} ${url}`));

  // Closing should put it away, not tear it down — the tray reopens it.
  win.on('close', event => {
    if (win && !win.isDestroyed()) {
      event.preventDefault();
      win.hide();
    }
  });

  win.once('ready-to-show', () => {
    if (wantVisible) {
      win.show();
      win.focus();
    }
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('dashboard:config', getConfig());
    push();
  });
}

function init(hooks) {
  getState = hooks.getState;
  getConfig = hooks.getConfig;
  setConfig = hooks.setConfig;

  ipcMain.on('dashboard:set-config', (_event, patch) => {
    if (patch && typeof patch === 'object') setConfig(patch);
  });

  timer = setInterval(push, PUSH_MS);
}

function open() {
  wantVisible = true;
  if (!win || win.isDestroyed()) {
    create();
    return;   // ready-to-show will reveal it
  }
  win.show();
  win.focus();
  push();
}

/** Config changed elsewhere (the tray) — keep the dashboard's controls honest. */
function sendConfig(cfg) {
  if (win && !win.isDestroyed()) win.webContents.send('dashboard:config', cfg);
}

function destroy() {
  if (timer) clearInterval(timer);
  timer = null;
  if (win && !win.isDestroyed()) {
    win.removeAllListeners('close');
    win.destroy();
  }
  win = null;
}

module.exports = { init, open, sendConfig, destroy };
