// Feeds the mascot the rectangles of real windows so it can stand on them.
//
// Windows exposes this only through user32, and there is no way to call it
// from Node without a native module — which this project deliberately avoids
// (see the koffi note in the README). So a PowerShell sidecar does the
// enumeration and streams JSON lines back.
//
// It is started once and left running: a fresh PowerShell costs ~460ms of CPU,
// so spawning per poll would eat most of a core, while the long-lived process
// sits at ~0.6% of one core. It does cost ~88MB of RSS, which is why this is
// switchable off in config.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'window-watcher.ps1');

// Our own overlays are windows too, and standing on yourself is not a feature.
const OWN_TITLE = 'Claude Mascot Overlay';

let child = null;
let onUpdate = null;
let restarts = 0;
const MAX_RESTARTS = 3;

function handle(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return;   // PowerShell warnings and stray output are not fatal
  }
  if (!payload || !Array.isArray(payload.windows)) return;

  const windows = payload.windows
    .filter(w => w.t !== OWN_TITLE)
    .map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h, title: w.t }));

  if (onUpdate) onUpdate(windows);
}

function launch() {
  child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  readline.createInterface({ input: child.stdout }).on('line', handle);

  child.stderr.on('data', d => {
    const text = String(d).trim();
    if (text) console.error('[windows]', text.slice(0, 300));
  });

  child.on('exit', code => {
    child = null;
    // A crash loop must not be allowed to respawn PowerShell forever.
    if (code !== 0 && restarts < MAX_RESTARTS) {
      restarts++;
      console.error(`[windows] watcher exited (${code}), restart ${restarts}/${MAX_RESTARTS}`);
      setTimeout(launch, 2000);
    } else if (code !== 0) {
      console.error('[windows] watcher gave up; window edges disabled');
    }
  });

  child.on('error', err => {
    console.error('[windows] could not start watcher:', err.message);
    child = null;
  });
}

function start(callback) {
  onUpdate = callback;
  restarts = 0;
  launch();
}

function stop() {
  onUpdate = null;
  if (child) {
    child.kill();
    child = null;
  }
}

const isRunning = () => child !== null;

module.exports = { start, stop, isRunning };
