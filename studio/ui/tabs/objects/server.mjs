// Objects tab server routes, read-only, under /api/tabs/objects/:
//   GET links                       relations between assets, read from every manifest
//   GET covers                      the thumbnail frame of every asset in this tab, in one call: [{id, source, path|null}]
//   GET tiles?id=                   tile animations and collision shapes stored in the asset's metadata (F5)
//   GET provenance?id=&source=      generator, seed and hashes from the asset's provenance file(s)
//   GET/POST timeline               frame tags, linked cels, scoped transforms, open in a drawing tool and back (studio/ui/timeline)
//   POST import                     spritesheet importer (studio/ui/importer): cut, gate, revision store; dryRun by default
// Apart from import, nothing here writes. Running generators and creating planned ids belong to the job runner.
import { loadPack, buildCatalog, describeAsset } from '../../../core/index.mjs';
import { readJson, readJsonIfExists } from '../../../core/files.mjs';
import { problem } from '../../../server/editor-catalog.mjs';
import { handleImport } from '../../importer/route.mjs';
import { openWorkspace } from '../../../core/workspace.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { readMetadata } from '../../../core/metadata.mjs';
import { handleTimeline } from '../../timeline/route.mjs';
import { framesOf, coverFrame } from './model.mjs';

const ttlMs = 2000;
const cache = new Map();

async function library(root) {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = (async () => { const pack = await loadPack(root); return {pack, catalog: await buildCatalog(pack, root)}; })();
  cache.set(root, {at: Date.now(), value});
  value.catch(() => cache.delete(root));
  return value;
}

/** Every object with a string `id` anywhere in a manifest (records, effects, nested entries). */
function* records(node) {
  if (Array.isArray(node)) for (const item of node) yield* records(item);
  else if (node && typeof node === 'object') {
    if (typeof node.id === 'string') yield node;
    for (const value of Object.values(node)) if (value && typeof value === 'object') yield* records(value);
  }
}

const strings = value => (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string');

/**
 * Relations by asset id. `projectile`/`weapon` come from `projectile_id`/`weapon_id`; `builtFrom`
 * from `dependencies`; `effects` from an effect entry's `related` list (and the reverse).
 * Only ids that exist in the catalog are kept, and every relation is stored in both directions.
 */
export function buildLinks(manifests, known) {
  const links = new Map();
  const slot = id => links.get(id) ?? links.set(id, {projectile: [], weapon: [], builtFrom: [], usedBy: [], effects: [], effectFor: []}).get(id);
  const add = (from, field, to) => { if (known.has(from) && known.has(to) && from !== to && !slot(from)[field].includes(to)) slot(from)[field].push(to); };
  for (const data of manifests) for (const r of records(data)) {
    for (const to of strings(r.projectile_id)) { add(r.id, 'projectile', to); add(to, 'weapon', r.id); }
    for (const to of strings(r.weapon_id)) { add(r.id, 'weapon', to); add(to, 'projectile', r.id); }
    for (const to of strings(r.dependencies)) { add(r.id, 'builtFrom', to); add(to, 'usedBy', r.id); }
    for (const to of strings(r.related)) { add(r.id, 'effects', to); add(to, 'effectFor', r.id); }
  }
  return Object.fromEntries([...links].map(([id, l]) => [id, Object.fromEntries(Object.entries(l).filter(([, v]) => v.length))]).filter(([, l]) => Object.keys(l).length));
}

const provenanceKeys = ['producer', 'method', 'brief', 'rights', 'generator', 'generator_sha256_lf', 'generator_sha256', 'seed', 'palette',
  'native_px', 'pivot_px', 'source', 'source_sha256', 'parent_sources'];

/** The fields of a provenance file the UI shows, plus the per-frame hashes. Unknown fields are dropped. */
export function summarizeProvenance(file, data) {
  const out = {path: file};
  for (const key of provenanceKeys) if (data[key] !== undefined) out[key] = data[key];
  if (Array.isArray(data.frames)) out.frames = data.frames.filter(f => f && typeof f.key === 'string')
    .map(f => ({key: f.key, sha256: f.sha256, durationMs: f.duration_ms}));
  return out;
}

export async function handle(req, res, url, {root, prefix}) {
  function send(status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  const name = url.pathname.slice(prefix.length);
  if (name === 'import') {
    const tabs = (await loadPack(root, undefined, {verifyFiles: false})).ui?.categoryTabs ?? {};
    return handleImport(req, res, {root, url, allow: asset => tabs[asset.category] === 'objects'});
  }
  if (name === 'tiles') {
    if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The Objects tab API is read-only apart from import');
    const id = url.searchParams.get('id');
    if (!id) throw problem(422, 'invalid_input', 'id is required');
    const ws = openWorkspace(root, {indexer: loadAssetIndex});
    try {
      const asset = (await ws.snapshot()).index.assets.get(id);
      if (!asset) throw problem(404, 'unknown_asset', 'No asset with that id');
      const meta = asset.layout ? await readMetadata(root, asset) : null;
      return send(200, {id, size: asset.size ?? null, sheets: meta?.data?.tiles ?? {}});
    } finally { ws.close(); }
  }
  if (name === 'timeline') {
    const tabs = (await loadPack(root, undefined, {verifyFiles: false})).ui?.categoryTabs ?? {};
    return handleTimeline(req, res, {root, url, allow: asset => tabs[asset.category] === 'objects'});
  }
  const {pack, catalog} = await library(root);
  if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The Objects tab API is read-only apart from import');
  if (name === 'links') {
    const manifests = [];
    for (const source of pack.catalog.sources) manifests.push(await readJson(root, source.file));
    return send(200, {links: buildLinks(manifests, new Set(catalog.assets.map(a => a.id)))});
  }
  if (name === 'covers') {
    const tabs = pack.ui?.categoryTabs ?? {};
    const covers = [];
    for (const a of catalog.assets) {
      if (tabs[a.category] !== 'objects') continue;
      const detail = await describeAsset(pack, root, catalog, a.id, a.source);
      const cover = detail && !detail.ambiguous ? coverFrame(framesOf(detail), a.category) : null;
      covers.push({id: a.id, source: a.source, path: cover?.path ?? null});
    }
    return send(200, {covers});
  }
  if (name === 'provenance') {
    const id = url.searchParams.get('id');
    if (!id) throw problem(422, 'invalid_input', 'id is required');
    const detail = await describeAsset(pack, root, catalog, id, url.searchParams.get('source') ?? undefined);
    if (!detail) throw problem(404, 'unknown_asset', 'No asset with that id');
    if (detail.ambiguous) throw problem(409, 'ambiguous_asset', 'Id exists in several sources; pass source');
    const files = [];
    for (const p of detail.provenance) if (p.exists && /(^|\/)provenance[^/]*\.json$/.test(p.path)) {
      const data = await readJsonIfExists(root, p.path);
      if (data && typeof data === 'object') files.push(summarizeProvenance(p.path, data));
    }
    const record = detail.record ?? {};
    return send(200, {id, files, record: {outputPath: record.output_path, paletteRefs: record.palette_refs, agent: record.assigned_agent ?? record.agent,
      status: record.status, brief: record.brief ?? record.description}, pointers: detail.provenance});
  }
  throw problem(404, 'unknown_route', 'Unknown Objects route');
}
