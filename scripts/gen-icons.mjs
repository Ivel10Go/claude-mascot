// Generates build/icon.ico and build/icon.png from the same geometry the rig
// and the tray icon use, so the installer, the executable and the on-screen
// mascot can never drift apart. Run automatically before a build.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { encodeICO, mascotPNG } = require(join(root, 'src', 'main', 'icon.js'));

const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });

const ico = encodeICO();
writeFileSync(join(outDir, 'icon.ico'), ico);

// electron-builder wants a 256px PNG alongside the .ico for some targets.
const png = mascotPNG(256);
writeFileSync(join(outDir, 'icon.png'), png);

console.log(`build/icon.ico  ${(ico.length / 1024).toFixed(1)} KB`);
console.log(`build/icon.png  ${(png.length / 1024).toFixed(1)} KB`);
