import { describe, expect, it } from 'vitest';
import { DIGIT_H, textPixels } from './pixel-text.ts';

describe('textPixels', () => {
  it('digits and "/" are drawn by the pixel font and trimmed to the capital height (7 rows)', () => {
    for (const ch of '0123456789/') expect(textPixels(ch).pixels.length, ch).toBeGreaterThan(2);
    expect(DIGIT_H).toBe(7);
    const t = textPixels('12/12');
    expect(t.h).toBe(7);
    expect(t.w).toBeGreaterThan(20);
    for (const [x, y] of t.pixels) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(t.w); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(t.h); }
  });
  it('the boss name keeps its Vietnamese marks (taller than plain capitals) and the horn width', () => {
    const name = textPixels('Quỷ Vương');
    expect(name.pixels.length).toBeGreaterThan(40);
    expect(name.h).toBeGreaterThan(DIGIT_H);
    expect(name.w).toBeGreaterThan(textPixels('Quy Vuong').w - 1);
  });
  it('empty or undrawable text gives nothing, never throws', () => {
    expect(textPixels('')).toEqual({ w: 0, h: 0, pixels: [] });
    expect(textPixels('   ').pixels).toEqual([]);
    expect(textPixels('漢字').pixels).toEqual([]);
  });
});
