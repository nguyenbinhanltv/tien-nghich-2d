// Pixel-font text as lit pixels for the HUD: wraps the code-drawn font of ui/pixel-font.ts (full Vietnamese diacritics) and trims
// the empty rows above and below, so a line of digits is 7 px high instead of the 14-px cell and labels sit tight under a bar.
import { measure, missingChars, rasterize } from './pixel-font.ts';

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

/**
 * Break `text` into at most `maxLines` lines no wider than `maxW` px in the pixel font: words wrap greedily, a word longer than a
 * line is cut, and whatever does not fit in the last line ends with "." marks. Never returns a line wider than `maxW`.
 */
export function wrapText(text: string, maxW: number, maxLines = 2): string[] {
  const cut = (w: string, room: number): string => { let o = ''; for (const c of w) { if (measure(o + c) > room) break; o += c; } return o; };
  const lines: string[] = [];
  let cur = '';
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next) <= maxW) { cur = next; continue; }
    if (cur) { lines.push(cur); cur = ''; }
    if (lines.length >= maxLines) break;
    cur = measure(word) <= maxW ? word : cut(word, maxW);
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const consumed = lines.join(' ').split(' ').length;
  if (words.length > consumed && lines.length) {
    // text left over: end the last line with ".." (as much of it as fits)
    let last = lines[lines.length - 1]!;
    while (last && measure(`${last}..`) > maxW) last = last.slice(0, -1).trimEnd();
    lines[lines.length - 1] = `${last}..`;
  }
  return lines.slice(0, maxLines);
}
