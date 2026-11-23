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

import { ALL_TABLES } from '../i18n/locales.ts';
import { BOSS_NAME_MAX_W, FLOOR_COLUMN_LEFT, FLOOR_LABEL_MAX_W, HUD_POS } from './hud-layout.ts';
import { measure } from './pixel-font.ts';
import { wrapText } from './pixel-text.ts';

describe('wrapText', () => {
  it('short text stays on one line; long text wraps at spaces into at most the allowed lines', () => {
    expect(wrapText('Quỷ Vương', 200)).toEqual(['Quỷ Vương']);
    const l = wrapText('Soul-Devouring Ghost King', 112, 2);
    expect(l).toEqual(['Soul-Devouring', 'Ghost King']);
  });
  it('never returns a line wider than the limit, even for one huge word or too many lines', () => {
    for (const t of ['Pneumonoultramicroscopicsilicovolcanoconiosis', 'a b c d e f g h i j k l m n o p q r s t u v w x y z', 'Soul-Devouring Ghost King of the Drowned Court']) {
      const lines = wrapText(t, 60, 2);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const ln of lines) expect(measure(ln), ln).toBeLessThanOrEqual(60);
    }
    expect(wrapText('a b c d e f g h i j k l m n o', 30, 2).at(-1)).toMatch(/\.\.$/);
    expect(wrapText('', 50)).toEqual([]);
  });
});

describe('the top-right HUD band stays clear of the minimap column (both languages)', () => {
  const bosses = Object.keys(ALL_TABLES.vi).filter((k) => k.startsWith('boss_') || k.startsWith('mob_'));
  it('every boss and mob name, wrapped, ends left of the floor column', () => {
    expect(BOSS_NAME_MAX_W).toBeGreaterThan(80);
    for (const loc of ['vi', 'en'] as const) for (const k of bosses) {
      for (const line of wrapText(ALL_TABLES[loc][k]!, BOSS_NAME_MAX_W, 2)) expect(HUD_POS.bossBar.x + measure(line), `${loc}/${k}: ${line}`).toBeLessThanOrEqual(FLOOR_COLUMN_LEFT - 4);
    }
  });
  it('the English boss name is wrapped (it is 146 px on one line) and still fits', () => {
    expect(measure(ALL_TABLES.en['boss_ghost_king']!)).toBeGreaterThan(BOSS_NAME_MAX_W);
    const lines = wrapText(ALL_TABLES.en['boss_ghost_king']!, BOSS_NAME_MAX_W, 2);
    expect(lines.length).toBe(2);
  });
  it('no boss or mob name is ever truncated by the wrap (no ".." in either language)', () => {
    for (const loc of ['vi', 'en'] as const) for (const k of bosses) expect(wrapText(ALL_TABLES[loc][k]!, BOSS_NAME_MAX_W, 2).join(' '), `${loc}/${k}`).toBe(ALL_TABLES[loc][k]);
  });
  it('the floor label fits its reserved width in both languages, for every place.* name', () => {
    for (const loc of ['vi', 'en'] as const) for (const k of Object.keys(ALL_TABLES[loc]).filter((x) => x.startsWith('place.'))) expect(measure(ALL_TABLES[loc][k]!), `${loc}/${k}`).toBeLessThanOrEqual(FLOOR_LABEL_MAX_W);
  });
});
