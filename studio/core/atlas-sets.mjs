// Atlas SETS: the groups of shipped atlas pages a project has, read from the project pack (`ui.tabs.atlas.sets`), and
// what can be done with them without writing a shipped file: list and read the shipped pages, gather the frames a set is
// made of, pack them in memory, and describe the result. Nothing here writes; staging and comparison are in atlas-proof.mjs.
//
// A set names one directory key of `directories.atlases` and a layout under it ("{profile}" or "{profile}/{chunk}"):
//   {id, label, atlases, layout, profiles, format: 'frame-hash' | 'chunk-hash', array: [profile…], processed?, keyMap?, skipSuffix?,
//    profileOverrides?, design?: {profile, from, chunks}, chunks?: {crlf, app, manifestSchema, summaryFile}, extraFiles?, authority?: {build, check}}
// A pack with no such block gets one frame-hash set per `directories.atlases` key, read-only unless a processed directory of the same key exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';
import { readJson, readJsonIfExists, walkFiles, readInside } from './files.mjs';
import { decodeRgba } from './png.mjs';
import { packPages, pageBytes } from './atlas.mjs';
import { frameHashFiles, chunkHashFiles } from './atlas-formats.mjs';
import { listFrames } from './assets.mjs';

const IMAGE = /\.png$/i;

/** The atlas sets of a pack, with defaults filled in. */
export function atlasSets(pack) {
  const declared = pack.ui?.tabs?.atlas?.sets;
  const profiles = Object.keys(pack.atlasProfiles ?? {});
  const sets = Array.isArray(declared) && declared.length ? declared
    : Object.keys(pack.directories.atlases ?? {}).map(key => ({id: key, atlases: key, ...(Object.hasOwn(pack.directories.processed ?? {}, key) ? {processed: key} : {})}));
  return sets.map(s => ({layout: '{profile}', format: 'frame-hash', profiles, array: [], label: {en: s.id}, ...s}))
    .filter(s => Object.hasOwn(pack.directories.atlases ?? {}, s.atlases));
}

export const setOf = (pack, id) => {
  const set = atlasSets(pack).find(s => s.id === id);
  if (!set) throw problem(404, 'unknown_set', `No atlas set "${id}". Sets: ${atlasSets(pack).map(s => s.id).join(', ') || 'none'}.`);
  return set;
};

const safeName = /^[A-Za-z0-9_.-]{1,64}$/;
export function assertName(value, what) {
  if (typeof value !== 'string' || !safeName.test(value) || value === '.' || value === '..') throw problem(422, 'invalid_input', `${what} must be 1-64 letters, digits, dots, dashes or underscores.`);
  return value;
}

/** Relative directory of one profile (and chunk) of a set, e.g. `<atlases>/mobile/abode`. */
export function setDir(pack, set, profile, chunk) {
  if (!set.profiles.includes(profile)) throw problem(404, 'unknown_profile', `Set ${set.id} has no profile "${profile}". Profiles: ${set.profiles.join(', ')}.`);
  if (set.layout.includes('{chunk}')) assertName(chunk, 'chunk');
  return path.posix.join(pack.directories.atlases[set.atlases], set.layout.replace('{profile}', profile).replace('{chunk}', chunk ?? ''));
}

/** A profile as the packer needs it: the pack's own, then the set's overrides, then the design figures the set points at. */
export function profileFor(pack, set, name, info = {}) {
  const base = pack.atlasProfiles?.[name];
  if (!base) throw problem(404, 'unknown_profile', `The pack defines no "${name}" atlas profile.`);
  const design = set.design?.profile === name ? info[set.design.from ?? name] : null;
  return {limit: design?.page?.[0] ?? base.limit, padding: design?.padding ?? base.padding ?? 0, extrude: design?.extrude ?? base.extrude ?? 0,
    fixedSize: base.fixedSize ?? false, ...(set.profileOverrides?.[name] ?? {})};
}

/** The chunks a chunked set has, from the asset index (sorted); a set without a chunk layout has none. */
export function chunksOf(set, index) {
  if (!set.layout.includes('{chunk}')) return [];
  return Object.keys(index.info?.[set.design?.chunks ?? 'chunks'] ?? {}).sort();
}

async function pageSize(file) {
  const head = Buffer.alloc(24);
  const handle = await fs.open(file, 'r');
  try { await handle.read(head, 0, 24, 0); } finally { await handle.close(); }
  return {width: head.readUInt32BE(16), height: head.readUInt32BE(20)};
}

