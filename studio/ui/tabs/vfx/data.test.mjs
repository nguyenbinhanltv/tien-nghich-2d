import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSection, coreEffect, designEffect, frameMetrics, checkAcceptance, parseCoreRubric, parseDesignSelfScores, specSummary, diffSummaries, sha256Lf } from './data.mjs';

test('sections normalise from descriptor tags and index tags; bad ones drop', () => {
  assert.deepEqual(normalizeSection({name: 'fade', from: 5, to: 11, repeat: '1'}), {name: 'fade', from: 5, to: 11, kind: 'once', role: null});
  assert.deepEqual(normalizeSection({name: 'loop', from: 16, to: 45}), {name: 'loop', from: 16, to: 45, kind: 'loop', role: 'loop'});
  assert.deepEqual(normalizeSection(['aura', 0, 35, 'loop']), {name: 'aura', from: 0, to: 35, kind: 'loop', role: null});
  assert.equal(normalizeSection({name: 'x', from: 4, to: 2}), null);
});

test('coreEffect keeps per-frame durations, sections and events', () => {
  const e = coreEffect({id: 'fx', frame_size: [32, 32], anchor: [16, 16], loop: false, fps: 30, total_ms: 67, descriptor: 'd.json'},
    {frames: [{key: 'a_0.png', duration_ms: 33}, {key: 'a_1.png', duration_ms: 34}], tags: [{name: 'x', from: 0, to: 1, repeat: '1'}], events: [{frame: 0, name: 'hit'}]}, 'Core', 'packed');
  assert.deepEqual(e.clips[0].ms, [33, 34]); assert.deepEqual(e.clips[0].events, [{name: 'hit', frame: 0}]); assert.deepEqual(e.clips[0].paths[''], ['a_0.png', 'a_1.png']);
});

test('designEffect expands clips x palettes into frame paths and filters events by clip', () => {
  const entry = {id: 'lt', native_px: [32, 32], pivot_px: [16, 16], loop: 'one_shot', chunk_group: 'armory',
    clips: {hit: {n: 2, ms: [33, 40], kind: 'once'}, off: {n: 1, ms: [50], kind: 'once'}}, events: [['hit', 'hit', 0], ['bye', 'off', 0]],
    palettes: {stone: {ramps: ['ink']}, spirit: {ramps: ['soul']}}};
  const have = new Set(['p/hit_stone_0.png', 'p/hit_stone_1.png']);
  const e = designEffect(entry, {sourceLabel: 'L', readiness: 'packed', pathTemplate: 'p/{clip}_{palette}_{n}.png', existing: have});
  assert.deepEqual(e.variants.map(v => v.id), ['stone', 'spirit']);
  assert.deepEqual(e.clips[0].paths.stone, ['p/hit_stone_0.png', 'p/hit_stone_1.png']);
  assert.deepEqual(e.clips[0].paths.spirit, [null, null]); // missing files stay null, never invented
  assert.deepEqual(e.clips[0].events, [{name: 'hit', frame: 0}]); assert.deepEqual(e.clips[1].events, [{name: 'bye', frame: 0}]);
  assert.equal(e.clips[0].totalMs, 73);
});

test('metrics and acceptance checks', () => {
  const px = (w, h, opaque) => { const p = Buffer.alloc(w * h * 4); for (let i = 0; i < opaque; i++) { p[i * 4] = i; p[i * 4 + 3] = 255; } return {width: w, height: h, pixels: p}; };
  const m = frameMetrics([px(10, 10, 10), px(10, 10, 20), px(10, 10, 0)]);
  assert.deepEqual(m.opaquePct, [10, 20, 0]); assert.equal(m.colors, 20);
  const checks = checkAcceptance(m, {first_frame_max_opaque_pct: 20, last_frame_max_opaque_pct: 1, peak_opaque_pct: [8, 22], max_frame_jump_pct: 8, max_colors_per_palette: 6});
  assert.deepEqual(checks.map(c => [c.id, c.pass]), [['first', true], ['last', true], ['peak', true], ['jump', false], ['colors', false]]);
  assert.deepEqual(checkAcceptance(m, null), []);
});

test('rubric and self-score tables parse; family rows fan out', () => {
  const rubric = '## Rubric tự chấm\n\n| VFX | v1 | v4 | audit v1 → v4 |\n|---|---|---|---|\n| hit_spark | 3/7/6/3 | 4/8/8/4 | 1 → 0 |\n| breakthrough_aura ×4 | 3/4/6/2 | 5/7/7/5 | 0-3 → 0 |\n\nafter';
  const r = parseCoreRubric(rubric, ['hit_spark', 'breakthrough_aura_a', 'breakthrough_aura_b', 'other']);
  assert.deepEqual(r.get('hit_spark').v4, {originality: 4, readability: 8, consistency: 8, wow: 4});
  assert.deepEqual(r.get('breakthrough_aura_b').auditErrors, {v1: '0-3', v4: 0}); assert.equal(r.has('other'), false);
  const lt = '### 8.4 Tự chấm\n\n| ID | Đọc | Tổng | Điểm yếu thật |\n|---|---:|---:|---|\n| `lt_fx_impact` | 6 | 5 | a | b |\n';
  assert.deepEqual(parseDesignSelfScores(lt, ['lt_fx_impact']).get('lt_fx_impact'), {readability: 6, overall: 5, weakness: 'a | b'});
});

test('specSummary tags ramp colours with palette ids; diffSummaries reports what changed', () => {
  const ids = new Map([['#aa0000', 'blood_04']]);
  const a = specSummary({ramps: {r: {colors: ['#AA0000', '#010203']}}, phases: [{name: 'p', ticks: 3}], layers: [{id: 'x'}, {id: 'y'}]}, ids);
  assert.deepEqual(a.ramps[0].colors, [{hex: '#aa0000', paletteId: 'blood_04'}, {hex: '#010203', paletteId: null}]);
  const b = specSummary({ramps: {r: {colors: ['#aa0000']}}, phases: [{name: 'p', ticks: 5}], layers: [{id: 'x'}, {id: 'z'}]}, ids);
  const d = diffSummaries(a, b);
  assert.deepEqual([d.ticks, d.layersAdded, d.layersRemoved, d.colorsRemoved, d.same], [[3, 5], ['z'], ['y'], ['#010203'], false]);
  assert.equal(sha256Lf(Buffer.from('a\r\nb')), sha256Lf(Buffer.from('a\nb')));
});
