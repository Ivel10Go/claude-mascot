// Renders one instance of the rig per animation so the whole set can be
// eyeballed at once, with live sliders for the metric-driven modifiers.
// This is the harness the animations are tuned against.

import { createMark } from '../overlay/rig/mark.js';
import { createPlayer } from '../overlay/rig/player.js';
import { anims } from '../overlay/rig/anims.js';

const grid = document.getElementById('grid');
const instances = [];

for (const name of Object.keys(anims)) {
  const tile = document.createElement('div');
  tile.className = 'tile';

  const stage = document.createElement('div');
  stage.className = 'stage';
  const mark = createMark(88);
  stage.appendChild(mark.svg);

  const label = document.createElement('div');
  label.className = 'name';
  label.textContent = name;

  tile.appendChild(stage);
  tile.appendChild(label);
  grid.appendChild(tile);

  const player = createPlayer(mark, name);
  // One-shots would hand control back to a fallback; here each tile should
  // just replay its own animation forever.
  player.play(name, { now: performance.now(), blend: 0, then: replay(name) });
  instances.push({ name, player });

  function replay(anim) {
    return function loop() {
      player.play(anim, { now: performance.now(), blend: 0, then: loop });
    };
  }
}

const metrics = {
  limits: { fiveHour: { usedPercent: 0 } },
  cpu: { load: 0 },
  battery: { percent: 100, charging: false },
  context: { usedPercent: 0 },
};

const bind = (id, out, apply, suffix = '%') => {
  const input = document.getElementById(id);
  const output = document.getElementById(out);
  const sync = () => {
    const v = Number(input.value);
    apply(v);
    output.textContent = `${v}${suffix}`;
  };
  input.addEventListener('input', sync);
  sync();
};

bind('m-limit', 'o-limit', v => { metrics.limits.fiveHour.usedPercent = v; });
bind('m-cpu', 'o-cpu', v => { metrics.cpu.load = v; });
bind('m-batt', 'o-batt', v => { metrics.battery.percent = v; });
bind('m-ctx', 'o-ctx', v => { metrics.context.usedPercent = v; });
document.getElementById('m-charging').addEventListener('change', e => {
  metrics.battery.charging = e.target.checked;
});

function step(now) {
  for (const { player } of instances) player.update(now, metrics);
}

function frame(now) {
  step(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Deterministic entry point for automated checks: drive the rig to an exact
// timestamp instead of waiting on rAF, which is throttled when the page is
// not compositing.
window.__rig = { instances, metrics, step };
