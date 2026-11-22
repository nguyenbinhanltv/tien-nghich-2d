// Direct pixel edits as data. A patch document stores an ordered list of operations per frame key; the
// baker applies them after the bake, so a fix survives a rebuild. This is the engine behind studio_frame_patch.
//
//   {"schema": "studio.patch", "version": 1, "frames": {"idle_south_0": [{"op": "set", ...}, ...]}}
//
// Colours are palette ids (null clears to transparent). Boxes are half-open [x0, y0, x1, y1].
import { BAYER_SIZES, LIGHTS, PATTERNS, ditherAt, hueShiftRamp, patternAt, lightPosition, shadeId } from '../../core/shading.mjs';
import { cloneFrame, getRgb, outline, setPixel, alphaAt, sameRgb, inBounds } from '../image.mjs';

export const patchKey = (clip, facing, index) => `${clip}_${facing}_${index}`;
export const patchOps = ['set', 'line', 'fill', 'flood', 'shift', 'copy', 'outline', 'shade', 'dither', 'pattern', 'gradient'];

export const emptyPatch = () => ({schema: 'studio.patch', version: 1, frames: {}});

/** Append operations to a frame key, returning a new patch document (the input is not mutated). */
export function appendOps(patch, key, ops) {
  const next = {...patch, frames: {...patch.frames}};
  next.frames[key] = [...(next.frames[key] ?? []), ...ops];
  return next;
}

function checkPoint(at, [x, y], width, height, issues) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) issues.push(`${at}: point ${JSON.stringify([x, y])} outside the ${width}x${height} canvas`);
}

function checkBox(at, box, width, height, issues) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isInteger)) { issues.push(`${at}: box must be [x0, y0, x1, y1] integers`); return; }
  const [x0, y0, x1, y1] = box;
  if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x0 >= x1 || y0 >= y1) issues.push(`${at}: box ${JSON.stringify(box)} must be non-empty and inside the ${width}x${height} canvas`);
}

/** Validate a patch document against a canvas and palette. Returns a list of issue strings. */
export function validatePatch(patch, {palette, width, height}) {
  const issues = [];
  if (patch?.schema !== 'studio.patch' || patch.version !== 1) return ['patch must have schema "studio.patch" and version 1'];
  if (typeof patch.frames !== 'object' || patch.frames === null || Array.isArray(patch.frames)) return ['patch.frames must be an object'];
  const color = (at, id) => { if (id !== null && !palette.has(id)) issues.push(`${at}: unknown palette id "${id}"`); };
  for (const [key, ops] of Object.entries(patch.frames)) {
    if (!/^[a-z0-9_]+_(south|west|north|east|none)_\d+$/.test(key)) issues.push(`frames.${key}: key must look like clip_facing_index`);
    if (!Array.isArray(ops)) { issues.push(`frames.${key}: must be an array of operations`); continue; }
    ops.forEach((op, n) => {
      const at = `frames.${key}[${n}]`;
      if (!patchOps.includes(op?.op)) { issues.push(`${at}: unknown op "${op?.op}"`); return; }
      if (op.op === 'set') {
        if (!Array.isArray(op.pixels) || !op.pixels.length) issues.push(`${at}: set needs pixels [[x, y, colour], ...]`);
        else op.pixels.forEach(p => { checkPoint(at, p, width, height, issues); color(at, p[2] ?? null); });
      } else if (op.op === 'line') { checkPoint(at, op.from, width, height, issues); checkPoint(at, op.to, width, height, issues); color(at, op.color ?? null); }
      else if (op.op === 'fill') { checkBox(at, op.box, width, height, issues); color(at, op.color ?? null); }
      else if (op.op === 'flood') { checkPoint(at, op.at, width, height, issues); color(at, op.color ?? null); }
      else if (op.op === 'shift' || op.op === 'copy') {
        checkBox(at, op.box, width, height, issues);
        if (!Number.isInteger(op.dx) || !Number.isInteger(op.dy)) issues.push(`${at}: dx and dy must be integers`);
        if (op.from !== undefined && (!op.from || typeof op.from.facing !== 'string' || !Number.isInteger(op.from.frame))) issues.push(`${at}: from must be {facing, frame}`);
        if (op.from !== undefined && op.op === 'shift') issues.push(`${at}: shift works inside the frame; use copy with from`);
      }
      else if (['shade', 'dither', 'pattern', 'gradient'].includes(op.op)) checkShading(at, op, {palette, width, height}, issues, checkBox, color);
    });
  }
  return issues;
}

