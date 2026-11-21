import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { polygonMask, rotateNearest } from '../raster.mjs';

const reference = JSON.parse(readFileSync(new URL('./fixtures/raster-reference.json', import.meta.url), 'utf8'));

test('polygon fill matches Pillow on every marten rig polygon', () => {
  assert.equal(reference.polygons.length, 32);
  reference.polygons.forEach(({points, mask}, i) => {
    const mine = Array.from(polygonMask(32, 32, points), String).join('');
    assert.equal(mine, mask, `polygon ${i} ${JSON.stringify(points)}`);
  });
});

test('nearest rotation about a centre matches Pillow bit for bit', () => {
  for (const {degrees, center, src, out} of reference.rotations) {
    const frame = {width: 32, height: 32, pixels: Buffer.from(src, 'hex')};
    assert.equal(rotateNearest(frame, degrees, center).pixels.toString('hex'), out, `rotate ${degrees} about ${center}`);
  }
});
