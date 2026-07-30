// GPU load and temperature via nvidia-smi.
//
// ~36ms of CPU per call, so a 15-second interval costs about a quarter of one
// percent of a core. If nvidia-smi is missing (no NVIDIA card, or a laptop
// running on its integrated GPU only) the collector disables itself after the
// first failure rather than paying for a spawn that will never work.

const { execFile } = require('node:child_process');
const store = require('./../state/store');

const INTERVAL_MS = 15_000;
const QUERY = 'utilization.gpu,memory.used,memory.total,temperature.gpu,name';

let timer = null;
let available = true;
let inFlight = false;

function sample() {
  if (!available || inFlight) return;
  inFlight = true;

  execFile(
    'nvidia-smi',
    [`--query-gpu=${QUERY}`, '--format=csv,noheader,nounits'],
    { timeout: 5000, windowsHide: true },
    (err, stdout) => {
      inFlight = false;
      if (err) {
        // ENOENT means no NVIDIA tooling; anything else is likely transient,
        // but repeated failures aren't worth retrying forever either.
        available = false;
        store.patch('gpu', null);
        return;
      }

      // First line only: a multi-GPU laptop lists the discrete card first, and
      // that is the one that actually heats up.
      const line = String(stdout).split('\n')[0]?.trim();
      if (!line) return;
      const parts = line.split(',').map(s => s.trim());
      const [load, memUsed, memTotal, temp] = parts.map(Number);
      if (!Number.isFinite(load)) return;

      store.patchNoisy('gpu', {
        load,
        memUsedMb: Number.isFinite(memUsed) ? memUsed : null,
        memTotalMb: Number.isFinite(memTotal) ? memTotal : null,
        tempC: Number.isFinite(temp) ? temp : null,
        name: parts[4] || null,
      }, { load: 3, tempC: 2 });
    }
  );
}

function start() {
  sample();
  timer = setInterval(sample, INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
