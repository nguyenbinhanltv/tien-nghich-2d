// Behaviour tests shared by the four mobs added after the wolf (charger.test.ts keeps the wolf's own timing tests).
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { MobRow } from '../../contracts/content.ts';
import { COMBAT } from '../../contracts/combat.ts';
import { msToTicks } from '../../contracts/world.ts';
import { damageEnemy } from '../systems/combat.ts';
import { contentOf, makeFight, type Fight } from './harness.ts';
import { PHASES_WALLS } from './index.ts';
import { SWOOPER } from './params.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
// [kind, mob x, mob y, extra ticks the hazard lasts beyond the tell, state that is the open (punish) window]
const CASES: [string, number, number, number, string][] = [
  ['mob_blood_crow', 80, 150, msToTicks(SWOOPER.diveMs), 'recover'],
  ['mob_blood_corpse', 175, 150, 0, 'recover'],
  ['mob_blood_pool_lurker', 170, 150, 0, 'recover'],
  ['mob_vengeful_soul', 105, 150, 0, 'recover'],
];
const mk = (kind: string, x: number, y: number, seed = 1): Fight => makeFight(seed, content, 200, 150, [[kind, x, y]]);
const until = (f: Fight, cond: () => boolean, max = 1500): void => { for (let i = 0; i < max && !cond(); i++) f.tick(); };
const mobOf = (f: Fight) => f.world.actors.find((a) => a.id === f.mobs[0])!;

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
    expect(tell).toBeGreaterThanOrEqual(msToTicks(250));
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
    f.events.length = 0;
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

describe('behaviour details', () => {
  it('the lurker never moves and waits dormant until the player is close', () => {
    const f = mk('mob_blood_pool_lurker', 40, 150), m = mobOf(f);
    for (let i = 0; i < 300; i++) f.tick();
    expect(m.ai.state).toBe('dormant'); expect(f.world.hazards).toHaveLength(0); expect(m.pos).toEqual({ x: 40, y: 150 });
  });
  it('the soul keeps its distance (approaches when far, backs off when near)', () => {
    const far = mk('mob_vengeful_soul', 20, 150), near = mk('mob_vengeful_soul', 190, 150);
    far.tick(); near.tick();
    expect(mobOf(far).vel.x).toBeGreaterThan(0); expect(mobOf(near).vel.x).toBeLessThan(0);
    expect(PHASES_WALLS.has('mob_vengeful_soul')).toBe(true);
  });
  it('the corpse closes in on foot and the crow circles before diving', () => {
    const c = mk('mob_blood_corpse', 80, 150), k = mk('mob_blood_crow', 80, 150);
    for (let i = 0; i < 40; i++) { c.tick(); k.tick(); }
    expect(mobOf(c).pos.x).toBeGreaterThan(80); expect(mobOf(k).ai.state).toBe('orbit');
    expect(Math.abs(mobOf(k).pos.y - 150)).toBeGreaterThan(0); // tangent motion, not a straight chase
  });
});
