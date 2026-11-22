import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadPackSync, parsePalette } from '../pack.mjs';
import { checkPixels, gateOptions } from '../gates.mjs';
import { findDefects, findDefectsInPng } from '../defects.mjs';
import { decodeRgba, encodePixels } from '../png.mjs';
import { root } from './helpers.mjs';

const pack = loadPackSync(root, undefined, {verifyFiles: false});
const palette = parsePalette(JSON.parse(fs.readFileSync(path.join(root, pack.palette.file), 'utf8')));
const options = gateOptions(pack, palette);
const OUT = options.outline, INK2 = parsePalette(JSON.parse(fs.readFileSync(path.join(root, pack.palette.file), 'utf8'))).colors;
const other = [...INK2].find(c => c !== OUT);

function image(width, height, paint) {
  const pixels = Buffer.alloc(width * height * 4);
  const set = (x, y, color, alpha = 255) => {
    const k = (y * width + x) * 4;
    pixels[k] = color >> 16 & 255; pixels[k + 1] = color >> 8 & 255; pixels[k + 2] = color & 255; pixels[k + 3] = alpha;
  };
  paint(set);
  return {width, height, pixels};
}
// 8x8 body in `other`, ringed by the outline, on a 10x10 canvas (corners are a small share of the edge).
const W = 10;
const clean = () => image(W, W, set => {
  for (let y = 1; y <= 8; y++) for (let x = 1; x <= 8; x++) set(x, y, (x === 1 || x === 8 || y === 1 || y === 8) ? OUT : other);
});
const idx = (x, y) => (y * W + x) * 4;

test('a clean frame has no defects', () => {
  const r = findDefects(clean(), options);
  assert.deepEqual(r.defects, []);
  assert.deepEqual(r.counts, {});
});

test('every defect class is reported with exact coordinates', () => {
  const img = clean();
  const k = idx;
  img.pixels[k(2, 2) + 3] = 128;                                   // partial alpha at (2,2)
  img.pixels.writeUIntBE(0x010203, k(3, 3), 3);                     // off palette at (3,3)
  img.pixels.writeUIntBE(other, k(1, 2), 3);                        // outline gap at (1,2): an edge pixel that is not outline
  img.pixels[k(0, 0)] = 9;                                          // dirty transparent at (0,0)
  const r = findDefects(img, options);
  const at = code => r.defects.filter(d => d.code === code).map(d => [d.x, d.y]);
  assert.deepEqual(at('partial_alpha'), [[2, 2]]);
  assert.deepEqual(at('off_palette'), [[3, 3]]);
  assert.deepEqual(at('outline_gap'), [[1, 2]]);
  assert.deepEqual(at('dirty_transparent'), [[0, 0]]);
  assert.equal(r.defects.find(d => d.code === 'off_palette').color, '#010203');
  assert.equal(r.counts.outline_gap, 1);
});

test('an empty frame is one defect; dirtyTransparent can be lowered or ignored', () => {
  const empty = image(4, 4, () => {});
  assert.deepEqual(findDefects(empty, options).defects.map(d => d.code), ['empty_frame']);
  const dirty = image(W, W, () => {}); dirty.pixels[0] = 5;
  assert.equal(findDefects(dirty, {...options, dirtyTransparent: 'warn'}).defects.find(d => d.code === 'dirty_transparent').severity, 'warn');
  assert.equal(findDefects(dirty, {...options, dirtyTransparent: 'ignore'}).defects.some(d => d.code === 'dirty_transparent'), false);
});

test('counts are exact and coordinates are capped per code', () => {
  const noisy = image(16, 16, set => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(x, y, 0x010101); });
  const r = findDefects(noisy, {...options, maxPerCode: 10});
  assert.equal(r.counts.off_palette, 256);
  assert.equal(r.defects.filter(d => d.code === 'off_palette').length, 10);
  assert.deepEqual(r.truncated.includes('off_palette'), true);
});

test('thick outline is a warning only when a quarter of the edge is backed by outline', () => {
  const thickImg = image(8, 8, set => { for (let y = 1; y <= 6; y++) for (let x = 1; x <= 6; x++) set(x, y, OUT); });
  const r = findDefects(thickImg, options);
  assert.ok(r.defects.some(d => d.code === 'outline_thick' && d.severity === 'warn'));
  assert.equal(r.defects.some(d => d.severity === 'error'), false);
  assert.equal(findDefects(clean(), options).counts.outline_thick, undefined);
});

test('unreadable bytes are a defect, not an exception', () => {
  const r = findDefectsInPng(Buffer.from('not a png'), options);
  assert.equal(r.image, null);
  assert.equal(r.counts.unreadable, 1);
  assert.match(r.unreadable, /not a PNG/);
});

// The coordinate finder and the message gate must reach the same verdict on every kind of frame.
test('agrees with gates.mjs: errors present exactly when an error defect is present', () => {
  const variants = [clean()];
  let v = clean(); v.pixels[(2 * 6 + 2) * 4 + 3] = 100; variants.push(v);
  v = clean(); v.pixels.writeUIntBE(0x0a0b0c, idx(3, 3), 3); variants.push(v);
  v = clean(); v.pixels.writeUIntBE(other, idx(1, 2), 3); variants.push(v);
  variants.push(image(W, W, () => {}));
  variants.push(image(8, 8, set => { for (let y = 1; y <= 6; y++) for (let x = 1; x <= 6; x++) set(x, y, OUT); }));
  for (const img of variants) {
    const gate = checkPixels(img, options);
    const found = findDefects(img, {...options, dirtyTransparent: 'ignore'});
    assert.equal(found.defects.some(d => d.severity === 'error'), gate.errors.length > 0, JSON.stringify(gate));
    assert.equal(found.defects.some(d => d.severity === 'warn'), gate.warnings.length > 0, JSON.stringify(gate));
  }
});

test('agrees with gates.mjs on real shipped frames (all clean) and on a sample of damaged copies', () => {
  const dir = path.join(root, 'assets/processed_longtime/lt_ash_bow');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).slice(0, 4);
  assert.ok(files.length);
  for (const f of files) {
    const img = decodeRgba(fs.readFileSync(path.join(dir, f)));
    const gate = checkPixels(img, options);
    const found = findDefects(img, options);
    assert.equal(found.defects.some(d => d.severity === 'error'), gate.errors.length > 0, f);
    const damaged = {...img, pixels: Buffer.from(img.pixels)};
    const first = [...Array(img.width * img.height).keys()].find(i => damaged.pixels[i * 4 + 3] === 255);
    damaged.pixels[first * 4 + 3] = 77;
    assert.equal(findDefects(damaged, options).counts.partial_alpha, 1);
    assert.ok(checkPixels(damaged, options).errors.length > 0);
  }
});

test('png round trip keeps coordinates', () => {
  const img = clean(); img.pixels[idx(2, 1) + 3] = 40;
  const r = findDefectsInPng(encodePixels(W, W, img.pixels), options);
  assert.deepEqual(r.defects.filter(d => d.code === 'partial_alpha').map(d => [d.x, d.y]), [[2, 1]]);
});
