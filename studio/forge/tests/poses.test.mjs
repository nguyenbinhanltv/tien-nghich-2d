// Pose-sheet clips: keys are imported pose cells sharing one scale and ground line, optionally with the rig's
// secondary motion layered on top.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPack } from '../../core/pack.mjs';
import { boundsOf, bakeStage, decodePng, encodePng, flipHorizontal, framesEqual, importSheet, normalizeEntries, pixelizeImport, qaStage, renderTemplate,
  rigPalette, runPipeline, settingsFromPack, turnaroundLayout, validatePoseClips } from '../index.mjs';
import { drawFigure, makeProject, palette } from './fixture.mjs';

const rgb = id => { const hex = palette.colors.find(c => c.id === id).hex; return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); };
const poses = ['stand', 'crouch', 'lift'];
const facings = ['front', 'side'];
const spec = {
  stand: {width: 120, height: 160}, crouch: {width: 120, height: 120}, lift: {width: 120, height: 160, lift: 14},
};

async function build() {
  const dir = await makeProject({clips: {walk: [4, 100]}});
  const pack = await loadPack(dir), settings = await settingsFromPack(pack, dir, 'critter');
  const layout = turnaroundLayout({id: 'poses', facings, poses, size: [900, 1200], heightPx: 26});
  const sheet = renderTemplate(layout);
  for (const cell of layout.cells) drawFigure(sheet, layout, cell.id, {...spec[cell.pose], body: rgb(cell.facing === 'front' ? 'clay' : 'moss'), head: rgb('rose')});
  const bytes = Buffer.from(encodePng(sheet));
  return {dir, pack, settings, layout, sheet: decodePng(bytes), bytes};
}

const heights = (result, id) => { const b = boundsOf(result.cells.get(id).native); return [b[3] - b[1], b[3]]; };

test('sheet mode shares one scale and one ground line; cell mode refits every pose', async t => {
  const {dir, settings, layout, sheet, bytes} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const make = scaleOptions => importSheet({layout, sheet, sheetBytes: bytes, profile: settings.profile, scaleOptions});
  const cell = make({}), shared = make({mode: 'sheet'});
  assert.deepEqual(shared.record.scaleOptions, {mode: 'sheet', groundLift: 4, margin: 1});
  assert.deepEqual(cell.record.scaleOptions, {mode: 'cell', groundLift: 4, margin: 1});
  assert.equal(new Set(shared.record.cells.map(c => c.scale)).size, 1, 'one scale for the whole sheet');
  assert.ok(new Set(cell.record.cells.map(c => c.scale)).size > 1, 'cell mode fits each pose on its own');
  const lifted = shared.record.cells.find(c => c.id === 'lift_front');
  assert.ok(lifted.groundShiftPx >= 1, 'a pose drawn above the ground line keeps its lift');
  assert.equal(shared.record.cells.find(c => c.id === 'stand_front').groundShiftPx, 0);

  const cellPx = pixelizeImport(cell, settings), sharedPx = pixelizeImport(shared, settings);
  // Cell mode scales the crouch up to the stand's height (it jumps in size) and drops the lift onto the support line.
  assert.ok(Math.abs(heights(cellPx, 'crouch_front')[0] - heights(cellPx, 'stand_front')[0]) <= 1);
  assert.equal(heights(cellPx, 'lift_front')[1], 30);
  // Sheet mode keeps the crouch lower than the stand and the lifted pose off the ground.
  assert.ok(heights(sharedPx, 'stand_front')[0] - heights(sharedPx, 'crouch_front')[0] >= 3);
  assert.ok(heights(sharedPx, 'lift_front')[1] <= 29);
  assert.equal(heights(sharedPx, 'stand_front')[1], 30);
  // One scale for all: the stand shrinks a little too, because the lifted pose needs the room (it binds the scale).
  assert.ok(heights(sharedPx, 'stand_front')[0] < heights(cellPx, 'stand_front')[0]);
  assert.equal(shared.record.cells.find(c => c.id === 'stand_front').limitCell, 'lift_front');
});

