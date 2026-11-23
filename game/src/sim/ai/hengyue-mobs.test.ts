// The five Hằng Nhạc mobs (G2-HN): GDD archetypes melee / tank / ranged / fast_melee / caster on the existing five behaviours,
// each with its own tuning (params.ts *_BY_MOB). Same checks as mobs.test.ts, plus what makes each one different.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { MobRow } from '../../contracts/content.ts';
import { COMBAT } from '../../contracts/combat.ts';
import { msToTicks } from '../../contracts/world.ts';
import { damageEnemy } from '../systems/combat.ts';
import { contentOf, makeFight, type Fight } from './harness.ts';
import { BRAWLER, BRAWLER_BY_MOB, CHARGER, CHARGER_BY_MOB, SHOOTER, SHOOTER_BY_MOB, tune } from './params.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const charge = (id: string) => msToTicks(tune(CHARGER, CHARGER_BY_MOB, id).chargeMs);
// [kind, mob x, mob y, extra ticks the hazard lasts beyond the tell, state that is the open (punish) window]
const CASES: [string, number, number, number, string][] = [
  ['mob_rogue_disciple', 100, 150, charge('mob_rogue_disciple'), 'recover'],
  ['mob_courtyard_guard', 175, 150, 0, 'recover'],
  ['mob_sword_acolyte', 100, 150, 0, 'recover'],
  ['mob_herb_viper', 130, 150, charge('mob_herb_viper'), 'recover'],
  ['mob_demonic_talisman', 105, 150, 0, 'recover'],
];
const mk = (kind: string, x: number, y: number, seed = 1): Fight => makeFight(seed, content, 200, 150, [[kind, x, y]]);
const until = (f: Fight, cond: () => boolean, max = 1500): void => { for (let i = 0; i < max && !cond(); i++) f.tick(); };
const mobOf = (f: Fight) => f.world.actors.find((a) => a.id === f.mobs[0])!;

describe('rows', () => {
  it('the five mobs are in the table, all hengyue, each with a tell of at least 250 ms', () => {
    const rows = mobs.filter((m) => m.biome === 'hengyue');
    expect(rows.map((m) => m.id).sort()).toEqual(CASES.map((c) => c[0]).sort());
    for (const r of rows) expect(r.tell_ms).toBeGreaterThanOrEqual(250);
  });
  it('map the GDD archetypes: melee/fast_melee charge, tank brawls, ranged and caster keep their distance', () => {
    const ai = (id: string) => mobs.find((m) => m.id === id)!.ai;
    expect([ai('mob_rogue_disciple'), ai('mob_herb_viper'), ai('mob_courtyard_guard'), ai('mob_sword_acolyte'), ai('mob_demonic_talisman')]).toEqual(['charger', 'charger', 'brawler', 'shooter', 'shooter']);
  });
});

