// Contact sheets an agent can LOOK at: frames laid out by clip and direction, scaled with
// nearest-neighbour (no smoothing, so pixels stay pixels), on a checkerboard so transparency is
// visible, with a status bar over each cell and a box around every defective pixel.
import { encodePixels } from './png.mjs';

export const MAX_SHEET_PIXELS = 2048 * 2048;
const COLORS = {
  dark: [0x2a, 0x27, 0x33], light: [0x3a, 0x36, 0x46],
  clean: [0x4c, 0xd1, 0x7c], warn: [0xf2, 0xc9, 0x4c], error: [0xff, 0x2d, 0x6f], label: [0x88, 0x84, 0x99],
};
const BAR = 3, GUTTER = 4, ROW_GAP = 8, EDGE = 6;

// A 3x5 digit font for the rulers: rows top to bottom, bit 2 is the left column.
const DIGITS = [0b111101101101111, 0b010110010010111, 0b111001111100111, 0b111001111001111, 0b101101111001001,
  0b111100111001111, 0b111100111101111, 0b111001001001001, 0b111101111101111, 0b111101111001111];
const RULER = [0xc8, 0xc4, 0xd8], GRID_MINOR = 0.22, GRID_MAJOR = 0.5, MAJOR_EVERY = 8;

/** Smallest label step (in sprite pixels) so labels `digits` wide never touch at this zoom. */
export function rulerStep(zoom, digits) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) if (step * zoom >= digits * 4 + 2) return step;
  return 100;
}

/** Geometry of a sheet without drawing it: {width, height, cellW, cellH, rl, rt, cw, ch, rows, cols}. */
export function sheetGeometry(cells, {scale = 4, rulers = false, region = null} = {}) {
  const cw = region ? region.w : Math.max(...cells.map(c => c.image.width)), ch = region ? region.h : Math.max(...cells.map(c => c.image.height));
  const digits = String(Math.max(region ? region.x + region.w : cw, region ? region.y + region.h : ch) - 1).length;
  const rl = rulers ? digits * 4 + 3 : 0, rt = rulers ? 8 : 0;
  const counts = new Map();
  for (const c of cells) counts.set(`${c.clip}\0${c.direction}`, (counts.get(`${c.clip}\0${c.direction}`) ?? 0) + 1);
  const rowCount = counts.size, cols = Math.max(...counts.values());
  const cellW = rl + cw * scale, cellH = rt + ch * scale + BAR + 1;
  return {cw, ch, rl, rt, digits, cellW, cellH, rowCount, cols,
    width: EDGE * 2 + cols * cellW + (cols - 1) * GUTTER, height: EDGE * 2 + rowCount * cellH + (rowCount - 1) * ROW_GAP};
}

/**
 * cells: [{clip, direction, n, image: {width, height, pixels}, defects: [{x, y, severity}], errors, warnings}]
 * options: {scale = 4, overlay = true, grid = false, rulers = false, region = null}
 *   grid: a faint line between pixels (every 8th stronger); rulers: sprite coordinates along the top and left of each frame;
 *   region {x, y, w, h}: only that window of every frame, with the rulers and defects keeping sprite coordinates.
 * Returns {png, width, height, layout: {scale, cell: {w, h}, rows: [{clip, direction, frames: [n...]}]}}.
 */
