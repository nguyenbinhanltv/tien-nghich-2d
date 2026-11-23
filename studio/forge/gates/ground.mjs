// Ground contact: where a figure touches the ground, and whether that is where the profile's pivot says it should be.
//
// The pivot of a 32x32 character is [16, 29]. The lowest opaque row of a shipped figure (outline included) is not row 29 but
// two rows above it: over the 346 shipped 32x32 character frames of the project (every clip) the lowest row is 27 for 145 of them,
// 26 to 28 for 317 (92%), and never above 24 or below 30 (docs/FORGE_BAKEOFF.md, "Drawn-clip gates: calibration"). So the
// target row is pivotY - inset with inset 2, and a frame is on target within 1 px. The forge's sheet import puts the foot
// at pivotY - groundLift (4 by default) and the outline then adds a row, which left drawn figures 1 to 4 px above the
// pivot (the Codex retest of session 41 measured 4).
import { alphaAt, shiftFrame } from '../image.mjs';

export const defaultGround = {inset: 2, tolerance: 1, maxShift: 8};

/** The lowest row holding an opaque pixel, or -1 for an empty frame. */
export function groundRow(frame) {
  for (let y = frame.height - 1; y >= 0; y--) for (let x = 0; x < frame.width; x++) if (alphaAt(frame, x, y) === 255) return y;
  return -1;
}

/** The contact: the lowest row and the columns of its opaque pixels (the sole of the foot, or both feet). */
export function groundContact(frame) {
  const row = groundRow(frame);
  const xs = [];
  if (row >= 0) for (let x = 0; x < frame.width; x++) if (alphaAt(frame, x, row) === 255) xs.push(x);
  return {row, xs};
}

/** The row the lowest opaque pixel should be on for this profile pivot. */
export const groundTarget = (pivot, inset = defaultGround.inset) => pivot[1] - inset;

const lowerMedian = values => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];

function topRow(frame) {
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) if (alphaAt(frame, x, y) === 255) return y;
  return -1;
}

/**
 * Move the frames of one clip and facing by one common vertical offset so that the clip's usual ground row lands on the target.
 * The offset is the same for every frame, so a drawn bounce or a lifted foot in one key is kept; the gate judges what is left.
 * Returns {frames, applied, dy, rows, rowsAfter, target, reference, reason?}. It does not move anything (applied false, dy 0, reason)
 * when the shift would push opaque pixels off the canvas, or when it is larger than maxShift (a figure that far off is a drawing
 * problem, not a rounding one).
 */
export function alignGround(frames, {pivot, inset = defaultGround.inset, maxShift = defaultGround.maxShift} = {}) {
  const rows = frames.map(groundRow), target = groundTarget(pivot, inset);
  const live = rows.filter(r => r >= 0);
  const out = {frames, applied: false, dy: 0, rows, rowsAfter: rows, target, reference: live.length ? lowerMedian(live) : null};
  if (!live.length) return {...out, reason: 'every frame is empty'};
  const dy = target - out.reference;
  if (dy === 0) return out;
  if (Math.abs(dy) > maxShift) return {...out, reason: `the offset of ${dy} px is larger than maxShift ${maxShift}`};
  const height = frames[0].height;
  if (rows.some(r => r >= 0 && r + dy >= height) || frames.some(f => { const t = topRow(f); return t >= 0 && t + dy < 0; })) return {...out, reason: `shifting by ${dy} px would push the figure off the canvas`};
  const moved = frames.map(f => shiftFrame(f, 0, dy));
  return {...out, frames: moved, applied: true, dy, rowsAfter: rows.map(r => (r >= 0 ? r + dy : r))};
}

/**
 * The gate: every key's lowest opaque row must be within `tolerance` of the target (pivot row - inset). Errors, with the row found,
 * the row wanted and the whole-clip shift that would fix it. unit.groundShift (what the baker already moved) is echoed, not judged.
 */
export function groundContactGate(unit, ctx, options = defaultGround) {
  const o = {...defaultGround, ...options};
  if (!ctx.pivot) return [];
  const target = groundTarget(ctx.pivot, o.inset), out = [];
  const rows = unit.frames.map(groundRow), live = rows.filter(r => r >= 0);
  const fix = live.length ? target - lowerMedian(live) : 0;
  unit.frames.forEach((frame, i) => {
    const {row, xs} = groundContact(frame);
    if (row < 0) { out.push({gate: 'ground_contact', severity: 'error', clip: unit.clip, facing: unit.facing, frame: i, pixels: [], message: `key ${i} is empty, so it has no ground contact`}); return; }
    const off = row - target;
    if (Math.abs(off) > o.tolerance) {
      out.push({gate: 'ground_contact', severity: 'error', clip: unit.clip, facing: unit.facing, frame: i, pixels: xs.slice(0, 40).map(x => [x, row]), measured: Math.abs(off), limit: o.tolerance,
        message: `the lowest opaque row of key ${i} is ${row}, ${Math.abs(off)} px ${off < 0 ? 'above' : 'below'} the ground row ${target} (pivot row ${ctx.pivot[1]} minus ${o.inset}); ${fix === 0 ? 'the usual contact of the clip is on it, so this key alone is off (a lifted or dropped foot)' : `shifting the clip by ${fix > 0 ? '+' : ''}${fix} px puts the usual contact on it`}`});
    }
  });
  return out;
}
