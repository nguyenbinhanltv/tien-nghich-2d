// The clip-level gates on drawn clips, through the three tools that report them: studio_frames_submit (hand-supplied frames),
// studio_sheet_import (a pose sheet, advisory) and studio_rig_bake (the baker moves the feet onto the pivot's ground row).
// The frames are the Codex retest walk (session 41), kept as small fixtures: its feet sit 3 px above the project's ground row (24 against 27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { encodePng, readFrame, shiftFrame } from '../forge/index.mjs';
import { REPO, connect, makeProject } from './testkit.mjs';

const ASSET = 'lt_reed_crane';   // a planned 32x32 pet with a 4-frame follow clip
const FIX = join(REPO, 'studio/forge/tests/fixtures/ember_courier');
const POSE = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten_pose');
const PROVENANCE = { tool: 'test', prompt: 'a walk', sourceHash: 'a'.repeat(64) };
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const text = (r) => r.content?.[0]?.text ?? '';
const PALETTE = json(join(REPO, 'tools/generators/palette.json'));
const settingsRgb = (id) => { const hex = PALETTE.colors.find((c) => c.id === id).hex; return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); };
const walk = (facing, dy = 0, n = 4) => Array.from({ length: n }, (_, i) => {
  const frame = readFrame(join(FIX, `walk_${facing}_${i}.png`));
  return { clip: 'follow', direction: facing, n: i, pngBase64: Buffer.from(encodePng(dy ? shiftFrame(frame, 0, dy) : frame)).toString('base64') };
});

test('frames_submit: a whole drawn clip gets the clip gates, with the ground miss, the fixing offset and what did not run', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const r = await a.ok('studio_frames_submit', { assetId: ASSET, provenance: PROVENANCE, frames: walk('south'), dryRun: true });
  const g = r.clipGates;
  assert.deepEqual(g.judged, [{ clip: 'follow', direction: 'south', frames: 4 }]);
  assert.equal(g.groups.frame.pass, false, 'feet 3 px above the ground row is an error');
  assert.equal(g.findings.find((f) => f.gate === 'ground_contact').measured, 3);
  assert.deepEqual(g.ground, [{ clip: 'follow', facing: 'south', rows: [24, 24, 24, 24], target: 27, suggestedShift: 3 }]);
  assert.ok(g.groups.motion.ran.includes('flicker') && g.groups.motion.ran.includes('identity_drift'), 'flicker and identity drift run on a drawn clip');
  assert.deepEqual(g.notRun.map((n) => n.gate).filter((n) => ['foot_slide', 'mark_side', 'weight_transfer'].includes(n)).sort(), ['foot_slide', 'mark_side', 'weight_transfer']);
  const checks = Object.fromEntries(r.qa.checks.map((c) => [c.name, c.status]));
  assert.equal(checks.frameGates, 'fail');
  assert.equal(checks.pixelGates === 'pass' && checks.paletteGates === 'pass', true);
  assert.equal(r.accepted, true, 'the clip gates report; the pixel gates alone block the write');
}));

test('frames_submit: moved onto the ground row the frame gate passes, the offset is in the provenance record, and a partial clip is said so', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const r = await a.ok('studio_frames_submit', { assetId: ASSET, provenance: PROVENANCE, frames: walk('south', 3) });
  assert.equal(r.clipGates.groups.frame.pass, true);
  assert.equal(r.clipGates.errors, 0);
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(log[0].gates.clips.ground, [{ clip: 'follow', facing: 'south', groundRows: [27, 27, 27, 27], groundTarget: 27, suggestedShift: 0 }]);
  const partial = await a.ok('studio_frames_submit', { assetId: ASSET, provenance: PROVENANCE, frames: walk('west', 3, 2), dryRun: true });
  assert.deepEqual(partial.clipGates.partial.map((x) => [x.clip, x.direction, x.have, x.need]), [['follow', 'west', [0, 1], 4]]);
  assert.ok(partial.qa.notProven.some((n) => /clip gates for follow west/.test(n.what)));
  const off = await a.ok('studio_frames_submit', { assetId: ASSET, provenance: PROVENANCE, frames: walk('north'), dryRun: true, qa: { groundContact: false } });
  assert.equal(off.clipGates.groups.frame.pass, true);
  assert.ok(off.clipGates.notRun.some((n) => n.gate === 'ground_contact' && n.reason === 'turned off in qa'));
}));

test('sheet_import: the result carries the advisory gates of the pose sheet, per facing, and the offset the bake will apply', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const imp = await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: fs.readFileSync(join(POSE, 'prompt.txt'), 'utf8'),
    tool: 'test', scaleOptions: { mode: 'sheet' } });
  const g = imp.gates;
  assert.equal(g.advisory, true);
  assert.equal(g.pixelGates.pass, true);
  assert.deepEqual(g.judged.map((j) => j.direction).sort(), ['east', 'north', 'south', 'west']);
  assert.ok(g.ground.every((x) => x.target === 27 && Number.isInteger(x.suggestedShift)));
  assert.ok(g.ground.some((x) => x.suggestedShift !== 0), 'the plain import leaves the feet off the ground row, which the bake fixes');
  assert.ok(['frame', 'palette', 'motion'].every((k) => k in g.groups));
}));

