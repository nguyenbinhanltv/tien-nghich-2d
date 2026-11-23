// Ground contact, the foot alignment after pixelisation, and the drawn-clip limits on the two committed walk fixtures:
// the Codex retest walk as it left the pipeline (unpatched: hold on, no patches) and after the patches that cleared its gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignGround, bakePoseClip, createImage, drawnDefaults, groundContact, groundContactGate, groundRow, groundTarget, identityDrift, readFrame, runGates, setPixel } from '../index.mjs';
import { unitsFromFlatDir } from '../gates/calibrate.mjs';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const INK = [20, 16, 26];
const pivot = [16, 29];
// A 32x32 frame with a 6x8 body whose lowest row is `bottom`, plus an optional lifted block.
const figure = (bottom, {top = bottom - 7} = {}) => {
  const f = createImage(32, 32);
  for (let y = top; y <= bottom; y++) for (let x = 13; x < 19; x++) setPixel(f, x, y, y === bottom || x === 13 || x === 18 ? INK : [150, 120, 90]);
  return f;
};
const ctx = {palette: {outline: INK}, pivot};
const unit = frames => ({clip: 'walk', facing: 'south', loop: true, frames, contacts: frames.map(() => [])});

test('the ground contact is the lowest opaque row and its columns; the target is the pivot row minus 2', () => {
  assert.equal(groundRow(figure(24)), 24);
  assert.deepEqual(groundContact(figure(24)), {row: 24, xs: [13, 14, 15, 16, 17, 18]});
  assert.equal(groundRow(createImage(32, 32)), -1);
  assert.equal(groundTarget(pivot), 27);
});

test('alignGround moves a whole clip by one offset (the median contact), keeps a one-key bounce, and records what it did', () => {
  const frames = [figure(24), figure(24), figure(23), figure(24)];
  const out = alignGround(frames, {pivot});
  assert.equal(out.applied, true);
  assert.equal(out.dy, 3);
  assert.deepEqual(out.rows, [24, 24, 23, 24]);
  assert.deepEqual(out.rowsAfter, [27, 27, 26, 27]);
  assert.deepEqual(out.frames.map(groundRow), [27, 27, 26, 27]);
  assert.equal(groundRow(frames[0]), 24, 'the input frames are not changed');
  assert.equal(alignGround([figure(27), figure(27)], {pivot}).applied, false, 'already on the row: nothing moves');
  assert.equal(alignGround([figure(27)], {pivot}).dy, 0);
});

test('alignGround refuses to move a figure off the canvas or by more than maxShift, and says why', () => {
  const tall = alignGround([figure(30, {top: 1})], {pivot});
  assert.equal(tall.applied, false);
  assert.match(tall.reason, /off the canvas/);
  const far = alignGround([figure(10)], {pivot});
  assert.equal(far.applied, false);
  assert.match(far.reason, /larger than maxShift 8/);
  assert.equal(alignGround([createImage(32, 32)], {pivot}).reason, 'every frame is empty');
  assert.equal(alignGround([figure(24)], {pivot, inset: 1}).dy, 4, 'the inset is configurable');
});

test('the gate is an error beyond 1 px from the ground row, with the row found and the offset that fixes the clip', () => {
  assert.deepEqual(groundContactGate(unit([figure(26), figure(27), figure(28)]), ctx), [], 'within 1 px of the row is fine (the shipped range is 26 to 28)');
  const found = groundContactGate(unit([figure(24), figure(24), figure(24)]), ctx);
  assert.equal(found.length, 3);
  assert.deepEqual([found[0].gate, found[0].severity, found[0].measured, found[0].limit], ['ground_contact', 'error', 3, 1]);
  assert.match(found[0].message, /lowest opaque row of key 0 is 24, 3 px above the ground row 27.*shifting the clip by \+3 px/);
  assert.deepEqual(found[0].pixels.slice(0, 2), [[13, 24], [14, 24]]);
  const alone = groundContactGate(unit([figure(27), figure(29), figure(27)]), ctx);
  assert.deepEqual(alone.map(f => f.frame), [1]);
  assert.match(alone[0].message, /this key alone is off/);
  assert.equal(groundContactGate(unit([figure(24)]), {palette: ctx.palette}).length, 0, 'no pivot, no judgement');
  assert.equal(groundContactGate(unit([createImage(32, 32)]), ctx)[0].severity, 'error', 'an empty key has no contact');
  // It runs through runGates only when asked, so a rig clip is untouched by default.
  assert.equal(runGates(unit([figure(24), figure(24), figure(24)]), ctx, {flicker: false}).findings.length, 0);
  assert.equal(runGates(unit([figure(24), figure(24), figure(24)]), ctx, {flicker: false, groundContact: {}}).findings.length, 3);
  assert.equal(runGates(unit([figure(24)]), ctx, {groundContact: {inset: 5}}).findings.length, 0, 'inset 5 puts the row at 24');
});

