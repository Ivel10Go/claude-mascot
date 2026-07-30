// Bubble copy, keyed by rule. Each entry is a list of variants — the director
// picks one at random so a repeated situation doesn't produce a repeated line.
//
// Placeholders in {braces} are filled by the rule's `vars()` in rules.js.
//
// A .js module rather than .json on purpose: importing JSON counts as a
// connect-src fetch, and the overlay's CSP is `default-src 'none'` — it should
// stay unable to fetch anything at all.

export const locales = {
  de: {
    'session.start': ['Bin wach!', 'Na, was bauen wir?', 'Session läuft.', 'Da bist du ja.'],
    'turn.done': ['Fertig!', 'Erledigt.', 'Das war\'s.', 'Bäm.'],
    'prompt.submit': ['Ich hör zu…', 'Mhm…', 'Interessant…'],
    permission: [
      'Claude wartet auf deine Freigabe!',
      'Hey! Da will jemand deine Erlaubnis.',
      'Freigabe nötig — ich hol dich mal.',
    ],
    'tool.failed': ['Autsch. {tool} ist gescheitert.', 'Das ging schief: {tool}', 'Ups, {tool} mag nicht.'],
    compact: ['Kontext wird komprimiert, kurz zusammenrollen…', 'Aufräumen im Kopf.'],
    'subagent.start': ['Ich hab mich geklont: {agent}', 'Verstärkung! {agent} übernimmt.'],
    'session.end': ['Bis später.', 'Ich leg mich hin.', 'Feierabend.'],

    'limit.hit': [
      'Limit erreicht. Reset in {reset}.',
      'Aus. Vorbei. Weiter geht\'s in {reset}.',
      '5-Stunden-Limit gerissen — {reset} warten.',
    ],
    'limit.fiveHour.warn': [
      '{pct}% vom 5-Stunden-Limit weg. Reset in {reset}.',
      'Noch {left}% übrig, dann ist Pause. Reset in {reset}.',
      'Achtung: {pct}% verbraucht.',
    ],
    'limit.fiveHour.critical': [
      'Nur noch {left}%! Reset in {reset}.',
      'Es wird eng: {left}% Rest, Reset in {reset}.',
      'Gleich ist Schluss — {left}% übrig, {reset}.',
    ],
    'limit.sevenDay.warn': ['Wochenlimit bei {pct}%. Reset in {reset}.', 'Diese Woche schon {pct}% durch.'],
    'limit.recovered': ['Limit zurückgesetzt — wir sind wieder da!', 'Frisches Kontingent!'],

    'context.warn': ['Kontext zu {pct}% voll.', 'Wird eng im Kopf: {pct}%.'],
    'context.critical': ['{pct}% Kontext — gleich wird komprimiert.', 'Kopf fast voll ({pct}%).'],

    'cost.milestone': ['Diese Session: ${usd}.', 'Bisher ${usd} verbraten.', 'Zähler steht bei ${usd}.'],
    'usage.today': ['Heute schon {tokens} Token.', 'Tagesbilanz: {tokens} Token, ${usd}.'],

    'cpu.hot': ['CPU bei {pct}% — mir wird warm.', 'Puh, {pct}% Last.', 'Der Lüfter zieht an…'],
    'gpu.hot': ['GPU bei {pct}%, {temp}°C.', 'Die Grafikkarte glüht: {temp}°C.'],
    'memory.high': ['RAM zu {pct}% voll.', 'Speicher wird knapp: {pct}%.'],
    'battery.low': ['Akku bei {pct}%… mir wird schwindelig.', 'Nur noch {pct}% Saft.', 'Steck mich an, bitte.'],
    'battery.critical': ['{pct}% Akku! Kabel! Sofort!', 'Gleich falle ich um — {pct}%.'],
    'battery.charging': ['Ah, Strom!', 'Das tut gut.', 'Ich lade wieder auf.'],
    'disk.full': ['{drive} hat nur noch {free} frei.', 'Platte voll: {drive} bei {free}.'],

    idle: ['…', 'Alles ruhig.', 'Ich pass auf.', 'Läuft.', 'Soll ich was tun?', 'Nice hier oben.'],
  },

  en: {
    'session.start': ['I\'m awake!', 'What are we building?', 'Session\'s live.', 'There you are.'],
    'turn.done': ['Done!', 'Finished.', 'That\'s it.', 'Boom.'],
    'prompt.submit': ['Listening…', 'Mhm…', 'Interesting…'],
    permission: [
      'Claude needs your approval!',
      'Hey! Something wants permission.',
      'Approval needed — come look.',
    ],
    'tool.failed': ['Ouch. {tool} failed.', 'That went wrong: {tool}', 'Nope, {tool} didn\'t like that.'],
    compact: ['Compacting context, curling up…', 'Tidying up in here.'],
    'subagent.start': ['Cloned myself: {agent}', 'Backup! {agent} is on it.'],
    'session.end': ['See you.', 'Lying down.', 'Clocking off.'],

    'limit.hit': [
      'Limit reached. Resets in {reset}.',
      'That\'s it. Back in {reset}.',
      '5-hour limit hit — {reset} to wait.',
    ],
    'limit.fiveHour.warn': [
      '{pct}% of the 5-hour limit gone. Resets in {reset}.',
      '{left}% left before the break. Resets in {reset}.',
      'Heads up: {pct}% used.',
    ],
    'limit.fiveHour.critical': [
      'Only {left}% left! Resets in {reset}.',
      'Getting tight: {left}% remaining, {reset}.',
      'Nearly out — {left}% left, {reset}.',
    ],
    'limit.sevenDay.warn': ['Weekly limit at {pct}%. Resets in {reset}.', 'Already {pct}% through this week.'],
    'limit.recovered': ['Limit reset — we\'re back!', 'Fresh budget!'],

    'context.warn': ['Context {pct}% full.', 'Getting crowded in here: {pct}%.'],
    'context.critical': ['{pct}% context — compaction incoming.', 'Head nearly full ({pct}%).'],

    'cost.milestone': ['This session: ${usd}.', '${usd} burned so far.', 'Meter reads ${usd}.'],
    'usage.today': ['{tokens} tokens today.', 'Today: {tokens} tokens, ${usd}.'],

    'cpu.hot': ['CPU at {pct}% — I\'m heating up.', 'Phew, {pct}% load.', 'Fans spinning up…'],
    'gpu.hot': ['GPU at {pct}%, {temp}°C.', 'Graphics card is glowing: {temp}°C.'],
    'memory.high': ['RAM {pct}% full.', 'Memory getting tight: {pct}%.'],
    'battery.low': ['Battery at {pct}%… feeling faint.', 'Only {pct}% juice left.', 'Plug me in, please.'],
    'battery.critical': ['{pct}% battery! Cable! Now!', 'About to drop — {pct}%.'],
    'battery.charging': ['Ah, power!', 'That\'s better.', 'Charging up.'],
    'disk.full': ['{drive} has only {free} left.', 'Disk full: {drive} at {free}.'],

    idle: ['…', 'All quiet.', 'Keeping watch.', 'Running fine.', 'Want me to do something?', 'Nice up here.'],
  },
};

export default locales;
