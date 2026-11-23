import test from 'node:test';
import assert from 'node:assert/strict';
import { pickIdle } from './idle.mjs';

const frame = (clip, direction, n) => ({clip, direction, n, path: `x/${clip}_${direction}_${n}.png`});
const detail = {defaultFrameMs: 120, clips: {walk: {frames: 2}, idle: {frames: 3, ms: 200}}, frames: [
  frame('walk', 'south', 0), frame('walk', 'south', 1), frame('idle', 'east', 1), frame('idle', 'east', 0), frame('idle', 'south', 0), frame('idle', 'south', 2), frame('idle', 'south', 1)]};

test('pickIdle prefers the idle clip and the south facing, frames in order', () => {
  const p = pickIdle(detail, ['south', 'east']);
  assert.equal(p.clip, 'idle'); assert.equal(p.direction, 'south');
  assert.deepEqual(p.paths, ['x/idle_south_0.png', 'x/idle_south_1.png', 'x/idle_south_2.png']);
  assert.deepEqual(p.ms, [200, 200, 200]);
});
test('pickIdle falls back to the first clip and the default duration', () => {
  const p = pickIdle({...detail, clips: {walk: {frames: 2}}, frames: detail.frames.filter(f => f.clip === 'walk')}, ['south']);
  assert.equal(p.clip, 'walk'); assert.deepEqual(p.ms, [120, 120]);
});
test('pickIdle is null for a still image, nothing, or junk', () => {
  assert.equal(pickIdle({...detail, clips: {idle: {}}, frames: [frame('idle', 'south', 0)]}), null);
  assert.equal(pickIdle({clips: {}, frames: []}), null);
  assert.equal(pickIdle(null), null);
});
test('pickIdle never asks for a frame faster than 40 ms', () => {
  assert.deepEqual(pickIdle({...detail, clips: {idle: {ms: 5}}, frames: detail.frames.filter(f => f.clip === 'idle' && f.direction === 'south')}).ms, [40, 40, 40]);
});
