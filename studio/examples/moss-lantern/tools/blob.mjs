#!/usr/bin/env node
// A tiny deterministic generator for this project: a blob, leaf or spark on the project palette, outlined,
// one or more pulsing frames. Plain Node, no dependencies, no studio import: a project's generator stands alone.
//   node tools/blob.mjs --out <dir> --palette <file> --shape blob|leaf|spark --size 12 --fill moss_2 --accent cream_1
//        --clip glyph --direction none --frames 1 --seed 1
// Writes <clip>_<direction>_<n>.png into <dir>. The same arguments always give the same bytes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const size = Number(args.size), frames = Number(args.frames), seed = Number(args.seed);
const palette = JSON.parse(fs.readFileSync(args.palette, 'utf8'));
const hexOf = id => { const c = palette.colors.find(x => x.id === id); if (!c) throw new Error(`no palette colour ${id}`); return c.hex; };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ink = rgb(palette.outline), fill = rgb(hexOf(args.fill)), accent = rgb(hexOf(args.accent));

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
};
const png = (w, h, rgba) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
};
// A small seeded generator (mulberry32).
const rng = a => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const inside = {
  blob: (x, y, r) => x * x + y * y <= r * r,
  leaf: (x, y, r) => Math.abs(x) / r + Math.abs(y) / (r * 1.25) <= 1 && y >= -r * 1.1,
  spark: (x, y, r) => Math.abs(x) * Math.abs(y) <= r * 0.5 && Math.abs(x) <= r && Math.abs(y) <= r,
}[args.shape];
fs.mkdirSync(args.out, {recursive: true});
for (let n = 0; n < frames; n++) {
  const r = size / 2 - 1.5 - (frames > 1 ? (n % 2) * 0.6 : 0), c = (size - 1) / 2, random = rng(seed * 1000 + n);
  const solid = (x, y) => x >= 0 && y >= 0 && x < size && y < size && inside(x - c, y - c, r);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!solid(x, y)) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solid(x + dx, y + dy)) edge = true;
    const colour = edge ? ink : (random() < 0.12 ? accent : fill);
    px.set([...colour, 255], (y * size + x) * 4);
  }
  fs.writeFileSync(path.join(args.out, `${args.clip}_${args.direction}_${n}.png`), png(size, size, px));
}
