// Fault injection: every gate must stay quiet on a clean bake and name the frame and pixels of a planted defect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bakeRig, loadLibrary, unitOf, gateFacing, applyPatch } from '../../rig/index.mjs';
import * as gates from '../index.mjs';
import { bipedPalette, bipedRig, bipedNative } from '../../rig/tests/fixtures/biped.mjs';
import { loadMarten, root } from '../../rig/tests/fixtures/marten.mjs';

const palette = bipedPalette();
const manifest = JSON.parse(readFileSync(`${root}assets/manifest_longtime.json`, 'utf8'));
const bake = (profileName, clips) => bakeRig({rig: bipedRig, native: bipedNative(palette), library: loadLibrary('biped'), profile: manifest.profiles[profileName], profileName, palette, clips});
const result = bake('player', ['idle', 'walk', 'cast']);
const ctx = facing => ({palette, facing: gateFacing(bipedRig, facing), pivot: bipedRig.pivot, mirrored: Boolean(bipedRig.facings[facing].mirrorOf)});
const clean = (clip, facing) => ({...unitOf(result, clip, facing), frames: [...unitOf(result, clip, facing).frames], contacts: structuredClone(unitOf(result, clip, facing).contacts)});
const patched = (unit, index, ops) => ({...unit, frames: unit.frames.map((f, i) => (i === index ? applyPatch(f, ops, palette) : f))});
const keyed = findings => findings.map(f => [f.gate, f.frame]);

test('clean bakes raise no findings from any gate', () => {
  for (const [clip, facing] of [['idle', 'south'], ['idle', 'west'], ['idle', 'east'], ['walk', 'south'], ['walk', 'north'], ['walk', 'west'], ['walk', 'east']]) {
    const unit = unitOf(result, clip, facing);
    const run = gates.runGates(unit, ctx(facing), {silhouetteContrast: {background: [200, 200, 205]}});
    assert.deepEqual(run.findings, [], `${clip}/${facing}`);
    assert.equal(run.pass, true);
  }
});

test('foot slide: a planted foot that moves between planted keys is reported with both pixels, wrap included', () => {
  const unit = clean('walk', 'south');
  const [i, j] = [0, 1];
  assert.ok(unit.contacts[i][0].planted && unit.contacts[j][0].planted);
  const from = unit.contacts[j][0].xy;
  unit.contacts[j][0].xy = [from[0] + 1, from[1]];
  const found = gates.footSlide(unit);
  assert.deepEqual(keyed(found), [['foot_slide', 0], ['foot_slide', 1]], 'slides into and out of the moved key');
  assert.deepEqual(found[0].pixels, [unit.contacts[0][0].xy, [from[0] + 1, from[1]]]);
  assert.equal(found[0].contact, 'leg_0');
  // The wrap of a loop counts: move the last key's planted foot instead.
  const wrapped = clean('idle', 'south');
  const last = wrapped.frames.length - 1;
  const idx = wrapped.contacts[last].findIndex((c, k) => c.planted && wrapped.contacts[0][k].planted);
  assert.ok(idx >= 0);
  wrapped.contacts[last][idx].xy = [wrapped.contacts[last][idx].xy[0] - 1, wrapped.contacts[last][idx].xy[1]];
  assert.ok(gates.footSlide(wrapped).some(f => f.frame === last && f.frameTo === 0));
  // A one-shot clip has no wrap.
  assert.equal(gates.footSlide({...wrapped, loop: false}).some(f => f.frameTo === 0), false);
});

test('foot slide: a planted contact whose pixel vanished is reported at that pixel', () => {
  const unit = clean('walk', 'south');
  const [x, y] = unit.contacts[0][0].xy;
  const broken = patched(unit, 0, [{op: 'set', pixels: [[x, y, null]]}]);
  const found = gates.footSlide(broken);
  assert.deepEqual(found.map(f => [f.frame, f.pixels[0]]), [[0, [x, y]]]);
});

test('pivot drift: a frame shifted three pixels is reported with the two extreme frames', () => {
  const unit = clean('idle', 'south');
  const shifted = patched(unit, 2, [{op: 'shift', box: [0, 0, 32, 32], dx: 3, dy: 0}]);
  const found = gates.pivotDrift(shifted, ctx('south'));
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].gate, found[0].measured, found[0].limit], ['pivot_drift', 3, 2]);
  assert.deepEqual([found[0].frame, found[0].frameTo].sort(), [0, 2]);
  const column = patched(unit, 1, [{op: 'fill', box: [0, 0, 32, 32], color: null}, {op: 'fill', box: [22, 10, 28, 28], color: 'bp_cloth'}]);
  assert.ok(gates.pivotDrift(column, ctx('south')).some(f => f.frame === 1 && /pivot column 16 is outside the silhouette/.test(f.message)));
});

