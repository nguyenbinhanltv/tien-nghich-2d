// The forge as one pipeline: template -> import -> pixelise -> rig bake -> patches -> gates.
// Every stage is also exported on its own. Results are plain JSON-serialisable summaries (what an MCP tool
// hands back) plus the in-memory artifacts (images) for callers that want to look at pixels.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPack } from '../../core/pack.mjs';
import { decodePng, encodePng, makePalette, readFrame, sha256 } from '../image.mjs';
import { normalizeLayout } from '../sheet/layout.mjs';
import { importSheet, writeImport } from '../sheet/import.mjs';
import { settingsFromPack, resolveMarks } from '../pixelize/settings.mjs';
import { pixelizeImport, writePixelized } from '../pixelize/pixelize.mjs';
import { bakeRig, writeBake, gateFacing, unitOf } from '../rig/index.mjs';
import { validateRig } from '../rig/validate.mjs';
import { validatePatch } from '../rig/patch.mjs';
import { loadLibrary, clipTable } from '../motion/library.mjs';
import { runGates, stability, defaultOptions } from '../gates/index.mjs';
import { bakePoseClip, validatePoseClips, poseClipsSchema } from './poses.mjs';
import { identityDrift } from './drift.mjs';

export { identityDrift, defaultDrift } from './drift.mjs';
export { poseClipsSchema, validatePoseClips, poseFacings, bakePoseClip } from './poses.mjs';
export const bakeSchema = 'forge.bake';

/** Load the pack and resolve forge settings (palette, outline, profile) from it, plus the rig-lane palette. */
export async function openForgeProject(root, profile, {packFile} = {}) {
  root = await fs.realpath(root);
  const pack = await loadPack(root, packFile);
  const settings = await settingsFromPack(pack, root, profile);
  return {pack, root, settings, palette: rigPalette(settings)};
}

/** The rig lane's palette helper over the settings' palette; the outline colour must be a palette id. */
export function rigPalette(settings) {
  const {palette, outline} = settings;
  const outlineId = outline.mode === 'none' ? null : palette.colors.find(c => c.hex === outline.hex)?.id ?? null;
  if (outline.mode !== 'none' && !outlineId) throw new Error('the rig baker needs the outline colour to be a palette entry with an id');
  return makePalette({colors: palette.colors.map(({id, hex}) => ({id, hex})), outline_id: outlineId});
}

/** A manifest-style profile object for the rig lane, from the settings' profile. */
export const manifestProfile = settings => ({native_px: settings.profile.nativePx, pivot_px: settings.profile.pivotPx, clips: settings.profile.clips ?? {}});

function stage(name, fn) {
  try { return {ok: true, value: fn()}; }
  catch (error) { return {ok: false, stage: name, error: error.message}; }
}

/**
 * Bake every clip: rig-derived clips through the rig baker, pose-sheet clips from imported cells, then apply
 * the patch. `cells` is the Map from pixelise (id -> {indexed, native}); the rig is fed the outline-free
 * `indexed` layer. `rig` may be omitted when only pose clips are baked. Returns {rig, profile, clips, frames}.
 */
