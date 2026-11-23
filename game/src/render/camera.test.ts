import { describe, expect, it } from 'vitest';
import { fitView, isPortrait } from './camera.ts';

describe('fitView (integer device-pixel scale, letterboxed)', () => {
  it('desktop 1280x720 at DPR 1 is x3 (1152x648), centred', () => {
    const f = fitView(1280, 720, 1);
    expect(f).toMatchObject({ scale: 3, cssW: 1152, cssH: 648, left: 64, top: 36 });
  });
  it('1920x1080 is exactly x5 with no bars', () => {
    expect(fitView(1920, 1080, 1)).toMatchObject({ scale: 5, cssW: 1920, cssH: 1080, left: 0, top: 0 });
  });
  it('landscape iPhone 844x390 at DPR 3 is x5 in device pixels (640x360 css), not x1', () => {
    const f = fitView(844, 390, 3);
    expect(f.scale).toBe(5);
    expect(f.cssW * 3).toBe(1920);
    expect(f.cssH * 3).toBe(1080);
    expect(f.top).toBeCloseTo(15);
  });
  it('x10 on a 3840x2160 screen', () => { expect(fitView(3840, 2160, 1).scale).toBe(10); });
  it('never goes below x1', () => { expect(fitView(200, 100, 1).scale).toBe(1); });
  it('the scaled canvas always fits inside the window', () => {
    for (const [w, h, d] of [[844, 390, 3], [915, 412, 2.625], [667, 375, 2], [1366, 768, 1], [2560, 1440, 2]] as const) {
      const f = fitView(w, h, d);
      expect(f.cssW).toBeLessThanOrEqual(w + 1e-6);
      expect(f.cssH).toBeLessThanOrEqual(h + 1e-6);
      expect(Number.isInteger(f.scale)).toBe(true);
    }
  });
});

describe('isPortrait', () => {
  it('is true only when taller than wide', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(500, 500)).toBe(false);
  });
});

import { followScroll, snapPx } from './camera.ts';
describe('snapPx', () => {
  it('rounds to whole logical pixels and never returns -0', () => {
    expect(snapPx(2.4)).toBe(2);
    expect(snapPx(2.5)).toBe(3);
    expect(snapPx(-0.2)).toBe(0);
    expect(Object.is(snapPx(-0.2), 0)).toBe(true);
  });
});

describe('followScroll (room 384x224 in a 384x216 view)', () => {
  it('shows the last wall row when the player is low, the first when high, and never scrolls sideways', () => {
    expect(followScroll(384, 224, 100, 30)).toEqual({ x: 0, y: 0 });
    expect(followScroll(384, 224, 100, 200)).toEqual({ x: 0, y: 8 });
    expect(followScroll(384, 224, 100, 112)).toEqual({ x: 0, y: 4 });
  });
  it('is whole pixels and stays inside [0, room - view]', () => {
    for (let y = -20; y < 260; y += 3.7) {
      const s = followScroll(384, 224, 50, y);
      expect(Number.isInteger(s.y)).toBe(true);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(8);
    }
  });
  it('a room that fits the view does not scroll; a wide room scrolls on x', () => {
    expect(followScroll(384, 216, 10, 10)).toEqual({ x: 0, y: 0 });
    expect(followScroll(480, 216, 400, 10).x).toBe(96);
  });
});
