// Per-asset authoring metadata: pivot, hitbox, per-frame durations, clip events. A sidecar JSON in the
// asset's raw directory. Editable (it is data about the frames, not frames), but only until the
// asset has processed or packed frames; after that a human-approved revision carries it.
import path from 'node:path';
import { clipSpec, isShipped, milestones } from './assets.mjs';
import { problem } from './errors.mjs';
import { checkTiles, mergeTiles } from './tiledata.mjs';
import { ensureDirInside, readTextIfExists, sha256, withLock, writeFileAtomic } from './fsutil.mjs';

export const METADATA_FILE = 'studio-metadata.json';
export const METADATA_SCHEMA = 'studio.metadata';
const invalid = message => { throw problem(422, 'invalid_input', message); };
const isInt = v => Number.isInteger(v);

export async function readMetadata(root, asset) {
  const dir = asset.layout?.rawDir;
  if (!dir) return null;
  const raw = await readTextIfExists(path.join(root, dir, METADATA_FILE));
  if (raw === null) return null;
  try { return {data: JSON.parse(raw), etag: sha256(raw)}; }
  catch { throw problem(500, 'corrupt_metadata', `${dir}/${METADATA_FILE} is not valid JSON`); }
}

function checkPivot(asset, pivot) {
  const [w, h] = asset.size;
  if (!Array.isArray(pivot) || pivot.length !== 2 || !pivot.every(isInt) || pivot[0] < 0 || pivot[0] >= w || pivot[1] < 0 || pivot[1] >= h)
    invalid(`pivot must be [x, y] integers inside the ${w}x${h} frame`);
}
function checkHitbox(asset, box) {
  const [w, h] = asset.size;
  if (!box || typeof box !== 'object' || Object.keys(box).sort().join() !== 'h,w,x,y' || !Object.values(box).every(isInt)
      || box.w < 1 || box.h < 1 || box.x < 0 || box.y < 0 || box.x + box.w > w || box.y + box.h > h)
    invalid(`hitbox must be {x, y, w, h} integers with w and h at least 1, fully inside the ${w}x${h} frame`);
}
function checkClip(asset, name, clip) {
  const spec = clipSpec(asset, name);
  if (!spec) invalid(`${asset.id} has no clip "${name}". Clips: ${Object.keys(asset.clips ?? {}).join(', ')}`);
  if (clip === null) return; // null clears a real clip's entry
  if (!clip || typeof clip !== 'object' || Array.isArray(clip) || Object.keys(clip).some(k => !['frameMs', 'events', 'loopPolicy'].includes(k)))
    invalid(`clips.${name} may only contain frameMs, events and loopPolicy`);
  if ('loopPolicy' in clip && !['loop', 'once', 'hold'].includes(clip.loopPolicy))
    invalid(`clips.${name}.loopPolicy must be loop, once or hold`);
  if ('frameMs' in clip) {
    const ms = clip.frameMs;
    if (!Array.isArray(ms) || ms.length !== spec.frames || !ms.every(v => isInt(v) && v >= 1 && v <= 60000))
      invalid(`clips.${name}.frameMs must list ${spec.frames} integers (one per frame), each 1 to 60000 ms`);
  }
  if ('events' in clip) {
    const ev = clip.events;
    if (!Array.isArray(ev) || ev.length > 16) invalid(`clips.${name}.events must be a list of at most 16 events`);
    for (const e of ev) {
      if (!e || typeof e !== 'object' || Object.keys(e).some(k => !['frame', 'name'].includes(k)) || !isInt(e.frame) || e.frame < 0 || e.frame >= spec.frames
          || typeof e.name !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(e.name))
        invalid(`clips.${name}.events entries are {frame: 0-${spec.frames - 1}, name: lower_snake_case up to 32 chars}`);
    }
  }
}

/**
 * patch: {pivot?, hitbox?, clips?: {name: {frameMs?, events?}}, tiles?: {sheet: {n: {animation?, shapes?}}}}. A null value clears a field.
 * Fields not mentioned keep their value. `etag` (from the last read) is required once a sidecar exists.
 */
export async function setMetadata({root, asset, caller, patch, etag, dryRun = false}) {
  if (!asset.layout?.studioRawDir) throw problem(422, 'unsupported', `${asset.id} (${asset.source}) has no authoring metadata; only design-manifest assets do`);
  const m = await milestones(root, asset);
  // `tiles` describes the tiles (animation, collision) and touches no pixel, so a shipped tileset can still receive it: that is how the data reaches the Tiled and LDtk exports, which read shipped pages.
  const tilesOnly = Object.keys(patch).length > 0 && Object.keys(patch).every(k => k === 'tiles');
  if (isShipped(m) && !tilesOnly) throw problem(409, 'already_processed', `${asset.id} already has processed or packed frames; its metadata changes through a reviewed revision (only tiles may be set now)`);
  const known = ['pivot', 'hitbox', 'clips', 'tiles'];
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(k => !known.includes(k))) invalid(`give at least one of ${known.join(', ')} and nothing else`);
  if (patch.pivot) checkPivot(asset, patch.pivot);
  if (patch.hitbox) checkHitbox(asset, patch.hitbox);
  if (patch.clips) {
    if (typeof patch.clips !== 'object' || Array.isArray(patch.clips)) invalid('clips must be an object keyed by clip name');
    // Every name must be a real clip, including when the value is null (a clear): no name reaches the file unchecked.
    for (const [name, clip] of Object.entries(patch.clips)) checkClip(asset, name, clip);
  }
  if (patch.tiles) { try { checkTiles(asset, patch.tiles); } catch (error) { invalid(error.message); } }
  const rel = `${asset.layout.rawDir}/${METADATA_FILE}`;
  return withLock(path.join(root, rel), async () => {
    const current = await readMetadata(root, asset);
    if (current && etag !== current.etag) {
      throw problem(409, 'etag_mismatch', etag ? `${asset.id} metadata changed since you read it; call studio_asset_get again` : `${asset.id} already has metadata; pass the etag from studio_asset_get`);
    }
    const before = current ? structuredClone(current.data) : null;
    const data = structuredClone(current?.data ?? {schema: METADATA_SCHEMA, version: 1, id: asset.id, clips: {}});
    for (const f of ['pivot', 'hitbox']) if (f in patch) { if (patch[f] === null) delete data[f]; else data[f] = patch[f]; }
    for (const [name, clip] of Object.entries(patch.clips ?? {})) {
      if (!clipSpec(asset, name)) throw problem(500, 'internal_error', 'unvalidated clip name'); // unreachable: checkClip ran; never assign an unchecked key (__proto__)
      if (clip === null) { delete data.clips[name]; continue; }
      data.clips[name] = {...data.clips[name], ...clip};
    }
    if (patch.tiles) { const tiles = mergeTiles(data.tiles, patch.tiles); if (tiles) data.tiles = tiles; else delete data.tiles; }
    if (dryRun) return {dryRun: true, before, data, file: rel, etag: current?.etag ?? null};
    data.updated = {agent: caller.agent, session: caller.session, at: new Date().toISOString()};
    const text = JSON.stringify(data, null, 2) + '\n';
    await ensureDirInside(root, asset.layout.rawDir);
    await writeFileAtomic(path.join(root, rel), text);
    return {data, etag: sha256(text), file: rel};
  });
}
