// Động Phủ (abode) rules over the save profile (plan E6.2). Pure functions: every call returns a NEW profile, nothing reads a
// clock (time is counted in milestones) and nothing touches storage. Numbers are PLACEHOLDERS taken from the plan's
// "tối thiểu" craft: 3 ore -> 1 blank, 1 seed + 1 dew -> plant ripe after 2 milestones, 2 herbs -> 1 pill.
import type { Reward } from '../contracts/run.ts';
import type { AbodePlot, SaveProfile } from '../contracts/save.ts';
import { cloneProfile } from '../sim/save/profile.ts';

export const ITEM = { ore: 'ore', blank: 'blank', seed: 'seed', dew: 'dew', herb: 'herb', pill: 'pill' } as const;
export const ORE_PER_BLANK = 3;
export const RIPE_AFTER = 2;
export const HERBS_PER_PILL = 2;

export type PlotStage = 'bare' | 'sprout' | 'ripe';
export type AbodeResult = { ok: true; profile: SaveProfile } | { ok: false; reason: 'missing' | 'busy' | 'not-ripe' | 'bad-plot' | 'nothing' };

export const countOf = (inv: readonly Reward[], id: string): number => inv.find((r) => r.id === id)?.amount ?? 0;

function take(inv: Reward[], id: string, n: number): boolean {
  const r = inv.find((x) => x.id === id);
  if (!r || r.amount < n) return false;
  r.amount -= n;
  if (r.amount === 0) inv.splice(inv.indexOf(r), 1);
  return true;
}
function give(inv: Reward[], id: string, n: number): void {
  const r = inv.find((x) => x.id === id);
  if (r) r.amount += n; else inv.push({ id, amount: n });
}

export const plotStage = (p: AbodePlot): PlotStage => (p.seed === null ? 'bare' : p.milestones >= RIPE_AFTER ? 'ripe' : 'sprout');

/** Feed all ore in the inventory to the furnace; every ORE_PER_BLANK makes one blank, the remainder waits in `furnaceOre`. */
export function feedFurnace(p: SaveProfile): AbodeResult {
  const profile = cloneProfile(p);
  const ore = countOf(profile.inventory, ITEM.ore);
  if (ore === 0 && profile.furnaceOre < ORE_PER_BLANK) return { ok: false, reason: 'nothing' };
  take(profile.inventory, ITEM.ore, ore);
  const total = profile.furnaceOre + ore;
  const blanks = Math.floor(total / ORE_PER_BLANK);
  profile.furnaceOre = total % ORE_PER_BLANK;
  if (blanks > 0) give(profile.inventory, ITEM.blank, blanks);
  return { ok: true, profile };
}

/** Plant 1 seed + 1 dew in an empty bed. */
export function plant(p: SaveProfile, index: number): AbodeResult {
  const plot = p.plots[index];
  if (!plot) return { ok: false, reason: 'bad-plot' };
  if (plot.seed !== null) return { ok: false, reason: 'busy' };
  if (countOf(p.inventory, ITEM.seed) < 1 || countOf(p.inventory, ITEM.dew) < 1) return { ok: false, reason: 'missing' };
  const profile = cloneProfile(p);
  take(profile.inventory, ITEM.seed, 1); take(profile.inventory, ITEM.dew, 1);
  profile.plots[index] = { seed: ITEM.seed, milestones: 0 };
  return { ok: true, profile };
}

/** Pick a ripe plant: it goes to the inventory as a herb and the bed is bare again. */
export function harvest(p: SaveProfile, index: number): AbodeResult {
  const plot = p.plots[index];
  if (!plot) return { ok: false, reason: 'bad-plot' };
  if (plotStage(plot) !== 'ripe') return { ok: false, reason: 'not-ripe' };
  const profile = cloneProfile(p);
  profile.plots[index] = { seed: null, milestones: 0 };
  give(profile.inventory, ITEM.herb, 1);
  return { ok: true, profile };
}

/** 2 herbs make 1 pill. */
export function brewPill(p: SaveProfile): AbodeResult {
  if (countOf(p.inventory, ITEM.herb) < HERBS_PER_PILL) return { ok: false, reason: 'missing' };
  const profile = cloneProfile(p);
  take(profile.inventory, ITEM.herb, HERBS_PER_PILL);
  give(profile.inventory, ITEM.pill, 1);
  return { ok: true, profile };
}

/** One abode milestone passes (a finished run). Planted beds grow by one; ripe beds stay ripe. */
export function advanceMilestone(p: SaveProfile): SaveProfile {
  const profile = cloneProfile(p);
  profile.milestone++;
  for (const plot of profile.plots) if (plot.seed !== null && plot.milestones < RIPE_AFTER) plot.milestones++;
  return profile;
}

/**
 * Where the run ends and the abode takes over: fold the finished run into the profile (banked rewards, recipes, counters) and
 * pass one milestone. A death keeps what was banked and learned, as the sim lane's applyRunResult defines.
 */
export { applyRunResult } from '../sim/save/profile.ts';
