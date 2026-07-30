// The daemon's port and bearer token live in the same file the statusLine
// forwarder reads, so the app and the installed hooks can never disagree.
// Path must match APP_DATA/CHAIN_FILE in scripts/hook-config.mjs — Electron's
// userData for this app is %APPDATA%\claude-mascot.

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { app } = require('electron');

const DEFAULT_PORT = 4747;

function chainFile() {
  return path.join(app.getPath('userData'), 'statusline-chain.json');
}

/**
 * Returns { port, token, previous }, creating the file with a fresh token if
 * the hooks have not been installed yet — install-hooks then reuses it.
 */
function load() {
  const file = chainFile();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Not installed yet; fall through and seed a token.
  }

  if (!data.token) {
    data = {
      port: data.port || DEFAULT_PORT,
      token: randomBytes(24).toString('hex'),
      previous: data.previous ?? null,
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[daemon] could not seed credentials:', err.message);
    }
  }

  return { port: data.port || DEFAULT_PORT, token: data.token, previous: data.previous ?? null, file };
}

/** True once install-hooks has captured a statusLine chain entry. */
const isInstalled = () => {
  try {
    return fs.existsSync(chainFile());
  } catch {
    return false;
  }
};

module.exports = { load, isInstalled, chainFile, DEFAULT_PORT };
