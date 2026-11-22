import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, anchorOffset, frameAt, frameStart, totalMs, pathAt, directionOf, snapshotToScene, isHostPath, isSceneId,
  background, place, upscale, fillImage } from '../scene.mjs';

const good = () => ({schema: 'studio.scene', version: 1, id: 'room-a', room: {size: [96, 80], floor: {kind: 'tile', asset: 'tiles_a'}, wall: {asset: 'tiles_a', rows: 2}},
  camera: {scale: 2},
  actors: [{id: 'hero', asset: 'char_a', clip: 'idle', direction: 'south', at: [48, 64]},
    {id: 'guard', asset: 'char_b', direction: 'auto', at: [10, 10], path: {points: [[10, 10], [60, 10]], speed: 20}}],
  effects: [{id: 'hit', asset: 'fx_a', at: {actor: 'hero', anchor: 'head'}, when: {input: 'click'}}, {id: 'ring', asset: 'fx_b', at: {point: [5, 5]}, when: {time: 300}, loop: true}],
  audio: {bed: 'bed_a', cues: [{id: 'c1', asset: 'cue_a', on: {effect: 'hit'}}, {id: 'c2', asset: 'cue_b', on: {input: 'key:E'}}]}});

test('a complete scene validates and is normalised', () => {
  const r = validateScene(good(), {colors: ['ink_03']});
  assert.deepEqual(r.errors, []);
  assert.equal(r.scene.kind, 'data');
  assert.equal(r.scene.actors[1].path.mode, 'loop');
  assert.deepEqual(r.scene.effects[1].when, {time: 300});
  assert.equal(validateScene({...good(), junk: 1}).scene.junk, undefined);
});

test('every reference and range is checked, with a path to the fault', () => {
  const paths = doc => validateScene(doc, {colors: ['ink_03']}).errors.map(e => e.path);
  assert.ok(paths({...good(), room: {size: [8, 80], floor: {kind: 'flat', color: 'nope_1'}}}).includes('room.size'));
  assert.ok(paths({...good(), room: {size: [96, 80], floor: {kind: 'flat', color: 'nope_1'}}}).includes('room.floor.color'));
  const g = good(); g.effects[0].at.actor = 'ghost';
  assert.ok(paths(g).includes('effects[0].at.actor'));
  const g2 = good(); g2.audio.cues[0].on = {effect: 'ghost'};
  assert.ok(paths(g2).includes('audio.cues[0].on'));
  const g3 = good(); g3.actors[1].id = 'hero';
  assert.ok(paths(g3).includes('actors[1].id'));
  assert.ok(paths({...good(), camera: {scale: 9}}).includes('camera.scale'));
  assert.ok(paths({...good(), schema: 'x'}).includes('schema'));
  assert.ok(paths({...good(), id: '../x'}).includes('id'));
  assert.deepEqual(validateScene(null).errors.length, 1);
  assert.equal(validateScene([]).ok, false);
});

test('a scripted scene needs a same-origin host path and says what stayed code', () => {
  const doc = {schema: 'studio.scene', version: 1, id: 'hosted', kind: 'scripted', room: {size: [64, 64]}, host: {url: '/x/index.html', logic: ['AI']}};
  assert.equal(validateScene(doc).ok, true);
  for (const url of ['//evil.test/x', 'https://evil.test/', '/a/../b', 'x/y', '/a b', '/a\\b', '']) assert.equal(validateScene({...doc, host: {url, logic: []}}).ok, false, url);
  assert.equal(validateScene({...doc, kind: 'data'}).ok, false, 'a host without kind scripted');
  assert.ok(isHostPath('/blood/index.html?x=1#y') && !isHostPath('/..'));
  assert.ok(isSceneId('a-b_1') && !isSceneId('A') && !isSceneId('a/b') && !isSceneId(''));
});

