import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, appendOps, emptyPatch, validatePatch, bakeRig, qaBake, patchKey } from '../index.mjs';
import { getRgb, alphaAt, framesEqual } from '../raster.mjs';
import { bipedPalette, bipedRig, bipedNative } from './fixtures/biped.mjs';
import { loadMarten, southFacePatch, southFeature } from './fixtures/marten.mjs';
import { loadLibrary } from '../../motion/library.mjs';
import { readFileSync } from 'node:fs';
import { root } from './fixtures/marten.mjs';

const palette = bipedPalette();
const manifest = JSON.parse(readFileSync(`${root}assets/manifest_longtime.json`, 'utf8'));
const bake = patch => bakeRig({rig: bipedRig, native: bipedNative(palette), library: loadLibrary('biped'), profile: manifest.profiles.player, profileName: 'player', palette, clips: ['idle'], patch});
const base = bake().frames.idle_south_0;
const at = (frame, x, y) => (alphaAt(frame, x, y) === 255 ? palette.idOf(getRgb(frame, x, y)) : null);

test('set, line, fill, flood paint by palette id and null clears', () => {
  const out = applyPatch(base, [
    {op: 'set', pixels: [[15, 14, 'bp_spare'], [16, 14, null]]},
    {op: 'line', from: [12, 22], to: [15, 22], color: 'bp_belt'},
    {op: 'fill', box: [13, 12, 15, 14], color: 'bp_hair'},
    {op: 'flood', at: [10, 17], color: 'bp_boot'}
  ], palette);
  assert.equal(at(out, 15, 14), 'bp_spare');
  assert.equal(at(out, 16, 14), null);
  for (let x = 12; x <= 15; x++) assert.equal(at(out, x, 22), 'bp_belt');
  assert.equal(at(out, 13, 12), 'bp_hair');
  assert.equal(at(out, 14, 13), 'bp_hair');
  assert.equal(at(out, 15, 12), at(base, 15, 12), 'fill box is half-open');
  assert.equal(at(out, 10, 17), 'bp_boot');
  assert.equal(at(out, 11, 18), 'bp_boot', 'flood fills the whole connected same-colour region');
  assert.notEqual(at(out, 12, 17), 'bp_boot', 'and stops at a different colour');
  assert.equal(at(base, 15, 14) === 'bp_spare', false, 'input frame is not mutated');
});

test('shift moves a region and leaves transparency; copy stamps opaque pixels, also from another frame', () => {
  const moved = applyPatch(base, [{op: 'shift', box: [10, 11, 12, 19], dx: -2, dy: 0}], palette);
  assert.equal(at(moved, 8, 12), at(base, 10, 12));
  assert.equal(at(moved, 10, 12), null, 'vacated pixels clear');
  const copied = applyPatch(base, [{op: 'copy', box: [10, 11, 12, 19], dx: -2, dy: 0}], palette);
  assert.equal(at(copied, 10, 12), at(base, 10, 12), 'copy leaves the source');
  assert.equal(at(copied, 8, 12), at(base, 10, 12));
  const other = bake().frames.idle_south_2;
  const from = applyPatch(base, [{op: 'copy', box: [10, 11, 12, 19], dx: 0, dy: 0, from: {facing: 'south', frame: 2}}], palette, {lookup: (facing, i) => (facing === 'south' && i === 2 ? other : null)});
  assert.equal(at(from, 11, 12), at(other, 11, 12));
});

test('outline op rebuilds the silhouette edge after a fill spills past it', () => {
  const fat = applyPatch(base, [{op: 'fill', box: [9, 12, 11, 15], color: 'bp_spare'}, {op: 'outline'}], palette);
  assert.equal(at(fat, 9, 13), palette.outlineId, 'new boundary is ink');
  assert.notEqual(at(fat, 10, 13), palette.outlineId, 'interior stays');
});

test('validation reports canvas, palette and shape problems with their path', () => {
  const issues = validatePatch({schema: 'studio.patch', version: 1, frames: {
    idle_south_0: [{op: 'set', pixels: [[40, 3, 'bp_skin']]}, {op: 'fill', box: [0, 0, 5, 5], color: 'nope'}, {op: 'warp'}],
    bad: []
  }}, {palette, width: 32, height: 32});
  assert.equal(issues.length, 4, issues.join('\n'));
  assert.match(issues.join('\n'), /outside the 32x32 canvas/);
  assert.match(issues.join('\n'), /unknown palette id "nope"/);
  assert.match(issues.join('\n'), /unknown op "warp"/);
  assert.match(issues.join('\n'), /key must look like clip_facing_index/);
});

test('a patch is data stored with the asset and survives a rebuild', () => {
  const patch = appendOps(emptyPatch(), patchKey('idle', 'south', 0), [{op: 'set', pixels: [[15, 14, 'bp_spare']]}]);
  const stored = JSON.parse(JSON.stringify(patch));
  const first = bake(stored), second = bake(stored);
  assert.equal(at(first.frames.idle_south_0, 15, 14), 'bp_spare');
  assert.ok(framesEqual(first.frames.idle_south_0, second.frames.idle_south_0), 'rebuilds are deterministic');
  assert.equal(at(first.frames.idle_south_1, 15, 14) === 'bp_spare', false, 'only the keyed frame is touched');
  assert.deepEqual(patch.frames, stored.frames);
  assert.equal(Object.keys(emptyPatch().frames).length, 0, 'appendOps does not mutate its input');
});

test('a mirrored facing is patched independently of its source', () => {
  const patch = appendOps(emptyPatch(), 'idle_east_0', [{op: 'set', pixels: [[16, 14, 'bp_spare']]}]);
  const out = bake(patch);
  assert.equal(at(out.frames.idle_east_0, 16, 14), 'bp_spare');
  assert.ok(framesEqual(out.frames.idle_west_0, bake().frames.idle_west_0));
});

test('the south-face repair turns a failing feature gate into a passing one, and survives a rebuild', () => {
  const marten = loadMarten();
  const rig = structuredClone(marten.rig);
  rig.facings.south.features = [southFeature];
  const bakeMarten = patch => bakeRig({rig, native: marten.imported, library: marten.bakeoffLibrary, profile: marten.pet, profileName: 'pet', palette: marten.palette, clips: ['idle'], patch});
  const run = result => qaBake(result, {rig, palette: marten.palette, options: {weightTransfer: false}});
  const before = run(bakeMarten());
  assert.deepEqual(before.findings.map(f => f.gate), Array(4).fill('feature_contrast'));
  assert.deepEqual(before.findings.map(f => [f.facing, f.frame, f.measured, f.limit]), [0, 1, 2, 3].map(i => ['south', i, 1, 4]));
  const after = run(bakeMarten(southFacePatch));
  assert.deepEqual(after.findings, []);
  assert.deepEqual(run(bakeMarten(JSON.parse(JSON.stringify(southFacePatch)))).findings, [], 'rebuild from stored data');
});
