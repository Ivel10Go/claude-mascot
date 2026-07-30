// One mascot: its physical body, its rig, and the small behaviour scheduler
// that keeps it doing something when nothing external is driving it.
//
// Three things can control the pet, in order of authority:
//   1. the cursor, while it is being dragged
//   2. gravity, whenever it is not standing on something
//   3. reactions from Claude Code, then its own scheduler

import { createMark } from './rig/mark.js';
import { createPlayer } from './rig/player.js';
import { createBody, step, resettle, GRAVITY } from './physics.js';

const WIDTH = 96;

// Backstop for a looping reaction whose release never arrives (a dropped IPC
// message, a main-process timer that didn't fire). The main process is the
// normal authority on when a hold ends; this only stops the mascot being
// stranded mid-pose forever.
const MAX_REACTION_MS = 150_000;

// A throw is built from how fast the cursor was actually moving, but a flick
// can be arbitrarily fast — this keeps it on screen and in character.
const THROW_SCALE = 0.85;
const MAX_THROW = 1800;

// How close to a window's side counts as touching it, and how fast the mascot
// hauls itself up. Climbing is what makes ledges reachable at all: on a screen
// of maximized windows every top edge is a full screen height above the floor.
const CLIMB_GRAB_PX = 14;
const CLIMB_SPEED = 70;      // px/s

