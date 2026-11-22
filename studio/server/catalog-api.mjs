// Read-only studio API over studio/core: project, catalog list/filter, one asset, overview.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPack, buildCatalog, filterAssets, describeAsset, overview, parsePalette } from '../core/index.mjs';
import { readJson } from '../core/files.mjs';
import { problem } from './editor-catalog.mjs';
import { assertLoopback } from './loopback.mjs';

/** The nine studio destinations; the shell, not any tab, owns this list. */
export const destinations = ['overview', 'characters', 'objects', 'vfx', 'audio', 'review', 'jobs', 'sandbox', 'atlas'];
const uiDir = fileURLToPath(new URL('../ui/', import.meta.url));
const maxPage = 1000;
const facetFields = ['category', 'readiness', 'chunk', 'wave', 'source', 'group'];

function tabBuilt(id) {
  return fs.existsSync(uiDir + 'tabs/' + id + '/index.mjs');
}

function facets(assets) {
  return Object.fromEntries(facetFields.map(f => [f, assets.reduce((all, a) => {
    if (a[f] != null) all[a[f]] = (all[a[f]] ?? 0) + 1;
    return all;
  }, {})]));
}

/**
 * `root` is the project directory (holds the pack by default). `ttlMs` bounds how stale the
 * cached catalog may be, so edits to manifests and frames show up without restarting.
 */
export function studioApi(root, {ttlMs = 2000} = {}) {
  let cached, at = 0, pending;
  async function library() {
    if (cached && Date.now() - at < ttlMs) return cached;
    pending ??= (async () => {
      const pack = await loadPack(root);
      const palette = parsePalette(await readJson(root, pack.palette.file));
      const raw = await readJson(root, pack.palette.file);
      cached = {pack, palette, rawPalette: raw, catalog: await buildCatalog(pack, root)};
      at = Date.now();
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  }

  async function projectInfo() {
    const {pack, rawPalette} = await library();
    const colors = Object.fromEntries(rawPalette.colors.map(c => [c.id, c.hex]));
    const ui = pack.ui ?? {};
    const theme = Object.fromEntries(Object.entries(ui.theme ?? {}).map(([role, id]) => [role, colors[id]]));
    return {id: pack.id, name: pack.name, brand: ui.brand ?? {mark: pack.name.slice(0, 1)}, languages: ui.languages ?? ['en'],
      theme, categoryTabs: ui.categoryTabs ?? {}, tools: ui.tools ?? [], tabConfig: ui.tabs ?? {},
      sources: pack.catalog.sources.flatMap(s => [{id: s.id, label: s.label ?? {en: s.id}},
        ...(s.effectsLabel ? [{id: s.id + '_effects', label: s.effectsLabel}] : [])]),
      tabs: destinations.map(id => ({id, built: tabBuilt(id)})), palette: {name: rawPalette.name, colors: rawPalette.colors.length}};
  }

  const routes = {
    async project() { return projectInfo(); },
    async assets(url) {
      const {catalog} = await library();
      const query = Object.fromEntries(url.searchParams);
      const matched = filterAssets(catalog.assets, query);
      const limit = Math.min(Number.isInteger(+query.limit) && +query.limit > 0 ? +query.limit : 200, maxPage);
      const offset = Number.isInteger(+query.offset) && +query.offset > 0 ? +query.offset : 0;
      return {total: matched.length, offset, limit, assets: matched.slice(offset, offset + limit), facets: facets(catalog.assets)};
    },
    async asset(url, id) {
      const {pack, catalog} = await library();
      const detail = await describeAsset(pack, root, catalog, id, url.searchParams.get('source') ?? undefined);
      if (!detail) throw problem(404, 'unknown_asset', 'No asset with that id');
      if (detail.ambiguous) throw Object.assign(problem(409, 'ambiguous_asset', 'Id exists in several sources; pass source'), {sources: detail.ambiguous});
      return detail;
    },
    async overview() { return overview((await library()).catalog); }
  };

  return {async handle(req, res, url, address) {
    if (!url.pathname.startsWith('/api/studio/')) return false;
    function send(status, data) {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(JSON.stringify(data));
    }
    try {
      assertLoopback(req, address);
      if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The studio catalog is read-only');
      const parts = url.pathname.slice('/api/studio/'.length).split('/').map(decodeURIComponent);
      const [name, id] = parts;
      if (!Object.hasOwn(routes, name) || parts.length > (name === 'asset' || name === 'assets' ? 2 : 1))
        throw problem(404, 'unknown_route', 'Unknown studio route');
      if (name === 'assets' && id) send(200, await routes.asset(url, id));
      else if (name === 'asset') { if (!id) throw problem(404, 'unknown_route', 'Unknown studio route'); send(200, await routes.asset(url, id)); }
      else send(200, await routes[name](url));
    } catch (error) {
      const known = Number.isInteger(error.status);
      if (!known) console.error('studio api:', error);
      send(known ? error.status : 500, {error: {code: known ? error.code : 'catalog_error', message: known ? error.message : 'Catalog unavailable',
        ...(error.sources ? {sources: error.sources} : {})}});
    }
    return true;
  }};
}
