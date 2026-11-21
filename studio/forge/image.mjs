// Shared RGBA image type and pixel primitives for the forge. Pure functions over plain
// {width, height, data} objects; nothing here knows a project, a palette or a pipeline step.
//
// data is a Uint8Array of width*height*4 bytes, row-major, R G B A. Coordinates are zero-based
// from the top left. Rectangles are half-open: [x0, y0, x1, y1).
import { createHash } from 'node:crypto';
import { decodeRgba, encodePixels } from '../core/png.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function createImage(width, height, fill) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`bad image size ${width}x${height}`);
  const data = new Uint8Array(width * height * 4);
  if (fill) for (let i = 0; i < data.length; i += 4) data.set(fill.length === 3 ? [...fill, 255] : fill, i);
  return {width, height, data};
}

export const cloneImage = img => ({width: img.width, height: img.height, data: img.data.slice()});

/** Python-style rounding (half to even), so ports of numpy/Pillow code agree on .5 ties. */
export function roundHalfEven(value) {
  const floor = Math.floor(value), diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Decode any 8-bit non-interlaced PNG (grey, RGB, indexed, RGBA) into an RGBA image. */
export function decodePng(png) {
  const {width, height, pixels} = decodeRgba(Buffer.from(png));
  return {width, height, data: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length)};
}

/** Canonical RGBA PNG bytes (the same encoder the core uses for saved assets). */
export function encodePng(img) {
  return encodePixels(img.width, img.height, Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length));
}

const at = (img, x, y) => (y * img.width + x) * 4;
export const getPixel = (img, x, y) => img.data.subarray(at(img, x, y), at(img, x, y) + 4);

/** Copy the half-open rectangle; parts outside the source come out transparent. */
export function crop(img, x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) throw new RangeError(`empty crop [${x0},${y0},${x1},${y1}]`);
  const out = createImage(x1 - x0, y1 - y0);
  for (let y = Math.max(y0, 0); y < Math.min(y1, img.height); y++) {
    const from = Math.max(x0, 0), to = Math.min(x1, img.width);
    if (to > from) out.data.set(img.data.subarray(at(img, from, y), at(img, to, y)), at(out, from - x0, y - y0));
  }
  return out;
}

/**
 * Draw src onto dst at (dx, dy), clipped to dst, in place. mode "replace" overwrites
 * (like a plain paste, transparent pixels included); "opaque" copies only pixels with alpha 255,
 * the rule the rig compositor uses for binary-alpha layers.
 */
export function blit(dst, src, dx = 0, dy = 0, mode = 'replace') {
  if (mode !== 'replace' && mode !== 'opaque') throw new RangeError(`unknown blit mode ${mode}`);
  for (let y = Math.max(0, -dy); y < Math.min(src.height, dst.height - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(src.width, dst.width - dx); x++) {
      const s = at(src, x, y);
      if (mode === 'opaque' && src.data[s + 3] !== 255) continue;
      dst.data.set(src.data.subarray(s, s + 4), at(dst, x + dx, y + dy));
    }
  }
  return dst;
}

// Pillow's fixed-point arithmetic, reproduced so imports match the Python prototype pixel for pixel.
const mulDiv255 = (a, b) => { const t = a * b + 128; return ((t >> 8) + t) >> 8; };
const clip8 = v => v < 0 ? 0 : v > 255 ? 255 : v;

export function premultiply(img) {
  const out = cloneImage(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = mulDiv255(d[i + c], d[i + 3]);
  return out;
}

export function unpremultiply(img) {
  const out = cloneImage(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 0 || a === 255) continue;
    for (let c = 0; c < 3; c++) d[i + c] = clip8(Math.trunc(255 * d[i + c] / a));
  }
  return out;
}

const PRECISION = 22;

function boxCoefficients(inSize, outSize) {
  const scale = inSize / outSize, filterScale = Math.max(scale, 1), support = 0.5 * filterScale, ss = 1 / filterScale;
  const rows = [];
  for (let o = 0; o < outSize; o++) {
    const center = (o + 0.5) * scale;
    const min = Math.max(Math.trunc(center - support + 0.5), 0);
    const max = Math.min(Math.trunc(center + support + 0.5), inSize) - min;
    const weights = [];
    let total = 0;
    for (let x = 0; x < max; x++) {
      const v = (x + min - center + 0.5) * ss;
      const w = v > -0.5 && v <= 0.5 ? 1 : 0;
      weights.push(w);
      total += w;
    }
    rows.push({min, k: weights.map(w => {
      const f = total ? w / total : w;
      return f < 0 ? Math.trunc(-0.5 + f * 2 ** PRECISION) : Math.trunc(0.5 + f * 2 ** PRECISION);
    })});
  }
  return rows;
}

