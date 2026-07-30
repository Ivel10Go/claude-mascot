// Single source of truth for everything the mascot reacts to. Collectors and
// the daemon write here; the store pushes to renderers only when a value
// actually changed, so a 1 Hz collector doesn't cause 1 Hz IPC traffic when
// nothing moved.

const listeners = new Set();

const state = {
  // Claude usage, from the chained statusLine payload.
  limits: {
    fiveHour: null,        // { usedPercent, resetsAt }
    sevenDay: null,
    stale: true,           // no statusLine seen recently
  },
  context: null,           // { usedPercent, sizeTokens }
  cost: null,              // { totalUsd, model, sessionId }
  session: null,           // { id, cwd, model, version }

  // Machine telemetry.
  cpu: null,               // { load }
  memory: null,            // { usedPercent, totalBytes }
  battery: null,           // { percent, charging }
  gpu: null,               // { load, memUsedMb, memTotalMb, tempC }
  disks: null,             // [{ mount, freePercent }]

  // Rolling usage derived from the transcript files.
  usage: null,             // { todayTokens, todayUsd, blockTokens }
};

let lastEvent = null;

/** Shallow-compares one branch and notifies only on a real change. */
function patch(key, value) {
  const before = state[key];
  if (JSON.stringify(before) === JSON.stringify(value)) return false;
  state[key] = value;
  emit();
  return true;
}

/**
 * Patch for continuously-varying readings.
 *
 * A CPU load never repeats exactly, so a plain patch() treats every sample as
 * a change: full state over IPC to every overlay, and every speech rule
 * re-evaluated, several times a minute forever. A fraction of a percentage
 * point is not a change anyone can see — so store the new value but stay quiet
 * unless a watched field actually moved.
 */
function patchNoisy(key, value, thresholds) {
  const before = state[key];
  state[key] = value;

  if (!before || !value) {
    emit();
    return true;
  }
  for (const [field, minDelta] of Object.entries(thresholds)) {
    const a = before[field];
    const b = value[field];
    if (typeof a !== 'number' || typeof b !== 'number') {
      if (a !== b) { emit(); return true; }
      continue;
    }
    if (Math.abs(a - b) >= minDelta) { emit(); return true; }
  }
  return false;
}

function emit() {
  for (const fn of listeners) fn(state, lastEvent);
}

/**
 * Stores a value without waking anyone.
 *
 * For readings that flow *out* of the renderer — what the rig is playing, what
 * it just said — which exist for the dashboard and the diagnostics endpoint.
 * Broadcasting them would send the whole state back to every overlay on every
 * animation change, several times a second, and have each one re-evaluate all
 * its speech rules. That feedback loop is pure overhead: nothing in the
 * renderer reacts to these keys.
 */
function patchQuiet(key, value) {
  state[key] = value;
}

/**
 * Records a discrete event (a Claude Code hook firing). Unlike metrics these
 * are not deduplicated — every occurrence matters.
 */
function event(evt) {
  lastEvent = { ...evt, at: Date.now() };
  emit();
  return lastEvent;
}

function get() {
  return state;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { get, patch, patchNoisy, patchQuiet, event, onChange, state };
