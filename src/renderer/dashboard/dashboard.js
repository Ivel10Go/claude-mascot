// Dashboard rendering. Reads the same store the mascot reacts to, so what the
// numbers say here and what the mascot says out loud can never disagree.

import { until, ago, tokens, usd, bytes, pct } from '../../shared/format.js';
import { REACTIONS, EFFECTS, ANIMATIONS, IDLE_ANIMATIONS, label } from '../../shared/catalog.js';

const $ = id => document.getElementById(id);
const clamp01 = v => Math.max(0, Math.min(1, v));

let locale = 'de';

/** Ring gauge. `value` is 0..1 of the ring filled. */
function gauge(el, { value, label, caption, sub, colour }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const filled = clamp01(value) * C;
  el.innerHTML =
    `<svg width="86" height="86" viewBox="0 0 86 86">
       <circle cx="43" cy="43" r="${R}" fill="none" stroke="#171410" stroke-width="9"/>
       <circle cx="43" cy="43" r="${R}" fill="none" stroke="${colour}" stroke-width="9"
               stroke-linecap="round" stroke-dasharray="${filled} ${C}"
               transform="rotate(-90 43 43)"/>
     </svg>
     <div class="val">${label}</div>
     <div class="cap">${caption}</div>
     <div class="sub2">${sub ?? ''}</div>`;
}

const bandColour = used =>
  used >= 90 ? 'var(--bad)' : used >= 75 ? 'var(--warn)' : 'var(--body)';

function rows(el, items) {
  el.innerHTML = items.map(([k, v, frac, colour]) => {
    const bar = frac === null || frac === undefined
      ? ''
      : `<div class="bar"><i style="width:${(clamp01(frac) * 100).toFixed(1)}%;` +
        `${colour ? `background:${colour}` : ''}"></i></div>`;
    return `<div class="row"><div class="k">${k}</div>${bar}<div class="v">${v}</div></div>`;
  }).join('');
}

function renderLimits(s) {
  const live = s.limits && !s.limits.stale;
  const five = s.limits?.fiveHour;
  const seven = s.limits?.sevenDay;
  const ctx = s.context;

  const box = document.querySelector('.panel');
  box.classList.toggle('stale', !live);

  gauge($('g-5h'), {
    value: live && five ? five.usedPercent / 100 : 0,
    label: live && five ? `${pct(five.usedPercent)}%` : '—',
    caption: '5-hour',
    sub: live && five?.resetsAt ? until(five.resetsAt, locale) : '',
    colour: bandColour(five?.usedPercent ?? 0),
  });
  gauge($('g-7d'), {
    value: live && seven ? seven.usedPercent / 100 : 0,
    label: live && seven ? `${pct(seven.usedPercent)}%` : '—',
    caption: '7-day',
    sub: live && seven?.resetsAt ? until(seven.resetsAt, locale) : '',
    colour: bandColour(seven?.usedPercent ?? 0),
  });
  gauge($('g-ctx'), {
    value: live && ctx ? ctx.usedPercent / 100 : 0,
    label: live && ctx ? `${pct(ctx.usedPercent)}%` : '—',
    caption: 'context',
    sub: live && ctx?.sizeTokens ? `${tokens(ctx.sizeTokens, locale)} max` : '',
    colour: bandColour(ctx?.usedPercent ?? 0),
  });

  $('limits-note').textContent = live
    ? `Model: ${s.session?.model ?? '—'}${s.session?.agent ? ` · ${s.session.agent}` : ''}`
    : diagnose(s).short;
}

/**
 * Why the limit gauges are empty, and what to do about it.
 *
 * The percentages exist in exactly one place: the payload Claude Code hands to
 * its status line. Hooks are not a substitute — they fire in every Claude Code
 * surface, but the status line is a terminal-UI feature, so a desktop-app
 * session produces events and no limits at all. Saying "unknown" without
 * saying which of those is happening is the least useful thing this panel
 * could do.
 */
function diagnose(s) {
  const sl = s.statusLine ?? {};
  const t = DIAG[locale] ?? DIAG.de;
  if (!sl.installed) return t.notInstalled;
  if (!sl.everSeen) return t.neverRan;
  if (!sl.sawRateLimits) return t.noLimits;
  return t.stale;
}

