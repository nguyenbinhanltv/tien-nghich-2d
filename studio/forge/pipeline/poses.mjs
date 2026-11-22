// Pose-sheet clips: a clip whose keys are imported pose cells (facings by key poses on one sheet) instead of
// rig-derived keys. The pose cells share a scale and a ground line when the sheet was imported with
// scaleOptions.mode "facing" (poses of a facing together) or "sheet" (all cells), so poses do not jump; a facing's
// scale can also be locked to the turnaround with scaleOptions.fixedScale. A rig may add secondary motion on top.
//
// forge.poseclips (version 1):
// {
//   "schema": "forge.poseclips", "version": 1,
//   "clips": {
//     "walk": {
//       "keys": ["stand", "step_a", "stand", "step_b"],   // pose names, one per frame of the profile's clip
//       "facings": ["south", "west", "north"],             // optional; default: every facing that has all the cells
//       "contacts": {"south": [[{"id": "paw_l", "xy": [11, 24], "planted": true}], ...]},   // optional, per facing: one list per key
//       "mirror": {"east": {"of": "west", "swapColors": {"<palette id>": "<palette id>"}}},   // optional
//       "landmarks": {"south": [{"id": "left_ear", "color": "<palette id>", "box": [19, 13, 22, 17]}]},   // optional: anatomical boxes the mark must stay in, checked by the markSide gate
//       "qa": {"identity": {"maxInteriorChange": 0.5}},     // optional gate options for this clip (drawn keys skip the flicker gate unless set)
//       "secondary": {"template": "idle"},                 // optional: motion template (same profile) layered on top
//       "loop": true                                        // optional, default true unless a secondary template says otherwise
//     }
//   }
// }
// The cell for key `p` of facing `f` is the layout cell with id "<p>_<f>".
import { alphaAt, cloneImage } from '../image.mjs';
import { prepareFacing, bakeKey, mirrorFacing } from '../rig/bake.mjs';
import { resolveClip } from '../motion/resolve.mjs';
import { sequenceHash } from '../pixelize/hold.mjs';
import { getTemplate, bodyPlans, checkApplicable } from '../motion/library.mjs';
import { applyPatch, patchKey } from '../rig/patch.mjs';

export const poseClipsSchema = 'forge.poseclips';

