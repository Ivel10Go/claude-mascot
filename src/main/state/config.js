// Small JSON-backed config in the app's userData directory. Writes are
// debounced and atomic-ish (write to a temp file, then rename) so a crash
// mid-write can't leave a truncated config behind.

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  petCount: 1,
  locale: 'de',          // 'de' | 'en'
  visible: true,
  muted: false,          // suppress speech bubbles
  quietHours: null,      // e.g. { from: 23, to: 8 }
  autostart: false,
  daemonPort: 4747,
  // Which screens get a mascot: 'primary', 'all', or a specific display id.
  // One mascot per screen is a lot of mascot, so a single screen is the default.
  displayMode: 'primary',
  // Lets the mascot stand on real window title bars. Costs a long-lived
  // PowerShell sidecar (~88MB RSS, ~0.6% of one core).
  windowEdges: true,

  // Per-behaviour switches. All three are sparse maps where a missing key
  // means "on": storing only the exceptions keeps the config small and, more
  // importantly, means a new animation lights up for existing users instead
  // of staying dark until someone goes looking for its checkbox.
  reactions: {},   // reaction key (see shared/catalog.js) -> false to ignore
  effects: {},     // metric-driven overlay name -> false to disable
  idleAnims: {},   // flourish name -> false to keep out of the idle rotation

  scale: 1,        // mascot size, 0.6 .. 2
  speed: 1,        // walking speed multiplier, 0.4 .. 2.5
};

let file = null;
let data = { ...DEFAULTS };
let timer = null;
const listeners = new Set();

function load() {
  file = path.join(app.getPath('userData'), 'config.json');
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    // Missing or corrupt config is not worth surfacing — defaults are fine.
  }
  return data;
}

function flush() {
  timer = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[config] write failed:', err.message);
  }
}

function get() {
  return data;
}

function set(patch) {
  Object.assign(data, patch);
  for (const fn of listeners) fn(data);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 400);
  return data;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { DEFAULTS, load, get, set, onChange, flush };
