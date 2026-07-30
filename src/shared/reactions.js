// Maps a Claude Code hook event onto a mascot reaction.
//
// Priority decides what wins when events arrive faster than the mascot can
// act them out. `sticky` marks states the mascot should stay in until
// something else happens, rather than drifting back to its own scheduler.

const TOOL_ANIMATIONS = [
  [/^Bash$/, 'digging'],
  [/^(Edit|Write|NotebookEdit|MultiEdit)$/, 'typing'],
  [/^(Read|Grep|Glob|LS)$/, 'searching'],
  [/^(WebFetch|WebSearch)$/, 'broadcasting'],
  [/^mcp__/, 'broadcasting'],
];

const PRIORITY = { critical: 3, high: 2, normal: 1, low: 0 };

// How long a sticky state may hold the rig before it lapses on its own. A
// hold that outlives its cause would strand the mascot in one pose.
//
// `critical` is deliberately not much longer than the others: the alert pose
// hops and pulses to fetch you, and a prompt answered in the terminal emits
// no hook to cancel it. Two minutes is long enough to be noticed and short
// enough not to be maddening.
const HOLD_MS = { critical: 120_000, high: 60_000, normal: 45_000, low: 30_000 };

// A finished turn or a fresh session means whatever the mascot was stuck on
// is over, whatever its priority was.
const RESOLVING_KEYS = new Set(['turn.done', 'turn.failed', 'session.start', 'session.end']);

/**
 * @param {object} hook  raw hook payload from Claude Code
 * @returns {{animation: string, priority: number, key: string, sticky: boolean, data: object}|null}
 */
function reactionFor(hook) {
  const event = hook.hook_event_name;
  const make = (animation, key, level = 'normal', sticky = false, data = {}) => ({
    animation,
    key,
    sticky,
    priority: PRIORITY[level],
    holdMs: HOLD_MS[level],
    // A permission prompt is answered the moment anything else happens, so
    // the next event of any kind — not just a higher-priority one — ends it.
    resolvedByAny: key === 'permission',
    data,
  });

  switch (event) {
    case 'SessionStart':
      return make('stretch', 'session.start', 'normal', false, { cwd: hook.cwd });

    // Ties its headband on and holds that stance until the first tool runs —
    // sticky at normal priority, so any PreToolUse takes it straight over.
    case 'UserPromptSubmit':
      return make('headband', 'prompt.submit', 'normal', true);

    case 'PreToolUse': {
      const tool = hook.tool_name || '';
      for (const [pattern, animation] of TOOL_ANIMATIONS) {
        if (pattern.test(tool)) {
          return make(animation, `tool.${animation}`, 'normal', true, { tool });
        }
      }
      return make('think', 'tool.other', 'normal', true, { tool });
    }

    case 'SubagentStart':
      return make('clone', 'subagent.start', 'normal', false, { agent: hook.agent_type });

    case 'Notification':
      // The one case where the mascot must actively fetch the user.
      if (hook.notification_type === 'permission_prompt') {
        return make('alert', 'permission', 'critical', true, { message: hook.message });
      }
      return make('scan', 'notification', 'low', false, { message: hook.message });

    case 'PostToolUseFailure':
      return make('facepalm', 'tool.failed', 'high', false, { tool: hook.tool_name });

    case 'PreCompact':
      return make('meditate', 'compact', 'high', true, { trigger: hook.trigger });

    case 'Stop':
      return make('victory', 'turn.done', 'high');

    case 'StopFailure':
      if (hook.error_type === 'rate_limit') {
        return make('limitHit', 'limit.hit', 'critical', true, { message: hook.error_message });
      }
      return make('stumble', 'turn.failed', 'high', false, { error: hook.error_type });

    case 'SessionEnd':
      return make('sleep', 'session.end', 'low', true, { reason: hook.end_reason });

    default:
      return null;
  }
}

/**
 * Decides whether an incoming reaction may take over from a sticky one.
 * Exported so the rule is testable without standing the whole app up.
 */
function supersedes(held, next, now = Date.now()) {
  if (!held) return true;
  if (now >= held.expiresAt) return true;          // the hold simply lapsed
  if (held.resolvedByAny) return true;             // its cause has been answered
  if (RESOLVING_KEYS.has(next.key)) return true;   // turn ended / session began
  return next.priority >= held.priority;
}

module.exports = { reactionFor, supersedes, PRIORITY, HOLD_MS, RESOLVING_KEYS };
