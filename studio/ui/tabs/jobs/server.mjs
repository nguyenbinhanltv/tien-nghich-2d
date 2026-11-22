// Jobs tab server routes, read-only, under /api/tabs/jobs/:
//   GET feed?since=N   the MCP server's tool-call feed (/mcp/activity), its job list (/mcp/jobs, when this
//                      server has that route), and the assets and review items each session touched.
// The job runner and the feed live inside the MCP HTTP handler of THIS process; they are read over
// loopback, so this tab needs no access to their internals and nothing here can start, stop or edit a job.
import path from 'node:path';
import { loadPackSync } from '../../../core/pack.mjs';
import { problem } from '../../../server/editor-catalog.mjs';
import { reviewKeys, touchedAssets } from './links.mjs';
import { openStudioDb } from '../../../core/studio-db.mjs';
import { inWindow, quotaConfig, totals } from '../../../core/quota.mjs';

const TIMEOUT_MS = 2000, LINKS_TTL_MS = 8000;
const linkCache = new Map();
const loopback = new Set(['127.0.0.1', '::1']);

export function libraryOf(root, context = {}) {
  return context.libraryDir ?? path.join(root, loadPackSync(root, undefined, {verifyFiles: false}).directories.revisions);
}

async function upstream(address, route) {
  if (!address || !loopback.has(address.address)) throw problem(403, 'forbidden', 'Loopback listener required');
  const host = address.address === '::1' ? '[::1]' : address.address;
  try {
    const res = await fetch(`http://${host}:${address.port}${route}`, {signal: AbortSignal.timeout(TIMEOUT_MS), headers: {Accept: 'application/json'}});
    if (!res.ok) return {status: res.status};
    return {status: 200, body: await res.json()};
  } catch (error) { return {status: 0, error: String(error.message ?? error).slice(0, 120)}; }
}

const STATES = {queued: 'queued', pending: 'queued', waiting: 'queued', running: 'running', active: 'running', succeeded: 'succeeded', success: 'succeeded', completed: 'succeeded',
  complete: 'succeeded', done: 'succeeded', ok: 'succeeded', failed: 'failed', failure: 'failed', error: 'failed', errored: 'failed'};
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/**
 * One job as the tab shows it, from EITHER shape the server may list: the runner's own view
 * ({name, status, owner:{agent, session}, finishedAt, cost:{wallMs}, error:{message}}) or the documented
 * /mcp/jobs one ({tool, state, agent, session, assetId?, endedAt, durationMs, error?}). Unknown fields are
 * dropped, missing ones tolerated, an unknown state is inferred from the timestamps. Results are never kept.
 */
export function shapeJob(j) {
  if (!j || typeof j !== 'object' || typeof j.id !== 'string' || !j.id) return null;
  const startedAt = iso(j.startedAt), finishedAt = iso(j.finishedAt ?? j.endedAt), createdAt = iso(j.createdAt) ?? startedAt ?? new Date(0).toISOString();
  const error = typeof j.error === 'string' ? {message: text(j.error, 300)} : j.error && typeof j.error === 'object' ? {message: text(j.error.message, 300), code: text(j.error.code, 60) || undefined} : null;
  const status = STATES[String(j.state ?? j.status ?? '').toLowerCase()] ?? (finishedAt ? (error ? 'failed' : 'succeeded') : startedAt ? 'running' : 'queued');
  const wall = j.cost?.wallMs ?? j.durationMs;
  return {id: text(j.id, 64), name: text(j.tool ?? j.name, 80) || '?', status,
    owner: {agent: text(j.owner?.agent ?? j.agent, 80), session: text(j.owner?.session ?? j.session, 40)},
    assetId: /^[A-Za-z0-9_.-]{1,64}$/.test(j.assetId ?? '') ? j.assetId : null,
    createdAt, startedAt, finishedAt, wallMs: Number.isFinite(wall) && wall >= 0 ? wall : null, error: status === 'failed' || error ? error ?? {message: ''} : null,
    log: Array.isArray(j.log) ? j.log.slice(-20).map(l => text(String(l), 300)) : [], logLines: Number.isInteger(j.logLines) ? j.logLines : Array.isArray(j.log) ? j.log.length : 0};
}