const DIAG = {
  de: {
    notInstalled: {
      short: 'Die Statuszeile ist nicht eingetragen — ohne sie gibt es keine Limits.',
      long: 'Der Weiterleiter für die Statuszeile steht nicht in <code>~/.claude/settings.json</code>. ' +
            'Einmal <code>npm run install-hooks</code> ausführen.',
    },
    neverRan: {
      short: 'Die Statuszeile ist eingetragen, hat aber noch nie etwas geliefert.',
      long: 'Die Statuszeile ist eingetragen, wurde aber noch nie ausgeführt. Sie ist ein ' +
            'Terminal-Feature: die Claude-Code-<b>Desktop-App rendert keine</b>. Hooks kommen ' +
            'trotzdem an — das Maskottchen reagiert also, kennt aber deine Limits nicht. ' +
            'Starte <code>claude</code> einmal in einem Terminal, dann füllen sich die Anzeigen.',
    },
    noLimits: {
      short: 'Die Statuszeile läuft, liefert aber keine Limit-Werte.',
      long: 'Die Statuszeile läuft, aber ihr Payload enthält kein <code>rate_limits</code>. ' +
            'Das passiert bei API-Key-Anmeldung und bei Tarifen ohne Fenster-Limits. ' +
            'Tokens und Kosten unten stimmen weiterhin.',
    },
    stale: {
      short: 'Gerade rendert keine Claude-Code-Sitzung ihre Statuszeile — Werte sind veraltet.',
      long: '',
    },
  },
  en: {
    notInstalled: {
      short: 'The status line is not registered, so there are no limits to show.',
      long: 'The status-line forwarder is missing from <code>~/.claude/settings.json</code>. ' +
            'Run <code>npm run install-hooks</code> once.',
    },
    neverRan: {
      short: 'The status line is registered but has never delivered anything.',
      long: 'The status line is registered but has never run. It is a terminal-UI feature: the ' +
            'Claude Code <b>desktop app renders none</b>. Hooks still arrive, so the mascot ' +
            'reacts — it just cannot know your limits. Run <code>claude</code> in a terminal ' +
            'once and the gauges fill in.',
    },
    noLimits: {
      short: 'The status line runs but carries no limit figures.',
      long: 'The status line runs, but its payload has no <code>rate_limits</code>. That happens ' +
            'with API-key auth and on plans without windowed limits. Tokens and cost below are ' +
            'still accurate.',
    },
    stale: { short: 'No Claude Code session is rendering its status line, so these are stale.', long: '' },
  },
};

function renderUsage(s) {
  const u = s.usage;
  const cost = s.cost;
  rows($('usage'), [
    ['Session', cost ? `$${usd(cost.totalUsd, locale)}` : '—', null],
    ['Today', u ? `${tokens(u.todayTokens, locale)}` : '—', null],
    ['Today ≈', u ? `$${usd(u.todayUsd, locale)}` : '—', null],
    ['7 days', u ? `${tokens(u.weekTokens, locale)}` : '—', null],
    ['7 days ≈', u ? `$${usd(u.weekUsd, locale)}` : '—', null],
  ]);
}

function renderMachine(s) {
  const items = [];
  if (s.cpu) items.push(['CPU', `${pct(s.cpu.load)}%`, s.cpu.load / 100,
    s.cpu.load >= 88 ? 'var(--bad)' : null]);
  if (s.memory) items.push(['RAM', `${pct(s.memory.usedPercent)}%`, s.memory.usedPercent / 100,
    s.memory.usedPercent >= 90 ? 'var(--warn)' : null]);
  if (s.gpu) {
    items.push(['GPU', `${pct(s.gpu.load)}%`, s.gpu.load / 100]);
    if (s.gpu.tempC != null) items.push(['GPU temp', `${pct(s.gpu.tempC)} °C`, s.gpu.tempC / 100]);
  }
  if (s.battery?.percent != null) {
    items.push([
      s.battery.charging ? 'Battery ⚡' : 'Battery',
      `${pct(s.battery.percent)}%`,
      s.battery.percent / 100,
      s.battery.percent <= 22 && !s.battery.charging ? 'var(--bad)' : 'var(--ok)',
    ]);
  }
  rows($('machine'), items.length ? items : [['—', 'no readings', null]]);
}

function renderDisks(s) {
  const disks = s.disks ?? [];
  rows($('disks'), disks.length
    ? disks.map(d => [
        d.mount,
        `${bytes(d.freeBytes)} free`,
        1 - d.freePercent / 100,
        d.freePercent <= 8 ? 'var(--bad)' : d.freePercent <= 15 ? 'var(--warn)' : null,
      ])
    : [['—', 'no readings', null]]);
}