test('flicker: interior pixels that change for one key and revert are reported with their coordinates', () => {
  const unit = clean('idle', 'south');
  const box = [14, 12, 18, 16];
  const flicked = patched(unit, 1, [{op: 'fill', box, color: 'bp_spare'}]);
  const found = gates.flicker(flicked, ctx('south'));
  assert.equal(found.length, 1);
  assert.equal(found[0].frame, 1);
  assert.ok(found[0].measured > 10 && found[0].measured <= 16);
  for (const [x, y] of found[0].pixels) assert.ok(x >= 14 && x < 18 && y >= 12 && y < 16, `${x},${y}`);
  const small = patched(unit, 1, [{op: 'set', pixels: [[15, 12, 'bp_spare'], [16, 12, 'bp_spare']]}]);
  assert.deepEqual(gates.flicker(small, ctx('south')), [], 'a couple of pixels stay under the allowance');
});

test('loop seam: small steps that never come back make the last-to-first jump the only large change', () => {
  const idle = clean('idle', 'south');
  const step = box => [{op: 'fill', box, color: 'bp_spare'}];
  const drift = [idle.frames[0]];
  const rows = [[14, 12, 18, 13], [14, 13, 18, 14], [14, 14, 18, 15]];
  rows.forEach((_, i) => drift.push(applyPatch(drift[0], rows.slice(0, i + 1).flatMap(step), palette)));
  const unit = {...idle, frames: drift};
  const found = gates.loopSeam(unit, ctx('south'));
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].frame, found[0].frameTo], [3, 0]);
  assert.ok(found[0].measured > found[0].limit);
  assert.deepEqual([...found[0].pixels].sort(), [[14, 12], [14, 13], [14, 14], [15, 12], [15, 13], [15, 14], [16, 12], [16, 13], [16, 14], [17, 12], [17, 13], [17, 14]].sort());
  assert.deepEqual(gates.loopSeam({...unit, loop: false}, ctx('south')), [], 'a one-shot clip has no seam');
  assert.deepEqual(gates.loopSeam(idle, ctx('south')), [], 'the clean idle loops');
});

test('mark side: the badge moved to the other chest is reported as missing and as stray', () => {
  const unit = clean('idle', 'south');
  const wrong = patched(unit, 1, [{op: 'set', pixels: [[18, 13, 'bp_cloth'], [18, 14, 'bp_cloth'], [13, 13, 'bp_badge'], [13, 14, 'bp_badge']]}]);
  const found = gates.markSide(wrong, ctx('south'));
  assert.deepEqual(found.map(f => f.frame), [1, 1]);
  assert.match(found[0].message, /no marker pixel inside its box/);
  assert.deepEqual(found[1].pixels, [[13, 13], [13, 14]]);
  assert.match(found[1].message, /wrong side/);
});

test('mark side: a mark that should be absent in a mirrored facing is reported where it shows', () => {
  const unit = clean('idle', 'east');
  const leaked = patched(unit, 3, [{op: 'set', pixels: [[16, 13, 'bp_badge']]}]);
  const found = gates.markSide(leaked, ctx('east'));
  assert.deepEqual(found.map(f => [f.frame, f.pixels]), [[3, [[16, 13]]]]);
});

test('mark side: the box follows the part it is attached to, mirrored on mirrored facings', () => {
  const unit = clean('walk', 'south');
  const tight = {...ctx('south'), facing: {...ctx('south').facing, landmarks: [{...bipedRig.facings.south.landmarks[0], box: [18, 13, 19, 15]}]}};
  assert.ok(unit.poses.some(p => p.parts.body.dx !== 0), 'the body does shift with the support');
  assert.deepEqual(gates.markSide(unit, tight), [], 'the box moves with the body, so the mark is still inside it');
  const frozen = {...unit, poses: unit.poses.map(() => ({parts: {}, contacts: {}}))};
  assert.ok(gates.markSide(frozen, tight).length > 0, 'without the offset the same frames are judged wrong');
  const west = clean('walk', 'west'), mirrorCtx = {...ctx('west'), mirrored: true};
  assert.ok(gates.markSide(west, mirrorCtx).length > 0, 'a mirrored context negates the offset, which is wrong for an unmirrored facing');
});

