// Shared RGBA image type and pixel primitives for the forge. Pure functions over plain
// {width, height, pixels} objects; nothing here knows a project, a palette or a pipeline step.
//
// pixels is a Buffer of width*height*4 bytes, row-major, R G B A. `data` is a non-enumerable alias of the
// same buffer (the name the sheet and pixelise code used before the rig lane's frames were folded in). Coordinates are zero-based
// from the top left. Rectangles are half-open: [x0, y0, x1, y1).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeRgba, encodePixels } from '../core/png.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Build an image over an existing RGBA buffer; the one place an image object is made. */
export function makeImage(width, height, pixels) {
  const img = {width, height, pixels};
  Object.defineProperty(img, 'data', {value: pixels, enumerable: false});
  return img;
}

export function createImage(width, height, fill) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError(`bad image size ${width}x${height}`);
  const pixels = Buffer.alloc(width * height * 4);
  if (fill) for (let i = 0; i < pixels.length; i += 4) pixels.set(fill.length === 3 ? [...fill, 255] : fill, i);
  return makeImage(width, height, pixels);
}

export const cloneImage = img => makeImage(img.width, img.height, Buffer.from(img.pixels));

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
  return makeImage(width, height, pixels);
}

/** Canonical RGBA PNG bytes (the same encoder the core uses for saved assets). */
export function encodePng(img) {
  return encodePixels(img.width, img.height, img.pixels);
}

const at = (img, x, y) => (y * img.width + x) * 4;
export const getPixel = (img, x, y) => img.pixels.subarray(at(img, x, y), at(img, x, y) + 4);

/** Copy the half-open rectangle; parts outside the source come out transparent. */
export function crop(img, x0, y0, x1, y1) {
  if (x1 <= x0 || y1 <= y0) throw new RangeError(`empty crop [${x0},${y0},${x1},${y1}]`);
  const out = createImage(x1 - x0, y1 - y0);
  for (let y = Math.max(y0, 0); y < Math.min(y1, img.height); y++) {
    const from = Math.max(x0, 0), to = Math.min(x1, img.width);
    if (to > from) out.pixels.set(img.pixels.subarray(at(img, from, y), at(img, to, y)), at(out, from - x0, y - y0));
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
      if (mode === 'opaque' && src.pixels[s + 3] !== 255) continue;
      dst.pixels.set(src.pixels.subarray(s, s + 4), at(dst, x + dx, y + dy));
    }
  }
  return dst;
}

// Pillow's fixed-point arithmetic, reproduced so imports match the Python prototype pixel for pixel.
const mulDiv255 = (a, b) => { const t = a * b + 128; return ((t >> 8) + t) >> 8; };
const clip8 = v => v < 0 ? 0 : v > 255 ? 255 : v;

export function premultiply(img) {
  const out = cloneImage(img), d = out.pixels;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = mulDiv255(d[i + c], d[i + 3]);
  return out;
}

export function unpremultiply(img) {
  const out = cloneImage(img), d = out.pixels;
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
        for (let j = 0; j < k.length; j++) sum += src.pixels[at(src, horizontal ? min + j : x, horizontal ? y : min + j) + c] * k[j];
        out.pixels[at(out, x, y) + c] = clip8(Math.floor(sum / 2 ** PRECISION));
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
  const out = cloneImage(img), d = out.pixels;
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
  const out = cloneImage(img), d = out.pixels, cache = new Map();
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
  const out = cloneImage(img), {width: w, height: h, pixels: d} = img;
  const solid = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? !borderIsEdge : d[at(img, x, y) + 3] === 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[at(img, x, y) + 3] !== 255) continue;
    if (!(solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) out.pixels.set(color, at(out, x, y));
  }
  return out;
}

/** Bounding box [x0, y0, x1, y1) of pixels where predicate(byte index into pixels) is true, or null. */
export function boundsOf(img, test = i => img.pixels[i + 3] !== 0, region) {
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
    out.pixels.set(img.pixels.subarray(at(img, Math.floor(x / factor), Math.floor(y / factor)), at(img, Math.floor(x / factor), Math.floor(y / factor)) + 4), at(out, x, y));
  return out;
}