/** The palette-bound drawing operations (shade, dither, pattern, gradient). Every colour they write is a palette id. */
function checkShading(at, op, {palette, width, height}, issues, checkBox, color) {
  checkBox(at, op.box, width, height, issues);
  if (op.op === 'shade') {
    if (op.light !== undefined && !Object.hasOwn(LIGHTS, op.light)) issues.push(`${at}: light must be one of ${Object.keys(LIGHTS).join(', ')}`);
    if (op.strength !== undefined && ![1, 2].includes(op.strength)) issues.push(`${at}: strength must be 1 or 2`);
  } else if (op.op === 'dither') {
    for (const k of ['from', 'to']) { if (typeof op[k] !== 'string') issues.push(`${at}: dither needs ${k} (a palette id)`); else color(at, op[k]); }
    if (typeof op.ratio !== 'number' || !(op.ratio >= 0 && op.ratio <= 1)) issues.push(`${at}: ratio must be a number from 0 to 1`);
    if (op.size !== undefined && !BAYER_SIZES.includes(op.size)) issues.push(`${at}: size must be one of ${BAYER_SIZES.join(', ')}`);
  } else if (op.op === 'pattern') {
    if (!PATTERNS.includes(op.name)) issues.push(`${at}: pattern name must be one of ${PATTERNS.join(', ')}`);
    if (!Array.isArray(op.colors) || op.colors.length !== 2) issues.push(`${at}: pattern needs colors [first, second] (palette ids; null leaves that pixel alone)`);
    else op.colors.forEach((c) => color(at, c));
    if (op.over !== undefined && !['opaque', 'all'].includes(op.over)) issues.push(`${at}: over must be "opaque" or "all"`);
  } else {
    if (typeof op.base !== 'string' || !palette.has(op.base)) issues.push(`${at}: gradient needs base, a palette id`);
    else if (op.base === palette.outlineId) issues.push(`${at}: gradient base cannot be the outline colour`);
    if (op.steps !== undefined && !(Number.isInteger(op.steps) && op.steps >= 2 && op.steps <= 9)) issues.push(`${at}: steps must be an integer from 2 to 9`);
    if (op.light !== undefined && !Object.hasOwn(LIGHTS, op.light)) issues.push(`${at}: light must be one of ${Object.keys(LIGHTS).join(', ')}`);
    if (op.dither !== undefined && op.dither !== false && !BAYER_SIZES.includes(op.dither)) issues.push(`${at}: dither must be false or one of ${BAYER_SIZES.join(', ')}`);
    if (op.over !== undefined && !['opaque', 'all'].includes(op.over)) issues.push(`${at}: over must be "opaque" or "all"`);
  }
}

function bresenham([x0, y0], [x1, y1]) {
  const points = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return points;
}

function paint(frame, x, y, id, palette) {
  setPixel(frame, x, y, id === null || id === undefined ? null : palette.rgb(id));
}

/**
 * Apply an ordered list of operations to a copy of `frame`.
 * `lookup(facing, index)` returns another baked frame of the same clip for `copy` with `from`.
 */
