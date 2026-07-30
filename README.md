# claude-mascot

A desktop pet for Windows that reacts to what Claude Code is actually doing, and
tells you how much of your Claude usage limit is left.

It walks along the bottom of your screen, hammers a keyboard while Claude edits
files, digs while it runs Bash, hops and glows when a permission prompt is
waiting for you, and collapses when the 5-hour limit runs out. Its body doubles
as the gauge: the torso drains from the top down as the limit is spent.

Inspired by [Ivel10Go/claude-caelestia-shell](https://github.com/Ivel10Go/claude-caelestia-shell),
which is QML/Quickshell for Linux+Wayland. This is a ground-up Windows build —
none of that code is portable — but the character geometry follows the same
24×24 authoring grid so the two look like the same creature.

## Status

Working: the overlay, the rig and its 25 animations, the hook daemon, the
Claude limit/cost readouts, and the speech-bubble engine.

Not built yet: system telemetry (CPU/GPU/battery), window-edge physics, the
dashboard, and packaging. The animations and modifiers for those exist and are
driven by metrics that nothing is currently filling in.

## Requirements

- Windows 10/11
- Node.js 18+
- Claude Code 2.1.x (needs `type: "http"` hooks and `rate_limits` in the
  statusLine payload)

## Getting started

```bash
npm install
npm start
```

That gets you the mascot with its own idle behaviour. To make it react to Claude
Code and know your real limits, install the hooks:

```bash
npm run install-hooks
```

This edits `~/.claude/settings.json`. It backs the file up to `~/.claude/backups/`
first, and `npm run uninstall-hooks` restores it byte-for-byte. If you already
have a `statusLine` configured, it is chained rather than replaced — yours still
renders, ours just gets a copy of the payload on the way through.

Check everything end to end:

```bash
npm run doctor
```

## How it knows things

| What | Source |
|---|---|
| 5-hour and 7-day limits, context window, session cost | `rate_limits` / `context_window` / `cost` in the Claude Code statusLine payload — the only place the real percentages appear |
| What Claude is doing right now | Claude Code hooks, POSTed to a loopback HTTP daemon on `127.0.0.1:4747` |
| Token history and cost estimates | Tailing `~/.claude/projects/**/*.jsonl` |

The daemon binds to loopback only and requires a bearer token generated on first
run, stored in `%APPDATA%/claude-mascot/` — never in this repo.

### On the cost figure

The number from the transcripts is an **equivalent API cost** — what those tokens
would have cost at API rates. On a Pro/Max subscription no money moves per token,
so it is labelled as an estimate everywhere it appears. Claude Code's own
`cost.total_cost_usd` is the authoritative figure for a live session; the
transcript reader fills in history, which the statusLine cannot.

Cache writes are priced separately for the 5-minute and 1-hour TTLs, because the
transcripts distinguish them and the rates differ (1.25× vs 2× the input rate).

## Development

```bash
npm start                  # run the app
npm run doctor             # 21 end-to-end checks against a running instance
npm run doctor -- --probe  # also cycle visible reactions so you can watch them
node scripts/dev-server.mjs # serve the rig playground on :5180
```

The playground renders every animation at once with live sliders for the
metric-driven modifiers. It is the fastest way to tune the rig.

### How the rig works

Animations are procedural pose functions rather than keyframe tables — each one
takes elapsed time plus a live metrics object and writes onto a neutral pose.
That is what lets a metric drive geometry directly instead of needing a
hand-authored timeline per state.

- `src/renderer/overlay/rig/mark.js` — the character, built only from rects
- `src/renderer/overlay/rig/anims.js` — animations, plus the metric modifiers
- `src/renderer/overlay/rig/player.js` — crossfading between them
- `src/shared/rules.js` — what the mascot is allowed to say, and when

## Notes

- Idle cost is roughly 1% of a 20-core machine (~20% of one core). The overlay is
  a full-screen transparent layer capped at 24 fps; a per-pet window would be
  cheaper and is the planned fix.
- Everything is drawn from geometry at runtime, including the tray icon — there
  are no image assets in this repo.

## Licence

MIT
