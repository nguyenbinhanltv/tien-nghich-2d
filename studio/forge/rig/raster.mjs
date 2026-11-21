// Raster primitives for the rig baker: native-resolution RGBA frames, polygon masks, nearest-neighbour
// rotation, clipped placement, outline rebuild, palette helpers and PNG file IO.
//
// NOTE FOR CONSOLIDATION: these are the image primitives the rig lane needs before studio/forge/image.mjs
// exists. The polygon fill and rotate here reproduce Pillow's ImageDraw.polygon and Image.rotate(NEAREST)
// bit for bit (checked against the Python prototype in rig/tests/raster.test.mjs), which is what lets the
// Node baker reproduce the bake-off frames exactly. Move or re-export them when the shared module lands.
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeRgba, encodePixels } from '../../core/png.mjs';

/** A frame is {width, height, pixels: Buffer} with 4 bytes (R,G,B,A) per pixel, row-major. */
export function createFrame(width, height) {
  return {width, height, pixels: Buffer.alloc(width * height * 4)};
}

export function cloneFrame(frame) {
  return {width: frame.width, height: frame.height, pixels: Buffer.from(frame.pixels)};
}

export function framesEqual(a, b) {
  return a.width === b.width && a.height === b.height && a.pixels.equals(b.pixels);
}

export function readFrame(path) {
  return decodeRgba(readFileSync(path));
}

export function writeFrame(path, frame) {
  writeFileSync(path, encodePixels(frame.width, frame.height, frame.pixels));
}

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
  return {ids: [...byId.keys()], rgb, idOf, has: id => byId.has(id), outlineId, outline: outlineId ? rgb(outlineId) : null};
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

/** Replace every opaque pixel that touches a non-opaque 4-neighbour (or the canvas edge) with `ink`. */
export function outline(frame, ink) {
  const out = cloneFrame(frame);
  const {width, height} = frame;
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && frame.pixels[(y * width + x) * 4 + 3] === 255;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) continue;
      const k = (y * width + x) * 4;
      out.pixels[k] = ink[0]; out.pixels[k + 1] = ink[1]; out.pixels[k + 2] = ink[2];
    }
  }
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
