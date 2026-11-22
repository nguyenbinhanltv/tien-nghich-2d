// Review tab server routes, under /api/tabs/review/. Reading: the inbox, who submitted a frame, audio
// measurements and a waveform. Writing: ONE route, the listening sign-off, which is human-only.
// Art decisions (approve, request changes, comment) do not live here: the browser sends them to the
// existing /api/editor/review route, which has the store's guards. No MCP tool calls anything below.
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { loadPackSync } from '../../../core/pack.mjs';
import { loadPack, buildCatalog, describeAsset, loadEditableCatalog, createStanding } from '../../../core/index.mjs';
import { readJson, readInside } from '../../../core/files.mjs';
import { readSubmissions } from '../../../core/submissions.mjs';
import { problem } from '../../../server/editor-catalog.mjs';
import { sameImage } from '../../../core/standing.mjs';
import { readInbox, readHeads, withStanding } from './inbox.mjs';
import { openSignoffs, verdicts } from './signoff.mjs';
import { peaks, maxWavBytes } from './wav.mjs';
import { hashOf } from './hashes.mjs';
import { audioStatus } from './status.mjs';
import { readApprovals } from './approvals.mjs';
import { readArtApprovals } from './art-approvals.mjs';

const handles = new Map();
const wavCache = new Map();
const idPattern = /^[A-Za-z0-9_.-]{1,64}$/;

/** The revision library: a custom one when the host passes `libraryDir`, else the pack's default. */
export function libraryOf(root, context = {}) {
  return context.libraryDir ?? path.join(root, loadPackSync(root, undefined, {verifyFiles: false}).directories.revisions);
}

const signoffs = dir => { if (!handles.has(dir)) handles.set(dir, openSignoffs(dir)); return handles.get(dir); };

const libraryCache = new Map();
const LIBRARY_TTL_MS = 15000;

/** The audio assets, their master paths and the project's earlier approvals; cached briefly (describing 46 assets is not free). */
async function audioAssets(root) {
  const hit = libraryCache.get(root);
  if (hit && Date.now() - hit.at < LIBRARY_TTL_MS) return hit.value;
  const value = (async () => {
    const pack = await loadPack(root);
    const catalog = await buildCatalog(pack, root);
    const sources = pack.catalog.sources.filter(s => s.kind === 'audio-plan');
    const ids = new Set(sources.map(s => s.id));
    const list = catalog.assets.filter(a => ids.has(a.source));
    const masters = new Map();
    for (const a of list) if (a.readiness !== 'planned') masters.set(a.id, (await describeAsset(pack, root, catalog, a.id, a.source)).frames.find(f => f.path.endsWith('.wav'))?.path ?? null);
    const approvals = await readApprovals(root, sources.find(s => s.evidence?.masters)?.evidence.masters);
    return {pack, catalog, list, masters, approvals};
  })();
  libraryCache.set(root, {at: Date.now(), value});
  value.catch(() => libraryCache.delete(root));
  return value;
}

const artCache = new Map();

/**
 * The editable art frames (key -> project-relative PNG) and the standing resolver, cached briefly like the audio listing.
 * Used for the inbox's revision-0 items and for the tab's count of every art frame by state.
 */
async function artFrames(root) {
  const hit = artCache.get(root);
  if (hit && Date.now() - hit.at < LIBRARY_TTL_MS) return hit.value;
  const value = (async () => {
    const pack = await loadPack(root);
    const editable = await loadEditableCatalog(pack, root);
    return {files: new Map([...editable.frames].map(([key, f]) => [key, f.processed])),
      standing: createStanding(root, {review: pack.review, approvalsDir: pack.directories.approvals})};
  })();
  artCache.set(root, {at: Date.now(), value});
  value.catch(() => artCache.delete(root));
  return value;
}

