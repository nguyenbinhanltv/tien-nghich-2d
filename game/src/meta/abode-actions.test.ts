import { describe, expect, it } from 'vitest';
import { interact, receiveRun } from './abode-actions.ts';
import { countOf, ITEM, plotStage } from './abode.ts';
import { createProfile } from '../sim/save/profile.ts';
import type { RunState } from '../contracts/run.ts';
import { uiTables } from '../ui/strings.ts';

const run = (over: Partial<RunState>): RunState => ({ runId: 1, room: 9, cluster: 2, realm: 2, gateUsed: true, carried: [], banked: [], learned: [], clusterFirstClear: [], outcome: 'won', ...over });

describe('hub interactions', () => {
  it('kiln reports the real result: ore only stored vs blanks made', () => {
    let p = createProfile(1); p.inventory = [{ id: 'ore', amount: 2 }];
    let o = interact(p, 'kiln');
    expect(o.msg).toBe('abode.kiln.stored'); expect(o.vars).toEqual({ ore: 2, left: 2 }); expect(countOf(o.profile.inventory, ITEM.blank)).toBe(0);
    p = o.profile; p.inventory = [{ id: 'ore', amount: 4 }];
    o = interact(p, 'kiln'); // 2 waiting + 4 = 6 -> 2 blanks
    expect(o.msg).toBe('abode.kiln.done'); expect(o.vars).toEqual({ n: 2 }); expect(o.profile.furnaceOre).toBe(0);
    expect(uiTables.en['abode.kiln.stored']).toContain('{left}'); expect(uiTables.vi['abode.kiln.stored']).toContain('{ore}');
  });
  it('kiln, beds and jar chain into a pill; every message key exists in both locales', () => {
    const keys = new Set<string>();
    const go = (p: ReturnType<typeof createProfile>, s: Parameters<typeof interact>[1]): ReturnType<typeof createProfile> => { const o = interact(p, s); keys.add(o.msg); return o.profile; };
    let p = createProfile(1);
    p.inventory = [{ id: 'ore', amount: 3 }, { id: 'seed', amount: 2 }, { id: 'dew', amount: 2 }];
    expect(interact(p, 'jar').msg).toBe('abode.jar.missing');
    p = go(p, 'kiln'); expect(countOf(p.inventory, ITEM.blank)).toBe(1);
    p = go(p, 'bed0'); expect(plotStage(p.plots[0]!)).toBe('sprout');
    expect(interact(p, 'bed0').msg).toBe('abode.bed.growing');
    p = go(p, 'bed1'); keys.add(interact(p, 'bed2').msg);
    p = receiveRun(receiveRun(p, run({})).profile, run({})).profile; // two milestones: both beds ripe
    p = go(p, 'bed0'); p = go(p, 'bed1'); // harvest both
    p = go(p, 'jar');
    expect(countOf(p.inventory, ITEM.pill)).toBe(1);
    for (const s of ['altar', 'chest', 'gate', 'kiln'] as const) keys.add(interact(p, s).msg);
    keys.add(interact(createProfile(2), 'kiln').msg); keys.add(interact(createProfile(2), 'bed0').msg);
    for (const k of keys) { expect(uiTables.vi[k as keyof typeof uiTables.vi], k).toBeTruthy(); expect(uiTables.en[k as keyof typeof uiTables.en], k).toBeTruthy(); }
  });
  it('the gate asks to enter a run and does not change the profile', () => {
    const p = createProfile(1);
    const o = interact(p, 'gate');
    expect(o.enterRun).toBe(true); expect(o.profile).toBe(p);
  });
  it('receiveRun banks rewards and recipes (also after a death), passes a milestone and reports what was sent home', () => {
    const p = createProfile(1);
    const r = receiveRun(p, run({ outcome: 'died', banked: [{ id: 'spirit_stone', amount: 4 }], learned: ['rcp_a'] }));
    expect(countOf(r.profile.inventory, 'spirit_stone')).toBe(4); expect(r.profile.recipes).toEqual(['rcp_a']);
    expect(r.profile.milestone).toBe(1); expect(r.profile.runsDied).toBe(1); expect(r.delivered).toEqual([{ id: 'spirit_stone', amount: 4 }]);
    expect(() => receiveRun(p, run({ outcome: 'active' }))).toThrow();
  });
});