export function renderContactSheet(cells, {scale = 4, overlay = true, grid = false, rulers = false, region = null} = {}) {
  if (!cells.length) throw new Error('nothing to render');
  const geo = sheetGeometry(cells, {scale, rulers, region});
  const {cw, ch, rl, rt} = geo;
  const ox = region ? region.x : 0, oy = region ? region.y : 0;
  const groups = new Map();
  for (const c of cells) {
    const k = `${c.clip}\0${c.direction}`;
    if (!groups.has(k)) groups.set(k, {clip: c.clip, direction: c.direction, cells: []});
    groups.get(k).cells.push(c);
  }
  const rows = [...groups.values()].sort((a, b) => a.clip.localeCompare(b.clip) || a.direction.localeCompare(b.direction));
  for (const r of rows) r.cells.sort((a, b) => a.n - b.n);
  const {cellW, cellH, width, height} = geo;
  if (width * height > MAX_SHEET_PIXELS) {
    const err = new Error(`contact sheet would be ${width}x${height}; narrow it with clip, direction or frames, or lower scale`);
    err.code = 'too_large';
    throw err;
  }
  const out = Buffer.alloc(width * height * 4);
  const put = (x, y, [r, g, b]) => { if (x >= 0 && y >= 0 && x < width && y < height) { const k = (y * width + x) * 4; out[k] = r; out[k + 1] = g; out[k + 2] = b; out[k + 3] = 255; } };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, COLORS.dark);

  rows.forEach((row, ri) => {
    const y0 = EDGE + ri * (cellH + ROW_GAP);
    row.cells.forEach((c, ci) => {
      const x0 = EDGE + ci * (cellW + GUTTER);
      const status = c.errors ? 'error' : c.warnings ? 'warn' : 'clean';
      for (let x = 0; x < cellW; x++) for (let y = 0; y < BAR; y++) put(x0 + x, y0 + y, COLORS[status]);
      const top = y0 + BAR + 1 + rt, left = x0 + rl;
      const {width: iw, height: ih, pixels} = c.image;
      for (let py = 0; py < ch * scale; py++) {
        for (let px = 0; px < cw * scale; px++) {
          const sx = Math.floor(px / scale) + ox, sy = Math.floor(py / scale) + oy;
          const check = ((sx >> 2) + (sy >> 2)) & 1 ? COLORS.light : COLORS.dark;
          if (sx < iw && sy < ih) {
            const k = (sy * iw + sx) * 4, a = pixels[k + 3];
            if (a) { put(left + px, top + py, a === 255 ? [pixels[k], pixels[k + 1], pixels[k + 2]] : blend(pixels, k, check, a)); continue; }
          }
          put(left + px, top + py, check);
        }
      }
      if (grid && scale >= 3) {
        const tint = (x, y, f) => { if (x >= 0 && y >= 0 && x < width && y < height) { const k = (y * width + x) * 4; for (let i = 0; i < 3; i++) out[k + i] = Math.round(out[k + i] * (1 - f) + 255 * f); } };
        for (let i = 0; i <= cw; i++) for (let py = 0; py < ch * scale; py++) if (i < cw) tint(left + i * scale, top + py, (ox + i) % MAJOR_EVERY === 0 ? GRID_MAJOR : GRID_MINOR);
        for (let j = 0; j <= ch; j++) for (let px = 0; px < cw * scale; px++) if (j < ch) tint(left + px, top + j * scale, (oy + j) % MAJOR_EVERY === 0 ? GRID_MAJOR : GRID_MINOR);
      }
      if (rulers) {
        const glyph = (n, gx, gy) => String(n).split('').forEach((d, i) => { for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (DIGITS[Number(d)] >> (14 - r * 3 - q) & 1) put(gx + i * 4 + q, gy + r, RULER); });
        const step = rulerStep(scale, geo.digits);
        for (let i = 0; i < cw; i++) if ((ox + i) % step === 0) {
          const cx = left + i * scale + (scale >> 1), text = String(ox + i);
          glyph(ox + i, cx - ((text.length * 4 - 1) >> 1), y0 + BAR + 1);
          put(cx, top - 1, RULER); put(cx, top - 2, RULER);
        }
        for (let j = 0; j < ch; j++) if ((oy + j) % step === 0) {
          const cy = top + j * scale + (scale >> 1), text = String(oy + j);
          glyph(oy + j, left - 3 - text.length * 4 + 1, cy - 2);
          put(left - 1, cy, RULER); put(left - 2, cy, RULER);
        }
      }
      if (overlay) {
        for (const d of c.defects ?? []) {
          if (d.x < ox || d.y < oy || d.x >= ox + cw || d.y >= oy + ch) continue;
          const color = d.severity === 'warn' ? COLORS.warn : COLORS.error;
          const bx = left + (d.x - ox) * scale, by = top + (d.y - oy) * scale;
          for (let i = 0; i < scale; i++) { put(bx + i, by, color); put(bx + i, by + scale - 1, color); put(bx, by + i, color); put(bx + scale - 1, by + i, color); }
        }
      }
    });
  });
  return {
    png: encodePixels(width, height, out), width, height,
    layout: {scale, cell: {w: cw, h: ch}, ...(region ? {region} : {}), ...(rulers ? {rulers: true} : {}), ...(grid && scale >= 3 ? {grid: true} : {}), bar: 'green clean, yellow warnings only, red errors',
      rows: rows.map(r => ({clip: r.clip, direction: r.direction, frames: r.cells.map(c => c.n),
        status: r.cells.map(c => (c.errors ? 'error' : c.warnings ? 'warn' : 'clean'))}))},
  };
}

function blend(p, k, bg, a) {
  const f = a / 255;
  return [0, 1, 2].map(i => Math.round(p[k + i] * f + bg[i] * (1 - f)));
}
