// Asset records and what can be asked of them, independent of any one project. An INDEXER (supplied
// by the project adapter, see studio/mcp/asset-index.mjs) turns a pack and its data into records:
//
//   {id, source, category, size, pivot, directions, clips: {clip: {frames, frameMs?}} | null, brief, ...
//    layout: {nameStyle: 'sprite'|'palette'|'vfx-flat', processedDir, rawDir, studioRawDir?, flatPrefix?,
//             keyOf(clip, direction, n), atlas?: {web, mobile}}}  |  layout null for non-frame assets
//
// This module lists, names, counts and keys frames from those records and derives the four delivery
// milestones. Read-only: nothing here writes.
import fs from 'node:fs/promises';
import path from 'node:path';

export const SPRITE_NAME = /^(?<clip>[a-z0-9]+(?:_[a-z0-9]+)*)_(?<direction>south|east|north|west|none|f\d+)_(?<n>\d+)$/;
const PALETTE_NAME = /^(?<clip>[a-z0-9]+(?:_[a-z0-9]+)*)_(?<direction>[a-z0-9]+)_(?<n>\d+)$/;

/**
 * The spec of one clip, or undefined. Own properties only: a caller-supplied name such as "constructor"
 * or "__proto__" must never resolve to something inherited from Object.prototype.
 */
export const clipSpec = (asset, name) => (asset.clips && Object.hasOwn(asset.clips, name) ? asset.clips[name] : undefined);

/** The JSON-safe summary of a record (no functions, no layout internals). */
export function summarize(asset) {
  const {layout, spec, ...rest} = asset;
  return {...rest, ...(layout ? {paths: {processed: layout.processedDir, raw: layout.rawDir, studioRaw: layout.studioRawDir}} : {})};
}

/** Frames the spec says must exist: [{clip, direction, n, name, key}]. Empty when the spec is silent. */
export function expectedFrames(asset) {
  const {layout, clips, directions} = asset;
  if (!layout || !clips || layout.nameStyle === 'palette') return [];
  const out = [];
  for (const [clip, {frames}] of Object.entries(clips)) {
    for (const direction of layout.nameStyle === 'vfx-flat' ? ['none'] : directions) {
      for (let n = 0; n < frames; n++) {
        const name = layout.nameStyle === 'vfx-flat' ? `${layout.flatPrefix}_${n}` : `${clip}_${direction}_${n}`;
        out.push({clip, direction, n, name, key: layout.keyOf(clip, direction, n)});
      }
    }
  }
  return out;
}

function parseName(asset, base) {
  const {layout} = asset;
  if (layout.nameStyle === 'vfx-flat') {
    const m = new RegExp(`^${layout.flatPrefix}_(\\d+)$`).exec(base);
    return m ? {clip: 'play', direction: 'none', n: Number(m[1])} : null;
  }
  const m = (layout.nameStyle === 'palette' ? PALETTE_NAME : SPRITE_NAME).exec(base);
  return m ? {clip: m.groups.clip, direction: m.groups.direction, n: Number(m.groups.n)} : null;
}

/**
 * Frames present on disk for an asset at a stage ('processed' or 'raw'; raw means frames a studio
 * agent submitted). Files that do not parse as frame names come back as `unnamed` for the naming check.
 */
export async function listFrames(root, asset, stage = 'processed') {
  const {layout} = asset;
  const dir = !layout ? null : stage === 'raw' ? layout.studioRawDir : layout.processedDir;
  const out = {frames: [], unnamed: [], dir};
  if (!dir) return out;
  let entries;
  try { entries = await fs.readdir(path.join(root, dir)); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return out; throw error; }
  for (const file of entries.sort()) {
    if (!file.endsWith('.png')) continue;
    const base = file.slice(0, -4);
    if (layout.nameStyle === 'vfx-flat' && !base.startsWith(layout.flatPrefix + '_')) continue; // shared directory
    const parsed = parseName(asset, base);
    if (!parsed) { if (layout.nameStyle !== 'vfx-flat') out.unnamed.push(file); continue; }
    out.frames.push({...parsed, name: base, rel: `${dir}/${file}`, key: layout.keyOf(parsed.clip, parsed.direction, parsed.n)});
  }
  out.frames.sort((a, b) => a.clip.localeCompare(b.clip) || a.direction.localeCompare(b.direction) || a.n - b.n);
  return out;
}

/** Relative path of one frame at a stage, or null if the asset has no such layout. */
export function framePath(asset, stage, clip, direction, n) {
  const {layout} = asset;
  const dir = stage === 'raw' ? layout?.studioRawDir : layout?.processedDir;
  if (!dir) return null;
  const name = layout.nameStyle === 'vfx-flat' ? `${layout.flatPrefix}_${n}` : `${clip}_${direction}_${n}`;
  return `${dir}/${name}.png`;
}

// ---- delivery milestones: source -> processed -> web atlas -> mobile atlas ------------------
const atlasCache = new Map(); // dir -> {signature, keys}

async function atlasKeys(root, rel) {
  const base = path.join(root, rel);
  const files = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await visit(full);
      else if (/^atlas-\d+\.json$/.test(e.name)) files.push(full);
    }
  }
  await visit(base);
  files.sort();
  const stats = await Promise.all(files.map(f => fs.stat(f)));
  const signature = files.map((f, i) => `${f}:${stats[i].size}:${stats[i].mtimeMs}`).join('|');
  const hit = atlasCache.get(base);
  if (hit?.signature === signature) return hit.keys;
  const keys = new Set();
  for (const f of files) for (const k of Object.keys(JSON.parse(await fs.readFile(f, 'utf8')).frames ?? {})) keys.add(k);
  atlasCache.set(base, {signature, keys});
  return keys;
}

const state = (found, expected) => (found === 0 ? 'absent' : expected && found < expected ? 'partial' : 'complete');

/**
 * The four milestones for an asset: source (authored frames exist), processed, web atlas, mobile atlas.
 * Each is {state: absent|partial|complete, found, expected}. Audio has none.
 */
export async function milestones(root, asset) {
  if (!asset.layout) return null;
  const expected = expectedFrames(asset);
  const processed = await listFrames(root, asset, 'processed');
  const raw = await listFrames(root, asset, 'raw');
  let rawFiles = raw.frames.length;
  if (!rawFiles && asset.layout.rawDir) {
    try { rawFiles = (await fs.readdir(path.join(root, asset.layout.rawDir))).length; } catch { /* no raw dir */ }
  }
  const keys = processed.frames.map(f => f.key);
  // Where each platform's atlases live is the record's business (the indexer read it from the pack).
  const atlas = asset.layout.atlas;
  const inAtlas = async platform => {
    if (!atlas?.[platform]) return 0;
    const known = await atlasKeys(root, atlas[platform]);
    return keys.filter(k => known.has(k)).length;
  };
  const web = await inAtlas('web'), mobile = await inAtlas('mobile');
  const want = expected.length || processed.frames.length;
  return {
    source: {state: rawFiles ? 'present' : 'absent', files: rawFiles},
    processed: {state: state(processed.frames.length, expected.length), found: processed.frames.length, expected: expected.length || null},
    web: {state: state(web, want), found: web, expected: want || null},
    mobile: {state: state(mobile, want), found: mobile, expected: want || null},
  };
}

/** True once any frame has been processed or packed: the asset is no longer an open authoring target. */
export function isShipped(m) {
  return !!m && (m.processed.found > 0 || m.web.found > 0 || m.mobile.found > 0);
}
