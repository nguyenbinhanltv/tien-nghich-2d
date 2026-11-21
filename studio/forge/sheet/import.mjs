// Sheet import: layout + drawn sheet -> one cleaned crop per cell, the ground point of each figure
// and a scale that puts every facing at a consistent size. Nothing here modifies its inputs; the
// result is a record (JSON) plus cleaned crops, written only to a directory the caller names.
import fs from 'node:fs/promises';
import path from 'node:path';
import { boundsOf, crop, createImage, decodePng, encodePng, roundHalfEven, sha256 } from '../image.mjs';
import { assertLayout, cellRect } from './layout.mjs';

export const importSchema = 'forge.sheet-import';

function keyTest(layout) {
  const {rgb, minChannel, margin} = layout.key;
  const dom = rgb.indexOf(Math.max(...rgb)), others = [0, 1, 2].filter(c => c !== dom);
  return (d, i) => d[i + dom] >= minChannel && d[i + dom] - Math.max(d[i + others[0]], d[i + others[1]]) >= margin;
}

/** Cut one cell: keyed-out crop of the figure plus its landmarks, all in cell pixel coordinates. */
function importCell(sheet, layout, cell) {
  const rect = cellRect(cell, sheet.width, sheet.height);
  const view = crop(sheet, ...rect);
  const isKey = keyTest(layout), d = view.data;
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
    figure.data.set([d[i], d[i + 1], d[i + 2], 255], ((y - y0) * figure.width + (x - x0)) * 4);
    pixels++;
  }
  return {figure, entry: {id: cell.id, facing: cell.facing, pose: cell.pose, label: cell.label, rect, bounds, ground,
    heightPx: m.heightPx, foregroundPx: pixels, crop: `cells/${cell.id}.png`}};
}

/**
 * Scale each figure to its target height while keeping it inside the room the profile leaves around
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

/**
 * Import a drawn sheet. `sheet` is a decoded image; pass `sheetBytes` (the file as read) so the record
 * carries the hash of the real input. `prompt` is stored verbatim with its hash. With `profile`
 * each cell also gets its normalised scale.
 */
export function importSheet({layout: layoutDoc, sheet, sheetBytes, source, prompt = '', profile, scaleOptions}) {
  const layout = assertLayout(layoutDoc);
  const cells = new Map(), entries = [];
  for (const cell of layout.cells) {
    const {figure, entry} = importCell(sheet, layout, cell);
    if (profile) Object.assign(entry, normalizeScale(entry, profile, scaleOptions));
    cells.set(cell.id, figure);
    entries.push(entry);
  }
  const record = {
    schema: importSchema, version: 1, layoutId: layout.id, landmarkBasis: layout.landmarkBasis,
    sheet: {sha256: sha256(sheetBytes ?? encodePng(sheet)), width: sheet.width, height: sheet.height, ...(source ? {source} : {})},
    prompt: {text: prompt, sha256: sha256(Buffer.from(prompt, 'utf8'))},
    ...(profile ? {profile: {nativePx: [...profile.nativePx], pivotPx: [...profile.pivotPx]}} : {}),
    cells: entries,
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
  for (const entry of record.cells) cells.set(entry.id, decodePng(await fs.readFile(path.join(dir, entry.crop))));
  return {record, cells};
}
