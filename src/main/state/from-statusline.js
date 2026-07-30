// Translates Claude Code's statusLine payload into store patches.
//
// This payload is the only place the real rate-limit percentages appear, so
// everything here is written defensively: any field may be absent depending
// on plan, auth method and Claude Code version, and a missing field must
// leave the previous value alone rather than blanking it.

const store = require('./store');

// If no statusLine has arrived for this long, the numbers on screen are no
// longer trustworthy — no Claude Code session is rendering.
const STALE_AFTER_MS = 90_000;

let lastSeen = 0;

// Whether a *real* Claude Code session has ever rendered its status line into
// this daemon, and whether those payloads actually carried rate limits.
//
// Worth tracking separately from `stale`, because the three failure modes need
// three different answers: nothing ever arrived (the status line isn't running
// — most likely you are in the desktop app, which renders none), something
// arrived but had no `rate_limits` (wrong plan or API-key auth), or it arrived
// and then stopped (no session open right now).
const health = { everSeen: false, lastSeenAt: null, sawRateLimits: false };

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function window_(raw) {
  if (!raw) return null;
  const used = num(raw.used_percentage);
  if (used === null) return null;
  return {
    usedPercent: used,
    // Claude Code sends seconds since epoch; everything downstream wants ms.
    resetsAt: num(raw.resets_at) ? raw.resets_at * 1000 : null,
  };
}

function apply(payload) {
  lastSeen = Date.now();

  // `npm run doctor` posts a synthetic payload to prove the path works. It
  // must not be able to make the app claim a real session was ever seen —
  // that is precisely the diagnosis it exists to check.
  if (payload._probe !== true) {
    health.everSeen = true;
    health.lastSeenAt = lastSeen;
    if (payload.rate_limits?.five_hour) health.sawRateLimits = true;
    store.patchQuiet('statusLine', { ...health });
  }

  const limits = {
    fiveHour: window_(payload.rate_limits?.five_hour),
    sevenDay: window_(payload.rate_limits?.seven_day),
    stale: false,
  };
  // Keep the last good reading if this payload simply omitted the section.
  const prev = store.get().limits;
  if (!limits.fiveHour && prev?.fiveHour) limits.fiveHour = prev.fiveHour;
  if (!limits.sevenDay && prev?.sevenDay) limits.sevenDay = prev.sevenDay;
  store.patch('limits', limits);

  const ctx = payload.context_window;
  if (ctx) {
    store.patch('context', {
      usedPercent: num(ctx.used_percentage) ?? 0,
      sizeTokens: num(ctx.context_window_size),
      inputTokens: num(ctx.total_input_tokens),
      outputTokens: num(ctx.total_output_tokens),
      exceeds200k: payload.exceeds_200k_tokens === true,
    });
  }

  if (payload.cost) {
    store.patch('cost', {
      totalUsd: num(payload.cost.total_cost_usd) ?? 0,
      durationMs: num(payload.cost.total_duration_ms),
      linesAdded: num(payload.cost.total_lines_added),
      linesRemoved: num(payload.cost.total_lines_removed),
    });
  }

  store.patch('session', {
    id: payload.session_id ?? null,
    name: payload.session_name ?? null,
    cwd: payload.cwd ?? null,
    model: payload.model?.display_name ?? null,
    version: payload.version ?? null,
    agent: payload.agent?.name ?? null,
  });
}

/** Flags the limit numbers as stale once statusLine updates stop arriving. */
function checkStale() {
  if (!lastSeen) return;
  const limits = store.get().limits;
  const stale = Date.now() - lastSeen > STALE_AFTER_MS;
  if (limits.stale !== stale) store.patch('limits', { ...limits, stale });
}

/** What the app can honestly say about where its Claude numbers come from. */
function statusLineHealth() {
  return { ...health };
}

module.exports = { apply, checkStale, statusLineHealth, STALE_AFTER_MS };
