import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, draftScene, parseActor, formatActor, parseTrigger, actorsAt, effectFrame, effectPosition, startOf, cuesDue, triggeredBy, stepTime,
  sceneForSave, floorOf, floorText, pickDirection } from './model.mjs';
import { validateScene } from '../../../core/scene.mjs';

const route = (params, asset = null) => ({tab: 'sandbox', asset, params});

test('parseRoute is total and clamps junk', () => {
  const s = parseRoute(route({scale: '9', actor: 'a~idle~east,bad id,b', fx: 'x,y z', ov: 'pivot,nope', t: '-4', floor: 'tile:ts_a', w: '5', play: '1'}, 'room-1'));
  assert.equal(s.scene, 'room-1'); assert.equal(s.scale, 2); assert.deepEqual(s.actors, ['a~idle~east', 'b']);
  assert.deepEqual(s.fx, ['x']); assert.deepEqual([...s.ov], ['pivot']); assert.equal(s.t, 0); assert.equal(s.w, 160); assert.equal(s.play, true);
  assert.doesNotThrow(() => parseRoute({})); assert.doesNotThrow(() => parseRoute({params: {actor: 5, ov: {}}}));
  assert.equal(parseRoute(route({}, '../x')).scene, null);
  assert.equal(parseRoute(route({floor: 'tile:../x'})).floor, null);
});

test('state round-trips through the URL, defaults omitted', () => {
  const s = parseRoute(route({}));
  assert.deepEqual(stateParams(s), {});
  const url = {actor: 'a~walk~north,b', fx: 'x', cue: 'c1', anchor: 'feet', fxon: 'key:E', cueon: 'time:300', bed: 'bed_a', scale: '4', floor: 'flat:ink_03', w: '200', h: '90', sel: 'a', ov: 'hitbox,pivot', t: '1200', play: '1', q: 'zz'};
  assert.deepEqual(stateParams(parseRoute(route(url))), {...url, ov: 'hitbox,pivot'});
  assert.deepEqual(parseActor('a~walk~north'), {asset: 'a', clip: 'walk', direction: 'north'});
  assert.equal(formatActor({asset: 'a', direction: 'east'}), 'a~~east'); assert.equal(formatActor({asset: 'a'}), 'a');
  assert.deepEqual(parseTrigger('time:250'), {time: 250}); assert.deepEqual(parseTrigger('key:q'), {input: 'key:q'}); assert.deepEqual(parseTrigger('x'), {input: 'click'});
});

test('a draft URL becomes a valid scene document', () => {
  const state = parseRoute(route({actor: 'hero,hero,guard~idle~east', fx: 'spark', cue: 'ding', anchor: 'feet', floor: 'tile:ts_a', scale: '4', bed: 'bed_a'}));
  const doc = draftScene(state, {color: 'ink_03'});
  assert.deepEqual(validateScene(doc).errors, []);
  assert.deepEqual(doc.actors.map(a => a.id), ['hero', 'hero_2', 'guard']);
  assert.deepEqual(doc.actors.map(a => a.at[0]), [40, 80, 120]);
  assert.deepEqual(doc.effects[0].at, {actor: 'hero', anchor: 'feet'});
  assert.deepEqual(doc.audio, {cues: [{id: 'ding', asset: 'ding', on: {input: 'click'}}], bed: 'bed_a'});
  assert.deepEqual(doc.room.floor, {kind: 'tile', asset: 'ts_a'});
  const empty = draftScene(parseRoute(route({fx: 'spark'})), {color: 'ink_03'});
  assert.deepEqual(empty.effects[0].at, {point: [80, 56]}); assert.deepEqual(empty.room.floor, {kind: 'flat', color: 'ink_03'});
  assert.deepEqual(floorOf('checker:ink_01', 'x'), {kind: 'checker', color: 'ink_01'}); assert.equal(floorText({kind: 'tile', asset: 'a'}), 'tile:a');
  const saved = sceneForSave(doc, 'my-room', 'My room', ['ink_03']);
  assert.equal(saved.ok, true); assert.equal(saved.scene.id, 'my-room'); assert.deepEqual(saved.scene.name, {en: 'My room'});
  assert.equal(sceneForSave(doc, 'My Room', null, null).ok, false);
  assert.equal(sceneForSave(draftScene(parseRoute(route({})), {color: 'ink_03'}), 'e', null, null).scene.audio, undefined);
});

