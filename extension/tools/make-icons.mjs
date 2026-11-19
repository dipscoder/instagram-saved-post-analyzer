/**
 * Generates the extension icons as PNGs.
 *
 * Written by hand rather than checked in as binaries so the artwork is reviewable and
 * reproducible: `node tools/make-icons.mjs` regenerates all three from this source.
 *
 * The Notch mark: a solid tile with a bookmark notch cut from its foot, in white on a
 * near-black squircle. Monochrome on purpose; a dark tile keeps it legible on both light
 * and dark browser toolbars.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const INK = [0x18, 0x18, 0x1b];
const WHITE = [0xff, 0xff, 0xff];
/** Samples per axis per pixel. Coverage by supersampling keeps every shape a plain test. */
const SS = 5;

/** Each shape is drawn on a 128-unit canvas: a test of whether (x, y) is inside it. */
const inTile = (x, y) => (Math.abs(x - 64) / 60) ** 5 + (Math.abs(y - 64) / 60) ** 5 <= 1;

/** The mark: 52 wide, 70 tall, rounded top corners, a V notch rising 20 from its foot. */
function inMark(x, y) {
  const dx = Math.abs(x - 64);
  const top = 29;
  const foot = 99;
  if (dx > 26 || y < top || y > foot) return false;
  if (y > foot - 20 + (dx / 26) * 20) return false;
  const r = 7;
  if (y < top + r && dx > 26 - r) return Math.hypot(dx - (26 - r), y - (top + r)) <= r;
  return true;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const unit = 128 / size;

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
          if (inMark(x, y)) mark++;
        }
      }
      const i = (py * size + pxl) * 4;
      if (!tile) continue;
      const [r, g, b] = mix(INK, WHITE, mark / tile);
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
