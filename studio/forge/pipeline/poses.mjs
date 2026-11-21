// Pose-sheet clips: a clip whose keys are imported pose cells (facings by key poses on one sheet) instead of
// rig-derived keys. The pose cells share one scale and one ground line when the sheet was imported with
// scaleOptions.mode "sheet", so poses do not jump. A rig may add secondary motion on top.
//
// forge.poseclips (version 1):
// {
//   "schema": "forge.poseclips", "version": 1,
//   "clips": {
//     "walk": {
//       "keys": ["stand", "step_a", "stand", "step_b"],   // pose names, one per frame of the profile's clip
//       "facings": ["south", "west", "north"],             // optional; default: every facing that has all the cells
//       "mirror": {"east": {"of": "west", "swapColors": {"<palette id>": "<palette id>"}}},   // optional
//       "secondary": {"template": "idle"},                 // optional: motion template (same profile) layered on top
//       "loop": true                                        // optional, default true unless a secondary template says otherwise
//     }
//   }
// }
// The cell for key `p` of facing `f` is the layout cell with id "<p>_<f>".
import { cloneImage } from '../image.mjs';
import { prepareFacing, bakeKey, mirrorFacing } from '../rig/bake.mjs';
import { resolveClip } from '../motion/resolve.mjs';
import { getTemplate, bodyPlans, checkApplicable } from '../motion/library.mjs';
import { applyPatch, patchKey } from '../rig/patch.mjs';

export const poseClipsSchema = 'forge.poseclips';

export function validatePoseClips(doc, {table, layerIds}) {
  const issues = [];
  if (doc?.schema !== poseClipsSchema || doc.version !== 1) return [`not a ${poseClipsSchema} version 1 document`];
  for (const [name, spec] of Object.entries(doc.clips ?? {})) {
    const at = `clips.${name}`;
    if (!table[name]) { issues.push(`${at}: the profile has no clip "${name}"`); continue; }
    if (!Array.isArray(spec.keys) || spec.keys.length !== table[name].frames) issues.push(`${at}.keys: needs exactly ${table[name].frames} pose names (one per frame of the profile clip)`);
    const facings = poseFacings(spec, layerIds);
    if (!facings.length) issues.push(`${at}: no facing has a cell for every key (cells are named <pose>_<facing>)`);
    for (const f of spec.facings ?? []) for (const pose of spec.keys ?? []) if (!layerIds.has(`${pose}_${f}`)) issues.push(`${at}: missing cell "${pose}_${f}"`);
    for (const [f, m] of Object.entries(spec.mirror ?? {})) if (!facings.includes(m.of)) issues.push(`${at}.mirror.${f}: source facing "${m.of}" is not imported for this clip`);
  }
  return issues;
}

/** Facings imported for every key of the clip (or the ones the clip names). */
export function poseFacings(spec, layerIds) {
  if (spec.facings) return [...spec.facings];
  const poses = [...new Set(spec.keys ?? [])];
  const candidates = new Set([...layerIds].flatMap(id => poses.filter(p => id.startsWith(`${p}_`)).map(p => id.slice(p.length + 1))));
  return [...candidates].filter(f => poses.every(p => layerIds.has(`${p}_${f}`)));
}

/**
 * Bake one pose clip. `cells` is Map cellId -> {indexed, native} from pixelise. Returns the same shape a rig
 * clip bake returns: {clip, durationMs, loop, source: "poses", facings: {facing: {frames, contacts, poses}}}.
 * Without `secondary` the frames are the pixelised cells as they are. With it, each key's cell is cut by the
 * rig's parts for that facing and moved by the template, and the baker rebuilds the outline.
 */
export function bakePoseClip({name, spec, clip, cells, palette, rig, library, profileName, patch, canvasWidth, edgeSafe}) {
  const ids = new Set(cells.keys());
  const facings = poseFacings(spec, ids);
  let template = null, plan = null;
  if (spec.secondary) {
    if (!rig) throw new Error(`pose clip "${name}" asks for secondary motion but no rig was given`);
    template = getTemplate(library, profileName, spec.secondary.template ?? name);
    const fit = checkApplicable(template, rig);
    if (fit.length) throw new Error(`secondary template for pose clip "${name}" does not fit rig ${rig.id}:\n  ${fit.join('\n  ')}`);
    plan = bodyPlans()[rig.bodyPlan];
  }
  const baked = {};
  const bakeFacing = f => {
    const frames = [], contacts = [];
    let poses;
    if (template) {
      const facing = rig.facings[f];
      if (!facing || facing.mirrorOf) throw new Error(`pose clip "${name}": rig has no drawn facing "${f}" for secondary motion`);
      poses = resolveClip(template, clip, facing, plan).poses;
    }
    spec.keys.forEach((pose, i) => {
      const cell = cells.get(`${pose}_${f}`);
      if (!template) { frames.push(cloneImage(cell.native)); contacts.push([]); return; }
      const out = bakeKey(prepareFacing(cell.indexed, rig.facings[f], palette), rig.facings[f], poses[i], palette, {edgeSafe});
      frames.push(out.frame); contacts.push(out.contacts);
    });
    return {frames, contacts, poses};
  };
  for (const f of facings) baked[f] = bakeFacing(f);
  for (const [f, m] of Object.entries(spec.mirror ?? {})) {
    const src = baked[m.of];
    baked[f] = {...mirrorFacing(src, {swapColors: m.swapColors}, palette, canvasWidth), poses: src.poses};
  }
  const lookup = (facing, index) => baked[facing]?.frames[index] ?? null;
  const out = {clip: name, durationMs: clip.durationMs, loop: spec.loop ?? (template?.loop !== false), source: 'poses', secondary: Boolean(template), facings: {}};
  for (const [f, b] of Object.entries(baked)) {
    out.facings[f] = {...b, frames: patch ? b.frames.map((fr, i) => applyPatch(fr, patch.frames?.[patchKey(name, f, i)], palette, {lookup})) : b.frames};
  }
  return out;
}