test('stability: a colour absent from the reference clip and a stretched silhouette are reported', () => {
  const idle = clean('idle', 'south'), walk = clean('walk', 'south');
  assert.deepEqual(gates.stability({idle, walk}, {palette}, {maxSizeDelta: 0.5, maxNewColors: 0}), []);
  const stray = patched(walk, 2, [{op: 'set', pixels: [[15, 20, 'bp_spare']]}]);
  const found = gates.stability({idle, walk: stray}, {palette}, {maxSizeDelta: 0.5, maxNewColors: 0});
  assert.deepEqual(found.map(f => f.gate), ['stability_palette']);
  assert.deepEqual(found[0].pixels, [[15, 20]]);
  const wide = patched(walk, 4, [{op: 'fill', box: [1, 12, 10, 20], color: 'bp_cloth'}]);
  const proportion = gates.stability({idle, walk: wide}, {palette}, {maxSizeDelta: 0.5, maxNewColors: 0});
  assert.deepEqual(proportion.map(f => [f.gate, f.frame]), [['stability_proportion', 4]]);
});

test('silhouette contrast: a dark outline on a dark ground is reported, on a light ground it is not', () => {
  const unit = clean('idle', 'south');
  const dark = gates.silhouetteContrast(unit, ctx('south'), {...gates.defaultOptions.silhouetteContrast, background: [18, 30, 44]});
  assert.deepEqual(dark.map(f => f.frame), [0, 1, 2, 3]);
  assert.ok(dark[0].pixels.length > 0 && dark[0].measured > 0.5);
  assert.deepEqual(gates.silhouetteContrast(unit, ctx('south'), {...gates.defaultOptions.silhouetteContrast, background: [220, 220, 220]}), []);
  assert.ok(gates.contrastRatio([0, 0, 0], [255, 255, 255]) > 20.9);
});

test('feature contrast: a face wiped flat is reported, the original is not', () => {
  const unit = clean('idle', 'south');
  assert.deepEqual(gates.featureContrast(unit, ctx('south')), []);
  const wiped = patched(unit, 2, [{op: 'fill', box: [14, 6, 18, 10], color: 'bp_skin'}]);
  const found = gates.featureContrast(wiped, ctx('south'));
  assert.deepEqual(found.map(f => [f.frame, f.feature, f.measured, f.limit]), [[2, 'face', 0, 2]]);
});

test('weight transfer: stepping contacts under a frozen body plate are reported', () => {
  const unit = clean('walk', 'south');
  assert.deepEqual(gates.weightTransfer(unit, ctx('south')), []);
  const frozen = {...unit, poses: unit.poses.map(p => ({...p, parts: {...p.parts, body: {dx: 0, dy: 0, rotate: 0}}}))};
  const found = gates.weightTransfer(frozen, ctx('south'));
  assert.deepEqual(found.map(f => [f.gate, f.measured, f.limit]), [['weight_transfer', 0, 1]]);
  assert.equal(frozen.metrics.stepping, true);
});

test('runGates aggregates, honours per-gate options and reports pass only when no error remains', () => {
  const unit = patched(clean('idle', 'south'), 1, [{op: 'fill', box: [14, 12, 18, 16], color: 'bp_spare'}]);
  const run = gates.runGates(unit, ctx('south'));
  assert.equal(run.pass, false);
  assert.deepEqual([...new Set(run.findings.map(f => f.gate))], ['flicker']);
  for (const f of run.findings) assert.deepEqual(Object.keys(f).filter(k => ['gate', 'severity', 'clip', 'facing', 'frame', 'pixels', 'message'].includes(k)).sort(), ['clip', 'facing', 'frame', 'gate', 'message', 'pixels', 'severity']);
  assert.equal(gates.runGates(unit, ctx('south'), {flicker: false}).pass, true);
  assert.equal(gates.runGates(unit, ctx('south'), {flicker: {maxPixels: 99}}).pass, true);
});

test('marten: a mark on the wrong ear is caught with the ear box and the stray pixels', () => {
  const marten = loadMarten();
  const out = bakeRig({rig: marten.rig, native: marten.imported, library: marten.bakeoffLibrary, profile: marten.pet, profileName: 'pet', palette: marten.palette, clips: ['idle']});
  const unit = unitOf(out, 'idle', 'south');
  const mctx = {palette: marten.palette, facing: gateFacing(marten.rig, 'south'), pivot: marten.rig.pivot};
  assert.deepEqual(gates.markSide(unit, mctx), []);
  const wrong = {...unit, frames: unit.frames.map((f, i) => (i === 2 ? applyPatch(f, [{op: 'set', pixels: [[19, 14, 'ink_04'], [19, 15, 'ink_04'], [12, 13, 'soul_07'], [12, 14, 'soul_07']]}], marten.palette) : f))};
  const found = gates.markSide(wrong, mctx);
  assert.deepEqual(found.map(f => f.frame), [2, 2]);
  assert.deepEqual(found[1].pixels, [[12, 13], [12, 14]]);
});
