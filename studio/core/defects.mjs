// Pixel defects WITH coordinates. gates.mjs says "N edge pixels are not the outline colour, e.g. three
// of them"; an agent that has to fix those pixels needs every one. The rules here are the gate rules
// (palette membership, binary alpha, silhouette outline, non-empty) applied pixel by pixel, and a test
// holds the two modules in agreement.
import { decodeRgba } from './png.mjs';

export const defectCodes = Object.freeze({
  size: 'error',
  empty_frame: 'error',
  partial_alpha: 'error',
  off_palette: 'error',
  outline_gap: 'error',
  outline_thick: 'warn',
  dirty_transparent: 'error', // severity is lowered to 'warn' on raw frames, see options.dirtyTransparent
});

const hex = n => '#' + n.toString(16).padStart(6, '0');
const MAX_PER_CODE = 200;

/**
 * options: {palette: Set<int>, outline: int|undefined, needOutline = true, borderIsEdge = false,
 *           dirtyTransparent = 'error' | 'warn' | 'ignore', maxPerCode = 200}
 * Returns {defects: [{code, severity, x, y, color?}], counts: {code: n}, totals: {error, warn}, truncated: [codes]}.
 * `counts` and `totals` are exact; `defects` keeps at most maxPerCode coordinates per code.
 */
export function findDefects({width, height, pixels}, options) {
  const {palette, outline, needOutline = true, borderIsEdge = false, dirtyTransparent = 'error',
    maxPerCode = MAX_PER_CODE} = options;
  const defects = [], counts = {}, totals = {error: 0, warn: 0};
  const add = (code, severity, x, y, color) => {
    counts[code] = (counts[code] ?? 0) + 1;
    totals[severity]++;
    if (counts[code] <= maxPerCode) defects.push({code, severity, x, y, ...(color === undefined ? {} : {color: hex(color)})});
  };
  const at = (x, y) => (y * width + x) * 4;
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  const opaque = (x, y) => inside(x, y) && pixels[at(x, y) + 3] === 255;
  const transparent = (x, y) => inside(x, y) ? pixels[at(x, y) + 3] === 0 : borderIsEdge;
  const rgb = (x, y) => pixels.readUIntBE(at(x, y), 3);

  const thick = [];
  let edges = 0, anyOpaque = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[at(x, y) + 3];
      if (alpha === 0) {
        if (dirtyTransparent !== 'ignore' && (pixels[at(x, y)] | pixels[at(x, y) + 1] | pixels[at(x, y) + 2]))
          add('dirty_transparent', dirtyTransparent === 'warn' ? 'warn' : 'error', x, y);
        continue;
      }
      if (alpha !== 255) { add('partial_alpha', 'error', x, y); continue; }
      anyOpaque = true;
      const color = rgb(x, y);
      if (!palette.has(color)) add('off_palette', 'error', x, y, color);
      const around = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      if (!around.some(([nx, ny]) => transparent(nx, ny))) continue;
      edges++;
      if (color !== outline) { if (needOutline) add('outline_gap', 'error', x, y, color); }
      else {
        const inward = around.filter(([nx, ny]) => opaque(nx, ny));
        if (inward.length && inward.every(([nx, ny]) => rgb(nx, ny) === outline)) thick.push([x, y]);
      }
    }
  }
  if (!anyOpaque || edges === 0) add('empty_frame', 'error', 0, 0);
  // Same rule as gates.mjs: only warn when a quarter or more of the edge is backed by outline.
  if (edges && thick.length * 4 > edges) thick.forEach(([x, y]) => add('outline_thick', 'warn', x, y));
  const truncated = Object.keys(counts).filter(code => counts[code] > maxPerCode);
  return {defects, counts, totals, truncated};
}

/** Decode PNG bytes and find defects; an unreadable file is one `unreadable` defect, never a throw. */
export function findDefectsInPng(bytes, options) {
  let image;
  try { image = decodeRgba(bytes); }
  catch (error) { return {image: null, defects: [], counts: {unreadable: 1}, totals: {error: 1, warn: 0}, truncated: [], unreadable: error.message}; }
  return {image, ...findDefects(image, options)};
}

export const severityOf = code => defectCodes[code] ?? 'error';
