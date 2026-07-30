// The mascot is built the way the original is: nothing but axis-aligned
// rectangles — body, two side nubs for arms, four legs, two eyes. No paths,
// no curves, no sprite frames. Every part is addressable, so an animation or
// a live metric can move exactly one of them.
//
// Geometry follows the reference generator's 24x24 authoring grid:
//   body (3, 5, 18, 12) · nubs 3 x 3.1 at y 10.95 · legs 1.49 x 3 at y 17
//   eyes 1.49 x 2.85 at y 8.1
//
// Nodes are created once and mutated per frame; rebuilding the DOM every
// frame is what makes naive SVG rigs expensive.

export const BODY = { x: 3, y: 5, w: 18, h: 12 };
export const NUB = { w: 3, h: 3.1, y: 10.95 };
export const LEG = { w: 1.49, h: 3, y: 17, xs: [3, 6, 15, 18] };
export const EYE = { w: 1.49, h: 2.85, y: 8.1, xs: [6, 16.51] };

export const LEG_COUNT = LEG.xs.length;
export const GROUND_Y = LEG.y + LEG.h;          // 20 — where the feet rest
const PIVOT_X = BODY.x + BODY.w / 2;            // 12 — centre line

// Padded so a tilt or an arm swing never clips at the edge of the element.
const VB = { x: -4, y: 1, w: 32, h: 24 };

const BODY_COLOR = '#d97757';
const EYE_COLOR = '#241611';

/** Neutral rig pose. Animations receive one of these and mutate it. */
export function neutralPose(out = null) {
  const p = out || { arms: [{}, {}], legs: [], eyes: {}, body: {}, fx: {} };

  p.bodyDy = 0;
  p.squashX = 1;
  p.squashY = 1;
  p.tilt = 0;
  p.scale = 1;
  p.opacity = 1;

  const b = p.body;
  b.hue = 14;
  b.sat = 62;
  b.light = 59;
  b.fill = 1;      // 1 = full colour, 0 = fully drained from the top down

  for (let i = 0; i < 2; i++) {
    const a = p.arms[i] || (p.arms[i] = {});
    a.angle = 0;   // degrees, positive swings the nub downward
    a.dx = 0;
    a.dy = 0;
    a.len = 1;     // multiplier on nub length
  }

  for (let i = 0; i < LEG_COUNT; i++) {
    const l = p.legs[i] || (p.legs[i] = {});
    l.angle = 0;   // rotation about the hip
    l.dy = 0;
    l.scaleY = 1;
  }

  const e = p.eyes;
  e.open = 1;
  e.dx = 0;
  e.dy = 0;
  e.squint = 0;    // narrows the eye horizontally

  const f = p.fx;
  f.glow = 0;
  f.tint = 0;      // -1 cold .. 0 neutral .. 1 hot
  f.sweat = 0;
  f.zzz = 0;

  return p;
}

/** Linear blend of two poses into `out`. Used to crossfade animations. */
export function lerpPose(a, b, k, out) {
  const m = (x, y) => x + (y - x) * k;

  for (const key of ['bodyDy', 'squashX', 'squashY', 'tilt', 'scale', 'opacity']) {
    out[key] = m(a[key], b[key]);
  }
  for (const key of ['hue', 'sat', 'light', 'fill']) {
    out.body[key] = m(a.body[key], b.body[key]);
  }
  for (let i = 0; i < 2; i++) {
    for (const key of ['angle', 'dx', 'dy', 'len']) {
      out.arms[i][key] = m(a.arms[i][key], b.arms[i][key]);
    }
  }
  for (let i = 0; i < LEG_COUNT; i++) {
    for (const key of ['angle', 'dy', 'scaleY']) {
      out.legs[i][key] = m(a.legs[i][key], b.legs[i][key]);
    }
  }
  for (const key of ['open', 'dx', 'dy', 'squint']) {
    out.eyes[key] = m(a.eyes[key], b.eyes[key]);
  }
  for (const key of ['glow', 'tint', 'sweat', 'zzz']) {
    out.fx[key] = m(a.fx[key], b.fx[key]);
  }
  return out;
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
};

