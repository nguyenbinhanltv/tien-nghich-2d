// Whole-project catalog: every asset the pack's sources list, in every category.
import fs from 'node:fs/promises';
import { readJson } from './files.mjs';

function pick(node, dotted) {
  return dotted.split('.').reduce((value, part) => value?.[part], node);
}

function ids(list) { return Array.isArray(list) ? list.filter(item => typeof item === 'string') : []; }

const readers = {
  'asset-manifest': (source, data) => data.assets.map(a => ({
    id: a.id, category: a.category, size: a.size, name: a.name?.en ?? a.name})),
  'design-manifest': (source, data) => {
    const category = profile => data.profiles?.[profile]?.category ?? profile;
    const assets = data.assets.map(a => ({
      id: a.id, category: category(a.profile), profile: a.profile, group: a.chunk_group, readiness: a.readiness ?? data.defaults?.readiness}));
    const effects = pick(data, source.effects ?? '') ?? [];
    return [...assets, ...effects.map(e => ({
      id: e.id, category: 'vfx', source: source.id + '_effects', group: e.chunk_group, readiness: e.status, size: e.native_px}))];
  },
  'vfx-index': (source, data) => data.effects.map(e => ({
    id: e.id, category: 'vfx', size: e.frame_size, frames: e.frame_count})),
  // Every list of id strings under "core" and "extensions" is a catalogued audio group.
  'audio-plan': (source, data) => {
    const out = [], seen = new Set();
    function add(id, category, group) {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({id, category, group});
    }
    for (const [group, lists] of Object.entries(data.core ?? {})) ids(lists).forEach(id => add(id, group, 'core'));
    for (const [group, node] of Object.entries(data.extensions ?? {}))
      for (const [category, list] of Object.entries(node)) ids(list).forEach(id => add(id, category, group));
    return out;
  }
};

/**
 * Build the catalog from a pack. Returns {assets, totals}; each asset is
 * {id, source, category, ...}. `totals` counts all assets, per source and per category.
 */
export async function buildCatalog(pack, root) {
  root = await fs.realpath(root);
  const assets = [];
  for (const source of pack.catalog.sources) {
    const data = await readJson(root, source.file);
    for (const entry of readers[source.kind](source, data)) {
      if (typeof entry.id !== 'string' || !entry.id) throw new Error(`Catalog source "${source.id}" has an entry without an id`);
      assets.push({source: source.id, ...entry});
    }
  }
  const count = key => assets.reduce((all, a) => (all[a[key]] = (all[a[key]] ?? 0) + 1, all), {});
  const seen = new Set();
  for (const a of assets) {
    const id = a.source + '/' + a.id;
    if (seen.has(id)) throw new Error(`Duplicate catalog id ${id}`);
    seen.add(id);
  }
  return {assets, totals: {total: assets.length, bySource: count('source'), byCategory: count('category')}};
}