/**
 * Pillow's BOX resize of all four channels as stored: horizontal pass, 8-bit round, vertical pass. Each output
 * pixel is the plain average of the input pixels whose centres fall in its window (not fractional area).
 */
export function resizeBox(img, width, height) {
  let src = img;
  for (const axis of ['x', 'y']) {
    const horizontal = axis === 'x', inSize = horizontal ? src.width : src.height, outSize = horizontal ? width : height;
    if (inSize === outSize) continue;
    const coeffs = boxCoefficients(inSize, outSize);
    const out = horizontal ? createImage(width, src.height) : createImage(src.width, height);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      const {min, k} = coeffs[horizontal ? x : y];
      for (let c = 0; c < 4; c++) {
        let sum = 2 ** (PRECISION - 1);
        for (let j = 0; j < k.length; j++) sum += src.data[at(src, horizontal ? min + j : x, horizontal ? y : min + j) + c] * k[j];
        out.data[at(out, x, y) + c] = clip8(Math.floor(sum / 2 ** PRECISION));
      }
    }
    src = out;
  }
  return src === img ? cloneImage(img) : src;
}

/** Premultiplied BOX downscale: colours never bleed in from transparent pixels. */
export const boxDownscale = (img, width, height) => unpremultiply(resizeBox(premultiply(img), width, height));

/** Binarise alpha (>= threshold becomes 255, the rest 0) and zero the colour of cleared pixels. */
export function thresholdAlpha(img, threshold = 128) {
  const out = cloneImage(img), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= threshold) d[i + 3] = 255;
    else d.fill(0, i, i + 4);
  }
  return out;
}

const dist = (r, g, b, c) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;

/** Replace the colour of every opaque pixel with its nearest entry in `colors` ([r,g,b][]), first wins ties. */
export function snapPalette(img, colors) {
  if (!colors.length) throw new RangeError('empty palette');
  const out = cloneImage(img), d = out.data, cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let hit = cache.get(key);
    if (!hit) {
      let best = Infinity;
      for (const c of colors) { const e = dist(d[i], d[i + 1], d[i + 2], c); if (e < best) { best = e; hit = c; } }
      cache.set(key, hit);
    }
    d[i] = hit[0]; d[i + 1] = hit[1]; d[i + 2] = hit[2];
  }
  return out;
}

/** Rebuild a 1px outline: every opaque pixel with a transparent 4-neighbour becomes `color`. */
export function rebuildOutline(img, color, {borderIsEdge = true} = {}) {
  const out = cloneImage(img), {width: w, height: h, data: d} = img;
  const solid = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? !borderIsEdge : d[at(img, x, y) + 3] === 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[at(img, x, y) + 3] !== 255) continue;
    if (!(solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) out.data.set(color, at(out, x, y));
  }
  return out;
}

/** Bounding box [x0, y0, x1, y1) of pixels where predicate(index into data) is true, or null. */
export function boundsOf(img, test = i => img.data[i + 3] !== 0, region) {
  const [rx0, ry0, rx1, ry1] = region ?? [0, 0, img.width, img.height];
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
    if (!test(at(img, x, y))) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Nearest-neighbour integer upscale for previews. */
export function upscale(img, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new RangeError('factor must be a positive integer');
  const out = createImage(img.width * factor, img.height * factor);
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++)
    out.data.set(img.data.subarray(at(img, Math.floor(x / factor), Math.floor(y / factor)), at(img, Math.floor(x / factor), Math.floor(y / factor)) + 4), at(out, x, y));
  return out;
}

export const imagesEqual = (a, b) => a.width === b.width && a.height === b.height && Buffer.compare(a.data, b.data) === 0;

/** Number of pixels that differ and the first few of them, for readable test failures. */
export function diffImages(a, b, limit = 8) {
  if (a.width !== b.width || a.height !== b.height) return {sizeMismatch: [a.width, a.height, b.width, b.height], count: Infinity, first: []};
  const first = []; let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let same = true;
    for (let c = 0; c < 4; c++) if (a.data[i + c] !== b.data[i + c]) same = false;
    if (same) continue;
    count++;
    if (first.length < limit) first.push({x: (i / 4) % a.width, y: Math.floor(i / 4 / a.width), a: [...a.data.subarray(i, i + 4)], b: [...b.data.subarray(i, i + 4)]});
  }
  return {count, first};
}

export const hexToRgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