let uid = 0;

/**
 * Builds the SVG for one mascot. Returns the element, an `apply(pose)` that
 * pushes a pose onto it, and the layout numbers the caller needs to place it.
 */
export function createMark(width = 96) {
  const height = (width * VB.h) / VB.w;
  const id = `mk${uid++}`;

  const svg = el('svg', {
    viewBox: `${VB.x} ${VB.y} ${VB.w} ${VB.h}`,
    width, height, overflow: 'visible',
  });
  svg.style.display = 'block';

  const defs = el('defs', {});
  const grad = el('radialGradient', { id: `${id}-glow` });
  grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#ffcf9a', 'stop-opacity': '0.9' }));
  grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#ffcf9a', 'stop-opacity': '0' }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  const glow = el('ellipse', {
    cx: PIVOT_X, cy: 12, rx: 16, ry: 13,
    fill: `url(#${id}-glow)`, opacity: 0,
  });
  svg.appendChild(glow);

  // Contact shadow, drawn in-rig rather than as a CSS drop-shadow filter — a
  // filter on a moving element repaints the whole overlay layer every frame.
  // It stays on the ground line while the body hops above it.
  const shadow = el('ellipse', {
    cx: PIVOT_X, cy: GROUND_Y, rx: BODY.w / 2, ry: 0.9,
    fill: '#000', opacity: 0.22,
  });
  svg.appendChild(shadow);

  // root carries bodyDy; rig carries tilt/squash pivoted on the feet so the
  // mascot deforms as though planted on the ground.
  const root = el('g', {});
  const rig = el('g', {});
  root.appendChild(rig);
  svg.appendChild(root);

  const legs = LEG.xs.map(x =>
    el('rect', { x, y: LEG.y, width: LEG.w, height: LEG.h, fill: BODY_COLOR })
  );
  for (const leg of legs) rig.appendChild(leg);

  const arms = [
    el('rect', { x: BODY.x - NUB.w, y: NUB.y, width: NUB.w, height: NUB.h, fill: BODY_COLOR }),
    el('rect', { x: BODY.x + BODY.w, y: NUB.y, width: NUB.w, height: NUB.h, fill: BODY_COLOR }),
  ];
  for (const arm of arms) rig.appendChild(arm);

  const body = el('rect', {
    x: BODY.x, y: BODY.y, width: BODY.w, height: BODY.h, fill: BODY_COLOR,
  });
  rig.appendChild(body);

  // The body doubles as the usage gauge: as the 5-hour limit is spent, this
  // dimmed rect fills downward from the top of the torso.
  const drain = el('rect', {
    x: BODY.x, y: BODY.y, width: BODY.w, height: 0, fill: '#8a4636', opacity: 0.55,
  });
  rig.appendChild(drain);

  const eyes = EYE.xs.map(x =>
    el('rect', { x, y: EYE.y, width: EYE.w, height: EYE.h, fill: EYE_COLOR })
  );
  for (const eye of eyes) rig.appendChild(eye);

  const sweat = el('rect', { x: 21.5, y: 6, width: 1.1, height: 1.8, fill: '#7cc5e8', opacity: 0 });
  const zzz = el('text', {
    x: 22, y: 5, 'font-family': 'Consolas, monospace',
    'font-size': 3.4, 'font-weight': 700, fill: '#9a8f83', opacity: 0,
  });
  zzz.textContent = 'z';
  rig.appendChild(sweat);
  rig.appendChild(zzz);

  function apply(p) {
    svg.style.opacity = p.opacity;
    root.setAttribute('transform', `translate(0 ${p.bodyDy})`);
    rig.setAttribute(
      'transform',
      `translate(${PIVOT_X} ${GROUND_Y}) ` +
      `rotate(${p.tilt}) ` +
      `scale(${p.scale * p.squashX} ${p.scale * p.squashY}) ` +
      `translate(${-PIVOT_X} ${-GROUND_Y})`
    );

    const hue = p.body.hue - p.fx.tint * 12;
    const light = p.body.light + (p.fx.tint < 0 ? p.fx.tint * 7 : 0);
    const fill = `hsl(${hue} ${p.body.sat}% ${light}%)`;
    body.setAttribute('fill', fill);

    for (let i = 0; i < LEG_COUNT; i++) {
      const l = p.legs[i];
      const hipX = LEG.xs[i] + LEG.w / 2;
      legs[i].setAttribute(
        'transform',
        `translate(0 ${l.dy}) rotate(${l.angle} ${hipX} ${LEG.y}) ` +
        `translate(${hipX} ${LEG.y}) scale(1 ${l.scaleY}) translate(${-hipX} ${-LEG.y})`
      );
      legs[i].setAttribute('fill', fill);
    }

    for (let i = 0; i < 2; i++) {
      const a = p.arms[i];
      const side = i === 0 ? -1 : 1;
      // Shoulder is the nub's inner edge, so it swings out from the torso.
      const shoulderX = i === 0 ? BODY.x : BODY.x + BODY.w;
      const shoulderY = NUB.y + NUB.h / 2;
      arms[i].setAttribute(
        'transform',
        `translate(${a.dx} ${a.dy}) rotate(${a.angle * side} ${shoulderX} ${shoulderY}) ` +
        `translate(${shoulderX} ${shoulderY}) scale(${a.len} 1) translate(${-shoulderX} ${-shoulderY})`
      );
      arms[i].setAttribute('fill', fill);
    }

    const drained = BODY.h * (1 - Math.max(0, Math.min(1, p.body.fill)));
    drain.setAttribute('height', drained);
    drain.setAttribute('opacity', drained > 0.01 ? 0.55 : 0);

    for (let i = 0; i < 2; i++) {
      const e = p.eyes;
      const h = EYE.h * Math.max(e.open, 0.06);
      const w = EYE.w * (1 - e.squint * 0.45);
      // Eyes shut toward their own centre rather than their top edge.
      eyes[i].setAttribute('x', EYE.xs[i] + e.dx + (EYE.w - w) / 2);
      eyes[i].setAttribute('y', EYE.y + e.dy + (EYE.h - h) / 2);
      eyes[i].setAttribute('width', w);
      eyes[i].setAttribute('height', h);
    }

    // Shadow tightens and fades as the body lifts off the ground.
    const lift = Math.max(0, -p.bodyDy) / 4;
    shadow.setAttribute('rx', (BODY.w / 2) * (1 - lift * 0.35) * p.squashX);
    shadow.setAttribute('opacity', 0.22 * (1 - lift * 0.5) * p.opacity);

    glow.setAttribute('opacity', p.fx.glow);
    sweat.setAttribute('opacity', p.fx.sweat);
    sweat.setAttribute('y', 6 + p.fx.sweat * 1.5);
    zzz.setAttribute('opacity', p.fx.zzz);
    zzz.setAttribute('y', 5 - p.fx.zzz * 2.5);
  }

  return {
    svg,
    apply,
    width,
    height,
    /** Distance from the element's top edge down to the ground line, in px. */
    footOffset: ((GROUND_Y - VB.y) / VB.h) * height,
    /** Body box in element-local px, for cursor hit-testing. */
    hitRect: {
      x: ((BODY.x - NUB.w - VB.x) / VB.w) * width,
      y: ((BODY.y - VB.y) / VB.h) * height,
      w: ((BODY.w + NUB.w * 2) / VB.w) * width,
      h: ((GROUND_Y - BODY.y) / VB.h) * height,
    },
  };
}