export function bakeStage({settings, palette, cells, rig, poseRig, poseClips, library, patch, clips, edgeSafe}) {
  const profile = manifestProfile(settings), name = settings.profile.name, table = clipTable(profile);
  const [width, height] = settings.profile.nativePx;
  const result = {rig: rig?.id ?? null, profile: name, clips: {}, frames: {}};
  const poseSpecs = poseClips?.clips ?? {};
  if (poseClips) {
    const issues = validatePoseClips(poseClips, {table, layerIds: new Set(cells.keys()), palette});
    if (issues.length) throw new Error(`pose clips are invalid:\n  ${issues.join('\n  ')}`);
  }
  if (patch) {
    const issues = validatePatch(patch, {palette, width, height});
    if (issues.length) throw new Error(`patch is invalid:\n  ${issues.join('\n  ')}`);
  }
  const bodyPlan = (rig ?? poseRig)?.bodyPlan;
  library ??= bodyPlan ? loadLibrary(bodyPlan) : null;
  if (rig) {
    const native = Object.fromEntries([...cells].map(([id, c]) => [id, c.indexed]));
    const rigClips = clips ?? Object.keys(table).filter(c => !poseSpecs[c]);
    if (rigClips.length) {
      const baked = bakeRig({rig, native, library, profile, profileName: name, palette, patch, clips: rigClips, edgeSafe});
      Object.assign(result.clips, baked.clips); Object.assign(result.frames, baked.frames);
    }
  }
  for (const [clipName, spec] of Object.entries(poseSpecs)) {
    if (clips && !clips.includes(clipName)) continue;
    const baked = bakePoseClip({name: clipName, spec, clip: table[clipName], cells, palette, rig: poseRig ?? rig, library, profileName: name, patch, canvasWidth: width, edgeSafe});
    result.clips[clipName] = baked;
    for (const [facing, out] of Object.entries(baked.facings)) out.frames.forEach((f, i) => { result.frames[`${clipName}_${facing}_${i}`] = f; });
  }
  return result;
}

const stub = {parts: [], landmarks: [], features: []};

/**
 * Gates over a bake: per clip and facing (rig landmarks apply to rig clips and to pose clips with secondary motion;
 * a plain pose clip is judged against the `landmarks` its own spec declares), plus palette and proportion stability
 * across the clips of each facing. Pose clips (drawn keys) skip the A-B-A flicker gate by default, which is tuned for rig keys,
 * and get the identity-drift measure instead (warnings). `options.pose` overrides for them, e.g.
 * `{flicker: {maxPixels: 60}, identity: {maxInteriorChange: 0.5, maxColorShift: 0.3}}`; a pose clip's own `qa` applies on top.
 * Returns {pass, findings, metrics}.
 */
export function qaStage(result, {settings, palette, rig, poseRig, options = {}}) {
  const findings = [], metrics = {};
  const pivot = settings.profile.pivotPx;
  for (const [clip, baked] of Object.entries(result.clips)) {
    const owner = baked.source === 'poses' ? (baked.secondary ? poseRig ?? rig : null) : rig;
    for (const facing of Object.keys(baked.facings)) {
      const known = owner?.facings[facing];
      const declared = baked.source === 'poses' ? baked.landmarks?.[facing] : null;
      const drawn = baked.source === 'poses';
      const {pose: poseOptions = {}, ...gateOptions} = options;
      const clipOptions = drawn ? {flicker: false, ...gateOptions, ...poseOptions, ...(baked.qa ?? {})} : gateOptions;
      const {identity, ...forGates} = clipOptions;
      const unit = unitOf(result, clip, facing);
      const run = runGates(unit,
        {palette, facing: known ? gateFacing(owner, facing) : declared ? {...stub, landmarks: declared} : stub, pivot, mirrored: Boolean(known?.mirrorOf)}, forGates);
      findings.push(...run.findings);
      metrics[`${clip}/${facing}`] = run.metrics;
      if (drawn && identity !== false) {
        const drift = identityDrift(unit, {palette}, identity);
        findings.push(...drift.findings);
        metrics[`${clip}/${facing}`] = {...run.metrics, ...drift.metrics};
      }
    }
  }
  if (options.stability !== false && Object.keys(result.clips).length > 1) {
    const facings = new Set(Object.values(result.clips).flatMap(c => Object.keys(c.facings)));
    for (const facing of facings) {
      const units = Object.fromEntries(Object.keys(result.clips).filter(c => result.clips[c].facings[facing]).map(c => [c, unitOf(result, c, facing)]));
      if (Object.keys(units).length > 1) findings.push(...stability(units, {palette}, {...defaultOptions.stability, ...options.stability}));
    }
  }
  return {pass: !findings.some(f => f.severity === 'error'), findings, metrics};
}

const frameHashes = result => Object.fromEntries(Object.entries(result.frames).map(([n, f]) => [n, sha256(encodePng(f))]));

