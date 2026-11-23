import { describe, expect, it } from 'vitest';
import { VIEW_H, VIEW_W } from '../contracts/world.ts';
import { clampToWalk, nearestStation, SPAWN, STATIONS, WALK } from './abode-layout.ts';

describe('abode layout', () => {
  it('every station is reachable inside the walkable area and in the view', () => {
    for (const s of STATIONS) {
      expect(s.x).toBeGreaterThan(0); expect(s.x).toBeLessThan(VIEW_W); expect(s.y).toBeLessThan(VIEW_H);
      const c = clampToWalk(s.x, s.y + s.reach - 2);
      expect(nearestStation(c.x, c.y)?.id).toBe(s.id);
    }
  });
  it('stations do not overlap each other and the spawn is free', () => {
    for (const a of STATIONS) for (const b of STATIONS) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
    expect(nearestStation(SPAWN.x, SPAWN.y)).toBeNull();
    expect(clampToWalk(SPAWN.x, SPAWN.y)).toEqual(SPAWN);
  });
  it('clamps to the walkable rectangle', () => {
    expect(clampToWalk(-5, -5)).toEqual({ x: WALK.x0, y: WALK.y0 });
    expect(clampToWalk(999, 999)).toEqual({ x: WALK.x1, y: WALK.y1 });
  });
});

describe('the Hằng Nhạc gate', () => {
  it('is a station of its own, in reach only near itself and away from the Huyết Hải gate', () => {
    const g = STATIONS.find((s) => s.id === 'gate_hengyue')!, b = STATIONS.find((s) => s.id === 'gate')!;
    expect(nearestStation(g.x, g.y)?.id).toBe('gate_hengyue');
    expect(nearestStation(b.x, b.y)?.id).toBe('gate');
    expect(Math.hypot(g.x - b.x, g.y - b.y)).toBeGreaterThan(g.reach + b.reach - 10);
  });
});
