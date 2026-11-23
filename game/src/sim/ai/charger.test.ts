import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { MobRow } from '../../contracts/content.ts';
import { msToTicks } from '../../contracts/world.ts';
import { contentOf, makeFight } from './harness.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const WOLF = 'mob_blood_wolf';
const run = (f: ReturnType<typeof makeFight>, n: number, pv?: { x: number; y: number }): void => { for (let i = 0; i < n; i++) f.tick(pv); };

describe('mob_blood_wolf (charger)', () => {
  it('is deterministic: same seed -> same hash, a different seed diverges', () => {
    const a = makeFight(7, content, 190, 150, [[WOLF, 90, 120]]), b = makeFight(7, content, 190, 150, [[WOLF, 90, 120]]), c = makeFight(8, content, 190, 150, [[WOLF, 90, 120]]);
    run(a, 1500); run(b, 1500); run(c, 1500);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());
  });
  it('chases the player and starts a telegraphed charge no shorter than the table tell (>= 250 ms)', () => {
    const f = makeFight(1, content, 200, 150, [[WOLF, 60, 150]]);
    let seen = 0;
    for (let i = 0; i < 600 && !seen; i++) { f.tick(); const h = f.world.hazards[0]; if (h) seen = h.duration; }
    const tell = msToTicks(mobs.find((m) => m.id === WOLF)!.tell_ms);
    expect(seen).toBe(tell);
    expect(seen).toBeGreaterThanOrEqual(msToTicks(250));
    expect(f.events.some((e) => e.type === 'telegraph')).toBe(true);
  });
  it('hits a player who stands still but never one who leaves the rectangle during the tell', () => {
    const still = makeFight(3, content, 200, 150, [[WOLF, 60, 150]]);
    run(still, 900);
    expect(still.playerHits).toBeGreaterThan(0);
    const dodger = makeFight(3, content, 200, 150, [[WOLF, 60, 150]]);
    for (let i = 0; i < 900; i++) { const h = dodger.world.hazards[0]; dodger.tick(h ? { x: -h.dir.y * 1.5, y: h.dir.x * 1.5 } : { x: 0, y: 0 }); } // sidestep across the rectangle while a telegraph is up
    expect(dodger.playerHits).toBe(0);
  });
  it('is open after the charge: it stands still for the recover window', () => {
    const f = makeFight(5, content, 200, 150, [[WOLF, 60, 150]]);
    const wolf = f.world.actors.find((a) => a.id === f.mobs[0])!;
    let still = 0, max = 0;
    for (let i = 0; i < 900; i++) { f.tick(); if (wolf.ai.state === 'recover') { still++; max = Math.max(max, still); expect(wolf.vel).toEqual({ x: 0, y: 0 }); } else still = 0; }
    expect(max).toBeGreaterThanOrEqual(msToTicks(500));
  });
  it('a stagger cancels the charge and removes its telegraph', () => {
    const f = makeFight(2, content, 200, 150, [[WOLF, 60, 150]]);
    const wolf = f.world.actors.find((a) => a.id === f.mobs[0])!;
    for (let i = 0; i < 600 && wolf.ai.state !== 'windup'; i++) f.tick();
    expect(wolf.ai.state).toBe('windup'); expect(f.world.hazards).toHaveLength(1);
    wolf.combat.hurt = 9; f.tick();
    expect(f.world.hazards).toHaveLength(0); expect(wolf.ai.state).toBe('recover'); expect(wolf.combat.hurt).toBe(0);
    for (let i = 0; i < 600 && wolf.ai.state !== 'chase'; i++) f.tick();
    expect(wolf.ai.state).toBe('chase'); // not locked in recover
    for (let i = 0; i < 600 && wolf.ai.state !== 'windup'; i++) f.tick();
    expect(wolf.ai.state).toBe('windup'); // and charges again
  });
  it('idles with no player and ignores dead mobs', () => {
    const f = makeFight(4, content, 200, 150, [[WOLF, 60, 150]]);
    f.world.actors[0]!.diedTick = 0;
    run(f, 30);
    expect(f.world.actors[1]!.vel).toEqual({ x: 0, y: 0 });
    expect(f.world.actors[1]!.clip).toBe('idle');
  });
});