export async function handle(req, res, url, context) {
  const {root, address, prefix} = context;
  function send(status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The Jobs tab API is read-only');
  const route = url.pathname.slice(prefix.length);
  if (route === 'quota') {
    // Generations and wall time per agent and per kind of work, and the pack's ceiling (quota.mjs). Read-only; the studio knows no prices.
    const config = quotaConfig(loadPackSync(root, undefined, {verifyFiles: false}));
    const db = openStudioDb(libraryOf(root, context));
    try {
      const rows = db.spend();
      const windowed = inWindow(rows, config);
      const t = totals(windowed);
      return send(200, {window: config.window ?? 'all', ceilings: {all: config.ceilings ?? null, perAgent: config.perAgent ?? null, perRun: config.perRun ?? null},
        all: t.all, byAgent: t.byAgent, byKind: t.byKind, byAgentKind: Object.entries(t.byAgentKind).map(([k, v]) => ({agent: k.split('\0')[0], kind: k.split('\0')[1], ...v})),
        recent: windowed.slice(0, 12).map(r => ({at: r.at, agent: r.agent, session: r.session, tool: r.tool, kind: r.kind, generations: r.generations, wallMs: r.wallMs || r.estWallMs, finished: r.wallMs > 0}))});
    } finally { db.close(); }
  }
  if (route !== 'feed') throw problem(404, 'unknown_route', 'Unknown Jobs route');
  const sinceParam = Number(url.searchParams.get('since') ?? 0);
  const since = Number.isSafeInteger(sinceParam) && sinceParam >= 0 ? sinceParam : 0;
  const [activity, jobs] = await Promise.all([upstream(address, `/mcp/activity?since=${since}`), upstream(address, '/mcp/jobs')]);
  if (activity.status !== 200) throw problem(502, 'upstream_unavailable', 'The MCP feed is not reachable on this server');
  const events = activity.body.events.map(e => ({seq: e.seq, ts: e.ts, agent: String(e.agent ?? ''), session: String(e.session ?? ''), scope: e.scope, tool: e.tool, ok: e.ok, ms: e.ms}));
  const jobList = jobs.status === 200 && Array.isArray(jobs.body?.jobs) ? jobs.body.jobs.map(shapeJob).filter(Boolean) : null;
  const seen = new Map();
  for (const x of [...events, ...(jobList ?? []).map(j => ({agent: j.owner.agent, session: j.owner.session}))]) {
    const id = `${x.agent}|${x.session.slice(0, 8)}`;
    if (!seen.has(id) && x.session) seen.set(id, {id, agent: x.agent, session: x.session.slice(0, 8)});
  }
  const pairs = [...seen.values()].slice(0, 40);
  const jobAssetIds = [...new Set((jobList ?? []).map(j => j.assetId).filter(Boolean))].sort();
  let links = {}, jobAssets = {};
  const cacheKey = root + '\0' + pairs.map(p => p.id).sort().join(',') + '\0' + jobAssetIds.join(',');
  const cached = linkCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LINKS_TTL_MS) ({links, jobAssets} = cached);
  else if (pairs.length || jobAssetIds.length) {
    const dir = libraryOf(root, context);
    const {openProject} = await import('../../../mcp/project.mjs');
    const project = openProject(root);
    try {
      const index = (await project.workspace.snapshot()).index;
      const [assets, reviews] = [await touchedAssets(root, dir, index, pairs), reviewKeys(dir, pairs)];
      for (const p of pairs) links[p.id] = {assets: assets.get(p.id) ?? [], reviews: reviews.get(p.id) ?? []};
      // the category lets the page send each asset to the tab that owns it; an id the catalog does not know gets no link
      jobAssets = Object.fromEntries(jobAssetIds.filter(id => index.assets.has(id)).map(id => [id, index.assets.get(id).category]));
    } finally { project.close(); }
    linkCache.set(cacheKey, {at: Date.now(), links, jobAssets});
    if (linkCache.size > 8) linkCache.delete(linkCache.keys().next().value);
  }
  return send(200, {now: Date.now(), activity: {events, next: activity.body.next}, jobs: {available: jobList !== null, status: jobs.status, items: jobList ?? []}, links, jobAssets});
}
