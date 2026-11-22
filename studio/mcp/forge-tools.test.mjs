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
  const stored = await a.call('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'idle_south_0', note: 'scar over the left eye', ops: [{ op: 'set', pixels: [[x, y, 'bronze_04']] }] }] });
  assert.equal(stored.structuredContent.target, 'bake');
  assert.match(text(stored), /Checked now: palette ids and canvas bounds; the pixel gates run at the next bake/);
  assert.equal(json(join(p.root, 'assets/raw/longtime', ASSET, 'forge/patch.json')).frames.idle_south_0[0].note, 'scar over the left eye', 'the note is stored with the operation');
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

test('one character, two sheets: a pose-sheet clip plus rig clips bake together and re-bake without losing a definition', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const m = marten(p);
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const forge = (name) => join(p.root, 'assets/raw/longtime', ASSET, 'forge', name);
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });

  const turn = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: m.prompt, tool: 'turnaround tool' });
  const pose = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: fs.readFileSync(join(POSE, 'prompt.txt'), 'utf8'),
    tool: 'pose tool', scaleOptions: { mode: 'sheet' } });
  assert.equal(pose.replaced, null, 'a pose sheet does not replace the turnaround: each kind of sheet has its own slot');
  assert.notEqual(turn.sheet.sha256, pose.sheet.sha256);
  const px = await a.call('studio_process', { assetId: ASSET, marks: MARKS });
  assert.equal(px.structuredContent.cells.length, 20, 'both sheets are pixelised: 4 facings + 16 poses');

  const both = { assetId: ASSET, rig: m.rig, library: m.library, poseClips: tpl.structuredContent.poseClips, qa: { weightTransfer: false, pivotDrift: false, stability: { maxNewColors: 3 } } };
  const bake = await a.call('studio_rig_bake', both);
  assert.equal(bake.isError, undefined, text(bake));
  assert.deepEqual(Object.keys(bake.structuredContent.clips).sort(), ['follow', 'idle']);
  assert.equal(bake.structuredContent.frames, 32);

  const sub = await a.call('studio_rig_bake', { assetId: ASSET, submit: true, qa: both.qa });
  assert.equal(sub.isError, undefined, text(sub));
  assert.equal(sub.structuredContent.submit.written, 32);
  assert.equal(json(forge('poseclips.json')).clips.follow.keys.length, 4, 'the pose definition survives the combined submit');
  assert.ok(json(forge('rig.json')).facings, 'and so does the rig');

  // Each frame is credited to the sheet it came from: two submissions, two source hashes.
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(log.map((l) => l.sourceHash).sort(), [pose.sheet.sha256, turn.sheet.sha256].sort());
  assert.equal(log.find((l) => l.sourceHash === pose.sheet.sha256).prompt, fs.readFileSync(join(POSE, 'prompt.txt'), 'utf8'));
  assert.equal(log.reduce((n, l) => n + l.frames.length, 0), 32);

  // A re-bake with nothing passed uses both stored definitions and changes nothing.
  const again = await a.call('studio_rig_bake', { assetId: ASSET, submit: true, qa: both.qa });
  assert.equal(again.isError, undefined, text(again));
  assert.equal(again.structuredContent.submit.unchanged, 32);
  assert.equal(json(forge('poseclips.json')).clips.follow.keys.length, 4);
}));

async function twoSheets(p, a, { same = false } = {}) {
  const m = marten(p);
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  const turn = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: 'turnaround prompt', tool: 'turn tool' });
  const poseLayout = json(join(POSE, 'layout.json'));
  const pose = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: same ? 'work/turnaround.png' : 'work/pose_sheet.png' }, layout: same ? { ...poseLayout, cells: poseLayout.cells ?? poseLayout } : poseLayout, prompt: 'pose prompt', tool: 'pose tool', scaleOptions: { mode: 'sheet' } }).catch((e) => ({ error: e.message }));
  return { m, tpl, turn, pose };
}

test('a legacy pose sheet in import.json is replaced by a new pose import, even before any turnaround exists', () => withProject(async (p) => {
  const a = connect(p.root);
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  const forge = join(p.root, 'assets/raw/longtime', ASSET, 'forge');
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const poseArgs = (prompt) => ({ assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt, tool: 't', scaleOptions: { mode: 'sheet' } });
  await a.ok('studio_sheet_import', poseArgs('first'));
  // Make the state a legacy one: the pose import lives in import.json, there is no import.pose.json.
  fs.renameSync(join(forge, 'import.pose.json'), join(forge, 'import.json'));
  const second = await a.ok('studio_sheet_import', poseArgs('second prompt'));
  assert.equal(second.slot, 'pose');
  assert.equal(json(join(forge, 'import.pose.json')).prompt, 'second prompt');
  const px = await a.call('studio_process', { assetId: ASSET, marks: MARKS });
  assert.equal(px.structuredContent.sheets.length, 1);
  const { readImports } = await import('./workflow/forge.mjs');
  const got = await readImports({ root: p.root }, { layout: { rawDir: `assets/raw/longtime/${ASSET}` } });
  assert.equal(got.pose.prompt, 'second prompt', 'reads prefer the dedicated pose file over the legacy one');
}));

