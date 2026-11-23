// Pixel font with full Vietnamese diacritics for the pixel HUD (plan E8.2). Code-drawn: no image file, the glyphs are bit rows
// in this file and are composed at run time, so every precomposed Vietnamese letter (base + circumflex/breve/horn + tone mark
// + dot below) exists without hand-drawing 134 variants. Sharp menus use HTML text instead (owner decision); this is for the HUD.
// STATUS: art approved by the project owner on 2026-11-23 22:47 (+07:00), "Duyệt" (item 3 of the four review questions; see game/public/fonts/README.md).
// The approval covers the glyph art as it is on main, not the HUD layout. It draws white pixels only; the caller tints them from the 43-colour palette.
//
// Cell: 14 rows. Rows 0-3 are the accent zone, rows 4-10 hold capitals/ascenders (baseline at row 10), rows 11-12 descenders,
// row 11 or 13 the dot-below. Advance is 6 px (7 for letters with a horn, 4 for a space).

export const CELL_H = 14;
export const BASELINE_TOP = 4; // first row of a capital
const ADV = 6;

/** Glyph rows from its own top; `t` is the first row below the capital line (2 = x-height letters, 1 = t). */
interface G { t: number; r: string[] }
const g = (t: number, ...r: string[]): G => ({ t, r });
const cap = (...r: string[]): G => g(0, ...r);

