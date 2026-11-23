// What pressing Counter (the interact button) does at each station of the hub. Pure: profile in, profile + message out.
// Messages are i18n keys plus numbers, the scene/UI turns them into text.
import type { SaveProfile } from '../contracts/save.ts';
import type { RunState } from '../contracts/run.ts';
import { advanceMilestone, applyRunResult, brewPill, countOf, feedFurnace, harvest, ITEM, plant, plotStage } from './abode.ts';
import type { AbodeResult } from './abode.ts';
import type { StationId } from './abode-layout.ts';

export interface ActionOutcome { profile: SaveProfile; msg: string; vars?: Record<string, number>; changed: boolean; enterRun?: boolean; /** Biome the run starts in (with enterRun); absent = the default one. */ biome?: string }

const unchanged = (p: SaveProfile, msg: string, vars?: Record<string, number>): ActionOutcome => ({ profile: p, msg, ...(vars ? { vars } : {}), changed: false });
const apply = (p: SaveProfile, r: AbodeResult, ok: string, fail: Record<string, string>, vars?: Record<string, number>): ActionOutcome =>
  r.ok ? { profile: r.profile, msg: ok, ...(vars ? { vars } : {}), changed: true } : unchanged(p, fail[r.reason] ?? 'abode.nothing');

export function interact(p: SaveProfile, station: StationId): ActionOutcome {
  switch (station) {
    case 'kiln': {
      const r = feedFurnace(p);
      if (!r.ok) return unchanged(p, 'abode.kiln.empty');
      // report what really happened: blanks made, or ore only stored while the furnace waits for a third
      const n = countOf(r.profile.inventory, ITEM.blank) - countOf(p.inventory, ITEM.blank);
      const msg = n > 0 ? { msg: 'abode.kiln.done', vars: { n } } : { msg: 'abode.kiln.stored', vars: { ore: countOf(p.inventory, ITEM.ore), left: r.profile.furnaceOre } };
      return { profile: r.profile, ...msg, changed: true };
    }
    case 'jar': return apply(p, brewPill(p), 'abode.jar.done', { missing: 'abode.jar.missing' });
    case 'bed0': case 'bed1': case 'bed2': {
      const i = Number(station.slice(3)), plot = p.plots[i];
      if (!plot) return unchanged(p, 'abode.nothing');
      const st = plotStage(plot);
      if (st === 'ripe') return apply(p, harvest(p, i), 'abode.bed.harvested', {});
      if (st === 'sprout') return unchanged(p, 'abode.bed.growing');
      return apply(p, plant(p, i), 'abode.bed.planted', { missing: 'abode.bed.missing' });
    }
    case 'altar': return unchanged(p, `abode.altar.${p.realm}`);
    case 'chest': return unchanged(p, 'abode.chest.count', { stone: countOf(p.inventory, 'spirit_stone'), pill: countOf(p.inventory, ITEM.pill), blank: countOf(p.inventory, ITEM.blank) });
    case 'gate': return { profile: p, msg: 'abode.gate.enter', changed: false, enterRun: true, biome: 'blood_sea' };
    case 'gate_hengyue': return { profile: p, msg: 'abode.gate_hengyue.enter', changed: false, enterRun: true, biome: 'hengyue' };
  }
}

/**
 * The run ended and the player is back: fold it into the profile and pass a milestone. `delivered` lists what was banked
 * this run, for the "rewards sent home" line. A run still marked active is refused (the sim lane throws), so callers
 * pass only finished runs.
 */
export function receiveRun(p: SaveProfile, run: RunState): { profile: SaveProfile; delivered: { id: string; amount: number }[] } {
  const profile = advanceMilestone(applyRunResult(p, run));
  return { profile, delivered: run.banked.map((r) => ({ ...r })) };
}
