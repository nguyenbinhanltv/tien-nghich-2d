// Atlas & Provenance tab server routes, under /api/tabs/atlas/. Nothing here writes a shipped atlas, a processed or a raw directory:
// packing and exports go to staging directories inside the library (`<library>/atlas-staging`, `<library>/exports`), and the
// shipped atlas directories are fingerprinted before and after every packing run.
//   GET  sets                              the atlas sets, their chunks, shipped pages, budgets and which packing methods are available
//   GET  pages?set=&chunk=&profile=        shipped pages with every frame: rectangle, asset, clip, direction, frame, source file
//   GET  image?set=&chunk=&profile=&page=  one shipped page PNG
//   GET  search?q=&profile=                frames whose key or asset id contains q, across every set and chunk
//   GET  whatif?set=&chunk=                the chunk packed with and without the frames agents submitted but nobody processed yet
//   POST pack {set, chunk?, engine: 'studio' | 'authority', check?}   stage and compare byte by byte (see core/atlas-proof.mjs)
//   POST export {set, chunk?, profile, formats?}                      engine exports into the export staging directory
//   GET  export-file?path=                 one exported file (download); the path must lie inside the export staging directory
//   GET  ledger?lang=&format=json|md&download=1   licence and provenance ledger, AI disclosure
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { loadPackSync } from '../../../core/pack.mjs';
import { problem } from '../../../core/errors.mjs';
import { openWorkspace } from '../../../core/workspace.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { withLock } from '../../../core/fsutil.mjs';
import { atlasSets, assertName, chunksOf, setOf, shippedPages, usedArea, profileFor } from '../../../core/atlas-sets.mjs';
import { stageAndProve, whatIf, shippedSummary } from '../../../core/atlas-stage.mjs';
import { exportAtlas } from '../../../core/export/run.mjs';
import { formats } from '../../../core/export/index.mjs';
import { keyIndex } from '../../../core/export/describe.mjs';
import { framePath } from '../../../core/assets.mjs';
import { buildLedger, disclosure, ledgerMarkdown } from '../../../core/ledger.mjs';

const LIMITS = {body: 16 * 1024, hits: 60};

export function libraryOf(root, context = {}) {
  return context.libraryDir ?? path.join(root, loadPackSync(root, undefined, {verifyFiles: false}).directories.revisions);
}