/**
 * The shipped pages of one profile (and chunk): [{index, name, png, json, width, height, bytes, frames: [{key, x, y, w, h, pivot?, durationMs?}], frameCount}].
 * Reads the page JSON and the PNG header only; pixels are fetched by the image route.
 */
export async function shippedPages(root, pack, set, profile, chunk) {
  const rel = setDir(pack, set, profile, chunk);
  let names;
  try { names = (await fs.readdir(path.join(root, rel))).filter(n => /^atlas-\d+\.json$/.test(n)).sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10)); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return {dir: rel, pages: []}; throw error; }
  const pages = [];
  for (const name of names) {
    const stem = name.slice(0, -5), doc = await readJson(root, `${rel}/${name}`);
    const png = `${rel}/${stem}.png`;
    const size = await pageSize(path.join(root, png)).catch(() => ({width: doc.meta?.size?.w ?? 0, height: doc.meta?.size?.h ?? 0}));
    const frames = Object.entries(doc.frames ?? {}).map(([key, r]) => ({key, x: r.frame.x, y: r.frame.y, w: r.frame.w, h: r.frame.h,
      ...(r.pivot ? {pivot: r.pivot} : {}), ...(r.pivotPx ? {pivotPx: r.pivotPx} : {}), ...(r.duration !== undefined ? {durationMs: r.duration} : r.durationMs !== undefined ? {durationMs: r.durationMs} : {})}));
    pages.push({index: pages.length, name: stem, png, json: `${rel}/${name}`, ...size, frames, frameCount: frames.length, meta: doc.meta ?? null});
  }
  return {dir: rel, pages};
}

/** Pixels used by frames (and their border) against the page area. */
export function usedArea(page, {padding = 0, extrude = 0} = {}) {
  const border = padding + extrude, area = page.width * page.height;
  const frames = page.frames.reduce((n, f) => n + f.w * f.h, 0);
  const reserved = page.frames.reduce((n, f) => n + (f.w + 2 * border) * (f.h + 2 * border), 0);
  return {area, frames, reserved, unused: Math.max(0, area - reserved), unusedRatio: area ? Math.max(0, area - reserved) / area : 0};
}

// ---- gathering the frames of a set -------------------------------------------------------------

/** Frames of the set's processed directory, keyed as the packer keys them. Returns {sprites, overlay}; `overlay` counts approved-frame overrides, which only the authority applies. */
export async function directorySprites(root, pack, set) {
  const base = pack.directories.processed?.[set.processed];
  if (!base) throw problem(409, 'no_source', `Set ${set.id} has no processed directory to pack from.`);
  const files = await walkFiles(root, base, f => IMAGE.test(f));
  const sprites = new Map();
  for (const rel of files.sort()) {
    const inside = rel.slice(base.length + 1), parts = inside.split('/');
    const stem = inside.replace(IMAGE, '');
    if (parts.length > 1 && set.skipSuffix && Object.hasOwn(set.skipSuffix, parts[0]) && stem.endsWith(set.skipSuffix[parts[0]])) continue;
    const [head, ...rest] = stem.split('/');
    const key = rest.length ? `${set.keyMap?.[head] ?? head}/${rest.join('/')}` : stem;
    if (sprites.has(key)) throw problem(409, 'duplicate_key', `Duplicate frame key ${key}.`);
    sprites.set(key, {key, image: decodeRgba(await readInside(root, rel)), extra: {}});
  }
  const overlay = pack.editable?.overlay ? await readJsonIfExists(root, pack.editable.overlay) : null;
  return {sprites: [...sprites.values()], overlay: overlay ? Object.keys(overlay).length : 0};
}

const msAt = (ms, n) => (Array.isArray(ms) ? ms[n] : ms);

/**
 * Frames of one chunk: the processed frames of every asset that has them. With `staged`, assets with no processed frames
 * contribute the raw frames submitted through the studio, so a person can see what packing them would change.
 * Returns {sprites, assets: {id: {stage, frames}}}.
 */
