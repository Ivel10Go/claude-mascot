// The catalogue of everything the mascot can do, in one place.
//
// This is what the settings UI is built from, what the preview generator
// renders, and what the doctor cross-checks `reactions.js` against. Adding an
// animation without an entry here means it can never be switched off and never
// appears in the gallery — so the doctor treats a gap as a failure.
//
// ESM on purpose: the dashboard and the overlay both import it directly, and
// the overlay's CSP (`default-src 'none'`) rules out a JSON module.

/**
 * Every animation, in the order they should be presented.
 *
 * `cycleMs` is how long one representative loop takes — used by the preview
 * generator to decide how much time a flipbook should span. One-shots get it
 * from their own `dur`; loops have no natural end, so it is stated here.
 *
 * These must be *one* period of the animation's dominant motion, not two. A
 * flipbook samples a fixed number of frames across the window, so spanning
 * several periods aliases against them and the preview collapses to a handful
 * of repeated poses — a walk that looks like a twitch.
 */
export const ANIMATIONS = [
  // ── Ambient ─────────────────────────────────────────────────────────
  { name: 'idle', group: 'ambient', cycleMs: 2800, de: 'Herumstehen', en: 'Idling' },
  { name: 'blink', group: 'ambient', de: 'Blinzeln', en: 'Blink' },
  { name: 'lookUp', group: 'ambient', de: 'Hochschauen', en: 'Look up' },
  { name: 'scan', group: 'ambient', de: 'Umsehen', en: 'Scan' },
  { name: 'think', group: 'ambient', cycleMs: 3600, de: 'Nachdenken', en: 'Think' },

  // ── Locomotion ──────────────────────────────────────────────────────
  { name: 'walk', group: 'move', cycleMs: 520, de: 'Gehen', en: 'Walk' },
  { name: 'run', group: 'move', cycleMs: 260, de: 'Rennen', en: 'Run' },
  { name: 'turn', group: 'move', de: 'Umdrehen', en: 'Turn' },

  // ── Flourishes ──────────────────────────────────────────────────────
  { name: 'wave', group: 'flourish', idle: true, de: 'Winken', en: 'Wave' },
  { name: 'celebrate', group: 'flourish', idle: true, de: 'Jubeln', en: 'Celebrate' },
  { name: 'backflip', group: 'flourish', idle: true, de: 'Rückwärtssalto', en: 'Backflip' },
  { name: 'dance', group: 'flourish', idle: true, cycleMs: 480, de: 'Tanzen', en: 'Dance' },
  { name: 'spin', group: 'flourish', idle: true, de: 'Pirouette', en: 'Spin' },
  { name: 'stretch', group: 'flourish', idle: true, de: 'Strecken', en: 'Stretch' },
  { name: 'shrug', group: 'flourish', idle: true, de: 'Schulterzucken', en: 'Shrug' },
  { name: 'nod', group: 'flourish', idle: true, de: 'Nicken', en: 'Nod' },
  { name: 'salute', group: 'flourish', idle: true, de: 'Salutieren', en: 'Salute' },
  { name: 'bow', group: 'flourish', idle: true, de: 'Verbeugen', en: 'Bow' },
  { name: 'peek', group: 'flourish', idle: true, de: 'Spähen', en: 'Peek' },
  { name: 'roll', group: 'flourish', idle: true, de: 'Rolle', en: 'Roll' },

  // ── Props ───────────────────────────────────────────────────────────
  { name: 'victory', group: 'props', de: 'Fahne hissen', en: 'Plant the flag' },
  // Also an idle flourish. It is the payoff for a 5-hour window rolling over,
  // which on a good day happens once — too rare to be the only way to see it.
  { name: 'confetti', group: 'props', idle: true, de: 'Konfetti', en: 'Confetti' },
  { name: 'headband', group: 'props', cycleMs: 2400, de: 'Stirnband umbinden', en: 'Tie the headband' },
  { name: 'meditate', group: 'props', cycleMs: 4200, de: 'Meditieren', en: 'Meditate' },

  // ── Work ────────────────────────────────────────────────────────────
  { name: 'typing', group: 'work', cycleMs: 210, de: 'Tippen', en: 'Typing' },
  { name: 'digging', group: 'work', cycleMs: 560, de: 'Graben', en: 'Digging' },
  { name: 'searching', group: 'work', cycleMs: 1600, de: 'Suchen', en: 'Searching' },
  { name: 'broadcasting', group: 'work', cycleMs: 900, de: 'Funken', en: 'Broadcasting' },
  { name: 'clone', group: 'work', de: 'Klonen', en: 'Clone' },

  // ── Reactions ───────────────────────────────────────────────────────
  { name: 'alert', group: 'react', cycleMs: 440, de: 'Alarm', en: 'Alert' },
  { name: 'limitHit', group: 'react', cycleMs: 2800, de: 'Limit erschöpft', en: 'Limit hit' },
  { name: 'stumble', group: 'react', de: 'Stolpern', en: 'Stumble' },
  { name: 'facepalm', group: 'react', de: 'Facepalm', en: 'Facepalm' },
  { name: 'curl', group: 'react', cycleMs: 4400, de: 'Einrollen', en: 'Curl up' },

  // ── Rest ────────────────────────────────────────────────────────────
  { name: 'sleep', group: 'rest', cycleMs: 5600, de: 'Schlafen', en: 'Sleep' },
  { name: 'layDown', group: 'rest', cycleMs: 5400, de: 'Hinlegen', en: 'Lie down' },
  { name: 'dangle', group: 'rest', cycleMs: 2100, de: 'Baumeln', en: 'Dangle' },

  // ── Physics ─────────────────────────────────────────────────────────
  { name: 'leap', group: 'physics', cycleMs: 300, de: 'Absprung', en: 'Leap' },
  { name: 'fall', group: 'physics', cycleMs: 2160, de: 'Fallen', en: 'Fall' },
  { name: 'land', group: 'physics', de: 'Landen', en: 'Land' },
  { name: 'climb', group: 'physics', cycleMs: 620, de: 'Klettern', en: 'Climb' },
  { name: 'drag', group: 'physics', cycleMs: 900, de: 'Getragen werden', en: 'Carried' },
];

