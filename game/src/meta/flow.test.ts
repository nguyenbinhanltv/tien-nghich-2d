import { describe, expect, it } from 'vitest';
import { attachRun, BOSS_CLEAR_REWARDS, beginSliceRun, canRestartRun, finishSliceRun } from './flow.ts';
import { countOf } from './abode.ts';
import { createProfile } from '../sim/save/profile.ts';
import { createWorld, startGhostKingFight } from '../sim/loop.ts';
import { endRun } from '../sim/run/run.ts';
import type { GameEvent } from '../contracts/world.ts';

const fight = (outcome: 'won' | 'died') => {
  const w = createWorld(1), ev: GameEvent[] = [];
  startGhostKingFight(w, ev);
  const run = attachRun(w, 1);
  endRun(w, outcome, ev);
  return run;
};

describe('slice flow', () => {
  it('a run takes the next seed once; the profile it returns is what must be saved before the fight', () => {
    const p = createProfile(3), a = beginSliceRun(p), b = beginSliceRun(a.profile);
    expect(a.seed).toBe(p.nextRunSeed); expect(a.runId).toBe(1); expect(b.runId).toBe(2); expect(b.seed).not.toBe(a.seed);
    expect(beginSliceRun(p).seed).toBe(a.seed); // same profile, same seed: no reroll by reloading
  });
  it('a win sends the boss reward home, passes a milestone and counts the win', () => {
    const r = finishSliceRun(createProfile(1), fight('won'));
    expect(r.outcome).toBe('won');
    for (const x of BOSS_CLEAR_REWARDS) expect(countOf(r.profile.inventory, x.id)).toBe(x.amount);
    expect(r.profile.runsWon).toBe(1); expect(r.profile.milestone).toBe(1); expect(r.delivered.length).toBe(BOSS_CLEAR_REWARDS.length);
  });
  it('a death brings nothing home but still counts and passes a milestone', () => {
    const r = finishSliceRun(createProfile(1), fight('died'));
    expect(r.profile.inventory).toEqual([]); expect(r.delivered).toEqual([]); expect(r.profile.runsDied).toBe(1); expect(r.profile.milestone).toBe(1);
  });
  it('does not mutate the run it is given, and refuses a run still in progress', () => {
    const run = fight('won'), before = JSON.stringify(run);
    finishSliceRun(createProfile(1), run);
    expect(JSON.stringify(run)).toBe(before);
    expect(() => finishSliceRun(createProfile(1), { ...run, outcome: 'active' })).toThrow();
  });
  it('the full loop plays the abode: boss reward -> blank, plant, pill chain is possible', async () => {
    const { interact } = await import('./abode-actions.ts');
    let p = finishSliceRun(createProfile(1), fight('won')).profile;
    p = interact(p, 'kiln').profile; expect(p.furnaceOre).toBe(0); expect(countOf(p.inventory, 'blank')).toBe(1);
    p = interact(p, 'bed0').profile; expect(p.plots[0]!.seed).toBe('seed');
  });
  it('a finished run cannot be restarted: not on a result screen, not once the run has ended', () => {
    const w = createWorld(1), ev: GameEvent[] = [];
    startGhostKingFight(w, ev); attachRun(w, 1);
    expect(canRestartRun(w)).toBe(true); // mid-fight
    w.mode = 'won'; expect(canRestartRun(w)).toBe(false); // result screen
    w.mode = 'lost'; expect(canRestartRun(w)).toBe(false);
    w.mode = 'playing'; endRun(w, 'died', ev); expect(canRestartRun(w)).toBe(false); // run ended, whatever the mode says
    const plain = createWorld(2); startGhostKingFight(plain, ev);
    expect(canRestartRun(plain)).toBe(true); // no run: the single-fight route is unchanged
  });
});