test('rig_bake: the baker moves each drawn clip onto the ground row, returns the offset, and writes it into the submit provenance', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: 'p', tool: 'test', scaleOptions: { mode: 'sheet' } });
  await a.ok('studio_process', { assetId: ASSET, marks: [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }] });
  const qa = { pivotDrift: false, flicker: false, identity: false };
  const bake = await a.call('studio_rig_bake', { assetId: ASSET, poseClips: tpl.structuredContent.poseClips, qa });
  const offsets = bake.structuredContent.groundOffsets;
  assert.equal(offsets.length, 4);
  assert.ok(offsets.every((o) => o.applied && o.dy !== 0 && o.target === 27 && o.rowsAfter.every((r, i) => r === o.rowsBefore[i] + o.dy)));
  const ran = bake.structuredContent.verdicts.animationGates.ran.find((g) => g.gate === 'ground_contact');
  assert.deepEqual(ran.clips, ['follow'], 'the ground-contact gate runs on the drawn clip by default');
  // The same bake with the move turned off in the clip leaves the frames and the gate then judges them where the import put them.
  const still = structuredClone(tpl.structuredContent.poseClips);
  still.clips.follow.ground = false;
  const raw = await a.call('studio_rig_bake', { assetId: ASSET, poseClips: still, qa, dryRun: true });
  assert.equal(raw.structuredContent.groundOffsets, undefined);
  assert.ok(raw.structuredContent.gates.findings.every((f) => f.gate !== 'ground_contact') || raw.structuredContent.gates.errors > 0);
  // In the real marten walk one key puts a paw 2 px below the clip's usual contact, even after the move: an error, so the submit is refused with the numbers.
  const miss = bake.structuredContent.gates.findings.filter((f) => f.gate === 'ground_contact');
  assert.ok(miss.length > 0 && miss.every((f) => f.severity === 'error' && f.measured === 2 && f.limit === 1));
  const refused = await a.call('studio_rig_bake', { assetId: ASSET, qa: { ...qa, stability: false }, submit: true });
  assert.equal(refused.isError, true);
  assert.match(refused.structuredContent.submit.message, /Nothing was committed: \d+ animation gate error/);
  // Judged with the 2 px tolerance the marten walk passes and the offsets travel with the frames.
  const ok = await a.call('studio_rig_bake', { assetId: ASSET, qa: { ...qa, stability: false, groundContact: { tolerance: 2 } }, submit: true });
  assert.equal(ok.isError, undefined, text(ok));
  const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', ASSET, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.match(log.at(-1).notes, /ground offsets \(rows moved to the ground row 27\) follow\/south [+-]\d/);
}));

test('frame_patch target bake records the ground offset it was written against, and a rebake with another offset moves the patched pixel with the body', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(POSE, 'pose_sheet.png'), join(p.root, 'work/pose_sheet.png'));
  const tpl = await a.call('studio_template_get', { assetId: ASSET, kind: 'pose-sheet', clip: 'follow' });
  await a.ok('studio_sheet_import', { assetId: ASSET, sheet: { file: 'work/pose_sheet.png' }, layout: json(join(POSE, 'layout.json')), prompt: 'p', tool: 'test', scaleOptions: { mode: 'sheet' } });
  await a.ok('studio_process', { assetId: ASSET, marks: [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }] });
  const qa = { pivotDrift: false, flicker: false, identity: false, groundContact: false, stability: false };
  const first = await a.call('studio_rig_bake', { assetId: ASSET, poseClips: tpl.structuredContent.poseClips, qa });
  const dy = first.structuredContent.groundOffsets.find((o) => o.facing === 'south').dy;
  assert.ok(dy > 0);
  const bakeDir = join(p.root, '.inspector-revisions/work', ASSET, 'bake');
  const topRow = (f) => { const img = readFrame(join(bakeDir, f)); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (img.pixels[(y * 32 + x) * 4 + 3]) return { x, y }; };
  const top = topRow('follow_south_0.png');
  // A patch on the first opaque pixel of the figure, written against this bake.
  await a.ok('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'follow_south_0', ops: [{ op: 'set', pixels: [[top.x, top.y, 'jade_04']] }] }] });
  const stored = () => json(join(p.root, 'assets/raw/longtime', ASSET, 'forge/patch.json'));
  assert.deepEqual(stored().ground, { follow_south: dy }, 'the offset of the bake it was written against');
  assert.deepEqual(stored().frames.follow_south_0[0].pixels, [[top.x, top.y, 'jade_04']]);
  // The same clip moved one row further (inset 1): the pixel is still on the top of the figure, one row lower.
  const moved = structuredClone(tpl.structuredContent.poseClips);
  moved.clips.follow.ground = { inset: 1 };
  await a.call('studio_rig_bake', { assetId: ASSET, poseClips: moved, qa });
  const after = topRow('follow_south_0.png');
  assert.equal(after.y, top.y + 1);
  const img = readFrame(join(bakeDir, 'follow_south_0.png'));
  const at = (x, y) => [...img.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)];
  const jade = settingsRgb('jade_04');
  assert.deepEqual(at(top.x, top.y + 1), jade, 'the patched pixel moved with the body');
  assert.notDeepEqual(at(top.x, top.y), jade);
  // A new patch on that bake rebases the stored one to its offset and records it.
  await a.ok('studio_frame_patch', { assetId: ASSET, target: 'bake', edits: [{ frame: 'follow_west_0', ops: [{ op: 'set', pixels: [[1, 1, 'jade_04']] }] }] });
  assert.deepEqual(stored().ground.follow_south, dy + 1);
  assert.deepEqual(stored().frames.follow_south_0[0].pixels, [[top.x, top.y + 1, 'jade_04']]);
}));
