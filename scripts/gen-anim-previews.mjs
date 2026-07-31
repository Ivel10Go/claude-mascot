// Renders every animation to an SVG flipbook in docs/anims/.
//
// The point is that these come out of the *real* rig: this script imports
// mark.js and anims.js unchanged and drives them through a throwaway DOM, so
// a picture in the README cannot show something the mascot doesn't do. There
// are no drawing assets in this repository and this doesn't add any.
//
// Output is a plain SVG per animation: N frames stacked on top of each other,
// with one CSS animation revealing one at a time. Frame 0 carries an
// `opacity="1"` presentation attribute and the rest carry `opacity="0"`, so a
// renderer that ignores the CSS still shows a correct still frame rather than
// a pile or a blank.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'anims');

import { installDom, isDrawn, esc } from './lib/svg-dom.mjs';

// The rig writes raw floats into transforms — the right call at runtime, where
// rounding would cost more than it saves. In a file on disk those tails are
// pure weight: 13 significant digits of a leg angle nobody can see. Three
// decimal places of a 24-unit grid is well under a screen pixel.
const trim = v => String(v).replace(/-?\d+\.\d{4,}/g, n => String(Math.round(n * 1000) / 1000));

installDom();

function serialise(node, indent = '') {
  // Anything invisible is dropped: prop groups that aren't in play, and the
  // glow, sweat and zzz marks, which are present but transparent in most
  // frames of most animations. This is most of why a frame of `idle` is a
  // fraction of the size of a frame of `confetti`.
  if (!isDrawn(node)) return '';
  const attrs = [...node.attrs]
    .filter(([k]) => k !== 'display')
    .map(([k, v]) => `${k}="${esc(trim(v))}"`)
    .join(' ');
  const open = `${indent}<${node.nodeName}${attrs ? ` ${attrs}` : ''}`;
  if (!node.children.length && !node.textContent) return `${open}/>\n`;
  const inner = node.children.map(c => serialise(c, `${indent}  `)).join('');
  return `${open}>${node.textContent ? esc(node.textContent) : `\n${inner}${indent}`}</${node.nodeName}>\n`;
}

// ── Sampling ─────────────────────────────────────────────────────────────

const { createMark, neutralPose } = await import('../src/renderer/overlay/rig/mark.js');
const { anims } = await import('../src/renderer/overlay/rig/anims.js');
const catalog = await import('../src/shared/catalog.js');

// Wide enough that a backflip, a thrown handful of confetti and a raised flag
// all stay inside the frame. The rig's own viewBox is much tighter, because on
// the desktop it is allowed to overflow its element.
const VIEW = { x: -11, y: -13, w: 46, h: 37 };
const FRAMES = 12;
// One-shots get a beat of stillness at the end, or a 150 ms blink loops so
// fast it reads as a rendering fault rather than as a blink.
const PAUSE_FRAMES = 3;
const MIN_CYCLE_MS = 700;

const mark = createMark(100);
const pose = neutralPose();
const metrics = {};

// The gradient the glow uses. Identical in every frame, so it is emitted once
// per file instead of once per frame — duplicate ids in one document are the
// kind of thing that renders fine until one day it doesn't.
const DEFS = serialise(mark.svg.children[0], '  ');

/** Serialises the current rig state, minus the defs. */
function snapshot(indent) {
  const body = mark.svg.children
    .slice(1)
    .map(c => serialise(c, `${indent}  `))
    .join('');
  // `p.opacity` lands on the element's style, which has nowhere to go in a
  // static file — carry it as a wrapper instead of silently dropping it.
  const o = Number(mark.svg.style.opacity);
  return Number.isFinite(o) && o < 0.999
    ? `${indent}<g opacity="${o.toFixed(3)}">\n${body}${indent}</g>\n`
    : body;
}

/**
 * One animation as a list of serialised frames.
 *
 * Frames come from `mark.apply`, i.e. exactly the code path the live overlay
 * uses — not a reimplementation that could drift from it.
 */
function framesFor(name, indent = '      ') {
  const anim = anims[name];
  const oneShot = !anim.loop;
  const cycle = Math.max(MIN_CYCLE_MS, catalog.cycleMsFor(name, anims));
  const frames = [];

  for (let i = 0; i < FRAMES; i++) {
    // Loops sample [0, cycle) so the last frame flows back into the first;
    // one-shots sample [0, cycle] so the final pose is actually shown.
    const t = oneShot ? (i / (FRAMES - 1)) * cycle : (i / FRAMES) * cycle;
    neutralPose(pose);
    anim.pose(t, metrics, pose);
    mark.apply(pose);
    frames.push(snapshot(indent));
  }

  if (oneShot) {
    neutralPose(pose);
    mark.apply(pose);
    const still = snapshot(indent);
    for (let i = 0; i < PAUSE_FRAMES; i++) frames.push(still);
  }

  // A one-shot's slots span its duration plus the pause; a loop's span exactly
  // one cycle, so it joins back up seamlessly.
  const durMs = Math.round(cycle * (frames.length / (oneShot ? FRAMES - 1 : FRAMES)));
  return { frames, durMs, name };
}