describe.each(CASES)('%s', (kind, x, y, extra, openState) => {
  const row = mobs.find((m) => m.id === kind)!;
  const tell = msToTicks(row.tell_ms);

  it('is deterministic: same seed -> same hash', () => {
    const a = mk(kind, x, y, 7), b = mk(kind, x, y, 7);
    for (let i = 0; i < 1500; i++) { a.tick(); b.tick(); }
    expect(a.hash()).toBe(b.hash());
  });
  it('telegraphs with the table tell (>= 250 ms) and resolves its own hazard exactly once', () => {
    const f = mk(kind, x, y);
    until(f, () => f.world.hazards.length > 0);
    const h = f.world.hazards[0]!;
    expect(h.owner).toBe(f.mobs[0]); expect(h.duration).toBe(tell + extra);
    until(f, () => f.world.hazards.length === 0);
    expect(f.events.filter((e) => e.type === 'hazard-resolved')).toHaveLength(1);
  });
  it('hits a player who stands still, at the end of the telegraph', () => {
    const f = mk(kind, x, y);
    until(f, () => f.world.hazards.length > 0);
    const start = f.world.tick;
    until(f, () => f.world.stats.hitsTaken > 0, 400);
    expect(f.world.stats.hitsTaken).toBe(1);
    const hit = f.events.find((e) => e.type === 'hit' && e.target === f.player)!;
    expect(hit.tick - start).toBeGreaterThanOrEqual(tell + extra - 2);
  });
  it('a well-timed dash is a dodge (counter window), not a hit', () => {
    const f = mk(kind, x, y);
    until(f, () => f.world.hazards.length > 0);
    until(f, () => f.world.hazards[0]!.timer <= COMBAT.guardCheck - 4, 200);
    f.tick({ move: { x: 0, y: 1 }, dash: true });
    until(f, () => f.events.some((e) => e.type === 'hazard-resolved'), 100);
    expect(f.world.stats.hitsTaken).toBe(0);
    expect(f.events.some((e) => e.type === 'dodge-counter')).toBe(true);
  });
  it('is open after the attack: it stands still for a window the player can punish', () => {
    const f = mk(kind, x, y), m = mobOf(f);
    let run = 0, best = 0;
    for (let i = 0; i < 1500; i++) { f.tick({ move: { x: 0, y: 0 } }); if (m.ai.state === openState) { run++; best = Math.max(best, run); expect(m.vel).toEqual({ x: 0, y: 0 }); } else run = 0; }
    expect(best).toBeGreaterThanOrEqual(msToTicks(500));
  });
  it('a stagger cancels the attack and its telegraph, and it attacks again', () => {
    const f = mk(kind, x, y), m = mobOf(f);
    until(f, () => f.world.hazards.length > 0);
    m.combat.hurt = 6; f.tick();
    expect(f.world.hazards).toHaveLength(0); expect(m.ai.state).toBe('recover'); expect(m.combat.hurt).toBe(0);
    until(f, () => f.world.hazards.length > 0);
    expect(f.world.hazards).toHaveLength(1);
  });
  it('killed mid-telegraph it leaves no hazard behind', () => {
    const f = mk(kind, x, y), m = mobOf(f);
    until(f, () => f.world.hazards.length > 0);
    damageEnemy(f.world, m, 999, f.player, false, f.events);
    for (let i = 0; i < COMBAT.freezeHit + 2; i++) f.tick();
    expect(f.world.hazards).toHaveLength(0);
  });
  it('idles with no player', () => {
    const f = mk(kind, x, y);
    f.world.actors[0]!.diedTick = 0;
    for (let i = 0; i < 30; i++) f.tick();
    expect(mobOf(f).vel).toEqual({ x: 0, y: 0 }); expect(mobOf(f).clip).toBe('idle');
  });
});

describe('what makes each one different', () => {
  it('tuning overrides only the named numbers; a mob without an entry keeps the base block (Huyết Hải unchanged)', () => {
    expect(tune(CHARGER, CHARGER_BY_MOB, 'mob_blood_wolf')).toBe(CHARGER);
    expect(tune(BRAWLER, BRAWLER_BY_MOB, 'mob_blood_corpse')).toBe(BRAWLER);
    expect(tune(SHOOTER, SHOOTER_BY_MOB, 'mob_vengeful_soul')).toBe(SHOOTER);
    const v = tune(CHARGER, CHARGER_BY_MOB, 'mob_herb_viper');
    expect(v.chargeMs).toBeLessThan(CHARGER.chargeMs); expect(v.chargeHalfWidth).toBe(CHARGER.chargeHalfWidth);
  });
  it('the viper lunges faster than the disciple (fast_melee vs melee): a shorter hazard, a quicker lunge', () => {
    const d = mk('mob_rogue_disciple', 100, 150), v = mk('mob_herb_viper', 130, 150);
    until(d, () => d.world.hazards.length > 0); until(v, () => v.world.hazards.length > 0);
    expect(v.world.hazards[0]!.duration - msToTicks(350)).toBeLessThan(d.world.hazards[0]!.duration - msToTicks(400));
  });
  it('the guard is the slowest and has the longest guard-up (tank)', () => {
    const speed = (id: string) => mobs.find((m) => m.id === id)!.speed;
    expect(speed('mob_courtyard_guard')).toBe(Math.min(...mobs.filter((m) => m.biome === 'hengyue').map((m) => m.speed)));
    expect(mobs.find((m) => m.id === 'mob_courtyard_guard')!.tell_ms).toBeLessThan(700);
  });
  it('the acolyte and the caster keep their distance (approach when far, back off when near) and do not phase walls', () => {
    for (const k of ['mob_sword_acolyte', 'mob_demonic_talisman']) {
      const far = mk(k, 20, 150), near = mk(k, 190, 150);
      far.tick(); near.tick();
      expect(mobOf(far).vel.x).toBeGreaterThan(0); expect(mobOf(near).vel.x).toBeLessThan(0);
    }
  });
});
