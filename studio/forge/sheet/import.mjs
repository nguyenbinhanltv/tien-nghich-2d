// Sheet import: layout + drawn sheet -> one cleaned crop per cell, the ground point of each figure
// and a scale that puts every facing at a consistent size. Nothing here modifies its inputs; the
// result is a record (JSON) plus cleaned crops, written only to a directory the caller names.
import fs from 'node:fs/promises';
import path from 'node:path';
import { boundsOf, crop, createImage, decodePng, encodePng, roundHalfEven, sha256 } from '../image.mjs';
import { assertLayout, cellRect } from './layout.mjs';

export const importSchema = 'forge.sheet-import';

const cellIdPattern = /^[a-z0-9][a-z0-9_-]*$/;
/** Cell ids become file names; accept only what validateLayout accepts. */
export function assertCellId(id) {
  if (typeof id !== 'string' || !cellIdPattern.test(id)) throw new Error(`invalid cell id ${JSON.stringify(id)}`);
  return id;
}

function keyTest(layout) {
  const {rgb, minChannel, margin} = layout.key;
  const dom = rgb.indexOf(Math.max(...rgb)), others = [0, 1, 2].filter(c => c !== dom);
  return (d, i) => d[i + dom] >= minChannel && d[i + dom] - Math.max(d[i + others[0]], d[i + others[1]]) >= margin;
}

/** Cut one cell: keyed-out crop of the figure plus its landmarks, all in cell pixel coordinates. */
function importCell(sheet, layout, cell) {
  const rect = cellRect(cell, sheet.width, sheet.height);
  const view = crop(sheet, ...rect);
  const isKey = keyTest(layout), d = view.pixels;
  const band = roundHalfEven(view.height * layout.labelBand.fraction);
  const foreground = i => (i / 4 / view.width | 0) >= band && !isKey(d, i);
  const bounds = boundsOf(view, foreground);
  if (!bounds) throw Object.assign(new Error(`cell "${cell.id}" has no foreground below its label band`), {code: 'empty_cell', cell: cell.id});
  const basis = layout.landmarkBasis === 'cell_width' ? view.width : view.height;
  const m = cell.landmarks;
  const [fx0, fx1] = m.footWindow.map(f => Math.min(view.width, roundHalfEven(basis * f)));
  const feet = fx1 > fx0 ? boundsOf(view, foreground, [fx0, 0, fx1, view.height]) : null;
  if (!feet) throw Object.assign(new Error(`cell "${cell.id}" has no foreground inside its foot window`), {code: 'empty_foot_window', cell: cell.id});
  const ground = [roundHalfEven(basis * m.centerX), feet[3]];
  const [x0, y0, x1, y1] = bounds;
  const figure = createImage(x1 - x0, y1 - y0);
  let pixels = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * view.width + x) * 4;
    if (!foreground(i)) continue;
    figure.pixels.set([d[i], d[i + 1], d[i + 2], 255], ((y - y0) * figure.width + (x - x0)) * 4);
    pixels++;
  }
  const warnings = [];
  const touches = (test) => { for (let k = 0; k < (test.horizontal ? view.width : view.height); k++) if (foreground(test.index(k))) return true; return false; };
  const at = (x, y) => (y * view.width + x) * 4;
  if (touches({horizontal: false, index: y => at(0, y)})) warnings.push('left_edge');
  if (touches({horizontal: false, index: y => at(view.width - 1, y)})) warnings.push('right_edge');
  if (touches({horizontal: true, index: x => at(x, view.height - 1)})) warnings.push('bottom_edge');
  if (band < view.height && touches({horizontal: true, index: x => at(x, band)})) warnings.push('label_band');
  return {figure, entry: {id: cell.id, facing: cell.facing, pose: cell.pose, label: cell.label, rect, bounds, ground,
    heightPx: m.heightPx, foregroundPx: pixels, warnings, crop: `cells/${cell.id}.png`}};
}

