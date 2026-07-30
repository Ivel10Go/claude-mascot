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

function emit() {
  for (const fn of listeners) fn(state, lastEvent);
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

module.exports = { get, patch, event, onChange, state };
