import { describe, expect, it } from 'vitest';
import { BAR_W, barCropWidth, HUD_POS, MARGIN, ratio } from './hud-layout.ts';
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
