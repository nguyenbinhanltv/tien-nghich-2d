// Pixel HUD maths (E8.1), pure so it is unit-tested: bar crop width, safe positions at 384x216, and a 3x5 pixel digit font.
// The HUD is drawn at the logical resolution and scaled by the integer camera scale like everything else; sharp text (menus,
// result banner) lives in the DOM layer instead (owner decision 2026-11-23: pixel HUD, sharp menus).
import { VIEW_W } from '../contracts/world.ts';

export const BAR_W = 64;
export const BAR_H = 8;

/** Width in pixels of the filled part of a 64-wide bar. The left end stays fixed (GDD); any life left shows at least 1 px. */
export function barCropWidth(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(1, Math.min(BAR_W, Math.round((BAR_W * value) / max)));
}

/** 0..1 of the counter window or dodge cooldown left, clamped. */
export const ratio = (value: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);

/** Margin from the screen edge in logical px. Larger on the sides, where phone notches and rounded corners sit. */
export const MARGIN = { x: 8, y: 6 } as const;
export const HUD_POS = {
  playerBar: { x: MARGIN.x, y: MARGIN.y },
  bossBar: { x: Math.round((VIEW_W - BAR_W) / 2), y: MARGIN.y },
} as const;

// 3 wide x 5 high; '#' is a lit pixel.
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  ' ': ['...', '...', '...', '...', '...'],
};
export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** Lit pixels [x, y] of `text` laid out left to right with a 1 px gap. Unknown characters are skipped (digits and "/" only). */
export function digitPixels(text: string): { w: number; h: number; pixels: [number, number][] } {
  const pixels: [number, number][] = [];
  let x = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, y) => { for (let i = 0; i < GLYPH_W; i++) if (row[i] === '#') pixels.push([x + i, y]); });
    x += GLYPH_W + 1;
  }
  return { w: Math.max(0, x - 1), h: GLYPH_H, pixels };
}
