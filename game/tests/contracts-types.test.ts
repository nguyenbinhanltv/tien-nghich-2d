import { describe, expect, it } from 'vitest';
import { COMBAT, MAX_ACTORS, MAX_PROJECTILES, msToTicks, pressureAtFloor, PROJECTILE_KINDS, SAVE_VERSION, secondsToTicks, TICK_HZ, VIEW_H, VIEW_W } from '../src/contracts/index.ts';
import { createWorld } from '../src/sim/loop.ts';
import { hashState } from '../src/sim/hash.ts';

describe('lane contracts (E0.2)', () => {
  it('the logical view is 16:9 landscape and the tick is 60 Hz', () => {
    expect(VIEW_W / VIEW_H).toBeCloseTo(16 / 9, 5);
    expect(TICK_HZ).toBe(60);
  });
  it('design data converts to whole ticks, and the model constants are the 280 ms / 900 ms windows', () => {
    expect(msToTicks(280)).toBe(COMBAT.dodgeGuard);
    expect(msToTicks(900)).toBe(COMBAT.counterWindow);
    expect(secondsToTicks(0.15)).toBe(COMBAT.strikeWindup);
    expect(secondsToTicks(0.85)).toBe(COMBAT.dodgeCooldown);
  });
  it('a fresh world carries every field of the contract and a pre-sized pool', () => {
    const w = createWorld(1);
    expect(w.projectiles.capacity).toBe(MAX_PROJECTILES);
    expect(w.projectiles.x).toBeInstanceOf(Float64Array);
    expect(MAX_ACTORS).toBeGreaterThan(0);
    expect(PROJECTILE_KINDS.length).toBeGreaterThan(0);
    expect(w.run).toBeNull();
    expect(hashState(w.stats)).toBe(hashState({ hits: 0, dodges: 0, counters: 0, counterHits: 0, hitsTaken: 0 }));
  });
  it('the endless-loop pressure matches the GDD: floor 1/5/20 gives 1.00/1.15/1.60, capped at 2.5', () => {
    expect(pressureAtFloor(1)).toBe(1);
    expect(pressureAtFloor(5)).toBeCloseTo(1.15, 10);
    expect(pressureAtFloor(20)).toBeCloseTo(1.6, 10);
    expect(pressureAtFloor(999)).toBe(2.5);
  });
  it('save version is a positive integer', () => { expect(Number.isInteger(SAVE_VERSION) && SAVE_VERSION > 0).toBe(true); });
});
