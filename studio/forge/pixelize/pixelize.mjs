// Pixelisation: a cleaned crop (see ../sheet/import.mjs) -> a native-size sprite on the project palette.
// Steps: premultiplied box downscale at the recorded scale, foot anchored at the profile pivot,
// binary alpha, palette snap with the outline colour (and marks) reserved, 1px outline rebuilt.
import fs from 'node:fs/promises';
import path from 'node:path';
import { blit, boundsOf, boxDownscale, createImage, decodePng, encodePng, rebuildOutline, resizeBox, roundHalfEven, sha256, snapPalette, thresholdAlpha } from '../image.mjs';
import { assertCellId, assertNoOverwrite, defaultScaleOptions, normalizeEntries, normalizeScale } from '../sheet/import.mjs';

export const pixelizeSchema = 'forge.pixelize';

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const sameRgb = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Pixelise one cell. `entry` is the cell's import record, `figure` its cleaned crop. `settings` comes
 * from settingsFromPack; `marks` from resolveMarks. Returns {indexed, native, info}: `indexed` is the
 * snapped sprite before the outline (what the rig lane cuts parts from), `native` has the outline.
 */
export function pixelizeCell(entry, figure, settings, {marks = [], scaleOptions} = {}) {
  const {profile, palette, outline} = settings;
  const [width, height] = profile.nativePx, [pivotX] = profile.pivotPx;
  const fit = entry.scale && entry.targetY !== undefined ? {scale: entry.scale, targetY: entry.targetY, limit: entry.limit} : normalizeScale(entry, profile, scaleOptions);
  const [x0, y0] = entry.bounds, [gx, gy] = entry.alignGround ?? entry.ground;
  const dims = [Math.max(1, roundHalfEven(figure.width * fit.scale)), Math.max(1, roundHalfEven(figure.height * fit.scale))];
  const reduced = boxDownscale(figure, ...dims);
  const origin = [pivotX + roundHalfEven((x0 - gx) * fit.scale), fit.targetY + roundHalfEven((y0 - gy) * fit.scale)];
  const canvas = blit(createImage(width, height), reduced, origin[0], origin[1]);
  const sampled = thresholdAlpha(canvas);
  const reserved = [...(outline.color ? [outline.color] : []), ...marks.map(m => m.rgb)];
  const ordinary = palette.colors.map(c => c.rgb).filter(rgb => !reserved.some(r => sameRgb(r, rgb)));
  const indexed = snapPalette(sampled, ordinary);
  const markPixels = marks.map(() => 0);
  const d = sampled.pixels;
  // A mark's region, in native pixels: fractions of the reduced figure placed at its origin.
  const inRegion = (m, i) => {
    if (!m.region) return true;
    const x = (i / 4) % width, y = Math.floor(i / 4 / width), [a, b, c, e] = m.region;
    return x >= origin[0] + a * dims[0] && x < origin[0] + c * dims[0] && y >= origin[1] + b * dims[1] && y < origin[1] + e * dims[1];
  };
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 255) continue;
    marks.forEach((m, k) => {
      if (inRegion(m, i) && d[i] >= m.minRgb[0] && d[i + 1] >= m.minRgb[1] && d[i + 2] >= m.minRgb[2] && d[i + 2] - d[i + 1] >= m.blueOverGreen) {
        indexed.pixels.set(m.rgb, i);
        markPixels[k]++;
      }
    });
  }
  const kept = [];
  marks.forEach((m, k) => {
    if (m.minCoverage === undefined) return;
    // Share of each native pixel's source footprint that matches the detector at full resolution.
    const hit = createImage(figure.width, figure.height, [255, 255, 255, 0]);
    for (let i = 0; i < figure.pixels.length; i += 4) {
      const r = figure.pixels[i], g = figure.pixels[i + 1], b = figure.pixels[i + 2];
      if (figure.pixels[i + 3] === 255 && r >= m.minRgb[0] && g >= m.minRgb[1] && b >= m.minRgb[2] && b - g >= m.blueOverGreen) hit.pixels[i + 3] = 255;
    }
    const share = blit(createImage(width, height), resizeBox(hit, ...dims), origin[0], origin[1]);
    for (let i = 0; i < indexed.pixels.length; i += 4) {
      if (indexed.pixels[i + 3] !== 255 || share.pixels[i + 3] < m.minCoverage * 255 || !inRegion(m, i)) continue;
      if (!sameRgb(indexed.pixels.subarray(i, i + 3), m.rgb)) markPixels[k]++;
      indexed.pixels.set(m.rgb, i);
      if (m.keepOnOutline) kept.push([i, m.rgb]);
    }
  });
  const native = outline.mode === 'none' ? indexed : rebuildOutline(indexed, outline.color, {borderIsEdge: outline.borderIsEdge});
  for (const [i, rgb] of kept) native.pixels.set(rgb, i);
  const box = boundsOf(native);
  const warnings = [];
  if (!box) warnings.push('sprite is empty after reduction');
  else if (box[0] === 0 || box[1] === 0 || box[2] === width || box[3] === height) warnings.push('sprite touches the canvas boundary');
  if (origin[0] < 0 || origin[1] < 0 || origin[0] + dims[0] > width || origin[1] + dims[1] > height) warnings.push('reduced figure was clipped by the canvas');
  const marksVisible = marks.map(m => { let n = 0; for (let i = 0; i < native.pixels.length; i += 4) if (native.pixels[i + 3] === 255 && sameRgb(native.pixels.subarray(i, i + 3), m.rgb)) n++; return {id: m.id, hex: m.hex, sourcePx: markPixels[marks.indexOf(m)], visiblePx: n}; });
  return {indexed, native, info: {id: entry.id, facing: entry.facing, pose: entry.pose, sourceGround: entry.ground, alignGround: [gx, gy], sourceBounds: entry.bounds,
    nativeOrigin: origin, scale: fit.scale, scaleLimit: fit.limit, reducedSize: dims, bounds: box, marks: marksVisible, warnings}};
}

