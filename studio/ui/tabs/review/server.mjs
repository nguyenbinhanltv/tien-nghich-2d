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
import { openWorkspace } from '../../../core/workspace.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { listRuns, runSheet } from '../../../core/candidates.mjs';
import { addRegionRequest, pickCandidate } from './human.mjs';
import { decodeRgba } from '../../../core/png.mjs';
import { readInbox, readHeads, withStanding } from './inbox.mjs';
import { openSignoffs, verdicts } from './signoff.mjs';
import { peaks, maxWavBytes } from './wav.mjs';
import { hashOf } from './hashes.mjs';
import { audioStatus } from './status.mjs';
import { readApprovals } from './approvals.mjs';
import { readArtApprovals } from './art-approvals.mjs';
import { createCache } from './cache.mjs';
import { evidenceView, lineupImageOf } from './evidence.mjs';
import { criteriaOf } from '../../../core/rubric.mjs';
import { createHash } from 'node:crypto';

const handles = new Map();
const wavCache = new Map();
const idPattern = /^[A-Za-z0-9_.-]{1,64}$/;

/** The revision library: a custom one when the host passes `libraryDir`, else the pack's default. */
export function libraryOf(root, context = {}) {
  return context.libraryDir ?? path.join(root, loadPackSync(root, undefined, {verifyFiles: false}).directories.revisions);
}

const signoffs = dir => { if (!handles.has(dir)) handles.set(dir, openSignoffs(dir)); return handles.get(dir); };

// Both listings are rebuilt in the background once they are 15 s old (the old copy is served meanwhile), shared by concurrent callers.
const LIBRARY_TTL_MS = 15000;
const libraryCache = createCache({ttlMs: LIBRARY_TTL_MS, staleMs: 120000});
const artCache = createCache({ttlMs: LIBRARY_TTL_MS, staleMs: 120000});
// One standing resolver per project for the life of the process: it re-checks every file by size and mtime on each call, so keeping it
// is safe, and it keeps the sha256 of thousands of frames instead of rehashing them every time the 15 s listing is rebuilt.
const standings = new Map();
const standingOf = (root, pack) => {
  const id = root + '\0' + JSON.stringify([pack.review ?? null, pack.directories.approvals ?? null]);
  if (!standings.has(id)) standings.set(id, createStanding(root, {review: pack.review, approvalsDir: pack.directories.approvals}));
  return standings.get(id);
};

/** The audio assets, their master paths and the project's earlier approvals (describing 46 assets is not free). */
function audioAssets(root) {
  return libraryCache.get(root, async () => {
    const pack = await loadPack(root);
    const catalog = await buildCatalog(pack, root);
    const sources = pack.catalog.sources.filter(s => s.kind === 'audio-plan');
    const ids = new Set(sources.map(s => s.id));
    const list = catalog.assets.filter(a => ids.has(a.source));
    const masters = new Map();
    const described = await Promise.all(list.filter(a => a.readiness !== 'planned').map(async a => [a.id, (await describeAsset(pack, root, catalog, a.id, a.source)).frames.find(f => f.path.endsWith('.wav'))?.path ?? null]));
    for (const [id, master] of described) masters.set(id, master);
    const approvals = await readApprovals(root, sources.find(s => s.evidence?.masters)?.evidence.masters);
    return {pack, catalog, list, masters, approvals};
  });
}

/**
 * The editable art frames (key -> project-relative PNG) and the standing resolver, cached like the audio listing.
 * Used for the inbox's revision-0 items and for the tab's count of every art frame by state.
 */
function artFrames(root) {
  return artCache.get(root, async () => {
    const pack = await loadPack(root);
    const editable = await loadEditableCatalog(pack, root);
    return {files: new Map([...editable.frames].map(([key, f]) => [key, f.processed])), standing: standingOf(root, pack)};
  });
}

