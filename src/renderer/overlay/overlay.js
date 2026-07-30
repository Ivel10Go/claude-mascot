// Overlay entrypoint. Owns the frame loop, keeps the pet population in sync
// with config, and decides — every frame — whether the cursor is over a
// mascot, which is what lets a full-screen window stay click-through except
// exactly where the mascot is.

import { createPet } from './pet.js';
import { createBubble } from './bubble.js';
import { createDirector } from './director.js';

const layer = document.getElementById('layer');
const pets = [];
const pointer = { x: -1e4, y: -1e4, inside: false };

// Only the first pet talks. Extra pets are company, not a chorus.
const bubble = createBubble(layer);
let config = {};
const director = createDirector(() => config);

// A full-screen transparent layer repaints at the monitor's refresh rate if
// you let it, which on a high-refresh laptop panel costs far more than a
// desktop toy should. 30 fps is also stylistically right for a pixel-art
// character — the reference pets were baked frames at a similar cadence.
const TARGET_FPS = 24;
const FRAME_MS = 1000 / TARGET_FPS;

let bounds = { width: window.innerWidth, height: window.innerHeight };
let metrics = {};
let interactive = false;
let reported = { animation: null, fill: null, footY: null };
let last = performance.now();
let nextFrameDue = 0;

let platforms = [];
// Only one overlay reports back, or two displays overwrite each other's entry.
let isPrimary = false;
window.mascot.onRole(({ primary }) => { isPrimary = !!primary; });

function setPetCount(n) {
  while (pets.length < n) {
    const pet = createPet(layer, bounds);
    pet.setPlatforms(platforms);
    pets.push(pet);
  }
  while (pets.length > n) {
    const pet = pets.pop();
    if (pet === grabbed) { grabbed = null; window.mascot.setDragging(false); }
    pet.node.remove();
  }
}

function onResize() {
  bounds = { width: window.innerWidth, height: window.innerHeight };
  for (const pet of pets) pet.setBounds(bounds);
}

window.addEventListener('resize', onResize);
window.addEventListener('mousemove', e => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  if (grabbed) grabbed.dragTo(e.clientX, e.clientY);
});
window.addEventListener('mouseleave', () => { pointer.inside = false; });

/** The pet currently held by the cursor, if any. */
let grabbed = null;

function petAt(x, y) {
  // Front to back, so the visually topmost pet is the one you grab.
  for (let i = pets.length - 1; i >= 0; i--) {
    const b = pets[i].hitBox();
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return pets[i];
  }
  return null;
}

window.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const pet = petAt(e.clientX, e.clientY);
  if (!pet) return;
  grabbed = pet;
  pet.grabAt(e.clientX, e.clientY);
  // The cursor will leave the hit box while dragging, so the overlay has to
  // stay interactive until the button comes up.
  window.mascot.setDragging(true);
  e.preventDefault();
});

window.addEventListener('mouseup', () => {
  if (!grabbed) return;
  grabbed.releaseGrab();
  grabbed = null;
  window.mascot.setDragging(false);
});

/** True when the cursor is within any mascot's body box. */
function overPet() {
  if (!pointer.inside) return false;
  return petAt(pointer.x, pointer.y) !== null;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (now < nextFrameDue) return;
  // Anchor to the ideal grid, but resync after a long stall so the loop
  // never tries to "catch up" with a burst of frames.
  nextFrameDue = now - nextFrameDue > FRAME_MS ? now + FRAME_MS : nextFrameDue + FRAME_MS;

  const dt = Math.min((now - last) / 1000, 0.05);   // clamp after a stall
  last = now;

  for (const pet of pets) pet.update(dt, now, metrics);

  // While a line is still on screen only a critical one may cut in.
  const line = director.take(now, { onlyCritical: bubble.visible });
  if (line) {
    bubble.show(line.text, { now });
    window.mascot.reportBubble(line.text, line.ruleId);
    if (line.animation) pets[0]?.react(line.animation);
  }
  if (pets[0]) bubble.update(now, pets[0].headPoint(), bounds);

  // Toggling on every frame would spam IPC; only edges are sent.
  const want = overPet();
  if (want !== interactive) {
    interactive = want;
    window.mascot.setInteractive(want);
  }

  // Edge-triggered: lets the main process report what the rig is really doing
  // without a per-frame IPC message. bodyFill is quantised so a value drifting
  // in the last decimal doesn't produce a message every frame.
  const pet = isPrimary ? pets[0] : null;
  const playing = pet?.animation;
  const fill = pet ? Math.round(pet.bodyFill * 100) / 100 : null;
  // Rounded to 4px: enough to tell a title bar from the floor, coarse enough
  // that a walk cycle's bob doesn't emit a message every frame.
  const footY = pet ? Math.round(pet.y / 4) * 4 : null;
  if (playing && (playing !== reported.animation || fill !== reported.fill || footY !== reported.footY)) {
    reported = { animation: playing, fill, footY };
    window.mascot.reportAnimation(playing, fill, {
      footY,
      petX: Math.round(pet.x),
      onPlatform: pet ? pet.y < bounds.height - 2 : false,
      platformCount: platforms.length,
      // The pet's own decision, not a re-derivation: this distinguishes
      // "nothing in range" from "in range but never acting on it".
      jumpTarget: pet.jumpTarget,
      wallTouch: pet.wallTouch,
    });
  }
}

window.mascot.onMetrics(next => {
  metrics = next;
  director.observe(metrics);
});

// Hook and threshold events arrive here from the main process and take
// priority over the pet's own scheduler.
window.mascot.onReaction(({ animation, key, data, petIndex }) => {
  const targets = typeof petIndex === 'number' ? [pets[petIndex]] : pets;
  for (const pet of targets) if (pet) pet.react(animation);
  director.event({ key, data });
});

// The hold behind a sticky reaction lapsed — go back to wandering.
window.mascot.onRelease(() => {
  for (const pet of pets) pet.release();
});

// Top edges of real windows on this display, in local coordinates.
window.mascot.onPlatforms(next => {
  platforms = Array.isArray(next) ? next : [];
  for (const pet of pets) pet.setPlatforms(platforms);
});

window.mascot.onConfig(cfg => {
  config = cfg || {};
  setPetCount(Math.max(1, config.petCount ?? 1));
});

setPetCount(1);
requestAnimationFrame(frame);