export function validatePoseClips(doc, {table, layerIds, palette}) {
  const issues = [];
  if (doc?.schema !== poseClipsSchema || doc.version !== 1) return [`not a ${poseClipsSchema} version 1 document`];
  for (const [name, spec] of Object.entries(doc.clips ?? {})) {
    const at = `clips.${name}`;
    if (!table[name]) { issues.push(`${at}: the profile has no clip "${name}"`); continue; }
    if (!Array.isArray(spec.keys) || spec.keys.length !== table[name].frames) issues.push(`${at}.keys: needs exactly ${table[name].frames} pose names (one per frame of the profile clip)`);
    const facings = poseFacings(spec, layerIds);
    if (!facings.length) issues.push(`${at}: no facing has a cell for every key (cells are named <pose>_<facing>)`);
    for (const f of spec.facings ?? []) for (const pose of spec.keys ?? []) if (!layerIds.has(`${pose}_${f}`)) issues.push(`${at}: missing cell "${pose}_${f}"`);
    for (const [f, lists] of Object.entries(spec.contacts ?? {})) {
      if (!facings.includes(f)) issues.push(`${at}.contacts.${f}: not a facing of this clip`);
      else if (!Array.isArray(lists) || lists.length !== (spec.keys ?? []).length) issues.push(`${at}.contacts.${f}: needs one list per key (${(spec.keys ?? []).length})`);
      else lists.forEach((list, i) => list.forEach(c => { if (typeof c.id !== 'string' || !Array.isArray(c.xy) || c.xy.length !== 2 || typeof c.planted !== 'boolean') issues.push(`${at}.contacts.${f}[${i}]: each contact needs id, xy [x, y] and planted`); }));
    }
    for (const [f, marks] of Object.entries(spec.landmarks ?? {})) {
      if (!facings.includes(f) && !spec.mirror?.[f]) issues.push(`${at}.landmarks.${f}: not a facing of this clip`);
      for (const m of marks) {
        if (typeof m.id !== 'string' || typeof m.color !== 'string' || !Array.isArray(m.box) || m.box.length !== 4 || m.box.some(v => !Number.isInteger(v)) || m.box[2] <= m.box[0] || m.box[3] <= m.box[1])
          issues.push(`${at}.landmarks.${f}: each landmark needs id, color and a non-empty integer box [x0, y0, x1, y1]`);
        else if (palette && !palette.has(m.color)) issues.push(`${at}.landmarks.${f}.${m.id}: unknown palette id "${m.color}"`);
      }
    }
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
 * Bake one pose clip. `cells` is Map cellId -> {indexed, native} from pixelise; `held` (optional) is Map `<clip>/<facing>/<i>` -> {indexed, native}, the colour-held frame for that playing position. Returns the same shape a rig
 * clip bake returns: {clip, durationMs, loop, source: "poses", facings: {facing: {frames, contacts, poses}}}.
 * Without `secondary` the frames are the pixelised cells as they are. With it, each key's cell is cut by the
 * rig's parts for that facing and moved by the template, and the baker rebuilds the outline.
 */
/**
 * The loop setting each pose clip bakes with: its own `loop`, else the secondary template's (a one-shot such as a strike
 * stays one), else true. Same rule as bakePoseClip. A template that cannot be found counts as looping here; the bake reports it.
 */
export function effectiveLoops(poseClips, {library, profileName} = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(poseClips?.clips ?? {})) {
    let loop = spec.loop;
    if (loop === undefined && spec.secondary && library) {
      try { loop = getTemplate(library, profileName, spec.secondary.template ?? name).loop !== false; } catch { loop = true; }
    }
    out[name] = loop ?? true;
  }
  return out;
}

export function bakePoseClip({name, spec, clip, cells, held, palette, rig, library, profileName, patch, canvasWidth, edgeSafe}) {
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
  const loop = spec.loop ?? (template?.loop !== false);
  const bakeFacing = f => {
    // Held frames are valid only for the sequence they were made for: same clip, facing, ordered keys and loop setting.
    const heldFrames = spec.keys.map((_, i) => held?.get(`${name}/${f}/${i}`));
    if (heldFrames.some(Boolean)) {
      const expected = sequenceHash(name, f, spec.keys, loop);
      const bad = heldFrames.findIndex(h => !h || h.seq !== expected);
      if (bad >= 0) throw new Error(`pose clip "${name}" (${f}): the held frames were made for a different key sequence or loop setting (key ${bad}); run pixelise again with the same --poses`);
    }
    const frames = [], contacts = [];
    let poses;
    if (template) {
      const facing = rig.facings[f];
      if (!facing || facing.mirrorOf) throw new Error(`pose clip "${name}": rig has no drawn facing "${f}" for secondary motion`);
      poses = resolveClip(template, clip, facing, plan).poses;
    }
    spec.keys.forEach((pose, i) => {
      // Held output is per clip, facing and key index; without it the plain cell.
      const cell = held?.get(`${name}/${f}/${i}`) ?? cells.get(`${pose}_${f}`);
      let frame, list = [];
      if (!template) frame = cloneImage(cell.native);
      else { const out = bakeKey(prepareFacing(cell.indexed, rig.facings[f], palette), rig.facings[f], poses[i], palette, {edgeSafe}); frame = out.frame; list = out.contacts; }
      const declared = spec.contacts?.[f]?.[i];
      if (declared) {
        for (const c of declared) {
          const [x, y] = c.xy;
          if (x < 0 || y < 0 || x >= frame.width || y >= frame.height || alphaAt(frame, x, y) !== 255) throw new Error(`pose clip "${name}": contact ${c.id} of ${f} key ${i} at ${x},${y} is not on an opaque pixel`);
        }
        list = declared.map(c => ({id: c.id, xy: [...c.xy], planted: c.planted}));
      }
      frames.push(frame); contacts.push(list);
    });
    return {frames, contacts, poses};
  };
  for (const f of facings) baked[f] = bakeFacing(f);
  for (const [f, m] of Object.entries(spec.mirror ?? {})) {
    const src = baked[m.of];
    baked[f] = {...mirrorFacing(src, {swapColors: m.swapColors}, palette, canvasWidth), poses: src.poses};
  }
  const lookup = (facing, index) => baked[facing]?.frames[index] ?? null;
  const out = {clip: name, durationMs: clip.durationMs, loop, source: 'poses', secondary: Boolean(template), landmarks: spec.landmarks, qa: spec.qa, facings: {}};
  for (const [f, b] of Object.entries(baked)) {
    out.facings[f] = {...b, frames: patch ? b.frames.map((fr, i) => applyPatch(fr, patch.frames?.[patchKey(name, f, i)], palette, {lookup})) : b.frames};
  }
  return out;
}
