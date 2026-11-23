// Pure helpers for the Objects tab: route state, filtering, frame grouping, tool geometry.
// No DOM and no fetch, so node:test can drive all of it.
import { computeBlob47Mask, createDefaultBitmaskMap, parseWorkerBitmaskJson, CANONICAL_47_MASKS } from '../../../src/blob47.js';

import { ZOOMS, snapZoom } from '../../pixelview.mjs';

export const tools = ['blob', 'nine', 'hud'];
const maxZoom = ZOOMS.at(-1);
/** The grid slider indexes the viewer's zoom levels, so it, the stage toolbar and the + / − keys all share one list and one range. */
export const zoomIndex = zoom => Math.max(0, ZOOMS.indexOf(snapZoom(zoom)));
export const zoomAt = index => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, Math.round(Number(index)) || 0))];
export const defaultZoom = 3;
const idPattern = /^[A-Za-z0-9_.-]+$/;
const pick = (value, ok) => (typeof value === 'string' && ok.test(value) ? value : null);
const int = (value, min, max, fallback) => {
  const n = /^-?\d+$/.test(value ?? '') ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** URL → state. Total: junk gives defaults, never a throw. */
export function parseRoute(route = {}) {
  const p = route.params ?? {};
  const ins = /^\d{1,2}(,\d{1,2}){3}$/.test(p.ins ?? '') ? p.ins.split(',').map(Number) : null;
  return {
    asset: route.asset ?? null, clip: route.asset ? route.clip ?? null : null, frame: route.asset ? route.frame ?? null : null,
    source: pick(p.source, idPattern),
    kind: pick(p.kind, idPattern), ready: pick(p.ready, /^(planned|authored|packed)$/), chunk: pick(p.chunk, idPattern), src: pick(p.src, idPattern),
    q: typeof p.q === 'string' ? p.q.slice(0, 60) : '',
    zoom: snapZoom(int(p.zoom, 1, maxZoom, defaultZoom)),
    tool: tools.includes(p.tool) ? p.tool : null,
    sheet: pick(p.sheet, idPattern), ins, fill: int(p.fill, 0, 100, 100), seed: int(p.seed, 0, 999999, 1)
  };
}

/** State → the query parameters that carry it (defaults are omitted so URLs stay short). */
export function stateParams(state) {
  const out = {};
  for (const key of ['source', 'kind', 'ready', 'chunk', 'src', 'tool', 'sheet']) if (state[key]) out[key] = state[key];
  if (state.q) out.q = state.q;
  if (state.zoom !== defaultZoom) out.zoom = String(state.zoom);
  if (state.ins) out.ins = state.ins.join(',');
  if (state.tool === 'hud' && state.fill !== 100) out.fill = String(state.fill);
  if (state.tool === 'blob' && state.seed !== 1) out.seed = String(state.seed);
  return out;
}

/** Categories the pack assigns to this tab, in pack order. */
export const objectKinds = categoryTabs => Object.entries(categoryTabs ?? {}).filter(([, tab]) => tab === 'objects').map(([id]) => id);

export function inScope(assets, kinds) {
  const set = new Set(kinds);
  return assets.filter(a => set.has(a.category));
}

export function applyFilters(assets, state) {
  const q = state.q.trim().toLowerCase();
  return assets.filter(a => (!state.kind || a.category === state.kind) && (!state.ready || a.readiness === state.ready) &&
    (!state.chunk || a.chunk === state.chunk) && (!state.src || a.source === state.src) &&
    (!q || a.id.toLowerCase().includes(q) || String(a.name ?? '').toLowerCase().includes(q)));
}

/** Facet counts that ignore the facet's own filter, so a chosen option still shows its siblings. */
export function facetCounts(assets, state) {
  const fields = {kind: 'category', ready: 'readiness', chunk: 'chunk', src: 'source'};
  const out = {};
  for (const [key, field] of Object.entries(fields)) {
    const counts = {};
    for (const a of applyFilters(assets, {...state, [key]: null})) if (a[field] != null) counts[a[field]] = (counts[a[field]] ?? 0) + 1;
    out[key] = counts;
  }
  return out;
}

const sheetFrame = /(?:^|\/)([^/]+)_f(\d+)_(\d+)\.png$/;

/**
 * Frames in one flat list `{clip, n, path, ms}`. Clip-less frames (tileset sheets) take their sheet
 * name from the file (`floor_blob47_f0_12.png` → clip `floor_blob47`, n 12).
 */
export function framesOf(detail) {
  const out = [];
  for (const f of detail.frames ?? []) {
    let {clip, n} = f;
    if (clip == null) {
      const m = sheetFrame.exec(f.path);
      if (!m) continue;
      clip = m[1]; n = Number(m[3]);
    }
    const ms = f.durationMs ?? detail.clips?.[clip]?.ms;
    out.push({clip, n, path: f.path, ms: ms > 0 ? ms : null, direction: f.direction ?? null});
  }
  return out.sort((a, b) => a.clip.localeCompare(b.clip) || a.n - b.n);
}

export function clipNames(frames) {
  return [...new Set(frames.map(f => f.clip))];
}

export const framesOfClip = (frames, clip) => frames.filter(f => f.clip === clip);

/** Default frame duration when a clip does not record one: shown as such, never presented as data. */
export const fallbackMs = 120;
export const frameMs = frame => frame.ms ?? fallbackMs;

/** Clips that show a damaged, spent or helper state; a thumbnail only uses one when nothing else exists. */
const poorClips = /(debris|broken|shatter|crumble|harvested|used|spawn|shadow|deco|overlay|impact|forbidden|nine_slice|cursor|edge)/;
/** Preferred clips, best first. Anchored names win over the pattern entries. */
const coverClips = ['idle', 'intact', 'common', 'static', 'glyph', 'held', 'flight', 'floor', 'closed', 'cold', 'open', 'boss_hp', 'form1', 'button', 'current'];
/** Tileset sheets: a plain floor variant reads as a tile; the first blob-47 tile is an isolated corner. */
const tileClips = [/^floor_variants$/, /^floor.*_variants$/, /^floor$/, /^floor.*(?<!blob47)$/, /floor/, /ground|grass|stone|wall_face|wall/];

/**
 * The frame the card thumbnail shows. Tilesets get a representative floor tile; every other asset
 * its idle-like clip, never a debris, shadow or helper clip while a better one exists. Total and
 * deterministic: the same frames always give the same cover.
 */
export function coverFrame(frames, category = null) {
  const clips = clipNames(frames);
  if (!clips.length) return null;
  const good = clips.filter(c => !poorClips.test(c));
  let clip = null;
  if (category === 'tileset') for (const re of tileClips) { clip = good.find(c => re.test(c)); if (clip) break; }
  clip ??= coverClips.find(c => good.includes(c)) ?? good[0] ?? coverClips.find(c => clips.includes(c)) ?? clips[0];
  const own = frames.filter(f => f.clip === clip);
  return own[0] ?? null;
}

/** Relation groups for display. A shot found via "used by" is the weapon's projectile and the reverse. */
export function groupLinks(links = {}, byId = new Map(), selfCategory = null) {
  const groups = {projectile: [], weapon: [], builtFrom: [], usedBy: [], effects: [], effectFor: []};
  const put = (group, id) => { if (byId.has(id) && !groups[group].includes(id)) groups[group].push(id); };
  for (const id of links.projectile ?? []) put('projectile', id);
  for (const id of links.weapon ?? []) put('weapon', id);
  for (const id of links.usedBy ?? []) put(byId.get(id)?.category === 'projectile' ? 'projectile' : 'usedBy', id);
  for (const id of links.builtFrom ?? []) put(selfCategory === 'projectile' && byId.get(id)?.category === 'weapon' ? 'weapon' : 'builtFrom', id);
  for (const id of links.effects ?? []) put('effects', id);
  for (const id of links.effectFor ?? []) put('effectFor', id);
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length));
}