function renderFeed(s) {
  const parts = [];
  if (s.playing?.animation) parts.push(`animation <b>${s.playing.animation}</b>`);
  if (s.playing?.onPlatform) parts.push('standing on a window');
  if (s.windows?.count != null) parts.push(`${s.windows.count} windows tracked`);
  // Proves the hook path is alive even while the limit gauges sit empty.
  parts.push(s.lastHookAt
    ? `last Claude Code event <b>${ago(s.lastHookAt, locale)}</b> ago`
    : 'no Claude Code event yet');
  if (s.speech?.text) parts.push(`last said <b>“${s.speech.text}”</b>`);
  $('feed').innerHTML = parts.length ? parts.join('<br>') : 'idle';
}

function headline(s) {
  const five = s.limits && !s.limits.stale ? s.limits.fiveHour : null;
  if (five) {
    $('headline').textContent =
      `${pct(100 - five.usedPercent)}% of the 5-hour limit left · resets in ${until(five.resetsAt, locale)}`;
  } else {
    $('headline').textContent = diagnose(s).short;
  }
}

/**
 * The screen picker only exists on a multi-monitor machine. Options come from
 * the main process because only it can enumerate displays.
 */
let displaySignature = '';
function renderDisplays(s, cfg) {
  const list = s.displays ?? [];
  $('row-display').hidden = list.length < 2;
  if (list.length < 2) return;

  const signature = list.map(d => `${d.id}:${d.label}`).join('|');
  if (signature !== displaySignature) {
    displaySignature = signature;
    $('s-display').innerHTML =
      `<option value="primary">Primary only</option>` +
      list.map(d => `<option value="${d.id}">${d.label}</option>`).join('') +
      `<option value="all">All screens</option>`;
  }
  const mode = cfg?.displayMode ?? currentMode;
  if (mode) $('s-display').value = mode;

  // Each screen gets its own mascot, so say so rather than surprising anyone.
  const screens = list.filter(d => d.active).length;
  $('pets-hint').textContent = screens > 1 ? `(per screen — ${screens} screens)` : '';
}

let currentMode = 'primary';

window.dash.onState(s => {
  renderDisplays(s, null);
  renderLimits(s);
  renderUsage(s);
  renderMachine(s);
  renderDisks(s);
  renderFeed(s);
  headline(s);

  $('hooks-warning').innerHTML = warnings(s);
});

/**
 * Hooks and the status line are two separate installs with two separate
 * failure modes, so they get two separate warnings. Lumping them together is
 * what made a working install look broken: events were arriving the whole
 * time, only the limits were missing.
 */
function warnings(s) {
  const out = [];
  if (s.hooksInstalled === false) {
    out.push(locale === 'en'
      ? `<div class="warnbox">Hooks are not installed, so the mascot cannot see what Claude Code
         is doing. Run <code>npm run install-hooks</code>.</div>`
      : `<div class="warnbox">Die Hooks sind nicht installiert — das Maskottchen sieht nicht, was
         Claude Code tut. Einmal <code>npm run install-hooks</code> ausführen.</div>`);
  }
  const long = (s.limits && !s.limits.stale) ? '' : diagnose(s).long;
  if (long) out.push(`<div class="warnbox info">${long}</div>`);
  return out.join('');
}

window.dash.onConfig(cfg => {
  locale = cfg.locale === 'en' ? 'en' : 'de';
  currentConfig = cfg;
  currentMode = cfg.displayMode ?? 'primary';
  if ($('s-display').options.length) $('s-display').value = currentMode;
  $('s-locale').value = locale;
  $('s-pets').value = cfg.petCount ?? 1;
  $('s-muted').checked = Boolean(cfg.muted);
  $('s-edges').checked = cfg.windowEdges !== false;
  $('s-autostart').checked = Boolean(cfg.autostart);
  setSlider('scale', cfg.scale ?? 1);
  setSlider('speed', cfg.speed ?? 1);
  renderAnimSettings(cfg);
});

function setSlider(key, value) {
  $(`s-${key}`).value = value;
  $(`o-${key}`).textContent = `${Number(value).toFixed(1)}×`;
}

// ── Animation settings ───────────────────────────────────────────────────
// Three sparse maps in the config, all with the same convention: a missing
// key means enabled, so only the boxes you actually untick are ever stored.