/** Every editable art frame counted once by what a reader may say about it: approved, baseline, awaiting review, changes requested. */
export async function artCounts(root, dir, loaded) {
  const {files, standing} = loaded ?? await artFrames(root);
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
  for await (const chunk of req.iterator({destroyOnReturn: false})) { size += chunk.length; if (size > 8192) throw problem(413, 'too_large', 'Request too large'); chunks.push(chunk); }
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
    const record = (await readSubmissions(root, asset)).reverse().find(r => r.kind !== 'take' && r.frames?.some(f => f.name === name));
    if (!record) return null;
    const clip = (t, n) => (typeof t === 'string' ? t.slice(0, n) : undefined);
    return {agent: record.agent, session: String(record.session ?? '').slice(0, 8), at: record.at, tool: clip(record.tool, 200), generator: clip(record.generator, 300),
      prompt: clip(record.prompt, 500), sourceHash: record.sourceHash, parents: record.parentIds};
  } finally { project.close(); }
}


/** The inbox: every art lineage and audio asset with its state, art counts and art approval records. Reads only. */
async function buildInbox(root, dir, library, frames) {
  // If the editable catalog cannot be read (a trimmed project copy), nothing can claim a standing: every undecided frame stays awaiting review.
  const items = await withStanding(readInbox(dir, {limitDecided: Infinity}), async key => (frames?.files.has(key) ? frames.standing.judged(frames.files.get(key)) : {standing: 'awaiting', png: null}));
  const {list, masters, approvals, pack} = library;
  const sign = signoffs(dir);
  const [artRecords, artCountsNow, audio] = await Promise.all([
    readArtApprovals(root, pack.directories.approvals),
    frames ? artCounts(root, dir, frames).catch(() => null) : null,
    Promise.all(list.filter(x => x.readiness !== 'planned').map(async a => {
      const hash = masters.get(a.id) ? await hashOf(root, masters.get(a.id)).catch(() => null) : null;
      const history = sign.history(a.id, 1);
      const approval = approvals[a.id] ?? null;
      const status = audioStatus({hash, signoffs: history, approval});
      return {id: a.id, source: a.source, category: a.category, readiness: a.readiness, state: status.state, label: status.label,
        signoff: history[0] ? {ts: history[0].ts, verdict: history[0].verdict, current: history[0].content === hash} : null,
        approval: approval ? {approvalId: approval.approvalId, approvedBy: approval.approvedBy, kind: approval.kind, recorded: approval.recorded, current: !approval.content || approval.content === hash} : null};
    }))
  ]);
  return {items, audio, artRecords, artCounts: artCountsNow};
}

