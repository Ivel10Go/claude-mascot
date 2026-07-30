// Dashboard rendering. Reads the same store the mascot reacts to, so what the
// numbers say here and what the mascot says out loud can never disagree.

import { until, tokens, usd, bytes, pct } from '../../shared/format.js';

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
    : 'No Claude Code session is rendering its status line, so these are unknown.';
}

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
  if (s.speech?.text) parts.push(`last said <b>“${s.speech.text}”</b>`);
  $('feed').innerHTML = parts.length ? parts.join('<br>') : 'idle';
}

function headline(s) {
  const five = s.limits && !s.limits.stale ? s.limits.fiveHour : null;
  if (five) {
    $('headline').textContent =
      `${pct(100 - five.usedPercent)}% of the 5-hour limit left · resets in ${until(five.resetsAt, locale)}`;
  } else {
    $('headline').textContent = 'No live Claude Code session — limits unknown.';
  }
}

window.dash.onState(s => {
  renderLimits(s);
  renderUsage(s);
  renderMachine(s);
  renderDisks(s);
  renderFeed(s);
  headline(s);

  $('hooks-warning').innerHTML = s.hooksInstalled === false
    ? `<div class="warnbox">Hooks are not installed, so the mascot can't see real
       Claude Code activity or your real limits. Run <code>npm run install-hooks</code>.</div>`
    : '';
});

window.dash.onConfig(cfg => {
  locale = cfg.locale === 'en' ? 'en' : 'de';
  $('s-locale').value = locale;
  $('s-pets').value = cfg.petCount ?? 1;
  $('s-muted').checked = Boolean(cfg.muted);
  $('s-edges').checked = cfg.windowEdges !== false;
  $('s-autostart').checked = Boolean(cfg.autostart);
});

const send = patch => window.dash.setConfig(patch);
$('s-locale').addEventListener('change', e => { locale = e.target.value; send({ locale: e.target.value }); });
$('s-pets').addEventListener('change', e => send({ petCount: Math.max(1, Math.min(8, Number(e.target.value) || 1)) }));
$('s-muted').addEventListener('change', e => send({ muted: e.target.checked }));
$('s-edges').addEventListener('change', e => send({ windowEdges: e.target.checked }));
$('s-autostart').addEventListener('change', e => send({ autostart: e.target.checked }));
