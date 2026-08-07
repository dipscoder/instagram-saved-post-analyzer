/**
 * Generates the extension icons as PNGs.
 *
 * Written by hand rather than checked in as binaries so the artwork is reviewable and
 * reproducible: `node tools/make-icons.mjs` regenerates all three from this source.
 * A rounded square in the accent green with a white bookmark glyph.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [0x28, 0x7a, 0x52]; // oklch(0.50 0.10 150), the one accent colour
const FG = [0xff, 0xff, 0xff];

/** Signed-distance rounded rectangle, used for antialiased edges. */
function roundedRectSDF(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const s = size / 128; // design at 128, scale down
  const aa = 0.8 * s; // antialias width in pixels

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      // Tile: rounded square covering most of the canvas.
      const tile = roundedRectSDF(cx, cy, size / 2, size / 2, 60 * s, 60 * s, 16 * s);
      const tileA = clamp01(0.5 - tile / aa);

      // Bookmark: a tall rounded rect with a triangular notch cut from the bottom.
      const body = roundedRectSDF(cx, cy, size / 2, 60 * s, 20 * s, 30 * s, 4 * s);
      let markA = clamp01(0.5 - body / aa);

      // Notch — carve a V out of the lower half.
      const notchTop = 62 * s;
      if (cy > notchTop) {
        const halfWidthAtY = ((cy - notchTop) / (30 * s)) * (20 * s);
        if (Math.abs(cx - size / 2) < halfWidthAtY) markA = 0;
      }

      const i = (y * size + x) * 4;
      const [r, g, b] = mix(BG, FG, markA);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round(tileA * 255);
    }
  }
  return px;
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
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
