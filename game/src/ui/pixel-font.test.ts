import { describe, expect, it } from 'vitest';
import { canDraw, CELL_H, measure, missingChars, rasterize, toAscii } from './pixel-font.ts';
import { uiTables } from './strings.ts';

const BASES = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'];
const TONES = ['', '́', '̀', '̉', '̃', '̣'];
const vietnamese = (): string[] => {
  const out: string[] = [];
  for (const b of BASES) for (const t of TONES) for (const c of [b, b.toUpperCase()]) out.push((c.normalize('NFD') + t).normalize('NFC'));
  return [...out, 'đ', 'Đ'];
};

describe('pixel font', () => {
  it('draws every precomposed Vietnamese letter, each with a different picture', () => {
    const all = vietnamese();
    expect(all.length).toBe(146);
    const seen = new Map<string, string>();
    for (const ch of all) {
      expect(canDraw(ch), ch).toBe(true);
      const pic = toAscii(rasterize(ch));
      expect(pic.includes('#'), ch).toBe(true);
      expect(seen.get(pic), `${ch} looks like ${seen.get(pic)}`).toBeUndefined();
      seen.set(pic, ch);
    }
  });
  it('keeps every mark inside the 14-row cell (stacked circumflex + tone on a capital too)', () => {
    for (const ch of ['Ấ', 'Ầ', 'Ẫ', 'Ẳ', 'Ặ', 'Ế', 'Ộ', 'Ớ', 'Ự', 'ấ', 'ộ', 'ỵ', 'Ỵ', 'ị']) {
      const b = rasterize(ch);
      expect(b.h).toBe(CELL_H);
      expect(b.px.some((v) => v === 1)).toBe(true);
    }
    // a capital with circumflex + acute reaches row 0, the cap line is row 4
    expect(toAscii(rasterize('Ấ')).split('\n')[0]).toContain('#');
  });
  it('every character of every UI string can be drawn, so no glyph is silently dropped', () => {
    for (const t of [uiTables.vi, uiTables.en]) for (const [k, v] of Object.entries(t)) expect(missingChars(v), k).toEqual([]);
  });
  it('HUD strings fit the 384 px view with room to spare (no overflow of the pixel HUD)', () => {
    for (const t of [uiTables.vi, uiTables.en]) {
      for (const [k, v] of Object.entries(t)) if (k.startsWith('hud.') && k !== 'hud.touch_hint') expect(measure(v), k).toBeLessThanOrEqual(120);
      for (const [k, v] of Object.entries(t)) if (k.startsWith('result.')) expect(measure(v), k).toBeLessThanOrEqual(200);
    }
  });
  it('reports characters it cannot draw instead of guessing', () => {
    expect(missingChars('Huyết Hải 12 ☃')).toEqual(['☃']);
    expect(measure('ơ')).toBe(7); expect(measure('a b')).toBe(6 + 4 + 6);
  });
});
