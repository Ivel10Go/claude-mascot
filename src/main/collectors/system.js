// Machine telemetry, tiered by how expensive each reading is and how fast it
// actually changes.
//
// The mascot runs all day, so cost matters more than freshness here. CPU, RAM
// and disk are pure syscalls and effectively free. Battery percentage is the
// only reading that needs an external process on Windows, so it runs rarely —
// and the charging *state*, which is what most of the animation reacts to,
// comes from Electron's power monitor for nothing.
//
// Deliberately no `systeminformation`: it spawns WMI helpers internally, and
// everything needed here is either a syscall or one cheap 60-second call.

const os = require('node:os');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { powerMonitor } = require('electron');

const store = require('./../state/store');

const FAST_MS = 2_000;    // cpu + memory: syscalls, but nothing here needs 1 Hz
const DISK_MS = 60_000;   // disk usage moves slowly
const BATTERY_MS = 60_000;
const DRIVE_RESCAN_MS = 10 * 60_000;

// wmic is ~6x cheaper than PowerShell (78ms vs 458ms of CPU per call) but is
// deprecated and absent on some newer Windows builds, so the first successful
// probe decides which one to keep using.
let batterySource = null;   // 'wmic' | 'powershell' | 'none'
let batteryInFlight = false;

let drives = [];
let timers = [];
let prevCpu = null;

// Core count can't change while the process runs, and os.cpus() builds a fresh
// array of per-core objects on every call — worth not asking twice per sample.
const CORE_COUNT = os.cpus().length;

function cpuSnapshot() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const key of Object.keys(cpu.times)) total += cpu.times[key];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

function sampleCpu() {
  const now = cpuSnapshot();
  if (prevCpu) {
    const idle = now.idle - prevCpu.idle;
    const total = now.total - prevCpu.total;
    if (total > 0) {
      // 2 points: below that nothing on screen changes, and the thresholds
      // that matter (thermal at 60%, cpu.hot at 88%) are nowhere near that fine.
      store.patchNoisy('cpu', {
        load: Math.max(0, Math.min(100, (1 - idle / total) * 100)),
        cores: CORE_COUNT,
      }, { load: 2 });
    }
  }
  prevCpu = now;
}

function sampleMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  store.patchNoisy('memory', {
    usedPercent: ((total - free) / total) * 100,
    totalBytes: total,
    freeBytes: free,
  }, { usedPercent: 1 });
}

/** Which drive letters actually exist. Re-checked occasionally for USB media. */
async function findDrives() {
  const letters = [];
  // A: and B: are floppy letters and can stall for seconds when probed.
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    letters.push(`${String.fromCharCode(c)}:\\`);
  }
  const results = await Promise.all(
    letters.map(async mount => {
      try {
        await fsp.statfs(mount);
        return mount;
      } catch {
        return null;
      }
    })
  );
  drives = results.filter(Boolean);
}

async function sampleDisks() {
  if (!drives.length) return;
  const out = [];
  for (const mount of drives) {
    try {
      const s = await fsp.statfs(mount);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      if (!total) continue;
      out.push({
        mount: mount.slice(0, 2),
        totalBytes: total,
        freeBytes: free,
        freePercent: (free / total) * 100,
      });
    } catch {
      // Drive vanished between scans (ejected media) — skip it.
    }
  }
  if (out.length) store.patch('disks', out);
}

const run = (file, args) =>
  new Promise(resolve => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });

async function readBatteryPercent() {
  if (batterySource === 'none') return null;

  if (batterySource === null || batterySource === 'wmic') {
    const out = await run('wmic', ['path', 'Win32_Battery', 'get', 'EstimatedChargeRemaining']);
    const match = out && out.match(/(\d+)/);
    if (match) {
      batterySource = 'wmic';
      return Number(match[1]);
    }
    if (batterySource === 'wmic') batterySource = null;   // re-probe next time
  }

  const out = await run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    '(Get-CimInstance Win32_Battery).EstimatedChargeRemaining',
  ]);
  const match = out && out.match(/(\d+)/);
  if (match) {
    batterySource = 'powershell';
    return Number(match[1]);
  }

  // No battery at all (a desktop) — stop paying for the probe.
  batterySource = 'none';
  return null;
}

/** Charging state is free and event-driven; only the percentage costs a spawn. */
function publishBattery(percent) {
  const charging = !powerMonitor.isOnBatteryPower();
  const prev = store.get().battery;
  store.patch('battery', {
    percent: percent ?? prev?.percent ?? null,
    charging,
    source: batterySource,
  });
}

async function sampleBattery() {
  if (batteryInFlight) return;
  batteryInFlight = true;
  try {
    publishBattery(await readBatteryPercent());
  } finally {
    batteryInFlight = false;
  }
}

async function start() {
  sampleCpu();
  sampleMemory();
  await findDrives();
  await sampleDisks();
  await sampleBattery();

  timers.push(setInterval(() => { sampleCpu(); sampleMemory(); }, FAST_MS));
  timers.push(setInterval(() => sampleDisks(), DISK_MS));
  timers.push(setInterval(() => sampleBattery(), BATTERY_MS));
  timers.push(setInterval(() => findDrives(), DRIVE_RESCAN_MS));

  // The plug being pulled should reach the mascot immediately, not up to a
  // minute later on the next poll.
  powerMonitor.on('on-battery', () => publishBattery());
  powerMonitor.on('on-ac', () => publishBattery());
}

function stop() {
  for (const t of timers) clearInterval(t);
  timers = [];
}

module.exports = { start, stop };
