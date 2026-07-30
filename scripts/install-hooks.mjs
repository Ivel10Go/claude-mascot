// Registers the mascot with Claude Code by editing ~/.claude/settings.json.
//
// Two things get installed:
//   1. HTTP hooks, so Claude Code POSTs every interesting event to the daemon
//   2. a statusLine entry — the only source of the real rate_limit numbers
//
// Both are additive. An existing statusLine is captured and chained rather
// than replaced, existing hooks are appended to, and the whole file is backed
// up first. `npm run uninstall-hooks` removes exactly what this added.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DATA, BACKUP_DIR, CHAIN_FILE, DEFAULT_PORT, HOOK_EVENTS,
  SETTINGS, isMascotHook, writeJsonAtomic,
} from './hook-config.mjs';

const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FORWARDER = join(PROJECT, 'scripts', 'mascot-statusline.mjs');
const PORT = Number(process.env.MASCOT_PORT) || DEFAULT_PORT;

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function main() {
  if (!existsSync(SETTINGS)) {
    console.error(`No Claude Code settings at ${SETTINGS} — is Claude Code installed?`);
    process.exit(1);
  }

  const settings = readJson(SETTINGS, null);
  if (!settings) {
    console.error(`Could not parse ${SETTINGS}. Refusing to touch it.`);
    process.exit(1);
  }

  // Back up before any change, every time.
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(BACKUP_DIR, `settings.json.${stamp}.mascot-backup`);
  copyFileSync(SETTINGS, backup);

  const forwarderCmd = `node "${FORWARDER}"`;
  const alreadyInstalled =
    typeof settings.statusLine?.command === 'string' &&
    settings.statusLine.command.includes('mascot-statusline.mjs');

  // Reuse the existing token so a reinstall doesn't orphan a running daemon.
  const existingChain = readJson(CHAIN_FILE, {});
  const token = existingChain.token || randomBytes(24).toString('hex');

  // Capture whatever statusLine was configured before us — but never capture
  // ourselves, or a reinstall would chain the forwarder into itself.
  const previous = alreadyInstalled
    ? existingChain.previous ?? null
    : settings.statusLine ?? null;

  mkdirSync(APP_DATA, { recursive: true });
  writeJsonAtomic(CHAIN_FILE, { port: PORT, token, previous });

  settings.statusLine = { type: 'command', command: forwarderCmd, padding: 0 };

  settings.hooks = settings.hooks || {};
  let added = 0;
  for (const event of HOOK_EVENTS) {
    const groups = (settings.hooks[event] = settings.hooks[event] || []);

    // Drop any previous mascot entry for this event so reinstalling is
    // idempotent instead of stacking duplicates.
    for (const group of groups) {
      if (Array.isArray(group.hooks)) {
        group.hooks = group.hooks.filter(h => !isMascotHook(h, PORT));
      }
    }

    groups.push({
      matcher: '*',
      hooks: [{
        type: 'http',
        url: `http://127.0.0.1:${PORT}/hook`,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5,
      }],
    });
    added++;
  }

  // Prune groups left empty by the de-duplication above.
  for (const event of HOOK_EVENTS) {
    settings.hooks[event] = settings.hooks[event].filter(
      g => !Array.isArray(g.hooks) || g.hooks.length > 0
    );
  }

  writeJsonAtomic(SETTINGS, settings);

  console.log(`Backup written to ${backup}`);
  console.log(`Registered ${added} hook events on 127.0.0.1:${PORT}`);
  console.log(
    previous?.command
      ? `statusLine chained ahead of: ${previous.command}`
      : 'statusLine installed (nothing was configured before it)'
  );
  console.log('\nRestart any running Claude Code session to pick this up.');
  console.log('Undo at any time with: npm run uninstall-hooks');
}

main();