test('a partial scale override keeps the recorded mode', async t => {
  const {dir, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const facing = importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'facing'}});
  const cells = result => result.record.cells;
  const oneScalePerFacing = result => ['front', 'side'].every(f => new Set(cells(result).filter(c => c.facing === f).map(c => c.scale)).size === 1);
  for (const partial of [{groundLift: 3}, {margin: 2}, {fixedScale: {front: 0.05}}]) {
    const refit = pixelizeImport(facing, settings, {scaleOptions: partial});
    assert.equal(refit.record.scaleOptions.mode, 'facing', JSON.stringify(partial));
    assert.ok(oneScalePerFacing(refit), `poses of a facing still share a scale with ${JSON.stringify(partial)}`);
  }
  assert.equal(pixelizeImport(facing, settings, {scaleOptions: {groundLift: 3}}).record.scaleOptions.groundLift, 3);
  assert.equal(pixelizeImport(facing, settings, {scaleOptions: {mode: 'cell'}}).record.scaleOptions.mode, 'cell');
});

test('recorded sheet-mode scale is refitted, never reused, for another profile or other options', async t => {
  const {dir, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const shared = importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'sheet'}});
  const reused = pixelizeImport(shared, settings);
  assert.equal(reused.record.scaleOptions.mode, 'sheet');
  const forced = pixelizeImport(shared, settings, {scaleOptions: {mode: 'cell'}});
  assert.notEqual(forced.record.cells.find(c => c.id === 'crouch_front').scale, reused.record.cells.find(c => c.id === 'crouch_front').scale);
  const bigger = {...settings, profile: {...settings.profile, nativePx: [64, 56], pivotPx: [32, 48]}};
  const refit = pixelizeImport(shared, bigger);
  assert.equal(new Set(refit.record.cells.map(c => c.scale)).size, 1, 'still one scale after refitting');
  assert.deepEqual(normalizeEntries(shared.record.cells, bigger.profile, {mode: 'sheet'}).map(c => c.scale), refit.record.cells.map(c => c.scale));
});

const clips = {schema: 'forge.poseclips', version: 1, clips: {walk: {keys: ['stand', 'crouch', 'stand', 'lift'], ground: false, qa: {groundContact: false}, mirror: {side_r: {of: 'side'}}}}};

test('a pose clip plays the imported cells in key order, shares them between keys and mirrors a facing', async t => {
  const {dir, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const imported = importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'sheet'}});
  const px = pixelizeImport(imported, settings), pal = rigPalette(settings);
  const result = bakeStage({settings, palette: pal, cells: px.cells, poseClips: clips});
  const walk = result.clips.walk;
  assert.equal(walk.source, 'poses');
  assert.deepEqual(Object.keys(walk.facings).sort(), ['front', 'side', 'side_r']);
  assert.equal(walk.durationMs, 100);
  const front = walk.facings.front.frames;
  assert.ok(framesEqual(front[0], px.cells.get('stand_front').native) && framesEqual(front[1], px.cells.get('crouch_front').native));
  assert.ok(framesEqual(front[0], front[2]) && framesEqual(front[3], px.cells.get('lift_front').native));
  assert.ok(framesEqual(walk.facings.side_r.frames[1], flipHorizontal(walk.facings.side.frames[1])));
  assert.deepEqual(Object.keys(result.frames).length, 12);
  const gates = qaStage(result, {settings, palette: pal, options: {pivotDrift: false, flicker: false}});
  assert.deepEqual(gates.findings.filter(f => f.severity === 'error'), []);
  assert.equal(Object.keys(gates.metrics).length, 3);
});