// How far the mascot will jump sideways, and the band of heights it can clear.
const REACH_X = 380;
const MIN_RISE = 70;
const MAX_RISE = 330;

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
  const margin = mark.width * 0.35;
  const body = createBody(rand(bounds.width * 0.25, bounds.width * 0.75), bounds.height);

  let lastPose = null;
  let platforms = [];

  const state = {
    facing: 1,
    walking: false,
    speed: 42,          // px/s
    until: 0,           // when the current scheduled behaviour expires
    busy: false,        // an external reaction owns the rig right now
    busyUntil: 0,       // hard ceiling on that, see MAX_REACTION_MS
    airborne: false,    // last known physics mode, to detect transitions
    climb: null,        // { platform, edgeX, side } while scaling a window
  };

  // Cursor tracking for throw velocity.
  const grab = { dx: 0, dy: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0 };

  function setBounds(b) {
    bounds = b;
    body.x = Math.min(body.x, bounds.width - margin);
    body.y = Math.min(body.y, bounds.height);
  }

  function setPlatforms(next) {
    platforms = next;
    resettle(body, platforms, bounds);
  }

  /**
   * A window side the mascot is currently touching and could climb.
   *
   * Only the outer faces count — the pet climbs the outside of a window, so
   * an edge clipped by the screen border is not a real handhold.
   */
  function wallAt(x, y) {
    // The screen's own sides are the only surfaces guaranteed to reach the
    // floor. Without them the mascot is stranded: on a normal desktop every
    // window floats clear of the taskbar, so from the floor there is no ledge
    // within jumping range and no window side low enough to grab.
    if (x <= margin + CLIMB_GRAB_PX) {
      return { screenEdge: true, edgeX: margin, side: -1, topY: 0 };
    }
    if (x >= bounds.width - margin - CLIMB_GRAB_PX) {
      return { screenEdge: true, edgeX: bounds.width - margin, side: 1, topY: 0 };
    }

    for (const p of platforms) {
      if (y > p.y1 || y < p.y) continue;         // not alongside this window
      if (p.y >= y - 40) continue;               // top is already at our level
      if (p.leftOpen !== false && Math.abs(x - p.x0) <= CLIMB_GRAB_PX) {
        return { platform: p, edgeX: p.x0, side: -1 };
      }
      if (p.rightOpen !== false && Math.abs(x - p.x1) <= CLIMB_GRAB_PX) {
        return { platform: p, edgeX: p.x1, side: 1 };
      }
    }
    return null;
  }

  /**
   * Hops onto a nearby window edge, if one is within reach.
   *
   * Without this the mascot can only ever *fall* onto windows, so on a normal
   * desktop it would spend its whole life on the taskbar and the feature would
   * be invisible unless you picked it up and dropped it somewhere.
   */
  function findJumpTarget() {
    let best = null;
    for (const p of platforms) {
      const rise = body.y - p.y;
      if (rise < MIN_RISE || rise > MAX_RISE) continue;
      // Aim for the nearest point on the ledge that isn't its very edge.
      const target = Math.max(p.x0 + margin, Math.min(body.x, p.x1 - margin));
      if (target <= p.x0 || target >= p.x1) continue;      // ledge too narrow
      const dx = target - body.x;
      if (Math.abs(dx) > REACH_X) continue;
      if (!best || rise < best.rise) best = { platform: p, target, dx, rise };
    }
    return best;
  }

  function tryJump(now) {
    const best = findJumpTarget();
    if (!best) return false;

    // Clear the ledge by a little, then let gravity bring it down onto it.
    const apex = best.rise + 45;
    const vy = -Math.sqrt(2 * GRAVITY * apex);
    const timeUp = Math.abs(vy) / GRAVITY;

    body.mode = 'air';
    body.platform = null;
    body.vy = vy;
    // Reach the target around the apex, so it arrives descending onto the ledge.
    body.vx = best.dx / (timeUp * 1.2);
    if (best.dx !== 0) state.facing = best.dx > 0 ? 1 : -1;

    state.walking = false;
    state.busy = true;
    state.busyUntil = now + 4000;
    player.play('leap', { now, blend: 80 });
    return true;
  }

  function schedule(now) {
    // Weighted to look unhurried: mostly standing around, occasionally
    // wandering, with small punctuating beats.
    const choice = pick([
      'walk', 'walk', 'walk', 'walk',
      'idle', 'idle', 'idle',
      'blink', 'blink',
      'lookUp', 'scan', 'wave', 'think',
      'jump', 'jump',
    ]);

    if (choice === 'jump') {
      if (tryJump(now)) return;
      // Nothing in reach — fall through to wandering rather than standing
      // still waiting for a window to appear.
      state.walking = true;
      state.until = now + rand(1800, 4600);
      player.play('walk', { now });
      return;
    }

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
    get x() { return body.x; },
    get y() { return body.y; },
    get animation() { return player.current; },
    get held() { return body.mode === 'held'; },
    /** The ledge it would jump to right now, or null. Same logic as tryJump. */
    get jumpTarget() {
      const t = findJumpTarget();
      return t ? { rise: Math.round(t.rise), dx: Math.round(t.dx) } : null;
    },
    /** The window side it is touching right now, if any. */
    get wallTouch() { return Boolean(wallAt(body.x, body.y)); },
    /** How much of the torso is drawn in full colour — 1 full, 0 fully drained. */
    get bodyFill() { return lastPose ? lastPose.body.fill : 1; },
    setBounds,
    setPlatforms,

    /** Where a speech bubble's tail should point: the top of the head. */
    headPoint() {
      return { x: body.x, y: body.y - mark.footOffset + mark.hitRect.y };
    },

    /** Screen-space rectangle used for overlay hit-testing. */
    hitBox() {
      const left = body.x - mark.width / 2 + mark.hitRect.x;
      const top = body.y - mark.footOffset + mark.hitRect.y;
      return { x: left, y: top, w: mark.hitRect.w, h: mark.hitRect.h };
    },

    /** Cursor picked the mascot up. */
    grabAt(px, py, now = performance.now()) {
      body.mode = 'held';
      body.platform = null;
      body.vx = 0;
      body.vy = 0;
      grab.dx = body.x - px;
      grab.dy = body.y - py;
      grab.lastX = px;
      grab.lastY = py;
      grab.lastT = now;
      grab.vx = 0;
      grab.vy = 0;
      state.busy = true;
      state.busyUntil = Infinity;
      state.walking = false;
      player.play('drag', { now });
    },

    dragTo(px, py, now = performance.now()) {
      if (body.mode !== 'held') return;
      const dt = Math.max(1, now - grab.lastT) / 1000;
      // Smoothed so a single stuttered frame doesn't define the throw.
      grab.vx = grab.vx * 0.6 + ((px - grab.lastX) / dt) * 0.4;
      grab.vy = grab.vy * 0.6 + ((py - grab.lastY) / dt) * 0.4;
      grab.lastX = px;
      grab.lastY = py;
      grab.lastT = now;
      body.x = px + grab.dx;
      body.y = py + grab.dy;
    },

    /** Cursor let go — carry the motion into a throw. */
    releaseGrab(now = performance.now()) {
      if (body.mode !== 'held') return;
      const clamp = v => Math.max(-MAX_THROW, Math.min(MAX_THROW, v * THROW_SCALE));
      body.vx = clamp(grab.vx);
      body.vy = clamp(grab.vy);
      body.mode = 'air';
      state.busy = false;
      state.busyUntil = 0;
      state.until = 0;
      if (body.vx !== 0) state.facing = body.vx > 0 ? 1 : -1;
      player.play('fall', { now });
    },

    /**
     * Plays an animation in response to something that happened. Looping
     * animations hold until the next react() or release(); one-shots give the
     * scheduler control back on their own.
     */
    react(name, { now = performance.now() } = {}) {
      if (body.mode !== 'ground') return;   // gravity and the cursor outrank this
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
      if (body.mode === 'held') return;
      state.busy = false;
      state.until = 0;
    },

    update(dt, now, metrics) {
      // ── Climbing ─────────────────────────────────────────────────────
      if (body.mode === 'climb') {
        const climb = state.climb;
        const stillThere = climb && (climb.screenEdge || platforms.includes(climb.platform));
        if (!stillThere) {
          // The window moved or closed out from under it mid-climb.
          body.mode = 'air';
          body.vy = 0;
          state.climb = null;
          state.busy = true;
          state.busyUntil = Infinity;
          player.play('fall', { now, blend: 90 });
        } else {
          body.x = climb.edgeX;
          body.y -= CLIMB_SPEED * dt;

          const topY = climb.screenEdge ? climb.topY : climb.platform.y;
          if (body.y <= topY) {
            body.y = topY;
            body.vx = 0;
            body.vy = 0;
            state.climb = null;
            state.busy = false;
            state.until = 0;
            if (climb.screenEdge) {
              // Reached the top of the screen: let gravity settle it onto
              // whatever ledge is actually up here, rather than assuming one.
              body.mode = 'air';
              body.platform = null;
            } else {
              body.mode = 'ground';
              body.platform = climb.platform;
            }
          }

          // Climbing past a ledge on the way up: step onto it instead of
          // continuing to the top for no reason.
          if (state.climb) {
            for (const p of platforms) {
              if (Math.abs(p.y - body.y) > 4) continue;
              if (body.x < p.x0 - CLIMB_GRAB_PX || body.x > p.x1 + CLIMB_GRAB_PX) continue;
              if (p.x1 - p.x0 < margin * 3) continue;
              body.y = p.y;
              body.platform = p;
              body.mode = 'ground';
              state.climb = null;
              state.busy = false;
              state.until = 0;
              break;
            }
          }
          node.style.transform =
            `translate3d(${(body.x - mark.width / 2).toFixed(1)}px, ` +
            `${(body.y - mark.footOffset).toFixed(1)}px, 0)` +
            ` scaleX(${state.facing})`;
          lastPose = player.update(now, metrics);
          return;
        }
      }

      // Walking into the side of a window: grab on and go up.
      if (body.mode === 'ground' && state.walking && !state.busy) {
        const wall = wallAt(body.x, body.y);
        if (wall && wall.side === state.facing) {
          state.climb = wall;
          body.mode = 'climb';
          body.platform = null;
          state.walking = false;
          state.busy = true;
          state.busyUntil = now + 60_000;
          player.play('climb', { now, blend: 120 });
          return;
        }
      }

      // Walking is expressed as horizontal velocity so physics owns position.
      body.vx = body.mode === 'ground' && state.walking
        ? state.facing * state.speed
        : body.mode === 'ground' ? 0 : body.vx;

      const events = step(body, dt, platforms, bounds, margin);
      const airborne = body.mode !== 'ground';

      if (events.leftGround && !state.airborne) {
        // Walked off an edge: fall rather than moonwalk across thin air.
        state.busy = true;
        state.busyUntil = Infinity;
        player.play('fall', { now, blend: 90 });
      }

      if (events.landed && body.mode === 'ground') {
        state.busy = true;
        state.busyUntil = now + 2000;
        player.play('land', {
          now,
          blend: 60,
          then: () => { state.busy = false; state.until = 0; },
        });
      }

      if (events.hitWall && airborne) state.facing = body.vx >= 0 ? 1 : -1;
      state.airborne = airborne;

      if (!state.busy && !airborne && now >= state.busyUntil) {
        // A looping reaction holds until released; if that never lands, fall
        // back to the pet's own behaviour rather than freezing.
        state.busy = false;
      }
      if (state.busy && now >= state.busyUntil) {
        state.busy = false;
        state.until = 0;
      }
      if (!state.busy && !airborne && now >= state.until) schedule(now);

      // Turn around at the edge of whatever it is standing on.
      if (body.mode === 'ground' && state.walking && player.current === 'walk') {
        const onLedge = Boolean(body.platform);
        const limit = onLedge
          ? { lo: body.platform.x0 + margin, hi: body.platform.x1 - margin }
          : { lo: margin, hi: bounds.width - margin };
        const atEdge = (body.x <= limit.lo && state.facing < 0)
                    || (body.x >= limit.hi && state.facing > 0);
        // Screen edges are walls, but a window ledge is something it should
        // sometimes just step off — otherwise it never comes back down.
        if (atEdge && (!onLedge || Math.random() > 0.35)) flip(now);
      }

      node.style.transform =
        `translate3d(${(body.x - mark.width / 2).toFixed(1)}px, ` +
        `${(body.y - mark.footOffset).toFixed(1)}px, 0)` +
        ` scaleX(${state.facing})`;

      lastPose = player.update(now, metrics);
    },
  };
}
