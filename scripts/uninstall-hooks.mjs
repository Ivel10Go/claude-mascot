// Removes exactly what install-hooks added: the mascot's HTTP hook entries
// and its statusLine slot, restoring whatever statusLine was configured
// before. Surgical rather than restoring the backup wholesale, so unrelated
// settings changes made since installing are preserved.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_DIR, CHAIN_FILE, DEFAULT_PORT, HOOK_EVENTS,
  SETTINGS, isMascotHook, writeJsonAtomic,
} from './hook-config.mjs';

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

function main() {
  if (!existsSync(SETTINGS)) {
    console.error(`No settings at ${SETTINGS} — nothing to do.`);
    process.exit(0);
  }

  const settings = readJson(SETTINGS, null);
  if (!settings) {
    console.error(`Could not parse ${SETTINGS}. Refusing to touch it.`);
    process.exit(1);
  }

  const chain = readJson(CHAIN_FILE, {});
  const port = chain.port || DEFAULT_PORT;

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(BACKUP_DIR, `settings.json.${stamp}.mascot-uninstall`);
  copyFileSync(SETTINGS, backup);

  let removed = 0;
  for (const event of HOOK_EVENTS) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter(h => !isMascotHook(h, port));
      removed += before - group.hooks.length;
    }
    // Drop groups we emptied, and the event key if nothing else used it.
    settings.hooks[event] = groups.filter(
      g => !Array.isArray(g.hooks) || g.hooks.length > 0
    );
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  // Hand the statusLine slot back to whoever had it before.
  const ours =
    typeof settings.statusLine?.command === 'string' &&
    settings.statusLine.command.includes('mascot-statusline.mjs');
  if (ours) {
    if (chain.previous) settings.statusLine = chain.previous;
    else delete settings.statusLine;
  }

  writeJsonAtomic(SETTINGS, settings);

  console.log(`Backup written to ${backup}`);
  console.log(`Removed ${removed} mascot hook entries.`);
  console.log(
    ours
      ? chain.previous?.command
        ? `statusLine restored to: ${chain.previous.command}`
        : 'statusLine removed (nothing was configured before the mascot).'
      : 'statusLine was not ours — left untouched.'
  );
}

main();
