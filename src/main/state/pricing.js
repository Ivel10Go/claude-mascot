// Token pricing, used to put a number on the transcript history.
//
// This is an *equivalent API cost* — what the same tokens would have cost on
// the API. On a Pro/Max subscription no money moves per token, so the mascot
// labels it as an estimate rather than spend. Claude Code's own
// `cost.total_cost_usd` from the statusLine is the authoritative figure for a
// live session; this fills in history, which the statusLine cannot.
//
// Rates are USD per million tokens. Cache multipliers are relative to the
// model's input rate: reads ~0.1x, 5-minute writes 1.25x, 1-hour writes 2x.

const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2.0;

// Ordered longest-prefix-first so `claude-opus-4-8` doesn't match a bare
// `claude-opus` rule ahead of it.
const RATES = [
  ['claude-fable-5', { input: 10, output: 50 }],
  ['claude-mythos-5', { input: 10, output: 50 }],
  ['claude-opus-4-6', { input: 5, output: 25 }],
  ['claude-opus-4-7', { input: 5, output: 25 }],
  ['claude-opus-4-8', { input: 5, output: 25 }],
  ['claude-opus-5', { input: 5, output: 25 }],
  ['claude-sonnet-4-6', { input: 3, output: 15 }],
  ['claude-sonnet-5', { input: 3, output: 15 }],
  ['claude-haiku-4-5', { input: 1, output: 5 }],
];

const FALLBACK = { input: 5, output: 25 };   // assume Opus-tier when unknown

function ratesFor(model) {
  if (!model) return FALLBACK;
  const id = String(model).toLowerCase();
  let best = null;
  for (const [prefix, rate] of RATES) {
    if (id.startsWith(prefix) && (!best || prefix.length > best[0].length)) {
      best = [prefix, rate];
    }
  }
  return best ? best[1] : FALLBACK;
}

/**
 * Cost in USD for one usage record.
 *
 * `cache_creation` splits writes by TTL and the two are priced differently, so
 * it is used when present; `cache_creation_input_tokens` is the fallback for
 * older transcript lines that lack the breakdown.
 */
function costOf(usage, model) {
  if (!usage) return 0;
  const r = ratesFor(model);
  const M = 1e6;

  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;

  const split = usage.cache_creation;
  const write5m = split ? split.ephemeral_5m_input_tokens || 0 : (usage.cache_creation_input_tokens || 0);
  const write1h = split ? split.ephemeral_1h_input_tokens || 0 : 0;

  return (
    (input * r.input) / M +
    (output * r.output) / M +
    (read * r.input * CACHE_READ) / M +
    (write5m * r.input * CACHE_WRITE_5M) / M +
    (write1h * r.input * CACHE_WRITE_1H) / M
  );
}

/** Total billable tokens in a usage record, cache included. */
function tokensOf(usage) {
  if (!usage) return 0;
  const split = usage.cache_creation;
  const writes = split
    ? (split.ephemeral_5m_input_tokens || 0) + (split.ephemeral_1h_input_tokens || 0)
    : usage.cache_creation_input_tokens || 0;
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    writes
  );
}

module.exports = { ratesFor, costOf, tokensOf, CACHE_READ, CACHE_WRITE_5M, CACHE_WRITE_1H };
