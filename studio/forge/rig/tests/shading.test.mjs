import test from 'node:test';
import assert from 'node:assert/strict';
import { makePalette, createImage, setPixel, getRgb, alphaAt } from '../../image.mjs';
import { applyPatch, validatePatch } from '../patch.mjs';
import { bayer, ditherAt, groupRamp, hueShiftRamp, patternAt, PATTERNS, LIGHTS, lumaOf } from '../../../core/shading.mjs';

// A small made-up palette: two warm-ish groups, a cool group, a gray with no group, and an outline colour.
const colors = [
  { id: 'g1', hex: '#0f3d3a', group: 'green' }, { id: 'g2', hex: '#22795f', group: 'green' }, { id: 'g3', hex: '#5cc796', group: 'green' }, { id: 'g4', hex: '#d2f5de', group: 'green' },
  { id: 'r1', hex: '#2a0a16', group: 'red' }, { id: 'r2', hex: '#7a1426', group: 'red' }, { id: 'r3', hex: '#d03a4a', group: 'red' },
  { id: 'y1', hex: '#6b4a10', group: 'gold' }, { id: 'y2', hex: '#c9922a', group: 'gold' }, { id: 'y3', hex: '#f5d77a', group: 'gold' },
  { id: 'v1', hex: '#2b1f4d', group: 'violet' }, { id: 'v2', hex: '#5b46a0', group: 'violet' },
  { id: 'n1', hex: '#808080', group: null }, { id: 'ink', hex: '#0a0a12', group: null },
];
const pal = makePalette({ colors, outline_id: 'ink' });
const ids = new Set(colors.map((c) => c.id));

function sprite(w = 16, h = 16) {
  const img = createImage(w, h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) setPixel(img, x, y, pal.rgb(['g2', 'r2', 'y2', 'n1'][(x >> 2) % 4]));
  for (let x = 2; x < w - 2; x++) { setPixel(img, x, 2, pal.rgb('ink')); setPixel(img, x, h - 3, pal.rgb('ink')); }
  return img;
}

test('SHADING-001 a hue-shifted ramp is palette-only, never the outline, dark to light', () => {
  for (const base of ['g2', 'r2', 'y2', 'v2']) {
    const ramp = hueShiftRamp(pal.colors, base, { steps: 5, outlineId: 'ink' });
    assert.ok(ramp.length >= 3 && ramp.every((id) => ids.has(id) && id !== 'ink'), `${base}: ${ramp}`);
    const lumas = ramp.map((id) => lumaOf(colors.find((c) => c.id === id).hex));
    assert.deepEqual([...lumas].sort((a, b) => a - b), lumas);
    assert.equal(new Set(ramp).size, ramp.length);
  }
  assert.throws(() => hueShiftRamp(pal.colors, 'nope', { outlineId: 'ink' }), /not a palette colour/);
  assert.throws(() => hueShiftRamp(pal.colors, 'ink', { outlineId: 'ink' }), /not a palette colour/);
  assert.throws(() => hueShiftRamp(pal.colors, 'g2', { steps: 20 }), /2 to 9/);
  assert.deepEqual(groupRamp(pal.colors, 'green', 'ink'), ['g1', 'g2', 'g3', 'g4']);
  assert.deepEqual(hueShiftRamp(pal.colors, 'g2'), hueShiftRamp(pal.colors, 'g2'), 'deterministic');
});

test('SHADING-002 Bayer dithering and patterns are deterministic, tileable and bounded by ratio', () => {
  for (const n of [2, 4, 8]) {
    const seen = new Set();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = bayer(x, y, n); assert.ok(v > 0 && v < 1); seen.add(v); assert.equal(v, bayer(x + n, y + 2 * n, n)); }
    assert.equal(seen.size, n * n, `Bayer ${n} uses every level once`);
    let count = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { assert.equal(ditherAt(x, y, 0, n), false); assert.equal(ditherAt(x, y, 1, n), true); if (ditherAt(x, y, 0.5, n)) count++; }
    assert.equal(count, (n * n) / 2);
  }
  assert.throws(() => bayer(0, 0, 3), /Bayer size/);
  for (const name of PATTERNS) {
    let ones = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = patternAt(name, x, y); assert.ok(v === 0 || v === 1); assert.equal(v, patternAt(name, x, y)); ones += v; }
    assert.ok(ones > 0 && ones < 256, `${name} uses both colours`);
  }
  assert.throws(() => patternAt('plaid', 0, 0), /unknown pattern/);
});