test('bakePoseClip puts the feet on the pivot row, moves declared contacts and landmarks with them, and ground:false leaves frames alone', () => {
  const frames = [figure(24), figure(24)];
  const cells = new Map(frames.map((f, i) => [`k${i}_south`, {native: f, indexed: f}]));
  const clip = {durationMs: 200, frames: 2};
  const spec = {keys: ['k0', 'k1'], facings: ['south'], contacts: {south: [[{id: 'foot', xy: [14, 24], planted: true}], [{id: 'foot', xy: [14, 24], planted: true}]]},
    landmarks: {south: [{id: 'ear', color: 'x', box: [13, 17, 15, 19]}]}};
  const moved = bakePoseClip({name: 'walk', spec, clip, cells, palette: null, profileName: 'p', canvasWidth: 32, pivot});
  assert.deepEqual(moved.facings.south.frames.map(groundRow), [27, 27]);
  assert.deepEqual(moved.facings.south.ground, {dy: 3, applied: true, target: 27, reference: 24, rowsBefore: [24, 24], rowsAfter: [27, 27]});
  assert.deepEqual(moved.facings.south.contacts[0][0].xy, [14, 27]);
  assert.deepEqual(moved.landmarks.south[0].box, [13, 20, 15, 22]);
  const still = bakePoseClip({name: 'walk', spec: {...spec, ground: false}, clip, cells, palette: null, profileName: 'p', canvasWidth: 32, pivot});
  assert.deepEqual(still.facings.south.frames.map(groundRow), [24, 24]);
  assert.equal(still.facings.south.ground, undefined);
  assert.equal(bakePoseClip({name: 'walk', spec, clip, cells, palette: null, profileName: 'p', canvasWidth: 32}).facings.south.ground, undefined, 'no pivot given: no move');
});

// ---- calibration on the committed walks (the table is in docs/FORGE_BAKEOFF.md, "Drawn-clip gates: calibration")
const load = dir => unitsFromFlatDir(path.join(fixtures, dir), {only: ['walk']});
const numbers = units => units.map(u => {
  const m = identityDrift(u, {palette: ctx.palette}, {maxInteriorChange: null, maxColorShift: null}).metrics;
  const flick = runGates(u, ctx, {flicker: {maxPixels: 0}, footSlide: false, pivotDrift: false, loopSeam: false, markSide: false, featureContrast: false}).findings.filter(f => f.gate === 'flicker');
  return {facing: u.facing, ...m, flicker: Math.max(0, ...flick.map(f => f.measured)), rows: u.frames.map(groundRow)};
});

test('calibration: the limits separate the retest walk after its patches from the same walk before them', () => {
  const clean = numbers(load('ember_courier')), raw = numbers(load('ember_courier_unpatched'));
  assert.equal(clean.length, 4); assert.equal(raw.length, 4);
  const {maxInteriorChange, maxColorShift} = drawnDefaults.identity, {maxPixels} = drawnDefaults.flicker;
  assert.deepEqual([maxInteriorChange, maxColorShift, maxPixels], [0.36, 0.10, 16]);
  for (const n of clean) assert.ok(n.interiorChange < maxInteriorChange && n.colorShift < maxColorShift && n.flicker <= maxPixels, JSON.stringify(n));
  for (const n of raw) assert.ok(n.interiorChange > maxInteriorChange && n.colorShift > maxColorShift && n.flicker > maxPixels, JSON.stringify(n));
  // The numbers in the doc table.
  assert.deepEqual(Object.fromEntries(clean.map(n => [n.facing, [n.interiorChange, n.colorShift, n.flicker]])), {east: [0.13, 0.09, 0], north: [0.315, 0.061, 0], south: [0.146, 0.071, 0], west: [0.093, 0.059, 0]});
  assert.deepEqual(Object.fromEntries(raw.map(n => [n.facing, [n.interiorChange, n.colorShift, n.flicker]])), {east: [0.541, 0.166, 50], north: [0.497, 0.12, 17], south: [0.456, 0.119, 40], west: [0.407, 0.11, 33]});
});

test('calibration: both walks stand 3 px above the ground row; one offset fixes them and the gate then passes', () => {
  for (const dir of ['ember_courier', 'ember_courier_unpatched']) for (const u of load(dir)) {
    assert.deepEqual(u.frames.map(groundRow), [24, 24, 24, 24]);
    assert.equal(groundContactGate(u, ctx).length, 4);
    const fixed = alignGround(u.frames, {pivot});
    assert.equal(fixed.dy, 3);
    assert.equal(groundContactGate({...u, frames: fixed.frames}, ctx).length, 0);
  }
});

test('the drift defaults are the calibrated ones and the retest walk trips them only before its patches', () => {
  for (const [dir, warns] of [['ember_courier', 0], ['ember_courier_unpatched', 8]]) {
    const found = load(dir).flatMap(u => identityDrift(u, {palette: ctx.palette}).findings);
    assert.ok(warns === 0 ? found.length === 0 : found.length >= warns, `${dir}: ${found.length}`);
    assert.ok(found.every(f => f.severity === 'warn'));
  }
  assert.equal(readFrame(path.join(fixtures, 'ember_courier/walk_south_0.png')).width, 32);
});
