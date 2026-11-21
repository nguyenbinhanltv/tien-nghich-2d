// Direct pixel edits as data. A patch document stores an ordered list of operations per frame key; the
// baker applies them after the bake, so a fix survives a rebuild. This is the engine behind studio_frame_patch.
//
//   {"schema": "studio.patch", "version": 1, "frames": {"idle_south_0": [{"op": "set", ...}, ...]}}
//
// Colours are palette ids (null clears to transparent). Boxes are half-open [x0, y0, x1, y1].
import { cloneFrame, getRgb, outline, setPixel, alphaAt, sameRgb, inBounds } from './raster.mjs';

export const patchKey = (clip, facing, index) => `${clip}_${facing}_${index}`;
export const patchOps = ['set', 'line', 'fill', 'flood', 'shift', 'copy', 'outline'];

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
    });
  }
  return issues;
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
    } else if (op.op === 'shift' || op.op === 'copy') {
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