test('ONE PNG imported into both slots keeps two records: each frame is credited to its own slot (grouping by hash would merge them)', () => withProject(async (p) => {
  const a = connect(p.root);
  const m = marten(p);
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const poseLayout = json(join(POSE, 'layout.json'));
  // A valid turnaround layout over the very same sheet: the four contact_a cells as plain facings (no pose), so it is the rig slot.
  const rigLayout = { ...poseLayout, id: 'same-sheet-turnaround', cells: poseLayout.cells.filter((c) => c.pose === 'contact_a').map((c) => ({ ...c, id: c.facing, pose: null, label: c.facing.toUpperCase() })) };
  const rigImp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: rigLayout, prompt: 'rig record', tool: 'rig tool' });
  const poseImp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: poseLayout, prompt: 'pose record', tool: 'pose tool', scaleOptions: { mode: 'sheet' } });
  assert.deepEqual([rigImp.slot, poseImp.slot], ['rig', 'pose']);
  assert.equal(rigImp.sheet.sha256, poseImp.sheet.sha256, 'one PNG, one hash, two slots');
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  // A rig fitted to THIS sheet's cells: two paws per facing at the lowest left and right opaque pixels (computed with the forge library, not the tools).
  const settings = await settingsFromPack(loadPackSync(p.root, undefined, { verifyFiles: false }), p.root, 'pet');
  const bytes = fs.readFileSync(join(p.root, 'work/pose_sheet.png'));
  const px = pixelizeImport(importSheet({ layout: normalizeLayout(rigLayout), sheet: decodePng(bytes), sheetBytes: bytes, profile: settings.profile }), settings, { marks: resolveMarks(MARKS, settings.palette) });
  const facings = {};
  for (const f of FACINGS) {
    const img = px.cells.get(f).native;
    const opaque = (x, y) => img.pixels[(y * 32 + x) * 4 + 3] === 255;
    let yb = 31; while (!Array.from({ length: 32 }, (_, x) => x).some((x) => opaque(x, yb))) yb--;
    const row = Array.from({ length: 32 }, (_, x) => x).filter((x) => opaque(x, yb));
    const [xa, xb] = [row[0], row.at(-1)];
    const box = (x, top) => [[x - 2, yb - top], [x + 3, yb - top], [x + 3, yb + 1], [x - 2, yb + 1]];
    facings[f] = { forward: [0, 1], parts: [{ id: 'paw_0', role: 'limb', phase: 0, contact: [xa, yb], cut: box(xa, 5), remove: box(xa, 2) }, { id: 'paw_1', role: 'limb', phase: 1, contact: [xb, yb], cut: box(xb, 5), remove: box(xb, 2) }, { id: 'body', role: 'body' }] };
  }
  const rig = { schema: 'studio.rig', version: 1, id: ASSET, bodyPlan: 'quadruped', canvas: [32, 32], pivot: [16, 29], facings };
  const library = { schema: 'studio.motion.library', version: 1, bodyPlan: 'quadruped', archetypes: { idle: { loop: true, tracks: [{ id: 'gait', target: { role: 'limb' }, gait: { groups: 2, planted: 0.5, stride: 1, lift: 1 } }] } }, templates: { 'pet/idle': { use: 'idle' } } };
  const qa = { weightTransfer: false, pivotDrift: false, stability: false, footSlide: false, markSide: false, flicker: false, loopSeam: false, pose: { identity: false } };
  const sub = await a.call('studio_rig_bake', { assetId: ASSET, rig, library, poseClips: tpl.structuredContent.poseClips, qa, submit: true });
  assert.equal(sub.isError, undefined, text(sub));
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.length, 2, 'two records, not one merged record');
  assert.equal(log[0].sourceHash, log[1].sourceHash);
  const byPrompt = Object.fromEntries(log.map((l) => [l.prompt, l]));
  assert.ok(byPrompt['rig record'].frames.length > 0 && byPrompt['rig record'].frames.every((f) => f.name.startsWith('idle_')));
  assert.ok(byPrompt['pose record'].frames.length > 0 && byPrompt['pose record'].frames.every((f) => f.name.startsWith('follow_')));
  assert.match(byPrompt['rig record'].tool, /rig tool/);
  assert.match(byPrompt['pose record'].tool, /pose tool/);
  assert.match(byPrompt['rig record'].notes, /^rig sheet; layout same-sheet-turnaround/);
  assert.match(byPrompt['pose record'].notes, /^pose sheet;/);
}));