test('pose clip validation names missing cells, wrong key counts and unknown clips', async t => {
  const {dir, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const px = pixelizeImport(importSheet({layout, sheet, profile: settings.profile}), settings);
  const ids = new Set(px.cells.keys()), table = {walk: {frames: 4, durationMs: 100}};
  const issues = doc => validatePoseClips({schema: 'forge.poseclips', version: 1, clips: doc}, {table, layerIds: ids});
  assert.deepEqual(issues({walk: {keys: ['stand', 'crouch', 'stand', 'lift']}}), []);
  assert.match(issues({walk: {keys: ['stand', 'crouch']}}).join(), /exactly 4 pose names/);
  assert.match(issues({walk: {keys: ['stand', 'jump', 'stand', 'lift']}}).join(), /no facing has a cell/);
  assert.match(issues({walk: {keys: ['stand', 'crouch', 'stand', 'lift'], facings: ['rear']}}).join(), /missing cell "stand_rear"/);
  assert.match(issues({run: {keys: []}}).join(), /no clip "run"/);
  assert.match(issues({walk: {keys: ['stand', 'crouch', 'stand', 'lift'], mirror: {x: {of: 'nope'}}}}).join(), /source facing "nope"/);
});

test('secondary motion: the rig moves a part on top of the pose cells', async t => {
  const {dir, settings, layout, sheet, bytes} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const imported = importSheet({layout, sheet, sheetBytes: bytes, profile: settings.profile, scaleOptions: {mode: 'sheet'}});
  const px = pixelizeImport(imported, settings), pal = rigPalette(settings);
  const [x0, y0, x1, y1] = boundsOf(px.cells.get('stand_side').native);
  const midX = Math.round((x0 + x1) / 2), top = y0 + 2;
  // Side facing: a small "crest" plate on top of the body, two legs at the bottom (the drawing has a gap between them).
  const box = (a, b, c, d) => [[a, b], [c, b], [c, d], [a, d]];
  const side = {
    forward: [1, 0], maxShift: 0,
    parts: [
      {id: 'crest', role: 'tail', joint: [midX, top + 2], cut: box(midX - 3, top - 1, midX + 3, top + 4), remove: box(midX - 2, top, midX + 2, top + 3)},
      {id: 'leg_a', role: 'limb', phase: 0, contact: [x0 + 2, y1 - 2], cut: box(x0, y1 - 4, x0 + 5, y1), remove: box(x0, y1 - 3, x0 + 5, y1)},
      {id: 'leg_b', role: 'limb', phase: 1, contact: [x1 - 3, y1 - 2], cut: box(x1 - 5, y1 - 4, x1, y1), remove: box(x1 - 5, y1 - 3, x1, y1)},
      {id: 'body', role: 'body'},
    ],
  };
  const rig = {schema: 'studio.rig', version: 1, id: 'critter', bodyPlan: 'quadruped', canvas: [48, 40], pivot: [24, 34], facings: {side}};
  const library = {schema: 'studio.motion.library', version: 1, bodyPlan: 'quadruped',
    archetypes: {sway: {loop: true, tracks: [{id: 'crest', target: {role: 'tail'}, channel: 'dy', curve: {wave: {amp: 1}}}]}},
    templates: {'critter/walk': {use: 'sway'}}};
  const withMotion = {...clips, clips: {walk: {keys: ['stand', 'stand', 'stand', 'stand'], facings: ['side'], secondary: {template: 'walk'}}}};
  const result = bakeStage({settings, palette: pal, cells: px.cells, rig, poseRig: rig, poseClips: withMotion, library});
  const frames = result.clips.walk.facings.side.frames;
  assert.equal(result.clips.walk.secondary, true);
  assert.equal(frames.length, 4);
  // Same cell on every key, so any difference between keys is the secondary motion alone.
  assert.ok(!framesEqual(frames[0], frames[1]) || !framesEqual(frames[0], frames[3]));
  assert.ok(result.clips.walk.facings.side.contacts[0].length === 2);
  assert.ok(result.clips.walk.facings.side.poses.length === 4);
  const gates = qaStage(result, {settings, palette: pal, rig, poseRig: rig, options: {weightTransfer: false}});
  assert.ok(Array.isArray(gates.findings));
  // Without a rig, secondary motion is an error, not a silent no-op.
  assert.throws(() => bakeStage({settings, palette: pal, cells: px.cells, poseClips: withMotion, library}), /no rig/);
});

test('runPipeline accepts pose clips without any rig and reports a JSON summary', async t => {
  const {dir, settings, layout, sheet, bytes} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const {summary} = await runPipeline({project: {settings, palette: rigPalette(settings)}, layout, sheet: {bytes}, scaleOptions: {mode: 'sheet'},
    poseClips: clips, qa: {pivotDrift: false, flicker: false}});
  assert.equal(summary.ok, true, summary.error);
  assert.equal(summary.stages.import.record.scaleOptions.mode, 'sheet');
  assert.deepEqual(Object.keys(summary.stages.bake.clips), ['walk']);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
});
