import { describe, expect, it } from 'vitest';
import type { Hazard } from '../contracts/combat.ts';
import { endFrame, liveFrame, SummonFx, SUMMON_LAST } from './summon-fx.ts';

const hz = (id: number, over: object = {}) => ({ id, kind: 'circle', owner: 2, x: 100, y: 80, timer: 50, duration: 60, ...over }) as unknown as Hazard;
const boss = (h: Hazard) => h.owner === 2 && h.kind === 'circle';

describe('summon VFX timeline', () => {
  it('start section once (frames 0-17 at 30 fps = 2 ticks each), then the loop section 18-41 repeats', () => {
    expect([0, 1, 2, 35].map(liveFrame)).toEqual([0, 0, 1, 17]);
    expect(liveFrame(36)).toBe(18);
    expect(liveFrame(36 + 47)).toBe(41);
    expect(liveFrame(36 + 48)).toBe(18);
  });
  it('the end section plays 42-74 once after the hazard resolves, then is gone', () => {
    expect(endFrame(0)).toBe(42);
    expect(endFrame(2 * (SUMMON_LAST - 42))).toBe(SUMMON_LAST);
    expect(endFrame(2 * (SUMMON_LAST - 41))).toBeNull();
  });
});

describe('SummonFx', () => {
  it('shows a live ring for the boss circle only, then plays the end section after the hazard is gone, then drops it', () => {
    const fx = new SummonFx();
    expect(fx.update([hz(1, { owner: 9 })], boss, 100)).toEqual([]);            // a mob's circle is not the summon
    expect(fx.update([hz(2)], boss, 100)).toEqual([{ x: 100, y: 80, frame: 5 }]); // 10 ticks into the hazard
    expect(fx.update([hz(2)], boss, 140)[0]!.frame).toBeGreaterThanOrEqual(18);   // looping
    expect(fx.update([], boss, 141)[0]).toMatchObject({ frame: 42 });             // resolved: the end section starts
    expect(fx.update([], boss, 141 + 2 * 33)).toEqual([]);                         // played out
  });
});