test('frame timing is exact from per-frame durations', () => {
  const ms = [100, 50, 200];
  assert.equal(totalMs(ms), 350);
  const at = t => frameAt(ms, t, {loop: false}).frame;
  assert.deepEqual([0, 99, 100, 149, 150, 349, 350, 9999].map(at), [0, 0, 1, 1, 2, 2, 2, 2]);
  assert.equal(frameAt(ms, 350, {loop: false}).done, true);
  assert.equal(frameAt(ms, 349, {loop: false}).done, false);
  assert.deepEqual([350, 450, 500, 700].map(t => frameAt(ms, t).frame), [0, 1, 2, 0]);
  assert.deepEqual([0, 1, 2].map(n => frameStart(ms, n)), [0, 100, 150]);
  assert.equal(frameAt([0, 0], 1).frame, 1, 'zero durations count as 1 ms');
  assert.deepEqual(frameAt([], 5), {frame: 0, done: true, into: 0});
});

test('anchors match studio_scene_snapshot', () => {
  assert.deepEqual(anchorOffset('feet', [32, 32], [16, 31]), [0, 0]);
  assert.deepEqual(anchorOffset('center', [32, 32], [16, 31]), [0, -15]);
  assert.deepEqual(anchorOffset('head', [32, 32], [16, 31]), [0, -31]);
  assert.deepEqual(anchorOffset({x: 5, y: -7}, [32, 32], [16, 31]), [5, -7]);
});

test('paths: loop, pingpong, once; heading gives the facing', () => {
  const p = {points: [[0, 0], [100, 0]], speed: 100};
  assert.deepEqual(pathAt({...p, mode: 'once'}, 500).at, [50, 0]);
  assert.equal(pathAt({...p, mode: 'once'}, 5000).done, true);
  assert.deepEqual(pathAt({...p, mode: 'pingpong'}, 1500).at, [50, 0]);
  assert.deepEqual(pathAt({...p, mode: 'pingpong'}, 1500).heading, [-100, 0]);
  assert.deepEqual(pathAt({...p, mode: 'loop'}, 1500).at, [50, 0], 'the loop closes back to the start');
  assert.deepEqual(pathAt({points: [[3, 3], [3, 3]], speed: 10, mode: 'once'}, 99), {at: [3, 3], heading: [0, 0], done: true});
  assert.deepEqual([[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].map(([x, y]) => directionOf(x, y)), ['east', 'west', 'south', 'north', null]);
});

test('a snapshot call converts to a valid scene document', () => {
  const args = {assetId: 'char_a', background: {kind: 'tile', tileAsset: 'tiles_a', tileFrame: 't1'}, vfx: {assetId: 'fx_a', anchor: {x: 5, y: -7}, frame: 3}, scale: 4, clip: 'idle', direction: 'east'};
  const doc = snapshotToScene(args, {size: [96, 80], ground: [48, 64]});
  assert.deepEqual(validateScene(doc).errors, []);
  assert.deepEqual(doc.room.floor, {kind: 'tile', asset: 'tiles_a', frame: 't1'});
  assert.deepEqual(doc.effects[0].at, {actor: 'subject', anchor: {x: 5, y: -7}});
  assert.equal(doc.effects[0].frame, 3);
  const flat = snapshotToScene({assetId: 'char_a', background: {kind: 'flat', color: 'jade_02'}}, {size: [96, 80], ground: [48, 64]});
  assert.equal(validateScene(flat).ok, true); assert.equal(flat.camera.scale, 4); assert.deepEqual(flat.effects, []);
  assert.equal(validateScene(snapshotToScene({assetId: 'char_a'}, {size: [96, 80], ground: [48, 64]})).scene.room.floor.kind, 'checker');
});

test('the compositing primitives still behave', () => {
  const room = background(4, 4, {kind: 'flat', rgb: [1, 2, 3]});
  const sprite = fillImage(2, 2, [9, 9, 9]);
  place(room, sprite, [1, 1], [2, 2]);
  assert.deepEqual([...room.pixels.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)], [9, 9, 9, 255]);
  assert.equal(upscale(room, 3).width, 12);
});
