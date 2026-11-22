// Motion template library: declarative clips keyed by "<profile>/<clip>" per body plan.
// Frame counts and durations are never stored here; they come from the project manifest's clip tables.
import { readFileSync } from 'node:fs';
import { validateSchema } from '../../core/json-schema.mjs';

const here = new URL('.', import.meta.url);
const readJson = relative => JSON.parse(readFileSync(new URL(relative, here), 'utf8'));

export const bodyPlans = () => readJson('bodyplans.json').plans;
export const motionSchema = () => readJson('motion.schema.json');

const channels = ['rotate', 'dx', 'dy', 'forward'];

/** Load the shipped library for a body plan ("quadruped" or "biped"). */
export function loadLibrary(plan) {
  if (!bodyPlans()[plan]) throw new Error(`unknown body plan "${plan}"`);
  const library = readJson(`templates/${plan}.json`);
  const issues = validateLibrary(library);
  if (issues.length) throw new Error(`motion library ${plan} is invalid:\n  ${issues.join('\n  ')}`);
  return library;
}

/** Structural and semantic checks of a library or a single template. Returns issue strings. */
export function validateLibrary(library) {
  const issues = validateSchema(motionSchema(), library);
  if (issues.length) return issues;
  const plan = bodyPlans()[library.bodyPlan];
  if (!plan) return [`unknown body plan "${library.bodyPlan}"`];
  for (const [name, archetype] of Object.entries(library.archetypes)) issues.push(...validateTracks(archetype.tracks, plan, `archetypes.${name}`));
  for (const [key, binding] of Object.entries(library.templates)) {
    if (!/^[a-z_]+\/[a-z_]+$/.test(key)) issues.push(`templates.${key}: key must be "<profile>/<clip>"`);
    if (!library.archetypes[binding.use]) issues.push(`templates.${key}: unknown archetype "${binding.use}"`);
  }
  return issues;
}

function validateTracks(tracks, plan, at) {
  const issues = [];
  const ids = new Set();
  for (const track of tracks) {
    const here = `${at}.${track.id}`;
    if (ids.has(track.id)) issues.push(`${here}: duplicate track id`);
    ids.add(track.id);
    for (const role of track.target.roles ?? [track.target.role]) if (!plan.roles[role]) issues.push(`${here}: role "${role}" is not in the body plan`);
    const kinds = ['gait', 'contactPose', 'channel'].filter(k => k in track);
    if (kinds.length !== 1) issues.push(`${here}: needs exactly one of channel, gait, contactPose`);
    if ('channel' in track) {
      if (!channels.includes(track.channel)) issues.push(`${here}: unknown channel "${track.channel}"`);
      if (!track.curve) issues.push(`${here}: a channel track needs a curve`);
      else if (Object.keys(track.curve).filter(k => ['const', 'wave', 'keyframes', 'keys'].includes(k)).length !== 1) issues.push(`${here}: curve needs exactly one of const, wave, keyframes, keys`);
    }
  }
  return issues;
}

/** Multiply pixel-valued amplitudes by `scale` (rotation angles are left alone). */
function scaled(tracks, scale) {
  const px = v => v * scale;
  return tracks.map(t => {
    const track = structuredClone(t);
    if (track.gait) { track.gait.stride = px(track.gait.stride ?? 1); track.gait.lift = px(track.gait.lift ?? 1); }
    else if (track.contactPose) {
      const c = track.contactPose;
      c.maxShift = px(c.maxShift ?? 1); c.dip = px(c.dip ?? 0);
    } else if (['dx', 'dy', 'forward'].includes(track.channel)) {
      const c = track.curve;
      if (c.keyframes) c.keyframes = c.keyframes.map(([t0, v]) => [t0, px(v)]);
      else if (c.wave) { c.wave.amp = px(c.wave.amp ?? 1); if (c.wave.offset) c.wave.offset = px(c.wave.offset); }
      else if (c.keys) c.keys = c.keys.map(px);
      else if ('const' in c) c.const = px(c.const);
    }
    return track;
  });
}

/** Look up and expand a template: {bodyPlan, profile, clip, loop, tracks}. Throws if there is none. */
export function getTemplate(library, profile, clip) {
  const binding = library.templates[`${profile}/${clip}`];
  if (!binding) {
    const own = Object.keys(library.templates).filter(k => k.startsWith(`${profile}/`)).map(k => k.split('/')[1]);
    throw new Error(`no ${library.bodyPlan} motion template for ${profile}/${clip}. ` +
      `This library has ${own.length ? `templates for ${profile} clips: ${own.join(', ')}` : `no template for "${profile}" at all (an asset planned with a custom spec has its own id as its profile name)`}; archetypes: ${Object.keys(library.archetypes).join(', ')}. ` +
      `Bind the clip to an archetype: pass library to studio_rig_bake (the ${library.bodyPlan} library with the template "${profile}/${clip}": {"use": "<archetype>"} added under templates; the archetype names are in studio_template_get motion.archetypes), ` +
      `or bake this clip from drawn key poses instead (poseClips, no library needed).`);
  }
  const archetype = library.archetypes[binding.use];
  return {
    bodyPlan: library.bodyPlan, profile, clip, loop: archetype.loop !== false,
    tracks: scaled(archetype.tracks, binding.scale ?? 1)
  };
}

export const listTemplates = library => Object.keys(library.templates);

/** Pull the clip table of a manifest profile into {frames, durationMs} entries keyed by clip. */
export function clipTable(profile) {
  return Object.fromEntries(Object.entries(profile.clips).map(([name, [frames, durationMs]]) => [name, {frames, durationMs}]));
}

/**
 * Which manifest clips have a template in this library? `profiles` is the manifest's `profiles` object.
 * Only profiles whose assigned agent is the forge are considered unless `all` is set.
 */
export function coverage(library, profiles, {all = false} = {}) {
  const missing = [], covered = [];
  for (const [name, profile] of Object.entries(profiles)) {
    if (!all && profile.assigned_agent !== 'studio_forge') continue;
    for (const clip of Object.keys(profile.clips)) (library.templates[`${name}/${clip}`] ? covered : missing).push(`${name}/${clip}`);
  }
  return {covered, missing};
}

/** Can this template drive this rig? Returns issue strings; empty means yes. */
export function checkApplicable(template, rig) {
  const issues = [];
  if (rig.bodyPlan !== template.bodyPlan) issues.push(`rig body plan "${rig.bodyPlan}" differs from template body plan "${template.bodyPlan}"`);
  const plan = bodyPlans()[template.bodyPlan];
  for (const [name, facing] of Object.entries(rig.facings)) {
    if (facing.mirrorOf) continue;
    const have = facing.parts.map(p => p.role);
    for (const [role, spec] of Object.entries(plan.roles)) {
      const count = have.filter(r => r === role).length;
      if (spec.required && count < (spec.min ?? 1)) issues.push(`facing ${name}: needs ${spec.min ?? 1}+ "${role}" part(s), has ${count}`);
    }
  }
  return issues;
}
