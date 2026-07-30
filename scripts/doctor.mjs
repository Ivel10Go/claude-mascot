// End-to-end check: is the daemon up, is auth enforced, does a statusLine
// payload land in the store, and does a hook produce a reaction?
//
// With --probe it also injects a synthetic permission prompt and rate-limit
// payload so the mascot's reaction can be watched on screen without waiting
// for the real thing.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';

/**
 * Counts today's transcript tokens from scratch — intentionally not sharing
 * code with the collector, so a bug in one doesn't cancel out in the other.
 */
function recountToday() {
  const root = join(homedir(), '.claude', 'projects');
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const from = midnight.getTime();

  const walk = (dir, out = []) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  };

  let total = 0;
  for (const file of walk(root)) {
    try { if (statSync(file).mtimeMs < from) continue; } catch { continue; }
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const u = entry?.message?.usage;
      if (!u || !(Date.parse(entry.timestamp) >= from)) continue;
      const cc = u.cache_creation;
      const writes = cc
        ? (cc.ephemeral_5m_input_tokens || 0) + (cc.ephemeral_1h_input_tokens || 0)
        : (u.cache_creation_input_tokens || 0);
      total += (u.input_tokens || 0) + (u.output_tokens || 0)
             + (u.cache_read_input_tokens || 0) + writes;
    }
  }
  return total;
}

const CHAIN = join(process.env.APPDATA || homedir(), 'claude-mascot', 'statusline-chain.json');
const probe = process.argv.includes('--probe');

let creds;
try {
  creds = JSON.parse(readFileSync(CHAIN, 'utf8'));
} catch {
  console.error(`No credentials at ${CHAIN}. Start the app once, then retry.`);
  process.exit(1);
}

const request = (method, path, body, auth = true) =>
  new Promise(resolve => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(auth ? { authorization: `Bearer ${creds.token}` } : {}),
        },
      },
      res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', c => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      }
    );
    req.setTimeout(3000, () => { req.destroy(); resolve({ status: 0, text: 'timeout' }); });
    req.on('error', e => resolve({ status: 0, text: e.message }));
    if (payload) req.write(payload);
    req.end();
  });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// A payload shaped exactly like the documented statusLine JSON.
const statusPayload = {
  session_id: 'doctor-probe',
  cwd: process.cwd(),
  version: '2.1.220',
  model: { id: 'claude-opus-5', display_name: 'Opus' },
  cost: { total_cost_usd: 1.2345, total_duration_ms: 45000, total_lines_added: 156, total_lines_removed: 23 },
  context_window: {
    used_percentage: 63, context_window_size: 200000,
    total_input_tokens: 126000, total_output_tokens: 4200,
  },
  rate_limits: {
    five_hour: { used_percentage: 41.5, resets_at: Math.floor(Date.now() / 1000) + 7200 },
    seven_day: { used_percentage: 22.8, resets_at: Math.floor(Date.now() / 1000) + 400000 },
  },
  exceeds_200k_tokens: false,
};

const health = await request('GET', '/health', null, false);
check('daemon reachable', health.status === 200, `/health -> ${health.status}`);
if (health.status !== 200) process.exit(1);

const unauth = await request('GET', '/state', null, false);
check('auth enforced', unauth.status === 401, `unauthenticated /state -> ${unauth.status}`);

const posted = await request('POST', '/status', statusPayload);
check('statusLine accepted', posted.status === 200, `-> ${posted.status}`);

const hook = await request('POST', '/hook', {
  hook_event_name: 'Notification',
  notification_type: 'permission_prompt',
  message: 'Claude needs permission to run a command',
  session_id: 'doctor-probe',
});
check('hook accepted', hook.status === 200, `-> ${hook.status}`);

const state = await request('GET', '/state');
let parsed = {};
try { parsed = JSON.parse(state.text); } catch { /* reported below */ }

const five = parsed.limits?.fiveHour;
check('5h limit stored', five?.usedPercent === 41.5, `usedPercent=${five?.usedPercent}`);
check('reset time stored', typeof five?.resetsAt === 'number', `resetsAt=${five?.resetsAt}`);
check('7d limit stored', parsed.limits?.sevenDay?.usedPercent === 22.8, `usedPercent=${parsed.limits?.sevenDay?.usedPercent}`);
check('context stored', parsed.context?.usedPercent === 63, `usedPercent=${parsed.context?.usedPercent}`);
check('cost stored', parsed.cost?.totalUsd === 1.2345, `totalUsd=${parsed.cost?.totalUsd}`);
check('session stored', parsed.session?.model === 'Opus', `model=${parsed.session?.model}`);

