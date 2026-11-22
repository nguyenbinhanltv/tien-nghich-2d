// The VFX tab's human "Build + audit" action (server side). It rebuilds one effect's committed SpriteFX spec through the SAME registered
// adapter and the SAME shared build as the studio_vfx_build tool (studio/mcp/workflow/vfx.mjs), into the project's git-ignored scratch
// directory only. It reads the spec and the delivered frames; it never writes into the project's asset folders and never touches review state.
import { createHash } from 'node:crypto';
import { readInside } from '../../../core/files.mjs';
import { assetGateOptions, findDefects } from '../../../core/defects.mjs';
import { crop, decodePng } from '../../../forge/index.mjs';
import { openProject } from '../../../mcp/project.mjs';
import { callDir, shown } from '../../../mcp/workflow/forge.mjs';
import { buildTwice, checkSpec, vfxAdapter } from '../../../mcp/workflow/vfx.mjs';
import { problem } from '../../../server/editor-catalog.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let running = 0;

/** Frames of a rebuilt sheet vs the delivered frames on disk: same count, same size, same pixels. */
export function compareFrames(rebuilt, delivered) {
  const out = {rebuilt: rebuilt.length, delivered: delivered.filter(Boolean).length, expected: delivered.length, pixelIdentical: 0, differing: [], sizeMismatch: [], missing: []};
  rebuilt.forEach((img, i) => {
    const ref = delivered[i];
    if (!ref) { out.missing.push(i); return; }
    if (ref.width !== img.width || ref.height !== img.height) { out.sizeMismatch.push(i); return; }
    if (Buffer.compare(ref.pixels, img.pixels) === 0) out.pixelIdentical++; else out.differing.push(i);
  });
  out.identical = out.rebuilt === out.expected && out.pixelIdentical === out.rebuilt;
  return out;
}

/**
 * Rebuild `effect` (clip, variant) from `specPath`. `reference` is {path?, sha256?, source}: the delivered or recorded sheet to compare
 * byte for byte. `deliveredPaths` are the delivered frames of that clip and variant, in order.
 */
export async function buildAndAudit({root, libraryDir, effect, specPath, deliveredPaths, reference}) {
  if (running >= 1) throw problem(409, 'build_running', 'A build is already running. Wait for it to finish.');
  running++;
  const project = openProject(root, {libraryDir});
  try {
    let spec, bytes;
    try { bytes = await readInside(root, specPath); spec = JSON.parse(bytes); } catch { throw problem(404, 'spec_missing', 'This effect has no committed SpriteFX spec to build.'); }
    const snap = await project.workspace.snapshot();
    const asset = snap.index.assets.get(effect.id);
    if (!asset?.layout) throw problem(404, 'unknown_asset', 'The studio index has no frame asset for this effect.');
    const ws = project.workspace;
    let vfx, specText;
    try { vfx = vfxAdapter(snap.pack); specText = checkSpec(spec, vfx.palettes, {requirePalette: false}); }
    catch (error) { throw problem(422, 'spec_refused', error.message); }
    const base = await callDir(ws, asset, 'vfx');
    const built = await buildTwice({root: ws.root, vfx, spec, specText, base}).catch(error => {
      if (error?.status) throw error;
      throw problem(error?.message?.includes('registered as') ? 424 : 422, error?.message?.includes('registered as') ? 'toolchain_missing' : 'build_failed', error?.message ?? 'The build failed.');
    });
    const out = {id: effect.id, spec: {path: specPath, sha256: sha(bytes), name: spec.name}, scratch: shown(ws, base), writesToAssets: false, changesStatus: false};
    // The program prints absolute scratch paths; the human sees paths relative to the project.
    const tidy = text => text.replaceAll(ws.root + '/', '');
    built.audit.output = tidy(built.audit.output);
    if (!built.ok) return {...out, ok: false, audit: built.audit};
    const sheet = decodePng(built.sheetBytes);
    const frames = built.meta.frames.map(f => crop(sheet, f.x, f.y, f.x + f.w, f.y + f.h));
    const options = assetGateOptions(snap.pack, snap.palette, asset, 'warn');
    const gate = {errors: 0, warnings: 0, counts: {}, framesWithDefects: 0};
    for (const img of frames) {
      const r = findDefects(img, options);
      gate.errors += r.totals.error; gate.warnings += r.totals.warn;
      if (r.totals.error || r.totals.warn) gate.framesWithDefects++;
      for (const [code, n] of Object.entries(r.counts)) gate.counts[code] = (gate.counts[code] ?? 0) + n;
    }
    gate.verdict = gate.errors ? 'fail' : gate.warnings ? 'warn' : 'pass';
    const delivered = [];
    for (const p of deliveredPaths) { try { delivered.push(p ? decodePng(await readInside(root, p)) : null); } catch { delivered.push(null); } }
    const compare = {frames: compareFrames(frames, delivered), sheet: {rebuiltSha256: built.sheetSha256, reference: null}};
    if (reference?.sha256) compare.sheet.reference = {source: reference.source, sha256: reference.sha256, identical: reference.sha256 === built.sheetSha256};
    compare.byteIdentical = compare.sheet.reference ? compare.sheet.reference.identical : null;
    compare.verdict = compare.byteIdentical ? 'byte-identical' : compare.frames.identical ? 'pixel-identical' : 'different';
    return {...out, ok: true, audit: built.audit, deterministic: built.deterministic, gate, compare,
      table: {count: frames.length, size: built.meta.frame_size, anchor: built.meta.anchor, fps: built.meta.fps, loop: built.meta.loop, durationsMs: built.meta.frames.map(f => f.duration), events: built.meta.events ?? []},
      sheet: {png: built.sheetBytes.toString('base64'), width: sheet.width, height: sheet.height, frames: built.meta.frames.map(f => ({x: f.x, y: f.y, w: f.w, h: f.h}))}};
  } finally { running--; project.close(); }
}

