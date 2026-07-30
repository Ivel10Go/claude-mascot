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

// ── Props ────────────────────────────────────────────────────────────────
// Held or worn items, drawn from the same rectangles as the body. Each has a
// 0..1 amount in the pose; at 0 the whole group is display:none, so a mascot
// that never celebrates costs nothing for the confetti it isn't throwing.

const BAND_COLOR = '#a83d29';       // deeper than the body, so it reads as a band
const CLOTH_COLOR = '#f0e7d8';
const SPARK_COLOR = '#ffd9a0';

const BAND = { y: 6.5, h: 1.15, overhang: 0.6 };
const BAND_TAIL = { w: 3.6, h: 0.72, count: 2 };

// Pole rises from the right shoulder; the cloth hangs off its top half.
const FLAG = { poleX: 0.4, poleTop: -13.5, poleW: 0.55, rows: 4, rowW: 4.6, rowH: 1.05 };

const CONFETTI_COLORS = ['#d97757', '#f0e7d8', '#e0a355', '#7fb069', '#7cc5e8'];
const CONFETTI_COUNT = 16;

// Deterministic scatter: the burst has to look random but be identical every
// time, or two mascots celebrating together would give it away as noise.
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const frac = x => x - Math.floor(x);
  const r1 = frac(Math.sin((i + 1) * 12.9898) * 43758.5453);
  const r2 = frac(Math.sin((i + 1) * 78.233) * 43758.5453);
  const r3 = frac(Math.sin((i + 1) * 39.425) * 24634.6345);
  return {
    vx: (r1 - 0.5) * 30,
    vy: -10 - r2 * 16,
    spin: (r3 - 0.5) * 1080,
    w: 0.75 + r3 * 0.5,
    h: 0.5 + r1 * 0.35,
    colour: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  };
});

// Sparkle positions, in grid units relative to the body centre.
const SPARKS = [
  { x: -11, y: -2, r: 1.5 },
  { x: 10.5, y: -4, r: 1.15 },
  { x: -7, y: -8.5, r: 1.0 },
  { x: 7.5, y: -9.5, r: 1.35 },
];

/** Neutral rig pose. Animations receive one of these and mutate it. */
export function neutralPose(out = null) {
  const p = out || { arms: [{}, {}], legs: [], eyes: {}, body: {}, fx: {}, props: {} };

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

  // Props. Every `*Wave` is a value in -1..1, never a raw phase: two phases
  // crossfading would run the flag backwards through the blend.
  const r = p.props;
  r.headband = 0;      // 0 stowed above the head, 1 tied on
  r.bandWave = 0;      // tail flutter
  r.flag = 0;          // 0 hidden, 1 fully raised
  r.flagWave = 0;      // cloth ripple
  r.flagLean = 0;      // degrees the pole leans from vertical
  r.confetti = 0;      // burst progress, only ever runs forward
  r.confettiAmt = 0;   // visibility, so the burst can fade before it rewinds
  r.sparkle = 0;       // 0..1 brightness
  r.sparkleWave = 0;

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
  for (const key of PROP_KEYS) {
    out.props[key] = m(a.props[key], b.props[key]);
  }
  return out;
}