/** JSON summary of a bake: per clip and facing frame counts, contacts and a SHA-256 for every frame. */
export function summarizeBake(result) {
  return JSON.parse(JSON.stringify({
    schema: bakeSchema, version: 1, rig: result.rig, profile: result.profile,
    clips: Object.fromEntries(Object.entries(result.clips).map(([name, c]) => [name, {
      durationMs: c.durationMs, loop: c.loop, source: c.source ?? 'rig', ...(c.secondary !== undefined ? {secondary: c.secondary} : {}),
      ...(c.landmarks ? {landmarks: c.landmarks} : {}), ...(c.qa ? {qa: c.qa} : {}),
      facings: Object.fromEntries(Object.entries(c.facings).map(([f, o]) => [f, {frames: o.frames.length, contacts: o.contacts, poses: o.poses ?? null}]))}])),
    frames: frameHashes(result),
  }));  // through JSON so the summary is exactly what a tool would send (no -0, no undefined)
}

/** Write frames as <clip>_<facing>_<n>.png and bake.json (contacts and poses, so the gates can run again from disk). */
export async function writeBakeDir(result, dir) {
  const names = writeBake(result, dir);
  await fs.writeFile(path.join(dir, 'bake.json'), JSON.stringify(summarizeBake(result), null, 2) + '\n');
  return names;
}

export async function readBakeDir(dir) {
  const doc = JSON.parse(await fs.readFile(path.join(dir, 'bake.json'), 'utf8'));
  if (doc.schema !== bakeSchema) throw new Error(`${dir} is not a ${bakeSchema} directory`);
  const result = {rig: doc.rig, profile: doc.profile, clips: {}, frames: {}};
  for (const [name, c] of Object.entries(doc.clips)) {
    result.clips[name] = {clip: name, durationMs: c.durationMs, loop: c.loop, source: c.source, ...(c.secondary !== undefined ? {secondary: c.secondary} : {}),
      ...(c.landmarks ? {landmarks: c.landmarks} : {}), ...(c.qa ? {qa: c.qa} : {}), facings: {}};
    for (const [f, o] of Object.entries(c.facings)) {
      const frames = Array.from({length: o.frames}, (_, i) => readFrame(path.join(dir, `${name}_${f}_${i}.png`)));
      frames.forEach((fr, i) => { result.frames[`${name}_${f}_${i}`] = fr; });
      result.clips[name].facings[f] = {frames, contacts: o.contacts, poses: o.poses ?? undefined};
    }
  }
  return result;
}

/**
 * Import a drawn sheet and run the rest of the pipeline on it.
 * input: {project: {root, profile} | {settings, palette}, layout, sheet: {bytes} | {image, bytes?}, prompt, marks, hold (false = off; an object overlays the pack's forge.pixelize.hold; held across each pose clip's own keys and loop flag), poseOrder (only when no poseClips),
 *   scaleOptions, rig, poseRig, poseClips, library, patch, clips, edgeSafe, qa (gate options), out}
 * Nothing here throws for a bad input: project loading ("project"), "import", "pixelize", "bake", "gates" and the output
 * step ("write") are stages, and a failing one ends the run with {ok: false, failed: <stage>, error}. A finished run is
 * ok only when the gates have no error finding. With `out`, import/, pixelize/, bake/ (whatever finished) and
 * pipeline.json are written even when a stage failed, so a failed run can be diagnosed from disk; a failure of the
 * write itself is reported as `writeError` (and as `failed: "write"` when nothing else failed).
 */
