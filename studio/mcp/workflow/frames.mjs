// In-memory frames (forge images) to what a tool returns: a contact sheet an agent can look at, and a
// submission through the same gated, immutable path as studio_frames_submit.
import { renderContactSheet } from '../../core/contact-sheet.mjs';
import { assetGateOptions, findDefects } from '../../core/defects.mjs';
import { submitFrames } from '../../core/submissions.mjs';
import { encodePng } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { parseFrameName } from './forge.mjs';

/** Gate options for judging an asset's pixels (outline only where the asset's category carries one). */
export const pixelOptions = (snap, asset, dirtyTransparent = 'warn') => assetGateOptions(snap.pack, snap.palette, asset, dirtyTransparent);

/** Baked frames {name: image} (names `<clip>_<direction>_<n>`) -> render cells with their defects. */
export function cellsOf(frames, options) {
  return Object.entries(frames).map(([name, image]) => {
    const p = parseFrameName(name);
    const r = findDefects(image, options);
    return { clip: p?.clip ?? name, direction: p?.direction ?? 'none', n: p?.n ?? 0, image, defects: r.defects, errors: r.totals.error, warnings: r.totals.warn };
  });
}

/** Pixelised cells (a Map id -> {native}) with their import records -> render cells: pose is the row, facing the column group. */
export function cellsOfPixelized(pixelized, options) {
  return pixelized.record.cells.map((c) => {
    const image = pixelized.cells.get(c.id).native;
    const r = findDefects(image, options);
    return { clip: c.pose ?? 'sprite', direction: c.facing ?? c.id, n: 0, image, defects: r.defects, errors: r.totals.error, warnings: r.totals.warn };
  });
}

/** A tool result with a contact sheet image plus a short text that names rows and columns. */
export function sheetContent({ title, cells, scale = 4, overlay = true, extra = {} }) {
  if (!cells.length) return { content: [{ type: 'text', text: `${title}: no frames to show.` }], structured: { layout: null, defects: { errors: 0, warnings: 0 }, ...extra } };
  let sheet;
  try { sheet = renderContactSheet(cells, { scale, overlay }); }
  catch (error) { if (error.code === 'too_large') throw new ToolError(error.message); throw error; }
  const rows = sheet.layout.rows.map((r, i) => `row ${i + 1}: ${r.clip} ${r.direction}, frames ${r.frames.join(',')}`).join('; ');
  const defects = { errors: cells.reduce((n, c) => n + c.errors, 0), warnings: cells.reduce((n, c) => n + c.warnings, 0) };
  return {
    content: [
      { type: 'text', text: `${title}: ${cells.length} frame(s) at x${sheet.layout.scale}, ${sheet.width}x${sheet.height}px. ${rows}. Bars: ${sheet.layout.bar}. Defects: ${defects.errors} error pixel(s), ${defects.warnings} warning pixel(s).` },
      { type: 'image', data: sheet.png.toString('base64'), mimeType: 'image/png' },
    ],
    structured: { layout: sheet.layout, width: sheet.width, height: sheet.height, defects, ...extra },
  };
}

/** Baked frames {name: image} -> submitFrames input. */
export function toSubmission(frames) {
  return Object.entries(frames).map(([name, image]) => {
    const p = parseFrameName(name);
    if (!p) throw new ToolError(`cannot submit "${name}": not a <clip>_<direction>_<n> frame name`);
    return { ...p, pngBase64: Buffer.from(encodePng(image)).toString('base64') };
  });
}

/** Submit baked frames; returns the submitFrames result ({accepted, report}). */
export function submitBaked({ ws, snap, asset, frames, provenance, caller, dryRun = false }) {
  return submitFrames({ ws, pack: snap.pack, palette: snap.palette, index: snap.index, asset, frames: toSubmission(frames), provenance, caller, dryRun });
}