/** Every editable art frame counted once by what a reader may say about it: approved, baseline, awaiting review, changes requested. */
export async function artCounts(root, dir) {
  const {files, standing} = await artFrames(root);
  const heads = readHeads(dir);
  const out = {approved: 0, baseline: 0, awaiting: 0, changes_requested: 0, total: 0};
  const undecided = [];
  for (const [key, rel] of files) {
    const head = heads.get(key);
    if (head?.status) out[head.status === 'pending' ? 'awaiting' : head.status]++;
    else if (head && head.head > 0) out.awaiting++; // a saved revision nobody judged
    else if (head?.zero) {
      // a lineage at revision 0: the standing counts only if the stored revision shows the pixels that were judged
      const {standing: s, png} = await standing.judged(rel);
      out[(s === 'approved' || s === 'baseline') && sameImage(head.zero, png) ? s : 'awaiting']++;
    } else undecided.push(rel);
    out.total++;
  }
  // revision 0 with no human decision: what the project's records say about the file's bytes
  for (const [, s] of await standing.ofMany(undecided)) out[s]++;
  return out;
}

/** The master file of an audio asset, its sha256, and the measurements its provenance file records. */
export async function audioDetail(root, asset, {pack, catalog}) {
  const detail = await describeAsset(pack, root, catalog, asset.id, asset.source);
  const master = detail.frames.find(f => f.path.endsWith('.wav'));
  let provenance = null;
  for (const p of detail.provenance) if (p.exists && /provenance[^/]*\.json$/.test(p.path)) { provenance = {path: p.path, data: await readJson(root, p.path)}; break; }
  const data = provenance?.data ?? {};
  return {id: asset.id, source: asset.source, readiness: asset.readiness, master: master?.path ?? null, provenance: provenance?.path ?? null,
    measurements: {master: data.master ?? null, qa: data.qa ?? null}, brief: data.brief ?? null, creator: data.creator ?? data.producer ?? null};
}

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'unsupported_media_type', 'Send application/json');
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) { size += chunk.length; if (size > 4096) throw problem(413, 'too_large', 'Request too large'); chunks.push(chunk); }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw problem(400, 'invalid_json', 'Invalid JSON'); }
}

/** Who submitted a frame (revision 0 of an agent lineage): the submission log record that wrote it. */
async function submissionFor(root, key) {
  const [, assetId] = key.split('/');
  if (!assetId || !idPattern.test(assetId)) return null;
  const {openProject} = await import('../../../mcp/project.mjs');
  const project = openProject(root);
  try {
    const asset = (await project.workspace.snapshot()).index.assets.get(assetId);
    if (!asset?.layout) return null;
    const name = key.split('/').at(-1);
    const record = (await readSubmissions(root, asset)).reverse().find(r => r.frames?.some(f => f.name === name));
    if (!record) return null;
    const clip = (t, n) => (typeof t === 'string' ? t.slice(0, n) : undefined);
    return {agent: record.agent, session: String(record.session ?? '').slice(0, 8), at: record.at, tool: clip(record.tool, 200), generator: clip(record.generator, 300),
      prompt: clip(record.prompt, 500), sourceHash: record.sourceHash, parents: record.parentIds};
  } finally { project.close(); }
}

