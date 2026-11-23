// Save profile contract (plan E6.2). Pure data: the platform layer stores the JSON (IndexedDB / userData),
// the sim lane owns migration and validation. Never store a clock time: the abode counts milestones.
import type { Reward } from './run.ts';

/** Bump on every shape change and add a migration step in sim/save/migrate.ts. */
export const SAVE_VERSION = 1;

/** Profile realm (cultivation of the account, not of a run). Failure never takes it back. */
export type ProfileRealm = 'nhap_mon' | 'khai_lo' | 'lap_tran';

export interface AbodePlot { seed: string | null; /** Milestones passed since planting. */ milestones: number }

export interface SaveProfile {
  version: number;
  /** Random-looking but derived from the creation seed, not from a clock. */
  profileId: string;
  realm: ProfileRealm;
  /** Recipe ids learned; kept on a failed run. */
  recipes: string[];
  /** Banked inventory: ore, seeds, dew, blanks, pills, spirit stones. */
  inventory: Reward[];
  plots: AbodePlot[];
  /** Furnace ore progress (3 ore make 1 blank) and abode milestone counter. */
  furnaceOre: number;
  milestone: number;
  runsStarted: number;
  runsWon: number;
  runsDied: number;
  /** Next run seed; advanced deterministically so a reload cannot reroll a floor. */
  nextRunSeed: number;
  /** Run in progress, if the game was closed mid-run. Null when none. */
  suspendedRun: SuspendedRun | null;
  settings: { locale: 'vi' | 'en'; sfx: number; music: number; reducedFlash: boolean };
}

/** Mid-run save: the seed plus the input log is enough to rebuild a run, so this stays small. */
export interface SuspendedRun { seed: number; ticks: number; inputLog: string; stateHash: string }
