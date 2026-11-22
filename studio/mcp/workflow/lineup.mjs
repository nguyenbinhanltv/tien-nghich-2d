// The lineup ruler, from a workspace: which pack group applies to an asset, the approved references (style-locked entities)
// drawn and measured, the asset's standing pose measured against them. The measuring, judging and drawing are in
// studio/forge/figure/lineup.mjs; this file only finds the frames.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listFrames } from '../../core/assets.mjs';
import { writeFileAtomic } from '../../core/fsutil.mjs';
import { shown, workDir } from './forge.mjs';
import { readInside } from '../../core/files.mjs';
import { gateOptions } from '../../core/gates.mjs';
import { decodeRgba } from '../../core/png.mjs';
import { judgeLineup, lineupMessages, medianMeasure, referenceMeasure, renderLineup } from '../../forge/figure/lineup.mjs';
import { encodePng, makeImage } from '../../forge/image.mjs';

const toImage = (bytes) => { const d = decodeRgba(bytes); return makeImage(d.width, d.height, d.pixels); };

/** {name, spec} of the pack lineup group that covers this asset's profile (or category), or null. */
export function lineupGroup(pack, asset) {
  const profile = asset.profile ?? asset.category;
  for (const [name, spec] of Object.entries(pack.lineup ?? {})) if (spec.profiles.includes(profile)) return { name, spec };
  return null;
}

/** The standing-pose frames of an asset at a stage, decoded: [{name, image}] (empty when the pose has no frames). */
export async function standingFrames(root, asset, stage, pose) {
  const found = await listFrames(root, asset, stage);
  const out = [];
  for (const f of found.frames.filter((x) => x.clip === pose.clip && x.direction === pose.direction)) {
    try { out.push({ name: f.name, image: toImage(await readInside(root, f.rel)) }); } catch { /* an unreadable frame is the QA size check's to report */ }
  }
  return out;
}

/**
 * The references of a group: for each named pack reference, the first of its assets that has standing frames (processed).
 * Returns {references: [{name, asset, size, frames, measure}], reference: median measure | null, missing: [text]}.
 */
export async function loadReferences(ws, snap, group, ink) {
  const references = [], missing = [];
  for (const name of group.spec.references ?? []) {
    const entry = snap.pack.references?.[name];
    if (!entry) { missing.push(`the pack has no reference "${name}"`); continue; }
    let found = null;
    for (const id of entry.assets) {
      const asset = snap.index.assets.get(id);
      if (!asset?.layout) continue;
      const frames = await standingFrames(ws.root, asset, 'processed', group.spec.pose);
      if (frames.length) { found = { name, asset: id, size: asset.size, frames, measure: medianMeasure(frames.map((f) => f.image), ink) }; break; }
    }
    if (found) references.push(found); else missing.push(`reference ${name} has no processed ${group.spec.pose.clip}/${group.spec.pose.direction} frames`);
  }
  return { references, reference: references.length ? referenceMeasure(references.map((r) => r.measure)) : null, missing };
}

export const inkOf = (snap) => gateOptions(snap.pack, snap.palette).outline;

/**
 * Judge an asset's standing pose (frames given as images) against the group's references.
 * Returns {applies: false, why} or {applies: true, group, references, figure, reference, verdict, messages, notProven}.
 */
export async function lineupFor(ws, snap, asset, images) {
  const group = lineupGroup(snap.pack, asset);
  if (!group) return { applies: false, why: `no lineup group in the pack covers profile ${asset.profile ?? asset.category}` };
  const ink = inkOf(snap);
  const { references, reference, missing } = await loadReferences(ws, snap, group, ink);
  if (!reference) return { applies: false, group, why: missing.join('; ') || 'the group names no reference' };
  if (references.some((r) => r.size && asset.size && (r.size[0] !== asset.size[0] || r.size[1] !== asset.size[1])))
    return { applies: false, group, why: `the references are drawn at ${references[0].size.join('x')} and ${asset.id} at ${asset.size.join('x')}; a lineup compares figures of one native size` };
  if (!images.length) return { applies: false, group, why: `${asset.id} has no ${group.spec.pose.clip}/${group.spec.pose.direction} frames to measure yet` };
  const figure = medianMeasure(images, ink);
  const verdict = judgeLineup({ figure, reference, spec: group.spec });
  return { applies: true, group, references, figure, reference, verdict, messages: lineupMessages(verdict, references.map((r) => r.name).join(' and ')), notProven: verdict.notProven };
}

/** The lineup picture as PNG bytes: the references, then the asset's first standing frame, on one ground line. */
export function lineupPicture(result, asset, frameImage) {
  const bands = result.group.spec.tolerance?.heightRatio, soft = result.group.spec.typical?.heightRatio;
  const img = renderLineup({
    figures: [...result.references.map((r) => ({ image: r.frames[0].image, name: r.asset.replace(/^[a-z]+_/, ''), tone: 'reference' })), ...(frameImage ? [{ image: frameImage, name: asset.id.replace(/^[a-z]+_/, ''), tone: 'newcomer' }] : [])],
    reference: result.reference, bands: bands ? { min: bands.min, max: bands.max, typicalMin: soft?.min, typicalMax: soft?.max } : undefined,
  });
  return { png: Buffer.from(encodePng(img)), width: img.width, height: img.height, placed: img.placed };
}

/**
 * What a review request carries about the lineup: the verdict, a picture a human can look at (the references and this asset's
 * standing frame on one ground line, saved under the work directory) and one line for the request's comment. dryRun saves nothing.
 * Returns null when no lineup group covers the asset or it cannot run (the reason is in `why` of a returned {applies: false}).
 */
export async function lineupForReview(ws, snap, asset, stage, { dryRun = false } = {}) {
  const group = lineupGroup(snap.pack, asset);
  if (!group) return null;
  const frames = await standingFrames(ws.root, asset, stage, group.spec.pose);
  const result = await lineupFor(ws, snap, asset, frames.map((f) => f.image));
  if (!result.applies) return { applies: false, why: result.why };
  const pic = lineupPicture(result, asset, frames[0].image);
  const sha = createHash('sha256').update(pic.png).digest('hex');
  const abs = workDir(ws, asset, 'lineup', `${asset.id}-lineup-${sha.slice(0, 12)}.png`);
  if (!dryRun) { await fs.mkdir(path.dirname(abs), { recursive: true }); await writeFileAtomic(abs, pic.png); }
  const rel = shown(ws, abs);
  return { applies: true, status: result.verdict.status, messages: result.messages, rows: result.verdict.rows, group: group.name, references: result.references.map((r) => r.name),
    image: rel, sha256: sha, line: `Lineup (${result.verdict.status}) against ${result.references.map((r) => r.name).join(' and ')}: ${rel}${result.messages.length ? ' | ' + result.messages.join(' ') : ''}` };
}
