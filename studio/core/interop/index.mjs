// Open an asset in a drawing tool and bring the hand edits back (E7). EXPORT writes one asset and direction as a .pxo (Pixelorama) or an
// .ase (LibreSprite, Aseprite; RGBA or indexed on the project palette) into an export staging directory, with the clips as tags,
// the durations and the linked cels. IMPORT reads such a file back and makes every changed frame a new PENDING revision with provenance
// ("edited by hand in <tool>"). It refuses, with the reason and before saving anything, a canvas of the wrong size, pixels off the project
// palette or partly transparent, a timeline that no longer matches the asset's clips, and linked frames edited in two different ways.
// An unchanged file changes nothing: every frame it holds is the same pixels as the frame's newest revision.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assetGateOptions, findDefects } from '../defects.mjs';
import { problem } from '../errors.mjs';
import { sha256 } from '../fsutil.mjs';
import { saveRevisions } from '../revisions.mjs';
import { encodePixels } from '../png.mjs';
import { readMetadata } from '../metadata.mjs';
import { flatTimeline, groupOf, linkGroups } from '../timeline.mjs';
import { loadFrame } from '../timeline-ops.mjs';
import { decodeAse, encodeAse } from './ase.mjs';
import { decodePxo, encodePxo } from './pxo.mjs';

export const FORMATS = Object.freeze({
  pxo: {ext: 'pxo', tool: 'Pixelorama', label: {en: 'Pixelorama (.pxo)', vi: 'Pixelorama (.pxo)'}},
  ase: {ext: 'ase', tool: 'LibreSprite or Aseprite', label: {en: 'LibreSprite / Aseprite (.ase, RGBA)', vi: 'LibreSprite / Aseprite (.ase, RGBA)'}},
  'ase-indexed': {ext: 'ase', tool: 'LibreSprite or Aseprite', label: {en: 'LibreSprite / Aseprite (.ase, indexed on the project palette)', vi: 'LibreSprite / Aseprite (.ase, màu chỉ mục theo bảng màu dự án)'}},
});
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const hexRgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

/** The interchange document of an asset in one direction: every clip's frames in order, as their newest pixels. */
export async function buildDoc({ws, snap, asset, direction}) {
  if (!asset.layout || !asset.clips) throw problem(422, 'unsupported', `${asset.id} has no frames`);
  if (!asset.directions.includes(direction)) throw problem(422, 'invalid_input', `${asset.id} has no direction "${direction}". Directions: ${asset.directions.join(', ')}`);
  const metadata = (await readMetadata(ws.root, asset))?.data ?? null;
  const flat = flatTimeline(asset, metadata, direction);
  const frames = [], missing = [];
  for (const f of flat.frames) {
    const frame = await loadFrame(ws, asset, f.clip, direction, f.n);
    if (!frame) { missing.push(`${f.clip}_${direction}_${f.n}`); continue; }
    frames.push({pixels: Buffer.from(frame.image.pixels), durationMs: f.durationMs, linkTo: f.linkTo});
  }
  if (missing.length) throw problem(409, 'frames_missing', `${asset.id} (${direction}) has no pixels for ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}; a file is made only from a complete timeline`);
  const [width, height] = asset.size;
  return {width, height, mode: 'rgba', frames, tags: flat.tags, palette: snap.paletteFile.colors.map(c => hexRgb(c.hex))};
}

