// The owner's pack decisions (licence profile, no quota ceiling) on the REAL project pack, and the rough edges a drawn-character
// retest found in the forge tools: custom-asset figure default, error texts, the dry-run hint, annotation slots, accent colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { buildLedger } from '../core/ledger.mjs';
import { checkLicences, licenceProfile } from '../core/handoff.mjs';
import { quotaConfig } from '../core/quota.mjs';
import { accentsInBrief, applyToPoseClips, loadLibrary, getTemplate, nativeAnnotations, validateAnnotations, validateLayout } from '../forge/index.mjs';
import { openProject } from './project.mjs';
import { REPO, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };

test('ATLAS-006: the real project states its licence profile; the owner decision clears the 97 that recorded none; a missing or foreign licence still blocks', async () => {
  const snap = await openProject(REPO).workspace.snapshot();
  const ledger = await buildLedger({ root: fs.realpathSync(REPO), pack: snap.pack, index: snap.index });
  const profile = licenceProfile(snap.pack);
  assert.ok(profile, 'the pack states a licence profile');
  assert.deepEqual(profile.acceptsPattern ?? [], [], 'exact strings only: a prefix match would clear a string that names a foreign licence after an accepted phrase');
  assert.equal(profile.strict, true, 'an asset with no recorded licence blocks');
  assert.ok(profile.statement.en && profile.statement.vi, 'stated in English and Vietnamese');
  const withRights = ledger.assets.filter((a) => a.rights);
  assert.ok(withRights.length > 150, `the ledger has ${withRights.length} assets with recorded rights`);
  const real = checkLicences(ledger, profile);
  assert.deepEqual(real.blockers.filter((b) => b.rights), [], 'no recorded licence is refused');
  assert.deepEqual(real.blockers, [], 'the real project has no licence blocker');
  // the owner's 2026-11-22 decision ("Toàn bộ là ảnh gốc dự án") is what clears the 97 legacy core assets
  const decision = json(join(REPO, 'assets/review/licence_decisions.json')).decisions.find((d) => d.id === 'owner_original_project_artwork_2026-11-22');
  assert.equal(decision.assets.length, 97);
  assert.equal(decision.rights, 'Original artwork created for this project.');
  assert.ok(profile.accepts.includes(decision.rights), 'a string the profile already accepted, none added');
  const byId = new Map(ledger.assets.map((a) => [a.id, a]));
  for (const id of decision.assets) {
    const a = byId.get(id);
    assert.equal(a.rights, decision.rights, id);
    assert.ok(a.evidence.includes('assets/review/licence_decisions.json'), `${id} cites the decision`);
  }
  assert.equal(decision.assets.filter((id) => byId.get(id).origin.kind === 'retired-tool').length, 22, 'retired-tool origin is kept');
  // without the decision the 97 block again
  const without = { ...ledger, assets: ledger.assets.map((a) => (decision.assets.includes(a.id) ? { ...a, rights: null } : a)) };
  assert.equal(checkLicences(without, profile).blockers.length, 97);
  assert.ok(withRights.some((a) => /pixellab/i.test(a.rights)), 'the owner\'s subscription strings are among the recorded rights');
  assert.ok(withRights.some((a) => /^original/i.test(a.rights)), 'the original-work strings are among the recorded rights');
  // a foreign licence and a missing one are still caught
  const probe = { ...ledger, assets: [...ledger.assets, { id: 'probe_foreign', recorded: true, rights: 'CC-BY-4.0 (a third party)' }, { id: 'probe_unknown', recorded: true, rights: null },
    { id: 'probe_lookalike', recorded: true, rights: 'Generated with another service for this project' },
    { id: 'probe_prefix_original', recorded: true, rights: 'Original artwork from OpenGameArt, CC-BY-SA 4.0' },
    { id: 'probe_prefix_subscription', recorded: true, rights: `${[...new Set(withRights.map((a) => a.rights))].find((r) => /pixellab/i.test(r))} plus a third-party texture (CC-BY-NC)` }] };
  const after = checkLicences(probe, profile);
  assert.deepEqual(after.blockers.filter((b) => b.id.startsWith('probe_')).map((b) => b.id).sort(), ['probe_foreign', 'probe_lookalike', 'probe_prefix_original', 'probe_prefix_subscription', 'probe_unknown']);
  assert.equal(after.blockers.length, real.blockers.length + 5);
});

