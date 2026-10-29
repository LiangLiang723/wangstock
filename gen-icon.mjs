import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SS = 4;
const S = 1024;
const buf = new Float32Array(S * S * 4);

const R = 56 * SS;
const rect = { x0: 0, y0: 0, x1: S, y1: S };

function roundRectDist(x, y) {
  const cx = Math.min(Math.max(x, rect.x0 + R), rect.x1 - R);
  const cy = Math.min(Math.max(y, rect.y0 + R), rect.y1 - R);
  const dx = x - cx;
  const dy = y - cy;
  return Math.hypot(dx, dy);
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const l2 = vx * vx + vy * vy || 1;
  let t = (wx * vx + wy * vy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

const pts = [
  [46, 172],
  [86, 140],
  [118, 152],
  [154, 102],
  [188, 114],
  [212, 74],
].map(([x, y]) => [x * SS, y * SS]);

const LW = 11 * SS;
const FILL_BOTTOM = 208 * SS;

function insidePoly(x, y) {
  let inside = false;
  const poly = [...pts, [pts[pts.length - 1][0], FILL_BOTTOM], [pts[0][0], FILL_BOTTOM]];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const d = roundRectDist(x, y);
    const inBg = d <= R;
    if (!inBg) continue;

    let r = 22,
      g = 23,
      b = 28,
      a = 255;

    if (insidePoly(x, y)) {
      r = Math.round(22 * 0.84 + 91 * 0.16);
      g = Math.round(23 * 0.84 + 157 * 0.16);
      b = Math.round(28 * 0.84 + 255 * 0.16);
    }

    let line = 1e9;
    for (let k = 0; k < pts.length - 1; k++) {
      line = Math.min(line, segDist(x, y, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]));
    }
    if (line <= LW / 2) {
      r = 91;
      g = 157;
      b = 255;
    }

    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  }
}

function downsample(src, size, factor) {
  const out = Buffer.alloc((size / factor) * (size / factor) * 4);
  const n = factor * factor;
  for (let y = 0; y < size / factor; y++) {
    for (let x = 0; x < size / factor; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * size + (x * factor + dx)) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
        }
      }
      const o = (y * (size / factor) + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src-tauri', 'icons');
fs.mkdirSync(dir, { recursive: true });

const p256 = downsample(buf, S, 4);
fs.writeFileSync(path.join(dir, 'icon.png'), encodePNG(256, 256, p256));

const p32 = downsample(buf, S, 32);
fs.writeFileSync(path.join(dir, 'tray.png'), encodePNG(32, 32, p32));

const png256 = encodePNG(256, 256, p256);
const png32 = encodePNG(32, 32, p32);

function icoEntry(png, w, h, offset) {
  const e = Buffer.alloc(16);
  e[0] = w >= 256 ? 0 : w;
  e[1] = h >= 256 ? 0 : h;
  e[2] = 0;
  e[3] = 0;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  return e;
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(2, 4);

const off1 = 6 + 16 * 2;
const e1 = icoEntry(png256, 256, 256, off1);
const e2 = icoEntry(png32, 32, 32, off1 + png256.length);
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([header, e1, e2, png256, png32]));

console.log('icons written to', dir);
