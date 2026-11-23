// The vertical-slice loop around the fight (plan: Động Phủ -> Huyết Hải -> boss -> gửi thưởng -> Động Phủ). Pure functions, no
// Phaser. The shell starts a run from the profile and folds the finished run back in. Rewards are PLACEHOLDERS (design-pending):
// they exist so the abode loop (ore -> blank, seed + dew -> herb -> pill) can be played end to end.
import type { Reward, RunState } from '../contracts/run.ts';
import type { SaveProfile } from '../contracts/save.ts';
import type { WorldState } from '../contracts/world.ts';
import { addReward, BOSS_ROOM, startRun } from '../sim/run/run.ts';
import { beginRun } from '../sim/save/profile.ts';
import { receiveRun } from './abode-actions.ts';

/** What beating the Ghost King sends home. A death brings nothing home (carried rewards are lost; none are carried in the boss-only slice). */
export const BOSS_CLEAR_REWARDS: readonly Reward[] = [
  { id: 'spirit_stone', amount: 5 }, { id: 'ore', amount: 3 }, { id: 'seed', amount: 1 }, { id: 'dew', amount: 1 },
];

export interface RunStart { seed: number; runId: number; profile: SaveProfile }

/** Take the next seed (advanced and returned in the profile, so a reload cannot reroll). The caller saves `profile` before the fight. */
export const beginSliceRun = (p: SaveProfile): RunStart => beginRun(p);

/** Attach a run to the fight world; the boss-only slice starts at the boss room. */
export function attachRun(world: WorldState, runId: number): RunState {
  const run = startRun(world, runId);
  run.room = BOSS_ROOM; run.cluster = 3;
  return run;
}

export type SliceResult = { profile: SaveProfile; delivered: Reward[]; outcome: RunState['outcome'] };

/** The fight reached `won` or `lost` (the sim already ended the run): add the boss reward on a win, then fold the run into the profile. */
export function finishSliceRun(p: SaveProfile, run: RunState): SliceResult {
  if (run.outcome === 'active') throw new Error('the run has not ended');
  const done: RunState = JSON.parse(JSON.stringify(run)) as RunState;
  if (done.outcome === 'won') for (const r of BOSS_CLEAR_REWARDS) addReward(done.banked, r.id, r.amount);
  const r = receiveRun(p, done);
  return { profile: r.profile, delivered: r.delivered, outcome: done.outcome };
}
