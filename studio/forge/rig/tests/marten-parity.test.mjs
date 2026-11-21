import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bakeRig, qaBake, validateRig, writeBake, readFrame, framesEqual } from '../index.mjs';
import { validateLibrary } from '../../motion/library.mjs';
import { isColor } from '../raster.mjs';
import { convertPrototypeRig } from './fixtures/convert-prototype-rig.mjs';
import { loadMarten, experiment, facings } from './fixtures/marten.mjs';

const marten = loadMarten();
const clips = {idle: [180, 4], follow: [120, 4]};
const bake = native => bakeRig({rig: marten.rig, native, library: marten.bakeoffLibrary, profile: marten.pet, profileName: 'pet', palette: marten.palette});

test('the fixture rig is the prototype rig converted, and both documents validate', () => {
  const prototype = JSON.parse(readFileSync(`${experiment}rig.json`, 'utf8'));
  const {facings: converted} = convertPrototypeRig(prototype, {id: 'lt_ink_marten'});
  // The new format adds only a per-facing maxShift for the tight side views, and a body-following landmark.
  for (const f of facings) {
    const mine = marten.rig.facings[f];
    assert.deepEqual(mine.parts, converted[f].parts);
    assert.deepEqual(mine.landmarks, converted[f].landmarks);
    assert.deepEqual(mine.forward, converted[f].forward);
  }
  assert.deepEqual(validateRig(marten.rig, {palette: marten.palette}), []);
  assert.deepEqual(validateLibrary(marten.bakeoffLibrary), []);
});

test('all 32 bake-off frames are reproduced exactly from the rig and the outline-free import layers', () => {
  const result = bake(marten.imported);
  let compared = 0;
  for (const [clip] of Object.entries(clips)) {
    for (const facing of facings) {
      result.clips[clip].facings[facing].frames.forEach((frame, i) => {
        assert.ok(framesEqual(frame, marten.reference(clip, facing, i)), `${clip}_${facing}_${i}`);
        compared++;
      });
    }
  }
  assert.equal(compared, 32);
});

test('baked frames written to disk decode to the same pixels as the Python bake', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bake-'));
  try {
    const names = writeBake(bake(marten.imported), dir);
    assert.equal(names.length, 32);
    for (const name of names) {
      const [clip, facing, index] = name.replace('.png', '').split('_');
      assert.ok(framesEqual(readFrame(join(dir, name)), marten.reference(clip, facing, Number(index))), name);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('from the outlined native turnaround the bake differs only where the outline hid a fill colour', () => {
  // The outline overwrote the original fill under every boundary pixel, so a part that moves can expose a
  // pixel whose true colour is gone. Those pixels are the only differences, and each is outline ink on one side.
  const result = bake(marten.outlined);
  const ink = marten.palette.outline;
  let exact = 0, differing = 0, pixels = 0;
  for (const clip of Object.keys(clips)) for (const facing of facings) {
    result.clips[clip].facings[facing].frames.forEach((frame, i) => {
      const ref = marten.reference(clip, facing, i);
      if (framesEqual(frame, ref)) { exact++; return; }
      differing++;
      let count = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (frame.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4).equals(ref.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4))) continue;
        count++;
        assert.ok(isColor(frame, x, y, ink) !== isColor(ref, x, y, ink), `${clip}_${facing}_${i} ${x},${y} is not an outline-ink difference`);
        assert.equal(frame.pixels[(y * 32 + x) * 4 + 3], ref.pixels[(y * 32 + x) * 4 + 3], 'silhouettes must agree');
      }
      assert.ok(count <= 8, `${clip}_${facing}_${i} differs by ${count}`);
      pixels += count;
    });
  }
  assert.equal(exact + differing, 32);
  assert.equal(exact, 20);
  assert.equal(pixels, 36);
});

test('contacts and the gate verdict agree with the Python prototype metrics', () => {
  const metrics = JSON.parse(readFileSync(`${experiment}metrics.json`, 'utf8'));
  const result = bake(marten.imported);
  for (const clip of Object.keys(clips)) for (const facing of facings) {
    const reference = metrics.clips[clip].facings[facing];
    assert.deepEqual(result.clips[clip].facings[facing].contacts.map(list => list.map(({xy, planted}) => ({xy, planted}))), reference.forge_paw_contacts);
    assert.equal(reference.forge_animation_gate.pass, true);
  }
  // Same checks as the prototype gate (slide, contact pixels, ear, drift, flicker, seam); the rigid-body check
  // is new in this lane and is judged separately.
  const qa = qaBake(result, {rig: marten.rig, palette: marten.palette, options: {weightTransfer: false}});
  assert.deepEqual(qa.findings, []);
});