const sprite = (ms, tag) => ({size: [32, 32], pivot: [16, 31], clips: {idle: {south: {ms, frames: ms.map((_, i) => `${tag}_s${i}`)}, east: {ms, frames: ms.map((_, i) => `${tag}_e${i}`)}}}});
test('actors: frame from per-frame durations, facing from a path, clip fallback, missing sprite', () => {
  const scene = {actors: [{id: 'a', asset: 'A', clip: 'idle', direction: 'south', at: [10, 20]},
    {id: 'b', asset: 'A', direction: 'auto', at: [0, 0], path: {points: [[0, 0], [100, 0]], speed: 100, mode: 'once'}},
    {id: 'p', asset: 'A', control: 'player', at: [5, 5]}, {id: 'm', asset: 'ghost', at: [1, 1]}]};
  const sprites = new Map([['A', sprite([100, 50, 200], 'A')]]);
  const at = t => actorsAt(scene, sprites, t, {p: {at: [7, 8], heading: [-1, 0], facing: 'west'}});
  assert.deepEqual([0, 99, 100, 149, 150, 349, 350].map(t => at(t)[0].frame), [0, 0, 1, 1, 2, 2, 0]);
  assert.equal(at(500)[1].direction, 'east'); assert.deepEqual(at(500)[1].at, [50, 0]); assert.equal(at(0)[1].path, 'A_e0');
  assert.deepEqual(at(0)[2].at, [7, 8]); assert.equal(at(0)[2].direction, 'south', 'west is missing: falls back to south');
  assert.equal(pickDirection({south: {}}, 'north'), 'south'); assert.equal(pickDirection({east: {}}, 'north'), 'east');
  assert.equal(at(0)[3].missing, true);
});

test('effects: start by time or input, once ends, loop repeats, pinned frame, position at an anchor', () => {
  const fx = {ms: [30, 30, 40], frames: ['f0', 'f1', 'f2']};
  const once = {id: 'e', when: {input: 'click'}}, timed = {id: 't', when: {time: 200}, loop: true}, pinned = {id: 'p', when: {time: 0}, frame: 5};
  const fired = new Map();
  assert.equal(startOf(once, fired), null); assert.equal(effectFrame(once, fx, startOf(once, fired), 50), null);
  fired.set('e', 1000);
  assert.deepEqual([999, 1000, 1030, 1099, 1100].map(t => effectFrame(once, fx, startOf(once, fired), t)?.frame ?? 'x'), ['x', 0, 1, 2, 'x']);
  assert.deepEqual([199, 200, 230, 260, 300, 330].map(t => effectFrame(timed, fx, 200, t)?.frame ?? 'x'), ['x', 0, 1, 2, 0, 1]);
  assert.equal(effectFrame(pinned, fx, 0, 9).frame, 2, 'clamped to the last frame');
  const placed = actorsAt({actors: [{id: 'a', asset: 'A', at: [50, 60]}]}, new Map([['A', sprite([100], 'A')]]), 0);
  assert.deepEqual(effectPosition({at: {actor: 'a', anchor: 'head'}}, placed), [50, 60 - 31]);
  assert.deepEqual(effectPosition({at: {actor: 'a', anchor: 'feet'}}, placed), [50, 60]);
  assert.deepEqual(effectPosition({at: {point: [3, 4]}}, placed), [3, 4]);
  assert.equal(effectPosition({at: {actor: 'zz', anchor: 'feet'}}, placed), null);
});

test('cues: due by time or by an effect starting, and input triggers', () => {
  const scene = {effects: [{id: 'e', when: {input: 'click'}}, {id: 't', when: {time: 500}}],
    audio: {cues: [{id: 'a', on: {time: 100}}, {id: 'b', on: {effect: 'e'}}, {id: 'c', on: {effect: 't'}}, {id: 'd', on: {input: 'click'}}, {id: 'k', on: {input: 'key:E'}}]}};
  const fired = new Map([['e', 300]]);
  assert.deepEqual(cuesDue(scene, fired, 0, 100), ['a']); assert.deepEqual(cuesDue(scene, fired, 100, 400), ['b']);
  assert.deepEqual(cuesDue(scene, fired, 400, 600), ['c']); assert.deepEqual(cuesDue(scene, fired, 600, 900), []);
  assert.deepEqual(triggeredBy(scene, 'click'), {effects: ['e'], cues: ['d']}); assert.deepEqual(triggeredBy(scene, 'key:E'), {effects: [], cues: ['k']});
});

test('step moves to the next and previous frame boundary, across loops', () => {
  const ms = [100, 50, 200];
  assert.deepEqual([0, 50, 100, 120, 349].map(t => stepTime(ms, t, 1)), [100, 100, 150, 150, 350]);
  assert.deepEqual([350, 399, 400, 100, 120].map(t => stepTime(ms, t, 1)), [450, 450, 450, 150, 150]);
  assert.deepEqual([120, 100, 160, 351].map(t => stepTime(ms, t, -1)), [100, 0, 150, 350]);
  assert.equal(stepTime(ms, 0, -1), 0); assert.equal(stepTime([], 5, 1), 5);
});
