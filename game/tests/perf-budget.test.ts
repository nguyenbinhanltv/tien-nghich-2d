import { describe, expect, it } from 'vitest';
import { checkLimits, judge, measureStep, readBudget } from '../tools/lib/perf-budget.ts';

describe('E9.3 perf budget', () => {
  const b = readBudget();
  it('the plan numbers are in the budget file: 1,500 shots, 60 actors, 4 ms', () => {
    expect(b.sim.stress.projectiles).toBe(1500);
    expect(b.sim.stress.mobs + 1).toBe(60); // 59 mobs + the player
    expect(b.sim.stepP95Ms).toBe(4);
  });
  it('the pools can hold the budgeted load (structural, machine independent)', () => { expect(checkLimits(b)).toEqual([]); });
  it('the stress really loads the step: no frozen ticks, and the budget is judged on the full load', () => {
    const t = measureStep(b.sim.stress.projectiles, b.sim.stress.mobs, 60, 30);
    expect(t.frozen).toBe(0);
    expect(t.n).toBe(60);
    expect(t.p50).toBeLessThanOrEqual(t.p95); expect(t.p95).toBeLessThanOrEqual(t.max);
  });
  it('judge reports an over-budget p95, an over-limit spike and an invalid (frozen) stress', () => {
    expect(judge(b, { frozen: 0, n: 10, p50: 1, p95: 3, p99: 3, max: 4 })).toEqual([]);
    expect(judge(b, { frozen: 0, n: 10, p50: 1, p95: 5, p99: 6, max: 20 }).join('\n')).toMatch(/p95 5\.00 ms is over the 4 ms budget[\s\S]*max 20\.00 ms is over the 16 ms/);
    expect(judge(b, { frozen: 3, n: 10, p50: 0, p95: 0, p99: 0, max: 0 }).join('\n')).toMatch(/stress is invalid: 3 ticks/);
  });
  it('checkLimits catches a budget the pools cannot hold', () => {
    expect(checkLimits({ ...b, limits: { maxProjectiles: 5000, maxActors: 80 } }).join('\n')).toMatch(/MAX_PROJECTILES is 1500, the budget needs 5000/);
  });
  // Wall-clock: opt-in like the other benches (PERF=1 npm run bench or `npm run perf`), since it depends on the machine.
  it.runIf(process.env.PERF)('full stress is inside the time budget on this machine', () => {
    expect(judge(b, measureStep(b.sim.stress.projectiles, b.sim.stress.mobs, b.sim.stress.ticks, b.sim.stress.warmupTicks))).toEqual([]);
  }, 60_000);
});
