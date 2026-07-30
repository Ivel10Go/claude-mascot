// Reads token usage out of Claude Code's own transcripts.
//
// The statusLine only reports the session currently being rendered, so it can
// say nothing about yesterday, or about anything while no session is open.
// The transcripts under ~/.claude/projects/**/*.jsonl carry a `message.usage`
// on every assistant turn, which is what this turns into today / rolling-5h /
// 7-day figures.
//
// Deliberately dependency-free: fs.watch supports `recursive` on Windows, so
// a file-watching library would buy nothing here.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const store = require('../state/store');
const { costOf, tokensOf } = require('../state/pricing');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// One more day than the longest window we report, so a 7-day total is whole.
const WINDOW_DAYS = 8;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Bursts of appends during an active session collapse into one read.
const DEBOUNCE_MS = 700;
const RECOMPUTE_MS = 60_000;
// Read granularity. Bounded so the first pass over a months-old transcript
// never pulls the whole file into memory at once.
const CHUNK_BYTES = 1 << 20;

/** hour bucket -> { tokens, usd } */
const buckets = new Map();
/** absolute path -> bytes already consumed */
const offsets = new Map();

let debounce = null;
let recomputeTimer = null;
let watcher = null;
const pending = new Set();

const hourKey = ts => Math.floor(ts / HOUR_MS);

function record(ts, usage, model) {
  const key = hourKey(ts);
  const bucket = buckets.get(key) || { tokens: 0, usd: 0 };
  bucket.tokens += tokensOf(usage);
  bucket.usd += costOf(usage, model);
  buckets.set(key, bucket);
}

function prune(now = Date.now()) {
  const cutoff = hourKey(now - WINDOW_MS);
  for (const key of buckets.keys()) if (key < cutoff) buckets.delete(key);
}

function handleLine(line) {
  // Cheap prefilter: most transcript lines are user turns or tool results and
  // never need to reach JSON.parse.
  if (line.length < 40 || !line.includes('"usage"')) return;
  try {
    const entry = JSON.parse(line);
    const usage = entry?.message?.usage;
    if (!usage) return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    if (Date.now() - ts > WINDOW_MS) return;
    record(ts, usage, entry.message.model);
  } catch {
    // Malformed line — skip it rather than abort the whole file.
  }
}

/**
 * Reads a file from its stored offset and folds any new usage records in.
 *
 * Byte offsets are tracked by hand, advancing only to the last complete
 * newline. Anything looser double-counts: a transcript is appended to while
 * a session runs, so a re-read of already-counted bytes silently inflates
 * every total, and the numbers still look plausible.
 */
async function ingest(file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    offsets.delete(file);
    return;
  }

  let from = offsets.get(file) ?? 0;
  // A rotated or rewritten transcript is shorter than what we already read.
  if (stat.size < from) from = 0;
  if (stat.size <= from) return;

  let handle;
  try {
    handle = await fsp.open(file, 'r');
    let pos = from;
    let carry = Buffer.alloc(0);

    while (pos < stat.size) {
      const len = Math.min(CHUNK_BYTES, stat.size - pos);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await handle.read(buf, 0, len, pos);
      if (!bytesRead) break;
      pos += bytesRead;

      const data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);

      let start = 0;
      for (;;) {
        const nl = data.indexOf(0x0a, start);
        if (nl === -1) break;
        handleLine(data.toString('utf8', start, nl));
        start = nl + 1;
      }
      // Whatever follows the last newline is an incomplete line: a session
      // still writing. Carry it, and leave the offset behind it.
      carry = Buffer.from(data.subarray(start));
    }

    offsets.set(file, pos - carry.length);
  } catch {
    // Leave the offset untouched so these bytes are retried, never skipped.
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function summarise(now = Date.now()) {
  prune(now);

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const dayKey = hourKey(startOfDay.getTime());
  const fiveHourKey = hourKey(now - 5 * HOUR_MS);
  const weekKey = hourKey(now - 7 * 24 * HOUR_MS);

  let today = { tokens: 0, usd: 0 };
  let block = { tokens: 0, usd: 0 };
  let week = { tokens: 0, usd: 0 };

  for (const [key, b] of buckets) {
    if (key >= dayKey) { today.tokens += b.tokens; today.usd += b.usd; }
    if (key >= fiveHourKey) { block.tokens += b.tokens; block.usd += b.usd; }
    if (key >= weekKey) { week.tokens += b.tokens; week.usd += b.usd; }
  }

  store.patch('usage', {
    todayTokens: Math.round(today.tokens),
    todayUsd: +today.usd.toFixed(4),
    blockTokens: Math.round(block.tokens),
    blockUsd: +block.usd.toFixed(4),
    weekTokens: Math.round(week.tokens),
    weekUsd: +week.usd.toFixed(4),
    // The dashboard should say "estimated" — on a subscription these tokens
    // cost no money, and even on the API this is a reconstruction.
    estimated: true,
    at: now,
  });
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

async function flushPending() {
  debounce = null;
  const files = [...pending];
  pending.clear();
  for (const file of files) await ingest(file);
  summarise();
}

function queue(file) {
  pending.add(file);
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(flushPending, DEBOUNCE_MS);
}

async function start() {
  const cutoff = Date.now() - WINDOW_MS;
  const files = await walk(PROJECTS_DIR);

  // Only transcripts that could still fall inside the window are worth
  // reading; a year of history would otherwise be parsed on every launch.
  for (const file of files) {
    try {
      const stat = await fsp.stat(file);
      if (stat.mtimeMs < cutoff) {
        offsets.set(file, stat.size);   // known, but nothing to contribute
        continue;
      }
      await ingest(file);
    } catch {
      // Unreadable transcript — skip it rather than fail startup.
    }
  }
  summarise();

  try {
    watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_event, name) => {
      if (!name || !name.endsWith('.jsonl')) return;
      queue(path.join(PROJECTS_DIR, name));
    });
  } catch (err) {
    console.error('[jsonl-usage] watch failed:', err.message);
  }

  recomputeTimer = setInterval(() => summarise(), RECOMPUTE_MS);
}

function stop() {
  if (watcher) watcher.close();
  if (debounce) clearTimeout(debounce);
  if (recomputeTimer) clearInterval(recomputeTimer);
  watcher = null;
}

module.exports = { start, stop, PROJECTS_DIR };
