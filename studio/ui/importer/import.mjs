// Server side of the spritesheet importer (Characters and Objects tabs). A PNG sheet is cut into cells
// and the cells become frames of ONE clip and direction of ONE asset. The frames travel the same roads
// every other change to pixels travels:
//   - a frame that already exists (a raw frame, a processed frame, or a revision history) gets a NEW
//     REVISION in the revision store, pending: only a human approves it;
//   - a frame that does not exist yet becomes a raw submission, with provenance, in the studio's raw
//     frames directory (the same all-or-nothing submission studio_frames_submit uses);
//   - every cell passes the pixel gates (size, palette, binary alpha, outline) BEFORE anything is
//     written, so one bad cell writes nothing;
//   - nothing is written into a shipped directory (processed frames, atlases) at all.
// A dry run reports exactly what would happen and writes nothing.
import { decodeRgba, encodePixels, normalizePng } from '../../core/png.mjs';
import { assetGateOptions, findDefects, severityOf } from '../../core/defects.mjs';
import { clipSpec, framePath, listFrames, isShipped, milestones } from '../../core/assets.mjs';
import { headPng, saveRevision } from '../../core/revisions.mjs';
import { submitFrames } from '../../core/submissions.mjs';
import { readInside } from '../../core/files.mjs';
import { problem } from '../../core/errors.mjs';
import { sha256 } from '../../core/fsutil.mjs';
import { LIMITS, cropCell, cutGrid, selectCells } from './cut.mjs';

const invalid = message => { throw problem(422, 'invalid_input', message); };
const MODES = ['replace', 'append'];
const PIXELISE = 'To bring a drawn sheet onto the palette and the native size, use the pixelise step: studio_sheet_import then studio_process (forge), which cuts, fits and snaps it, and then import the result here.';

async function frameBytes(ws, asset, key, clip, direction, n) {
  const raw = asset.layout.studioRawDir ? await readInside(ws.root, framePath(asset, 'raw', clip, direction, n)).catch(() => null) : null;
  const processed = await readInside(ws.root, framePath(asset, 'processed', clip, direction, n)).catch(() => null);
  const baseline = raw ?? processed;
  const head = baseline ? await headPng(ws, key, baseline) : null;
  const store = await ws.store();
  return {baseline, head, hasHistory: !store.needsBaseline(key), raw: Boolean(raw), processed: Boolean(processed)};
}

/** What the dialog offers for one asset: native size, clips, directions and which frame numbers already exist. */
export async function importInfo({ws, snap, allow = () => true}, assetId) {
  const asset = snap.index.assets.get(assetId);
  if (!asset) throw problem(404, 'unknown_asset', `No asset "${assetId}"`);
  if (!asset.layout || !asset.clips) throw problem(422, 'unsupported', `${assetId} has no frames to import into`);
  if (!allow(asset)) throw problem(403, 'wrong_tab', `${assetId} is not imported from this tab`);
  const existing = {};
  for (const stage of ['raw', 'processed']) for (const f of (await listFrames(ws.root, asset, stage)).frames) (existing[`${f.clip}/${f.direction}`] ??= new Set()).add(f.n);
  return {id: asset.id, category: asset.category, size: asset.size, directions: asset.directions, clips: Object.fromEntries(Object.entries(asset.clips).map(([name, c]) => [name, c.frames])),
    existing: Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])), shipped: isShipped(await milestones(ws.root, asset)), limits: LIMITS};
}

/**
 * options: {assetId, sheetBase64, cell: {w, h, offsetX, offsetY, spacingX, spacingY}, skip?, count?, clip, direction, mode, dryRun}
 * Returns {ok, dryRun, asset, clip, direction, mode, grid, frames: [{name, key, n, action, ...}], refused: [reasons], offer?, written}.
 */
