// Pixel-font text as lit pixels for the HUD: wraps the code-drawn font of ui/pixel-font.ts (full Vietnamese diacritics) and trims
// the empty rows above and below, so a line of digits is 7 px high instead of the 14-px cell and labels sit tight under a bar.
import { missingChars, rasterize } from './pixel-font.ts';

export interface TextPixels { w: number; h: number; pixels: [number, number][] }

/** Lit pixels [x, y] of `text`, rows trimmed top and bottom. Characters the font cannot draw are left out. */
export function textPixels(text: string): TextPixels {
  const drawable = [...text].filter((c) => !missingChars(c).length).join('');
  if (!drawable.trim()) return { w: 0, h: 0, pixels: [] };
  const b = rasterize(drawable);
  let top = b.h, bottom = -1;
  const lit: [number, number][] = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.px[y * b.w + x]) { lit.push([x, y]); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (bottom < 0) return { w: 0, h: 0, pixels: [] };
  return { w: b.w, h: bottom - top + 1, pixels: lit.map(([x, y]) => [x, y - top] as [number, number]) };
}

/** Height of a line of digits, used to stack HUD elements under a number. */
export const DIGIT_H = textPixels('0123456789').h;