// The last link: does a hook actually reach the rig on screen? The overlay
// reports back what it is playing, so this confirms the whole chain.
const wait = ms => new Promise(r => setTimeout(r, ms));
await request('POST', '/hook', { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
await wait(600);
const after = JSON.parse((await request('GET', '/state')).text);
check('reaction dispatched', after.intent?.animation === 'digging', `intent=${after.intent?.animation}`);
check('rig playing it', after.playing?.animation === 'digging', `playing=${after.playing?.animation}`);

// Speech: a permission prompt is critical, so it bypasses the global gap and
// must surface a bubble almost immediately.
await request('POST', '/hook', {
  hook_event_name: 'Notification',
  notification_type: 'permission_prompt',
  message: 'needs permission',
});
await wait(900);
const spoke = JSON.parse((await request('GET', '/state')).text).speech;
check('bubble shown', typeof spoke?.text === 'string' && spoke.text.length > 0, `text=${JSON.stringify(spoke?.text)}`);
check('bubble came from the permission rule', spoke?.ruleId === 'permission', `rule=${spoke?.ruleId}`);

// And the limit numbers must reach the text, not just the store.
await request('POST', '/status', {
  ...statusPayload,
  rate_limits: {
    five_hour: { used_percentage: 94, resets_at: Math.floor(Date.now() / 1000) + 5400 },
    seven_day: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 400000 },
  },
});
await wait(1200);
const afterLimit = JSON.parse((await request('GET', '/state')).text);
const limitLine = afterLimit.speech;
check(
  'limit bubble quotes the real numbers',
  limitLine?.ruleId === 'limit.5h.critical' && /6\s*%/.test(limitLine.text) && /1 h 30 min/.test(limitLine.text),
  `text=${JSON.stringify(limitLine?.text)}`
);

// The torso doubles as the gauge: at 94% spent only ~6% should still be drawn
// in full colour. This is the rendered value reported back by the rig, not the
// stored metric, so it catches the modifier drifting from the number.
const fill = afterLimit.playing?.bodyFill;
check(
  'body colour tracks the 5h limit',
  typeof fill === 'number' && Math.abs(fill - 0.06) < 0.02,
  `bodyFill=${fill} (expected ~0.06 at 94% used)`
);

// Transcript history: reconstructed from ~/.claude/projects, so it works even
// with no Claude Code session open. Non-fatal if this machine has no history.
const usage = JSON.parse((await request('GET', '/state')).text).usage;
if (usage && usage.todayTokens > 0) {
  check('transcript usage read', usage.weekTokens >= usage.todayTokens,
    `today=${usage.todayTokens} week=${usage.weekTokens} ~$${usage.weekUsd}`);
  check('usage flagged as estimate', usage.estimated === true, `estimated=${usage.estimated}`);

  // Regression guard. The collector tails each transcript from a byte offset;
  // if that offset ever fails to advance it re-reads bytes it already counted
  // and every total silently inflates while still looking plausible. Recount
  // independently and require the collector not to exceed the truth.
  const truth = recountToday();
  const ratio = truth > 0 ? usage.todayTokens / truth : 0;
  check(
    'no double counting',
    ratio <= 1.02,
    `collector=${usage.todayTokens} recount=${truth} ratio=${ratio.toFixed(3)}`
  );
  // The recount runs later than the collector's last sweep, so it may be
  // slightly ahead — but not by a wide margin.
  check(
    'usage not stalled',
    ratio >= 0.8,
    `collector=${usage.todayTokens} recount=${truth} ratio=${ratio.toFixed(3)}`
  );
} else {
  console.log(`SKIP  transcript usage  — no usage in the last 8 days (${JSON.stringify(usage)})`);
}

if (probe) {
  console.log('\nProbing visible reactions (watch the mascot)...');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (const [label, payload] of [
    ['celebrate  (Stop)', { hook_event_name: 'Stop' }],
    ['typing     (Edit)', { hook_event_name: 'PreToolUse', tool_name: 'Edit' }],
    ['digging    (Bash)', { hook_event_name: 'PreToolUse', tool_name: 'Bash' }],
    ['searching  (Grep)', { hook_event_name: 'PreToolUse', tool_name: 'Grep' }],
    ['alert      (permission prompt)', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'needs permission' }],
    ['limitHit   (rate limit)', { hook_event_name: 'StopFailure', error_type: 'rate_limit', error_message: 'limit reached' }],
  ]) {
    console.log(`  -> ${label}`);
    await request('POST', '/hook', payload);
    await wait(3000);
  }
  await request('POST', '/hook', { hook_event_name: 'SessionStart', source: 'startup' });
}