export const defaultScaleOptions = {mode: 'cell', groundLift: 4, margin: 1};

/**
 * Scale one figure to its target height while keeping it inside the room the profile leaves around
 * the pivot. `profile` is {nativePx: [w, h], pivotPx: [x, y]}. Ratios that bind are recorded so a
 * reviewer can see why a facing came out smaller than its height target.
 */
export function normalizeScale(cell, profile, {groundLift = 4, margin = 1} = {}) {
  const [w, h] = profile.nativePx, [px] = profile.pivotPx;
  const [x0, y0, x1, y1] = cell.bounds, [gx, gy] = cell.ground;
  const targetY = profile.pivotPx[1] - groundLift;
  const limits = {
    height: cell.heightPx / (gy - y0),
    left: (px - margin) / Math.max(1, gx - x0),
    right: (w - margin - px) / Math.max(1, x1 - gx),
    below: (h - 1 - margin - targetY) / Math.max(1, y1 - gy),
    above: (targetY - margin) / Math.max(1, gy - y0),
  };
  const [limit, scale] = Object.entries(limits).reduce((best, e) => e[1] < best[1] ? e : best);
  return {scale, limit, targetY};
}

const median = values => { const v = [...values].sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

/** Scales per facing from a turnaround import record, for locking a pose sheet to the turnaround's size. */
export const scalesByFacing = record => Object.fromEntries(record.cells.filter(c => c.facing && c.scale).map(c => [c.facing, c.scale]));

/**
 * Fit every cell of an import. `mode` decides what cells share:
 *   "cell"   each figure gets its own scale and ground (a turnaround whose facings differ in size);
 *   "facing" the poses of one facing share one scale (the smallest any of them needs) and one ground line;
 *   "sheet"  every cell shares one scale and one ground line.
 * A shared ground line is the median of the group's measured ground rows as a fraction of the cell height, so a
 * pose drawn a little low or high neither jumps nor loses a deliberate lift. Poses keep the template's centre column.
 * `fixedScale` ({facing: scale}, e.g. scalesByFacing(turnaround record)) pins a facing's scale outright. Each
 * entry gets scale, limit, targetY and alignGround (the point pinned to the pivot); shared modes also record
 * groundMeasured, groundShiftPx (native px) and limitCell (the cell that binds the group's scale).
 */
export function normalizeEntries(entries, profile, options = {}) {
  const o = {...defaultScaleOptions, ...options};
  if (!['cell', 'facing', 'sheet'].includes(o.mode)) throw new RangeError(`unknown scale mode "${o.mode}"`);
  const groupOf = e => o.mode === 'sheet' ? 'all' : o.mode === 'facing' ? `f:${e.facing ?? e.id}` : e.id;
  const groups = new Map();
  entries.forEach((e, i) => groups.set(groupOf(e), [...(groups.get(groupOf(e)) ?? []), i]));
  const out = new Array(entries.length);
  for (const members of groups.values()) {
    const shared = o.mode !== 'cell';
    const sharedFrac = shared ? median(members.map(i => entries[i].ground[1] / (entries[i].rect[3] - entries[i].rect[1]))) : null;
    const fits = members.map(i => {
      const e = entries[i];
      const alignGround = shared ? [e.ground[0], roundHalfEven(sharedFrac * (e.rect[3] - e.rect[1]))] : [...e.ground];
      return {i, alignGround, ...normalizeScale({...e, ground: alignGround}, profile, o)};
    });
    const bound = shared ? fits.reduce((best, f) => f.scale < best.scale ? f : best) : null;
    for (const fit of fits) {
      const e = entries[fit.i], fixed = o.fixedScale?.[e.facing];
      const scale = fixed ?? (shared ? bound.scale : fit.scale);
      const next = {...e, scale, limit: fixed !== undefined ? 'fixed' : shared ? bound.limit : fit.limit, targetY: fit.targetY, alignGround: fit.alignGround};
      if (shared) {
        next.limitCell = fixed !== undefined ? null : entries[bound.i].id;
        next.groundMeasured = [...e.ground];
        next.groundShiftPx = Number(((fit.alignGround[1] - e.ground[1]) * scale).toFixed(2));
      }
      out[fit.i] = next;
    }
  }
  return out;
}

/**
 * Import a drawn sheet. `sheet` is a decoded image; pass `sheetBytes` (the file as read) so the record
 * carries the hash of the real input. `prompt` is stored verbatim with its hash. With `profile`
 * each cell also gets its normalised scale; `scaleOptions` ({mode, groundLift, margin}) are recorded with it.
 */
export function importSheet({layout: layoutDoc, sheet, sheetBytes, source, prompt = '', profile, scaleOptions = {}}) {
  const layout = assertLayout(layoutDoc);
  const cells = new Map(), entries = [];
  for (const cell of layout.cells) {
    const {figure, entry} = importCell(sheet, layout, cell);
    cells.set(cell.id, figure);
    entries.push(entry);
  }
  const options = {...defaultScaleOptions, ...scaleOptions};
  const fitted = profile ? normalizeEntries(entries, profile, options) : entries;
  const record = {
    schema: importSchema, version: 1, layoutId: layout.id, landmarkBasis: layout.landmarkBasis,
    sheet: {sha256: sha256(sheetBytes ?? encodePng(sheet)), width: sheet.width, height: sheet.height, ...(source ? {source} : {})},
    prompt: {text: prompt, sha256: sha256(Buffer.from(prompt, 'utf8'))},
    ...(profile ? {profile: {nativePx: [...profile.nativePx], pivotPx: [...profile.pivotPx]}, scaleOptions: options} : {}),
    cells: fitted,
  };
  return {record, cells, layout};
}

export async function readSheetFile(file) {
  const bytes = await fs.readFile(file);
  return {bytes, image: decodePng(bytes)};
}

/** Refuse to write any target that is one of the `protect` paths (raw inputs are never overwritten). */
export function assertNoOverwrite(targets, protect = []) {
  const guarded = new Set(protect.map(p => path.resolve(p)));
  for (const target of targets) if (guarded.has(path.resolve(target))) throw new Error(`refusing to overwrite protected input ${target}`);
}

/** Write import.json, prompt.txt, layout.json and cells/<id>.png under dir. */
export async function writeImport(dir, {record, cells, layout}, {protect = []} = {}) {
  const root = path.resolve(dir);
  [...cells.keys()].forEach(assertCellId);
  const files = [...cells.keys()].map(id => path.join(root, 'cells', `${id}.png`));
  const meta = ['import.json', 'layout.json', 'prompt.txt'].map(f => path.join(root, f));
  assertNoOverwrite([...files, ...meta], protect);
  await fs.mkdir(path.join(root, 'cells'), {recursive: true});
  const ids = [...cells.keys()];
  await Promise.all(ids.map((id, i) => fs.writeFile(files[i], encodePng(cells.get(id)))));
  await fs.writeFile(meta[0], JSON.stringify(record, null, 2) + '\n');
  await fs.writeFile(meta[1], JSON.stringify(layout, null, 2) + '\n');
  await fs.writeFile(meta[2], record.prompt.text);
  return root;
}

export async function readImport(dir) {
  const record = JSON.parse(await fs.readFile(path.join(dir, 'import.json'), 'utf8'));
  if (record.schema !== importSchema) throw new Error(`${dir} is not a ${importSchema} directory`);
  const cells = new Map();
  if (!Array.isArray(record.cells)) throw new Error('import.json has no cells list');
  for (const entry of record.cells) {
    assertCellId(entry.id);
    if (entry.crop !== `cells/${entry.id}.png`) throw new Error(`cell "${entry.id}": crop must be cells/${entry.id}.png`);
  }
  for (const entry of record.cells) cells.set(entry.id, decodePng(await fs.readFile(path.join(dir, entry.crop))));
  return {record, cells};
}
