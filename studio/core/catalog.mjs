// Whole-project catalog: every asset the pack's sources list, in every category, with its
// readiness, chunk and wave; plus one-asset detail and the Overview roll-up.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, readJsonIfExists, walkFiles } from './files.mjs';
import { fillTemplate } from './pack.mjs';

/** Pipeline stages in order. A manifest claim and file evidence are merged to the furthest stage. */
export const readinessOrder = ['planned', 'authored', 'packed'];
const rank = value => { const i = readinessOrder.indexOf(value); return i < 0 ? 0 : i; };
const furthest = (a, b) => rank(b) > rank(a) ? b : a;

function pick(node, dotted) {
  return dotted.split('.').reduce((value, part) => value?.[part], node);
}

const ids = list => Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
const frameFile = /^(.+)_([a-z]+)_(\d+)\.png$/;

/** Frame files below `dir` grouped by asset id (the directory the frames sit in). */
export async function framesByDirectory(root, dir) {
  const byId = new Map();
  for (const file of await walkFiles(root, dir, f => f.endsWith('.png'))) {
    const parts = file.split('/');
    const id = parts.at(-2);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(file);
  }
  return byId;
}

function parseFrame(file) {
  const name = file.split('/').at(-1);
  const m = frameFile.exec(name);
  return m ? {clip: m[1], direction: m[2], n: Number(m[3]), path: file} : {clip: null, direction: null, n: null, path: file};
}

/** Chunk atlas manifests of a design source, by chunk name; {} when the source has no budget. */
async function loadChunks(root, source, data) {
  const budget = source.budget;
  if (!budget) return {};
  const ceilings = pick(data, budget.ceilings) ?? {};
  const page = pick(data, budget.page), bpp = pick(data, budget.bytesPerPixel);
  const chunks = {};
  for (const [chunk, pages] of Object.entries(ceilings)) {
    const manifest = await readJsonIfExists(root, fillTemplate(budget.manifest, {chunk}));
    chunks[chunk] = {
      chunk, ceilingPages: pages, pageBytes: page[0] * page[1] * bpp,
      pages: manifest?.page_count ?? 0, bytes: manifest?.rgba8_bytes ?? 0, frames: manifest?.frame_count ?? 0,
      packedIds: new Set(manifest?.asset_ids ?? []), hasAtlas: Boolean(manifest)
    };
  }
  return chunks;
}

async function atlasKeys(root, atlas) {
  const keys = new Set();
  for (const file of await walkFiles(root, atlas.dir, f => /atlas-\d+\.json$/.test(f))) {
    const frames = (await readJson(root, file)).frames;
    for (const key of Array.isArray(frames) ? frames.map(f => f.filename) : Object.keys(frames ?? {})) keys.add(key);
  }
  return keys;
}

async function audioEvidence(root, evidence = {}) {
  const packed = new Set(), authored = new Set();
  if (evidence.packs) {
    for (const file of await walkFiles(root, evidence.packs, f => f.endsWith('/pack.json'))) {
      const pack = await readJson(root, file);
      // Older packs name one bed under `bgm`; later batches list several under `bgms`.
      for (const bed of [pack.bgm, ...(Array.isArray(pack.bgms) ? pack.bgms : [])]) if (bed?.id) packed.add(bed.id);
      for (const cue of pack.sfx?.cues ?? []) if (cue.id) packed.add(cue.id);
    }
  }
  if (evidence.masters) {
    for (const file of await walkFiles(root, evidence.masters, f => f.endsWith('.wav'))) {
      const parts = file.split('/'), base = parts.at(-1).replace(/\.wav$/, '');
      authored.add(base === 'master' ? parts.at(-2) : base);
    }
  }
  return {packed, authored};
}

