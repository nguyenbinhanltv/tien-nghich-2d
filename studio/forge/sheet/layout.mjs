// Layout templates: a declarative description of a turnaround or pose sheet.
//
// {
//   schema: "forge.layout", version: 1, id,
//   size: [w, h],                       // pixel size of the blank template PNG (drawn sheets may be any size)
//   key: {rgb, minChannel, margin},     // background key: dominant channel >= minChannel and beats the others by margin
//   labelBand: {fraction},              // top fraction of every cell reserved for its label; never foreground
//   ground: {fraction},                 // guide line, fraction of the cell height from the cell top
//   landmarkBasis: "cell_width" | "cell_height",   // what centerX and footWindow are fractions of
//   cells: [{
//     id, facing, pose, label,          // pose may be null; id is unique and names the output files
//     rect: [x0, y0, x1, y1],           // fractions of the sheet; cells may differ and need not tile
//     landmarks: {centerX, footWindow: [a, b], heightPx}   // ground x, window that finds the lowest foot row,
//   }]                                  // and the figure height (ground to crown) wanted at native size
// }
import { roundHalfEven } from '../image.mjs';
import { canDraw } from './font.mjs';

export const layoutSchema = 'forge.layout';

const isFraction = v => typeof v === 'number' && v >= 0 && v <= 1;

/** Returns a list of problems; an empty list means the layout is usable. */
export function validateLayout(layout) {
  const issues = [];
  const bad = message => issues.push(message);
  if (layout?.schema !== layoutSchema || layout.version !== 1) return [`not a ${layoutSchema} version 1 document`];
  if (typeof layout.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(layout.id)) bad('id must be lower-case letters, digits, "-" or "_"');
  if (!Array.isArray(layout.size) || layout.size.length !== 2 || !layout.size.every(v => Number.isInteger(v) && v >= 64 && v <= 8192)) bad('size must be [w, h] integers from 64 to 8192');
  const key = layout.key;
  if (!Array.isArray(key?.rgb) || key.rgb.length !== 3 || !key.rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) bad('key.rgb must be three 0-255 integers');
  else {
    const sorted = [...key.rgb].sort((a, b) => b - a);
    if (sorted[0] - sorted[1] < 100) bad('key.rgb needs one clearly dominant channel (a pure red, green or blue key)');
    if (!Number.isInteger(key.minChannel) || !Number.isInteger(key.margin)) bad('key.minChannel and key.margin must be integers');
  }
  if (!isFraction(layout.labelBand?.fraction) || layout.labelBand.fraction > 0.5) bad('labelBand.fraction must be between 0 and 0.5');
  if (!isFraction(layout.ground?.fraction)) bad('ground.fraction must be between 0 and 1');
  if (!['cell_width', 'cell_height'].includes(layout.landmarkBasis)) bad('landmarkBasis must be "cell_width" or "cell_height"');
  if (!Array.isArray(layout.cells) || !layout.cells.length) return [...issues, 'cells must be a non-empty list'];
  const ids = new Set();
  layout.cells.forEach((cell, i) => {
    const where = `cells[${i}]`;
    if (typeof cell.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(cell.id)) bad(`${where}.id must be lower-case letters, digits, "-" or "_"`);
    else if (ids.has(cell.id)) bad(`${where}.id "${cell.id}" is duplicated`);
    else ids.add(cell.id);
    if (typeof cell.label !== 'string' || !cell.label || !canDraw(cell.label)) bad(`${where}.label must be upper-case letters, digits, space, "-", "_" or "."`);
    const r = cell.rect;
    if (!Array.isArray(r) || r.length !== 4 || !r.every(isFraction) || r[2] <= r[0] || r[3] <= r[1]) bad(`${where}.rect must be fractions [x0, y0, x1, y1] with x1 > x0 and y1 > y0`);
    const m = cell.landmarks;
    if (!isFraction(m?.centerX)) bad(`${where}.landmarks.centerX must be a fraction`);
    if (!Array.isArray(m?.footWindow) || !m.footWindow.every(isFraction) || m.footWindow[1] <= m.footWindow[0]) bad(`${where}.landmarks.footWindow must be [a, b] fractions with b > a`);
    if (!(m?.heightPx > 0)) bad(`${where}.landmarks.heightPx must be positive`);
  });
  return issues;
}