export const GROUPS = {
  ambient: { de: 'Ruhig', en: 'Ambient' },
  move: { de: 'Fortbewegung', en: 'Locomotion' },
  flourish: { de: 'Kunststücke', en: 'Flourishes' },
  props: { de: 'Mit Requisite', en: 'With a prop' },
  work: { de: 'Arbeit', en: 'Work' },
  react: { de: 'Reaktionen', en: 'Reactions' },
  rest: { de: 'Ruhe', en: 'Rest' },
  physics: { de: 'Physik', en: 'Physics' },
};

/**
 * What Claude Code events the mascot reacts to.
 *
 * `key` is the reaction key produced by `src/shared/reactions.js`; switching
 * one off in the settings makes the main process drop that event entirely, so
 * the mascot neither moves nor speaks for it. The doctor asserts that this
 * list and `reactions.js` still agree.
 */
export const REACTIONS = [
  { key: 'session.start', animation: 'stretch', de: 'Sitzung beginnt', en: 'Session starts' },
  { key: 'prompt.submit', animation: 'headband', de: 'Du schickst einen Prompt', en: 'You send a prompt' },
  { key: 'tool.typing', animation: 'typing', de: 'Claude schreibt Dateien', en: 'Claude edits files' },
  { key: 'tool.digging', animation: 'digging', de: 'Claude führt Bash aus', en: 'Claude runs Bash' },
  { key: 'tool.searching', animation: 'searching', de: 'Claude sucht/liest', en: 'Claude reads or searches' },
  { key: 'tool.broadcasting', animation: 'broadcasting', de: 'Claude geht ins Netz', en: 'Claude hits the web' },
  { key: 'tool.other', animation: 'think', de: 'Sonstiges Werkzeug', en: 'Any other tool' },
  { key: 'subagent.start', animation: 'clone', de: 'Subagent startet', en: 'Subagent starts' },
  { key: 'permission', animation: 'alert', de: 'Freigabe nötig', en: 'Permission needed' },
  { key: 'notification', animation: 'scan', de: 'Sonstige Meldung', en: 'Other notification' },
  { key: 'tool.failed', animation: 'facepalm', de: 'Werkzeug schlägt fehl', en: 'A tool fails' },
  { key: 'compact', animation: 'meditate', de: 'Kontext wird komprimiert', en: 'Context is compacted' },
  { key: 'turn.done', animation: 'victory', de: 'Claude ist fertig', en: 'Claude finishes' },
  { key: 'turn.failed', animation: 'stumble', de: 'Durchgang schlägt fehl', en: 'A turn fails' },
  { key: 'limit.hit', animation: 'limitHit', de: '5-Stunden-Limit gerissen', en: '5-hour limit hit' },
  { key: 'session.end', animation: 'sleep', de: 'Sitzung endet', en: 'Session ends' },
];

/**
 * Metric-driven overlays, applied on top of whatever animation is playing.
 * Names must match the modifier function names in `rig/anims.js`.
 */
export const EFFECTS = [
  { name: 'tokenDrain', de: 'Körper leert sich mit dem 5-h-Limit', en: 'Body drains with the 5-hour limit' },
  { name: 'thermal', de: 'Schwitzt bei hoher CPU-Last', en: 'Sweats under CPU load' },
  { name: 'lowBattery', de: 'Hängt durch bei wenig Akku', en: 'Droops on low battery' },
  { name: 'charging', de: 'Pulsiert am Netzteil', en: 'Pulses while charging' },
  { name: 'contextFull', de: 'Bläht sich bei vollem Kontext', en: 'Bloats as the context fills' },
];

/** Animations the idle scheduler may pick from, in catalogue order. */
export const IDLE_ANIMATIONS = ANIMATIONS.filter(a => a.idle).map(a => a.name);

export const animationNames = ANIMATIONS.map(a => a.name);

/** How long one representative cycle of an animation runs, in ms. */
export function cycleMsFor(name, anims) {
  const entry = ANIMATIONS.find(a => a.name === name);
  if (entry?.cycleMs) return entry.cycleMs;
  return anims?.[name]?.dur ?? 2000;
}

const label = (entry, locale) => (locale === 'en' ? entry.en : entry.de);
export { label };
