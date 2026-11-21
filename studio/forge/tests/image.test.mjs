import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage, cloneImage, crop, blit, boxDownscale, thresholdAlpha, snapPalette, rebuildOutline, upscale, boundsOf, roundHalfEven,
  decodePng, encodePng, getPixel, resizeBox, premultiply, unpremultiply, diffImages, imagesEqual, hexToRgb, rgbToHex } from '../image.mjs';

const px = (img, x, y) => [...getPixel(img, x, y)];

test('roundHalfEven ties go to even like Python round()', () => {
  assert.deepEqual([0.5, 1.5, 2.5, -0.5, 2.4, 2.6].map(roundHalfEven), [0, 2, 2, 0, 2, 3]);
});

test('PNG round trip keeps every byte, including colour under alpha 0 being zero after encode of cleared pixels', () => {
  const img = createImage(3, 2);
  img.pixels.set([1, 2, 3, 255, 9, 9, 9, 128, 0, 0, 0, 0], 0);
  assert.ok(imagesEqual(decodePng(encodePng(img)), img));
});

test('crop copies a half-open window and pads outside the source with transparency', () => {
  const img = createImage(4, 4, [10, 20, 30]);
  const c = crop(img, 2, 2, 6, 5);
  assert.deepEqual([c.width, c.height], [4, 3]);
  assert.deepEqual(px(c, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(px(c, 2, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(c, 0, 2), [0, 0, 0, 0]);
  assert.throws(() => crop(img, 2, 2, 2, 3), RangeError);
});

test('blit replaces or composites opaque pixels only, clipped to the destination', () => {
  const src = createImage(2, 2, [200, 0, 0]);
  src.pixels.set([0, 0, 0, 0], 0);
  const dst = createImage(3, 3, [0, 0, 9]);
  blit(dst, src, 2, 2, 'replace');
  assert.deepEqual(px(dst, 2, 2), [0, 0, 0, 0]);
  assert.deepEqual(px(dst, 1, 1), [0, 0, 9, 255]);
  const over = blit(createImage(3, 3, [0, 0, 9]), src, -1, -1, 'opaque');
  assert.deepEqual(px(over, 0, 0), [200, 0, 0, 255]);
  assert.deepEqual(px(over, 1, 1), [0, 0, 9, 255]);
  assert.throws(() => blit(dst, src, 0, 0, 'multiply'), RangeError);
});

test('box downscale averages whole blocks and ignores transparent colour (premultiplied)', () => {
  const img = createImage(4, 2);
  img.pixels.set([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255], 0);
  img.pixels.set([255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0], 16);
  const out = boxDownscale(img, 2, 1);
  assert.deepEqual(px(out, 0, 0), [255, 0, 0, 255]);
  // right block: two blue opaque, two transparent green (colour must not leak): alpha 128, colour stays blue
  assert.deepEqual(px(out, 1, 0), [0, 0, 255, 128]);
  assert.equal(boxDownscale(img, 4, 2).pixels.every((v, i) => v === img.pixels[i] || img.pixels[i - (i % 4) + 3] === 0), true);
});

test('resizeBox averages the input pixels whose centres fall in each output window (Pillow BOX, not fractional area)', () => {
  const img = createImage(3, 1);
  img.pixels.set([0, 0, 0, 255, 90, 90, 90, 255, 180, 180, 180, 255], 0);
  const out = resizeBox(img, 2, 1); // windows of 1.5 inputs centred on 0.75 and 2.25
  assert.deepEqual(px(out, 0, 0), [45, 45, 45, 255]); // pixels 0 and 1, equal weight
  assert.deepEqual(px(out, 1, 0), [180, 180, 180, 255]); // pixel 2 only
});

test('premultiply then unpremultiply is stable at the ends of the alpha range', () => {
  const img = createImage(2, 1);
  img.pixels.set([10, 20, 30, 255, 50, 60, 70, 0], 0);
  assert.deepEqual([...unpremultiply(premultiply(img)).pixels], [10, 20, 30, 255, 0, 0, 0, 0]);
});

test('thresholdAlpha binarises at 128 and zeroes cleared pixels', () => {
  const img = createImage(3, 1);
  img.pixels.set([5, 5, 5, 127, 6, 6, 6, 128, 7, 7, 7, 255], 0);
  assert.deepEqual([...thresholdAlpha(img).pixels], [0, 0, 0, 0, 6, 6, 6, 255, 7, 7, 7, 255]);
});

test('snapPalette picks the nearest colour, first on ties, and leaves transparency alone', () => {
  const img = createImage(3, 1);
  img.pixels.set([10, 10, 10, 255, 128, 128, 128, 255, 99, 99, 99, 0], 0);
  const out = snapPalette(img, [[0, 0, 0], [255, 255, 255], [128, 128, 128]]);
  assert.deepEqual([...out.pixels], [0, 0, 0, 255, 128, 128, 128, 255, 99, 99, 99, 0]);
  const tie = createImage(1, 1, [1, 0, 0]);
  assert.deepEqual(px(snapPalette(tie, [[0, 0, 0], [2, 0, 0]]), 0, 0), [0, 0, 0, 255]);
  assert.throws(() => snapPalette(tie, []), RangeError);
});

test('rebuildOutline inks the 4-neighbour boundary and honours the border rule', () => {
  const img = createImage(5, 5);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) img.pixels.set([50, 60, 70, 255], (y * 5 + x) * 4);
  const out = rebuildOutline(img, [1, 2, 3]);
  assert.deepEqual(px(out, 2, 2), [50, 60, 70, 255]);
  assert.deepEqual(px(out, 1, 1), [1, 2, 3, 255]);
  assert.deepEqual(px(out, 2, 1), [1, 2, 3, 255]);
  const full = createImage(3, 3, [50, 60, 70]);
  assert.deepEqual(px(rebuildOutline(full, [1, 2, 3], {borderIsEdge: true}), 1, 1), [50, 60, 70, 255]);
  assert.deepEqual(px(rebuildOutline(full, [1, 2, 3], {borderIsEdge: true}), 0, 1), [1, 2, 3, 255]);
  assert.deepEqual(px(rebuildOutline(full, [1, 2, 3], {borderIsEdge: false}), 0, 1), [50, 60, 70, 255]);
});

test('boundsOf, upscale and diffImages', () => {
  const img = createImage(4, 4);
  img.pixels.set([1, 1, 1, 255], (1 * 4 + 2) * 4);
  assert.deepEqual(boundsOf(img), [2, 1, 3, 2]);
  assert.equal(boundsOf(createImage(2, 2)), null);
  const up = upscale(img, 3);
  assert.deepEqual([up.width, up.height], [12, 12]);
  assert.deepEqual(boundsOf(up), [6, 3, 9, 6]);
  const other = cloneImage(img);
  other.pixels[0] = 9;
  assert.equal(diffImages(img, other).count, 1);
  assert.equal(diffImages(img, up).count, Infinity);
  assert.deepEqual(hexToRgb('#0a0b0c'), [10, 11, 12]);
  assert.equal(rgbToHex([10, 11, 12]), '#0a0b0c');
});
