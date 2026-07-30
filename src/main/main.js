// App entrypoint: single-instance guard, overlay windows, hook daemon, tray.
// This stays the only place the pieces are wired together.

const { app, Tray, Menu, shell, ipcMain } = require('electron');
const overlay = require('./overlay-windows');
const config = require('./state/config');
const store = require('./state/store');
const fromStatusLine = require('./state/from-statusline');
const credentials = require('./daemon/credentials');
const jsonlUsage = require('./collectors/jsonl-usage');
const systemTelemetry = require('./collectors/system');
const gpuTelemetry = require('./collectors/gpu');
const windowWatcher = require('./collectors/win32-windows');
const { createDaemon } = require('./daemon/server');
const { reactionFor, supersedes } = require('../shared/reactions');
const { trayIcon } = require('./icon');

// A second copy would spawn duplicate overlays and fight over the daemon port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// The overlay is not a document window; closing the last one must not exit.
app.on('window-all-closed', () => {});

let tray = null;
let daemon = null;
let daemonPort = null;
let staleTimer = null;

// A sticky reaction (a tool running, a permission prompt) holds until
// something supersedes it; anything lower-priority in the meantime is ignored.
let held = null;
let holdTimer = null;

/**
 * Hands the rig back to the pet's own scheduler.
 *
 * Looping animations never end on their own, so without this a sticky
 * reaction with no follow-up event pins the mascot in that pose indefinitely
 * — hopping at a permission prompt that was already answered elsewhere, or
 * asleep forever after a session ends.
 */
function release(reason) {
  held = null;
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  overlay.broadcast('mascot:release', { reason });
  store.patchQuiet('intent', { animation: null, key: null, releasedBy: reason, at: Date.now() });
}

function dispatch(hook) {
  const reaction = reactionFor(hook);
  if (!reaction) return;

  const now = Date.now();
  if (!supersedes(held, reaction, now)) return;

  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  held = reaction.sticky ? { ...reaction, expiresAt: now + reaction.holdMs } : null;
  // The hold has to expire on a timer, not only when the next hook happens to
  // arrive — there may not be a next hook.
  if (held) holdTimer = setTimeout(() => release('hold-expired'), reaction.holdMs);

  store.event({ key: reaction.key, hook: hook.hook_event_name, data: reaction.data });
  // The key and data travel with the animation: the renderer's director maps
  // them onto speech-bubble rules.
  overlay.broadcast('mascot:reaction', {
    animation: reaction.animation,
    key: reaction.key,
    data: reaction.data,
  });
  store.patchQuiet('intent', { animation: reaction.animation, key: reaction.key, at: Date.now() });
}

async function startDaemon() {
  const creds = credentials.load();
  daemon = createDaemon({
    port: creds.port,
    token: creds.token,
    onHook: dispatch,
    onStatus: payload => fromStatusLine.apply(payload),
    getState: () => store.get(),
  });

  try {
    daemonPort = await daemon.listen();
    console.log(`[daemon] listening on 127.0.0.1:${daemonPort}`);
  } catch (err) {
    // Most likely another copy of the app, or the port is taken. The mascot
    // still runs — it just won't hear from Claude Code.
    console.error(`[daemon] could not listen on ${creds.port}:`, err.message);
    daemon = null;
  }
}

function buildTrayMenu() {
  const cfg = config.get();
  const installed = credentials.isInstalled();

  return Menu.buildFromTemplate([
    {
      label: daemon
        ? `Verbunden · Port ${daemonPort}`
        : 'Daemon nicht erreichbar',
      enabled: false,
    },
    {
      label: installed ? 'Hooks installiert' : 'Hooks nicht installiert (npm run install-hooks)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: overlay.isVisible() ? 'Maskottchen ausblenden' : 'Maskottchen einblenden',
      click: () => {
        overlay.setVisible(!overlay.isVisible());
        config.set({ visible: overlay.isVisible() });
      },
    },
    {
      label: 'Anzahl',
      submenu: [1, 2, 3, 5].map(n => ({
        label: String(n),
        type: 'radio',
        checked: cfg.petCount === n,
        click: () => config.set({ petCount: n }),
      })),
    },
    {
      label: 'Sprache',
      submenu: [
        { label: 'Deutsch', type: 'radio', checked: cfg.locale === 'de', click: () => config.set({ locale: 'de' }) },
        { label: 'English', type: 'radio', checked: cfg.locale === 'en', click: () => config.set({ locale: 'en' }) },
      ],
    },
    { type: 'separator' },
    {
      label: 'Konfigurationsordner öffnen',
      click: () => shell.openPath(app.getPath('userData')),
    },
    { label: 'Beenden', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

app.whenReady().then(async () => {
  const cfg = config.load();

  overlay.init();
  overlay.setVisible(cfg.visible !== false);

  await startDaemon();

  tray = new Tray(trayIcon());
  tray.setToolTip('Claude Mascot');
  refreshTray();

  // What the rig is actually playing, reported back by the overlay. Confirms
  // a reaction reached the screen rather than just being dispatched.
  // These flow out of the renderer for the dashboard and the doctor. Stored
  // quietly: broadcasting them would bounce the whole state back to every
  // overlay on every animation change.
  ipcMain.on('mascot:animation', (_event, { name, bodyFill, place }) => {
    store.patchQuiet('playing', { animation: name, bodyFill, ...place, at: Date.now() });
  });

  ipcMain.on('mascot:bubble', (_event, { text, ruleId }) => {
    store.patchQuiet('speech', { text, ruleId, at: Date.now() });
  });

  // Metrics go to the renderers on change; the tray only cares about config.
  store.onChange(state => overlay.broadcast('mascot:metrics', state));
  config.onChange(next => {
    overlay.broadcast('mascot:config', next);
    refreshTray();
  });

  // Limit readings go stale once no Claude Code session is rendering.
  staleTimer = setInterval(() => fromStatusLine.checkStale(), 30_000);

  // History from the transcripts — the one source that still works when no
  // Claude Code session is open. Failure here must not take the mascot down.
  jsonlUsage.start().catch(err => console.error('[jsonl-usage]', err.message));

  // Machine telemetry. Each collector disables itself if its source is
  // missing, so a desktop with no battery or no NVIDIA card just reports less.
  systemTelemetry.start().catch(err => console.error('[system]', err.message));
  gpuTelemetry.start();

  // Window edges cost a long-lived PowerShell sidecar (~88MB), so they are
  // opt-out. Without it the mascot simply walks the bottom of the screen.
  if (cfg.windowEdges !== false) {
    windowWatcher.start(rects => {
      store.patchQuiet('windows', { count: rects.length, at: Date.now() });
      overlay.sendPlatforms(rects);
    });
  }

  // Renderers subscribe on load; one broadcast once they're up is enough.
  setTimeout(() => {
    overlay.broadcast('mascot:config', config.get());
    overlay.broadcast('mascot:metrics', store.get());
  }, 300);
});

app.on('before-quit', () => {
  jsonlUsage.stop();
  systemTelemetry.stop();
  gpuTelemetry.stop();
  windowWatcher.stop();
  if (staleTimer) clearInterval(staleTimer);
  if (daemon) daemon.close();
  config.flush();
  overlay.destroyAll();
});