/** One consistent read of the pack and the asset index. The index is the project adapter's (studio/mcp/asset-index.mjs), the same one every tool uses. */
async function snapshot(root) {
  const ws = openWorkspace(root, {indexer: loadAssetIndex});
  try { const snap = await ws.snapshot(); return {pack: snap.pack, index: snap.index, close: () => ws.close()}; }
  catch (error) { ws.close(); throw error; }
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > LIMITS.body) throw problem(413, 'too_large', 'The request body is too large.'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { const body = JSON.parse(Buffer.concat(chunks)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw problem(400, 'invalid_json', 'The request body must be a JSON object.'); }
}

const chunkParam = (set, value, index) => {
  if (!set.layout.includes('{chunk}')) return undefined;
  assertName(value, 'chunk');
  if (!chunksOf(set, index).includes(value)) throw problem(404, 'unknown_chunk', `No chunk "${value}" in set ${set.id}.`);
  return value;
};
const profileParam = (set, value) => {
  const name = value ?? set.profiles[0];
  if (!set.profiles.includes(name)) throw problem(404, 'unknown_profile', `Set ${set.id} has no profile "${name}". Profiles: ${set.profiles.join(', ')}.`);
  return name;
};

/** Can the registered interpreter and a command run on this machine? (A file check; nothing is started.) */
function authorityState(root, pack, set) {
  const interpreter = pack.adapters?.interpreter?.command;
  const toolchain = Boolean(interpreter) && fsSync.existsSync(path.join(root, interpreter));
  const exists = spec => Boolean(spec) && Boolean(pack.adapters?.commands?.[spec.command]) && fsSync.existsSync(path.join(root, pack.adapters.commands[spec.command].script));
  return {build: toolchain && exists(set.authority?.build), check: toolchain && exists(set.authority?.check), registered: Boolean(set.authority?.build), toolchain};
}

async function overviewOf(root, pack, index) {
  const out = [];
  for (const set of atlasSets(pack)) {
    const chunked = set.layout.includes('{chunk}');
    const entry = {id: set.id, label: set.label, format: set.format, profiles: set.profiles, chunked, authority: authorityState(root, pack, set),
      studioPack: chunked || Boolean(set.processed), padding: Object.fromEntries(set.profiles.map(p => { const pr = profileFor(pack, set, p, index.info); return [p, {padding: pr.padding, extrude: pr.extrude, limit: pr.limit, fixedSize: pr.fixedSize}]; }))};
    if (chunked) {
      entry.chunks = [];
      for (const chunk of chunksOf(set, index)) {
        const members = [...index.assets.values()].filter(a => a.chunk === chunk);
        entry.chunks.push({id: chunk, assets: members.length, ceilingPages: index.info?.[set.design?.chunks ?? 'chunks']?.[chunk] ?? null, shipped: await shippedSummary(root, pack, index, set, chunk)});
      }
    } else entry.shipped = await shippedSummary(root, pack, index, set);
    out.push(entry);
  }
  return out;
}

/** A page's frames with what the index knows about each: asset, clip, direction, n, the processed file. */
function annotate(index, page, find) {
  return page.frames.map(f => {
    const hit = find(f.key), asset = hit?.asset;
    const file = asset?.layout ? framePath(asset, 'processed', hit.clip, hit.direction, hit.n) : null;
    return {...f, asset: asset?.id ?? null, category: asset?.category ?? null, source: asset?.source ?? null, clip: hit?.clip ?? null, direction: hit?.direction ?? null, n: hit?.n ?? null, file};
  });
}

export async function handle(req, res, url, context) {
  const {root, prefix} = context;
  const route = url.pathname.slice(prefix.length);
  const q = name => url.searchParams.get(name);
  const send = (status, data, headers = {}) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers});
    res.end(JSON.stringify(data));
  };
  const sendText = (status, text, type, headers = {}) => { res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}); res.end(text); };
  const known = ['sets', 'pages', 'image', 'search', 'whatif', 'pack', 'export', 'export-file', 'ledger', 'formats'];
  if (!known.includes(route)) throw problem(404, 'unknown_route', 'Unknown Atlas route');
  const writes = ['pack', 'export'].includes(route);
  if (writes ? req.method !== 'POST' : !['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', writes ? `${route} takes POST` : `${route} takes GET`);

  if (route === 'formats') return send(200, {formats: formats.map(f => ({id: f.id, label: f.label}))});

  const snap = await snapshot(root);
  try {
    const {pack, index} = snap;
    const library = libraryOf(root, context);
    if (route === 'sets') return send(200, {sets: await overviewOf(root, pack, index), formats: formats.map(f => ({id: f.id, label: f.label}))});

    if (route === 'ledger') {
      const ledger = await buildLedger({root, pack, index});
      const lang = q('lang') === 'vi' ? 'vi' : 'en', format = q('format') ?? 'json', download = q('download') === '1';
      const name = `${pack.id}-ledger`;
      if (format === 'md') return sendText(200, ledgerMarkdown(ledger, lang), 'text/markdown; charset=utf-8', download ? {'Content-Disposition': `attachment; filename="${name}.${lang}.md"`} : {});
      if (format !== 'json') throw problem(422, 'invalid_input', 'format must be json or md.');
      const body = {...ledger, disclosure: disclosure(ledger, lang)};
      return download ? sendText(200, JSON.stringify(body, null, 2) + '\n', 'application/json; charset=utf-8', {'Content-Disposition': `attachment; filename="${name}.json"`}) : send(200, body);
    }

    if (route === 'search') {
      const needle = (q('q') ?? '').trim().toLowerCase();
      if (needle.length < 2) return send(200, {hits: [], truncated: false});
      const find = keyIndex(index), hits = [];
      let truncated = false;
      outer: for (const set of atlasSets(pack)) {
        const profile = set.profiles.includes(q('profile')) ? q('profile') : set.profiles[0];
        const chunks = set.layout.includes('{chunk}') ? chunksOf(set, index) : [undefined];
        for (const chunk of chunks) {
          const {pages} = await shippedPages(root, pack, set, profile, chunk);
          for (const page of pages) for (const f of page.frames) {
            const hit = find(f.key);
            if (!f.key.toLowerCase().includes(needle) && !(hit?.asset.id.toLowerCase().includes(needle))) continue;
            if (hits.length >= LIMITS.hits) { truncated = true; break outer; }
            hits.push({set: set.id, chunk: chunk ?? null, profile, page: page.index, key: f.key, x: f.x, y: f.y, w: f.w, h: f.h, asset: hit?.asset.id ?? null, category: hit?.asset.category ?? null});
          }
        }
      }
      return send(200, {hits, truncated});
    }

    if (route === 'export-file') {
      const base = path.join(library, 'exports');
      const rel = q('path') ?? '';
      if (!rel || rel.includes('\0') || path.isAbsolute(rel) || rel.split(/[\\/]/).some(p => p === '..')) throw problem(422, 'invalid_path', 'path must be relative to the export staging directory.');
      const file = path.join(base, rel);
      const [realBase, realFile] = [await fs.realpath(base).catch(() => null), await fs.realpath(file).catch(() => null)];
      if (!realBase || !realFile || !realFile.startsWith(realBase + path.sep)) throw problem(404, 'not_found', 'No such exported file.');
      const stat = await fs.stat(realFile);
      if (!stat.isFile()) throw problem(404, 'not_found', 'No such exported file.');
      const type = {'.json': 'application/json', '.tsj': 'application/json', '.png': 'image/png', '.tres': 'text/plain', '.cs': 'text/plain'}[path.extname(realFile)] ?? 'application/octet-stream';
      res.writeHead(200, {'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${path.basename(realFile)}"`});
      return req.method === 'HEAD' ? res.end() : res.end(await fs.readFile(realFile));
    }

    const body = writes ? await readBody(req) : null;
    const set = setOf(pack, writes ? body.set : q('set'));
    const chunk = chunkParam(set, writes ? body.chunk : q('chunk'), index);

    if (route === 'pages' || route === 'image') {
      const profile = profileParam(set, q('profile'));
      const {pages} = await shippedPages(root, pack, set, profile, chunk);
      if (route === 'image') {
        const n = Number(q('page'));
        const page = Number.isInteger(n) ? pages.find(p => p.index === n) : null;
        if (!page) throw problem(404, 'no_page', 'No such page.');
        const bytes = await fs.readFile(path.join(root, page.png));
        res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
        return req.method === 'HEAD' ? res.end() : res.end(bytes);
      }
      const find = keyIndex(index), profileSpec = profileFor(pack, set, profile, index.info);
      return send(200, {set: set.id, chunk: chunk ?? null, profile, spec: {padding: profileSpec.padding, extrude: profileSpec.extrude, limit: profileSpec.limit, fixedSize: profileSpec.fixedSize},
        pages: pages.map(p => ({index: p.index, name: p.name, width: p.width, height: p.height, frameCount: p.frameCount, usage: usedArea(p, profileSpec), frames: annotate(index, p, find)}))});
    }

    if (route === 'whatif') return send(200, await whatIf(root, pack, index, set, chunk));

    if (route === 'pack') {
      const engine = body.engine ?? 'studio';
      if (set.layout.includes('{chunk}') && chunk === undefined) throw problem(422, 'invalid_input', 'chunk is required for this set.');
      const result = await withLock(`atlas-pack:${set.id}:${chunk ?? ''}:${engine}`, () => stageAndProve({root, pack, index, set, chunk, engine, base: library, check: body.check === true}));
      return send(200, {...result, dir: path.relative(library, result.dir), note: 'Staging only. Nothing was written to a shipped atlas directory; delivering atlases is a human step.'});
    }

    if (route === 'export') {
      const profile = profileParam(set, body.profile);
      if (body.formats !== undefined && (!Array.isArray(body.formats) || body.formats.some(f => typeof f !== 'string'))) throw problem(422, 'invalid_input', 'formats must be a list of format ids.');
      const result = await withLock(`atlas-export:${set.id}:${chunk ?? ''}:${profile}`, () => exportAtlas({root, pack, index, set, profile, chunk, ids: body.formats, base: library}));
      return send(200, {...result, dir: path.relative(library, result.dir), downloadBase: path.relative(path.join(library, 'exports'), result.dir)});
    }
  } finally { snap.close(); }
}
