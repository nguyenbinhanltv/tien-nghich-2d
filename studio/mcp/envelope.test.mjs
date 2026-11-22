import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { check, envelope, envelopeProblems } from './workflow/envelope.mjs';
import { HAVE_PYTHON, HAVE_SPRITEFX, REPO, PROVENANCE, clipFrames, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn) => { const p = makeProject({ git: false, toolchain: true }); try { return await fn(p); } finally { await p.cleanup(); } };
const zap = () => JSON.parse(fs.readFileSync(join(REPO, 'studio/audio/examples/zap.patch.json'), 'utf8'));
const valid = (label, e) => assert.deepEqual(envelopeProblems(e), [], `${label}: ${JSON.stringify(e).slice(0, 300)}`);

test('envelope(): status is fail with a failed check, partial with something not proven, pass only when everything is proven; the validator bites', () => {
  const ok = [check('a', { ok: true, measured: 1, threshold: 2 })];
  assert.equal(envelope({ method: 'm', checks: ok, inputs: { x: 'y' } }).status, 'pass');
  assert.equal(envelope({ method: 'm', checks: ok, notProven: [{ what: 'w', why: 'y' }], inputs: { x: 'y' } }).status, 'partial');
  assert.equal(envelope({ method: 'm', checks: [...ok, check('b', { ok: false, measured: 3, threshold: 2 })], notProven: [{ what: 'w', why: 'y' }], inputs: { x: 'y' } }).status, 'fail');
  assert.equal(check('w', { ok: true, warn: true, measured: 0, threshold: 0 }).status, 'warn');
  valid('good', envelope({ method: 'm', checks: ok, inputs: { x: 'y' } }));
  for (const [label, bad] of [['no checks', { ...envelope({ method: 'm', checks: ok, inputs: { x: 'y' } }), checks: [] }], ['no inputs', { ...envelope({ method: 'm', checks: ok, inputs: { x: 'y' } }), inputs: {} }],
    ['pass with notProven', { ...envelope({ method: 'm', checks: ok, inputs: { x: 'y' } }), notProven: [{ what: 'w', why: 'y' }] }], ['no threshold', { ...envelope({ method: 'm', checks: [{ name: 'a', status: 'pass', measured: 1 }], inputs: { x: 'y' } }) }], ['nothing', null]]) {
    assert.ok(envelopeProblems(bad).length, label);
  }
});

test('every tool that checks something returns the same envelope: qa_run (frames and audio), frames_submit, process, rig_bake, audio_render, pack', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  // frames_submit (dry run and real) and qa_run on a raw, partial asset: partial, with what is missing stated.
  const dry = await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', frames: clipFrames('idle', 'south', 4), provenance: PROVENANCE, dryRun: true });
  valid('frames_submit', dry.structuredContent.qa);
  await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', frames: clipFrames('idle', 'south', 4), provenance: PROVENANCE });
  const qa = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).qa;
  valid('qa_run', qa);
  assert.equal(qa.status, 'partial', 'raw work with frames still missing is partial, never a plain pass');
  assert.ok(qa.notProven.some((n) => /expected frame\(s\) are not there yet/.test(n.what) && /raw stage/.test(n.why)));
  assert.ok(qa.notProven.some((n) => /foot slide/.test(n.what) && n.turnOn === 'studio_rig_bake'));
  assert.deepEqual(qa.checks.map((c) => c.name), ['palette', 'alpha', 'outline', 'size', 'frameCount', 'naming', 'motion']);
  assert.match(qa.inputs.frames, /^[0-9a-f]{64}$/);
  const narrowed = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', clip: 'idle' })).qa;
  assert.ok(narrowed.notProven.some((n) => /outside the selection/.test(n.what)));
  // A shipped asset, fully judged: still partial only for the motion it cannot judge here (single-clip static frames: pass is possible for static assets).
  const shipped = (await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper' })).qa;
  valid('qa_run shipped', shipped);
  assert.ok(shipped.status === 'partial' && shipped.notProven.length === 1 && /motion/.test(shipped.notProven[0].what), 'an animated asset is never a plain pass from static gates');
  // The failure shape: a damaged frame fails a check with its measured value.
  // audio
  const r = await a.call('studio_audio_render', { cueId: 'sfx_step', document: zap(), keep: true });
  valid('audio_render', r.structuredContent.qa);
  const aq = (await a.ok('studio_qa_run', { assetId: 'sfx_step' })).qa;
  valid('qa_run audio', aq);
  assert.equal(aq.status, 'partial');
  assert.equal(aq.notProven[0].what, 'how it sounds');
  // pack
  const pk = await a.call('studio_pack', { chunk: 'abode' });
  valid('pack', pk.structuredContent.qa);
}));

test('process and rig_bake envelopes name what was not proven (not-run gates, no accents named, no figure guide)', () => withProject(async (p) => {
  const a = connect(p.root);
  const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
  const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  await a.ok('studio_sheet_import', { assetId: 'lt_reed_crane', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 't' });
  const px = (await a.ok('studio_process', { assetId: 'lt_reed_crane', marks: [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }] })).qa;
  valid('process', px);
  assert.ok(px.notProven.some((n) => /figure proportions/.test(n.what) && /profile pet/.test(n.why)), 'no pack guide applies to a pet');
  const { convertPrototypeRig } = await import('../forge/rig/tests/fixtures/convert-prototype-rig.mjs');
  const rig = convertPrototypeRig(json(join(EXP, 'rig.json')), { id: 'lt_reed_crane' });
  const library = json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json'));
  const bake = await a.call('studio_rig_bake', { assetId: 'lt_reed_crane', rig, library, qa: { weightTransfer: false } });
  valid('rig_bake', bake.structuredContent.qa);
  assert.equal(bake.structuredContent.qa.status, 'partial');
  assert.ok(bake.structuredContent.qa.notProven.some((n) => /weight_transfer/.test(n.what) && n.why === 'turned off in qa'));
  assert.ok(bake.structuredContent.qa.checks.some((c) => c.name === 'pixelGates'));
  assert.match(bake.structuredContent.qa.inputs.sheets, /^rig:[0-9a-f]{16}$/);
}));

test('generator_run and vfx_build return the envelope with their input hashes', { skip: !HAVE_PYTHON && 'no Python toolchain' }, () => withProject(async (p) => {
  const a = connect(p.root);
  const g = await a.call('studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', params: { shape: 'ring', size: 16 }, seed: 3 });
  valid('generator_run', g.structuredContent.qa);
  assert.equal(g.structuredContent.qa.checks.find((c) => c.name === 'deterministic').status, 'pass');
  assert.match(g.structuredContent.qa.inputs.script, /^[0-9a-f]{64}$/);
  if (HAVE_SPRITEFX) {
    await a.ok('studio_asset_plan', { op: 'create', id: 'lt_fx_env', chunk: 'wards', brief: 'x', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 12, frameMs: 33 } } } });
    const v = await a.call('studio_vfx_build', { assetId: 'lt_fx_env', spec: JSON.parse(fs.readFileSync(join(REPO, 'tools/generators/vfx_specs/hit_spark.json'), 'utf8')) });
    assert.equal(v.isError, undefined, text(v));
    valid('vfx_build', v.structuredContent.qa);
  }
}));
