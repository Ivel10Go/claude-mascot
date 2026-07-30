// Shared bits between install-hooks and uninstall-hooks: where things live,
// which hook events the mascot listens to, and how to write JSON safely.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export const CLAUDE_DIR = join(homedir(), '.claude');
export const SETTINGS = join(CLAUDE_DIR, 'settings.json');
export const BACKUP_DIR = join(CLAUDE_DIR, 'backups');

// Electron's userData for this app — the daemon and the statusLine forwarder
// both read the chain config from here.
export const APP_DATA = join(process.env.APPDATA || homedir(), 'claude-mascot');
export const CHAIN_FILE = join(APP_DATA, 'statusline-chain.json');

export const DEFAULT_PORT = 4747;

// Every event the mascot reacts to. Matcher "*" means "fire on all of them";
// the mapping from event to animation lives in src/shared/reactions.js.
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'SubagentStart',
  'Notification',
  'PostToolUseFailure',
  'PreCompact',
  'Stop',
  'StopFailure',
  'SessionEnd',
];

/** True when this hook entry is one the mascot installed. */
export const isMascotHook = (entry, port) =>
  entry?.type === 'http' &&
  typeof entry.url === 'string' &&
  entry.url.startsWith(`http://127.0.0.1:${port}/hook`);

/** Write JSON via a temp file + rename, so a crash can't truncate the file. */
export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}
