// The scene for the second half of the evaluation (questions on the forge, toolchain and audio tools): a throwaway project
// where a harness, through the studio tools, has made a pet from a drawn sheet, kept two audio candidates and over-filled a
// chunk. Ground truth is computed without the studio tools: the audio engine and Python directly, the committed bake-off
// files, and an area argument for the atlas budget.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, renderDocument } from '../../audio/index.mjs';
import { JobRunner } from '../../core/jobs.mjs';
import { encodePixels } from '../../core/png.mjs';
import { convertPrototypeRig } from '../../forge/rig/tests/fixtures/convert-prototype-rig.mjs';
import { HAVE_PYTHON, REPO, connect, makeProject } from '../testkit.mjs';
import { openProject } from '../project.mjs';

const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const solid = (w, h, rgb) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4); return encodePixels(w, h, px).toString('base64'); };
const zap = () => json(join(REPO, 'studio/audio/examples/zap.patch.json'));
export const SECOND_DOC = () => ({ ...zap(), durationMs: 260, trim: 0.35 });

export async function buildForgeScene() {
  const p = makeProject({ git: false, toolchain: true });
  mkdirSync(join(p.root, 'work'), { recursive: true });
  cpSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { scope: 'pack', agent: 'codex', jobs });
  const must = async (name, args) => { const r = await author.call(name, args); if (r.isError || r.rpcError) throw new Error(`${name} failed: ${r.content?.[0]?.text ?? JSON.stringify(r.rpcError)}`); return r; };

  // 1. A pet made from a drawn sheet, through the forge, committed with its provenance.
  await must('studio_sheet_import', { assetId: 'lt_reed_crane', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: readFileSync(join(EXP, 'prompt.txt'), 'utf8'), tool: 'Codex built-in image generation' });
  await must('studio_process', { assetId: 'lt_reed_crane', marks: [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }] });
  await must('studio_rig_bake', { assetId: 'lt_reed_crane', rig: convertPrototypeRig(json(join(EXP, 'rig.json')), { id: 'lt_reed_crane' }), library: json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json')), qa: { weightTransfer: false }, submit: true });

  // 2. Two audio candidates for one cue: the second is longer and quieter.
  await must('studio_audio_render', { cueId: 'sfx_step', document: zap(), keep: true });
  await must('studio_audio_render', { cueId: 'sfx_step', document: SECOND_DOC(), keep: true });

  // 3. An over-filled chunk: a big effect in the abode chunk, which may use one mobile page.
  await must('studio_asset_plan', { op: 'create', id: 'lt_fx_big_sheet', chunk: 'abode', brief: 'A large effect.', custom: { category: 'vfx', size: [256, 256], pivot: [128, 128], clips: { play: { frames: 20, frameMs: 50 } } } });
  await must('studio_frames_submit', { assetId: 'lt_fx_big_sheet', provenance: { tool: 'scene', prompt: 'solid frames', sourceHash: 'a'.repeat(64) },
    frames: Array.from({ length: 20 }, (_, n) => ({ clip: 'play', direction: 'none', n, pngBase64: solid(256, 256, n % 2 ? [15, 61, 58] : [23, 89, 75]) })) });
  project.close();
  return { root: p.root, cleanup: p.cleanup, truth: groundTruth2(p.root) };
}

// ---- ground truth, independent of the studio tools -------------------------------------------------
export function groundTruth2(root) {
  // Q6: the clip whose motion archetype is locomotion, and the pose names of the committed pose-sheet template.
  const library = json(join(REPO, 'studio/forge/motion/templates/quadruped.json'));
  const clips = json(join(root, 'assets/manifest_longtime.json')).profiles.pet.clips;
  const locomotion = Object.keys(clips).filter((c) => library.archetypes[library.templates[`pet/${c}`].use] && library.templates[`pet/${c}`].use === 'locomote');
  const template = json(join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten_pose/template.layout.json'));
  const poses = [...new Set(template.cells.map((c) => c.pose))];
  const q6 = `${locomotion[0]}: ${poses.join(', ')}`;

  // Q7: the hash of the sheet the frames were drawn from, from the submission log.
  const log = readFileSync(join(root, 'assets/raw/longtime/lt_reed_crane/studio-submissions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))[0];
  const q7 = log.sourceHash.slice(0, 12);

  // Q8: which candidate has the higher sample peak, and its duration, by rendering both documents with the engine.
  const measured = [zap(), SECOND_DOC()].map((doc, i) => { const m = analyze(renderDocument(doc), { images: false }).measurements; return { version: i + 1, peak: m.peak.sampleDbfs, ms: m.durationMs }; });
  const loudest = measured.reduce((a, b) => (b.peak > a.peak ? b : a));
  const q8 = `${loudest.version} ${loudest.ms}`;

  // Q9: run the generator directly with Python and hash the frame.
  let q9 = null;
  if (HAVE_PYTHON) {
    const out = mkdtempSync(join(tmpdir(), 'eval-gen-'));
    execFileSync(join(REPO, 'tools/.venvs/project/bin/python'), ['-I', join(REPO, 'tools/generators/studio_primitives.py'), '--out', out, '--palette', join(REPO, 'tools/generators/palette.json'),
      '--shape', 'ring', '--size', '16', '--fill', 'jade_03', '--accent', 'bronze_04', '--clip', 'glyph', '--direction', 'none', '--frames', '1', '--seed', '7']);
    q9 = createHash('sha256').update(readFileSync(join(out, 'glyph_none_0.png'))).digest('hex').slice(0, 10);
  }

  // Q10: can 20 frames of 256x256 (plus the chunk's other frames) fit ONE 1024x1024 page? Area says no; the ceiling is in the manifest.
  const manifest = json(join(root, 'assets/manifest_longtime.json'));
  const area = 20 * 256 * 256, page = manifest.mobile.page[0] * manifest.mobile.page[1];
  const q10 = `${area > page ? 'no' : 'yes'} ${manifest.chunks.abode}`;
  return { q6, q7, q8, q8Detail: measured, q9, q10 };
}
