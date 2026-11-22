import test from 'node:test';
import assert from 'node:assert/strict';
import { starterPatch } from './model.mjs';

const empty = {scene: null, actors: [], fx: [], cues: [], bed: null};
const catalog = {characters: [{id: 'c1'}, {id: 'c2'}], effects: [{id: 'e1'}, {id: 'e2'}]};

test('a pristine room with characters and effects starts with the first of each', () => {
  assert.deepEqual(starterPatch(empty, catalog), {actors: ['c1'], fx: ['e1']});
});
test('no effects: the starter has a character only', () => {
  assert.deepEqual(starterPatch(empty, {...catalog, effects: []}), {actors: ['c1'], fx: []});
});
test('no characters: no starter', () => {
  assert.equal(starterPatch(empty, {...catalog, characters: []}), null);
});
test('anything already chosen means no starter', () => {
  for (const patch of [{scene: 'saved'}, {actors: ['x']}, {fx: ['x']}, {cues: ['x']}, {bed: 'x'}]) assert.equal(starterPatch({...empty, ...patch}, catalog), null, JSON.stringify(patch));
});
