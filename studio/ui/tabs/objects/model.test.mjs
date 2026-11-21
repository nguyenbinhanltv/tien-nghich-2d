import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, objectKinds, inScope, applyFilters, facetCounts, framesOf, coverFrame, groupLinks, blobSheets,
  testRoom, autotile, bitmaskMap, nineSlice, clampInsets, hudClipWidth, defaultZoom } from './model.mjs';
import { parseHash } from '../../router.mjs';

test('parseRoute is total and clamps junk', () => {
  assert.doesNotThrow(() => parseRoute());
  assert.doesNotThrow(() => parseRoute({params: {zoom: 'x', ins: '1,2', fill: '999', tool: 'rm -rf', ready: 'nope', seed: '-4'}}));
  const s = parseRoute(parseHash('#/objects/ts_a?clip=floor&frame=3&zoom=99&tool=nine&ins=2,2,3,3&kind=tileset&q=ab&fill=40'));
  assert.deepEqual([s.asset, s.clip, s.frame, s.zoom, s.tool, s.ins, s.kind, s.q, s.fill], ['ts_a', 'floor', 3, defaultZoom, 'nine', [2, 2, 3, 3], 'tileset', 'ab', 40]);
});

test('stateParams round-trips through parseRoute and omits defaults', () => {
  const s = parseRoute({asset: 'a', params: {zoom: '5', tool: 'hud', fill: '30', kind: 'ui', src: 'core', ready: 'packed', chunk: 'wards', q: 'x'}});
  const params = stateParams(s);
  assert.deepEqual(parseRoute({asset: 'a', params}), s);
  assert.deepEqual(stateParams(parseRoute({params: {}})), {});
});

const assets = [
  {id: 'ts_a', category: 'tileset', readiness: 'packed', source: 'core', name: 'Alpha'},
  {id: 'wp_b', category: 'weapon', readiness: 'planned', source: 'longtime', chunk: 'armory', name: 'Bravo'},
  {id: 'pj_b', category: 'projectile', readiness: 'packed', source: 'longtime', chunk: 'armory'},
  {id: 'wp_c', category: 'mob', readiness: 'packed', source: 'core'}
];

test('scope follows the pack mapping and filters combine', () => {
  const kinds = objectKinds({tileset: 'objects', weapon: 'objects', projectile: 'objects', mob: 'characters'});
  assert.deepEqual(kinds, ['tileset', 'weapon', 'projectile']);
  const scoped = inScope(assets, kinds);
  assert.equal(scoped.length, 3);
  const s = parseRoute({params: {src: 'longtime', ready: 'packed'}});
  assert.deepEqual(applyFilters(scoped, s).map(a => a.id), ['pj_b']);
  assert.deepEqual(applyFilters(scoped, parseRoute({params: {q: 'brav'}})).map(a => a.id), ['wp_b']);
  assert.deepEqual(facetCounts(scoped, parseRoute({params: {kind: 'weapon'}})).kind, {tileset: 1, weapon: 1, projectile: 1});
});

test('frames: clip-less sheets take their clip from the file name; durations come from the record', () => {
  const frames = framesOf({clips: {charge: {ms: 120}}, frames: [
    {clip: null, path: 'a/floor_blob47_f0_12.png'}, {clip: null, path: 'a/floor_blob47_f0_2.png'}, {clip: null, path: 'a/odd.png'},
    {clip: 'charge', n: 1, path: 'b/charge_none_1.png'}, {clip: 'charge', n: 0, path: 'b/charge_none_0.png', durationMs: 90}, {clip: 'idle', n: 0, path: 'b/idle.png'}]});
  assert.deepEqual(frames.map(f => [f.clip, f.n, f.ms]), [['charge', 0, 90], ['charge', 1, 120], ['floor_blob47', 2, null], ['floor_blob47', 12, null], ['idle', 0, null]]);
  assert.equal(coverFrame(frames).clip, 'idle');
  assert.equal(coverFrame([]), null);
});

test('links: a shot is the weapon\'s projectile, parents stay parents', () => {
  const byId = new Map([['wp', {category: 'weapon'}], ['shot', {category: 'projectile'}], ['relic', {category: 'weapon'}], ['p1', {category: 'weapon'}], ['fx', {category: 'vfx'}]]);
  assert.deepEqual(groupLinks({usedBy: ['shot', 'relic']}, byId, 'weapon'), {projectile: ['shot'], usedBy: ['relic']});
  assert.deepEqual(groupLinks({builtFrom: ['wp']}, byId, 'projectile'), {weapon: ['wp']});
  assert.deepEqual(groupLinks({builtFrom: ['p1', 'wp']}, byId, 'weapon'), {builtFrom: ['p1', 'wp']});
  assert.deepEqual(groupLinks({effectFor: ['fx'], effects: ['missing']}, byId, 'weapon'), {effectFor: ['fx']});
});

test('47-tile autotiling: border walls, isolated block and mask lookup', () => {
  const map = bitmaskMap(null);
  assert.equal(map.count, 47);
  const g = testRoom(7);
  assert.equal(g.length, 9);
  assert.deepEqual(testRoom(7), g);
  assert.ok(g[0].every(c => c === 1) && g.every(r => r[0] === 1 && r.at(-1) === 1));
  const tiles = autotile(g, 1, map);
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) assert.equal(tiles[y][x] === null, g[y][x] !== 1);
  assert.equal(autotile([[0, 0, 0], [0, 1, 0], [0, 0, 0]], 1, map)[1][1], 0);       // isolated: mask 0 → tile 0
  assert.equal(autotile([[1, 1, 1], [1, 1, 1], [1, 1, 1]], 1, map)[1][1], 46);      // surrounded: mask 255 → tile 46
  assert.deepEqual(blobSheets({sheets: [{id: 'f', tiles: 47}, {id: 'w', tiles: 12}, {id: 'g', tiles: 47}]}, [{clip: 'f'}, {clip: 'w'}]), ['f']);
});

test('nine-slice rectangles tile the destination exactly and keep corners', () => {
  for (const [w, h, dw, dh, ins] of [[32, 40, 96, 120, [8, 8, 8, 8]], [16, 16, 16, 16, [4, 4, 4, 4]], [10, 6, 50, 9, [3, 2, 3, 2]], [8, 8, 30, 30, [9, 9, 9, 9]]]) {
    const rects = nineSlice(w, h, dw, dh, ins);
    const area = rects.reduce((a, r) => a + r[6] * r[7], 0);
    assert.equal(area, dw * dh, `${w}x${h} -> ${dw}x${dh}`);
    const src = rects.reduce((a, r) => a + r[2] * r[3], 0);
    assert.equal(src, w * h);
  }
  const rects = nineSlice(32, 40, 96, 120, [8, 8, 8, 8]);
  assert.deepEqual(rects[0], [0, 0, 8, 8, 0, 0, 8, 8]);
  assert.deepEqual(rects[8], [24, 32, 8, 8, 88, 112, 8, 8]);
  assert.deepEqual(clampInsets([20, 20, 20, 20], 10, 10), [4, 4, 5, 5].map((v, i) => [4, 4, 5, 5][i]));
});

test('HUD clipping keeps the left edge and is monotonic', () => {
  assert.equal(hudClipWidth(64, 0), 0);
  assert.equal(hudClipWidth(64, 100), 64);
  assert.equal(hudClipWidth(64, 50), 32);
  assert.equal(hudClipWidth(64, 150), 64);
  let last = 0;
  for (let f = 0; f <= 100; f++) { const w = hudClipWidth(37, f); assert.ok(w >= last); last = w; }
});
