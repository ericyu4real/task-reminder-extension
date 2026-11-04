// Writes extension/icons/icon{16,32,48,128}.png: a dark rounded square with a green dot.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = path.resolve(import.meta.dirname, '../extension/icons');
fs.mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// Signed distance to a rounded square of half-size h and corner radius r, centred at origin.
const roundedSquare = (x, y, h, r) => {
  const qx = Math.abs(x) - (h - r);
  const qy = Math.abs(y) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c;
      const py = y + 0.5 - c;
      const bg = coverage(roundedSquare(px, py, size * 0.47, size * 0.22));
      const dot = coverage(Math.hypot(px, py) - size * 0.2);
      const r = 28 + (52 - 28) * dot;
      const g = 28 + (199 - 28) * dot;
      const b = 30 + (89 - 30) * dot;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = Math.round(r);
      raw[i + 1] = Math.round(g);
      raw[i + 2] = Math.round(b);
      raw[i + 3] = Math.round(255 * bg);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), icon(size));
}
console.log(`icons written to ${outDir}`);
