// Rasterises the mascot into a PNG entirely in-process, so the tray and the
// packaged app icon come from the same geometry as the on-screen rig and no
// binary asset has to be checked in or kept in sync.
//
// Everything is axis-aligned rectangles, so coverage is exact rectangle
// overlap rather than a sampled distance field — crisp at 16px, no guessing.

const zlib = require('node:zlib');

const GRID = 24;                       // authoring grid, matches the rig
const BODY = { x: 3, y: 5, w: 18, h: 12 };
const NUB = { w: 3, h: 3.1, y: 10.95 };
const LEG = { w: 1.49, h: 3, y: 17, xs: [3, 6, 15, 18] };
const EYE = { w: 1.49, h: 2.85, y: 8.1, xs: [6, 16.51] };

const BODY_RGB = [217, 119, 87];       // #D97757
const EYE_RGB = [36, 22, 17];          // #241611

const SOLID = [
  BODY,
  { x: BODY.x - NUB.w, y: NUB.y, w: NUB.w, h: NUB.h },
  { x: BODY.x + BODY.w, y: NUB.y, w: NUB.w, h: NUB.h },
  ...LEG.xs.map(x => ({ x, y: LEG.y, w: LEG.w, h: LEG.h })),
];
const EYES = EYE.xs.map(x => ({ x, y: EYE.y, w: EYE.w, h: EYE.h }));

/** Area of a pixel square covered by a rect, in [0,1] — exact antialiasing. */
function coverage(px, py, unit, r) {
  const x0 = r.x * unit, y0 = r.y * unit;
  const x1 = x0 + r.w * unit, y1 = y0 + r.h * unit;
  const ox = Math.min(px + 1, x1) - Math.max(px, x0);
  const oy = Math.min(py + 1, y1) - Math.max(py, y0);
  return ox <= 0 || oy <= 0 ? 0 : ox * oy;
}

function maxCoverage(px, py, unit, rects, dy) {
  let best = 0;
  for (const r of rects) {
    const c = coverage(px, py, unit, { ...r, y: r.y + dy });
    if (c > best) best = c;
  }
  return best;
}

/** Renders the mascot at `size` px as straight RGBA. */
function renderMascot(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const unit = size / GRID;
  // Content spans y 5..20 of the grid; centre it in the square canvas.
  const dy = (GRID - (LEG.y + LEG.h + BODY.y)) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bodyCov = maxCoverage(x, y, unit, SOLID, dy);
      const eyeCov = maxCoverage(x, y, unit, EYES, dy);
      const alpha = Math.max(bodyCov, eyeCov);
      if (alpha <= 0) continue;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[o + c] = Math.round(BODY_RGB[c] + (EYE_RGB[c] - BODY_RGB[c]) * eyeCov);
      }
      buf[o + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal 8-bit RGBA PNG encoder — enough for icons, nothing more. */
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  // Filter byte 0 on every scanline; icons are small enough that smarter
  // filtering buys nothing.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mascotPNG = size => encodePNG(size, renderMascot(size));

/** Tray icon, built at both DPI steps Windows asks for. */
function trayIcon() {
  // Required lazily so the build script can reuse the encoder from plain Node,
  // where `electron` is not resolvable.
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(mascotPNG(16), { scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, buffer: mascotPNG(32) });
  return img;
}

/**
 * Wraps PNGs in an .ico container — what electron-builder needs for the
 * installer and the executable. Modern Windows reads PNG-compressed icon
 * entries directly, so no BMP fallback is needed.
 */
function encodeICO(sizes = [16, 24, 32, 48, 64, 128, 256]) {
  const images = sizes.map(size => ({ size, png: mascotPNG(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;

  images.forEach((img, i) => {
    const at = i * 16;
    // 0 means 256 in the directory's single-byte width/height fields.
    dir[at] = img.size >= 256 ? 0 : img.size;
    dir[at + 1] = img.size >= 256 ? 0 : img.size;
    dir[at + 2] = 0;                       // palette colours
    dir[at + 3] = 0;                       // reserved
    dir.writeUInt16LE(1, at + 4);          // colour planes
    dir.writeUInt16LE(32, at + 6);         // bits per pixel
    dir.writeUInt32LE(img.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.png.length;
  });

  return Buffer.concat([header, dir, ...images.map(i => i.png)]);
}

module.exports = { renderMascot, encodePNG, mascotPNG, encodeICO, trayIcon };
