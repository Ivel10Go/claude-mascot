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
let reported = { animation: null, fill: null };
let last = performance.now();
let nextFrameDue = 0;

function setPetCount(n) {
  while (pets.length < n) pets.push(createPet(layer, bounds));
  while (pets.length > n) {
    const pet = pets.pop();
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
});
window.addEventListener('mouseleave', () => { pointer.inside = false; });

/** True when the cursor is within any mascot's body box. */
function overPet() {
  if (!pointer.inside) return false;
  for (const pet of pets) {
    const b = pet.hitBox();
    if (pointer.x >= b.x && pointer.x <= b.x + b.w &&
        pointer.y >= b.y && pointer.y <= b.y + b.h) return true;
  }
  return false;
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
  const playing = pets[0]?.animation;
  const fill = pets[0] ? Math.round(pets[0].bodyFill * 100) / 100 : null;
  if (playing && (playing !== reported.animation || fill !== reported.fill)) {
    reported = { animation: playing, fill };
    window.mascot.reportAnimation(playing, fill);
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

window.mascot.onConfig(cfg => {
  config = cfg || {};
  setPetCount(Math.max(1, config.petCount ?? 1));
});

setPetCount(1);
requestAnimationFrame(frame);