export const imagesEqual = (a, b) => a.width === b.width && a.height === b.height && Buffer.compare(a.pixels, b.pixels) === 0;

/** Number of pixels that differ and the first few of them, for readable test failures. */
export function diffImages(a, b, limit = 8) {
  if (a.width !== b.width || a.height !== b.height) return {sizeMismatch: [a.width, a.height, b.width, b.height], count: Infinity, first: []};
  const first = []; let count = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let same = true;
    for (let c = 0; c < 4; c++) if (a.pixels[i + c] !== b.pixels[i + c]) same = false;
    if (same) continue;
    count++;
    if (first.length < limit) first.push({x: (i / 4) % a.width, y: Math.floor(i / 4 / a.width), a: [...a.pixels.subarray(i, i + 4)], b: [...b.pixels.subarray(i, i + 4)]});
  }
  return {count, first};
}

export const hexToRgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- frame helpers (rig lane vocabulary)
// Frames are images; these names are what the rig baker, patches and gates use.

export const createFrame = createImage;
export const cloneFrame = cloneImage;
export const framesEqual = imagesEqual;
export const readFrame = path => { const {width, height, pixels} = decodeRgba(readFileSync(path)); return makeImage(width, height, pixels); };
export const writeFrame = (path, frame) => writeFileSync(path, encodePng(frame));
export const outline = (frame, ink) => rebuildOutline(frame, ink);

export const alphaAt = (frame, x, y) => frame.pixels[(y * frame.width + x) * 4 + 3];
export const inBounds = (frame, x, y) => x >= 0 && y >= 0 && x < frame.width && y < frame.height;

export function getRgb(frame, x, y) {
  const k = (y * frame.width + x) * 4;
  return [frame.pixels[k], frame.pixels[k + 1], frame.pixels[k + 2]];
}

export function setPixel(frame, x, y, rgb) {
  const k = (y * frame.width + x) * 4;
  if (rgb === null) frame.pixels.fill(0, k, k + 4);
  else { frame.pixels[k] = rgb[0]; frame.pixels[k + 1] = rgb[1]; frame.pixels[k + 2] = rgb[2]; frame.pixels[k + 3] = 255; }
}

/** Opaque means alpha 255, the only opaque value the project's binary-alpha rule allows. */
export function opaqueMask(frame) {
  const mask = new Uint8Array(frame.width * frame.height);
  for (let i = 0; i < mask.length; i++) mask[i] = frame.pixels[i * 4 + 3] === 255 ? 1 : 0;
  return mask;
}