test('JOBS-004: the real project decided on no quota ceiling and says so: an explicit empty ceilings, nothing refused', () => withProject(async (p) => {
  const pack = json(join(REPO, 'studio.project.json'));
  assert.deepEqual(pack.ui.tabs.jobs.quota.ceilings, {}, 'decided, not forgotten');
  const config = quotaConfig(pack);
  assert.equal(config.ceilings, undefined);
  assert.equal(config.perAgent, undefined);
  assert.equal(config.perRun, undefined);
  const a = connect(openProject(p.root), { agent: 'codex' });
  const huge = await a.ok('studio_job_status', { plan: { kind: 'image-tool', generations: 64 } });
  assert.equal(huge.plan.allowed, true);
  assert.deepEqual(huge.plan.reasons ?? [], []);
}));

const CUSTOM = { category: 'mob', size: [32, 32], pivot: [16, 29], directions: ['south', 'west', 'north', 'east'], clips: { idle: { frames: 3, frameMs: 160 }, walk: { frames: 4, frameMs: 120 } } };

test('MCP-014: a custom mob gets the humanoid guide by category and the result says so; a custom effect gets none and says why; the error texts name what to pass', () => withProject(async (p) => {
  const a = connect(openProject(p.root), { agent: 'codex' });
  const made = await a.call('studio_asset_plan', { op: 'create', id: 'lt_probe_courier', custom: CUSTOM, chunk: 'abode', brief: 'A courier with an ember-orange scarf and a brown satchel.' });
  assert.equal(made.isError, undefined, text(made));
  const tpl = await a.ok('studio_template_get', { assetId: 'lt_probe_courier' });
  assert.equal(tpl.figure.name, 'humanoid');
  assert.equal(tpl.figure.guideDrawn, true, 'the silhouette is drawn');
  assert.equal(tpl.figureChoice.used, 'humanoid');
  assert.equal(tpl.figureChoice.source, 'category');
  assert.match(tpl.figureChoice.why, /category mob/);
  assert.match(tpl.template.drawing, /Proportions/);
  assert.match(text(await a.call('studio_template_get', { assetId: 'lt_probe_courier' })), /Figure guide: humanoid/);
  // an explicit name wins; none turns it off, and says so
  assert.equal((await a.ok('studio_template_get', { assetId: 'lt_probe_courier', figure: 'humanoid' })).figureChoice.source, 'explicit');
  const none = await a.ok('studio_template_get', { assetId: 'lt_probe_courier', figure: 'none' });
  assert.equal(none.figure, undefined);
  assert.match(none.figureChoice.why, /"none" was asked for/);
  // a manifest profile still goes by profile
  assert.equal((await a.ok('studio_template_get', { assetId: 'lt_ash_skater' })).figureChoice.source, 'profile');
  // a custom effect: no humanoid guide, and the result says why and what to pass
  await a.ok('studio_asset_plan', { op: 'create', id: 'lt_probe_spark', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { burst: { frames: 4, frameMs: 80 } } }, chunk: 'abode', brief: 'A spark.' });
  const sparkDefault = await a.call('studio_template_get', { assetId: 'lt_probe_spark' });
  assert.equal(sparkDefault.isError, true, 'a one-frame effect with direction none cannot be drawn on a sheet');
  assert.match(text(sparkDefault), /has no facings to draw/);
  const spark = await a.call('studio_template_get', { assetId: 'lt_probe_spark', facings: ['south'] });
  assert.equal(spark.isError, undefined, text(spark));
  assert.equal(spark.structuredContent.figure, undefined);
  assert.equal(spark.structuredContent.figureChoice.used, null);
  assert.match(spark.structuredContent.figureChoice.why, /no pack figure guide lists profile custom or category vfx; pass figure: one of humanoid/);

  // the plan error names the parameter the caller passes, not the stored field
  const noChunk = await a.call('studio_asset_plan', { op: 'create', id: 'lt_probe_x', profile: 'npc', brief: 'b' });
  assert.equal(noChunk.isError, true);
  assert.match(text(noChunk), /create needs chunk \(the chunk group/);
  assert.doesNotMatch(text(noChunk), /chunk_group/);
  // a missing motion template says how to bind one
  const err = (() => { try { getTemplate(loadLibrary('biped'), 'lt_probe_courier', 'idle'); } catch (e) { return e.message; } })();
  assert.match(err, /^no biped motion template for lt_probe_courier\/idle\./);
  assert.match(err, /pass library to studio_rig_bake/);
  assert.match(err, /"lt_probe_courier\/idle": \{"use": "<archetype>"\}/);
  assert.match(err, /poseClips/);
  assert.ok(tpl.motion.archetypes.biped.length > 0, 'template_get lists the archetype names a binding uses');
}));

