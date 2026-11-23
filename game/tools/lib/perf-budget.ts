// E9.3: sim performance budget. Builds the plan's stress world (1,500 shots in flight, 59 mobs + player, hp so large nobody dies, the shot
// count topped up every tick so the load never drains), times the REAL `step` and reports p50/p95/p99/max against game/perf-budget.json.
import fs from 'node:fs';
import path from 'node:path';
import { GAME } from './repo.ts';
import type { GameEvent } from '../../src/contracts/world.ts';
import { MAX_ACTORS, MAX_PROJECTILES } from '../../src/contracts/pool.ts';
import { createWorld, step } from '../../src/sim/loop.ts';
import { spawnActor } from '../../src/sim/actors.ts';
import { Rng } from '../../src/sim/rng.ts';
import { setMode } from '../../src/sim/systems/combat.ts';
import { fireProjectile, KIND } from '../../src/sim/systems/projectile.ts';

export const BUDGET_FILE = path.join(GAME, 'perf-budget.json');
export interface Budget { sim: { stress: { projectiles: number; mobs: number; ticks: number; warmupTicks: number }; stepP95Ms: number; stepMaxMs: number }; limits: { maxProjectiles: number; maxActors: number } }
export const readBudget = (): Budget => JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')) as Budget;
export interface Timing { frozen: number; n: number; p50: number; p95: number; p99: number; max: number }

/** Time `ticks` fixed steps of a world carrying `projectiles` shots and `mobs` actors. */
export function measureStep(projectiles: number, mobs: number, ticks: number, warmup: number, seed = 3): Timing {
  const w = createWorld(seed), ev: GameEvent[] = [], rng = new Rng(seed);
  const player = spawnActor(w, 'player', 60, 205, 1e9, ev, 5); // far corner: the shots never reach it, so no hit-stop short-circuits the step
  const mobIds: number[] = [];
  for (let i = 0; i < mobs; i++) mobIds.push(spawnActor(w, 'mob_blood_corpse', 60 + (i % 20) * 14, 95 + Math.floor(i / 20) * 40, 1e9, ev).id);
  void player;
  setMode(w, 'playing', ev);
  const refill = (): void => {
    while (w.projectiles.count < projectiles) {
      const a = rng.next() * Math.PI * 2;
      fireProjectile(w, mobIds[0] ?? 0, KIND.mobShot, 200 + rng.next() * 134, 88 + rng.next() * 123, Math.cos(a), Math.sin(a), 0.8, 2, 90, 0, false, ev); // mob-owned: they only look for the player
    }
  };
  const times: number[] = [];
  let frozen = 0;
  for (let t = 0; t < warmup + ticks; t++) {
    refill(); ev.length = 0;
    const t0 = performance.now();
    step(w, { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false }, ev);
    const dt = performance.now() - t0;
    if (w.freeze > 0 || w.mode !== 'playing') frozen++;
    if (t >= warmup) times.push(dt);
  }
  times.sort((a, b) => a - b);
  const at = (q: number): number => times[Math.min(times.length - 1, Math.floor(q * times.length))] as number;
  return { frozen, n: times.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: times.at(-1) as number };
}

/** Compare a stress measurement to the budget: readable failure lines. */
export function judge(b: Budget, t: Timing): string[] {
  const out: string[] = [];
  if (t.frozen > 0) out.push(`the stress is invalid: ${t.frozen} ticks were frozen or not playing, so the step did not do its full work`);
  if (t.p95 > b.sim.stepP95Ms) out.push(`sim step p95 ${t.p95.toFixed(2)} ms is over the ${b.sim.stepP95Ms} ms budget`);
  if (t.max > b.sim.stepMaxMs) out.push(`sim step max ${t.max.toFixed(2)} ms is over the ${b.sim.stepMaxMs} ms spike limit`);
  return out;
}
/** Structural limits that do not depend on the machine: the pools must hold the plan's counts. */
export function checkLimits(b: Budget): string[] {
  const out: string[] = [];
  if (MAX_PROJECTILES < b.limits.maxProjectiles) out.push(`MAX_PROJECTILES is ${MAX_PROJECTILES}, the budget needs ${b.limits.maxProjectiles}`);
  if (MAX_ACTORS < b.limits.maxActors) out.push(`MAX_ACTORS is ${MAX_ACTORS}, the budget needs ${b.limits.maxActors}`);
  if (b.sim.stress.projectiles > MAX_PROJECTILES) out.push(`the stress (${b.sim.stress.projectiles} shots) exceeds MAX_PROJECTILES ${MAX_PROJECTILES}`);
  if (b.sim.stress.mobs + 1 > MAX_ACTORS) out.push(`the stress (${b.sim.stress.mobs + 1} actors) exceeds MAX_ACTORS ${MAX_ACTORS}`);
  return out;
}
