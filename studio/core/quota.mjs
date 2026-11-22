// A quota estimate before a run (D7). The studio does not know prices: it counts GENERATIONS (one call of an image tool, one run of a
// toolchain) and WALL TIME, per agent and per kind of work, from what it recorded. The pack may set a ceiling (in the Jobs tab's
// pack block, `ui.tabs.jobs.quota`); a run that would pass it is refused BEFORE it starts. An image tool runs outside the studio, so
// for that kind the studio can only answer "may I?" (studio_job_status plan) and record what a candidate run declared.
//
//   quota: {window: 'day' | 'all',                          'day' = the last 24 hours (default 'all')
//           ceilings: {generations?: n, wallMs?: n},       all agents together
//           perAgent: {generations?: n, wallMs?: n},       each agent
//           perRun:   {generations?: n},                   one run at once
//           defaultWallMs?: n}                              the guess for a tool with no history (default 5000)
export const KINDS = ['image-tool', 'toolchain'];
/** Tools the studio itself runs that call a toolchain; each run is one generation. Everything else is not counted. */
export const TOOLCHAIN_TOOLS = Object.freeze(['studio_generator_run', 'studio_vfx_build', 'studio_pack']);

/** A tool name with or without the `studio_` prefix (inlineOrJob names a job by the short name). */
export const kindOfTool = name => (typeof name === 'string' && TOOLCHAIN_TOOLS.includes(name.startsWith('studio_') ? name : 'studio_' + name) ? 'toolchain' : null);
/** The pack's quota block with anything that is not a non-negative whole number dropped, so a typo can never turn a ceiling into a comparison with text. */
export function quotaConfig(pack) {
  const raw = pack.ui?.tabs?.jobs?.quota;
  if (!raw || typeof raw !== 'object') return {};
  const n = v => (Number.isSafeInteger(v) && v >= 0 ? v : undefined);
  const block = o => { const out = {}; for (const k of ['generations', 'wallMs']) if (n(o?.[k]) !== undefined) out[k] = o[k]; return Object.keys(out).length ? out : undefined; };
  return {window: raw.window === 'day' ? 'day' : 'all', ceilings: block(raw.ceilings), perAgent: block(raw.perAgent), perRun: n(raw.perRun?.generations) !== undefined ? {generations: raw.perRun.generations} : undefined,
    defaultWallMs: n(raw.defaultWallMs)};
}

const sum = (rows, f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Spend rows inside the configured window. */
export function inWindow(rows, config, nowMs = Date.now()) {
  if (config.window !== 'day') return rows;
  return rows.filter(r => nowMs - Date.parse(r.at) < 24 * 3600 * 1000);
}

/**
 * The estimate for a run: how many generations and how long. Wall time is the median of the finished runs of the same tool;
 * with none it is the pack's guess, and the estimate says so.
 */
export function estimate({kind, tool, generations, wallMs, rows, config}) {
  const done = rows.filter(r => r.tool === tool && r.wallMs > 0).map(r => r.wallMs / Math.max(1, r.generations));
  const perGeneration = median(done);
  const basis = wallMs !== undefined ? 'stated by the caller' : perGeneration !== null ? `median of ${done.length} earlier run(s) of ${tool}` : 'the pack default (no earlier run of this tool)';
  const perOne = perGeneration ?? config.defaultWallMs ?? 5000;
  return {kind, tool: tool ?? null, generations, wallMs: wallMs ?? Math.round(perOne * generations), basis};
}

/** Totals per agent and per kind of work, in the window. */
export function totals(rows) {
  const out = {all: {generations: 0, wallMs: 0}, byAgent: {}, byKind: {}, byAgentKind: {}};
  for (const r of rows) {
    const add = (o, k) => { o[k] ??= {generations: 0, wallMs: 0, runs: 0}; o[k].generations += r.generations; o[k].wallMs += r.wallMs || r.estWallMs || 0; o[k].runs++; };
    out.all.generations += r.generations; out.all.wallMs += r.wallMs || r.estWallMs || 0;
    add(out.byAgent, r.agent); add(out.byKind, r.kind); add(out.byAgentKind, `${r.agent}\0${r.kind}`);
  }
  return out;
}

/** May this run start? {allowed, reasons[], used, ceilings, estimate}. Counts what was recorded, plus this run's estimate. */
export function check({config, rows, agent, est, nowMs = Date.now()}) {
  const windowed = inWindow(rows, config, nowMs);
  const mine = windowed.filter(r => r.agent === agent);
  const used = {all: totals(windowed).all, agent: totals(mine).all};
  const reasons = [];
  const over = (label, have, add, cap, unit) => { if (cap !== undefined && have + add > cap) reasons.push(`${label}: ${have} used + ${add} for this run > ${cap} ${unit}`); };
  over('all agents, generations', used.all.generations, est.generations, config.ceilings?.generations, 'generations');
  over('all agents, wall time', used.all.wallMs, est.wallMs, config.ceilings?.wallMs, 'ms');
  over(`agent ${agent}, generations`, used.agent.generations, est.generations, config.perAgent?.generations, 'generations');
  over(`agent ${agent}, wall time`, used.agent.wallMs, est.wallMs, config.perAgent?.wallMs, 'ms');
  if (config.perRun?.generations !== undefined && est.generations > config.perRun.generations) reasons.push(`this run: ${est.generations} generations > ${config.perRun.generations} allowed per run`);
  return {allowed: !reasons.length, reasons, used, ceilings: {all: config.ceilings ?? null, perAgent: config.perAgent ?? null, perRun: config.perRun ?? null, window: config.window ?? 'all'}, estimate: est};
}
