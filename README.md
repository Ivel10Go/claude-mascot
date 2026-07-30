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

Feature-complete for what it set out to do: the overlay, the rig and its 27
animations, the hook daemon, Claude limit and cost readouts, the speech-bubble
engine, machine telemetry, window-edge physics with climbing and throwing, the
dashboard, and a packaged installer.

Known gaps: the overlay is a full-screen transparent layer rather than a small
window per pet (see Notes), and there are no automated tests beyond
`npm run doctor`, which needs a running instance.

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
| CPU, memory, disk | `os.cpus()` deltas and `fs.statfs` — syscalls, no subprocess |
| Battery | `wmic` once a minute for the percentage (~6× cheaper than PowerShell); charging state comes free from Electron's `powerMonitor` events |
| GPU load and temperature | `nvidia-smi` every 15s, self-disabling if absent |
| Window positions, so it can stand on your title bars | A long-lived PowerShell sidecar that P/Invokes `EnumWindows` and streams JSON lines. Costs ~88MB of RSS — turn it off with the "Walk on window edges" setting |

On a multi-monitor machine the mascot lives on the primary screen only —
one per screen adds up fast. The tray menu and the dashboard let you pick a
different screen, or put one on every screen.

The mascot climbs the screen's own sides to get anywhere. That is not
decoration: on a normal desktop every window floats clear of the taskbar, so
from the floor there is no ledge within jumping range and no window side low
enough to grab. You can also pick it up and throw it.

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
npm run dashboard          # run it with the dashboard already open
npm run doctor             # 31 end-to-end checks against a running instance
npm run doctor -- --probe  # also cycle visible reactions so you can watch them
npm run playground         # serve the rig playground on :5180
npm run build              # installer + portable exe into dist/
```

`npm run build` regenerates `build/icon.ico` from the same geometry as the rig
and the tray icon, so the installer, the executable and the on-screen mascot
cannot drift apart. There are no image assets in this repository.

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

- Idle cost is roughly 0.5% of a 20-core machine (~10% of one core), with all
  telemetry running. The overlay is a full-screen transparent layer capped at
  24 fps; a per-pet window would be cheaper and is the planned fix.
- No native modules. `koffi` was evaluated for the Win32 battery and window
  APIs and rejected: it ships no prebuilt binary, so it needs a install-time
  build step that many npm setups block outright.
- Everything is drawn from geometry at runtime, including the tray icon — there
  are no image assets in this repo.

## Licence

MIT
