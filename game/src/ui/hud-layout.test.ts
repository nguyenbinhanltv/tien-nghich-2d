import { describe, expect, it } from 'vitest';
import { BAR_W, barCropWidth, digitPixels, HUD_POS, MARGIN, ratio } from './hud-layout.ts';
import { VIEW_W } from '../contracts/world.ts';

describe('barCropWidth', () => {
  it('full, half and empty; the left end is fixed so the width is all that changes', () => {
    expect(barCropWidth(6, 6)).toBe(BAR_W);
    expect(barCropWidth(3, 6)).toBe(32);
    expect(barCropWidth(0, 6)).toBe(0);
  });
  it('any life left shows at least one pixel, and bad numbers show nothing', () => {
    expect(barCropWidth(1, 1000)).toBe(1);
    expect(barCropWidth(-4, 6)).toBe(0);
    expect(barCropWidth(5, 0)).toBe(0);
    expect(barCropWidth(99, 6)).toBe(BAR_W);
  });
});

describe('ratio', () => { it('clamps to 0..1', () => { expect(ratio(54, 54)).toBe(1); expect(ratio(-1, 54)).toBe(0); expect(ratio(80, 54)).toBe(1); expect(ratio(1, 0)).toBe(0); }); });

describe('layout', () => {
  it('keeps both bars inside the logical view and clear of the edges', () => {
    expect(HUD_POS.playerBar.x).toBeGreaterThanOrEqual(MARGIN.x);
    expect(HUD_POS.bossBar.x + BAR_W).toBeLessThanOrEqual(VIEW_W - MARGIN.x);
    expect(HUD_POS.bossBar.x).toBeGreaterThan(HUD_POS.playerBar.x + BAR_W);
  });
});

describe('digitPixels', () => {
  it('draws "6/6" as three glyphs with a 1 px gap', () => {
    const d = digitPixels('6/6');
    expect(d.h).toBe(5);
    expect(d.w).toBe(3 * 3 + 2);
    expect(d.pixels.length).toBeGreaterThan(20);
  });
  it('every digit has lit pixels in its own cell and nothing outside the 3x5 cell', () => {
    for (const ch of '0123456789/') {
      const d = digitPixels(ch);
      expect(d.pixels.length, ch).toBeGreaterThan(2);
      for (const [x, y] of d.pixels) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(3); expect(y).toBeLessThan(5); }
    }
  });
  it('skips characters it has no glyph for (letters are drawn by the sharp text layer)', () => {
    expect(digitPixels('a').pixels).toEqual([]);
  });
});