test('MCP-017: each colour word in the brief gets its nearest palette colours; orange has no close one, red does; the palette is untouched', () => withProject(async (p) => {
  const before = fs.readFileSync(join(p.root, 'studio.project.json'), 'utf8');
  const a = connect(openProject(p.root), { agent: 'codex' });
  await a.ok('studio_asset_plan', { op: 'create', id: 'lt_probe_courier', custom: CUSTOM, chunk: 'abode', brief: 'A courier with an ember-orange scarf, a brown satchel and a red cord.' });
  const tpl = await a.ok('studio_template_get', { assetId: 'lt_probe_courier' });
  const by = Object.fromEntries(tpl.accents.map((x) => [x.word, x]));
  assert.deepEqual(Object.keys(by), ['orange', 'brown', 'red']);
  assert.equal(by.orange.item, 'scarf');
  assert.equal(by.orange.survives, false);
  assert.ok(by.orange.nearest.length === 3 && by.orange.nearest[0].distance > 25, 'the nearest colour is far from orange');
  assert.match(by.orange.advice, /No palette colour is close to "orange".*Prompt for the colour you want to see/);
  assert.equal(by.red.survives, true);
  assert.equal(by.red.nearest[0].id, 'thunder_05');
  assert.match(text(await a.call('studio_template_get', { assetId: 'lt_probe_courier' })), /orange has NO close palette colour/);
  assert.equal(fs.readFileSync(join(p.root, 'studio.project.json'), 'utf8'), before, 'the pack is not changed');
  // pure function, no palette needed beyond the list
  assert.deepEqual(accentsInBrief('plain grey stone', [{ id: 'g', hex: '#808080' }]).map((x) => [x.word, x.survives]), [['grey', true]]);
  assert.deepEqual(accentsInBrief('no colour here', [{ id: 'g', hex: '#808080' }]), []);
}));

// ---- annotations: the pose sheet's contact and landmark slots ------------------------------------------------------
const ASSET = 'lt_reed_crane';
const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const POSE = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten_pose');
const KEYS = ['contact_a', 'passing_a', 'contact_b', 'passing_b'];
const FACINGS = ['south', 'west', 'north', 'east'];
const MARKS = [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }];