// ---- tileset tools --------------------------------------------------------------------------

/** mask → tile index. A tileset mapping JSON wins over the built-in canonical order. */
export function bitmaskMap(json) {
  return (json && parseWorkerBitmaskJson(json, 'mapping')) || createDefaultBitmaskMap();
}

/** Sheets of a tileset record that hold the 47 blob tiles. */
export function blobSheets(record, frames) {
  const have = new Set(clipNames(frames));
  return (record?.sheets ?? []).filter(s => s.tiles === 47 && have.has(s.id)).map(s => s.id);
}

/** Path of the fully surrounded tile (mask 255) in the floor sheet's own frames, or null. */
export function floorTilePath(frames, floorId, map) {
  if (!floorId) return null;
  const n = map.maskToTile.get(255);
  return framesOfClip(frames, floorId).find(f => f.n === n)?.path ?? null;
}

/** A small test room: `1` is wall, `0` floor; deterministic from the seed; the border is always wall. */
export function testRoom(seed, cols = 14, rows = 9) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const grid = Array.from({length: rows}, (_, y) => Array.from({length: cols}, (_, x) =>
    y === 0 || x === 0 || y === rows - 1 || x === cols - 1 ? 1 : 0));
  for (let i = 0; i < Math.floor(cols * rows / 14); i++) {
    const w = 1 + Math.floor(rng() * 3), h = 1 + Math.floor(rng() * 2);
    const x0 = 2 + Math.floor(rng() * (cols - 4 - w + 1)), y0 = 2 + Math.floor(rng() * (rows - 4 - h + 1));
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) grid[y][x] = 1;
  }
  return grid;
}

