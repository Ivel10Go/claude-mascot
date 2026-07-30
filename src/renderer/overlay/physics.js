// Gravity, platforms and throwing.
//
// A body's position is its ground-contact point: the mascot stands *on* y.
// Platforms are the top edges of real windows, so the pet lands on your title
// bars. Coordinates are local to one overlay window, y growing downward.

const GRAVITY = 1500;        // px/s²
const TERMINAL_VY = 2600;    // stops a long fall turning into a teleport
const WALL_BOUNCE = 0.45;    // horizontal energy kept when hitting a screen edge
const LAND_BOUNCE = 0.22;    // vertical energy kept on impact
const REST_VY = 60;          // below this a bounce is not worth playing
// A platform is only landable if the pet crossed its top edge this frame while
// moving down; this tolerance absorbs the jitter of a 2 Hz window feed.
const EDGE_TOLERANCE = 6;

export function createBody(x, y) {
  return {
    x, y,
    vx: 0,
    vy: 0,
    mode: 'ground',     // 'ground' | 'air' | 'held'
    platform: null,     // the platform being stood on, or null for the floor
  };
}

/** Whether a platform supports the given x. */
const spans = (p, x) => x >= p.x0 && x <= p.x1;

/**
 * Highest platform strictly below `y` that spans `x` — the thing you would
 * land on if you fell from here. The floor is the fallback.
 */
function supportBelow(platforms, x, y, floorY) {
  let best = null;
  for (const p of platforms) {
    if (!spans(p, x)) continue;
    if (p.y < y - EDGE_TOLERANCE) continue;      // above us; not a landing
    if (!best || p.y < best.y) best = p;
  }
  if (best && best.y <= floorY) return best;
  return null;
}

/**
 * Advances one body. Returns which transitions happened this frame so the
 * caller can trigger animations without re-deriving them.
 */
export function step(body, dt, platforms, bounds, margin) {
  const floorY = bounds.height;
  const events = { landed: false, leftGround: false, hitWall: false };

  if (body.mode === 'held' || body.mode === 'climb') {
    // Driven by the cursor or by the climb logic; physics only observes.
    return events;
  }

  const prevY = body.y;

  if (body.mode === 'air') {
    body.vy = Math.min(body.vy + GRAVITY * dt, TERMINAL_VY);
  }

  body.x += body.vx * dt;
  body.y += body.vy * dt;

  // Screen edges. The mascot is inside the overlay, so these are hard walls.
  if (body.x < margin) {
    body.x = margin;
    if (body.vx < 0) { body.vx = -body.vx * WALL_BOUNCE; events.hitWall = true; }
  } else if (body.x > bounds.width - margin) {
    body.x = bounds.width - margin;
    if (body.vx > 0) { body.vx = -body.vx * WALL_BOUNCE; events.hitWall = true; }
  }

  if (body.mode === 'ground') {
    // Walked off the end of whatever it was standing on.
    if (body.platform && !spans(body.platform, body.x)) {
      body.mode = 'air';
      body.platform = null;
      body.vy = 0;
      events.leftGround = true;
    }
    // A window moved or closed from under it.
    if (body.platform && Math.abs(body.y - body.platform.y) > EDGE_TOLERANCE * 3) {
      body.mode = 'air';
      body.platform = null;
      events.leftGround = true;
    }
    return events;
  }

  // Falling: land on the first surface crossed on the way down.
  if (body.vy > 0) {
    let target = null;
    for (const p of platforms) {
      if (!spans(p, body.x)) continue;
      // Crossed from above during this step.
      if (prevY <= p.y + EDGE_TOLERANCE && body.y >= p.y) {
        if (!target || p.y < target.y) target = p;
      }
    }
    if (!target && body.y >= floorY) {
      target = { x0: -Infinity, x1: Infinity, y: floorY, floor: true };
    }

    if (target) {
      body.y = target.y;
      body.platform = target.floor ? null : target;
      if (Math.abs(body.vy) > REST_VY) {
        body.vy = -Math.abs(body.vy) * LAND_BOUNCE;
        body.vx *= 0.6;
      } else {
        body.vy = 0;
        body.vx = 0;
        body.mode = 'ground';
      }
      events.landed = true;
    }
  } else if (body.vy < 0) {
    // Rising — nothing to collide with; a low ceiling would just look odd.
    body.y = Math.max(body.y, 0);
  }

  return events;
}

/**
 * Where the mascot should stand right now, given a fresh set of platforms.
 * Used when the window layout changes underneath a grounded pet.
 */
export function resettle(body, platforms, bounds) {
  if (body.mode !== 'ground') return;
  const support = supportBelow(platforms, body.x, body.y - EDGE_TOLERANCE, bounds.height);
  const targetY = support ? support.y : bounds.height;
  if (Math.abs(targetY - body.y) > EDGE_TOLERANCE) {
    body.mode = 'air';
    body.platform = null;
  } else {
    body.platform = support ?? null;
    body.y = targetY;
  }
}

export { GRAVITY };