test('MCP-016: the pose-sheet template carries contact slots; annotations are checked, converted to native pixels and turn foot slide and mark side on', () => withProject(async (p) => {
  const a = connect(openProject(p.root), { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const tpl = await a.ok('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow', landmarks: [{ id: 'ear', color: 'soul_07' }] });
  assert.deepEqual(tpl.layout.cells[0].slots, { contacts: ['left_foot', 'right_foot'], landmarks: [{ id: 'ear', color: 'soul_07' }] });
  assert.deepEqual(validateLayout(tpl.layout), []);
  assert.match(tpl.annotations.how, /FRACTION/);
  assert.equal((await a.ok('studio_template_get', { assetId: ASSET })).annotations, undefined, 'a turnaround has no slots');
  assert.match(text(await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow', landmarks: [{ id: 'ear', color: 'not_a_colour' }] })), /not a palette colour id/);

  const layout = json(join(POSE, 'layout.json')), prompt = 'poses';
  // annotations on a turnaround are refused: only the pose slot is read by the bake
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const onTurnaround = await a.call('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 't',
    annotations: { south: { contacts: [{ id: 'f', at: [0.5, 0.5] }] } } });
  assert.equal(onTurnaround.isError, true);
  assert.match(text(onTurnaround), /annotations apply to pose sheets only/);
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'forge/import.json')), false, 'nothing stored');
  // Contacts and boxes must sit on the figure (the clip validation checks), so place them from the measured crops: a point in the middle of each figure.
  const probe = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout, prompt, tool: 't', scaleOptions: { mode: 'sheet' }, dryRun: true });
  const header = fs.readFileSync(join(p.root, 'work/pose_sheet.png')), SW = header.readUInt32BE(16), SH = header.readUInt32BE(20);
  const annotations = {};
  for (const f of FACINGS) KEYS.forEach((k, i) => {
    const id = `${k}_${f}`, cell = layout.cells.find((c) => c.id === id), bounds = probe.cells.find((c) => c.id === id).bounds;
    const w = (cell.rect[2] - cell.rect[0]) * SW, h = (cell.rect[3] - cell.rect[1]) * SH;
    const cx = (bounds[0] + bounds[2]) / 2 / w, top = bounds[1] / h, bottom = bounds[3] / h, mid = (top + bottom) / 2;
    annotations[id] = { contacts: [{ id: 'left_foot', at: [cx, mid], planted: i % 2 === 0 }, { id: 'right_foot', at: [cx, mid + 0.02], planted: i % 2 === 1 }],
      landmarks: [{ id: 'ear', color: 'soul_07', box: [cx - 0.02, top + (bottom - top) * 0.3, cx + 0.02, top + (bottom - top) * 0.45] }] };
  });
  // refused: unknown cell, a number outside the cell, an unknown colour; nothing is stored
  for (const [bad, re] of [[{ nope: { contacts: [] } }, /no cell "nope"/], [{ contact_a_south: { contacts: [{ id: 'f', at: [2, 0.5] }] } }, /fractions 0\.\.1/],
    [{ contact_a_south: { landmarks: [{ id: 'm', color: 'not_a_colour', box: [0.1, 0.1, 0.2, 0.2] }] } }, /not a palette colour id/]]) {
    const r = await a.call('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout, prompt, tool: 't', annotations: bad });
    assert.equal(r.isError, true);
    assert.match(text(r), re);
  }
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'forge/import.pose.json')), false);
  const dry = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout, prompt, tool: 't', scaleOptions: { mode: 'sheet' }, annotations, dryRun: true });
  assert.equal(dry.annotations.cells, 16);
  const imp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout, prompt, tool: 't', scaleOptions: { mode: 'sheet' }, annotations });
  assert.equal(imp.annotations.contacts, 32);
  const native = imp.annotations.native.contact_a_south;
  assert.ok(native.contacts.every((c) => c.xy[0] >= 0 && c.xy[0] < 32 && c.xy[1] >= 0 && c.xy[1] < 32), JSON.stringify(native));
  assert.ok(native.landmarks[0].box[2] > native.landmarks[0].box[0]);
  assert.deepEqual(json(join(p.root, 'assets/raw/longtime', ASSET, 'forge/import.pose.json')).annotations, annotations, 'stored with the import');
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });

  // without annotations in the clip, the gates come from the import; the clip itself is stored as given
  const bake = await a.call('studio_rig_bake', { assetId: ASSET, poseClips: tpl.poseClips, qa: { pivotDrift: false }, dryRun: true });
  assert.equal(bake.isError, undefined, text(bake));
  const v = bake.structuredContent.verdicts.animationGates;
  assert.deepEqual(bake.structuredContent.annotationsApplied, [{ clip: 'follow', contacts: FACINGS, landmarks: FACINGS }]);
  assert.ok(v.ran.some((g) => g.gate === 'foot_slide'), 'foot slide ran');
  assert.ok(v.ran.some((g) => g.gate === 'mark_side'), 'mark side ran');
  assert.ok(!v.notRun.some((n) => n.gate === 'foot_slide' || n.gate === 'mark_side'));
  assert.ok(v.notRun.some((n) => n.gate === 'weight_transfer'), 'weight transfer still says not run for a plain drawn clip');
  assert.match(v.notRun.find((n) => n.gate === 'weight_transfer').turnOn, /secondary/);
  await a.ok('studio_rig_bake', { assetId: ASSET, poseClips: tpl.poseClips, qa: { pivotDrift: false } });
  assert.equal(json(join(p.root, 'assets/raw/longtime', ASSET, 'forge/poseclips.json')).clips.follow.contacts, undefined, 'the stored pose clips are what the caller gave');
}));

