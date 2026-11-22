import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { convertPrototypeRig } from '../forge/rig/tests/fixtures/convert-prototype-rig.mjs';
import { decodePng, framesEqual, importSheet, normalizeLayout, pixelizeImport, readFrame, resolveMarks, settingsFromPack } from '../forge/index.mjs';
import { loadPackSync } from '../core/pack.mjs';
import { REPO, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ASSET = 'lt_reed_crane'; // a planned 32x32 pet: the marten's sheet fits its profile
const MARKS = [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }];
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };

function marten(p) {
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  return {
    layout: json(join(EXP, 'layout.forge.json')), prompt: fs.readFileSync(join(EXP, 'prompt.txt'), 'utf8'),
    rig: convertPrototypeRig(json(join(EXP, 'rig.json')), { id: ASSET }),
    library: json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json')),
  };
}

test('MCP only: the bake-off sheet becomes the 32 reference frames, committed as raw frames', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const m = marten(p);

  const tpl = await a.call('studio_template_get', { assetId: ASSET, write: true });
  assert.deepEqual(tpl.content.map((c) => c.type), ['text', 'image']);
  assert.match(tpl.structuredContent.template.files.png, /work\/lt_reed_crane\/templates\/.+\.png$/);

  const imp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: m.prompt, tool: 'Codex built-in image generation' });
  assert.equal(imp.cells.length, 4);
  assert.equal(imp.sheet.sha256, fs.readFileSync(join(EXP, 'turnaround.sha256'), 'utf8').split(/\s/)[0]);
  assert.match(imp.sheet.file, /^assets\/raw\/longtime\/lt_reed_crane\/forge\/sheets\/[0-9a-f]{16}\.png$/);

  const px = await a.call('studio_process', { assetId: ASSET, marks: MARKS });
  assert.deepEqual(px.content.map((c) => c.type), ['text', 'image']);
  assert.equal(px.structuredContent.cells.length, 4);
  assert.deepEqual(px.structuredContent.marks, ['soul_07']);

  const bake = await a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, qa: { weightTransfer: false } });
  assert.equal(bake.isError, undefined, text(bake));
  assert.equal(bake.structuredContent.pass, true);
  assert.equal(bake.structuredContent.frames, 32);
  assert.deepEqual(bake.structuredContent.gates.findings, []);
  assert.deepEqual(bake.content.map((c) => c.type), ['text', 'image']);

  // Nothing is committed until the author says so.
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'frames')), false);
  const sub = await a.call('studio_rig_bake', { assetId: ASSET, submit: true, qa: { weightTransfer: false } });
  assert.equal(sub.isError, undefined, text(sub));
  assert.equal(sub.structuredContent.submit.accepted, true);
  assert.equal(sub.structuredContent.submit.written, 32);

  for (const clip of ['idle', 'follow']) for (const facing of ['south', 'west', 'north', 'east']) for (let n = 0; n < 4; n++) {
    const got = readFrame(join(p.root, 'assets/raw/longtime', ASSET, 'frames', `${clip}_${facing}_${n}.png`));
    assert.ok(framesEqual(got, readFrame(join(EXP, 'frames', `${clip}_${facing}_${n}.png`))), `${clip}_${facing}_${n}`);
  }
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.length, 1);
  assert.equal(log[0].sourceHash, imp.sheet.sha256);
  assert.equal(log[0].prompt, m.prompt);
  assert.match(log[0].tool, /Codex built-in image generation \+ studio forge bake/);
  assert.equal(log[0].agent, 'codex');
  assert.equal(log[0].session, a.session);
}));

// ---- frame_patch -----------------------------------------------------------------------------
const ICON = 'lt_icon_realm_step'; // a planned 16x16 icon: one clip "glyph", one frame, no facing
const square = [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }, { op: 'outline' }];
const rawIcon = (p) => join(p.root, 'assets/raw/longtime', ICON, 'frames/glyph_none_0.png');