const UI = {
  de: {
    anims: 'Animationen', react: 'Worauf reagiert wird', idle: 'Kunststücke im Leerlauf',
    effects: 'Live-Effekte', all: 'Alles an', none: 'Alles aus',
    size: 'Größe', speed: 'Tempo',
    note: 'Reaktionen kommen von Claude Code. Kunststücke führt das Maskottchen von sich aus vor. ' +
          'Live-Effekte liegen über der laufenden Animation und werden von Messwerten gesteuert.',
  },
  en: {
    anims: 'Animations', react: 'What it reacts to', idle: 'Idle flourishes',
    effects: 'Live effects', all: 'All on', none: 'All off',
    size: 'Size', speed: 'Speed',
    note: 'Reactions come from Claude Code. Flourishes are what it does unprompted. ' +
          'Live effects layer over whatever is playing and are driven by readings.',
  },
};

const animLabel = name => {
  const entry = ANIMATIONS.find(a => a.name === name);
  return entry ? label(entry, locale) : name;
};

/** One checkbox list bound to a sparse config map. */
function checkList(host, items, configKey, textOf, hintOf) {
  host.innerHTML = '';
  const boxes = [];
  for (const item of items) {
    const id = item.key ?? item.name;
    const row = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const text = document.createElement('span');
    const hint = document.createElement('em');
    row.append(box, text, hint);
    host.appendChild(row);
    box.addEventListener('change', () => {
      // Only the exceptions are stored; ticking a box removes the key again.
      const map = { ...(currentConfig[configKey] || {}) };
      if (box.checked) delete map[id];
      else map[id] = false;
      currentConfig = { ...currentConfig, [configKey]: map };
      send({ [configKey]: map });
    });
    boxes.push({ id, box, text, hint, item });
  }
  return {
    sync(cfg) {
      const map = cfg[configKey] || {};
      for (const b of boxes) {
        b.box.checked = map[b.id] !== false;
        b.text.textContent = textOf(b.item);
        b.hint.textContent = hintOf ? hintOf(b.item) : '';
      }
    },
    setAll(on) {
      const map = {};
      if (!on) for (const b of boxes) map[b.id] = false;
      currentConfig = { ...currentConfig, [configKey]: map };
      send({ [configKey]: map });
      for (const b of boxes) b.box.checked = on;
    },
  };
}

let currentConfig = {};

const lists = {
  react: checkList($('c-react'), REACTIONS, 'reactions',
    r => label(r, locale), r => animLabel(r.animation)),
  idle: checkList($('c-idle'), IDLE_ANIMATIONS.map(name => ({ name })), 'idleAnims',
    a => animLabel(a.name)),
  effects: checkList($('c-effects'), EFFECTS, 'effects',
    e => label(e, locale)),
};

function renderAnimSettings(cfg) {
  const t = UI[locale] ?? UI.de;
  $('l-anims').textContent = t.anims;
  $('h-react').textContent = t.react;
  $('h-idle').textContent = t.idle;
  $('h-effects').textContent = t.effects;
  $('b-all').textContent = t.all;
  $('b-none').textContent = t.none;
  $('l-anims-note').textContent = t.note;
  $('l-scale').textContent = t.size;
  $('l-speed').textContent = t.speed;
  for (const list of Object.values(lists)) list.sync(cfg);
}

$('b-all').addEventListener('click', () => {
  for (const list of Object.values(lists)) list.setAll(true);
});
$('b-none').addEventListener('click', () => {
  for (const list of Object.values(lists)) list.setAll(false);
});

const send = patch => window.dash.setConfig(patch);
$('s-locale').addEventListener('change', e => { locale = e.target.value; send({ locale: e.target.value }); });
$('s-display').addEventListener('change', e => { currentMode = e.target.value; send({ displayMode: e.target.value }); });
$('s-pets').addEventListener('change', e => send({ petCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)) }));
$('s-muted').addEventListener('change', e => send({ muted: e.target.checked }));
$('s-edges').addEventListener('change', e => send({ windowEdges: e.target.checked }));
$('s-autostart').addEventListener('change', e => send({ autostart: e.target.checked }));

// Size rebuilds the mascots, so it is only committed when the slider is let
// go; the readout still tracks the drag.
for (const key of ['scale', 'speed']) {
  $(`s-${key}`).addEventListener('input', e => {
    $(`o-${key}`).textContent = `${Number(e.target.value).toFixed(1)}×`;
  });
  $(`s-${key}`).addEventListener('change', e => send({ [key]: Number(e.target.value) }));
}