const stampOf = async file => { try { const s = await fs.stat(file); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
const MEMO_MS = 2000; // the longest a finished inbox is reused when no watched file changed (frame and master files are not watched, so this bounds how late they show)
const inboxMemo = new Map();
const inboxFlight = new Map();

/**
 * The inbox response body, computed once per change. A caller gets the memo while the files that decide an answer (the review database and
 * its journal, the sign-off database, the two approval records, the cached listings) are unchanged and the memo is under MEMO_MS old;
 * callers that arrive while one is being computed share it instead of starting their own. Returns {body, source: hit | miss | shared}.
 */
async function inboxBody(root, dir) {
  const library = await audioAssets(root);
  const frames = await artFrames(root).catch(() => null);
  const {pack} = library;
  const masters = pack.catalog.sources.find(s => s.kind === 'audio-plan' && s.evidence?.masters)?.evidence.masters;
  const stamps = await Promise.all([...['editor.sqlite', 'editor.sqlite-wal', 'studio.sqlite', 'studio.sqlite-wal'].map(f => stampOf(path.join(dir, f))),
    pack.directories.approvals ? stampOf(path.join(root, pack.directories.approvals, 'art_approvals.json')) : '-',
    masters ? stampOf(path.join(root, masters, 'listening_approvals.json')) : '-']);
  const fingerprint = [dir, libraryCache.version(root), artCache.version(root), ...stamps].join('|');
  const memo = inboxMemo.get(root);
  if (memo?.fingerprint === fingerprint && Date.now() - memo.at < MEMO_MS) return {body: memo.body, source: 'hit'};
  const flightKey = root + '\0' + fingerprint;
  const running = inboxFlight.get(flightKey);
  if (running) return {body: await running, source: 'shared'};
  const work = buildInbox(root, dir, library, frames).then(data => JSON.stringify(data));
  inboxFlight.set(flightKey, work);
  try {
    const body = await work;
    inboxMemo.set(root, {fingerprint, at: Date.now(), body});
    return {body, source: 'miss'};
  } finally { inboxFlight.delete(flightKey); }
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
    const started = performance.now();
    const {body, source} = await inboxBody(root, dir);
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Server-Timing': `total;dur=${(performance.now() - started).toFixed(1)};desc="${source}"`});
    return res.end(body);
  }
  if (name === 'authors' && ['GET', 'HEAD'].includes(req.method)) {
    const key = url.searchParams.get('key') ?? '';
    if (!/^[A-Za-z0-9_./-]{1,200}$/.test(key) || key.includes('..')) throw problem(422, 'invalid_input', 'key is required');
    return send(200, {key, submission: await submissionFor(root, key)});
  }
  if (['evidence', 'lineup-image'].includes(name) && ['GET', 'HEAD'].includes(req.method)) {
    // What an agent attached to its review request (the weighed rubric, the lineup verdict and picture). Reads only; it decides nothing.
    const key = url.searchParams.get('key') ?? '';
    if (!/^[A-Za-z0-9_./-]{1,200}$/.test(key) || key.includes('..')) throw problem(422, 'invalid_input', 'key is required');
    const ws = openWorkspace(root, {indexer: loadAssetIndex, libraryDir: dir});
    try {
      const events = (await ws.db()).events(key);
      if (name === 'evidence') {
        const revision = Number(url.searchParams.get('revision'));
        return send(200, evidenceView({key, revision: Number.isInteger(revision) ? revision : null, criteria: criteriaOf(await loadPack(root)), events}));
      }
      // The picture is read only from where the agent tool saves it (<library>/work/<asset>/lineup/*.png) and only if it still has the recorded hash.
      const stored = lineupImageOf(events);
      const real = async f => fs.realpath(f).catch(() => null);
      const abs = stored ? await real(path.resolve(root, stored.image)) : null;
      const lineupDir = await real(path.join(dir, 'work', key.split('/')[1] ?? '', 'lineup'));
      if (!abs || !lineupDir || path.dirname(abs) !== lineupDir || !abs.endsWith('.png')) throw problem(404, 'no_lineup', 'No lineup picture for this frame');
      const bytes = await fs.readFile(abs).catch(() => null);
      let ok = false;
      try { ok = bytes && bytes.length <= 4 * 1024 * 1024 && createHash('sha256').update(bytes).digest('hex') === stored.sha256 && Boolean(decodeRgba(bytes)); } catch { /* not a PNG */ }
      if (!ok) throw problem(404, 'no_lineup', 'The lineup picture is missing or changed since it was recorded');
      res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      return res.end(bytes);
    } finally { ws.close(); }
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
  if (['candidates', 'candidate-sheet', 'candidate-reference', 'regions'].includes(name) && ['GET', 'HEAD'].includes(req.method)) {
    const ws = openWorkspace(root, {indexer: loadAssetIndex, libraryDir: dir});
    try {
      if (name === 'candidates') return send(200, {runs: await listRuns(ws, {asset: url.searchParams.get('asset') ?? undefined, limit: 30})});
      if (name === 'regions') {
        const key = url.searchParams.get('key') ?? '';
        if (!/^[A-Za-z0-9_./-]{1,200}$/.test(key) || key.includes('..')) throw problem(422, 'invalid_input', 'key is required');
        return send(200, {key, requests: (await ws.db()).changeRequests(key)});
      }
      const run = url.searchParams.get('run') ?? '';
      if (!/^cand-[0-9a-f]{8}$/.test(run)) throw problem(422, 'invalid_input', 'run is required');
      const png = res2 => { res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': res2.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(res2); };
      if (name === 'candidate-sheet') {
        const scale = Math.min(8, Math.max(1, Number(url.searchParams.get('scale')) || 4));
        return png((await runSheet(ws, run, {scale})).sheet.png);
      }
      const [r] = (await ws.db()).candidateRuns({run});
      if (!r?.reference) throw problem(404, 'no_reference', 'This run has no reference picture');
      const bytes = await readInside(root, r.reference).catch(() => null);
      let ok = false;
      try { decodeRgba(bytes); ok = bytes.length <= 4 * 1024 * 1024; } catch { /* not a PNG */ }
      if (!ok) throw problem(404, 'no_reference', 'The reference is not a readable PNG');
      return png(bytes);
    } finally { ws.close(); }
  }
  if (['candidate-pick', 'region-request', 'take-select'].includes(name)) {
    if (req.method !== 'POST') throw problem(405, 'method_not_allowed', 'POST only');
    // A person's act. A browser always sends Sec-Fetch-Site and page script cannot forge it; no MCP tool reaches this route.
    if (req.headers['sec-fetch-site'] !== 'same-origin') throw problem(403, 'human_only', 'This must come from the studio page itself');
    const body = await readBody(req);
    const ws = openWorkspace(root, {indexer: loadAssetIndex, libraryDir: dir});
    try {
      if (name === 'take-select') {
        if (!body || Object.keys(body).some(k => !['key', 'revision'].includes(k)) || typeof body.key !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(body.key) || body.key.includes('..') || !Number.isInteger(body.revision)) throw problem(422, 'invalid_input', 'key and revision are required');
        const store = await ws.store();
        if (store.needsBaseline(body.key)) throw problem(409, 'no_history', 'This frame has no revision history yet');
        const snap = store.operate({info: {key: body.key}, metadata: {}}, Buffer.alloc(0), 'select', {revision: body.revision});
        return send(200, {key: body.key, takes: snap.takes, note: 'Selected only. The file the project uses did not change.'});
      }
      if (name === 'candidate-pick') {
        if (!body || Object.keys(body).some(k => !['run', 'label'].includes(k)) || !/^cand-[0-9a-f]{8}$/.test(body.run ?? '') || typeof body.label !== 'string') throw problem(422, 'invalid_input', 'run and label are required');
        return send(200, await pickCandidate(ws, body.run, body.label));
      }
      if (!body || Object.keys(body).some(k => !['key', 'revision', 'x', 'y', 'w', 'h', 'text'].includes(k)) || typeof body.key !== 'string' || !/^[A-Za-z0-9_./-]{1,200}$/.test(body.key) || body.key.includes('..')
        || !Number.isInteger(body.revision) || body.revision < 0) throw problem(422, 'invalid_input', 'key, revision, x, y, w, h and text are required');
      let baseline = null;
      if ((await ws.store()).needsBaseline(body.key)) {
        const rel = (await artFrames(root)).files.get(body.key);
        if (!rel) throw problem(404, 'unknown_frame', 'Frame is outside the editable catalog');
        baseline = await readInside(root, rel);
      }
      return send(200, await addRegionRequest({ws, key: body.key, revision: body.revision, box: {x: body.x, y: body.y, w: body.w, h: body.h}, text: body.text, baseline}));
    } finally { ws.close(); }
  }
  throw problem(404, 'unknown_route', 'Unknown Review route');
}

/** Forget cached listings, standings and finished inboxes (tests; the TTLs cover everything else). */
export function clearAudioCache() { libraryCache.clear(); wavCache.clear(); artCache.clear(); standings.clear(); inboxMemo.clear(); inboxFlight.clear(); }
