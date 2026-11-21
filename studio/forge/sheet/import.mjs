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
  return {figure, entry: {id: cell.id, facing: cell.facing, pose: cell.pose, label: cell.label, rect, bounds, ground,
    heightPx: m.heightPx, foregroundPx: pixels, crop: `cells/${cell.id}.png`}};
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

/**
 * Fit every cell of an import. mode "cell" (default) gives each figure its own scale, the right thing for a
 * turnaround whose facings differ in size. mode "sheet" is for pose sheets: ONE scale for every cell (the smallest
 * any cell needs, so all of them fit), and ONE ground line (the median of the cells' measured ground rows as a
 * fraction of the cell height) so a pose that is drawn a little low or high does not jump when played. The pose
 * keeps the template's centre column. Each entry gets scale, limit, targetY and alignGround (the ground point
 * the figure is pinned to the pivot by); sheet mode also records groundMeasured and groundShiftPx (native px).
 */
export function normalizeEntries(entries, profile, options = {}) {
  const o = {...defaultScaleOptions, ...options};
  if (!['cell', 'sheet'].includes(o.mode)) throw new RangeError(`unknown scale mode "${o.mode}"`);
  const frac = entries.map(e => e.ground[1] / (e.rect[3] - e.rect[1]));
  const sharedFrac = o.mode === 'sheet' ? median(frac) : null;
  const fits = entries.map(e => {
    const alignGround = o.mode === 'sheet' ? [e.ground[0], roundHalfEven(sharedFrac * (e.rect[3] - e.rect[1]))] : [...e.ground];
    return {alignGround, ...normalizeScale({...e, ground: alignGround}, profile, o)};
  });
  let binding = null;
  if (o.mode === 'sheet') binding = fits.reduce((best, f, i) => f.scale < fits[best].scale ? i : best, 0);
  return entries.map((e, i) => {
    const fit = o.mode === 'sheet' ? {...fits[i], scale: fits[binding].scale, limit: fits[binding].limit, limitCell: entries[binding].id} : fits[i];
    const out = {...e, scale: fit.scale, limit: fit.limit, targetY: fit.targetY, alignGround: fit.alignGround};
    if (o.mode === 'sheet') {
      out.limitCell = fit.limitCell;
      out.groundMeasured = [...e.ground];
      out.groundShiftPx = Number(((fit.alignGround[1] - e.ground[1]) * fit.scale).toFixed(2));
    }
    return out;
  });
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
