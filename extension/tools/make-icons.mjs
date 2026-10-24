/**
 * Generates the extension icons as PNGs.
 *
 * Written by hand rather than checked in as binaries so the artwork is reviewable and
 * reproducible: `node tools/make-icons.mjs` regenerates all three from this source.
 * A squircle in the brand's coral-to-violet gradient holding a white bookmark, with a
 * sparkle cut out of it for the sorting. Below 32px the sparkle would only smudge, so the
 * toolbar icon is the bookmark alone.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CORAL = [0xff, 0x6a, 0x55];
const PINK = [0xf0, 0x3e, 0x86];
const VIOLET = [0x7a, 0x4c, 0xff];
const WHITE = [0xff, 0xff, 0xff];
/** Samples per axis per pixel. Coverage by supersampling keeps every shape a plain test. */
const SS = 5;

/** Each shape is drawn on a 128-unit canvas: a test of whether (x, y) is inside it. */
const inTile = (x, y) => (Math.abs(x - 64) / 60) ** 5 + (Math.abs(y - 64) / 60) ** 5 <= 1;

function inBookmark(x, y) {
  const dx = Math.abs(x - 64);
  if (dx > 24 || y < 28 || y > 100) return false;
  // The notch: a V rising from the two tails at the bottom to y = 82 in the middle.
  if (y > 82 + (dx / 24) * 18) return false;
  // Rounded top corners.
  const r = 9;
  if (y < 28 + r && dx > 24 - r) return Math.hypot(dx - (24 - r), y - (28 + r)) <= r;
  return true;
}

/** A four-point sparkle: an astroid, whose concave sides give the pointed star. */
const inSparkle = (x, y) => Math.abs((x - 64) / 15) ** (2 / 3) + Math.abs((y - 56) / 15) ** (2 / 3) <= 1;

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const unit = 128 / size;
  const sparkle = size >= 32;

  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS) * unit;
          const y = (py + (sy + 0.5) / SS) * unit;
          if (!inTile(x, y)) continue;
          tile++;
          if (inBookmark(x, y) && !(sparkle && inSparkle(x, y))) mark++;
        }
      }
      const i = (py * size + pxl) * 4;
      if (!tile) continue;

      // Diagonal gradient, with a soft light falling from the top edge.
      const cx = (pxl + 0.5) * unit;
      const cy = (py + 0.5) * unit;
      const t = Math.min(1, Math.max(0, (cx * 0.45 + cy) / 175));
      const bg = t < 0.5 ? mix(CORAL, PINK, t * 2) : mix(PINK, VIOLET, (t - 0.5) * 2);
      const lit = mix(bg, WHITE, Math.max(0, 0.14 - cy / 128 * 0.28));

      const [r, g, b] = mix(lit, WHITE, mark / tile);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round((tile / (SS * SS)) * 255);
    }
  }
  return px;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// --- minimal PNG encoder ----------------------------------------------------

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
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
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

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * 4 + 1);
    raw[at] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, at + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`public/icons/icon${size}.png`, encodePng(size, render(size)));
  console.log(`public/icons/icon${size}.png`);
}
