// Pixel difference between two PNGs of the same frame.
import { decodeRgba } from './png.mjs';
import { sha256 } from './fsutil.mjs';

/** Returns {identical, hashes, size, changedPixels, box, sample[]}; sizes that differ are reported, not compared. */
export function diffPng(aBytes, bBytes, {sample = 12} = {}) {
  const hashes = {before: sha256(aBytes), after: sha256(bBytes)};
  if (hashes.before === hashes.after) return {identical: true, hashes, changedPixels: 0};
  const a = decodeRgba(aBytes), b = decodeRgba(bBytes);
  const size = {before: [a.width, a.height], after: [b.width, b.height]};
  if (a.width !== b.width || a.height !== b.height) return {identical: false, hashes, size, sizeChanged: true, changedPixels: null};
  let changed = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  const points = [];
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const k = (y * a.width + x) * 4;
      const aa = a.pixels[k + 3], bb = b.pixels[k + 3];
      const same = aa === bb && (aa === 0 || (a.pixels[k] === b.pixels[k] && a.pixels[k + 1] === b.pixels[k + 1] && a.pixels[k + 2] === b.pixels[k + 2]));
      if (same) continue;
      changed++;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (points.length < sample) {
        const hex = (px, o) => (px[o + 3] ? '#' + px.readUIntBE(o, 3).toString(16).padStart(6, '0') : 'transparent');
        points.push({x, y, before: hex(a.pixels, k), after: hex(b.pixels, k)});
      }
    }
  }
  return {identical: changed === 0, hashes, size, changedPixels: changed,
    ...(changed ? {box: {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1}, sample: points} : {note: 'bytes differ but every pixel is equal (PNG encoding only)'})};
}
