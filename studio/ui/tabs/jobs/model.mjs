// Pure helpers for the Jobs tab: route state, durations, grouping calls into sessions, filters.
export const states = ['all', 'running', 'failed', 'done'];
export const POLL_MS = 2000;
const idPattern = /^[A-Za-z0-9_.-]{1,64}$/;

export function parseRoute(route = {}) {
  const p = route.params ?? {};
  return {
    job: route.asset && /^job-[0-9a-f]{4,16}$/.test(route.asset) ? route.asset : null,
    state: states.includes(p.state) ? p.state : 'all',
    tool: typeof p.tool === 'string' && idPattern.test(p.tool) ? p.tool : null,
    session: typeof p.session === 'string' && /^[A-Za-z0-9._|-]{1,60}$/.test(p.session) ? p.session : null
  };
}

export function stateParams(s) {
  const out = {};
  if (s.state !== 'all') out.state = s.state;
  if (s.tool) out.tool = s.tool;
  if (s.session) out.session = s.session;
  return out;
}

/** queued | running | failed | done: the four things a person asks about a job. */
export const jobPhase = job => (job.status === 'queued' ? 'queued' : job.status === 'running' ? 'running' : job.status === 'failed' ? 'failed' : 'done');

const at = iso => (iso ? Date.parse(iso) : NaN);

/** Wall time of a job in ms: recorded when finished, live while running, time waiting while queued. */
export function durationMs(job, now) {
  if (job.finishedAt) return job.wallMs ?? Math.max(0, at(job.finishedAt) - at(job.startedAt ?? job.createdAt));
  if (job.startedAt) return Math.max(0, now - at(job.startedAt));
  return Math.max(0, now - at(job.createdAt));
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '–';
  if (ms < 1000) return Math.round(ms) + ' ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' s';
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} m ${Math.round(s - m * 60)} s` : `${Math.floor(m / 60)} h ${m % 60} m`;
}

export const sessionId = x => `${x.agent}|${String(x.session).slice(0, 8)}`;

export function visibleJobs(jobs, s, now = 0) {
  return jobs.filter(j => (s.state === 'all' || (s.state === 'running' ? ['queued', 'running'].includes(j.status) : s.state === 'failed' ? j.status === 'failed' : j.status === 'succeeded'))
    && (!s.tool || j.name === s.tool) && (!s.session || sessionId(j.owner) === s.session))
    .sort((a, b) => (Number(['queued', 'running'].includes(b.status)) - Number(['queued', 'running'].includes(a.status))) || (a.createdAt < b.createdAt ? 1 : -1));
}

/** One card per (agent, session): last call, how many, how many failed, running jobs. Most recent first. */
export function groupSessions(events, jobs) {
  const map = new Map();
  const slot = x => { const id = sessionId(x); if (!map.has(id)) map.set(id, {id, agent: x.agent, session: String(x.session).slice(0, 8), calls: 0, failures: 0, lastTs: '', tools: {}, running: 0, jobs: 0}); return map.get(id); };
  for (const e of events) { const g = slot(e); g.calls++; if (!e.ok) g.failures++; if (e.ts > g.lastTs) g.lastTs = e.ts; g.tools[e.tool] = (g.tools[e.tool] ?? 0) + 1; }
  for (const j of jobs) { const g = slot(j.owner); g.jobs++; if (['queued', 'running'].includes(j.status)) g.running++; if ((j.startedAt ?? j.createdAt) > g.lastTs) g.lastTs = j.startedAt ?? j.createdAt; }
  return [...map.values()].sort((a, b) => (b.running - a.running) || (a.lastTs < b.lastTs ? 1 : -1));
}

export function visibleEvents(events, s) {
  return events.filter(e => (!s.tool || e.tool === s.tool) && (!s.session || sessionId(e) === s.session)
    && (s.state === 'all' || (s.state === 'failed' ? !e.ok : s.state === 'done' ? e.ok : false))).slice().reverse();
}

/** Merge a poll into the local event list: a restart (cursor went backwards) clears it first. */
export function mergeEvents(local, since, data, keep = 300) {
  const base = data.next < since ? [] : local;
  return base.concat(data.events.filter(e => !base.some(b => b.seq === e.seq))).slice(-keep);
}

export const counts = (jobs, events) => ({
  running: jobs.filter(j => j.status === 'running').length, queued: jobs.filter(j => j.status === 'queued').length,
  failed: jobs.filter(j => j.status === 'failed').length, calls: events.length, failedCalls: events.filter(e => !e.ok).length
});
