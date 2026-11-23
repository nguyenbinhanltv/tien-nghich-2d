import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { MobRow } from '../../contracts/content.ts';
import { COMBAT } from '../../contracts/combat.ts';
import { msToTicks } from '../../contracts/world.ts';
import { damageEnemy } from '../systems/combat.ts';
import { contentOf, makeFight, type Fight } from './harness.ts';
import { CHARGER } from './params.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const WOLF = 'mob_blood_wolf';
const wolfRow = mobs.find((m) => m.id === WOLF)!;
const TELL = msToTicks(wolfRow.tell_ms), LUNGE = msToTicks(CHARGER.chargeMs);
const run = (f: Fight, n: number): void => { for (let i = 0; i < n; i++) f.tick(); };
const fight = (seed: number): Fight => makeFight(seed, content, 200, 150, [[WOLF, 60, 150]]);
const wolfOf = (f: Fight) => f.world.actors.find((a) => a.id === f.mobs[0])!;
const until = (f: Fight, cond: () => boolean, max = 900): void => { for (let i = 0; i < max && !cond(); i++) f.tick(); };

describe('mob_blood_wolf (charger)', () => {
  it('is deterministic: same seed -> same hash, a different seed diverges', () => {
    const a = fight(7), b = fight(7), c = fight(8);
    run(a, 1500); run(b, 1500); run(c, 1500);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());
  });
  it('shows a telegraph through tell + lunge, the tell being the table value (>= 250 ms)', () => {
    const f = fight(1);
    until(f, () => f.world.hazards.length > 0, 600);
    const h = f.world.hazards[0]!;
    expect(h.owner).toBe(f.mobs[0]);
    expect(h.duration).toBe(TELL + LUNGE);
    expect(TELL).toBeGreaterThanOrEqual(msToTicks(250));
    expect(f.events.some((e) => e.type === 'telegraph' && e.hazard === h.id)).toBe(true);
    // The wolf keeps the countdown: the hazard resolves exactly once, and is then gone.
    until(f, () => f.world.hazards.length === 0);
    expect(f.events.filter((e) => e.type === 'hazard-resolved')).toHaveLength(1);
  });
  it('lands the hit when the lunge ends, not when the windup does', () => {
    const f = fight(3), wolf = wolfOf(f);
    let telegraphTick = -1, lungeStart = -1, lungeEnd = -1;
    for (let i = 0; i < 900 && lungeEnd < 0; i++) {
      const before = wolf.ai.state; f.tick();
      if (telegraphTick < 0 && f.world.hazards.length > 0) telegraphTick = f.world.tick;
      if (before !== 'charge' && wolf.ai.state === 'charge') lungeStart = f.world.tick;
      if (before === 'charge' && wolf.ai.state === 'recover') lungeEnd = f.world.tick;
    }
    const hit = f.events.find((e) => e.type === 'hit' && e.target === f.player);
    expect(hit).toBeDefined();
    expect(hit!.tick).toBe(lungeEnd);
    expect(hit!.tick - lungeStart).toBeGreaterThanOrEqual(LUNGE - 1); // after the whole lunge, not at its start
    expect(lungeEnd - telegraphTick).toBeGreaterThanOrEqual(TELL + LUNGE - 2);
    expect(f.world.stats.hitsTaken).toBe(1);
  });
  it('a well-timed dash (real guard window) is a dodge that opens the counter window, not a hit', () => {
    const f = fight(3);
    until(f, () => f.world.hazards.length > 0, 600);
    until(f, () => f.world.hazards[0]!.timer <= COMBAT.guardCheck - 4, 100);
    f.tick({ move: { x: 0, y: 1 }, dash: true });
    until(f, () => f.events.some((e) => e.type === 'hazard-resolved'), 100);
    expect(f.world.stats.hitsTaken).toBe(0);
    expect(f.events.some((e) => e.type === 'dodge-counter')).toBe(true);
    expect(f.world.actors[0]!.combat.counterWindow).toBeGreaterThan(0);
  });
  it('is open after the charge: it stands still for the recover window', () => {
    const f = fight(5), wolf = wolfOf(f);
    let still = 0, max = 0;
    for (let i = 0; i < 900; i++) { f.tick(); if (wolf.ai.state === 'recover') { still++; max = Math.max(max, still); expect(wolf.vel).toEqual({ x: 0, y: 0 }); } else still = 0; }
    expect(max).toBeGreaterThanOrEqual(msToTicks(500));
  });
  it('a stagger cancels the charge and its telegraph, is consumed, and the wolf charges again', () => {
    const f = fight(2), wolf = wolfOf(f);
    until(f, () => wolf.ai.state === 'windup', 600);
    expect(wolf.ai.state).toBe('windup'); expect(f.world.hazards).toHaveLength(1);
    wolf.combat.hurt = 9; f.tick();
    expect(f.world.hazards).toHaveLength(0); expect(wolf.ai.state).toBe('recover'); expect(wolf.combat.hurt).toBe(0);
    until(f, () => wolf.ai.state === 'chase', 600);
    expect(wolf.ai.state).toBe('chase'); // not locked in recover
    until(f, () => wolf.ai.state === 'windup', 600);
    expect(wolf.ai.state).toBe('windup'); // and charges again
  });
  it('a wolf killed mid-windup leaves no telegraph behind', () => {
    const f = fight(2), wolf = wolfOf(f);
    until(f, () => wolf.ai.state === 'windup', 600);
    expect(f.world.hazards).toHaveLength(1);
    damageEnemy(f.world, wolf, 999, f.player, false, f.events);
    run(f, COMBAT.freezeHit + 2); // hit-stop first
    expect(f.world.hazards).toHaveLength(0);
    expect(f.events.filter((e) => e.type === 'hazard-resolved')).toHaveLength(0);
  });
  it('idles with no player', () => {
    const f = fight(4);
    f.world.actors[0]!.diedTick = 0;
    run(f, 30);
    expect(wolfOf(f).vel).toEqual({ x: 0, y: 0 });
    expect(wolfOf(f).clip).toBe('idle');
  });
});