const GLYPHS: Record<string, G> = {
  A: cap('.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  B: cap('####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'),
  C: cap('.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'),
  D: cap('####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'),
  E: cap('#####', '#....', '#....', '####.', '#....', '#....', '#####'),
  F: cap('#####', '#....', '#....', '####.', '#....', '#....', '#....'),
  G: cap('.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'),
  H: cap('#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  I: cap('#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'),
  J: cap('..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'),
  K: cap('#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'),
  L: cap('#....', '#....', '#....', '#....', '#....', '#....', '#####'),
  M: cap('#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'),
  N: cap('#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'),
  O: cap('.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'),
  P: cap('####.', '#...#', '#...#', '####.', '#....', '#....', '#....'),
  Q: cap('.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'),
  R: cap('####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'),
  S: cap('.####', '#....', '#....', '.###.', '....#', '....#', '####.'),
  T: cap('#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'),
  U: cap('#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'),
  V: cap('#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'),
  W: cap('#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'),
  X: cap('#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'),
  Y: cap('#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'),
  Z: cap('#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'),
  a: g(2, '.###.', '....#', '.####', '#...#', '.####'),
  b: cap('#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'),
  c: g(2, '.###.', '#...#', '#....', '#...#', '.###.'),
  d: cap('....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'),
  e: g(2, '.###.', '#...#', '#####', '#....', '.###.'),
  f: cap('..##.', '.#..#', '.#...', '###..', '.#...', '.#...', '.#...'),
  g: g(2, '.####', '#...#', '#...#', '.####', '....#', '....#', '.###.'),
  h: cap('#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'),
  i: cap('..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'),
  j: cap('...#.', '.....', '..##.', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'),
  k: cap('#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'),
  l: cap('.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'),
  m: g(2, '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'),
  n: g(2, '####.', '#...#', '#...#', '#...#', '#...#'),
  o: g(2, '.###.', '#...#', '#...#', '#...#', '.###.'),
  p: g(2, '####.', '#...#', '#...#', '####.', '#....', '#....', '#....'),
  q: g(2, '.####', '#...#', '#...#', '.####', '....#', '....#', '....#'),
  r: g(2, '#.##.', '##..#', '#....', '#....', '#....'),
  s: g(2, '.####', '#....', '.###.', '....#', '####.'),
  t: g(1, '..#..', '####.', '..#..', '..#..', '..#..', '...##'),
  u: g(2, '#...#', '#...#', '#...#', '#..##', '.##.#'),
  v: g(2, '#...#', '#...#', '#...#', '.#.#.', '..#..'),
  w: g(2, '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'),
  x: g(2, '#...#', '.#.#.', '..#..', '.#.#.', '#...#'),
  y: g(2, '#...#', '#...#', '#...#', '.####', '....#', '....#', '.###.'),
  z: g(2, '#####', '...#.', '..#..', '.#...', '#####'),
  '0': cap('.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'),
  '1': cap('..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'),
  '2': cap('.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'),
  '3': cap('.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'),
  '4': cap('...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'),
  '5': cap('#####', '#....', '####.', '....#', '....#', '#...#', '.###.'),
  '6': cap('.###.', '#....', '####.', '#...#', '#...#', '#...#', '.###.'),
  '7': cap('#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'),
  '8': cap('.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'),
  '9': cap('.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'),
  '.': g(6, '..#..'),
  ',': g(6, '..#..', '.#...'),
  ':': g(2, '..#..', '.....', '.....', '..#..'),
  '!': cap('..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'),
  '?': cap('.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'),
  '-': g(3, '.###.'),
  '–': g(3, '#####'),
  '·': g(3, '..#..'),
  '/': cap('....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'),
  '(': cap('...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'),
  ')': cap('.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'),
  '+': g(1, '..#..', '..#..', '#####', '..#..', '..#..'),
  '%': cap('##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'),
  "'": cap('..#..', '..#..', '.#...'),
  '"': cap('.#.#.', '.#.#.', '.....'),
  '…': g(6, '#.#.#'),
};
// stroke-through letters that are not composed from a base + mark
GLYPHS['đ'] = g(0, '....#', '..###', '.####', '#...#', '#...#', '#...#', '.####');
GLYPHS['Đ'] = cap('####.', '#...#', '#...#', '###.#', '#...#', '#...#', '####.');
const DOTLESS_I = g(2, '.##..', '..#..', '..#..', '..#..', '.###.');

/** Accent shapes, two rows each, 5 wide. */
const UPPER: Record<string, [string, string]> = {
  '̂': ['..#..', '.#.#.'], // circumflex
  '̆': ['#...#', '.###.'], // breve
  '́': ['...#.', '..#..'], // acute
  '̀': ['.#...', '..#..'], // grave
  '̉': ['..##.', '...#.'], // hook above
  '̃': ['.#.#.', '#.#..'], // tilde
};
const SHAPE_MARKS = new Set(['̂', '̆']);
const DOT_BELOW = '̣';
const HORN = '̛';

export interface Bitmap { w: number; h: number; px: Uint8Array }

interface Parts { base: string; marks: string[] }
const split = (ch: string): Parts => {
  if (GLYPHS[ch]) return { base: ch, marks: [] };
  const d = ch.normalize('NFD');
  return { base: d[0] ?? ch, marks: [...d.slice(1)] };
};

/** True when the font can draw every character of `text` (a space counts). */
export function canDraw(ch: string): boolean {
  if (ch === ' ') return true;
  const { base, marks } = split(ch);
  return !!GLYPHS[base] && marks.every((m) => m in UPPER || m === DOT_BELOW || m === HORN);
}
export const missingChars = (text: string): string[] => [...new Set([...text].filter((c) => !canDraw(c)))];

const advanceOf = (ch: string): number => (ch === ' ' ? 4 : split(ch).marks.includes(HORN) ? ADV + 1 : ADV);
export const measure = (text: string): number => [...text].reduce((w, c) => w + advanceOf(c), 0);

/** Draw one character into `px` (row-major, width `w`) at column `x0`. Unknown characters draw nothing. */
function drawChar(px: Uint8Array, w: number, x0: number, ch: string): void {
  if (ch === ' ' || !canDraw(ch)) return;
  const { base, marks } = split(ch);
  const set = (x: number, y: number): void => { if (x >= 0 && x < w && y >= 0 && y < CELL_H) px[y * w + x] = 1; };
  const upper = marks.filter((m) => m in UPPER);
  let glyph = GLYPHS[base]!;
  if (base === 'i' && upper.length) glyph = DOTLESS_I; // the tone mark replaces the dot
  const top = BASELINE_TOP + glyph.t;
  glyph.r.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') set(x0 + x, BASELINE_TOP + glyph.t + y); });
  const shape = upper.find((m) => SHAPE_MARKS.has(m));
  const tone = upper.find((m) => !SHAPE_MARKS.has(m));
  const put = (m: string, rowTop: number): void => UPPER[m]!.forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === '#') set(x0 + x, rowTop + y); });
  if (shape) put(shape, top - 2);
  if (tone) put(tone, shape ? top - 4 : top - 2);
  if (marks.includes(DOT_BELOW)) set(x0 + 2, glyph.r.length + glyph.t > 7 ? 13 : 11);
  if (marks.includes(HORN)) set(x0 + 5, top);
}

/** Rasterise a line. 1 = lit pixel. Width is `measure(text)`, height CELL_H. */
export function rasterize(text: string): Bitmap {
  const w = Math.max(1, measure(text));
  const px = new Uint8Array(w * CELL_H);
  let x = 0;
  for (const ch of text) { drawChar(px, w, x, ch); x += advanceOf(ch); }
  return { w, h: CELL_H, px };
}

/** Text picture for tests and docs: one line per row. */
export const toAscii = (b: Bitmap): string => Array.from({ length: b.h }, (_, y) => Array.from({ length: b.w }, (_, x) => (b.px[y * b.w + x] ? '#' : '.')).join('')).join('\n');
