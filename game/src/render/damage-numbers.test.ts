import { describe, expect, it } from 'vitest';
import { DamageNumbers, MAX_ALIVE, NUMBER_MS, RISE_PX, TONE_COLOUR } from './damage-numbers.ts';

const world = { actors: [{ id: 1, role: 'player', pos: { x: 50, y: 80 }, radius: 6 }, { id: 2, role: 'mob', pos: { x: 120, y: 60 }, radius: 7 }] } as never;
const hit = (target: number, damage: number, counter = false) => ({ type: 'hit', tick: 1, source: 9, target, damage, counter }) as never;

describe('DamageNumbers', () => {
  it('shows the damage above the target, in the tone of who was hit and how', () => {
    const d = new DamageNumbers();
    d.onEvents([hit(2, 3), hit(2, 5, true), hit(1, 2)], world, 0);
    const v = d.visible(0);
    expect(v.map((n) => [n.text, n.tone])).toEqual([['3', 'hit'], ['5', 'counter'], ['2', 'hurt']]);
    expect(v[0]!.y).toBeLessThan(60);
    expect(Object.values(TONE_COLOUR)).toEqual([0xd4d0d8, 0xe0b030, 0xd03a4a]);
  });
  it('ignores zero damage (the summon call) and unknown targets, and nothing shows when disabled', () => {
    const d = new DamageNumbers();
    d.onEvents([hit(2, 0), hit(99, 4)], world, 0);
    expect(d.visible(0)).toEqual([]);
    d.enabled = false;
    d.onEvents([hit(2, 4)], world, 0);
    expect(d.visible(0)).toEqual([]);
  });
  it('climbs RISE_PX in whole pixels with an ease-out and is gone after NUMBER_MS', () => {
    const d = new DamageNumbers();
    d.onEvents([hit(2, 3)], world, 1000);
    const y0 = d.visible(1000)[0]!.y;
    const mid = d.visible(1000 + NUMBER_MS / 2)[0]!.y;
    const end = d.visible(1000 + NUMBER_MS - 1)[0]!.y;
    expect(Number.isInteger(mid)).toBe(true);
    expect(y0 - mid).toBeGreaterThan(RISE_PX / 2);
    expect(y0 - end).toBeLessThanOrEqual(RISE_PX);
    expect(d.visible(1000 + NUMBER_MS)).toEqual([]);
  });
  it('keeps at most MAX_ALIVE numbers', () => {
    const d = new DamageNumbers();
    d.onEvents(Array.from({ length: MAX_ALIVE + 5 }, () => hit(2, 1)), world, 0);
    expect(d.visible(0)).toHaveLength(MAX_ALIVE);
  });
});