export function applyPatch(frame, ops, palette, {lookup} = {}) {
  let out = cloneFrame(frame);
  for (const op of ops ?? []) {
    const {width, height} = out;
    if (op.op === 'set') for (const [x, y, id] of op.pixels) paint(out, x, y, id, palette);
    else if (op.op === 'line') for (const [x, y] of bresenham(op.from, op.to)) paint(out, x, y, op.color, palette);
    else if (op.op === 'fill') {
      const [x0, y0, x1, y1] = op.box;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paint(out, x, y, op.color, palette);
    } else if (op.op === 'flood') {
      const [sx, sy] = op.at;
      const wasOpaque = alphaAt(out, sx, sy) === 255, was = wasOpaque ? getRgb(out, sx, sy) : null;
      const same = (x, y) => (alphaAt(out, x, y) === 255) === wasOpaque && (!wasOpaque || sameRgb(getRgb(out, x, y), was));
      const seen = new Uint8Array(width * height), stack = [[sx, sy]];
      const region = [];
      while (stack.length) {
        const [x, y] = stack.pop();
        if (!inBounds(out, x, y) || seen[y * width + x] || !same(x, y)) continue;
        seen[y * width + x] = 1; region.push([x, y]);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      for (const [x, y] of region) paint(out, x, y, op.color, palette);
    } else if (op.op === 'shade' || op.op === 'dither' || op.op === 'pattern' || op.op === 'gradient') out = applyShading(out, op, palette);
    else if (op.op === 'shift' || op.op === 'copy') {
      const [x0, y0, x1, y1] = op.box;
      const source = op.from ? lookup?.(op.from.facing, op.from.frame) : out;
      if (!source) throw new Error(`copy source ${JSON.stringify(op.from)} is not available`);
      const moved = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        moved.push([x + op.dx, y + op.dy, alphaAt(source, x, y) === 255 ? getRgb(source, x, y) : null]);
      }
      // shift moves the region and leaves transparency behind; copy stamps opaque pixels only.
      if (op.op === 'shift') for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(out, x, y, null);
      for (const [x, y, rgb] of moved) {
        if (inBounds(out, x, y) && (rgb || op.op === 'shift')) setPixel(out, x, y, rgb);
      }
    } else if (op.op === 'outline') out = outline(out, palette.outline);
    else throw new Error(`unknown patch op "${op.op}"`);
  }
  return out;
}


/** Paint the palette-bound drawing operations onto a copy of `frame`. Colours come only from `palette.colors`, so nothing leaves the palette. */
function applyShading(frame, op, palette) {
  const out = cloneFrame(frame);
  const [x0, y0, x1, y1] = op.box;
  const outlineId = palette.outlineId ?? null;
  const light = op.light ?? 'tl';
  const opaque = (x, y) => alphaAt(out, x, y) === 255;
  const idAt = (x, y) => palette.idOf(getRgb(out, x, y));
  // The lit and far edges are measured on the pixels that are actually there, not on the whole box.
  let tight = op.box;
  if (op.op === 'shade' || (op.op === 'gradient' && (op.over ?? 'opaque') === 'opaque')) {
    let a = x1, b = y1, c = x0, d = y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (opaque(x, y)) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x + 1); d = Math.max(d, y + 1); }
    tight = c > a ? [a, b, c, d] : op.box;
  }
  const ramp = op.op === 'gradient' ? hueShiftRamp(palette.colors, op.base, {steps: op.steps ?? 5, shift: op.shift ?? 24, outlineId}) : null;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (op.op === 'shade') {
      if (!opaque(x, y)) continue;
      const id = idAt(x, y);
      if (id === null) continue;                       // a pixel that is not a palette colour is left for the gates to report
      const next = shadeId(palette.colors, id, lightPosition(light, tight, x, y), {strength: op.strength ?? 1, outlineId});
      if (next !== id) paint(out, x, y, next, palette);
    } else if (op.op === 'dither') {
      if (opaque(x, y) && idAt(x, y) === op.from && ditherAt(x, y, op.ratio, op.size ?? 4)) paint(out, x, y, op.to, palette);
    } else if (op.op === 'pattern') {
      if ((op.over ?? 'opaque') === 'opaque' && !opaque(x, y)) continue;
      const id = op.colors[patternAt(op.name, x - x0, y - y0)];
      if (id !== null && id !== undefined) paint(out, x, y, id, palette);
    } else {
      if ((op.over ?? 'opaque') === 'opaque' && !opaque(x, y)) continue;
      // A position along the light picks a step; Bayer dithering mixes it with the next step so bands blend.
      const at = lightPosition(light, tight, x, y) * (ramp.length - 1);
      const lower = Math.floor(at), frac = at - lower;
      const useUpper = op.dither !== false && lower + 1 < ramp.length && ditherAt(x, y, frac, op.dither || 4);
      const index = (op.dither === false ? Math.round(at) : lower + (useUpper ? 1 : 0));
      // position 0 is the LIT edge, and a ramp runs dark to light, so lit means the top of the ramp.
      paint(out, x, y, ramp[ramp.length - 1 - Math.min(index, ramp.length - 1)], palette);
    }
  }
  return out;
}