const PROP_KEYS = [
  'headband', 'bandWave', 'flag', 'flagWave', 'flagLean',
  'confetti', 'confettiAmt', 'sparkle', 'sparkleWave',
];

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

  // ── Props ──────────────────────────────────────────────────────────────
  // The headband rides the head, so it lives inside `rig` and inherits the
  // body's tilt and squash. Sparkles and confetti must not squash with it, so
  // they sit outside — confetti outside `root` as well, since a burst that
  // bobbed with the mascot's breathing would read as attached to it.

  const bandGroup = el('g', { display: 'none' });
  const band = el('rect', {
    x: BODY.x - BAND.overhang, y: BAND.y,
    width: BODY.w + BAND.overhang * 2, height: BAND.h, fill: BAND_COLOR,
  });
  bandGroup.appendChild(band);
  const bandTails = [];
  for (let i = 0; i < BAND_TAIL.count; i++) {
    const tail = el('rect', {
      x: BODY.x - BAND.overhang - BAND_TAIL.w, y: BAND.y,
      width: BAND_TAIL.w, height: BAND_TAIL.h, fill: BAND_COLOR,
    });
    bandTails.push(tail);
    bandGroup.appendChild(tail);
  }
  rig.insertBefore(bandGroup, eyes[0]);

  const flagGroup = el('g', { display: 'none' });
  flagGroup.appendChild(el('rect', {
    x: FLAG.poleX, y: FLAG.poleTop, width: FLAG.poleW,
    height: -FLAG.poleTop, fill: '#8a5a3c',
  }));
  const flagRows = [];
  for (let r = 0; r < FLAG.rows; r++) {
    const row = el('rect', {
      x: FLAG.poleX + FLAG.poleW, y: FLAG.poleTop + r * FLAG.rowH,
      width: FLAG.rowW * (1 - r * 0.07), height: FLAG.rowH + 0.05,
      fill: r % 2 ? CLOTH_COLOR : '#e4d9c6',
    });
    flagRows.push(row);
    flagGroup.appendChild(row);
  }
  rig.appendChild(flagGroup);

  const sparkGroup = el('g', { display: 'none' });
  const sparks = SPARKS.map(s => {
    const g = el('g', {});
    g.appendChild(el('rect', { x: -0.28, y: -1, width: 0.56, height: 2, fill: SPARK_COLOR }));
    g.appendChild(el('rect', { x: -1, y: -0.28, width: 2, height: 0.56, fill: SPARK_COLOR }));
    sparkGroup.appendChild(g);
    return { g, s };
  });
  root.appendChild(sparkGroup);

  const confettiGroup = el('g', { display: 'none' });
  const confetti = CONFETTI.map(c => {
    const r = el('rect', {
      x: -c.w / 2, y: -c.h / 2, width: c.w, height: c.h, fill: c.colour,
    });
    confettiGroup.appendChild(r);
    return r;
  });
  svg.appendChild(confettiGroup);

  // Whether each prop group was drawn last frame. A group at zero is skipped
  // entirely rather than having 16 rects rewritten with the same numbers.
  const shown = { band: false, flag: false, spark: false, confetti: false };

  /** Toggles a group's visibility; returns false when there is nothing to draw. */
  function visible(group, key, amount) {
    const on = amount > 0.004;
    if (on !== shown[key]) {
      shown[key] = on;
      group.setAttribute('display', on ? 'inline' : 'none');
    }
    return on;
  }

  function applyProps(r) {
    if (visible(bandGroup, 'band', r.headband)) {
      // Slides down onto the head as it is tied on.
      const drop = (1 - r.headband) * -4.5;
      bandGroup.setAttribute('opacity', Math.min(1, r.headband * 1.6));
      bandGroup.setAttribute('transform', `translate(0 ${drop.toFixed(2)})`);
      const pivotX = BODY.x - BAND.overhang;
      const pivotY = BAND.y + BAND.h / 2;
      for (let i = 0; i < bandTails.length; i++) {
        const angle = 10 + i * 16 + r.bandWave * (9 + i * 7);
        bandTails[i].setAttribute('transform', `rotate(${angle.toFixed(1)} ${pivotX} ${pivotY})`);
      }
    }

    if (visible(flagGroup, 'flag', r.flag)) {
      // Swings up from behind the shoulder rather than fading in on the spot.
      const anchorX = BODY.x + BODY.w + NUB.w * 0.4;
      const anchorY = NUB.y + NUB.h / 2;
      const lift = -100 * (1 - r.flag) + r.flagLean;
      flagGroup.setAttribute('opacity', Math.min(1, r.flag * 2.2));
      flagGroup.setAttribute(
        'transform',
        `translate(${anchorX} ${anchorY}) rotate(${lift.toFixed(1)}) scale(${(0.5 + r.flag * 0.5).toFixed(3)})`
      );
      for (let i = 0; i < flagRows.length; i++) {
        // A standing wave: neighbouring rows travel opposite ways, which is
        // what makes cloth read as cloth rather than as a rigid board.
        const dx = r.flagWave * Math.sin((i + 1) * 1.15) * 0.95;
        flagRows[i].setAttribute('transform', `translate(${dx.toFixed(2)} 0)`);
      }
    }

    if (visible(sparkGroup, 'spark', r.sparkle)) {
      sparkGroup.setAttribute('opacity', Math.min(1, r.sparkle));
      for (let i = 0; i < sparks.length; i++) {
        const { g, s } = sparks[i];
        // Each sparkle breathes on its own beat, so they never pop in unison.
        const beat = 0.65 + 0.35 * Math.sin((r.sparkleWave + i * 0.5) * Math.PI);
        const size = s.r * r.sparkle * beat;
        g.setAttribute(
          'transform',
          `translate(${PIVOT_X + s.x} ${11 + s.y}) rotate(${(r.sparkleWave * 60 + i * 22).toFixed(1)}) ` +
          `scale(${size.toFixed(3)})`
        );
      }
    }

    if (visible(confettiGroup, 'confetti', r.confettiAmt)) {
      confettiGroup.setAttribute('opacity', Math.min(1, r.confettiAmt));
      const k = r.confetti;
      for (let i = 0; i < confetti.length; i++) {
        const c = CONFETTI[i];
        // Ballistic, not linear: it is thrown up and out, then falls.
        const x = PIVOT_X + c.vx * k;
        const y = BODY.y + 3 + c.vy * k + 26 * k * k;
        confetti[i].setAttribute(
          'transform',
          `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(c.spin * k).toFixed(0)})`
        );
      }
    }
  }

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

    // Shadow tightens and fades as the body lifts off the ground. squashX is
    // allowed to go negative — that is how a spin flips the rig — so the
    // shadow tracks its magnitude, not its sign.
    const lift = Math.max(0, -p.bodyDy) / 4;
    shadow.setAttribute('rx', (BODY.w / 2) * (1 - lift * 0.35) * Math.abs(p.squashX));
    shadow.setAttribute('opacity', 0.22 * (1 - lift * 0.5) * p.opacity);

    applyProps(p.props);

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