/** The stacked frame groups plus the CSS that reveals them one at a time. */
function flipMarkup({ frames, durMs, name }, indent = '    ') {
  const n = frames.length;
  const slot = 100 / n;
  const id = `a${name.replace(/[^a-z0-9]/gi, '')}`;

  const style =
    `${indent}<style>\n` +
    `${indent}  .${id} { animation: ${id}f ${durMs}ms linear infinite; }\n` +
    `${indent}  @keyframes ${id}f {\n` +
    `${indent}    0%, ${(slot - 0.01).toFixed(2)}% { opacity: 1; }\n` +
    `${indent}    ${slot.toFixed(2)}%, 100% { opacity: 0; }\n` +
    `${indent}  }\n` +
    `${indent}  @media (prefers-reduced-motion: reduce) { .${id} { animation: none; } }\n` +
    `${indent}</style>\n`;

  const groups = frames
    .map((body, i) =>
      `${indent}<g class="${id}" opacity="${i === 0 ? 1 : 0}" ` +
      `style="animation-delay:${(-(i * durMs) / n).toFixed(0)}ms">\n${body}${indent}</g>\n`)
    .join('');

  return style + groups;
}

function standalone(data, size = 190) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" ` +
    `width="${size}" height="${Math.round((size * VIEW.h) / VIEW.w)}" role="img" ` +
    `aria-label="${esc(data.name)} animation">
  <title>${esc(data.name)}</title>
${DEFS}${flipMarkup(data)}</svg>
`;
}

// ── Write ────────────────────────────────────────────────────────────────

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const names = catalog.animationNames.filter(n => anims[n]);
let bytes = 0;
for (const name of names) {
  const svg = standalone(framesFor(name));
  writeFileSync(join(OUT, `${name}.svg`), svg);
  bytes += Buffer.byteLength(svg);
}

// A single strip for the top of the README: the mascot doing the four things
// it spends most of its time doing, side by side in one file.
const HERO = ['walk', 'headband', 'typing', 'victory'];
const CELL = 168;
const cellH = Math.round((CELL * VIEW.h) / VIEW.w);
const k = CELL / VIEW.w;

const heroCells = HERO.map((name, i) => {
  const data = framesFor(name, '        ');
  const dx = i * CELL - VIEW.x * k;
  const dy = -VIEW.y * k;
  return `  <g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)}) scale(${k.toFixed(4)})">\n` +
    `${flipMarkup(data, '      ')}  </g>\n`;
}).join('');

const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL * HERO.length}" height="${cellH}" ` +
  `viewBox="0 0 ${CELL * HERO.length} ${cellH}" role="img" ` +
  `aria-label="The mascot walking, tying on its headband, typing, and planting a flag">
  <title>claude-mascot</title>
${DEFS}${heroCells}</svg>
`;
writeFileSync(join(OUT, 'hero.svg'), hero);
bytes += Buffer.byteLength(hero);

// ── Gallery ──────────────────────────────────────────────────────────────
// Generated from the same catalogue the settings UI is built from, so a new
// animation cannot end up in the app but missing from the docs.

const COLS = 4;
const cell = name => {
  const entry = catalog.ANIMATIONS.find(a => a.name === name);
  return `<td align="center" width="25%">` +
    `<img src="anims/${name}.svg" alt="${name}" width="150"><br>` +
    `<b>${entry.en}</b><br><sub><code>${name}</code></sub></td>`;
};

function table(rows) {
  const out = ['<table>'];
  for (let i = 0; i < rows.length; i += COLS) {
    out.push('<tr>' + rows.slice(i, i + COLS).join('') + '</tr>');
  }
  out.push('</table>');
  return out.join('\n');
}

const byGroup = new Map();
for (const a of catalog.ANIMATIONS) {
  if (!anims[a.name]) continue;
  if (!byGroup.has(a.group)) byGroup.set(a.group, []);
  byGroup.get(a.group).push(a.name);
}

const triggerRows = catalog.REACTIONS.map(r =>
  `| ${r.en} | \`${r.key}\` | [\`${r.animation}\`](anims/${r.animation}.svg) |`).join('\n');

const gallery = `# Animations

Every animation the mascot has, rendered straight out of the rig. There are no
drawing assets in this repository — each picture below is the real
\`mark.js\` geometry sampled at ${FRAMES} points and stacked into an SVG
flipbook by \`npm run gen-previews\`, so nothing here can show a pose the
mascot cannot actually strike.

Each one can be switched off individually in the dashboard under
**Animations**.

${[...byGroup].map(([group, list]) =>
  `## ${catalog.GROUPS[group]?.en ?? group}\n\n${table(list.map(cell))}`).join('\n\n')}

## What triggers what

Reactions come from Claude Code hooks. Turning one off in the settings makes
the app drop that event entirely — the mascot neither moves nor speaks for it.

| Event | Setting key | Animation |
|---|---|---|
${triggerRows}

The flourishes are the mascot's own idea; it works them into its idle rotation
on its own. The physics states are chosen by gravity and by you — pick it up
and throw it.

## Live effects

These are not animations. They are applied on top of whatever is playing, and
are driven by live readings rather than by events.

| Effect | Driven by |
|---|---|
${catalog.EFFECTS.map(e => `| \`${e.name}\` | ${e.en} |`).join('\n')}

---

The character on this page is Anthropic's mascot, and this is an unaffiliated
fan project — not endorsed by, sponsored by, or connected with Anthropic. See
the [licence note](../LICENSE) for what the MIT licence does and does not cover.
`;

writeFileSync(join(ROOT, 'docs', 'ANIMATIONS.md'), gallery);

console.log(`docs/anims: ${names.length} animations + hero, ${(bytes / 1024).toFixed(0)} KB total`);
console.log('docs/ANIMATIONS.md: gallery written');