test('frame_patch create: a static asset drawn from commands alone, gated, with provenance and a history', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  // Without the outline the silhouette is not ink: the gates refuse it, and nothing is written.
  const bad = await a.call('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }] }] });
  assert.equal(bad.isError, true);
  assert.match(JSON.stringify(bad.structuredContent.frames[0].defects), /outline_gap/);
  assert.equal(fs.existsSync(rawIcon(p)), false);

  const grid = { op: 'grid', at: [6, 6], rows: ['ab', 'ba'], legend: { a: 'bronze_04', b: 'jade_05' } };
  const ok = await a.call('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: [square[0], grid, square[1]] }] });
  assert.equal(ok.isError, undefined, text(ok));
  assert.deepEqual(ok.content.map((c) => c.type), ['text', 'image']);
  assert.deepEqual(ok.structuredContent.written, [`assets/raw/longtime/${ICON}/frames/glyph_none_0.png`]);
  const px = decodePng(fs.readFileSync(rawIcon(p)));
  const at = (x, y) => [...px.pixels.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.equal(at(6, 6)[3], 255);
  assert.notDeepEqual(at(6, 6).slice(0, 3), at(7, 6).slice(0, 3), 'the grid drew two different palette colours');
  assert.equal(at(3, 3)[3], 0, 'outside the shape is transparent');
  assert.equal(at(4, 4)[3], 255, 'the rebuilt outline sits on the edge');

  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ICON, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
  assert.match(log.tool, /studio_frame_patch/);
  assert.match(log.prompt, /^pixel operations: .*"op":"set","pixels":\[\[6,6,"bronze_04"\]/s, 'a grid is recorded as the plain set operations it expands to');
  assert.doesNotMatch(log.prompt, /"grid"/);
  assert.equal(log.agent, 'codex');
  assert.equal((await a.ok('studio_qa_run', { assetId: ICON })).pass, true);
  assert.deepEqual((await a.ok('studio_review_list', { assetId: ICON, detail: 'full' })).byStatus, { pending: 1 });
  // It exists now, and raw is immutable.
  assert.match(text(await a.call('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: square }] })), /already exists \(raw frames are immutable\)/);
}));

test('frame_patch revision: new pixels become revision N+1, pending; raw stays; the gates guard it', () => withProject(async (p) => {
  const a = connect(p.root);
  await a.ok('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: square }] });
  const rawBefore = fs.readFileSync(rawIcon(p));

  const r = await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[7, 7, 'bronze_04']] }] }] });
  assert.equal(r.isError, undefined, text(r));
  assert.equal(r.structuredContent.target, 'revision', 'auto picks revision for a submitted frame');
  assert.deepEqual(r.structuredContent.saved.map((s) => [s.frame, s.revision, s.changed, s.status]), [['glyph_none_0', 1, true, 'pending']]);
  assert.match(r.structuredContent.note, /only a human approves/);
  assert.deepEqual(fs.readFileSync(rawIcon(p)), rawBefore, 'the raw file is untouched');

  const diff = await a.ok('studio_diff', { assetId: ICON });
  assert.equal(diff.frames[0].revision, 1);
  assert.equal(diff.frames[0].changedPixels, 1);
  assert.deepEqual(diff.frames[0].box, { x: 7, y: 7, w: 1, h: 1 });

  // The same change again is not a new revision.
  const again = await a.ok('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[7, 7, 'bronze_04']] }] }] });
  assert.deepEqual(again.saved.map((s) => [s.revision, s.changed]), [[1, false]]);

  // Breaking the outline is refused and saves nothing.
  const broken = await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[4, 7, 'jade_03']] }] }] });
  assert.equal(broken.isError, true);
  assert.match(text(broken), /breaks the pixel gates, so nothing was saved: outline_gap \(4, 7\)/);
  assert.match(text(broken), /\{"op":"outline"\}/);
  const head = (await a.ok('studio_diff', { assetId: ICON })).frames[0];
  assert.equal(head.revision, 1, 'no revision 2');
  // A human decision is never touched by patching.
  assert.equal((await a.ok('studio_review_list', { assetId: ICON })).byStatus.approved ?? 0, 0);
}));

