import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../../router.mjs';
import { parseRoute, toRoute, filterRoster, sortRoster, resolveSelection, clipFrames, durations, frameAt, rawFor, autoZoom } from './state.mjs';
import { compare, mirrorX, opaqueBounds, markPixels, markSide } from './facing.mjs';

const facings = ['south', 'east', 'north', 'west'];
const detail = {
  clips: {idle: {frames: 2, ms: 160}, run: {frames: 2, ms: null}, ghost: {frames: 1, ms: null}}, defaultFrameMs: 100,
  frames: [['idle', 'south', 0], ['idle', 'south', 1], ['idle', 'west', 0], ['run', 'south', 1], ['run', 'south', 0], ['run', 'east', 0]]
    .map(([clip, direction, n]) => ({clip, direction, n, path: `${clip}_${direction}_${n}.png`})),
  rawFrames: [{clip: 'idle', direction: 'south', n: 1, path: 'raw/idle/south/frame_001.png'}]
};

test('route state round trips through the shell router and drops defaults', () => {
  const hash = '#/characters/lt_ink_marten?clip=follow&dir=west&frame=2&panel=facing&compare=diff&src=bake&onion=1&ov=pivot,hitbox&zoom=6&cat=pet&ready=packed&q=ink&source=longtime';
  const state = parseRoute(parseHash(hash));
  assert.deepEqual([state.id, state.clip, state.direction, state.frame, state.panel, state.compare, state.onion, state.zoom, state.source, state.frames],
    ['lt_ink_marten', 'follow', 'west', 2, 'facing', 'diff', true, 6, 'longtime', 'bake']);
  assert.deepEqual([...state.overlay], ['pivot', 'hitbox']);
  assert.deepEqual(state.filter, {category: 'pet', readiness: 'packed', q: 'ink'});
  assert.deepEqual(parseRoute(parseHash(formatHash(toRoute(state)))), state, 'format then parse gives the same state');
  assert.equal(formatHash(toRoute(parseRoute(parseHash('#/characters/wl_outer_disciple')))), '#/characters/wl_outer_disciple');
});

test('junk in the URL falls back to defaults', () => {
  const state = parseRoute(parseHash('#/characters/x?panel=evil&compare=%3Cb%3E&zoom=99&ov=pivot,nope&onion=yes&src=x'));
  assert.deepEqual([state.panel, state.compare, state.zoom, state.onion, [...state.overlay], state.frames], ['frame', 'processed', null, false, ['pivot'], 'library']);
  assert.deepEqual(parseRoute(parseHash('#/characters')).id, null);
  assert.equal(parseRoute({tab: 'characters', asset: 'Bad Id!', params: {}}).id, null);
});

test('roster filtering and order', () => {
  const people = [{id: 'b_mob', category: 'mob', readiness: 'planned', name: 'Bee', brief: 'buzz'}, {id: 'a_player', category: 'player', readiness: 'packed', name: null},
    {id: 'c_pet', category: 'pet', readiness: 'planned', name: 'Pet', brief: null}];
  assert.deepEqual(filterRoster(people, {readiness: 'planned'}).map(c => c.id), ['b_mob', 'c_pet']);
  assert.deepEqual(filterRoster(people, {q: 'BUZZ'}).map(c => c.id), ['b_mob']);
  assert.deepEqual(filterRoster(people, {category: 'player', q: 'a_'}).map(c => c.id), ['a_player']);
  assert.deepEqual(sortRoster(people, ['player', 'mob', 'boss', 'npc', 'pet']).map(c => c.id), ['a_player', 'b_mob', 'c_pet']);
});

test('the selection always lands on something the character has', () => {
  assert.deepEqual(resolveSelection(detail, {}, facings), {clip: 'idle', direction: 'south', frame: 0, clips: ['idle', 'run'], directions: ['south', 'west']});
  const s = resolveSelection(detail, {clip: 'run', direction: 'east', frame: 0}, facings);
  assert.deepEqual([s.clip, s.direction, s.frame, s.directions], ['run', 'east', 0, ['south', 'east']]);
  assert.equal(resolveSelection(detail, {clip: 'idle', direction: 'west', frame: 9}, facings).frame, 0, 'frame out of range');
  assert.equal(resolveSelection(detail, {clip: 'nope', direction: 'north'}, facings).clip, 'idle');
  assert.deepEqual(resolveSelection({clips: {}, frames: [], rawFrames: []}, {}, facings).clip, null);
  assert.deepEqual(clipFrames(detail, 'run', 'south').map(f => f.n), [0, 1]);
});

