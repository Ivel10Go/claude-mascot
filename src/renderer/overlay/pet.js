// One mascot: owns its DOM node, its rig player, and the small behaviour
// scheduler that keeps it doing something when nothing external is driving it.
// Event-driven reactions (Claude Code hooks, metric thresholds) override the
// scheduler through `react()`.

import { createMark } from './rig/mark.js';
import { createPlayer } from './rig/player.js';

const WIDTH = 96;

// Backstop for a looping reaction whose release never arrives (a dropped IPC
// message, a main-process timer that didn't fire). The main process is the
// normal authority on when a hold ends; this only stops the mascot being
// stranded mid-pose forever.
const MAX_REACTION_MS = 150_000;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = list => list[(Math.random() * list.length) | 0];

export function createPet(layer, bounds) {
  const mark = createMark(WIDTH);
  const node = document.createElement('div');
  node.className = 'pet';
  node.style.width = `${mark.width}px`;
  node.style.height = `${mark.height}px`;
  node.appendChild(mark.svg);
  layer.appendChild(node);

  const player = createPlayer(mark, 'idle');
  let lastPose = null;

  const state = {
    x: rand(bounds.width * 0.25, bounds.width * 0.75),   // ground contact point
    y: bounds.height,
    facing: 1,
    walking: false,
    speed: 42,          // px/s
    until: 0,           // when the current scheduled behaviour expires
    busy: false,        // an external reaction owns the rig right now
    busyUntil: 0,       // hard ceiling on that, see MAX_REACTION_MS
  };

  function setBounds(b) {
    bounds = b;
    state.y = bounds.height;
    state.x = Math.min(state.x, bounds.width - mark.width / 2);
  }

  function schedule(now) {
    // Weighted to look unhurried: mostly standing around, occasionally
    // wandering, with small punctuating beats.
    const choice = pick([
      'walk', 'walk', 'walk', 'walk',
      'idle', 'idle', 'idle',
      'blink', 'blink',
      'lookUp', 'scan', 'wave', 'think',
    ]);

    if (choice === 'walk') {
      state.walking = true;
      state.until = now + rand(1800, 4600);
      player.play('walk', { now });
      return;
    }

    state.walking = false;
    if (choice === 'idle') {
      state.until = now + rand(1800, 5000);
      player.play('idle', { now });
      return;
    }
    if (choice === 'think') {
      state.until = now + rand(2200, 4200);
      player.play('think', { now });
      return;
    }
    // One-shots hand control straight back to the scheduler.
    state.until = Infinity;
    player.play(choice, { now, then: () => { state.until = 0; } });
  }

  /** Reverses facing with a little squash-and-spring in between. */
  function flip(now) {
    state.facing *= -1;
    const resume = state.walking;
    player.play('turn', {
      now,
      then: () => player.play(resume ? 'walk' : 'idle', { now: performance.now() }),
    });
  }

  return {
    node,
    get x() { return state.x; },
    get y() { return state.y; },
    get animation() { return player.current; },
    /** How much of the torso is drawn in full colour — 1 full, 0 fully drained. */
    get bodyFill() { return lastPose ? lastPose.body.fill : 1; },
    setBounds,

    /** Where a speech bubble's tail should point: the top of the head. */
    headPoint() {
      return { x: state.x, y: state.y - mark.footOffset + mark.hitRect.y };
    },

    /** Screen-space rectangle used for overlay hit-testing. */
    hitBox() {
      const left = state.x - mark.width / 2 + mark.hitRect.x;
      const top = state.y - mark.footOffset + mark.hitRect.y;
      return { x: left, y: top, w: mark.hitRect.w, h: mark.hitRect.h };
    },

    /**
     * Plays an animation in response to something that happened. Looping
     * animations hold until the next react() or release(); one-shots give the
     * scheduler control back on their own.
     */
    react(name, { now = performance.now() } = {}) {
      state.busy = true;
      state.walking = false;
      state.until = Infinity;
      state.busyUntil = now + MAX_REACTION_MS;
      player.play(name, {
        now,
        then: () => { state.busy = false; state.until = 0; },
      });
    },

    /** Returns the pet to its own devices. */
    release() {
      state.busy = false;
      state.until = 0;
    },

    update(dt, now, metrics) {
      // A looping reaction holds until the main process releases it; if that
      // never lands, fall back to the pet's own behaviour rather than freezing.
      if (state.busy && now >= state.busyUntil) {
        state.busy = false;
        state.until = 0;
      }
      if (!state.busy && now >= state.until) schedule(now);

      if (state.walking && player.current === 'walk') {
        state.x += state.facing * state.speed * dt;
        const margin = mark.width * 0.35;
        if (state.x < margin) {
          state.x = margin;
          flip(now);
        } else if (state.x > bounds.width - margin) {
          state.x = bounds.width - margin;
          flip(now);
        }
      }

      node.style.transform =
        `translate3d(${(state.x - mark.width / 2).toFixed(1)}px, ` +
        `${(state.y - mark.footOffset).toFixed(1)}px, 0)` +
        ` scaleX(${state.facing})`;

      lastPose = player.update(now, metrics);
    },
  };
}
