// Run (lượt Tầm Đạo) lifecycle: rooms in clusters of three, the realm gate in cluster 2, rewards carried vs banked, and how a run ends.
// Numbers marked PLACEHOLDER are design-pending balance, not decisions.
import type { RealmStage, Reward, RunOutcome, RunState } from '../../contracts/run.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { findPlayer } from '../actors.ts';

export const ROOMS_PER_CLUSTER = 3;
/** Nine combat rooms (3 clusters x 3); the boss room follows as room index 9, "cluster 3". */
export const FLOOR_ROOMS = 9;
export const BOSS_ROOM = FLOOR_ROOMS;
/** The realm gate is offered in cluster index 1 (the second cluster) and must be used before leaving it. */
export const GATE_CLUSTER = 1;
/** PLACEHOLDER: what a first clear of a cluster pays, and what Tụ Khí II / the pill give. */
export const FIRST_CLEAR_BONUS: Reward = { id: 'spirit_stone', amount: 3 };
export const PILL_REWARD: Reward = { id: 'pill', amount: 1 };
export const REALM_II = { hpMax: 2, heal: 2 } as const;

export function addReward(list: Reward[], id: string, amount: number): void {
  const r = list.find((x) => x.id === id);
  if (r) r.amount += amount; else list.push({ id, amount });
}

export function startRun(world: WorldState, runId: number): RunState {
  const run: RunState = { runId, room: 0, cluster: 0, realm: 1, gateUsed: false, carried: [], banked: [], learned: [], clusterFirstClear: [], outcome: 'active' };
  world.run = run;
  return run;
}

const active = (world: WorldState): RunState => {
  const r = world.run;
  if (!r || r.outcome !== 'active') throw new Error('no active run');
  return r;
};

export const gateAvailable = (run: RunState): boolean => run.outcome === 'active' && run.cluster === GATE_CLUSTER && !run.gateUsed && run.realm === 1;

/** Put a reward in the carried pile (lost on death unless banked). */
export function grantReward(world: WorldState, id: string, amount: number, events: GameEvent[]): void {
  addReward(active(world).carried, id, amount);
  events.push({ type: 'reward-gained', tick: world.tick, id, amount });
}

export function learnRecipe(world: WorldState, recipe: string): void {
  const r = active(world);
  if (!r.learned.includes(recipe)) r.learned.push(recipe);
}

/**
 * The cluster-2 gate: break through to Tụ Khí II (more health, healed) or take the pill. One choice per run.
 * Breakthrough keeps the player's health ratio rules simple: hpMax +2 and +2 hp (PLACEHOLDER numbers).
 */
export function takeGate(world: WorldState, choice: 'breakthrough' | 'pill', events: GameEvent[]): void {
  const run = active(world);
  if (!gateAvailable(run)) throw new Error('the realm gate is not available');
  run.gateUsed = true;
  if (choice === 'pill') { grantReward(world, PILL_REWARD.id, PILL_REWARD.amount, events); return; }
  const from: RealmStage = run.realm;
  run.realm = 2;
  const p = findPlayer(world);
  if (p) { p.hpMax += REALM_II.hpMax; p.hp = Math.min(p.hpMax, p.hp + REALM_II.heal); }
  events.push({ type: 'realm-breakthrough', tick: world.tick, from, to: 2 });
}

export type AdvanceResult = 'ok' | 'gate-pending' | 'floor-complete';

/** Move to the next room. Refuses to leave the gate cluster while the gate is unused; pays each cluster's first clear once. */
export function advanceRoom(world: WorldState, events: GameEvent[]): AdvanceResult {
  const run = active(world);
  if (run.room >= BOSS_ROOM) return 'floor-complete';
  const next = run.room + 1, nextCluster = Math.min(3, Math.floor(next / ROOMS_PER_CLUSTER));
  if (nextCluster !== run.cluster) {
    if (gateAvailable(run)) return 'gate-pending';
    if (!run.clusterFirstClear.includes(run.cluster)) {
      run.clusterFirstClear.push(run.cluster);
      grantReward(world, FIRST_CLEAR_BONUS.id, FIRST_CLEAR_BONUS.amount, events);
    }
  }
  run.room = next; run.cluster = nextCluster;
  return 'ok';
}

/** Send everything carried home now and keep playing: what is banked survives a later death. */
export function bankCarried(world: WorldState, events: GameEvent[]): void {
  const run = active(world);
  for (const r of run.carried) { addReward(run.banked, r.id, r.amount); }
  run.carried = [];
  void events;
}

/** Drop everything carried (the "bỏ thưởng" choice). */
export function discardCarried(world: WorldState): void { active(world).carried = []; }

/**
 * End the run. 'won' and 'banked' send the carried pile home first; 'died' and 'abandoned' lose it. Banked rewards and learned
 * recipes always survive.
 */
export function endRun(world: WorldState, outcome: Exclude<RunOutcome, 'active'>, events: GameEvent[]): RunState {
  const run = active(world);
  if (outcome === 'won' || outcome === 'banked') bankCarried(world, events); else run.carried = [];
  run.outcome = outcome;
  events.push({ type: 'run-ended', tick: world.tick, outcome });
  return run;
}

/** Call once per tick: when the fight reaches `won` or `lost` the run ends by itself. */
export function settleRun(world: WorldState, events: GameEvent[]): void {
  const run = world.run;
  if (!run || run.outcome !== 'active') return;
  if (world.mode === 'lost') endRun(world, 'died', events);
  else if (world.mode === 'won') endRun(world, 'won', events);
}