test('MCP-016: a clip\'s own contacts and landmarks win; native conversion follows the figure\'s fit; layouts and annotations are validated', () => {
  const clips = { schema: 'forge.poseclips', version: 1, clips: { walk: { keys: ['a', 'b'], facings: ['south'], loop: true, contacts: { south: [[], []] } }, run: { keys: ['a', 'b'], facings: ['south'], loop: true } } };
  const native = { a_south: { contacts: [{ id: 'l', xy: [3, 4], planted: true }], landmarks: [{ id: 'm', color: 'x', box: [1, 1, 2, 2] }] }, b_south: { contacts: [], landmarks: [] } };
  const { poseClips, applied } = applyToPoseClips(clips, native);
  assert.deepEqual(poseClips.clips.walk.contacts, { south: [[], []] }, 'declared contacts are kept');
  assert.deepEqual(poseClips.clips.walk.landmarks, { south: native.a_south.landmarks }, 'landmarks the clip did not declare are filled');
  assert.deepEqual(poseClips.clips.run.contacts, { south: [native.a_south.contacts, []] });
  assert.deepEqual(applied.map((x) => [x.clip, x.contacts.length, x.landmarks.length]), [['walk', 0, 1], ['run', 1, 1]]);
  assert.equal(clips.clips.run.contacts, undefined, 'the input is not changed');
  // a point at a third of a 100x50 cell, the figure's box starting at (10, 5), scale 0.5, native origin (4, 6)
  const out = nativeAnnotations({ c: { contacts: [{ id: 'f', at: [0.5, 0.5] }], landmarks: [{ id: 'm', color: 'x', box: [0.1, 0.1, 0.11, 0.11] }] } },
    [{ id: 'c', rect: [0, 0, 100, 50], bounds: [10, 5, 60, 45] }], [{ id: 'c', nativeOrigin: [4, 6], sourceBounds: [10, 5, 60, 45], scale: 0.5 }], { nativePx: [32, 32] });
  assert.deepEqual(out.c.contacts, [{ id: 'f', xy: [4 + Math.round((50 - 10) * 0.5), 6 + Math.round((25 - 5) * 0.5)], planted: true }]);
  assert.ok(out.c.landmarks[0].box[2] > out.c.landmarks[0].box[0] && out.c.landmarks[0].box[3] > out.c.landmarks[0].box[1], 'a box is never empty');
  const layout = { cells: [{ id: 'a_south' }] };
  assert.deepEqual(validateAnnotations({ a_south: { contacts: [{ id: 'f', at: [0.5, 0.5] }] } }, layout), []);
  assert.match(validateAnnotations({ a_south: { contacts: [{ id: 'f', at: [0.5, 0.5] }, { id: 'f', at: [0.1, 0.1] }] } }, layout)[0], /used twice/);
  assert.match(validateAnnotations({ a_south: { bogus: [] } }, layout)[0], /only hold contacts and landmarks/);
});

test('MCP-015: rig_bake never suggests submitting while a verdict fails, in a dry run or not', () => withProject(async (p) => {
  const a = connect(openProject(p.root));
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const layout = json(join(EXP, 'layout.forge.json'));
  const { convertPrototypeRig } = await import('../forge/rig/tests/fixtures/convert-prototype-rig.mjs');
  const rig = convertPrototypeRig(json(join(EXP, 'rig.json')), { id: ASSET });
  const library = json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json'));
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout, prompt: fs.readFileSync(join(EXP, 'prompt.txt'), 'utf8'), tool: 't' });
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  const qa = { weightTransfer: false };
  const clean = await a.call('studio_rig_bake', { assetId: ASSET, rig, library, qa, dryRun: true });
  assert.equal(clean.structuredContent.pass, true);
  assert.match(clean.structuredContent.next, /^Nothing was written\. Both verdicts pass/);
  await a.ok('studio_rig_bake', { assetId: ASSET, rig, library, qa });
  await a.ok('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'idle_south_0', ops: [{ op: 'set', pixels: [[0, 0, 'bronze_04'], [1, 0, 'jade_04']] }] }] });
  for (const dryRun of [true, false]) {
    const dirty = await a.call('studio_rig_bake', { assetId: ASSET, qa, dryRun });
    assert.equal(dirty.structuredContent.pass, false);
    assert.match(dirty.structuredContent.next, /Not ready to submit: .*fix the error pixels/);
    assert.doesNotMatch(dirty.structuredContent.next, /submit=true|Run again without dryRun|reads well/);
  }
}));
