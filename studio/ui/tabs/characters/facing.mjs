// Cross-facing analysis on RGBA pixel buffers. Pure; used by the cross-facing view and its tests.

export function mirrorX({width, height, data}) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = (y * width + (width - 1 - x)) * 4;
    out[to] = data[from]; out[to + 1] = data[from + 1]; out[to + 2] = data[from + 2]; out[to + 3] = data[from + 3];
  }
  return {width, height, data: out};
}

/**
 * Compare two frames of equal size. Each pixel is `same`, `colour` (both opaque, different colours),
 * `onlyA` or `onlyB`. Returns the counts, a per-pixel kind array and a verdict.
 */
export function compare(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('frames differ in size');
  const kinds = new Uint8Array(a.width * a.height);
  const counts = {same: 0, colour: 0, onlyA: 0, onlyB: 0};
  const names = ['same', 'colour', 'onlyA', 'onlyB'];
  for (let i = 0; i < kinds.length; i++) {
    const p = i * 4, oa = a.data[p + 3] > 0, ob = b.data[p + 3] > 0;
    let kind = 0;
    if (oa && ob) kind = a.data[p] === b.data[p] && a.data[p + 1] === b.data[p + 1] && a.data[p + 2] === b.data[p + 2] ? 0 : 1;
    else if (oa) kind = 2;
    else if (ob) kind = 3;
    if (oa || ob) counts[names[kind]]++;
    kinds[i] = oa || ob ? kind + 1 : 0; // 0 means empty on both
  }
  const opaque = counts.same + counts.colour + counts.onlyA + counts.onlyB;
  const differing = counts.colour + counts.onlyA + counts.onlyB;
  return {counts, kinds, opaque, differing, verdict: differing === 0 ? 'identical' : differing / Math.max(opaque, 1) < 0.1 ? 'close' : 'different'};
}

/** Bounding box [x0, y0, x1, y1) of opaque pixels, or null. */
export function opaqueBounds({width, height, data}) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Marker-coloured pixels of one frame: where an asymmetric mark (given as an RGB triple) sits. */
export function markPixels({width, height, data}, rgb) {
  const out = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    if (data[p + 3] && data[p] === rgb[0] && data[p + 1] === rgb[1] && data[p + 2] === rgb[2]) out.push([x, y]);
  }
  return out;
}

/** Does a rig landmark box (half-open) contain at least one marker pixel, and are all marker pixels inside some box? */
export function markSide(pixels, boxes, expectAbsent = false) {
  const inside = ([x, y]) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
  if (expectAbsent) return {ok: pixels.length === 0, missing: false, stray: pixels};
  const stray = pixels.filter(p => !inside(p));
  return {ok: pixels.length > 0 && stray.length === 0, missing: pixels.length === 0, stray};
}