/** Half-open bounding box [x0, y0, x1, y1) of non-zero alpha. Throws on an empty frame. */
export function bounds(frame, window) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const [wx0, wx1] = window ?? [0, frame.width];
  for (let y = 0; y < frame.height; y++) {
    for (let x = wx0; x < wx1; x++) {
      if (frame.pixels[(y * frame.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1;
      if (y < y0) y0 = y; if (y + 1 > y1) y1 = y + 1;
    }
  }
  if (x1 < 0) throw new Error('empty silhouette');
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- palette

/**
 * Palette helper over the project palette JSON shape ({colors: [{id, hex}], outline_id}).
 * Nothing in here knows a particular palette; the project pack supplies it.
 */
export function makePalette(data) {
  const byId = new Map();
  const byInt = new Map();
  for (const {id, hex} of data.colors) {
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16));
    byId.set(id, rgb);
    byInt.set((rgb[0] << 16) | (rgb[1] << 8) | rgb[2], id);
  }
  const rgb = id => {
    const found = byId.get(id);
    if (!found) throw new Error(`unknown palette id "${id}"`);
    return found;
  };
  const idOf = ([r, g, b]) => byInt.get((r << 16) | (g << 8) | b) ?? null;
  const outlineId = data.outline_id ?? null;
  // `colors` keeps each entry's group (when the palette file has one): the palette-bound drawing helpers build ramps from it.
  return {ids: [...byId.keys()], rgb, idOf, has: id => byId.has(id), outlineId, outline: outlineId ? rgb(outlineId) : null,
    colors: data.colors.map(({id, hex, group}) => ({id, hex, group: group ?? null}))};
}

export const sameRgb = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function isColor(frame, x, y, rgb) {
  const k = (y * frame.width + x) * 4;
  return frame.pixels[k + 3] === 255 && frame.pixels[k] === rgb[0] && frame.pixels[k + 1] === rgb[1] && frame.pixels[k + 2] === rgb[2];
}

/** Integer luma on 0..255 (same weights as the prototype: 54, 183, 19 over 256). */
export const luma = ([r, g, b]) => (r * 54 + g * 183 + b * 19) / 256;

// ---------------------------------------------------------------- polygon (Pillow ImageDraw.polygon, fill only)

const roundUp = f => (f >= 0 ? Math.floor(f + 0.5) : -Math.floor(Math.abs(f) + 0.5));
const roundDown = f => (f >= 0 ? Math.ceil(f - 0.5) : -Math.ceil(Math.abs(f) - 0.5));

/**
 * Filled polygon mask with Pillow's scanline rule: edges are included, a pixel is inside when its
 * centre-rounded span covers it. Returns a Uint8Array(width*height) of 0/1.
 */
export function polygonMask(width, height, points) {
  const mask = new Uint8Array(width * height);
  const n = points.length;
  if (n < 3) throw new Error('a polygon needs at least 3 points');
  const f32 = Math.fround;
  const edges = [];
  const hline = (x0, y, x1) => {
    if (y < 0 || y >= height) return;
    for (let x = Math.max(x0, 0); x <= Math.min(x1, width - 1); x++) mask[y * width + x] = 1;
  };
  for (let i = 0; i < n; i++) {
    let [x0, y0] = points[i];
    let [x1, y1] = points[(i + 1) % n];
    if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
    edges.push({x0, y0, x1, y1, ymin: y0, ymax: y1, xmin: Math.min(x0, x1), xmax: Math.max(x0, x1),
      dx: y0 === y1 ? 0 : f32((x1 - x0) / (y1 - y0))});
  }
  let ymin = height - 1, ymax = 0;
  const table = [];
  for (const e of edges) {
    if (ymin > e.ymin) ymin = e.ymin;
    if (ymax < e.ymax) ymax = e.ymax;
    if (e.ymin === e.ymax) { hline(e.xmin, e.ymin, e.xmax); continue; }
    table.push(e);
  }
  if (ymin < 0) ymin = 0;
  if (ymax >= height) ymax = height - 1;
  for (let y = ymin; y <= ymax; y++) {
    const xs = [];
    for (const e of table) {
      if (y >= e.ymin && y <= e.ymax) xs.push(f32(f32((y - e.y0) * e.dx) + e.x0));
      if (y === e.ymax && y < ymax) xs.push(xs[xs.length - 1]);
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) hline(roundUp(xs[i - 1]), y, roundDown(xs[i]));
  }
  return mask;
}

/** Keep only the pixels of `frame` inside `points`; everything else becomes transparent. */
export function maskPart(frame, points) {
  const mask = polygonMask(frame.width, frame.height, points);
  const out = createFrame(frame.width, frame.height);
  for (let i = 0; i < mask.length; i++) if (mask[i]) frame.pixels.copy(out.pixels, i * 4, i * 4, i * 4 + 4);
  return out;
}

// ---------------------------------------------------------------- rotate (Pillow Image.rotate, NEAREST, given centre)

const round15 = v => Math.round(v * 1e15) / 1e15;

/** Rotate counter-clockwise by `degrees` about `center` with nearest sampling and a transparent fill. */
export function rotateNearest(frame, degrees, center) {
  const out = createFrame(frame.width, frame.height);
  const a = -degrees * Math.PI / 180;
  const m0 = round15(Math.cos(a)), m1 = round15(Math.sin(a)), m3 = round15(-Math.sin(a)), m4 = m0;
  const [cx, cy] = center;
  let m2 = m0 * -cx + m1 * -cy;
  let m5 = m3 * -cx + m4 * -cy;
  m2 += cx; m5 += cy;
  // Pillow samples nearest-neighbour affines in 16.16 fixed point, advancing the row start by m1 / m4.
  const fix = v => Math.floor(v * 65536 + 0.5);
  const a0 = fix(m0), a1 = fix(m1), a3 = fix(m3), a4 = fix(m4);
  let a2 = fix(m2 + m0 * 0.5 + m1 * 0.5), a5 = fix(m5 + m3 * 0.5 + m4 * 0.5);
  for (let y = 0; y < frame.height; y++) {
    let xx = a2, yy = a5;
    for (let x = 0; x < frame.width; x++, xx += a0, yy += a3) {
      const xin = xx >> 16, yin = yy >> 16;
      if (xin < 0 || yin < 0 || xin >= frame.width || yin >= frame.height) continue;
      const s = (yin * frame.width + xin) * 4;
      frame.pixels.copy(out.pixels, (y * frame.width + x) * 4, s, s + 4);
    }
    a2 += a1; a5 += a4;
  }
  return out;
}

// ---------------------------------------------------------------- composite

/**
 * Copy the opaque pixels of `src` onto `dst` shifted by (dx, dy); anything shifted off the canvas is
 * dropped. Returns a 0/1 mask of the pixels `src` covered, in destination coordinates.
 */
export function place(dst, src, dx = 0, dy = 0) {
  const covered = new Uint8Array(dst.width * dst.height);
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      if (src.pixels[s + 3] !== 255) continue;
      src.pixels.copy(dst.pixels, (ty * dst.width + tx) * 4, s, s + 4);
      covered[ty * dst.width + tx] = 1;
    }
  }
  return covered;
}

