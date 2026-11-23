import { describe, expect, it } from 'vitest';
import { Juice, SHAKE } from './juice.ts';
import type { GameEvent } from '../contracts/world.ts';

const world = { actors: [{ id: 1, role: 'player' }, { id: 2, role: 'boss' }, { id: 3, role: 'mob' }] } as never;
const hit = (target: number, counter = false): GameEvent => ({ type: 'hit', tick: 0, source: 9, target, damage: 1, counter });

describe('Juice', () => {
  it('flashes the target for a few frames then stops', () => {
    const j = new Juice();
    j.onEvents([hit(2)], world, 1000);
    expect(j.isFlashing(2, 1010)).toBe(true);
    expect(j.isFlashing(2, 1100)).toBe(false);
    expect(j.isFlashing(3, 1010)).toBe(false);
  });
  it('limits flashes per actor (no strobing) and obeys the flash switch', () => {
    const j = new Juice();
    j.onEvents([hit(2)], world, 1000);
    j.onEvents([hit(2)], world, 1090); // inside the minimum gap: no re-trigger
    expect(j.isFlashing(2, 1085)).toBe(false);
    const off = new Juice({ shake: 1, flash: false });
    off.onEvents([hit(2)], world, 1000);
    expect(off.isFlashing(2, 1010)).toBe(false);
  });
  it('shakes by whole pixels, strongest when the player is hit, and settles to exactly 0', () => {
    const j = new Juice();
    j.onEvents([hit(1)], world, 0);
    let maxPlayer = 0;
    for (let t = 0; t < SHAKE.playerHit.ms; t += 8) { const o = j.offset(t); expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true); maxPlayer = Math.max(maxPlayer, Math.abs(o.x), Math.abs(o.y)); }
    expect(maxPlayer).toBeGreaterThanOrEqual(1);
    expect(maxPlayer).toBeLessThanOrEqual(SHAKE.playerHit.amp);
    expect(j.offset(SHAKE.playerHit.ms + 50)).toEqual({ x: 0, y: 0 });
    const m = new Juice(); m.onEvents([hit(3)], world, 0);
    let maxMob = 0; for (let t = 0; t < 120; t += 8) { const o = m.offset(t); maxMob = Math.max(maxMob, Math.abs(o.x), Math.abs(o.y)); }
    expect(maxMob).toBeLessThanOrEqual(SHAKE.hit.amp);
  });
  it('the shake slider scales it and 0 turns it off', () => {
    const j = new Juice({ shake: 0, flash: true });
    j.onEvents([hit(1)], world, 0);
    for (let t = 0; t < 200; t += 10) expect(j.offset(t)).toEqual({ x: 0, y: 0 });
  });
  it('the boss falling gives the biggest shake', () => {
    const j = new Juice();
    j.onEvents([{ type: 'actor-died', tick: 0, actor: 2 }], world, 0);
    let mx = 0; for (let t = 0; t < 400; t += 8) { const o = j.offset(t); mx = Math.max(mx, Math.abs(o.x), Math.abs(o.y)); }
    expect(mx).toBeGreaterThan(SHAKE.hit.amp);
  });
});