test('a mixed bake is one all-or-nothing submission: a conflict in one sheet\'s frames commits nothing from the other', () => withProject(async (p) => {
  const a = connect(p.root);
  const { m, tpl } = await twoSheets(p, a);
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  const qa = { weightTransfer: false, pivotDrift: false, stability: { maxNewColors: 3 } };
  // A different frame already sits where a RIG frame would go (the second group in bake order): raw is immutable, so the whole submission must be refused.
  const dir = join(p.root, 'assets/raw/longtime', ASSET, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(join(EXP, 'frames/idle_south_0.png'), join(dir, 'idle_south_1.png'));
  const refused = await a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, poseClips: tpl.structuredContent.poseClips, qa, submit: true });
  assert.equal(refused.isError, true);
  assert.deepEqual(fs.readdirSync(dir), ['idle_south_1.png'], 'no pose frame was written either');
  const logFile = join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl');
  assert.equal(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim() : '', '');
}));

test('rig_bake: two named verdicts, and a gate that did not run is said so', () => withProject(async (p) => {
  const a = connect(p.root);
  const m = marten(p);
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/turnaround.png' }, layout: m.layout, prompt: m.prompt, tool: 'test' });
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: 'p', tool: 'test', scaleOptions: { mode: 'sheet' } });
  await a.ok('studio_process', { assetId: ASSET, marks: MARKS });
  const qa = { weightTransfer: false, pivotDrift: false, stability: { maxNewColors: 3 } };
  const clean = await a.call('studio_rig_bake', { assetId: ASSET, rig: m.rig, library: m.library, poseClips: tpl.structuredContent.poseClips, qa });
  const v = clean.structuredContent.verdicts;
  assert.deepEqual([v.animationGates.pass, v.pixelGates.pass, clean.structuredContent.pass], [true, true, true]);
  assert.match(text(clean), /Animation gates: PASS, not run: .*foot_slide.*\. Pixel gates: PASS\./);
  const notRun = Object.fromEntries(v.animationGates.notRun.map((n) => [n.gate, n]));
  assert.deepEqual(notRun.foot_slide.clips, ['follow'], 'the drawn walk had no planted contacts, so foot slide never ran for it');
  assert.match(notRun.foot_slide.reason, /no planted contact/);
  assert.match(notRun.foot_slide.turnOn, /contacts/);
  assert.match(notRun.flicker.reason, /skipped by default for drawn pose clips/);
  assert.match(notRun.flicker.turnOn, /qa:\{pose:\{flicker/);
  assert.equal(notRun.pivot_drift.reason, 'turned off in qa');
  assert.ok(v.animationGates.ran.some((g) => g.gate === 'loop_seam'));
  assert.match(clean.structuredContent.next, /Both verdicts pass \(gates not run: .*foot_slide/);

  // Error pixels: the animation gates still pass, but the overall verdict does not, and nothing suggests submitting.
  await a.ok('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'idle_south_0', ops: [{ op: 'set', pixels: [[0, 0, 'bronze_04'], [1, 0, 'jade_04']] }] }] });
  const dirty = await a.call('studio_rig_bake', { assetId: ASSET, qa });
  assert.deepEqual([dirty.structuredContent.verdicts.animationGates.pass, dirty.structuredContent.verdicts.pixelGates.pass, dirty.structuredContent.pass], [true, false, false]);
  assert.equal(dirty.structuredContent.verdicts.pixelGates.errorPixels, 2);
  assert.match(text(dirty), /Animation gates: PASS.*Pixel gates: FAIL \(2 error pixel/);
  assert.match(dirty.structuredContent.next, /^Not ready to submit: fix the error pixels/);
  assert.doesNotMatch(dirty.structuredContent.next, /submit=true/);
  const refused = await a.call('studio_rig_bake', { assetId: ASSET, qa, submit: true });
  assert.equal(refused.isError, true);
  assert.match(refused.structuredContent.submit.message, /Nothing was committed: 2 error pixel/);
  assert.equal(fs.existsSync(join(p.root, 'assets/raw/longtime', ASSET, 'frames')), false);
}));

test('template_get carries the document formats, and the forge descriptions say what an agent otherwise reads source for', () => withProject(async (p) => {
  const a = connect(p.root);
  const t = (await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' })).structuredContent.formats;
  assert.equal(t.rig.shape.schema, 'studio.rig');
  assert.deepEqual(t.rig.shape.canvas, [32, 32]);
  assert.match(t.rig.rules.join(' '), /contact pixel .* joint/);
  assert.deepEqual(Object.keys(t.rig.bodyPlans).sort(), ['biped', 'quadruped']);
  assert.match(t.rig.bodyPlans.quadruped.limb, /required, needs contact/);
  assert.equal(t.poseClips.shape.schema, 'forge.poseclips');
  assert.match(JSON.stringify(t.poseClips.shape), /planted contacts TURN ON the foot-slide gate/);
  assert.match(t.twoSheets, /rig AND poseClips in one call/);
  const tools = Object.fromEntries((await a.rpc('tools/list')).result.tools.map((x) => [x.name, x.description]));
  assert.match(tools.studio_rig_bake, /verdicts\.animationGates .* verdicts\.pixelGates/);
  assert.match(tools.studio_rig_bake, /notRun .* NOT a pass/);
  assert.match(tools.studio_rig_bake, /import the turnaround AND the pose sheet/);
  assert.match(tools.studio_sheet_import, /layout\.labelBand\.fraction of every cell \(0\.13 in the shipped templates\)/);
  assert.match(tools.studio_sheet_import, /each kind of sheet keeps its own import/);
  assert.match(tools.studio_frame_patch, /pixel gates .* NEXT studio_rig_bake/);
  assert.match(tools.studio_scene_snapshot, /STORED frames only/);
  assert.match(tools.studio_diff, /single_revision .* forge\/patch\.json/);
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

test('gateCoverage agrees with qaStage: rig landmarks of a secondary-motion pose clip, two-frame clips, clips sharing no facing', async () => {
  const { gateCoverage } = await import('./workflow/gates.mjs');
  const frames = (n) => Array.from({ length: n }, () => ({}));
  const rig = { facings: { south: { landmarks: [{ id: 'ear', color: 'soul_07', box: [0, 0, 1, 1] }] } } };
  const baked = { clips: {
    walk: { source: 'poses', secondary: true, loop: true, facings: { south: { frames: frames(4), contacts: [[], [], [], []] } } },   // no landmarks of its own
    pair: { source: 'poses', loop: true, facings: { west: { frames: frames(2), contacts: [[], []] } } },
  } };
  const c = gateCoverage(baked, { rig });
  assert.ok(c.ran.find((g) => g.gate === 'mark_side').clips.includes('walk'), 'the rig facing supplies landmarks for the secondary pose clip, as qaStage uses them');
  assert.ok(!c.notRun.some((n) => n.gate === 'mark_side' && n.clips.includes('walk')), 'and it is not also listed as not run');
  assert.ok(c.notRun.some((n) => n.gate === 'flicker' && n.clips.includes('pair')), 'flicker needs three frames');
  assert.match(c.notRun.find((n) => n.gate === 'stability').reason, /no two clips share a facing/);
  // Weight transfer: a pose clip with secondary rig motion has per-part poses, so the gate is eligible; qa switches (global, pose-level, clip-level) turn it off.
  const sec = (qa) => ({ clips: { walk: { source: 'poses', secondary: true, loop: true, ...(qa ? { qa } : {}), facings: { south: { frames: frames(4), contacts: [[], [], [], []], poses: [{}, {}, {}, {}] } } } } });
  const wt = (baked, options) => gateCoverage(baked, { rig, options });
  assert.ok(wt(sec(), {}).ran.some((g) => g.gate === 'weight_transfer'), 'eligible and on: ran');
  for (const [label, baked, options] of [['global', sec(), { weightTransfer: false }], ['pose-level', sec(), { pose: { weightTransfer: false } }], ['clip-level', sec({ weightTransfer: false }), {}]]) {
    const c2 = wt(baked, options);
    assert.ok(!c2.ran.some((g) => g.gate === 'weight_transfer'), label);
    assert.equal(c2.notRun.find((n) => n.gate === 'weight_transfer')?.reason, 'turned off in qa', label);
  }
  const plain = { clips: { walk: { source: 'poses', loop: true, facings: { south: { frames: frames(4), contacts: [[], [], [], []] } } } } };
  assert.match(wt(plain, {}).notRun.find((n) => n.gate === 'weight_transfer').reason, /no per-part poses/);
});