/** Shift a whole frame with clipping (no wrap). */
export function shiftFrame(frame, dx, dy) {
  const out = createFrame(frame.width, frame.height);
  place(out, frame, dx, dy);
  return out;
}

export function flipHorizontal(frame) {
  const out = createFrame(frame.width, frame.height);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const s = (y * frame.width + x) * 4;
      frame.pixels.copy(out.pixels, (y * frame.width + (frame.width - 1 - x)) * 4, s, s + 4);
    }
  }
  return out;
}

// ---------------------------------------------------------------- contact sheet (RGB, for review artifacts)

/** Nearest-neighbour scaled composite of rows of frames on a flat background. Returns a frame. */
export function contactSheet(rows, {scale = 4, background = [130, 124, 136], gap = 4, margin = 6} = {}) {
  const tile = rows.flat()[0];
  const cols = Math.max(...rows.map(r => r.length));
  const tw = tile.width * scale, th = tile.height * scale;
  const width = margin * 2 + cols * tw + (cols - 1) * gap;
  const height = margin * 2 + rows.length * th + (rows.length - 1) * gap;
  const sheet = createFrame(width, height);
  for (let i = 0; i < width * height; i++) { sheet.pixels[i * 4] = background[0]; sheet.pixels[i * 4 + 1] = background[1]; sheet.pixels[i * 4 + 2] = background[2]; sheet.pixels[i * 4 + 3] = 255; }
  rows.forEach((row, r) => row.forEach((frame, c) => {
    const ox = margin + c * (tw + gap), oy = margin + r * (th + gap);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const s = (y * frame.width + x) * 4;
      if (frame.pixels[s + 3] !== 255) continue;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
        frame.pixels.copy(sheet.pixels, ((oy + y * scale + j) * width + ox + x * scale + i) * 4, s, s + 4);
      }
    }
  }));
  return sheet;
}