/** The tile index each cell uses for `solid` (1 = walls, 0 = floor), through the blob-47 mask. */
export function autotile(grid, solid, map) {
  const same = (x, y) => (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length ? true : grid[y][x] === solid);
  return grid.map((row, y) => row.map((cell, x) => cell === solid ? map.maskToTile.get(computeBlob47Mask(x, y, same)) ?? null : null));
}

export const blobMasks = CANONICAL_47_MASKS;

// ---- UI tools -------------------------------------------------------------------------------

export function clampInsets(ins, w, h) {
  const [l, t, r, b] = ins;
  const cl = Math.min(l, Math.floor((w - 1) / 2)), cr = Math.min(r, w - 1 - cl);
  const ct = Math.min(t, Math.floor((h - 1) / 2)), cb = Math.min(b, h - 1 - ct);
  return [cl, ct, cr, cb];
}

/** Default insets for a frame: a third of the shorter side, at most 8. */
export const defaultInsets = (w, h) => { const n = Math.max(1, Math.min(8, Math.floor(Math.min(w, h) / 3))); return [n, n, n, n]; };

/** Nine drawImage rectangles `[sx, sy, sw, sh, dx, dy, dw, dh]`; corners keep their pixels, edges stretch. */
export function nineSlice(w, h, dw, dh, insets) {
  const [l, t, r, b] = clampInsets(insets, w, h);
  const sx = [0, l, w - r, w], sy = [0, t, h - b, h];
  const mw = Math.max(0, dw - l - r), mh = Math.max(0, dh - t - b);
  const dx = [0, l, l + mw, l + mw + r], dy = [0, t, t + mh, t + mh + b];
  const rects = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const rect = [sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]];
    if (rect[2] > 0 && rect[3] > 0 && rect[6] > 0 && rect[7] > 0) rects.push(rect);
  }
  return rects;
}

/** Destination sizes shown for the nine-slice preview: the native size, then wider and taller ones. */
export function nineSizes(w, h) {
  return [[w, h], [w * 2, h], [w, h * 2], [w * 3, h * 2], [Math.max(w + 4, Math.round(w * 1.5)), h * 3]];
}

/** Width of the visible part of a bar at `fill` percent; the left edge never moves. */
export const hudClipWidth = (w, fill) => Math.max(0, Math.min(w, Math.round(w * fill / 100)));