test('SHADING-003 shade moves pixels only along their own group ramp; outline, ungrouped and transparent pixels stay', () => {
  const img = sprite();
  const out = applyPatch(img, [{ op: 'shade', box: [0, 0, 16, 16], light: 'tl' }], pal);
  const groupOf = Object.fromEntries(colors.map((c) => [c.id, c.group]));
  let moved = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    assert.equal(alphaAt(out, x, y), alphaAt(img, x, y));
    if (alphaAt(img, x, y) !== 255) continue;
    const a = pal.idOf(getRgb(img, x, y)), b = pal.idOf(getRgb(out, x, y));
    if (a === 'ink' || groupOf[a] === null) { assert.equal(b, a); continue; }
    assert.equal(groupOf[b], groupOf[a], `${a} -> ${b} stays in its group`);
    if (a !== b) moved++;
  }
  assert.ok(moved > 20);
  // light from the top left: the top-left of a coloured block is lighter than its bottom-right.
  const lum = (img2, x, y) => lumaOf(colors.find((c) => c.id === pal.idOf(getRgb(img2, x, y))).hex);
  assert.ok(lum(out, 3, 4) >= lum(out, 3, 12));
});

test('SHADING-004 no operation can introduce an off-palette colour or change the silhouette', () => {
  const img = sprite();
  const boxes = [[0, 0, 16, 16], [3, 3, 9, 9], [5, 1, 6, 15], [0, 8, 16, 9]];
  const ops = [];
  for (const box of boxes) {
    for (const light of Object.keys(LIGHTS)) { ops.push({ op: 'shade', box, light, strength: 2 }); ops.push({ op: 'gradient', box, base: 'g2', light, steps: 6 }); ops.push({ op: 'gradient', box, base: 'r2', light, dither: false }); }
    for (const size of [2, 4, 8]) for (const ratio of [0, 0.3, 0.5, 1]) ops.push({ op: 'dither', box, from: 'g2', to: 'g3', ratio, size });
    for (const name of PATTERNS) ops.push({ op: 'pattern', box, name, colors: ['y1', 'y3'] }, { op: 'pattern', box, name, colors: ['v1', null] });
  }
  assert.deepEqual(validatePatch({ schema: 'studio.patch', version: 1, frames: { idle_south_0: ops } }, { palette: pal, width: 16, height: 16 }), []);
  for (const op of ops) {
    const out = applyPatch(img, [op], pal);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      assert.equal(alphaAt(out, x, y), alphaAt(img, x, y), `${op.op} keeps the silhouette`);
      if (alphaAt(img, x, y) === 255 && pal.idOf(getRgb(img, x, y)) === 'ink') assert.equal(pal.idOf(getRgb(out, x, y)), 'ink', `${op.op} leaves the outline at ${x},${y}`);
      if (alphaAt(out, x, y) === 255) assert.ok(ids.has(pal.idOf(getRgb(out, x, y))), `${op.op} at ${x},${y} is a palette colour`);
    }
  }
  const chained = applyPatch(img, ops.slice(0, 80), pal);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (alphaAt(chained, x, y) === 255) assert.ok(ids.has(pal.idOf(getRgb(chained, x, y))));
  // over: "all" paints transparent pixels too, still with palette colours only
  const all = applyPatch(createImage(8, 8), [{ op: 'gradient', box: [0, 0, 8, 8], base: 'y2', over: 'all' }, { op: 'pattern', box: [0, 0, 4, 4], name: 'checker', colors: ['r1', 'r3'], over: 'all' }], pal);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { assert.equal(alphaAt(all, x, y), 255); assert.ok(ids.has(pal.idOf(getRgb(all, x, y)))); }
});

test('SHADING-005 the helpers validate their inputs and refuse unknown colours, lights, sizes and patterns', () => {
  const check = (op) => validatePatch({ schema: 'studio.patch', version: 1, frames: { idle_south_0: [op] } }, { palette: pal, width: 16, height: 16 });
  assert.match(check({ op: 'shade', box: [0, 0, 4, 4], light: 'up' })[0], /light/);
  assert.match(check({ op: 'shade', box: [0, 0, 40, 4] })[0], /inside/);
  assert.match(check({ op: 'dither', box: [0, 0, 4, 4], from: 'g2', to: 'zzz', ratio: 0.5 })[0], /unknown palette id/);
  assert.match(check({ op: 'dither', box: [0, 0, 4, 4], from: 'g2', to: 'g3', ratio: 2 })[0], /ratio/);
  assert.match(check({ op: 'dither', box: [0, 0, 4, 4], from: 'g2', to: 'g3', ratio: 0.5, size: 3 })[0], /size/);
  assert.match(check({ op: 'pattern', box: [0, 0, 4, 4], name: 'plaid', colors: ['g1', 'g2'] })[0], /pattern name/);
  assert.match(check({ op: 'pattern', box: [0, 0, 4, 4], name: 'checker', colors: ['g1', '#ff0000'] })[0], /unknown palette id/);
  assert.match(check({ op: 'gradient', box: [0, 0, 4, 4], base: 'ink' })[0], /outline/);
  assert.match(check({ op: 'gradient', box: [0, 0, 4, 4], base: 'g2', steps: 1 })[0], /steps/);
  assert.deepEqual(check({ op: 'gradient', box: [0, 0, 4, 4], base: 'g2' }), []);
});
