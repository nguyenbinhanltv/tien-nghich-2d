import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, fitZoom, stepZoom, hitFrame, reservedRect, fmtBytes, fmtPct, budgetTone, matchFrames, sortFiles, describeDifference, filterLedger, meter, ZOOMS } from './model.mjs';

test('parseRoute is total and keeps only valid values; stateParams round-trips', () => {
  assert.deepEqual(parseRoute(), parseRoute({params: null}));
  const junk = parseRoute({params: {view: 'nope', set: '../x', chunk: 'a b', profile: 5, page: '-3', zoom: '5', key: '<script>', q: 'x'.repeat(200), show: 'x', origin: 'A_B'}});
  assert.deepEqual([junk.view, junk.set, junk.chunk, junk.profile, junk.page, junk.zoom, junk.key, junk.q.length, junk.show, junk.origin], ['atlas', null, null, null, 0, null, null, 64, 'borders', null]);
  const good = parseRoute({params: {view: 'pack', set: 'longtime', chunk: 'abode', profile: 'mobile', page: '2', zoom: '4', key: 'longtime/lt_kiln/idle_south_0', q: 'kiln', lq: 'x', origin: 'generator', show: 'unused'}});
  assert.deepEqual(parseRoute({params: stateParams(good)}), good);
  assert.deepEqual(stateParams(parseRoute({})), {}, 'defaults are not written to the URL');
});

test('zoom is always an integer from the list and fits what is available', () => {
  assert.equal(fitZoom(1024, 900), 1);
  assert.equal(fitZoom(256, 900), 3);
  assert.equal(fitZoom(100, 900), 8);
  assert.equal(fitZoom(5000, 900), 1);
  assert.equal(stepZoom(1, -1), 1);
  assert.equal(stepZoom(8, 1), 8);
  assert.equal(stepZoom(3, 1), 4);
  assert.ok(ZOOMS.every(Number.isInteger));
});

test('hit-testing finds the frame under a pixel and the border reserved around it', () => {
  const frames = [{key: 'a', x: 3, y: 3, w: 10, h: 10}, {key: 'b', x: 17, y: 3, w: 10, h: 10}];
  assert.equal(hitFrame(frames, 3, 3).key, 'a');
  assert.equal(hitFrame(frames, 12, 12).key, 'a');
  assert.equal(hitFrame(frames, 13, 12), null, 'the edge is exclusive');
  assert.equal(hitFrame(frames, 15, 5), null, 'padding belongs to no frame');
  assert.equal(hitFrame(frames, 17, 3).key, 'b');
  assert.deepEqual(reservedRect(frames[0], {padding: 2, extrude: 1}), {x: 0, y: 0, w: 16, h: 16});
});

test('formatting and budget tones', () => {
  assert.deepEqual([fmtBytes(512), fmtBytes(2048), fmtBytes(1048576), fmtBytes(null)], ['512 B', '2 KiB', '1 MiB', '–']);
  assert.deepEqual([fmtPct(0), fmtPct(0.056), fmtPct(0.5)], ['0%', '5.6%', '50%']);
  assert.deepEqual(['ok', 'full', 'over', 'empty', '?'].map(budgetTone), ['good', 'warn', 'bad', 'muted', 'muted']);
  assert.deepEqual([meter(1, 4), meter(9, 4), meter(1, null)], [0.25, 1, null]);
});

test('search matches asset ids and keys, case-insensitively, and nothing for an empty text', () => {
  const frames = [{key: 'longtime/lt_kiln/idle_0', asset: 'lt_kiln'}, {key: 'characters/x/run_0', asset: null}];
  assert.deepEqual(matchFrames(frames, 'KILN').map(f => f.key), ['longtime/lt_kiln/idle_0']);
  assert.equal(matchFrames(frames, 'run').length, 1);
  assert.deepEqual(matchFrames(frames, '  '), []);
});

test('comparison rows: differences first, and each difference described by a string key', () => {
  const files = [{name: 'b.json', status: 'identical'}, {name: 'a.png', status: 'equivalent'}, {name: 'c.png', status: 'differs'}, {name: 'w.webp', status: 'not_produced'}];
  assert.deepEqual(sortFiles(files).map(f => f.name), ['c.png', 'a.png', 'b.json', 'w.webp']);
  assert.deepEqual(describeDifference({status: 'differs', reason: 'pixels', firstDifference: {x: 1, y: 2, staged: [1, 2, 3, 4], shipped: [0, 0, 0, 0]}}), ['diff.pixels', {x: 1, y: 2, staged: '[1,2,3,4]', shipped: '[0,0,0,0]'}]);
  assert.equal(describeDifference({status: 'identical'}), null);
  assert.equal(describeDifference({status: 'equivalent', reason: 'png_bytes', firstDifference: null})?.[0] ?? 'diff.pngBytes', 'diff.pngBytes');
  assert.equal(describeDifference({status: 'differs', reason: 'content', firstDifference: {path: 'frames.a', staged: 1, shipped: 2}})[1].path, 'frames.a');
});

test('ledger filter: by origin and by text over id, source, category, tool, script and producer', () => {
  const rows = [{id: 'a', source: 'core', category: 'prop', origin: {kind: 'generator', script: 'tools/g.py', tool: null, producer: 'Bot'}}, {id: 'b', source: 'core', category: 'mob', origin: {kind: 'not-recorded'}}];
  assert.deepEqual(filterLedger(rows, {origin: 'generator', text: ''}).map(r => r.id), ['a']);
  assert.deepEqual(filterLedger(rows, {text: 'g.py'}).map(r => r.id), ['a']);
  assert.deepEqual(filterLedger(rows, {text: 'mob'}).map(r => r.id), ['b']);
  assert.equal(filterLedger(rows, {}).length, 2);
});

test('ledger gap filter: checked-unknown, planned-only and never-checked rows; the gap survives the URL', () => {
  const rows = [{id: 'a', origin: {kind: 'generator'}, reasons: {toolPin: {status: 'unknown'}}, open: [], planned: false}, {id: 'b', origin: {kind: 'not-recorded'}, reasons: {tool: {status: 'not-produced'}}, open: [], planned: true}, {id: 'c', origin: {kind: 'generator'}, reasons: {}, open: ['seed'], planned: false}];
  const ids = gap => filterLedger(rows, {gap}).map(r => r.id);
  assert.deepEqual([ids(null), ids('unknown'), ids('planned'), ids('open')], [['a', 'b', 'c'], ['a'], ['b'], ['c']]);
  assert.equal(parseRoute({params: {gap: 'nope'}}).gap, null);
  const r = parseRoute({params: {view: 'ledger', gap: 'open'}});
  assert.deepEqual(parseRoute({params: stateParams(r)}), r);
});
