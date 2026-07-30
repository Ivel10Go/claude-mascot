// Chained statusLine forwarder.
//
// Claude Code pipes its session JSON to the statusLine command on stdin, and
// that payload is the ONLY place `rate_limits.five_hour` / `seven_day` are
// exposed. So the mascot sits at the head of the chain: it copies the payload
// to the daemon, then runs whatever statusLine was configured before it and
// prints that output verbatim.
//
// Prime directive: never break or noticeably slow the status line. Every
// failure path here degrades to "print the chained output and exit 0".

import { readFileSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import http from 'node:http';

const CONFIG = join(
  process.env.APPDATA || process.env.HOME || '.',
  'claude-mascot',
  'statusline-chain.json'
);

const STDIN_MS = 400;      // Claude Code closes stdin promptly; this is a floor
const POST_MS = 150;       // hard cap on time spent talking to the daemon
const CHAIN_MS = 2500;     // the chained command's own budget

// stdout on a pipe is async and process.exit() drops pending chunks.
const put = s => { try { writeSync(1, s); } catch { /* never throw */ } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const finish = () => resolve(data);
    const timer = setTimeout(finish, STDIN_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

/** Fire-and-forget POST. Resolves on completion, error, or timeout alike. */
function postStatus(cfg, body) {
  return new Promise(resolve => {
    try {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: cfg.port,
          path: '/status',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            authorization: `Bearer ${cfg.token}`,
          },
        },
        res => { res.resume(); res.on('end', resolve); }
      );
      req.setTimeout(POST_MS, () => { req.destroy(); resolve(); });
      req.on('error', resolve);
      req.end(body);
    } catch {
      resolve();
    }
  });
}

/** Runs the statusLine that was configured before the mascot took the slot. */
function runChained(command, payload) {
  return new Promise(resolve => {
    let out = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* best effort */ }
      resolve(out);
    };

    let child;
    try {
      child = spawn(command, {
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        // Breaks any cycle if another tool ever re-captures our entry as
        // *its* previous statusLine and chains back into us.
        env: { ...process.env, CLAUDE_MASCOT_SL: '1' },
      });
    } catch {
      return resolve('');
    }

    const timer = setTimeout(done, CHAIN_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', c => { out += c; });
    child.on('close', () => { clearTimeout(timer); done(); });
    child.on('error', () => { clearTimeout(timer); done(); });
    try { child.stdin.end(payload); } catch { /* child may not read stdin */ }
  });
}

async function main() {
  const payload = await readStdin();

  let cfg = null;
  try {
    cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    // Not installed yet, or config removed. Still chain, still print.
  }

  const looping = process.env.CLAUDE_MASCOT_SL === '1';
  const chainCmd = !looping && cfg?.previous?.type === 'command' ? cfg.previous.command : '';

  // The POST runs alongside the chained command so it costs no extra wall time.
  const posting = cfg?.token && payload ? postStatus(cfg, payload) : Promise.resolve();
  const chained = chainCmd ? await runChained(chainCmd, payload) : '';

  await Promise.race([posting, sleep(POST_MS)]);

  const text = chained.replace(/[\r\n]+$/, '');
  if (text) put(text);
  process.exit(0);
}

main().catch(() => process.exit(0));