test('durations come from the project, or are assumed and say so', () => {
  assert.deepEqual(durations(detail, 'idle', 2), {ms: [160, 160], assumed: false});
  assert.deepEqual(durations(detail, 'run', 3), {ms: [100, 100, 100], assumed: true});
});

test('playback: looping wraps, one-shots hold the last frame', () => {
  const ms = [100, 200, 100];
  assert.deepEqual([0, 99, 100, 299, 300, 399, 400, 500].map(t => frameAt(t, ms)), [0, 0, 1, 1, 2, 2, 0, 1]);
  assert.deepEqual([0, 399, 400, 9999].map(t => frameAt(t, ms, false)), [0, 2, 2, 2]);
  assert.equal(frameAt(5, []), 0);
});

test('raw lookup and zoom', () => {
  assert.equal(rawFor(detail, {clip: 'idle', direction: 'south', n: 1}).path, 'raw/idle/south/frame_001.png');
  assert.equal(rawFor(detail, {clip: 'idle', direction: 'south', n: 0}), null);
  assert.equal(autoZoom(1000, 32), 6);
  assert.equal(autoZoom(100, 64), 1);
  assert.equal(autoZoom(4000, 16), 8);
  for (let w = 100; w < 3000; w += 37) for (const size of [16, 24, 32, 64, 96]) assert.ok([1, 2, 3, 4, 6, 8].includes(autoZoom(w, size)), `auto ${w} ${size}`);
  assert.equal(parseRoute({asset: null, params: {zoom: '5'}}).zoom, null, 'there is no 5x');
  assert.equal(parseRoute({asset: null, params: {zoom: '12'}}).zoom, 12);
  assert.equal(autoZoom(660, 32), 3, 'four 3x cells of 96px plus overhead fit in 660px');
});

const img = (w, h, px) => { const data = new Uint8ClampedArray(w * h * 4); for (const [x, y, r, g, b] of px) data.set([r, g, b, 255], (y * w + x) * 4); return {width: w, height: h, data}; };

test('cross-facing: mirrored copies are identical, separate drawings are not', () => {
  const west = img(4, 2, [[0, 0, 9, 9, 9], [1, 0, 1, 2, 3], [3, 1, 5, 5, 5]]);
  const east = mirrorX(west);
  const same = compare(west, mirrorX(east));
  assert.deepEqual([same.differing, same.verdict, same.opaque], [0, 'identical', 3]);
  const other = img(4, 2, [[0, 0, 9, 9, 9], [1, 0, 7, 7, 7], [2, 1, 5, 5, 5]]);
  const r = compare(west, other);
  assert.deepEqual(r.counts, {same: 1, colour: 1, onlyA: 1, onlyB: 1});
  assert.equal(r.verdict, 'different');
  assert.equal(r.kinds[0], 1, 'same pixel');
  assert.equal(r.kinds[1], 2, 'colour differs');
  assert.equal(r.kinds[7], 3, 'only in A at (3,1)');
  assert.equal(r.kinds[6], 4, 'only in B at (2,1)');
  assert.throws(() => compare(west, img(3, 2, [])), RangeError);
});

test('bounds, marker pixels and the mark-side rule', () => {
  const frame = img(6, 6, [[2, 1, 1, 1, 1], [3, 4, 1, 1, 1], [4, 2, 250, 0, 250]]);
  assert.deepEqual(opaqueBounds(frame), [2, 1, 5, 5]);
  assert.equal(opaqueBounds(img(2, 2, [])), null);
  const marks = markPixels(frame, [250, 0, 250]);
  assert.deepEqual(marks, [[4, 2]]);
  assert.equal(markSide(marks, [[3, 1, 6, 4]]).ok, true);
  assert.equal(markSide(marks, [[0, 0, 2, 2]]).stray.length, 1);
  assert.equal(markSide([], [[0, 0, 2, 2]]).missing, true);
  assert.equal(markSide([], [], true).ok, true);
  assert.equal(markSide(marks, [], true).ok, false);
});