// Physics, tested directly. The module is pure geometry with no DOM or
// Electron dependency, so it can be exercised deterministically here instead
// of hoping the mascot happens to wander onto a window during the run.
{
  const { createBody, step } = await import('../src/renderer/overlay/physics.js');
  const bounds = { width: 1000, height: 600 };
  const platform = { x0: 300, x1: 700, y: 400 };
  const tick = 1 / 60;

  // Dropped over a window: must come to rest on its top edge, not the floor.
  const dropped = createBody(500, 100);
  dropped.mode = 'air';
  let landedOnPlatform = false;
  for (let i = 0; i < 600 && dropped.mode !== 'ground'; i++) {
    const e = step(dropped, tick, [platform], bounds, 30);
    if (e.landed && Math.abs(dropped.y - platform.y) < 1) landedOnPlatform = true;
  }
  check('falls onto a window edge', landedOnPlatform && dropped.mode === 'ground'
    && Math.abs(dropped.y - platform.y) < 1,
    `y=${dropped.y.toFixed(1)} (platform at ${platform.y}) mode=${dropped.mode}`);

  // Dropped past the end of that window: must reach the floor instead.
  const missed = createBody(100, 100);
  missed.mode = 'air';
  for (let i = 0; i < 600 && missed.mode !== 'ground'; i++) step(missed, tick, [platform], bounds, 30);
  check('falls past a window it misses', Math.abs(missed.y - bounds.height) < 1,
    `y=${missed.y.toFixed(1)} (floor at ${bounds.height})`);

  // Walking off the edge of a platform must become a fall, not a moonwalk.
  const walker = createBody(690, platform.y);
  walker.platform = platform;
  walker.vx = 200;
  let leftGround = false;
  for (let i = 0; i < 120 && !leftGround; i++) {
    leftGround = step(walker, tick, [platform], bounds, 30).leftGround;
  }
  check('walking off an edge starts a fall', leftGround && walker.mode === 'air',
    `x=${walker.x.toFixed(0)} mode=${walker.mode}`);

  // A hard throw must stay on screen and settle, not escape or orbit forever.
  const thrown = createBody(500, platform.y);
  thrown.mode = 'air';
  thrown.vx = 1800;
  thrown.vy = -900;
  let escaped = false;
  for (let i = 0; i < 1200 && thrown.mode !== 'ground'; i++) {
    step(thrown, tick, [platform], bounds, 30);
    if (thrown.x < 0 || thrown.x > bounds.width || thrown.y > bounds.height + 1) escaped = true;
  }
  check('a hard throw stays on screen and settles', !escaped && thrown.mode === 'ground',
    `x=${thrown.x.toFixed(0)} y=${thrown.y.toFixed(0)} mode=${thrown.mode} escaped=${escaped}`);
}

// The window watcher feeds real title bars in as platforms.
const winState = JSON.parse((await request('GET', '/state')).text).windows;
if (winState) {
  check('window watcher feeding platforms', winState.count > 0, `${winState.count} windows`);
} else {
  console.log('SKIP  window watcher  — disabled in config');
}

// Machine telemetry. Each source degrades independently, so report what is
// present rather than failing the run on a machine without a battery or GPU.
const tele = JSON.parse((await request('GET', '/state')).text);
check('cpu load read', typeof tele.cpu?.load === 'number' && tele.cpu.load >= 0 && tele.cpu.load <= 100,
  `load=${tele.cpu?.load?.toFixed(1)}% cores=${tele.cpu?.cores}`);
check('memory read', typeof tele.memory?.usedPercent === 'number',
  `used=${tele.memory?.usedPercent?.toFixed(1)}%`);
check('disks read', Array.isArray(tele.disks) && tele.disks.length > 0,
  tele.disks?.map(d => `${d.mount} ${d.freePercent.toFixed(1)}% free`).join('  '));

if (tele.battery?.percent != null) {
  check('battery read', tele.battery.percent >= 0 && tele.battery.percent <= 100,
    `${tele.battery.percent}% charging=${tele.battery.charging} via ${tele.battery.source}`);
} else {
  console.log(`SKIP  battery  — none detected (source=${tele.battery?.source})`);
}
if (tele.gpu) {
  check('gpu read', typeof tele.gpu.load === 'number',
    `${tele.gpu.name ?? '?'} ${tele.gpu.load}% ${tele.gpu.tempC}C ${tele.gpu.memUsedMb}/${tele.gpu.memTotalMb}MB`);
} else {
  console.log('SKIP  gpu  — nvidia-smi unavailable');
}

// The checks above deliberately drove the mascot into `alert` — a sticky,
// critical, looping pose. Leaving it there would have it hopping on the user's
// desktop long after the run. Clearing it is both cleanup and a test that the
// release path works at all.
await request('POST', '/hook', { hook_event_name: 'Stop' });
await wait(2800);
const settled = JSON.parse((await request('GET', '/state')).text);
check(
  'sticky reaction released',
  settled.playing?.animation !== 'alert',
  `playing=${settled.playing?.animation}`
);

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
