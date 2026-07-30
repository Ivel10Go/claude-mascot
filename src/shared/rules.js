// What the mascot is allowed to say, and when.
//
// Three kinds of rule:
//   event   — fires on a Claude Code hook reaction key
//   metric  — edge-triggered: fires when its condition becomes true, and
//             re-arms only once `until` goes false again (hysteresis, so a
//             value hovering on a threshold can't chatter)
//   ambient — occasional unprompted remarks, rate-limited hard
//
// Priority decides what wins when several want to speak at once. Cooldowns
// are what keep this a companion rather than a notification firehose.

import * as fmt from './format.js';

export const PRIORITY = { critical: 3, important: 2, normal: 1, ambient: 0 };

const MIN = 60_000;

/** Live limit readings only — a stale one means no session is rendering. */
const fresh = m => m.limits && !m.limits.stale;
const fiveHour = m => (fresh(m) ? m.limits.fiveHour : null);
const sevenDay = m => (fresh(m) ? m.limits.sevenDay : null);

export const rules = [
  // ── Claude Code events ───────────────────────────────────────────────
  {
    id: 'permission',
    kind: 'event', key: 'permission',
    text: 'permission', priority: 'critical', cooldownMs: 0,
  },
  {
    id: 'limit.hit',
    kind: 'event', key: 'limit.hit',
    text: 'limit.hit', priority: 'critical', cooldownMs: 0,
    vars: (m, e, locale) => ({ reset: fmt.until(fiveHour(m)?.resetsAt, locale) }),
  },
  {
    id: 'tool.failed',
    kind: 'event', key: 'tool.failed',
    text: 'tool.failed', priority: 'important', cooldownMs: 30_000,
    vars: (m, e) => ({ tool: e?.data?.tool ?? '?' }),
  },
  {
    id: 'session.start',
    kind: 'event', key: 'session.start',
    text: 'session.start', priority: 'normal', cooldownMs: 5 * MIN,
  },
  {
    id: 'turn.done',
    kind: 'event', key: 'turn.done',
    text: 'turn.done', priority: 'normal', cooldownMs: 4 * MIN,
  },
  {
    id: 'compact',
    kind: 'event', key: 'compact',
    text: 'compact', priority: 'normal', cooldownMs: 2 * MIN,
  },
  {
    id: 'subagent.start',
    kind: 'event', key: 'subagent.start',
    text: 'subagent.start', priority: 'ambient', cooldownMs: 3 * MIN,
    vars: (m, e) => ({ agent: e?.data?.agent ?? '?' }),
  },

  // ── Claude limits ────────────────────────────────────────────────────
  {
    id: 'limit.5h.critical',
    kind: 'metric',
    when: m => (fiveHour(m)?.usedPercent ?? 0) >= 92,
    until: m => (fiveHour(m)?.usedPercent ?? 0) < 88,
    text: 'limit.fiveHour.critical', priority: 'critical', cooldownMs: 5 * MIN,
    animation: 'alert',
    vars: (m, e, locale) => ({
      pct: fmt.pct(fiveHour(m).usedPercent),
      left: fmt.pct(100 - fiveHour(m).usedPercent),
      reset: fmt.until(fiveHour(m).resetsAt, locale),
    }),
  },
  {
    id: 'limit.5h.warn',
    kind: 'metric',
    when: m => (fiveHour(m)?.usedPercent ?? 0) >= 75,
    until: m => (fiveHour(m)?.usedPercent ?? 0) < 70,
    text: 'limit.fiveHour.warn', priority: 'important', cooldownMs: 20 * MIN,
    vars: (m, e, locale) => ({
      pct: fmt.pct(fiveHour(m).usedPercent),
      left: fmt.pct(100 - fiveHour(m).usedPercent),
      reset: fmt.until(fiveHour(m).resetsAt, locale),
    }),
  },
  {
    id: 'limit.7d.warn',
    kind: 'metric',
    when: m => (sevenDay(m)?.usedPercent ?? 0) >= 80,
    until: m => (sevenDay(m)?.usedPercent ?? 0) < 75,
    text: 'limit.sevenDay.warn', priority: 'important', cooldownMs: 4 * 60 * MIN,
    vars: (m, e, locale) => ({
      pct: fmt.pct(sevenDay(m).usedPercent),
      reset: fmt.until(sevenDay(m).resetsAt, locale),
    }),
  },
  {
    // Fires on the way back down, i.e. the window rolled over.
    id: 'limit.recovered',
    kind: 'metric',
    when: m => (fiveHour(m)?.usedPercent ?? 100) < 15,
    until: m => (fiveHour(m)?.usedPercent ?? 0) > 30,
    text: 'limit.recovered', priority: 'normal', cooldownMs: 60 * MIN,
    animation: 'confetti',
  },

  // ── Context window ───────────────────────────────────────────────────
  {
    id: 'context.critical',
    kind: 'metric',
    when: m => (m.context?.usedPercent ?? 0) >= 90,
    until: m => (m.context?.usedPercent ?? 0) < 80,
    text: 'context.critical', priority: 'important', cooldownMs: 5 * MIN,
    vars: m => ({ pct: fmt.pct(m.context.usedPercent) }),
  },
  {
    id: 'context.warn',
    kind: 'metric',
    when: m => (m.context?.usedPercent ?? 0) >= 75,
    until: m => (m.context?.usedPercent ?? 0) < 65,
    text: 'context.warn', priority: 'normal', cooldownMs: 15 * MIN,
    vars: m => ({ pct: fmt.pct(m.context.usedPercent) }),
  },

  // ── Machine ──────────────────────────────────────────────────────────
  {
    id: 'battery.critical',
    kind: 'metric',
    when: m => !m.battery?.charging && (m.battery?.percent ?? 100) <= 10,
    until: m => m.battery?.charging || (m.battery?.percent ?? 100) > 15,
    text: 'battery.critical', priority: 'critical', cooldownMs: 5 * MIN,
    animation: 'alert',
    vars: m => ({ pct: fmt.pct(m.battery.percent) }),
  },
  {
    id: 'battery.low',
    kind: 'metric',
    when: m => !m.battery?.charging && (m.battery?.percent ?? 100) <= 22,
    until: m => m.battery?.charging || (m.battery?.percent ?? 100) > 28,
    text: 'battery.low', priority: 'important', cooldownMs: 15 * MIN,
    vars: m => ({ pct: fmt.pct(m.battery.percent) }),
  },
  {
    id: 'battery.charging',
    kind: 'metric',
    when: m => m.battery?.charging === true && (m.battery?.percent ?? 100) < 90,
    until: m => m.battery?.charging === false,
    text: 'battery.charging', priority: 'ambient', cooldownMs: 20 * MIN,
  },
  {
    id: 'cpu.hot',
    kind: 'metric',
    when: m => (m.cpu?.load ?? 0) >= 88,
    until: m => (m.cpu?.load ?? 0) < 70,
    text: 'cpu.hot', priority: 'normal', cooldownMs: 10 * MIN,
    vars: m => ({ pct: fmt.pct(m.cpu.load) }),
  },
  {
    id: 'gpu.hot',
    kind: 'metric',
    when: m => (m.gpu?.load ?? 0) >= 85,
    until: m => (m.gpu?.load ?? 0) < 65,
    text: 'gpu.hot', priority: 'ambient', cooldownMs: 15 * MIN,
    vars: m => ({ pct: fmt.pct(m.gpu.load), temp: fmt.pct(m.gpu.tempC ?? 0) }),
  },
  {
    id: 'memory.high',
    kind: 'metric',
    when: m => (m.memory?.usedPercent ?? 0) >= 90,
    until: m => (m.memory?.usedPercent ?? 0) < 80,
    text: 'memory.high', priority: 'normal', cooldownMs: 20 * MIN,
    vars: m => ({ pct: fmt.pct(m.memory.usedPercent) }),
  },
  {
    id: 'disk.full',
    kind: 'metric',
    when: m => (m.disks ?? []).some(d => d.freePercent <= 8),
    until: m => (m.disks ?? []).every(d => d.freePercent > 12),
    text: 'disk.full', priority: 'important', cooldownMs: 6 * 60 * MIN,
    vars: m => {
      const worst = [...m.disks].sort((a, b) => a.freePercent - b.freePercent)[0];
      return { drive: worst.mount, free: fmt.bytes(worst.freeBytes) };
    },
  },

  // ── Ambient ──────────────────────────────────────────────────────────
  {
    id: 'cost.milestone',
    kind: 'ambient',
    when: m => (m.cost?.totalUsd ?? 0) > 0.5,
    text: 'cost.milestone', priority: 'ambient', cooldownMs: 30 * MIN,
    vars: (m, e, locale) => ({ usd: fmt.usd(m.cost.totalUsd, locale) }),
  },
  {
    id: 'usage.today',
    kind: 'ambient',
    when: m => (m.usage?.todayTokens ?? 0) > 0,
    text: 'usage.today', priority: 'ambient', cooldownMs: 45 * MIN,
    vars: (m, e, locale) => ({
      tokens: fmt.tokens(m.usage.todayTokens, locale),
      usd: fmt.usd(m.usage.todayUsd ?? 0, locale),
    }),
  },
  {
    id: 'idle',
    kind: 'ambient',
    when: () => true,
    text: 'idle', priority: 'ambient', cooldownMs: 12 * MIN,
  },
];
