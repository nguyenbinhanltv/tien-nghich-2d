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

/**
 * cells: [{clip, direction, n, image: {width, height, pixels}, defects: [{x, y, severity}], errors, warnings}]
 * options: {scale = 4, overlay = true, columns?}
 * Returns {png, width, height, layout: {scale, cell: {w, h}, rows: [{clip, direction, frames: [n...]}]}}.
 */
export function renderContactSheet(cells, {scale = 4, overlay = true} = {}) {
  if (!cells.length) throw new Error('nothing to render');
  const cw = Math.max(...cells.map(c => c.image.width)), ch = Math.max(...cells.map(c => c.image.height));
  const groups = new Map();
  for (const c of cells) {
    const k = `${c.clip}\0${c.direction}`;
    if (!groups.has(k)) groups.set(k, {clip: c.clip, direction: c.direction, cells: []});
    groups.get(k).cells.push(c);
  }
  const rows = [...groups.values()].sort((a, b) => a.clip.localeCompare(b.clip) || a.direction.localeCompare(b.direction));
  for (const r of rows) r.cells.sort((a, b) => a.n - b.n);
  const cols = Math.max(...rows.map(r => r.cells.length));
  const cellW = cw * scale, cellH = ch * scale + BAR + 1;
  const width = EDGE * 2 + cols * cellW + (cols - 1) * GUTTER;
  const height = EDGE * 2 + rows.length * cellH + (rows.length - 1) * ROW_GAP;
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
      const top = y0 + BAR + 1;
      const {width: iw, height: ih, pixels} = c.image;
      for (let py = 0; py < ch * scale; py++) {
        for (let px = 0; px < cw * scale; px++) {
          const sx = Math.floor(px / scale), sy = Math.floor(py / scale);
          const check = ((sx >> 2) + (sy >> 2)) & 1 ? COLORS.light : COLORS.dark;
          if (sx < iw && sy < ih) {
            const k = (sy * iw + sx) * 4, a = pixels[k + 3];
            if (a) { put(x0 + px, top + py, a === 255 ? [pixels[k], pixels[k + 1], pixels[k + 2]] : blend(pixels, k, check, a)); continue; }
          }
          put(x0 + px, top + py, check);
        }
      }
      if (overlay) {
        for (const d of c.defects ?? []) {
          const color = d.severity === 'warn' ? COLORS.warn : COLORS.error;
          const bx = x0 + d.x * scale, by = top + d.y * scale;
          for (let i = 0; i < scale; i++) { put(bx + i, by, color); put(bx + i, by + scale - 1, color); put(bx, by + i, color); put(bx + scale - 1, by + i, color); }
        }
      }
    });
  });
  return {
    png: encodePixels(width, height, out), width, height,
    layout: {scale, cell: {w: cw, h: ch}, bar: 'green clean, yellow warnings only, red errors',
      rows: rows.map(r => ({clip: r.clip, direction: r.direction, frames: r.cells.map(c => c.n),
        status: r.cells.map(c => (c.errors ? 'error' : c.warnings ? 'warn' : 'clean'))}))},
  };
}

function blend(p, k, bg, a) {
  const f = a / 255;
  return [0, 1, 2].map(i => Math.round(p[k + i] * f + bg[i] * (1 - f)));
}