export function assertLayout(layout) {
  const issues = validateLayout(layout);
  if (issues.length) throw Object.assign(new Error('Invalid forge layout:\n  ' + issues.join('\n  ')), {code: 'invalid_layout', issues});
  return layout;
}

/** Pixel rectangle of a cell on a sheet of the given size (half-even rounding, like the prototype). */
export function cellRect(cell, sheetWidth, sheetHeight) {
  const [x0, y0, x1, y1] = cell.rect;
  return [roundHalfEven(sheetWidth * x0), roundHalfEven(sheetHeight * y0), roundHalfEven(sheetWidth * x1), roundHalfEven(sheetHeight * y1)];
}

const defaults = {minChannel: 105, margin: 55};

/**
 * Build an equal-grid layout. `cells` are {id, facing?, pose?, label?, landmarks?}; landmarks default to
 * a centred figure with a wide foot window. Cells fill the grid row by row.
 */
export function gridLayout({id, columns, rows, size = [1024, 1024], cells, heightPx, keyRgb = [0, 255, 0], labelFraction = 0.13,
  groundFraction = 0.82, basis = 'cell_width', key = {}}) {
  if (cells.length > columns * rows) throw new RangeError(`${cells.length} cells do not fit a ${columns}x${rows} grid`);
  const layout = {
    schema: layoutSchema, version: 1, id, size: [...size],
    key: {rgb: [...keyRgb], minChannel: key.minChannel ?? defaults.minChannel, margin: key.margin ?? defaults.margin},
    labelBand: {fraction: labelFraction}, ground: {fraction: groundFraction}, landmarkBasis: basis,
    cells: cells.map((cell, i) => {
      const column = i % columns, row = Math.floor(i / columns);
      return {
        id: cell.id, facing: cell.facing ?? null, pose: cell.pose ?? null,
        label: cell.label ?? (cell.id.toUpperCase().replace(/[^A-Z0-9 _.-]/g, '-')),
        rect: [column / columns, row / rows, (column + 1) / columns, (row + 1) / rows],
        landmarks: cell.landmarks ?? {centerX: 0.5, footWindow: [0.25, 0.75], heightPx: heightPx ?? 20},
      };
    }),
  };
  return assertLayout(layout);
}

/**
 * Turnaround or pose sheet: one cell per facing and pose. A single pose is laid out as a near-square
 * grid, several poses as one row per pose. Cell ids are the facing, or "<pose>_<facing>" with poses.
 */
export function turnaroundLayout({id, facings, poses = [null], columns, ...rest}) {
  const cells = poses.flatMap(pose => facings.map(facing => ({
    id: pose ? `${pose}_${facing}` : facing, facing, pose,
    label: (pose ? `${pose} ${facing}` : facing).toUpperCase().replace(/[^A-Z0-9 _.-]/g, '-'),
  })));
  const cols = columns ?? (poses.length === 1 ? Math.ceil(Math.sqrt(cells.length)) : facings.length);
  return gridLayout({id, columns: cols, rows: Math.ceil(cells.length / cols), cells, ...rest});
}

/**
 * Convert the bake-off's layout.json ({template, source_landmarks}) into a forge.layout. Its windows
 * were fractions of the cell HEIGHT, so the result declares landmarkBasis "cell_height" to reproduce
 * the committed imports; switch it to "cell_width" for the corrected behaviour.
 */
export function fromLegacyLayout(legacy, {id = 'legacy', size = [1024, 1024], basis = 'cell_height'} = {}) {
  const {columns, rows, labels, label_band_fraction: labelFraction, key_rgb: keyRgb} = legacy.template;
  const cells = labels.map((label, i) => {
    const facing = label.toLowerCase(), m = legacy.source_landmarks[facing], row = Math.floor(i / columns);
    return {
      id: facing, facing, pose: null, label,
      rect: [m.cell_x[0], row / rows, m.cell_x[1], (row + 1) / rows],
      landmarks: {centerX: m.center_x, footWindow: [...m.foot_window], heightPx: m.height_px},
    };
  });
  return assertLayout({
    schema: layoutSchema, version: 1, id, size: [...size], key: {rgb: [...keyRgb], ...defaults},
    labelBand: {fraction: labelFraction}, ground: {fraction: 0.82}, landmarkBasis: basis, cells,
  });
}

/** Accept either format (the CLI and the tools take whatever file they are given). */
export const normalizeLayout = doc => doc?.schema === layoutSchema ? assertLayout(doc) : fromLegacyLayout(doc);