export async function runPipeline(input) {
  const summary = {ok: false, failed: null, error: null, profile: input.project?.profile ?? input.project?.settings?.profile?.name ?? null, stages: {}};
  const artifacts = {};
  const fail = (name, error) => { summary.ok = false; summary.failed = name; summary.error = error; summary.stages[name] = {ok: false, error}; };
  await execute(input, summary, artifacts, fail);
  if (input.out) {
    try {
      const out = path.resolve(input.out);
      const protect = input.sheet?.source ? [path.resolve(input.sheet.source)] : [];
      await fs.mkdir(out, {recursive: true});
      if (artifacts.import) await writeImport(path.join(out, 'import'), artifacts.import, {protect});
      if (artifacts.pixelized) await writePixelized(path.join(out, 'pixelize'), artifacts.pixelized, {protect});
      if (artifacts.bake) await writeBakeDir(artifacts.bake, path.join(out, 'bake'));
      summary.out = out;
      await fs.writeFile(path.join(out, 'pipeline.json'), JSON.stringify(summary, null, 2) + '\n');
    } catch (error) {
      summary.writeError = error.message;
      if (!summary.failed) { summary.ok = false; summary.failed = 'write'; summary.error = error.message; summary.stages.write = {ok: false, error: error.message}; }
      try { await fs.writeFile(path.join(path.resolve(input.out), 'pipeline.json'), JSON.stringify(summary, null, 2) + '\n'); } catch { /* the directory itself is unusable */ }
    }
  }
  return {summary, artifacts};
}

async function execute(input, summary, artifacts, fail) {
  const opened = await (async () => {
    try { return {ok: true, value: input.project.settings ? input.project : await openForgeProject(input.project.root, input.project.profile)}; }
    catch (error) { return {ok: false, error: error.message}; }
  })();
  if (!opened.ok) return fail('project', opened.error);
  const {settings, palette} = opened.value;
  summary.profile = settings.profile.name;
  const run = (name, fn) => { const step = stage(name, fn); if (!step.ok) fail(name, step.error); return step; };

  const imported = run('import', () => {
    const layout = normalizeLayout(input.layout);
    const bytes = input.sheet.bytes ? Buffer.from(input.sheet.bytes) : undefined;
    const image = input.sheet.image ?? decodePng(bytes);
    return importSheet({layout, sheet: image, sheetBytes: bytes, source: input.sheet.source, prompt: input.prompt ?? '', profile: settings.profile, scaleOptions: input.scaleOptions});
  });
  if (!imported.ok) return;
  artifacts.import = imported.value;
  const importWarnings = imported.value.record.cells.filter(c => c.warnings.length).map(c => ({cell: c.id, warnings: c.warnings}));
  summary.stages.import = {ok: true, record: imported.value.record, warnings: importWarnings};

  const pixelized = run('pixelize', () => pixelizeImport(imported.value, settings, {marks: resolveMarks(input.marks ?? [], settings.palette), hold: input.hold, order: input.poseOrder, poseClips: input.poseClips}));
  if (!pixelized.ok) return;
  artifacts.pixelized = pixelized.value;
  const warnings = pixelized.value.record.cells.filter(c => c.warnings.length).map(c => ({cell: c.id, warnings: c.warnings}));
  summary.stages.pixelize = {ok: true, record: pixelized.value.record, warnings,
    ...(pixelized.value.record.hold ? {hold: {...pixelized.value.record.hold, heldPerFrame: Object.fromEntries(pixelized.value.record.cells.filter(c => c.held !== undefined).map(c => [c.id, c.held]))}} : {})};

  if (!input.rig && !input.poseClips) { summary.ok = true; return; }
  const baked = run('bake', () => {
    if (input.rig) {
      const issues = validateRig(input.rig, {palette});
      if (issues.length) throw new Error(`rig is invalid:\n  ${issues.join('\n  ')}`);
    }
    return bakeStage({settings, palette, cells: pixelized.value.cells, rig: input.rig, poseRig: input.poseRig, poseClips: input.poseClips,
      library: input.library, patch: input.patch, clips: input.clips, edgeSafe: input.edgeSafe});
  });
  if (!baked.ok) return;
  artifacts.bake = baked.value;
  summary.stages.bake = {ok: true, patched: Object.keys(input.patch?.frames ?? {}).length, ...summarizeBake(baked.value)};
  const qa = run('gates', () => qaStage(baked.value, {settings, palette, rig: input.rig, poseRig: input.poseRig, options: input.qa}));
  if (!qa.ok) return;
  summary.stages.gates = {ok: qa.value.pass, ...qa.value};
  summary.ok = qa.value.pass;
  if (!qa.value.pass) { summary.failed = 'gates'; summary.error = `${qa.value.findings.filter(f => f.severity === 'error').length} gate error(s)`; }
}