export async function chunkSprites(root, pack, index, chunk, {staged = false} = {}) {
  const sprites = [], assets = {};
  const sources = new Map();
  const effectClips = async asset => {
    const source = pack.catalog.sources.find(s => s.id === asset.sourceId);
    if (!source?.effects) return null;
    if (!sources.has(source.id)) sources.set(source.id, await readJson(root, source.file));
    const list = source.effects.split('.').reduce((v, k) => v?.[k], sources.get(source.id)) ?? [];
    return list.find(e => e.id === asset.id)?.clips ?? null;
  };
  for (const asset of [...index.assets.values()].filter(a => a.chunk === chunk && a.layout).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let found = await listFrames(root, asset, 'processed'), stage = 'processed';
    if (!found.frames.length && staged) { found = await listFrames(root, asset, 'raw'); stage = 'staged'; }
    if (!found.frames.length) continue;
    if (!asset.pivot) throw problem(409, 'no_pivot', `${asset.id} has no pivot in its design record; a chunk atlas records one per frame.`);
    const effect = asset.clips ? null : await effectClips(asset);
    assets[asset.id] = {stage, frames: found.frames.length};
    for (const f of found.frames) {
      const ms = asset.clips ? asset.clips[f.clip]?.frameMs : effect?.[f.clip]?.ms;
      if (ms === undefined) throw problem(409, 'no_duration', `${asset.id} clip ${f.clip} has no frame duration in its design record.`);
      sprites.push({key: f.key, image: decodeRgba(await readInside(root, f.rel)), extra: {pivotPx: asset.pivot, durationMs: msAt(ms, f.n), assetId: asset.id, stage}});
    }
  }
  return {sprites, assets};
}

/**
 * Pack a set in memory. `chunk` for chunked sets; `layoutOnly` skips drawing the pages (numbers only). Returns {profiles: {name: {profile, packed, files, pages, bytes}}, sprites, assets, overlay?}.
 * Throws a 409 when the set cannot be reproduced here (an overlay of approved frames, or no processed directory).
 */
export async function packSet(root, pack, index, set, {chunk, staged = false, only, layoutOnly = false} = {}) {
  let gathered;
  if (set.layout.includes('{chunk}')) {
    if (!chunksOf(set, index).includes(chunk)) throw problem(404, 'unknown_chunk', `No chunk "${chunk}" in set ${set.id}.`);
    gathered = await chunkSprites(root, pack, index, chunk, {staged});
  } else {
    gathered = await directorySprites(root, pack, set);
    if (gathered.overlay) throw problem(409, 'overlay_present', `${gathered.overlay} approved frame(s) override processed pixels; only the project's own packer applies them. Use the authority pack.`);
    gathered.assets = {};
  }
  if (!gathered.sprites.length) throw problem(409, 'no_frames', `Set ${set.id}${chunk ? ` chunk ${chunk}` : ''} has no frames to pack.`);
  const profiles = {};
  for (const name of only ?? set.profiles) {
    const profile = profileFor(pack, set, name, index.info);
    let packed;
    try { packed = packPages(gathered.sprites, profile); } catch (error) { if (error.code === 'sprite_too_large') throw problem(409, 'sprite_too_large', error.message); throw error; }
    const design = index.info?.[set.design?.from ?? set.design?.profile];
    const bpp = design?.bytes_per_pixel ?? 4;
    let written;
    if (layoutOnly) written = {files: [], pages: packed.pages.map((p, i) => ({name: `atlas-${i}`, width: p.width, height: p.height, frames: p.placements.length}))};
    else if (set.format === 'chunk-hash') {
      written = chunkHashFiles(packed, gathered.sprites, {chunk, platform: name, bytesPerPixel: bpp, app: set.chunks?.app, manifestSchema: set.chunks?.manifestSchema, summaryFile: set.chunks?.summaryFile,
        ceilingPages: index.info?.[set.design?.chunks ?? 'chunks']?.[chunk], newline: set.chunks?.crlf?.includes(chunk) ? '\r\n' : '\n'});
    } else written = frameHashFiles(packed, {array: set.array.includes(name)});
    profiles[name] = {profile, packed, files: written.files, pages: written.pages, bytes: pageBytes(packed.pages, bpp), bytesPerPixel: bpp};
  }
  return {profiles, sprites: gathered.sprites, assets: gathered.assets};
}

/** Budget of one chunk against its design ceiling: pages and bytes used, ceilings, and a state (ok | full | over | none). */
export function budgetOf({pages, bytes, ceilingPages, pageArea, bytesPerPixel}) {
  if (!pages) return {pages: 0, bytes: 0, ceilingPages: ceilingPages ?? null, ceilingBytes: ceilingPages ? ceilingPages * pageArea * bytesPerPixel : null, state: 'empty'};
  if (!ceilingPages) return {pages, bytes, ceilingPages: null, ceilingBytes: null, state: pages ? 'none' : 'empty'};
  const ceilingBytes = ceilingPages * pageArea * bytesPerPixel;
  return {pages, bytes, ceilingPages, ceilingBytes, state: pages > ceilingPages || bytes > ceilingBytes ? 'over' : pages === ceilingPages ? 'full' : 'ok'};
}
