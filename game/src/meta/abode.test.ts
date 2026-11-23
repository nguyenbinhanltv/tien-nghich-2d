import { describe, expect, it } from 'vitest';
import { advanceMilestone, brewPill, countOf, feedFurnace, harvest, ITEM, plant, plotStage } from './abode.ts';
import { readProfile, writeProfile, PROFILE_KEY } from './profile-store.ts';
import type { KeyValueStore } from './profile-store.ts';
import { createProfile } from '../sim/save/profile.ts';
import type { SaveProfile } from '../contracts/save.ts';

const withInv = (inv: [string, number][]): SaveProfile => { const p = createProfile(7); p.inventory = inv.map(([id, amount]) => ({ id, amount })); return p; };
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const mem = (): KeyValueStore & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };

describe('E6.2 abode rules', () => {
  it('furnace: 3 ore make 1 blank, the remainder waits, input is not mutated', () => {
    const p = withInv([['ore', 7]]);
    const r = must(feedFurnace(p)).profile;
    expect(countOf(r.inventory, ITEM.blank)).toBe(2); expect(r.furnaceOre).toBe(1); expect(countOf(r.inventory, ITEM.ore)).toBe(0);
    expect(countOf(p.inventory, ITEM.ore)).toBe(7);
    expect(feedFurnace(createProfile(1))).toEqual({ ok: false, reason: 'nothing' });
  });
  it('furnace remainder carries over between visits', () => {
    const a = must(feedFurnace(withInv([['ore', 2]]))).profile;
    a.inventory.push({ id: 'ore', amount: 1 });
    const b = must(feedFurnace(a)).profile;
    expect(countOf(b.inventory, ITEM.blank)).toBe(1); expect(b.furnaceOre).toBe(0);
  });
  it('bed: seed + dew -> sprout -> ripe after 2 milestones -> herb; 2 herbs -> pill', () => {
    let p = withInv([['seed', 2], ['dew', 2]]);
    expect(plant(p, 5)).toEqual({ ok: false, reason: 'bad-plot' });
    p = must(plant(p, 0)).profile;
    expect(plotStage(p.plots[0]!)).toBe('sprout');
    expect(plant(p, 0)).toEqual({ ok: false, reason: 'busy' });
    expect(harvest(p, 0)).toEqual({ ok: false, reason: 'not-ripe' });
    p = advanceMilestone(p); expect(plotStage(p.plots[0]!)).toBe('sprout');
    p = advanceMilestone(advanceMilestone(p)); expect(plotStage(p.plots[0]!)).toBe('ripe'); expect(p.plots[0]!.milestones).toBe(2);
    p = must(harvest(p, 0)).profile;
    expect(plotStage(p.plots[0]!)).toBe('bare'); expect(countOf(p.inventory, ITEM.herb)).toBe(1);
    expect(brewPill(p)).toEqual({ ok: false, reason: 'missing' });
    p = must(plant(p, 1)).profile; p = advanceMilestone(advanceMilestone(p)); p = must(harvest(p, 1)).profile;
    p = must(brewPill(p)).profile;
    expect(countOf(p.inventory, ITEM.pill)).toBe(1); expect(countOf(p.inventory, ITEM.herb)).toBe(0);
    expect(plant(withInv([['seed', 1]]), 0)).toEqual({ ok: false, reason: 'missing' });
  });
  it('milestones never touch empty beds and the counter moves', () => {
    const p = advanceMilestone(createProfile(1));
    expect(p.milestone).toBe(1); expect(p.plots.every((x) => x.seed === null && x.milestones === 0)).toBe(true);
  });
});

describe('profile store', () => {
  it('fresh when empty; write then read round-trips', () => {
    const s = mem();
    expect(readProfile(s, 3).source).toBe('fresh');
    const p = withInv([['ore', 1]]); writeProfile(s, p);
    const r = readProfile(s, 3);
    expect(r.source).toBe('stored'); expect(r.profile).toEqual(p);
  });
  it('a damaged save is kept under .bad and a fresh profile is returned', () => {
    const s = mem(); writeProfile(s, createProfile(1));
    const damaged = (s.m.get(PROFILE_KEY) as string).replace('"nhap_mon"', '"khai_lo"');
    s.m.set(PROFILE_KEY, damaged);
    const r = readProfile(s, 9);
    expect(r.source).toBe('recovered'); expect(r.reason).toBe('checksum'); expect(s.m.get(`${PROFILE_KEY}.bad`)).toBe(damaged);
  });
});
