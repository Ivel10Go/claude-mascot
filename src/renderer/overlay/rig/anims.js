// Animations are procedural pose functions rather than keyframe tables. Each
// receives elapsed time plus a live metrics object and writes onto an
// already-neutral pose. That is what lets a metric drive geometry directly —
// "drain the torso by however much of the 5-hour limit is gone" is one
// expression here instead of a hand-authored timeline somewhere else.
//
//   anims     — mutually exclusive body states, crossfaded by the player
//   modifiers — always-on overlays driven by metrics, applied after blending
//
// The four legs read as two feet: 0+1 are the left pair, 2+3 the right pair.

import { LEG_COUNT } from './mark.js';

const TAU = Math.PI * 2;
const sin = (t, period, phase = 0) => Math.sin((t / period) * TAU + phase);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const easeOut = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

const LEFT_PAIR = [0, 1];
const RIGHT_PAIR = [2, 3];

// The four legs never move in lockstep. Each carries a small phase offset and
// its own share of a lean, which is what stops the walk reading as two blocks
// sliding back and forth.
const LEG_PHASE = [0, 0.055, 0.5, 0.555];
const LEG_LEAN = [-7, -8, -8, -9];

/** Fades a one-shot in and out so it never pops at either end. */
const envelope = (t, dur, ramp = 250) =>
  clamp(t / ramp, 0, 1) * clamp((dur - t) / ramp, 0, 1);

/**
 * Height of a hop over a 0..1 cycle, with gravity's asymmetry: quick rise
 * eased out, a beat of hang time, then an accelerating fall. A plain sine
 * gives equal rise and fall and reads weightless.
 */
function hop(k) {
  const c = ((k % 1) + 1) % 1;
  if (c < 0.42) return Math.sin((c / 0.42) * (Math.PI / 2));   // sine.out, rising
  const d = (c - 0.42) / 0.58;
  return 1 - d * d * d;                                        // power3.in, falling
}

/**
 * Holds a cycle at its extremes instead of sweeping through them evenly.
 * `bias` of 0 is a plain triangle wave; higher values dwell at each end,
 * which is what gives a walk its rhythm.
 */
function held(k, bias = 0.35) {
  const s = Math.sin(k * TAU);
  return Math.sign(s) * Math.pow(Math.abs(s), 1 - bias);
}

