// A small in-process job runner for work too slow to answer inline. A job is an async function that
// may log; it runs on the event loop (cooperative: long loops should `await yieldToLoop()`), so a
// CPU-heavy job needs a worker thread, which this interface leaves room for without changing callers.
// Jobs are memory-only and die with the process; the runner keeps the most recent finished jobs.
import { randomBytes } from 'node:crypto';

const MAX_LOG_LINES = 200, MAX_LOG_LINE = 500;

export class JobRunner {
  #jobs = new Map();
  #waiters = new Map();
  #keep;
  #running = 0;
  #maxRunning;
  #queue = [];

  constructor({keep = 100, maxRunning = 4} = {}) { this.#keep = keep; this.#maxRunning = maxRunning; }

  /** Start (or queue) a job. `run({log})` resolves to the result, which must be JSON-serialisable. `meta` is shown with the job ({assetId}). */
  submit({name, owner, meta = {}, run}) {
    const job = {id: 'job-' + randomBytes(5).toString('hex'), name, owner, meta, status: 'queued', createdAt: new Date().toISOString(),
      startedAt: null, finishedAt: null, log: [], result: undefined, error: undefined, cost: {wallMs: 0, approxCpuMs: 0}};
    this.#jobs.set(job.id, {job, run});
    this.#queue.push(job.id);
    this.#evict();
    queueMicrotask(() => this.#pump());
    return this.view(job.id);
  }

  #pump() {
    while (this.#running < this.#maxRunning && this.#queue.length) {
      const entry = this.#jobs.get(this.#queue.shift());
      if (!entry) continue;
      this.#running++;
      void this.#execute(entry).finally(() => { this.#running--; this.#pump(); });
    }
  }

  async #execute({job, run}) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const t0 = performance.now(), c0 = process.cpuUsage();
    const log = line => {
      job.log.push(`${new Date().toISOString().slice(11, 23)} ${String(line).slice(0, MAX_LOG_LINE)}`);
      if (job.log.length > MAX_LOG_LINES) job.log.shift();
    };
    try {
      job.result = await run({log});
      job.status = 'succeeded';
    } catch (error) {
      job.status = 'failed';
      job.error = {message: String(error?.message ?? error).slice(0, 1000), code: error?.code};
      log(`failed: ${job.error.message}`);
    }
    const cpu = process.cpuUsage(c0);
    job.cost = {wallMs: Math.round(performance.now() - t0), approxCpuMs: Math.round((cpu.user + cpu.system) / 1000)};
    job.finishedAt = new Date().toISOString();
    for (const done of this.#waiters.get(job.id) ?? []) done();
    this.#waiters.delete(job.id);
  }

  #evict() {
    const finished = [...this.#jobs.values()].filter(e => e.job.finishedAt).sort((a, b) => a.job.finishedAt < b.job.finishedAt ? -1 : 1);
    while (finished.length > this.#keep) this.#jobs.delete(finished.shift().job.id);
  }

  has(id) { return this.#jobs.has(id); }

  /** Public view of a job: everything except the raw result unless asked for it. */
  view(id, {withResult = false, tail = 20} = {}) {
    const entry = this.#jobs.get(id);
    if (!entry) return null;
    const {job} = entry;
    const out = {id: job.id, name: job.name, status: job.status, owner: job.owner, createdAt: job.createdAt, startedAt: job.startedAt,
      finishedAt: job.finishedAt, cost: job.cost, log: job.log.slice(-tail), logLines: job.log.length};
    if (job.error) out.error = job.error;
    if (withResult && job.status === 'succeeded') out.result = job.result;
    return out;
  }

  /** Resolve when the job leaves queued/running, or after `timeoutMs` (the view then says it is still running). */
  async wait(id, timeoutMs) {
    const entry = this.#jobs.get(id);
    if (!entry) return null;
    if (!entry.job.finishedAt) {
      await new Promise(resolve => {
        const timer = setTimeout(() => { list.delete(done); resolve(); }, timeoutMs);
        const done = () => { clearTimeout(timer); resolve(); };
        const list = this.#waiters.get(id) ?? new Set();
        list.add(done);
        this.#waiters.set(id, list);
      });
    }
    return this.view(id, {withResult: true});
  }

  list() { return [...this.#jobs.values()].map(e => this.view(e.job.id)); }

  /**
   * What a Jobs tab shows: one summary per job, newest first, at most `limit`. Views only: no result, no payload,
   * no log lines; `error` is the failure message alone.
   */
  summaries(limit = 50) {
    const rows = [...this.#jobs.values()].map(e => e.job).reverse();
    return rows.slice(0, limit).map(job => ({
      id: job.id, tool: job.name, state: job.status, agent: job.owner?.agent ?? null, session: job.owner?.session ?? null,
      ...(job.meta?.assetId ? {assetId: job.meta.assetId} : {}), createdAt: job.createdAt, startedAt: job.startedAt, endedAt: job.finishedAt,
      durationMs: job.finishedAt ? job.cost.wallMs : job.startedAt ? Math.round(Date.now() - Date.parse(job.startedAt)) : null,
      ...(job.error ? {error: job.error.message} : {}),
    }));
  }
}
