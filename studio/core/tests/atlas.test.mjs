import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRgba } from '../png.mjs';
import { packPages, pageBytes, renderPage, writePages } from '../atlas.mjs';

const sprite = (key, w, h, rgb = [255, 0, 0]) => {
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) pixels.set([...rgb, 255], i * 4);
  return {key, image: {width: w, height: h, pixels}};
};
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('packing is deterministic, placements never overlap or leave the page, and every sprite is placed once', () => {
  const sprites = Array.from({length: 40}, (_, i) => sprite(`s/${i}`, 8 + (i * 7) % 20, 8 + (i * 5) % 17));
  const profile = {limit: 64, padding: 2, extrude: 1};
  const a = packPages(sprites, profile), b = packPages([...sprites].reverse(), profile);
  const flat = r => r.pages.map(p => p.placements.map(q => [q.key, q.x, q.y]));
  assert.deepEqual(flat(a), flat(b), 'input order does not matter');
  const all = a.pages.flatMap(p => p.placements);
  assert.equal(all.length, 40);
  assert.equal(new Set(all.map(p => p.key)).size, 40);
  for (const page of a.pages) {
    assert.ok(page.width <= 64 && page.height <= 64);
    for (const p of page.placements) assert.ok(p.x >= 1 && p.y >= 1 && p.x + p.w + 1 <= page.width && p.y + p.h + 1 <= page.height, 'inside, with room for the extrude');
    const cell = p => ({x: p.x - 1, y: p.y - 1, w: p.w + 2, h: p.h + 2}); // the sprite plus its one-pixel extrude
    for (let i = 0; i < page.placements.length; i++) for (let j = i + 1; j < page.placements.length; j++) {
      assert.ok(!overlap(cell(page.placements[i]), cell(page.placements[j])), 'extruded cells do not overlap');
    }
  }
  assert.ok(a.pages.length > 1, 'forty sprites need more than one 64x64 page');
});

test('page size: fixed pages are the limit; otherwise the next power of two of what is used', () => {
  const sprites = [sprite('a', 20, 10), sprite('b', 20, 10)];
  const fixed = packPages(sprites, {limit: 128, fixedSize: true});
  assert.deepEqual([fixed.pages[0].width, fixed.pages[0].height], [128, 128]);
  const tight = packPages(sprites, {limit: 128, padding: 0, extrude: 0});
  assert.deepEqual([tight.pages[0].width, tight.pages[0].height], [64, 16]);
  assert.equal(pageBytes(tight.pages), 64 * 16 * 4);
  assert.equal(pageBytes(fixed.pages, 2), 128 * 128 * 2);
  assert.throws(() => packPages([sprite('big', 200, 8)], {limit: 128}), e => e.code === 'sprite_too_large' && /big is 200x8/.test(e.message));
  assert.throws(() => packPages([sprite('edge', 127, 8)], {limit: 128, extrude: 1}), /sprite|page is 128x128/);
});

test('rendered pages carry the pixels at their placements and extrude the edges', () => {
  const packed = packPages([sprite('red', 4, 4, [255, 0, 0]), sprite('blue', 4, 4, [0, 0, 255])], {limit: 32, padding: 2, extrude: 1});
  const [page] = writePages(packed, packed.profile);
  const image = decodeRgba(page.png);
  const at = (x, y) => [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  for (const p of packed.pages[0].placements) {
    const want = p.key === 'red' ? [255, 0, 0, 255] : [0, 0, 255, 255];
    assert.deepEqual(at(p.x, p.y), want);
    assert.deepEqual(at(p.x + 3, p.y + 3), want);
    assert.deepEqual(at(p.x - 1, p.y), want, 'one pixel of extrude on the left');
    assert.deepEqual(at(p.x + 4, p.y + 3), want, 'and on the right');
    assert.deepEqual(at(p.x, p.y - 1), want, 'and above');
  }
  assert.equal(page.json.frames.red.frame.w, 4);
  assert.equal(page.json.image, 'atlas-0.png');
  assert.equal(page.sha256, writePages(packed, packed.profile)[0].sha256, 'same bytes every time');
  assert.deepEqual(page.json.profile, {limit: 32, padding: 2, extrude: 1, fixedSize: false});
});