export const anims = {
  // ── Ambient ──────────────────────────────────────────────────────────
  idle: {
    loop: true,
    pose(t, m, p) {
      const breathe = sin(t, 2800);
      p.bodyDy = breathe * -0.35;
      p.squashY = 1 + breathe * 0.018;
      p.squashX = 1 - breathe * 0.014;
      p.tilt = sin(t, 6200) * 0.8;
      // Arms drift a hair out of sync so it never looks frozen.
      p.arms[0].angle = 3 + sin(t, 3400) * 2.5;
      p.arms[1].angle = 3 + sin(t, 3400, 0.9) * 2.5;
    },
  },

  blink: {
    dur: 150,
    pose(t, m, p) {
      const k = t / 150;
      p.eyes.open = k < 0.5 ? 1 - k * 2 : (k - 0.5) * 2;
      p.bodyDy = sin(t, 2800) * -0.35;
    },
  },

  lookUp: {
    dur: 1700,
    pose(t, m, p) {
      const k = envelope(t, 1700, 380);
      p.tilt = -7 * k;
      p.eyes.dy = -0.8 * k;
      p.bodyDy = -0.5 * k;
      p.arms[0].angle = -14 * k;
      p.arms[1].angle = -14 * k;
      // Front legs lift slightly, as though craning upward.
      for (const i of LEFT_PAIR) p.legs[i].scaleY = 1 - 0.12 * k;
    },
  },

  scan: {
    dur: 2400,
    pose(t, m, p) {
      const k = Math.sin((t / 2400) * TAU);
      p.eyes.dx = k * 0.9;
      p.tilt = k * 3;
      p.bodyDy = sin(t, 2800) * -0.35;
    },
  },

  // ── Locomotion ───────────────────────────────────────────────────────
  walk: {
    loop: true,
    pose(t, m, p) {
      const cycle = t / 520;
      // Two footfalls per cycle, each with a proper rise-and-drop.
      const bounce = hop(cycle * 2);
      p.bodyDy = -bounce * 0.55;
      p.squashY = 1 + bounce * 0.035;
      p.squashX = 1 - bounce * 0.03;
      p.tilt = held(cycle) * 2.2;

      for (let i = 0; i < LEG_COUNT; i++) {
        const swing = held(cycle + LEG_PHASE[i]);
        p.legs[i].angle = swing * 26 + LEG_LEAN[i] * 0.15;
        p.legs[i].dy = -Math.max(0, swing) * 0.5;
      }
      p.arms[0].angle = held(cycle + 0.5) * 16;
      p.arms[1].angle = held(cycle) * 16;
    },
  },

  run: {
    loop: true,
    pose(t, m, p) {
      const cycle = t / 260;
      const bounce = hop(cycle * 2);
      p.bodyDy = -bounce * 1.1;
      p.squashY = 1 + bounce * 0.07;
      p.squashX = 1 - bounce * 0.06;
      p.tilt = 6 + held(cycle, 0.2) * 3;
      for (let i = 0; i < LEG_COUNT; i++) {
        p.legs[i].angle = held(cycle + LEG_PHASE[i], 0.2) * 42 + LEG_LEAN[i] * 0.3;
      }
      p.arms[0].angle = held(cycle + 0.5, 0.2) * 34;
      p.arms[1].angle = held(cycle, 0.2) * 34;
      p.eyes.squint = 0.3;
    },
  },

  // Plays while the pet reverses facing: it pinches, then springs back.
  turn: {
    dur: 240,
    pose(t, m, p) {
      const k = Math.sin((t / 240) * Math.PI);
      p.squashX = 1 - k * 0.7;
      p.squashY = 1 + k * 0.1;
      p.tilt = k * 6;
    },
  },

  // ── Reactions ────────────────────────────────────────────────────────
  wave: {
    dur: 1500,
    pose(t, m, p) {
      const k = envelope(t, 1500, 240);
      // Right nub goes up and flaps; the body leans away to counterbalance.
      p.arms[1].angle = -62 * k + Math.sin((t / 260) * TAU) * 22 * k;
      p.arms[1].len = 1 + 0.25 * k;
      p.arms[0].angle = 8 * k;
      p.tilt = -3.5 * k;
      p.bodyDy = -0.3 * k;
      p.eyes.squint = 0.35 * k;
    },
  },

  think: {
    loop: true,
    pose(t, m, p) {
      p.tilt = -4 + sin(t, 3600) * 1.4;
      p.bodyDy = sin(t, 3200) * -0.3;
      p.eyes.open = 0.62;
      p.eyes.dx = 0.55 + sin(t, 3600) * 0.25;
      p.eyes.dy = -0.25;
      // One nub raised as though propping up a chin.
      p.arms[1].angle = -34 + sin(t, 3600) * 4;
      p.arms[0].angle = 6;
    },
  },

  celebrate: {
    dur: 1900,
    pose(t, m, p) {
      const k = clamp((1900 - t) / 550, 0, 1);
      const air = hop(t / 620);
      p.bodyDy = -air * 3.4 * k;
      // Anticipation: it compresses just before leaving the ground.
      p.squashY = 1 + air * 0.09 * k - Math.max(0, 0.25 - air) * 0.4 * k;
      p.squashX = 1 - air * 0.07 * k + Math.max(0, 0.25 - air) * 0.3 * k;
      p.tilt = Math.sin((t / 620) * TAU) * 5 * k;
      p.arms[0].angle = -70 * k;
      p.arms[1].angle = -70 * k;
      p.eyes.squint = 0.5 * k;
      p.fx.glow = 0.45 * k;
      // Legs tuck up at the top of each hop.
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].scaleY = 1 - air * 0.3 * k;
    },
  },

  // Claude Code is blocked on a permission prompt: this has to be unmissable.
  alert: {
    loop: true,
    pose(t, m, p) {
      const pulse = (Math.sin((t / 440) * TAU) + 1) / 2;
      p.bodyDy = -hop(t / 440) * 2.6;
      p.scale = 1 + pulse * 0.06;
      p.fx.glow = 0.3 + pulse * 0.55;
      p.eyes.open = 1.25;
      p.arms[0].angle = -55 - pulse * 18;
      p.arms[1].angle = -55 - pulse * 18;
      p.body.light = 62;
    },
  },

  // The 5-hour limit actually ran out (StopFailure / rate_limit). It flops
  // flat and stays there — this is the one state that should look defeated.
  limitHit: {
    loop: true,
    pose(t, m, p) {
      const settle = clamp(t / 700, 0, 1);
      const drop = easeOut(settle);
      p.squashY = 1 - drop * 0.45;
      p.squashX = 1 + drop * 0.3;
      p.tilt = drop * 9 + Math.sin(t / 1500) * 1.2;
      p.eyes.open = 1 - drop * 0.88;
      p.eyes.dy = drop * 0.5;
      p.arms[0].angle = drop * 74;
      p.arms[1].angle = drop * 74;
      p.body.sat = 62 - drop * 34;
      p.body.light = 59 - drop * 12;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].scaleY = 1 - drop * 0.6;
    },
  },

  // A subagent was spawned: it splits briefly, then snaps back together.
  clone: {
    dur: 900,
    pose(t, m, p) {
      const k = envelope(t, 900, 200);
      p.squashX = 1 + k * 0.35;
      p.squashY = 1 - k * 0.12;
      p.eyes.dx = Math.sin((t / 220) * TAU) * 0.7 * k;
      p.arms[0].angle = -24 * k;
      p.arms[1].angle = -24 * k;
      p.fx.glow = k * 0.3;
    },
  },

  // The 5-hour limit actually ran out. Deliberately the bleakest pose in the
  // set: it drops, splays, and stops looking at you.
  limitHit: {
    loop: true,
    pose(t, m, p) {
      const collapse = clamp(t / 700, 0, 1);
      const slump = easeOut(collapse);
      p.squashY = 1 - slump * 0.42;
      p.squashX = 1 + slump * 0.3;
      p.bodyDy = slump * 1.4;
      p.tilt = slump * 5 + Math.sin(t / 1400) * 1.2;
      // Eyes go to flat dead slits rather than closing.
      p.eyes.open = 1 - slump * 0.86;
      p.eyes.squint = slump * 0.5;
      p.eyes.dy = slump * 0.6;
      p.arms[0].angle = slump * 72;
      p.arms[1].angle = slump * 72;
      p.body.sat = 62 - slump * 34;
      p.body.light = 59 - slump * 8;
      p.fx.sweat = slump * 0.5;
      // Legs splay outward under the weight.
      for (let i = 0; i < LEG_COUNT; i++) {
        p.legs[i].angle = (i < 2 ? -1 : 1) * slump * 26;
        p.legs[i].scaleY = 1 - slump * 0.35;
      }
    },
  },

  // A subagent spawned: the body stretches sideways and snaps back, as though
  // something just split off it.
  clone: {
    dur: 700,
    pose(t, m, p) {
      const k = t / 700;
      const split = Math.sin(clamp(k * 2, 0, 1) * Math.PI);
      p.squashX = 1 + split * 0.55;
      p.squashY = 1 - split * 0.2;
      p.fx.glow = split * 0.55;
      p.eyes.open = 1 + split * 0.3;
      p.arms[0].angle = -split * 40;
      p.arms[1].angle = -split * 40;
      p.arms[0].len = 1 + split * 0.8;
      p.arms[1].len = 1 + split * 0.8;
    },
  },

  stumble: {
    dur: 950,
    pose(t, m, p) {
      const k = clamp((950 - t) / 950, 0, 1);
      p.tilt = Math.sin((t / 190) * TAU) * 16 * k;
      p.bodyDy = -Math.abs(Math.sin((t / 320) * Math.PI)) * 1.2;
      p.eyes.open = 1.3;
      p.arms[0].angle = -40 * k;
      p.arms[1].angle = -25 * k;
      for (const i of LEFT_PAIR) p.legs[i].angle = 34 * k;
      for (const i of RIGHT_PAIR) p.legs[i].angle = -22 * k;
    },
  },

  // ── Tool-specific work states ────────────────────────────────────────
  typing: {
    loop: true,
    pose(t, m, p) {
      p.tilt = 4;
      p.bodyDy = sin(t, 200) * -0.18;
      p.eyes.open = 0.75;
      p.eyes.dy = 0.35;
      // Both nubs hammer away, out of phase.
      p.arms[0].angle = 26 + Math.sin((t / 105) * TAU) * 16;
      p.arms[1].angle = 26 + Math.sin((t / 105) * TAU + Math.PI) * 16;
    },
  },

  digging: {
    loop: true,
    pose(t, m, p) {
      const k = (t / 560) % 1;
      const dig = Math.sin(k * TAU);
      p.tilt = 9 + dig * 6;
      p.bodyDy = Math.abs(dig) * 0.5;
      p.squashY = 1 - Math.abs(dig) * 0.05;
      p.arms[1].angle = 30 + dig * 46;
      p.arms[0].angle = 14;
      p.eyes.open = 0.7;
      p.eyes.dy = 0.3;
    },
  },

  searching: {
    loop: true,
    pose(t, m, p) {
      const sweep = Math.sin((t / 1600) * TAU);
      p.tilt = sweep * 6;
      p.eyes.dx = sweep * 1.0;
      p.eyes.open = 1.1;
      p.bodyDy = sin(t, 1900) * -0.3;
      // One nub extends like a probe in the direction of the sweep.
      p.arms[sweep > 0 ? 1 : 0].angle = -30;
      p.arms[sweep > 0 ? 1 : 0].len = 1.5;
    },
  },

  broadcasting: {
    loop: true,
    pose(t, m, p) {
      const pulse = (Math.sin((t / 900) * TAU) + 1) / 2;
      p.bodyDy = sin(t, 2200) * -0.3;
      p.arms[0].angle = -48;
      p.arms[1].angle = -48;
      p.arms[0].len = 1 + pulse * 0.5;
      p.arms[1].len = 1 + pulse * 0.5;
      p.fx.glow = pulse * 0.3;
    },
  },

  // ── Rest ─────────────────────────────────────────────────────────────
  curl: {
    loop: true,
    pose(t, m, p) {
      const breathe = sin(t, 4400);
      p.squashY = 0.68 + breathe * 0.015;
      p.squashX = 1.12;
      p.bodyDy = 0.4;
      p.eyes.open = 0.2;
      p.arms[0].angle = 46;
      p.arms[1].angle = 46;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].scaleY = 0.35;
    },
  },

  sleep: {
    loop: true,
    pose(t, m, p) {
      const breathe = sin(t, 5000);
      p.squashY = 0.62 + breathe * 0.03;
      p.squashX = 1.16 - breathe * 0.02;
      p.eyes.open = 0.06;
      p.fx.zzz = (Math.sin((t / 2800) * TAU) + 1) / 2;
      p.fx.tint = -0.3;
      p.arms[0].angle = 52;
      p.arms[1].angle = 52;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].scaleY = 0.25;
    },
  },

  layDown: {
    loop: true,
    pose(t, m, p) {
      p.tilt = 74;
      p.bodyDy = 1.2;
      p.eyes.open = 0.4;
      p.eyes.dy = sin(t, 5400) * 0.2;
      p.arms[0].angle = 20;
      p.arms[1].angle = -20;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].angle = 12;
    },
  },

  dangle: {
    loop: true,
    pose(t, m, p) {
      // Hanging off a window edge by one nub: everything swings below it.
      const swing = Math.sin((t / 2100) * TAU);
      p.tilt = 180 + swing * 12;
      p.eyes.open = 0.9;
      p.arms[0].angle = -70;
      p.arms[1].angle = 24 + swing * 8;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].angle = swing * 9;
    },
  },

  // ── Physics states ───────────────────────────────────────────────────
  fall: {
    loop: true,
    pose(t, m, p) {
      p.tilt = (t / 6) % 360;
      p.squashY = 1.1;
      p.squashX = 0.92;
      p.eyes.open = 1.35;
      p.arms[0].angle = -75;
      p.arms[1].angle = -75;
      for (let i = 0; i < LEG_COUNT; i++) p.legs[i].angle = Math.sin(t / 90 + i) * 18;
    },
  },

  land: {
    dur: 360,
    pose(t, m, p) {
      const k = t / 360;
      const squash = Math.sin(k * Math.PI) * (1 - k * 0.5);
      p.squashY = 1 - squash * 0.4;
      p.squashX = 1 + squash * 0.32;
      p.eyes.open = 1 - squash * 0.75;
      p.arms[0].angle = -30 * squash;
      p.arms[1].angle = -30 * squash;
    },
  },

  drag: {
    loop: true,
    pose(t, m, p) {
      // Held by the cursor: limbs hang and sway under their own weight.
      p.squashY = 1.06;
      p.squashX = 0.96;
      p.tilt = sin(t, 900) * 4;
      p.eyes.open = 1.2;
      p.arms[0].angle = 62 + sin(t, 780) * 6;
      p.arms[1].angle = 62 + sin(t, 780, 0.7) * 6;
      for (let i = 0; i < LEG_COUNT; i++) {
        p.legs[i].angle = sin(t, 820, i * 0.6) * 10;
      }
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Modifiers run after animation blending and read live metrics. They are how
// machine and Claude-usage state reach the geometry without every animation
// needing to know about them.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Whether the Claude readings are currently trustworthy.
 *
 * They arrive only while a Claude Code session is rendering its status line.
 * Once that stops, the store flags them stale — and a gauge that keeps showing
 * the last value it happened to see is worse than one showing nothing, because
 * it looks authoritative while being wrong.
 */
const liveLimits = m => m.limits && !m.limits.stale;

export const modifiers = [
  // The torso *is* the gauge: it drains from the top down as the 5-hour
  // limit is consumed, and desaturates as it goes. Full colour means either
  // a fresh budget or no reading at all — never a stale one.
  function tokenDrain(p, m) {
    if (!liveLimits(m)) return;
    const used = m.limits.fiveHour?.usedPercent;
    if (typeof used !== 'number' || used <= 0) return;
    const spent = clamp(used / 100, 0, 1);
    p.body.fill = 1 - spent;
    p.body.sat -= spent * 20;
  },

  // Sustained CPU load runs it hot: warmer colour, a tremor, and sweat.
  function thermal(p, m, now) {
    const load = clamp((m.cpu?.load ?? 0) / 100, 0, 1);
    const heat = clamp((load - 0.6) / 0.4, 0, 1);
    if (heat <= 0) return;
    p.fx.tint = Math.max(p.fx.tint, heat);
    p.fx.sweat = Math.max(p.fx.sweat, heat * 0.9);
    p.tilt += Math.sin(now / 42) * heat * 1.2;
    p.bodyDy += Math.sin(now / 33) * heat * 0.12;
  },

  // Low battery droops and dims the whole rig.
  function lowBattery(p, m) {
    const pct = m.battery?.percent;
    if (typeof pct !== 'number' || m.battery?.charging || pct > 25) return;
    const droop = clamp((25 - pct) / 25, 0, 1);
    p.opacity *= 1 - droop * 0.28;
    p.squashY *= 1 - droop * 0.1;
    p.squashX *= 1 + droop * 0.05;
    p.eyes.open *= 1 - droop * 0.45;
    p.arms[0].angle += droop * 30;
    p.arms[1].angle += droop * 30;
    p.body.light -= droop * 9;
  },

  // On mains power: an energy pulse runs through the body.
  function charging(p, m, now) {
    if (!m.battery?.charging) return;
    const wave = (Math.sin((now / 1300) * TAU) + 1) / 2;
    p.body.light += wave * 9;
    p.fx.glow = Math.max(p.fx.glow, wave * 0.18);
  },

  // Context window nearly full: the torso visibly bloats before compaction.
  // Same source as the limits, so the same staleness applies.
  function contextFull(p, m) {
    if (!liveLimits(m)) return;
    const used = m.context?.usedPercent;
    if (typeof used !== 'number' || used < 75) return;
    const k = clamp((used - 75) / 25, 0, 1);
    p.squashX *= 1 + k * 0.14;
    p.squashY *= 1 + k * 0.06;
    p.fx.sweat = Math.max(p.fx.sweat, k * 0.7);
  },
];

/** Applies every modifier in order. Cheap enough to run each frame. */
export function applyModifiers(pose, metrics, now) {
  for (const mod of modifiers) mod(pose, metrics, now);
  return pose;
}