export async function importSheet({ws, snap, caller, allow = () => true}, options) {
  const {assetId, sheetBase64, cell = {}, clip, direction, mode = 'replace', dryRun = true} = options;
  const asset = snap.index.assets.get(assetId);
  if (!asset) throw problem(404, 'unknown_asset', `No asset "${assetId}"`);
  if (!asset.layout || !asset.clips) throw problem(422, 'unsupported', `${assetId} has no frames to import into`);
  if (!allow(asset)) throw problem(403, 'wrong_tab', `${assetId} is not imported from this tab`);
  if (!MODES.includes(mode)) invalid(`mode must be ${MODES.join(' or ')}`);
  const spec = Object.hasOwn(asset.clips, clip) ? clipSpec(asset, clip) : null;
  if (!spec) invalid(`${assetId} has no clip "${clip}". Clips: ${Object.keys(asset.clips).join(', ')}`);
  if (!asset.directions.includes(direction)) invalid(`${assetId} has no direction "${direction}". Directions: ${asset.directions.join(', ')}`);
  if (typeof sheetBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(sheetBase64)) invalid('the sheet must be a PNG as canonical base64');
  const bytes = Buffer.from(sheetBase64, 'base64');
  if (!bytes.length || bytes.length > LIMITS.bytes) invalid(`the sheet must be 1 byte to ${LIMITS.bytes} bytes`);
  let sheet;
  try { sheet = decodeRgba(bytes); } catch (error) { invalid(`the file is not a readable 8-bit PNG: ${error.message}`); }

  const [width, height] = asset.size;
  const refused = [];
  const report = {ok: false, dryRun, asset: assetId, clip, direction, mode, cellSize: [cell.w, cell.h], expected: [width, height], sheet: {width: sheet.width, height: sheet.height, sha256: sha256(bytes)}, frames: [], refused, written: false};
  let grid, chosen = [];
  try {
    grid = cutGrid({sheetW: sheet.width, sheetH: sheet.height, cellW: cell.w, cellH: cell.h, offsetX: cell.offsetX, offsetY: cell.offsetY, spacingX: cell.spacingX, spacingY: cell.spacingY});
    chosen = selectCells(grid, {skip: options.skip, count: options.count});
    report.grid = {cols: grid.cols, rows: grid.rows, cells: grid.cells.length, leftoverX: grid.leftoverX, leftoverY: grid.leftoverY};
  } catch (error) { refused.push({code: 'grid', message: error.message}); return report; }

  if (cell.w !== width || cell.h !== height) {
    refused.push({code: 'size', message: `a cell is ${cell.w}x${cell.h} but ${assetId} (${asset.profile}) is ${width}x${height} pixels. Cut cells of ${width}x${height}, or bring the sheet to native size first.`});
    report.offer = {pixelise: PIXELISE};
    return report;
  }

  // Where the frames land: replace starts at 0; append starts after the last frame the clip and direction already have.
  const have = new Set();
  for (const stage of ['raw', 'processed']) for (const f of (await listFrames(ws.root, asset, stage)).frames) if (f.clip === clip && f.direction === direction) have.add(f.n);
  const start = mode === 'append' ? (have.size ? Math.max(...have) + 1 : 0) : 0;
  if (start + chosen.length > spec.frames) {
    refused.push({code: 'too_many', message: `${clip} has ${spec.frames} frames; ${mode === 'append' ? `${have.size ? 'it already has frames up to ' + (start - 1) + ', so ' : ''}appending ` : 'replacing with '}${chosen.length} would reach frame ${start + chosen.length - 1}. Import fewer cells (count), skip some, or use replace.`});
    return report;
  }

  const options2 = assetGateOptions(snap.pack, snap.palette, asset, 'ignore');
  const plan = [];
  for (const [i, c] of chosen.entries()) {
    const n = start + i, name = `${clip}_${direction}_${n}`, key = asset.layout.keyOf(clip, direction, n);
    const found = findDefects(cropCell(sheet, c, cell.w, cell.h), options2);
    const errors = Object.entries(found.counts).filter(([code]) => severityOf(code) === 'error').map(([code, count]) => ({code, count}));
    const row = {name, key, n, cell: {index: c.index, col: c.col, row: c.row, x: c.x, y: c.y}, errors: found.totals.error, warnings: found.totals.warn, counts: found.counts, defects: found.defects.slice(0, 40), action: null};
    if (found.totals.error) {
      row.action = 'refused';
      row.reasons = errors;
    } else {
      row.png = normalizePng(Buffer.from(encodePixels(cell.w, cell.h, cropCell(sheet, c, cell.w, cell.h).pixels)), width, height, snap.palette.colors);
      const existing = await frameBytes(ws, asset, key, clip, direction, n);
      row.sha256 = sha256(row.png);
      if (existing.head && sha256(existing.head) === row.sha256) row.action = 'unchanged';
      else if (existing.baseline || existing.hasHistory) { row.action = 'revision'; row.existing = existing; }
      else row.action = 'new';
    }
    plan.push(row);
  }
  const bad = plan.filter(r => r.action === 'refused');
  const offPalette = bad.some(r => r.counts.off_palette || r.counts.partial_alpha);
  if (bad.length) {
    refused.push({code: 'gates', message: `${bad.length} of ${plan.length} cells break the pixel gates (${[...new Set(bad.flatMap(r => Object.keys(r.counts)))].join(', ')}), so nothing was written.`});
    if (offPalette) report.offer = {pixelise: PIXELISE};
  }
  const fresh = plan.filter(r => r.action === 'new');
  if (fresh.length && !asset.layout.studioRawDir) refused.push({code: 'not_open', message: `${assetId} is not open for new frames from here (only design-manifest assets are); frames ${fresh.map(r => r.n).join(', ')} do not exist yet. Import fewer cells, or only over frames that exist.`});
  else if (fresh.length && isShipped(await milestones(ws.root, asset))) refused.push({code: 'shipped', message: `${assetId} already has processed frames, so new frames cannot be added; frames ${fresh.map(r => r.n).join(', ')} do not exist yet. Frames that exist change through revisions.`});

  report.frames = plan.map(({png, existing, ...row}) => row);
  if (refused.length) return report;
  report.ok = true;
  if (dryRun) return report;

  // Write. Provenance for new frames; a revision for every frame that exists. Nothing above wrote anything.
  const provenance = {tool: 'studio spritesheet importer', prompt: `cut a ${sheet.width}x${sheet.height} sheet into ${cell.w}x${cell.h} cells (offset ${cell.offsetX ?? 0},${cell.offsetY ?? 0}, spacing ${cell.spacingX ?? 0},${cell.spacingY ?? 0}) and imported cells ${chosen[0].index} to ${chosen.at(-1).index} as ${clip} ${direction} (${mode})`, sourceHash: report.sheet.sha256};
  if (fresh.length) {
    const {accepted, report: sub} = await submitFrames({ws, pack: snap.pack, palette: snap.palette, index: snap.index, asset, caller, provenance,
      frames: fresh.map(r => ({clip, direction, n: r.n, pngBase64: plan.find(p => p.n === r.n).png.toString('base64')}))});
    if (!accepted) { refused.push({code: 'submission', message: sub.message ?? 'the submission was not accepted'}); report.ok = false; return report; }
  }
  for (const r of plan) {
    if (r.action !== 'revision') continue;
    const saved = await saveRevision(ws, {key: r.key, baseline: r.existing.baseline, png: r.png});
    const row = report.frames.find(f => f.n === r.n);
    Object.assign(row, {revision: saved.revision, status: saved.status, action: saved.changed ? 'revision' : 'unchanged'});
  }
  report.written = report.frames.some(f => f.action === 'revision' || f.action === 'new');
  return report;
}