/** Write the export. `dir` is an export staging directory (the caller guards it). Returns {file, bytes, sha256, tool, frames, tags, notes}. */
export async function exportAsset({ws, snap, asset, direction, format, dir}) {
  const spec = FORMATS[format];
  if (!spec) throw problem(422, 'invalid_input', `format must be one of ${Object.keys(FORMATS).join(', ')}`);
  const doc = await buildDoc({ws, snap, asset, direction});
  const bytes = format === 'pxo' ? encodePxo(doc, {name: asset.id}) : encodeAse({...doc, mode: format === 'ase-indexed' ? 'indexed' : 'rgba'});
  await fs.mkdir(dir, {recursive: true});
  const name = `${asset.id.replace(/[^A-Za-z0-9_.-]+/g, '_')}.${direction}${format === 'ase-indexed' ? '.indexed' : ''}.${spec.ext}`;
  await fs.writeFile(path.join(dir, name), bytes);
  return {file: name, bytes: bytes.length, sha256: sha256(bytes), format, tool: spec.tool, frames: doc.frames.length, tags: doc.tags.map(t => ({name: t.name, from: t.from, to: t.to, play: t.play})),
    links: doc.frames.filter(f => f.linkTo !== null).length,
    notes: [`One ${spec.tool} file holds the ${direction} direction: ${doc.frames.length} frames, one tag per clip (${doc.tags.map(t => t.name).join(', ')}).`,
      'Draw on the one layer, keep to the project palette and opaque pixels, and do not rename or move tags; change nothing else you want kept. Import it back from this page.',
      format === 'pxo' ? 'Written to the structure of Pixelorama\'s published source; tag direction and linked cels travel in user-data fields. Opened in Pixelorama 1.2.4 (exported to a sheet, pixel-equal; tags, durations and linked cels were not read back there).'
        : 'Written to the published .ase format; checked by reading it back here. Opened in LibreSprite 1.3 (frames, tags, durations, pixels, RGBA and indexed); not opened in Aseprite itself.']};
}

const kindOf = bytes => (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b ? 'pxo' : bytes.length > 6 && bytes.readUInt16LE(4) === 0xa5e0 ? 'ase' : null);

/**
 * Import a file for one asset and direction. Returns {ok, dryRun, format, tool, frames: [{name, key, action: unchanged|revision|refused, ...}], refused: [{code, message}], notes, written}.
 * Pixels only: tag names, play directions and durations that differ from the asset's are reported in `notes`, not applied (they change through studio_metadata_set).
 */