const readers = {
  'asset-manifest': async (source, data) => data.assets.map(a => ({
    id: a.id, category: a.category, size: a.size, name: a.name?.en ?? a.name,
    readiness: a.readiness ?? 'planned', status: a.status, agent: a.assigned_agent,
    clips: Object.keys(a.animations ?? {})
  })),
  'design-manifest': async (source, data, {root, pack}) => {
    const chunks = await loadChunks(root, source, data);
    const processed = source.processed ? await framesByDirectory(root, pack.directories.processed[source.processed]) : new Map();
    const evidence = id => {
      for (const chunk of Object.values(chunks)) if (chunk.packedIds.has(id)) return 'packed';
      return processed.has(id) ? 'authored' : 'planned';
    };
    const category = profile => data.profiles?.[profile]?.category ?? profile;
    const assets = data.assets.map(a => ({
      id: a.id, category: category(a.profile), profile: a.profile, chunk: a.chunk_group, wave: a.phase,
      method: a.method, agent: a.assigned_agent ?? data.profiles?.[a.profile]?.assigned_agent,
      readiness: furthest(a.readiness ?? data.defaults?.readiness ?? 'planned', evidence(a.id))
    }));
    const effects = pick(data, source.effects ?? '') ?? [];
    return {entries: [...assets, ...effects.map(e => ({
      id: e.id, category: 'vfx', source: source.id + '_effects', chunk: e.chunk_group, method: e.method,
      agent: e.assigned_agent ?? data.vfx?.assigned_agent, size: e.native_px, wave: null,
      readiness: furthest(e.status ?? 'planned', evidence(e.id))
    }))], chunks};
  },
  'vfx-index': async (source, data, {root, pack}) => {
    const keys = source.atlas ? await atlasKeys(root, source.atlas) : new Set();
    const template = source.atlas ? pack.frameKeys[source.atlas.frameKey] : undefined;
    return data.effects.map(e => ({
      id: e.id, category: 'vfx', size: e.frame_size, frames: e.frame_count,
      readiness: template && keys.has(fillTemplate(template, {id: e.id, n: 0})) ? 'packed' : 'authored'
    }));
  },
  // Every list of id strings under "core" and "extensions" is a catalogued audio group.
  'audio-plan': async (source, data, {root}) => {
    const {packed, authored} = await audioEvidence(root, source.evidence);
    const out = [], seen = new Set();
    function add(id, category, group) {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({id, category, group, readiness: packed.has(id) ? 'packed' : authored.has(id) ? 'authored' : 'planned'});
    }
    for (const [group, lists] of Object.entries(data.core ?? {})) ids(lists).forEach(id => add(id, group, 'core'));
    for (const [group, node] of Object.entries(data.extensions ?? {}))
      for (const [category, list] of Object.entries(node)) ids(list).forEach(id => add(id, category, group));
    return out;
  }
};

/**
 * Build the catalog from a pack. Returns {assets, totals, chunks}; each asset is
 * {id, source, category, readiness, chunk?, wave?, ...}. `totals` counts all assets, per source
 * and per category; `chunks` holds the per-chunk atlas budget figures of design sources.
 */
export async function buildCatalog(pack, root) {
  root = await fs.realpath(root);
  const assets = [], chunks = [];
  for (const source of pack.catalog.sources) {
    const read = await catalogSource(pack, root, source);
    chunks.push(...read.chunks);
    assets.push(...read.assets);
  }
  const count = key => assets.reduce((all, a) => (all[a[key]] = (all[a[key]] ?? 0) + 1, all), {});
  const seen = new Set();
  for (const a of assets) {
    const id = a.source + '/' + a.id;
    if (seen.has(id)) throw new Error(`Duplicate catalog id ${id}`);
    seen.add(id);
  }
  return {assets, chunks: chunks.map(({packedIds, ...c}) => ({...c, assetIds: [...packedIds].sort()})),
    totals: {total: assets.length, bySource: count('source'), byCategory: count('category')}};
}

/** Entries (and chunk budgets) of one catalog source, so callers can read a single manifest. */
export async function catalogSource(pack, root, source) {
  root = await fs.realpath(root);
  const data = await readJson(root, source.file);
  let entries = await readers[source.kind](source, data, {root, pack});
  let chunks = [];
  if (!Array.isArray(entries)) { chunks = Object.values(entries.chunks); entries = entries.entries; }
  for (const entry of entries)
    if (typeof entry.id !== 'string' || !entry.id) throw new Error(`Catalog source "${source.id}" has an entry without an id`);
  return {assets: entries.map(entry => ({source: source.id, ...entry})), chunks};
}

const tally = (items, key) => items.reduce((all, item) => {
  const k = item[key] ?? 'none';
  all[k] = (all[k] ?? 0) + 1;
  return all;
}, {});

/** Filter a catalog's assets: category, readiness, chunk, wave, source, group, text query. */
export function filterAssets(assets, query = {}) {
  const q = query.q?.trim().toLowerCase();
  return assets.filter(a => ['category', 'readiness', 'chunk', 'wave', 'source', 'group'].every(f => !query[f] || String(a[f]) === query[f]) &&
    (!q || a.id.toLowerCase().includes(q) || (a.name ?? '').toLowerCase().includes(q)));
}

/** Overview roll-up straight from the catalog: readiness by source, category, wave and chunk budget. */
export function overview(catalog) {
  const {assets, chunks, totals} = catalog;
  const byReadiness = items => ({total: items.length, ...Object.fromEntries(readinessOrder.map(r => [r, 0])), ...tally(items, 'readiness')});
  const group = key => Object.fromEntries(Object.entries(Object.groupBy(assets.filter(a => a[key]), a => a[key]))
    .map(([name, items]) => [name, byReadiness(items)]));
  const budgets = chunks.map(c => {
    const members = assets.filter(a => a.chunk === c.chunk);
    return {chunk: c.chunk, ceilingPages: c.ceilingPages, pages: c.pages, frames: c.frames, bytes: c.bytes,
      ceilingBytes: c.ceilingPages * c.pageBytes, hasAtlas: c.hasAtlas, readiness: byReadiness(members),
      state: !c.hasAtlas ? 'none' : c.pages > c.ceilingPages ? 'over' : c.pages === c.ceilingPages ? 'full' : 'ok'};
  });
  const bySourceGroup = Object.fromEntries(Object.entries(Object.groupBy(assets.filter(a => a.group), a => a.source))
    .map(([source, items]) => [source, Object.fromEntries(Object.entries(Object.groupBy(items, a => a.group)).map(([g, rows]) => [g, byReadiness(rows)]))]));
  return {totals, readinessOrder, overall: byReadiness(assets), bySource: group('source'), bySourceGroup,
    byCategory: group('category'), byWave: group('wave'), chunks: budgets};
}

