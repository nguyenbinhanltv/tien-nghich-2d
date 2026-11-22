// Shared by the engine exports. Every exporter takes the same NEUTRAL ATLAS DESCRIPTION (describe.mjs):
//
//   {schema: 'studio.atlas-description', version: 1, name, pages: [{index, name, image, width, height, source}],
//    frames: [{key, page, x, y, w, h, asset|null, category|null, clip|null, direction|null, n|null, pivotPx: [x, y] | null, durationMs: number | null}],
//    clips: [{id, asset, clip, direction, loop: boolean | null, frames: [key…]}]   // in play order, one per asset, clip and direction
//    tilesets: [{asset, sheet, tileSize: [w, h], tiles: [{id, key, n, animation?: [{tileId, ms}], shapes?: [shape]}], dropped?: [string]}]}
//    (a tile's `animation` and `shapes` come from the asset's metadata, tiledata.mjs; shapes are in tile pixels)
//
// and exports {id, label, build(desc, options) -> {files: [{name, data}], copies: [{page, name}], notes: [string]}}: `name` is relative to the output
// directory, `copies` are page images to place beside the metadata (under the format's own folder).
// `options`: {name, atlasKey, imageDir, readPage(index) -> Promise<{width, height, pixels}>, pixelsPerUnit}.
// Pivots are in source pixels from the top-left of the frame, as the atlases record them. A format that has no place for a
// pivot or a duration says so in `notes` instead of dropping it silently.

export const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** The play name of a clip: the clip, then the direction unless the clip has none. */
export const clipName = c => (c.direction && c.direction !== 'none' ? `${c.clip}_${c.direction}` : c.clip);

/** The key of the neutral frame by key. */
export const frameMap = desc => new Map(desc.frames.map(f => [f.key, f]));

export const normPivot = f => (f.pivotPx ? {x: f.pivotPx[0] / f.w, y: f.pivotPx[1] / f.h} : null);

export const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Frames grouped by asset id ('' for frames that map to no asset), in clip, direction, n order. */
export function byAsset(desc) {
  const out = new Map();
  for (const f of desc.frames) { const id = f.asset ?? ''; if (!out.has(id)) out.set(id, []); out.get(id).push(f); }
  return out;
}

/** The unique, sorted list of page indexes a set of frames touches. */
export const pagesOf = frames => [...new Set(frames.map(f => f.page))].sort((a, b) => a - b);

/** A safe file stem for an asset id or name. */
export const stem = text => String(text || 'frames').replace(/[^A-Za-z0-9_.-]+/g, '_');