/** Pixelise every cell of an import ({record, cells}); returns {record, cells: Map id -> {indexed, native}}. */
export function pixelizeImport(imported, settings, {marks = [], scaleOptions} = {}) {
  const cells = new Map(), infos = [];
  // A recorded fit belongs to the profile and scale options the import ran with. It is reused only when both
  // match (options default to the recorded ones); otherwise every cell is fitted again for this profile.
  const rp = imported.record.profile, p = settings.profile, recorded = imported.record.scaleOptions;
  const wanted = {...defaultScaleOptions, ...(scaleOptions ?? recorded ?? {})};
  const reusable = rp && recorded && rp.nativePx.join() === p.nativePx.join() && rp.pivotPx.join() === p.pivotPx.join()
    && stable(wanted) === stable(recorded);
  const fitted = reusable ? imported.record.cells : normalizeEntries(imported.record.cells.map(({scale, limit, targetY, alignGround, ...bare}) => bare), p, wanted);
  for (const entry of fitted) {
    const {indexed, native, info} = pixelizeCell(entry, imported.cells.get(entry.id), settings, {marks, scaleOptions: wanted});
    cells.set(entry.id, {indexed, native});
    infos.push({...info, sha256: sha256(encodePng(native))});
  }
  const {profile, palette, outline} = settings;
  return {cells, record: {
    schema: pixelizeSchema, version: 1, sheetSha256: imported.record.sheet.sha256, promptSha256: imported.record.prompt.sha256,
    layoutId: imported.record.layoutId, landmarkBasis: imported.record.landmarkBasis,
    profile: {name: profile.name, nativePx: profile.nativePx, pivotPx: profile.pivotPx},
    palette: {name: palette.name, colors: palette.colors.length, sha256: sha256(Buffer.from(palette.colors.map(c => c.hex).join(',')))},
    outline: {mode: outline.mode, hex: outline.hex, borderIsEdge: outline.borderIsEdge},
    scaleOptions: wanted, marks: marks.map(m => m.hex), cells: infos,
  }};
}

/**
 * Write <id>.png (native sprites with outline), indexed/<id>.png (the outline-free layers the rig baker needs)
 * and pixelize.json to dir. Never overwrites a path listed in `protect`.
 */
export async function writePixelized(dir, result, {protect = []} = {}) {
  const root = path.resolve(dir);
  const ids = [...result.cells.keys()].map(assertCellId);
  const files = ids.map(id => path.join(root, `${id}.png`)), layers = ids.map(id => path.join(root, 'indexed', `${id}.png`));
  const meta = path.join(root, 'pixelize.json');
  assertNoOverwrite([...files, ...layers, meta], protect);
  await fs.mkdir(path.join(root, 'indexed'), {recursive: true});
  await Promise.all(ids.flatMap((id, i) => [
    fs.writeFile(files[i], encodePng(result.cells.get(id).native)),
    fs.writeFile(layers[i], encodePng(result.cells.get(id).indexed))]));
  await fs.writeFile(meta, JSON.stringify(result.record, null, 2) + '\n');
  return root;
}

/** Read a pixelise directory back: {record, cells: Map id -> {indexed, native}}. */
export async function readPixelized(dir) {
  const record = JSON.parse(await fs.readFile(path.join(dir, 'pixelize.json'), 'utf8'));
  if (record.schema !== pixelizeSchema) throw new Error(`${dir} is not a ${pixelizeSchema} directory`);
  const cells = new Map();
  for (const info of record.cells) {
    assertCellId(info.id);
    cells.set(info.id, {native: decodePng(await fs.readFile(path.join(dir, `${info.id}.png`))), indexed: decodePng(await fs.readFile(path.join(dir, 'indexed', `${info.id}.png`)))});
  }
  return {record, cells};
}
