// Jobs tab server routes, read-only, under /api/tabs/jobs/:
//   GET feed?since=N   the MCP server's tool-call feed (/mcp/activity), its job list (/mcp/jobs, when this
//                      server has that route), and the assets and review items each session touched.
// The job runner and the feed live inside the MCP HTTP handler of THIS process; they are read over
// loopback, so this tab needs no access to their internals and nothing here can start, stop or edit a job.
import path from 'node:path';
import { loadPackSync } from '../../../core/pack.mjs';
import { problem } from '../../../server/editor-catalog.mjs';
import { reviewKeys, touchedAssets } from './links.mjs';

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

/** Trim a job view to what the tab shows: no result payloads, bounded log. */
export function shapeJob(job) {
  return {id: job.id, name: job.name, status: job.status, owner: {agent: String(job.owner?.agent ?? ''), session: String(job.owner?.session ?? '')},
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, wallMs: job.cost?.wallMs ?? null,
    error: job.error ? {message: String(job.error.message ?? '').slice(0, 300), code: job.error.code} : null,
    log: (job.log ?? []).slice(-20).map(l => String(l).slice(0, 300)), logLines: job.logLines ?? 0};
}

export async function handle(req, res, url, context) {
  const {root, address, prefix} = context;
  function send(status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    res.end(JSON.stringify(data));
  }
  if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'method_not_allowed', 'The Jobs tab API is read-only');
  if (url.pathname.slice(prefix.length) !== 'feed') throw problem(404, 'unknown_route', 'Unknown Jobs route');
  const sinceParam = Number(url.searchParams.get('since') ?? 0);
  const since = Number.isSafeInteger(sinceParam) && sinceParam >= 0 ? sinceParam : 0;
  const [activity, jobs] = await Promise.all([upstream(address, `/mcp/activity?since=${since}`), upstream(address, '/mcp/jobs')]);
  if (activity.status !== 200) throw problem(502, 'upstream_unavailable', 'The MCP feed is not reachable on this server');
  const events = activity.body.events.map(e => ({seq: e.seq, ts: e.ts, agent: String(e.agent ?? ''), session: String(e.session ?? ''), scope: e.scope, tool: e.tool, ok: e.ok, ms: e.ms}));
  const jobList = jobs.status === 200 ? jobs.body.jobs.map(shapeJob) : null;
  const seen = new Map();
  for (const x of [...events, ...(jobList ?? []).map(j => ({agent: j.owner.agent, session: j.owner.session}))]) {
    const id = `${x.agent}|${x.session.slice(0, 8)}`;
    if (!seen.has(id) && x.session) seen.set(id, {id, agent: x.agent, session: x.session.slice(0, 8)});
  }
  const pairs = [...seen.values()].slice(0, 40);
  let links = {};
  const cacheKey = root + '\0' + pairs.map(p => p.id).sort().join(',');
  const cached = linkCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LINKS_TTL_MS) links = cached.links;
  else if (pairs.length) {
    const dir = libraryOf(root, context);
    const {openProject} = await import('../../../mcp/project.mjs');
    const project = openProject(root);
    try {
      const index = (await project.workspace.snapshot()).index;
      const [assets, reviews] = [await touchedAssets(root, dir, index, pairs), reviewKeys(dir, pairs)];
      for (const p of pairs) links[p.id] = {assets: assets.get(p.id) ?? [], reviews: reviews.get(p.id) ?? []};
    } finally { project.close(); }
    linkCache.set(cacheKey, {at: Date.now(), links});
    if (linkCache.size > 8) linkCache.delete(linkCache.keys().next().value);
  }
  return send(200, {now: Date.now(), activity: {events, next: activity.body.next}, jobs: {available: jobList !== null, status: jobs.status, items: jobList ?? []}, links});
}
