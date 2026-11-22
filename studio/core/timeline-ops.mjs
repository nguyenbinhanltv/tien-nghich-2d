// Operations over an asset's frames that touch several frames at once: scoped transforms (E3) and the timeline's linked cels (E1).
// Everything here ends in NEW REVISIONS saved together (saveRevisions: all or nothing), pending, like every change to pixels; no raw
// file is written and nothing is approved. A frame in a link group is never saved alone: the group moves together (E1).
import { clipSpec, framePath } from './assets.mjs';
import { assetGateOptions, findDefects } from './defects.mjs';
import { problem } from './errors.mjs';
import { readInside } from './files.mjs';
import { decodeRgba, encodePixels } from './png.mjs';
import { headPng, saveRevisions } from './revisions.mjs';
import { readMetadata } from './metadata.mjs';
import { groupOf, linkGroups } from './timeline.mjs';
import { SCOPES, checkTransform, transformImage } from './transform.mjs';

/** A frame's baseline file (raw first, then processed) and its newest pixels, or null when the frame does not exist. */
export async function loadFrame(ws, asset, clip, direction, n) {
  const key = asset.layout.keyOf(clip, direction, n);
  const raw = asset.layout.studioRawDir ? await readInside(ws.root, framePath(asset, 'raw', clip, direction, n)).catch(() => null) : null;
  const baseline = raw ?? await readInside(ws.root, framePath(asset, 'processed', clip, direction, n)).catch(() => null);
  if (!baseline) return null;
  const png = await headPng(ws, key, baseline) ?? baseline;
  return {clip, direction, n, key, name: `${clip}_${direction}_${n}`, baseline, image: decodeRgba(png)};
}

/** The frames a scope covers around an anchor {clip, direction, n}: frame (one), clip (the anchor's clip, its direction), all (every clip, its direction). */
export function scopeFrames(asset, anchor, scope) {
  if (!SCOPES.includes(scope)) throw problem(422, 'invalid_input', `scope must be one of ${SCOPES.join(', ')}`);
  const out = [];
  for (const [clip, spec] of Object.entries(asset.clips ?? {})) {
    if (scope !== 'all' && clip !== anchor.clip) continue;
    for (let n = 0; n < spec.frames; n++) if (scope !== 'frame' || (clip === anchor.clip && n === anchor.n)) out.push({clip, direction: anchor.direction, n});
  }
  if (!out.length) throw problem(422, 'invalid_input', `${anchor.clip} is not a clip of ${asset.id}`);
  return out;
}

/**
 * Plan a scoped transform. Returns {frames: [{name, key, clip, n, lost, moved, changed, linkedFrom?}], items, refused: [reason]} where `items`
 * are ready for saveRevisions. Every frame that shares a cel with a frame in scope is added (`linkedFrom` names why); the group's image is the
 * result of its lowest frame in scope. A result that breaks the pixel gates refuses the whole plan: nothing partial is ever saved.
 */
export async function planTransform({ws, snap, asset, anchor, scope = 'frame', transform}) {
  const t = checkTransform(transform);
  const metadata = (await readMetadata(ws.root, asset))?.data ?? null;
  const targets = scopeFrames(asset, anchor, scope);
  const planned = new Map(), order = [];
  const options = assetGateOptions(snap.pack, snap.palette, asset, 'ignore');
  const refused = [];
  const missing = [];
  const take = async (rec, from) => {
    const k = `${rec.clip}/${rec.n}`;
    if (planned.has(k)) return;
    const frame = await loadFrame(ws, asset, rec.clip, rec.direction, rec.n);
    if (!frame) { missing.push(`${rec.clip}_${rec.direction}_${rec.n}`); planned.set(k, null); return; }
    planned.set(k, {frame, from});
    order.push(k);
  };
  for (const rec of targets) {
    await take(rec);
    for (const n of groupOf(linkGroups(metadata?.clips?.[rec.clip], rec.direction), rec.n)) if (n !== rec.n) await take({...rec, n}, rec);
  }
  // A scope that includes frames which do not exist yet only transforms the ones that do; a lone missing anchor is an error.
  if (missing.length && (scope === 'frame' || missing.length === targets.length)) throw problem(422, 'no_frame', `${missing.join(', ')} has no pixels yet, so there is nothing to transform`);
  const result = new Map(); // link group key -> {image, lost, moved}
  const frames = [], items = [];
  for (const k of order) {
    const {frame, from} = planned.get(k);
    const groups = linkGroups(metadata?.clips?.[frame.clip], frame.direction);
    const group = groupOf(groups, frame.n);
    const gk = group.length > 1 ? `${frame.clip}/${group[0]}` : k;
    let done = result.get(gk);
    if (!done) {
      // The anchor of a group is the first member in scope; its result is the group's image.
      const source = group.length > 1 ? (order.map(o => planned.get(o).frame).find(f => f.clip === frame.clip && group.includes(f.n) && !planned.get(`${f.clip}/${f.n}`).from) ?? frame) : frame;
      let r;
      try { r = transformImage(source.image, t); } catch (error) { refused.push(`${source.name}: ${error.message}`); continue; }
      done = r; result.set(gk, done);
    }
    const found = findDefects(done.image, options);
    if (found.totals.error) refused.push(`${frame.name}: the result breaks the pixel gates (${Object.entries(found.counts).filter(([, c]) => c).map(([code, c]) => `${code} x${c}`).join(', ')})`);
    const same = Buffer.compare(done.image.pixels, frame.image.pixels) === 0;
    frames.push({name: frame.name, key: frame.key, clip: frame.clip, n: frame.n, lost: done.lost, moved: done.moved, changed: !same, ...(from ? {linkedFrom: `${from.clip}_${from.direction}_${from.n}`} : {}), ...(done.note ? {note: done.note} : {})});
    if (!same) items.push({key: frame.key, baseline: frame.baseline, png: Buffer.from(encodePixels(frame.image.width, frame.image.height, done.image.pixels))});
  }
  return {frames, items, refused, skippedMissing: missing, transform: t, scope};
}

/** Save a plan's items as pending revisions, all or nothing. `provenance` rides with each revision. */
export async function savePlan(ws, plan, provenance) {
  if (plan.refused.length) throw problem(422, 'refused', `nothing was saved: ${plan.refused.join('; ')}`);
  const saves = await saveRevisions(ws, plan.items.map(i => ({...i, provenance})));
  const byKey = new Map(plan.items.map((i, x) => [i.key, saves[x]]));
  return plan.frames.map(f => ({...f, ...(byKey.has(f.key) ? {revision: byKey.get(f.key).revision, status: byKey.get(f.key).status} : {})}));
}
