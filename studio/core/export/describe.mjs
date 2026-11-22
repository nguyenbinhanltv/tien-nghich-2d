// Build the neutral atlas description (see common.mjs) from atlas pages and the asset index. Read-only.
import { SPRITE_NAME, expectedFrames } from '../assets.mjs';

const PALETTE_NAME = /^(?<clip>[a-z0-9]+(?:_[a-z0-9]+)*)_(?<direction>[a-z0-9]+)_(?<n>\d+)$/;

/** key -> {asset, clip, direction, n}: exact keys from each asset's expected frames, then by the asset's key prefix for the rest. */
export function keyIndex(index) {
  const exact = new Map(), prefixes = [];
  for (const asset of index.assets.values()) {
    if (!asset.layout) continue;
    for (const f of expectedFrames(asset)) exact.set(f.key, {asset, clip: f.clip, direction: f.direction, n: f.n});
    const probe = 'c_d_0', key = asset.layout.keyOf('c', 'd', 0);
    if (typeof key === 'string' && key.endsWith(probe)) prefixes.push({prefix: key.slice(0, -probe.length), asset, palette: asset.layout.nameStyle === 'palette'});
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return key => {
    if (exact.has(key)) return exact.get(key);
    const hit = prefixes.find(p => key.startsWith(p.prefix));
    if (!hit) return null;
    const m = (hit.palette ? PALETTE_NAME : SPRITE_NAME).exec(key.slice(hit.prefix.length));
    return m ? {asset: hit.asset, clip: m.groups.clip, direction: m.groups.direction, n: Number(m.groups.n)} : null;
  };
}

const msOf = (asset, clip, n) => { const ms = asset?.clips?.[clip]?.frameMs; return Array.isArray(ms) ? ms[n] ?? null : ms ?? null; };

/**
 * pages: [{index, name, png (a path the caller can copy from), width, height, frames: [{key, x, y, w, h, pivotPx?, pivot?, durationMs?}]}].
 * options: {name, tilesetCategories}. Frames the index cannot place keep a null asset and are exported as plain sprites.
 */
export function describeAtlas(index, pages, {name = 'atlas', tilesetCategories = []} = {}) {
  const find = keyIndex(index);
  const frames = [];
  for (const page of pages) for (const f of page.frames) {
    const hit = find(f.key);
    const asset = hit?.asset;
    const pivotPx = f.pivotPx ?? (f.pivot ? [f.pivot.x * f.w, f.pivot.y * f.h] : asset?.pivot ?? null);
    frames.push({key: f.key, page: page.index, x: f.x, y: f.y, w: f.w, h: f.h, asset: asset?.id ?? null, category: asset?.category ?? null,
      clip: hit?.clip ?? null, direction: hit?.direction ?? null, n: hit?.n ?? null, pivotPx,
      durationMs: f.durationMs ?? (hit ? msOf(asset, hit.clip, hit.n) : null)});
  }
  const order = (a, b) => (a.asset ?? '').localeCompare(b.asset ?? '') || (a.clip ?? '').localeCompare(b.clip ?? '') || (a.direction ?? '').localeCompare(b.direction ?? '') || (a.n ?? 0) - (b.n ?? 0) || (a.key < b.key ? -1 : 1);
  frames.sort(order);
  const clips = [], tilesets = [], seen = new Map();
  for (const f of frames) {
    if (!f.asset || f.clip === null) continue;
    const id = `${f.asset}/${f.clip}/${f.direction}`;
    if (!seen.has(id)) { const asset = index.assets.get(f.asset); const clip = {id, asset: f.asset, clip: f.clip, direction: f.direction, loop: asset?.clips?.[f.clip]?.loop ?? null, frames: []}; seen.set(id, clip); clips.push(clip); }
    seen.get(id).frames.push(f.key);
  }
  const sheets = new Map();
  for (const f of frames) if (f.asset && tilesetCategories.includes(f.category) && f.clip !== null) {
    const id = `${f.asset}/${f.clip}`;
    if (!sheets.has(id)) sheets.set(id, {asset: f.asset, sheet: f.clip, frames: []});
    sheets.get(id).frames.push(f);
  }
  for (const s of sheets.values()) {
    const sizes = new Set(s.frames.map(f => `${f.w}x${f.h}`));
    if (sizes.size !== 1) continue; // a tileset is a grid of one tile size
    tilesets.push({asset: s.asset, sheet: s.sheet, tileSize: [s.frames[0].w, s.frames[0].h], tiles: s.frames.sort((a, b) => (a.n ?? 0) - (b.n ?? 0)).map((f, id) => ({id, key: f.key, n: f.n}))});
  }
  return {schema: 'studio.atlas-description', version: 1, name,
    pages: pages.map(p => ({index: p.index, name: p.name, image: `${p.name}.png`, width: p.width, height: p.height, source: p.png})), frames, clips, tilesets};
}
