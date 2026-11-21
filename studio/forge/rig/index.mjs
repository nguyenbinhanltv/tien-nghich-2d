// Entry points for the MCP lane: studio_rig_bake, studio_frame_patch and studio_qa_run call these.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bakeClip, frameName } from './bake.mjs';
import { validateRig } from './validate.mjs';
import { validatePatch, applyPatch, appendOps, emptyPatch, patchKey } from './patch.mjs';
import { bodyPlans, checkApplicable, clipTable, getTemplate } from '../motion/library.mjs';
import { runGates, stability, defaultOptions } from '../gates/index.mjs';
import { writeFrame } from './raster.mjs';

export { makePalette, readFrame, writeFrame, framesEqual, contactSheet } from './raster.mjs';
export { validateRig, validatePatch, applyPatch, appendOps, emptyPatch, patchKey, frameName, bakeClip };
export { loadLibrary, getTemplate, listTemplates, coverage, clipTable, checkApplicable, validateLibrary } from '../motion/library.mjs';
export { runGates, stability, defaultOptions } from '../gates/index.mjs';

/**
 * Bake every clip of a manifest profile for a rig.
 * `profile` is a manifest profile ({clips: {name: [frames, durationMs]}}); `profileName` keys the template.
 * `clips` optionally limits which clips to bake. A `patch` document is applied after each bake.
 * Throws with a readable message when the rig, patch or template does not fit.
 */
export function bakeRig({rig, native, library, profile, profileName, palette, patch, clips, edgeSafe}) {
  const rigIssues = validateRig(rig, {palette});
  if (rigIssues.length) throw new Error(`rig is invalid:\n  ${rigIssues.join('\n  ')}`);
  const [width, height] = rig.canvas;
  if (profile.native_px && (profile.native_px[0] !== width || profile.native_px[1] !== height)) throw new Error(`rig canvas ${width}x${height} differs from profile ${profileName} native ${profile.native_px.join('x')}`);
  if (profile.pivot_px && (profile.pivot_px[0] !== rig.pivot[0] || profile.pivot_px[1] !== rig.pivot[1])) throw new Error(`rig pivot ${rig.pivot} differs from profile ${profileName} pivot ${profile.pivot_px}`);
  if (patch) {
    const issues = validatePatch(patch, {palette, width, height});
    if (issues.length) throw new Error(`patch is invalid:\n  ${issues.join('\n  ')}`);
  }
  const table = clipTable(profile);
  const plan = bodyPlans()[rig.bodyPlan];
  const result = {rig: rig.id, profile: profileName, clips: {}, frames: {}};
  for (const name of clips ?? Object.keys(table)) {
    if (!table[name]) throw new Error(`profile ${profileName} has no clip "${name}"`);
    const template = getTemplate(library, profileName, name);
    const fit = checkApplicable(template, rig);
    if (fit.length) throw new Error(`template ${profileName}/${name} does not fit rig ${rig.id}:\n  ${fit.join('\n  ')}`);
    const baked = bakeClip({rig, native, template, clip: table[name], clipName: name, palette, plan, patch, edgeSafe});
    result.clips[name] = baked;
    for (const [facing, out] of Object.entries(baked.facings)) out.frames.forEach((f, i) => { result.frames[frameName(name, facing, i)] = f; });
  }
  return result;
}

/** Write every baked frame as <clip>_<facing>_<n>.png into `dir`; returns the file names written. */
export function writeBake(result, dir) {
  mkdirSync(dir, {recursive: true});
  return Object.entries(result.frames).map(([name, frame]) => { writeFrame(join(dir, `${name}.png`), frame); return `${name}.png`; });
}

/**
 * The facing a gate should read: a mirrored facing borrows the parts of its source (for body offsets) but
 * keeps its own landmarks and features, which are authored in final, mirrored coordinates.
 */
export function gateFacing(rig, name) {
  const facing = rig.facings[name];
  if (!facing.mirrorOf) return facing;
  return {...rig.facings[facing.mirrorOf], landmarks: facing.landmarks ?? [], features: facing.features ?? []};
}

/** Gate input for one clip of one facing. */
export function unitOf(result, clip, facing) {
  const baked = result.clips[clip];
  const out = baked.facings[facing];
  return {clip, facing, loop: baked.loop, frames: out.frames, contacts: out.contacts, poses: out.poses};
}

/**
 * Run the gates over a bake: per clip and facing, plus palette and proportion stability across clips.
 * Returns {pass, findings, metrics: {"<clip>/<facing>": {...}}}. `options` is per-gate, see gates/index.mjs.
 */
export function qaBake(result, {rig, palette, options = {}}) {
  const findings = [], metrics = {};
  for (const clip of Object.keys(result.clips)) {
    for (const facing of Object.keys(rig.facings)) {
      const unit = unitOf(result, clip, facing);
      const run = runGates(unit, {palette, facing: gateFacing(rig, facing), pivot: rig.pivot, mirrored: Boolean(rig.facings[facing].mirrorOf)}, options);
      findings.push(...run.findings);
      metrics[`${clip}/${facing}`] = run.metrics;
    }
  }
  if (options.stability !== false && Object.keys(result.clips).length > 1) {
    for (const facing of Object.keys(rig.facings)) {
      const units = Object.fromEntries(Object.keys(result.clips).map(c => [c, unitOf(result, c, facing)]));
      findings.push(...stability(units, {palette}, {...defaultOptions.stability, ...options.stability}));
    }
  }
  return {pass: !findings.some(f => f.severity === 'error'), findings, metrics};
}
