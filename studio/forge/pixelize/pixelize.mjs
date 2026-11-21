// Pixelisation: a cleaned crop (see ../sheet/import.mjs) -> a native-size sprite on the project palette.
// Steps: premultiplied box downscale at the recorded scale, foot anchored at the profile pivot,
// binary alpha, palette snap with the outline colour (and marks) reserved, 1px outline rebuilt.
import fs from 'node:fs/promises';
import path from 'node:path';
import { blit, boundsOf, boxDownscale, createImage, encodePng, rebuildOutline, roundHalfEven, sha256, snapPalette, thresholdAlpha } from '../image.mjs';
import { assertNoOverwrite, normalizeScale } from '../sheet/import.mjs';

export const pixelizeSchema = 'forge.pixelize';

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
  const [x0, y0] = entry.bounds, [gx, gy] = entry.ground;
  const dims = [Math.max(1, roundHalfEven(figure.width * fit.scale)), Math.max(1, roundHalfEven(figure.height * fit.scale))];
  const reduced = boxDownscale(figure, ...dims);
  const origin = [pivotX + roundHalfEven((x0 - gx) * fit.scale), fit.targetY + roundHalfEven((y0 - gy) * fit.scale)];
  const canvas = blit(createImage(width, height), reduced, origin[0], origin[1]);
  const sampled = thresholdAlpha(canvas);
  const reserved = [...(outline.color ? [outline.color] : []), ...marks.map(m => m.rgb)];
  const ordinary = palette.colors.map(c => c.rgb).filter(rgb => !reserved.some(r => sameRgb(r, rgb)));
  const indexed = snapPalette(sampled, ordinary);
  const markPixels = marks.map(() => 0);
  const d = sampled.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] !== 255) continue;
    marks.forEach((m, k) => {
      if (d[i] >= m.minRgb[0] && d[i + 1] >= m.minRgb[1] && d[i + 2] >= m.minRgb[2] && d[i + 2] - d[i + 1] >= m.blueOverGreen) {
        indexed.data.set(m.rgb, i);
        markPixels[k]++;
      }
    });
  }
  const native = outline.mode === 'none' ? indexed : rebuildOutline(indexed, outline.color, {borderIsEdge: outline.borderIsEdge});
  const box = boundsOf(native);
  const warnings = [];
  if (!box) warnings.push('sprite is empty after reduction');
  else if (box[0] === 0 || box[1] === 0 || box[2] === width || box[3] === height) warnings.push('sprite touches the canvas boundary');
  if (origin[0] < 0 || origin[1] < 0 || origin[0] + dims[0] > width || origin[1] + dims[1] > height) warnings.push('reduced figure was clipped by the canvas');
  const marksVisible = marks.map(m => { let n = 0; for (let i = 0; i < native.data.length; i += 4) if (native.data[i + 3] === 255 && sameRgb(native.data.subarray(i, i + 3), m.rgb)) n++; return {id: m.id, hex: m.hex, sourcePx: markPixels[marks.indexOf(m)], visiblePx: n}; });
  return {indexed, native, info: {id: entry.id, facing: entry.facing, pose: entry.pose, sourceGround: [gx, gy], sourceBounds: entry.bounds,
    nativeOrigin: origin, scale: fit.scale, scaleLimit: fit.limit, reducedSize: dims, bounds: box, marks: marksVisible, warnings}};
}

/** Pixelise every cell of an import ({record, cells}); returns {record, cells: Map id -> {indexed, native}}. */
export function pixelizeImport(imported, settings, {marks = [], scaleOptions} = {}) {
  const cells = new Map(), infos = [];
  for (const entry of imported.record.cells) {
    const {indexed, native, info} = pixelizeCell(entry, imported.cells.get(entry.id), settings, {marks, scaleOptions});
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
    marks: marks.map(m => m.hex), cells: infos,
  }};
}

/** Write <id>.png (native sprites) and pixelize.json to dir. Never overwrites a path listed in `protect`. */
export async function writePixelized(dir, result, {protect = []} = {}) {
  const root = path.resolve(dir);
  const ids = [...result.cells.keys()];
  const files = ids.map(id => path.join(root, `${id}.png`)), meta = path.join(root, 'pixelize.json');
  assertNoOverwrite([...files, meta], protect);
  await fs.mkdir(root, {recursive: true});
  await Promise.all(ids.map((id, i) => fs.writeFile(files[i], encodePng(result.cells.get(id).native))));
  await fs.writeFile(meta, JSON.stringify(result.record, null, 2) + '\n');
  return root;
}
