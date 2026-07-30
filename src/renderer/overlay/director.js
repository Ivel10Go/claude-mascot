// Decides what the mascot says, and refuses to let it say too much.
//
// Metric rules are edge-triggered with hysteresis: a rule arms only after its
// `until` condition goes true again, so a value sitting on a threshold can't
// produce a stream of bubbles. On top of that every rule has its own cooldown
// and there is a global minimum gap that only `critical` may jump.

import { rules, PRIORITY } from '../../shared/rules.js';
import { fill } from '../../shared/format.js';
import { locales } from '../../shared/locales.js';

const GLOBAL_GAP_MS = 9_000;
const AMBIENT_MIN_GAP_MS = 6 * 60_000;

const pickVariant = list => list[(Math.random() * list.length) | 0];

export function createDirector(getConfig) {
  // Per-rule bookkeeping, keyed by rule id.
  const armed = new Map(rules.map(r => [r.id, true]));
  const lastFired = new Map(rules.map(r => [r.id, 0]));
  let queue = [];
  let lastSpokeAt = 0;
  let lastAmbientAt = 0;
  let metrics = {};

  function textFor(rule, event, locale) {
    const table = locales[locale] ?? locales.de;
    const variants = table[rule.text] ?? locales.de[rule.text];
    if (!variants || !variants.length) return null;
    const vars = rule.vars ? rule.vars(metrics, event, locale) : {};
    return fill(pickVariant(variants), vars);
  }

  function enqueue(rule, event, now) {
    const cooldown = rule.cooldownMs ?? 0;
    if (now - (lastFired.get(rule.id) || -Infinity) < cooldown) return;
    // A rule already waiting doesn't need a second slot.
    if (queue.some(c => c.rule.id === rule.id)) return;
    queue.push({ rule, event, at: now });
  }

  /** Feeds new metrics in and re-evaluates every metric rule. */
  function observe(next, now = performance.now()) {
    metrics = next || {};
    for (const rule of rules) {
      if (rule.kind !== 'metric') continue;
      let on = false;
      try {
        on = !!rule.when(metrics);
      } catch {
        // A rule reaching into a metric branch that isn't populated yet is
        // normal at startup, not an error worth surfacing.
        on = false;
      }
      if (on && armed.get(rule.id)) {
        armed.set(rule.id, false);
        enqueue(rule, null, now);
      } else if (!on && !armed.get(rule.id)) {
        // Re-arm only once the release condition is met, not merely when
        // `when` goes false — that gap is the hysteresis.
        let off = true;
        try {
          off = rule.until ? !!rule.until(metrics) : true;
        } catch {
          off = true;
        }
        if (off) armed.set(rule.id, true);
      }
    }
  }

  /** A Claude Code hook reaction arrived. */
  function event(evt, now = performance.now()) {
    if (!evt || !evt.key) return;
    for (const rule of rules) {
      if (rule.kind === 'event' && rule.key === evt.key) enqueue(rule, evt, now);
    }
  }

  function ambientCandidate(now) {
    if (now - lastAmbientAt < AMBIENT_MIN_GAP_MS) return null;
    const eligible = rules.filter(r => {
      if (r.kind !== 'ambient') return false;
      if (now - (lastFired.get(r.id) || -Infinity) < (r.cooldownMs ?? 0)) return false;
      try {
        return !!r.when(metrics);
      } catch {
        return false;
      }
    });
    return eligible.length ? { rule: pickVariant(eligible), event: null, at: now } : null;
  }

  /**
   * Returns the next thing to say, or null.
   *
   * `onlyCritical` is passed while a bubble is still on screen: a limit
   * running out shouldn't have to queue behind "all quiet", so critical lines
   * are allowed to cut in and replace whatever is being said.
   */
  function take(now = performance.now(), { onlyCritical = false } = {}) {
    const cfg = getConfig() || {};
    if (cfg.muted) { queue = []; return null; }

    if (!queue.length && !onlyCritical) {
      const ambient = ambientCandidate(now);
      if (ambient) queue.push(ambient);
    }
    if (!queue.length) return null;

    // Highest priority first; among equals, whatever arrived earliest.
    queue.sort((a, b) => {
      const d = PRIORITY[b.rule.priority] - PRIORITY[a.rule.priority];
      return d !== 0 ? d : a.at - b.at;
    });

    const isCritical = PRIORITY[queue[0].rule.priority] >= PRIORITY.critical;
    if (onlyCritical && !isCritical) return null;
    if (!isCritical) {
      if (now - lastSpokeAt < GLOBAL_GAP_MS) return null;
      if (inQuietHours(cfg)) { queue = queue.filter(c => c.rule.priority === 'critical'); return null; }
    }

    const candidate = queue.shift();
    const locale = cfg.locale === 'en' ? 'en' : 'de';
    const message = textFor(candidate.rule, candidate.event, locale);
    if (!message) return null;

    lastFired.set(candidate.rule.id, now);
    lastSpokeAt = now;
    if (candidate.rule.kind === 'ambient') lastAmbientAt = now;

    return { text: message, animation: candidate.rule.animation || null, ruleId: candidate.rule.id };
  }

  return { observe, event, take };
}

/** Quiet hours may wrap past midnight (e.g. 23 → 8). */
function inQuietHours(cfg) {
  const q = cfg.quietHours;
  if (!q || typeof q.from !== 'number' || typeof q.to !== 'number') return false;
  const h = new Date().getHours();
  return q.from <= q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}
