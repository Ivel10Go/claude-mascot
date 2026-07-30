// Formatters shared by the speech bubbles and the dashboard, so a number is
// never spelled two different ways in the same app.

const LOCALE_TAG = { de: 'de-DE', en: 'en-US' };

/** "2 h 14 min", "45 min", "gleich" — how long until `at` (epoch ms). */
function until(at, locale = 'de') {
  if (!at) return locale === 'de' ? 'irgendwann' : 'later';
  const ms = at - Date.now();
  if (ms <= 60_000) return locale === 'de' ? 'gleich' : 'any moment';

  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  if (h <= 0) return `${mm} min`;
  return mm === 0 ? `${h} h` : `${h} h ${mm} min`;
}

/** Compact token counts: 1.2M / 830k. */
function tokens(n, locale = 'de') {
  if (!Number.isFinite(n)) return '?';
  const tag = LOCALE_TAG[locale] ?? 'en-US';
  if (n >= 1e6) return `${(n / 1e6).toLocaleString(tag, { maximumFractionDigits: 1 })} Mio`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString(tag)} k`;
  return String(Math.round(n));
}

function usd(n, locale = 'de') {
  if (!Number.isFinite(n)) return '?';
  return n.toLocaleString(LOCALE_TAG[locale] ?? 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function bytes(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const pct = n => `${Math.round(n)}`;

/** Substitutes {name} placeholders; an unknown key is left visible on purpose. */
function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
  );
}

export { until, tokens, usd, bytes, pct, fill };
