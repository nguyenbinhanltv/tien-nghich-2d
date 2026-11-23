// The account profile: what persists between runs. Pure functions, no clock and no storage (the platform layer stores the JSON).
import type { Reward, RunState } from '../../contracts/run.ts';
import type { ProfileRealm, SaveProfile } from '../../contracts/save.ts';
import { SAVE_VERSION } from '../../contracts/save.ts';
import { hashState } from '../hash.ts';
import { Rng } from '../rng.ts';
import { addReward } from '../run/run.ts';

export const PLOT_COUNT = 3;

export function createProfile(seed: number): SaveProfile {
  return {
    version: SAVE_VERSION, profileId: hashState({ seed: seed >>> 0 }), realm: 'nhap_mon', recipes: [], inventory: [],
    plots: Array.from({ length: PLOT_COUNT }, () => ({ seed: null, milestones: 0 })), furnaceOre: 0, milestone: 0,
    runsStarted: 0, runsWon: 0, runsDied: 0, nextRunSeed: new Rng(seed).state, suspendedRun: null,
    settings: { locale: 'vi', sfx: 1, music: 1, reducedFlash: false },
  };
}

export const cloneProfile = (p: SaveProfile): SaveProfile => JSON.parse(JSON.stringify(p)) as SaveProfile;

/** Start a run: returns the seed to build its world from and a profile with the counter and the next seed advanced (so a reload cannot reroll). */
export function beginRun(p: SaveProfile): { seed: number; runId: number; profile: SaveProfile } {
  const profile = cloneProfile(p), seed = profile.nextRunSeed;
  const r = new Rng(seed); r.next();
  profile.nextRunSeed = r.state;
  profile.runsStarted++;
  return { seed, runId: profile.runsStarted, profile };
}

const ORDER: ProfileRealm[] = ['nhap_mon', 'khai_lo', 'lap_tran'];
/**
 * PLACEHOLDER rule (design-pending): reaching Tụ Khí II in a run, win or lose, opens Khai Lô; a win in Tụ Khí II opens Lập Trận.
 * It never goes back: failure keeps the realm.
 */
function realmAfter(current: ProfileRealm, run: RunState): ProfileRealm {
  let i = ORDER.indexOf(current);
  if (run.realm >= 2 && i < 1) i = 1;
  if (run.realm >= 2 && run.outcome === 'won' && i < 2) i = 2;
  return ORDER[i] as ProfileRealm;
}

/** Fold a finished run into the profile: banked rewards join the inventory, learned recipes stay (also after a death), counters and realm move. */
export function applyRunResult(p: SaveProfile, run: RunState): SaveProfile {
  if (run.outcome === 'active') throw new Error('the run has not ended');
  const profile = cloneProfile(p);
  for (const r of run.banked as Reward[]) addReward(profile.inventory, r.id, r.amount);
  for (const id of run.learned) if (!profile.recipes.includes(id)) profile.recipes.push(id);
  profile.realm = realmAfter(profile.realm, run);
  if (run.outcome === 'won') profile.runsWon++;
  if (run.outcome === 'died') profile.runsDied++;
  profile.suspendedRun = null;
  return profile;
}
