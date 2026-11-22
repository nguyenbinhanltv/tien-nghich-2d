// Pixel operations for studio_frame_patch: the forge's patch engine plus a palette-index `grid` op, which is
// expanded to plain `set` operations before anything is stored or validated.
import { ToolError } from '../registry.mjs';
import { applyPatch, appendOps, createImage, decodePng, emptyPatch, validatePatch } from '../../forge/index.mjs';

export const MAX_OPS_PER_FRAME = 500;

/** Expand `grid` ops: {op:'grid', at:[x,y], rows:['..ab..', ...], legend:{a:'ink_01', b:'jade_03'}} (a '.' or unlisted char is transparent). */
export function expandOps(ops) {
  const out = [];
  for (const op of ops) {
    if (op?.op !== 'grid') { out.push(op); continue; }
    const { at, rows, legend } = op;
    if (!Array.isArray(at) || at.length !== 2 || !at.every(Number.isInteger)) throw new ToolError('grid.at must be [x, y] integers');
    if (!Array.isArray(rows) || !rows.length || rows.some((r) => typeof r !== 'string')) throw new ToolError('grid.rows must be a list of strings, one per pixel row');
    if (!legend || typeof legend !== 'object' || Array.isArray(legend)) throw new ToolError('grid.legend must map each character to a palette id');
    const pixels = [];
    rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
      if (ch === '.' || ch === ' ') return;
      if (!Object.hasOwn(legend, ch)) throw new ToolError(`grid row ${dy} uses "${ch}", which the legend does not define ('.' is transparent)`);
      pixels.push([at[0] + dx, at[1] + dy, legend[ch]]);
    }));
    if (!pixels.length) throw new ToolError('grid has no opaque cell');
    out.push({ op: 'set', pixels });
  }
  return out;
}

/** Validate `ops` for one frame against the canvas and palette. Throws a ToolError listing every issue. */
export function checkOps(key, ops, { palette, width, height }) {
  if (ops.length > MAX_OPS_PER_FRAME) throw new ToolError(`${key}: ${ops.length} operations; the limit is ${MAX_OPS_PER_FRAME} per frame (use fill and line instead of single pixels)`);
  const issues = validatePatch({ schema: 'studio.patch', version: 1, frames: { [key]: ops } }, { palette, width, height });
  if (issues.length) throw new ToolError(`the operations for ${key} are invalid:\n  ${issues.join('\n  ')}`);
}

export const blank = (width, height) => createImage(width, height);
export const decode = (bytes) => decodePng(bytes);
export { applyPatch, appendOps, emptyPatch };
