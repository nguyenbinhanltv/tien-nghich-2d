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

import { readFileSync as readLocale } from 'node:fs';
import { join as joinPath, dirname as dirOf } from 'node:path';
import { fileURLToPath as toPath } from 'node:url';
import { measure } from './pixel-font.ts';
import { wrapText as wrapName } from './pixel-text.ts';
import { FLOOR_LABEL_MAX_W as FLOOR_W, RUN_LINES_MAX_W as RUN_W, BOSS_NAME_MAX_W as NAME_W } from './hud-layout.ts';

describe('long names fit the pixel HUD in both languages (no cut, no overflow)', () => {
  const root = joinPath(dirOf(toPath(import.meta.url)), '../..');
  const load = (f: string) => JSON.parse(readLocale(joinPath(root, f), 'utf8')) as Record<string, string>;
  for (const lang of ['en', 'vi']) {
    const names = load(`content/locale/${lang}.json`), ui = load(`locale/${lang}.json`);
    it(`${lang}: every mob and boss name wraps into the boss-name column in at most 2 lines, never truncated`, () => {
      for (const [k, v] of Object.entries(names)) {
        if (!/^(mob_|boss_)/.test(k)) continue;
        const lines = wrapName(v, NAME_W, 2);
        expect(lines.join(' '), k).toBe(v);
        for (const l of lines) expect(measure(l), `${k}: ${l}`).toBeLessThanOrEqual(NAME_W);
      }
    });
    it(`${lang}: place names fit the floor label and realm/cluster lines fit the run band on one line`, () => {
      for (const k of Object.keys(names).concat(Object.keys(ui))) {
        const v = names[k] ?? ui[k]!;
        if (k.startsWith('place.')) expect(measure(v), k).toBeLessThanOrEqual(FLOOR_W);
        if (/^realm\.\d$/.test(k)) expect(measure(v), k).toBeLessThanOrEqual(RUN_W);
      }
      expect(measure(`${ui['hud.cluster']} 3/3`)).toBeLessThanOrEqual(RUN_W);
    });
  }
});