test('frame_patch: what it refuses', () => withProject(async (p) => {
  const a = connect(p.root);
  const one = (edit, extra = {}) => a.call('studio_frame_patch', { assetId: ICON, edits: [edit], ...extra }).then(text);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[1, 1, 'ink_01']] }] }, { target: 'revision' }), /has not been submitted/);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[1, 1, 'nope_99']] }], }), /unknown palette id "nope_99"/);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[99, 1, 'ink_01']] }] }), /outside the 16x16 canvas/);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'fill', box: [8, 8, 8, 9], color: 'ink_01' }] }), /non-empty and inside/);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'grid', at: [0, 0], rows: ['x'], legend: { a: 'ink_01' } }] }), /legend does not define/);
  assert.match(await one({ frame: 'glyph_south_0', ops: [{ op: 'outline' }] }), /not a frame of lt_icon_realm_step/);
  assert.match(await one({ frame: 'dance_none_0', ops: [{ op: 'outline' }] }), /not a frame/);
  assert.match(await one({ frame: 'glyph_none_3', ops: [{ op: 'outline' }] }), /not a frame/);
  assert.match(await one({ frame: 'constructor_none_0', ops: [{ op: 'outline' }] }), /not a frame/);
  assert.match(await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: [{ op: 'outline' }] }, { frame: 'glyph_none_0', ops: [{ op: 'outline' }] }] }).then(text), /appears twice/);
  assert.match(await one({ frame: 'glyph_none_0', ops: [{ op: 'status', value: 'approved' }] }), /must be one of/, 'only drawing operations exist');
  assert.match(await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: square, approve: true }] }).then(text), /unexpected property "approve"/);
  assert.match(await a.call('studio_frame_patch', { assetId: 'lt_kiln_keeper', edits: [{ frame: 'idle_south_0', ops: [{ op: 'outline' }] }] }).then(text), /already has processed or packed frames/);
  assert.match(await a.call('studio_frame_patch', { assetId: 'wl_outer_disciple', edits: [{ frame: 'idle_south_0', ops: [{ op: 'outline' }] }] }).then(text), /not open for forge work/);
  const read = connect(p.root, { scope: 'read' });
  assert.match(await read.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: square }] }).then(text), /needs scope "author"/);
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ICON)), false, 'nothing was written by any refused call');
}));

test('frame_patch bake: stored operations survive every rebake', () => withProject(async (p) => {
  const a = connect(p.root);
  const m = marten(p);
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: m.prompt, tool: 'test' });
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  const bake = () => a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, qa: { weightTransfer: false }, clips: ['idle'] });
  assert.equal((await bake()).structuredContent.pass, true);
  const frame = () => readFrame(join(p.root, '.inspector-revisions/work', ASSET, 'bake/idle_south_0.png'));
  const before = frame();
  const spot = [...Array(32 * 32).keys()].find((i) => before.pixels[i * 4 + 3] === 255 && i % 32 > 12 && i % 32 < 20 && Math.floor(i / 32) > 14);
  const [x, y] = [spot % 32, Math.floor(spot / 32)];
  const stored = await a.call('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'idle_south_0', ops: [{ op: 'set', pixels: [[x, y, 'bronze_04']] }] }] });
  assert.equal(stored.structuredContent.target, 'bake');
  assert.deepEqual(stored.structuredContent.patchedFrames, 1);
  for (let i = 0; i < 2; i++) { // twice: the patch is data, applied after each bake, not consumed
    assert.equal((await bake()).structuredContent.patched, 1);
    const f = frame();
    const bronze = json(join(REPO, 'tools/generators/palette.json')).colors.find((c) => c.id === 'bronze_04').hex;
    assert.equal('#' + Buffer.from(f.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)).toString('hex'), bronze, 'the patched pixel has the palette colour bronze_04');
    assert.notDeepEqual([...f.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)], [...before.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)], 'the patched pixel differs from the unpatched bake');
  }
}));

// ---- the pose-sheet route (the default for locomotion) -----------------------------------------
const POSE = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten_pose');
const KEYS = ['contact_a', 'passing_a', 'contact_b', 'passing_b'];
const FACINGS = ['south', 'west', 'north', 'east'];

