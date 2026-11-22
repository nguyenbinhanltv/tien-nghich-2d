// A standing figure for lineup tests. Not a test file.
import { createImage } from '../image.mjs';

export const INK = 0x14101a, BODY = [180, 60, 60];

/** A standing figure on a w x h canvas, feet on the bottom row: head, neck, body, two legs; `ow` thick outline (1 by default). */
export function figure({ ink = INK, fill: bodyColor = BODY, w = 32, h = 32, head = 10, headW = 10, neck = 1, body = 11, bodyW = 14, leg = 5, legW = 4, gap = 2, ow = 1 } = {}) {
  const img = createImage(w, h);
  const total = head + neck + body + leg, top = h - total, cx = Math.floor(w / 2);
  const mask = new Uint8Array(w * h);
  const box = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1; };
  box(cx - headW / 2, top, cx + headW / 2, top + head);
  box(cx - 3, top + head, cx + 3, top + head + neck);
  box(cx - bodyW / 2, top + head + neck, cx + bodyW / 2, top + head + neck + body);
  box(cx - gap / 2 - legW, h - leg, cx - gap / 2, h); box(cx + gap / 2, h - leg, cx + gap / 2 + legW, h);
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    // the distance to the nearest empty pixel (up to ow) decides ink or body
    let isInk = false;
    for (let d = 0; d < ow && !isInk; d++) isInk = !at(x - 1 - d, y) || !at(x + 1 + d, y) || !at(x, y - 1 - d) || !at(x, y + 1 + d);
    img.pixels.set(isInk ? [ink >> 16, (ink >> 8) & 255, ink & 255, 255] : [...bodyColor, 255], (y * w + x) * 4);
  }
  return img;
}

