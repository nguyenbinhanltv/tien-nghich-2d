// E9.3 CLI. node tools/perf-budget.ts [--no-enforce] [--json]
// Measures the sim step on this machine: an empty room, a half load and the full stress of perf-budget.json, then judges the full stress.
import { checkLimits, judge, measureStep, readBudget } from './lib/perf-budget.ts';

const argv = process.argv.slice(2);
const b = readBudget(), s = b.sim.stress;
const rows = [
  { name: 'empty room', shots: 0, mobs: 0 },
  { name: 'half load', shots: s.projectiles / 2, mobs: Math.floor(s.mobs / 2) },
  { name: 'FULL stress', shots: s.projectiles, mobs: s.mobs },
].map((r) => ({ ...r, t: measureStep(r.shots, r.mobs, s.ticks, s.warmupTicks) }));
const problems = [...checkLimits(b), ...judge(b, rows[2]!.t)];
if (argv.includes('--json')) console.log(JSON.stringify({ budget: b.sim, rows, problems }, null, 1));
else {
  console.log('sim step (ms)      shots mobs    p50    p95    p99    max');
  for (const r of rows) console.log(`${r.name.padEnd(18)} ${String(r.shots).padStart(5)} ${String(r.mobs).padStart(4)} ${r.t.p50.toFixed(3).padStart(6)} ${r.t.p95.toFixed(3).padStart(6)} ${r.t.p99.toFixed(3).padStart(6)} ${r.t.max.toFixed(3).padStart(6)}`);
  console.log(`budget: p95 <= ${b.sim.stepP95Ms} ms, max <= ${b.sim.stepMaxMs} ms (full stress). Headroom at p95: x${(b.sim.stepP95Ms / Math.max(rows[2]!.t.p95, 1e-6)).toFixed(1)}`);
  for (const p of problems) console.error(`${argv.includes('--no-enforce') ? 'warning' : 'ERROR'}: ${p}`);
  console.log(problems.length ? 'perf-budget: OVER BUDGET' : 'perf-budget OK');
}
process.exit(problems.length && !argv.includes('--no-enforce') ? 1 : 0);