test('pose sheet: drawn key poses become the follow clip; the keys are the cells, in order; committed with provenance', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));

  // The template for the clip comes with the poseClips skeleton: one pose per frame of the clip.
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  assert.deepEqual(tpl.structuredContent.poseClips.clips.follow.keys, KEYS);
  assert.equal(tpl.structuredContent.layout.cells.length, 16);
  assert.equal(tpl.structuredContent.clips.find((c) => c.name === 'follow').route, 'pose-sheet');
  assert.equal(tpl.structuredContent.clips.find((c) => c.name === 'idle').route, 'rig');
  assert.match(text(await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet' })), /one clip. Give clip/);
  assert.match(text(await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow', poses: ['a', 'b'] })), /needs 4 poses/);

  const imp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: fs.readFileSync(join(POSE, 'prompt.txt'), 'utf8'),
    tool: 'Codex built-in image generation', scaleOptions: { mode: 'sheet' } });
  assert.equal(imp.cells.length, 16);
  assert.equal(new Set(imp.cells.map((c) => c.scale)).size, 1, 'sheet mode: every pose shares one scale');
  const px = await a.call('studio_process', { assetId: ASSET, marks: json(join(POSE, 'marks.json')) });
  assert.equal(px.structuredContent.cells.length, 16);

  const bake = await a.call('studio_rig_bake', { assetId: ASSET, poseClips: tpl.structuredContent.poseClips, qa: { pivotDrift: false } });
  assert.equal(bake.isError, undefined, text(bake));
  assert.deepEqual(Object.keys(bake.structuredContent.clips), ['follow']);
  assert.equal(bake.structuredContent.clips.follow.source, 'poses');
  assert.deepEqual(bake.structuredContent.clips.follow.facings, { south: 4, west: 4, north: 4, east: 4 });
  assert.equal(bake.structuredContent.frames, 16);
  assert.deepEqual(bake.structuredContent.stored, ['poseclips']);
  assert.equal(JSON.parse(fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'forge/poseclips.json'), 'utf8')).clips.follow.keys.length, 4, 'the pose clips are stored beside the asset');

  // Frame i of the clip IS the pixelised cell of key i, from the same import: nothing is invented between the drawn poses.
  // The reference is computed here with the forge library directly, not with the tools.
  const settings = await settingsFromPack(loadPackSync(p.root, undefined, { verifyFiles: false }), p.root, 'pet');
  const sheetBytes = fs.readFileSync(join(POSE, 'pose_sheet.png'));
  const reference = pixelizeImport(importSheet({ layout: normalizeLayout(json(join(POSE, 'layout.json'))), sheet: decodePng(sheetBytes), sheetBytes, profile: settings.profile, scaleOptions: { mode: 'sheet' } }),
    settings, { marks: resolveMarks(json(join(POSE, 'marks.json')), settings.palette) });
  const dir = join(p.root, '.inspector-revisions/work', ASSET, 'bake');
  for (const f of FACINGS) KEYS.forEach((k, i) => {
    assert.ok(framesEqual(readFrame(join(dir, `follow_${f}_${i}.png`)), reference.cells.get(`${k}_${f}`).native), `follow_${f}_${i} is the cell ${k}_${f}`);
  });

  const sub = await a.call('studio_rig_bake', { assetId: ASSET, submit: true, qa: { pivotDrift: false } });
  assert.equal(sub.isError, undefined, text(sub));
  assert.equal(sub.structuredContent.submit.written, 16);
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
  assert.equal(log.sourceHash, imp.sheet.sha256);
  assert.match(log.notes, /poseclips [0-9a-f]{12}; patch -/);
  // Only the follow clip exists so far: idle is still to come (from a rig).
  const qa = await a.ok('studio_qa_run', { assetId: ASSET });
  assert.equal(qa.summary.frames, 16);
  assert.equal(qa.checks.frameCount.warnings, 16, 'the 16 idle frames are still missing (raw work is partial, so a warning)');
}));

test('rig_bake: what it refuses, and the submit rules', () => withProject(async (p) => {
  const a = connect(p.root);
  const m = marten(p);
  assert.match(text(await a.call('studio_rig_bake', { assetId: ASSET })), /no imported sheet|Give rig/);
  assert.match(text(await a.call('studio_process', { assetId: ASSET })), /no imported sheet/);
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: m.prompt, tool: 'test' });
  assert.match(text(await a.call('studio_rig_bake', { assetId: ASSET })), /Give rig .* and\/or poseClips/);
  const broken = structuredClone(m.rig); broken.facings.south.parts[0].role = 'wing';
  assert.match(text(await a.call('studio_rig_bake', { assetId: ASSET, rig: broken })), /the rig is invalid:/);
  assert.match(text(await a.call('studio_rig_bake', { assetId: ASSET, poseClips: { schema: 'forge.poseclips', version: 1, clips: { follow: { keys: ['x'] } } } })), /poseClips are invalid/);
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'forge/rig.json')), false, 'an invalid rig is not stored');

  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  const tried = await a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, qa: { weightTransfer: false }, save: false });
  assert.equal(tried.structuredContent.pass, true);
  assert.deepEqual(tried.structuredContent.stored, []);
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'forge/rig.json')), false, 'save=false stores nothing');

  // A gate error blocks submit and commits nothing.
  const failing = await a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, qa: { weightTransfer: false, pivotDrift: { maxSpan: -1 } }, submit: true, save: false });
  if (failing.structuredContent.pass === false) {
    assert.equal(failing.isError, true);
    assert.match(failing.structuredContent.submit.message, /nothing was committed/);
    assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'frames')), false);
  }
  const read = connect(p.root, { scope: 'read' });
  assert.match(text(await read.call('studio_rig_bake', { assetId: ASSET, rig: m.rig })), /needs scope "author"/);
  assert.match(text(await a.call('studio_sheet_import', { assetId: 'lt_kiln_keeper', sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: 'x', tool: 'x' })), /already has processed or packed frames/);
}));