export async function handle(req, res, url, context) {
  const {prefix} = context;
  const root = realpathSync(context.root); // the core's contained reads compare real paths
  function send(status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  const name = url.pathname.slice(prefix.length);
  const dir = libraryOf(root, context);

  if (name === 'inbox' && ['GET', 'HEAD'].includes(req.method)) {
    // If the editable catalog cannot be read (a trimmed project copy), nothing can claim a standing: every undecided frame stays awaiting review.
    const frames = await artFrames(root).catch(() => null);
    const items = await withStanding(readInbox(dir, {limitDecided: Infinity}), async key => (frames?.files.has(key) ? frames.standing.judged(frames.files.get(key)) : {standing: 'awaiting', png: null}));
    const {list, masters, approvals, pack} = await audioAssets(root);
    const sign = signoffs(dir);
    const audio = [];
    for (const a of list.filter(x => x.readiness !== 'planned')) {
      const hash = masters.get(a.id) ? await hashOf(root, masters.get(a.id)).catch(() => null) : null;
      const history = sign.history(a.id, 1);
      const approval = approvals[a.id] ?? null;
      const status = audioStatus({hash, signoffs: history, approval});
      audio.push({id: a.id, source: a.source, category: a.category, readiness: a.readiness, state: status.state, label: status.label,
        signoff: history[0] ? {ts: history[0].ts, verdict: history[0].verdict, current: history[0].content === hash} : null,
        approval: approval ? {approvalId: approval.approvalId, approvedBy: approval.approvedBy, kind: approval.kind, recorded: approval.recorded, current: !approval.content || approval.content === hash} : null});
    }
    return send(200, {items, audio, artRecords: await readArtApprovals(root, pack.directories.approvals), artCounts: frames ? await artCounts(root, dir).catch(() => null) : null});
  }
  if (name === 'authors' && ['GET', 'HEAD'].includes(req.method)) {
    const key = url.searchParams.get('key') ?? '';
    if (!/^[A-Za-z0-9_./-]{1,200}$/.test(key) || key.includes('..')) throw problem(422, 'invalid_input', 'key is required');
    return send(200, {key, submission: await submissionFor(root, key)});
  }
  if (name === 'audio' && ['GET', 'HEAD'].includes(req.method)) {
    const id = url.searchParams.get('id') ?? '';
    if (!idPattern.test(id)) throw problem(422, 'invalid_input', 'id is required');
    const library = await audioAssets(root);
    const asset = library.list.find(a => a.id === id);
    if (!asset) throw problem(404, 'unknown_asset', 'No audio asset with that id');
    const detail = await audioDetail(root, asset, library);
    let wave = null, hash = null;
    if (detail.master) {
      const stat = await fs.stat(path.join(root, detail.master));
      hash = await hashOf(root, detail.master);
      if (stat.size > maxWavBytes) wave = {error: 'file_too_large'};
      else {
        const cached = wavCache.get(detail.master);
        if (cached?.hash === hash) wave = cached.wave;
        else {
          try { wave = peaks(await readInside(root, detail.master)); } catch (error) { wave = {error: String(error.message).slice(0, 200)}; }
          wavCache.set(detail.master, {hash, wave});
          if (wavCache.size > 24) wavCache.delete(wavCache.keys().next().value);
        }
      }
    }
    const history = signoffs(dir).history(id);
    const approval = library.approvals[id] ?? null;
    const status = audioStatus({hash, signoffs: history, approval});
    return send(200, {...detail, contentHash: hash, wave, signoffs: history, status: {state: status.state, label: status.label},
      approval: approval ? {...approval, current: !approval.content || approval.content === hash} : null});
  }
  if (name === 'audio-signoff') {
    if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'POST only');
    // A browser always sends Sec-Fetch-Site and page script cannot forge it; a command-line client or a
    // tool that forgot it is refused. It raises the bar for an agent, it does not make an agent unable
    // to forge a header: the strong guarantee is that no MCP tool reaches this route.
    if (req.headers['sec-fetch-site'] !== 'same-origin') throw problem(403, 'human_only', 'A listening sign-off must come from the studio page itself');
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['id', 'content', 'verdict', 'note'].includes(k))) throw problem(422, 'invalid_input', 'Unexpected fields');
    if (!idPattern.test(body.id ?? '') || !verdicts.includes(body.verdict) || typeof body.content !== 'string' || !/^[0-9a-f]{64}$/.test(body.content)
      || (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000))) throw problem(422, 'invalid_input', 'id, content (sha256) and verdict are required');
    const library = await audioAssets(root);
    const asset = library.list.find(a => a.id === body.id);
    if (!asset) throw problem(404, 'unknown_asset', 'No audio asset with that id');
    const detail = await audioDetail(root, asset, library);
    if (!detail.master) throw problem(409, 'no_master', 'This audio asset has no master file yet');
    const sha256 = await hashOf(root, detail.master);
    if (sha256 !== body.content) throw problem(409, 'master_changed', 'The master changed since you loaded it; reload and listen again');
    signoffs(dir).record({asset: body.id, content: sha256, verdict: body.verdict, note: body.note ?? ''});
    return send(200, {id: body.id, verdict: body.verdict, content: sha256});
  }
  throw problem(404, 'unknown_route', 'Unknown Review route');
}

/** Forget cached audio listings (tests; the 15 s TTL covers everything else). */
export function clearAudioCache() { libraryCache.clear(); wavCache.clear(); artCache.clear(); }