const provenanceFile = /(^|\/)(provenance[^/]*|metadata|verify|source|anchor)\.(json|md|png)$/;

/**
 * One asset in detail: its catalog entry, manifest record, frames, clips and pointers to its
 * provenance files. `sourceId` disambiguates an id that exists in more than one source.
 */
export async function describeAsset(pack, root, catalog, id, sourceId) {
  root = await fs.realpath(root);
  const matches = catalog.assets.filter(a => a.id === id && (!sourceId || a.source === sourceId));
  if (!matches.length) return null;
  if (matches.length > 1) return {ambiguous: matches.map(a => a.source)};
  const entry = matches[0];
  const sourceKey = entry.source.replace(/_effects$/, '');
  const source = pack.catalog.sources.find(s => s.id === sourceKey);
  const data = await readJson(root, source.file);
  const detail = {asset: entry, record: null, clips: {}, frames: [], provenance: []};
  const scan = async dir => (await framesByDirectory(root, dir)).get(id) ?? [];
  async function pointers(dirs) {
    for (const dir of dirs) for (const f of await walkFiles(root, dir, f => provenanceFile.test(f))) detail.provenance.push({path: f});
  }
  if (source.kind === 'asset-manifest') {
    const record = data.assets.find(a => a.id === id);
    detail.record = record;
    detail.clips = Object.fromEntries(Object.entries(record.animations ?? {}).map(([c, v]) => [c, {frames: v.frames, loop: v.loop}]));
    detail.directions = record.directions;
    detail.frames = (await scan(pack.directories.processed[source.processed])).map(parseFrame);
    const raw = record.output_path?.replace(/\/+$/, '');
    await pointers([raw, ...new Set(detail.frames.map(f => f.path.split('/').slice(0, -1).join('/')))].filter(Boolean));
  } else if (source.kind === 'design-manifest') {
    const isEffect = entry.source.endsWith('_effects');
    const record = isEffect ? pick(data, source.effects).find(e => e.id === id) : data.assets.find(a => a.id === id);
    detail.record = record;
    const profile = data.profiles?.[record.profile];
    detail.clips = isEffect
      ? Object.fromEntries(Object.entries(record.clips ?? {}).map(([c, v]) => [c, {frames: v.n, ms: v.ms, kind: v.kind}]))
      : Object.fromEntries(Object.entries(profile?.clips ?? {}).map(([c, [frames, ms]]) => [c, {frames, ms}]));
    detail.directions = profile?.directions;
    detail.frames = (await scan(pack.directories.processed[source.processed])).map(parseFrame);
    await pointers([...(source.raw ? [pack.directories.raw[source.raw] + '/' + id] : []), pack.directories.processed[source.processed] + '/' + id]);
  } else if (source.kind === 'vfx-index') {
    const effect = data.effects.find(e => e.id === id);
    const descriptor = await readJson(root, effect.descriptor);
    detail.record = effect;
    detail.clips = Object.fromEntries((effect.tags ?? []).map(([name, from, to, kind]) => [name, {from, to, kind}]));
    detail.frames = descriptor.frames.map((f, n) => ({clip: null, direction: null, n, path: f.key, durationMs: f.duration_ms}));
    detail.provenance = [{path: effect.descriptor}, ...(descriptor.spec ? [{path: descriptor.spec}] : [])];
  } else if (source.kind === 'audio-plan' && source.evidence?.masters) {
    const files = await walkFiles(root, source.evidence.masters, f => f.includes('/' + id + '/') || f.endsWith('/' + id + '.wav') || f.endsWith('/' + id + '.json'));
    detail.provenance = files.filter(f => provenanceFile.test(f) || /score\.json$/.test(f)).map(path => ({path}));
    detail.frames = files.filter(f => f.endsWith('.wav')).map(path => ({clip: 'master', direction: null, n: 0, path}));
    // A master from a batch folder points at that batch's source folder (same folder name).
    const batches = new Set(detail.frames.map(f => f.path.split('/').at(-2)).filter(name => name !== id));
    if (source.evidence.sources && batches.size) {
      const sources = await walkFiles(root, source.evidence.sources, f => batches.has(f.split('/').at(-2)));
      detail.provenance.push(...sources.map(path => ({path})));
    }
  }
  detail.provenance.push({path: source.file, note: 'manifest'});
  for (const p of detail.provenance) p.exists = await fs.access(path.join(root, p.path)).then(() => true, () => false);
  return detail;
}