export async function importFile({ws, snap, asset, direction, bytes, dryRun = true, caller}) {
  if (!asset.layout || !asset.clips) throw problem(422, 'unsupported', `${asset.id} has no frames`);
  if (!asset.directions.includes(direction)) throw problem(422, 'invalid_input', `${asset.id} has no direction "${direction}"`);
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_FILE_BYTES) throw problem(422, 'invalid_input', `the file must be 1 byte to ${MAX_FILE_BYTES} bytes`);
  const kind = kindOf(bytes);
  if (!kind) throw problem(422, 'invalid_input', 'the file is neither a Pixelorama .pxo (a ZIP) nor an Aseprite .ase file');
  const tool = FORMATS[kind].tool;
  const report = {ok: false, dryRun, asset: asset.id, direction, format: kind, tool, sha256: sha256(bytes), frames: [], refused: [], notes: [], written: false};
  let doc;
  try { doc = kind === 'pxo' ? decodePxo(bytes) : decodeAse(bytes); }
  catch (error) { report.refused.push({code: 'unreadable', message: error.message}); return report; }

  const [width, height] = asset.size;
  if (doc.width !== width || doc.height !== height) {
    report.refused.push({code: 'size', message: `the canvas is ${doc.width}x${doc.height} but ${asset.id} is ${width}x${height} pixels; resizing the canvas in the tool is not imported`});
    return report;
  }
  const metadata = (await readMetadata(ws.root, asset))?.data ?? null;
  const flat = flatTimeline(asset, metadata, direction);
  if (doc.frames.length !== flat.frames.length) {
    report.refused.push({code: 'frames', message: `the file has ${doc.frames.length} frames but ${asset.id} has ${flat.frames.length} (${flat.tags.map(t => `${t.name} ${t.to - t.from + 1}`).join(', ')}); frames are not added or removed by import`});
    return report;
  }
  for (const t of flat.tags) {
    const got = doc.tags.find(x => x.name === t.name);
    if (got && (got.from !== t.from || got.to !== t.to)) { report.refused.push({code: 'tags', message: `tag ${t.name} covers frames ${got.from}-${got.to} in the file but ${t.from}-${t.to} in ${asset.id}; the clips cannot be re-cut by import`}); return report; }
    if (got && got.play !== t.play) report.notes.push(`tag ${t.name} plays ${got.play} in the file and ${t.play} in the asset; the asset's play direction is kept (studio_metadata_set changes it)`);
    if (!got) report.notes.push(`the file has no tag ${t.name}; clips are taken from the asset's frame order`);
  }
  for (const t of doc.tags) if (!flat.tags.some(x => x.name === t.name)) report.notes.push(`the file's tag "${t.name}" is not a clip of ${asset.id} and was ignored`);
  const durations = doc.frames.filter((f, i) => f.durationMs !== flat.frames[i].durationMs).length;
  if (durations) report.notes.push(`${durations} frame duration(s) differ from the asset's; durations are not imported (studio_metadata_set changes them)`);

  const options = assetGateOptions(snap.pack, snap.palette, asset, 'ignore');
  const rows = [];
  for (const [i, f] of flat.frames.entries()) {
    const image = {width, height, pixels: doc.frames[i].pixels};
    const frame = await loadFrame(ws, asset, f.clip, direction, f.n);
    const row = {name: `${f.clip}_${direction}_${f.n}`, key: asset.layout.keyOf(f.clip, direction, f.n), clip: f.clip, n: f.n, index: i, action: null};
    if (!frame) { row.action = 'refused'; row.reasons = [{code: 'no_frame', count: 1}]; rows.push(row); continue; }
    const same = Buffer.compare(image.pixels, frame.image.pixels) === 0;
    if (same) { row.action = 'unchanged'; row.frame = frame; row.image = image; rows.push(row); continue; }
    const found = findDefects(image, options);
    const errors = Object.entries(found.counts).filter(([code, c]) => c && found.defects.some(d => d.code === code && d.severity === 'error'));
    if (found.totals.error) { row.action = 'refused'; row.reasons = errors.map(([code, count]) => ({code, count})); row.defects = found.defects.filter(d => d.severity === 'error').slice(0, 12); }
    else { row.action = 'revision'; row.frame = frame; row.image = image; }
    rows.push(row);
  }
  // Linked cels: a group is one image. Edited the same way is one edit; edited two ways is a conflict.
  for (const clip of Object.keys(asset.clips)) {
    for (const group of linkGroups(metadata?.clips?.[clip], direction)) {
      const mine = rows.filter(r => r.clip === clip && group.includes(r.n));
      const changed = mine.filter(r => r.action === 'revision');
      const kinds = new Set(changed.map(r => sha256(r.image.pixels)));
      if (kinds.size > 1) { report.refused.push({code: 'link_conflict', message: `frames ${mine.map(r => r.n).join(', ')} of ${clip} share one image but were edited in different ways; edit one of them`}); continue; }
      if (!changed.length) continue;
      const source = changed[0];
      for (const r of mine) if (r.action === 'unchanged' && r !== source) { r.action = 'revision'; r.image = source.image; r.linkedFrom = source.name; }
    }
  }
  const bad = rows.filter(r => r.action === 'refused');
  if (bad.length) {
    const codes = [...new Set(bad.flatMap(r => r.reasons.map(x => x.code)))];
    report.refused.push({code: 'gates', message: `${bad.length} of ${rows.length} frames break the pixel gates (${codes.join(', ')}): ${bad.slice(0, 4).map(r => r.name).join(', ')}${bad.length > 4 ? ', ...' : ''}. Nothing was saved. Paint with the project palette, opaque pixels only.`});
  }
  report.frames = rows.map(({frame, image, ...row}) => row);
  if (report.refused.length) return report;
  report.ok = true;
  if (dryRun) return report;
  const provenance = {tool: `edited by hand in ${tool}`, format: kind, sourceHash: report.sha256, session: caller?.session ?? null, agent: caller?.agent ?? null, at: new Date().toISOString()};
  const todo = rows.filter(r => r.action === 'revision');
  const saves = await saveRevisions(ws, todo.map(r => ({key: r.key, baseline: r.frame.baseline, png: Buffer.from(encodePixels(width, height, r.image.pixels)), provenance})));
  todo.forEach((r, i) => { const row = report.frames.find(f => f.key === r.key); Object.assign(row, {revision: saves[i].revision, status: saves[i].status, action: saves[i].changed ? 'revision' : 'unchanged'}); });
  report.written = report.frames.some(f => f.action === 'revision');
  return report;
}
