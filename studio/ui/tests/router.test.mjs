import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash, defaultRoute } from '../router.mjs';
import { destinationIds } from '../destinations.mjs';

test('the shell has the nine destinations in rail order', () => {
  assert.deepEqual(destinationIds, ['overview', 'characters', 'objects', 'vfx', 'audio', 'review', 'jobs', 'sandbox', 'atlas']);
});

test('empty, unknown and malformed hashes fall back to Overview', () => {
  for (const hash of ['', '#', '#/', '#/nope', '#/nope/asset', '#//x', '#/%E0%A4%A']) assert.deepEqual(parseHash(hash), defaultRoute(), hash);
});

test('deep links carry tab, asset, clip, direction and frame', () => {
  const route = parseHash('#/characters/wl_outer_disciple?clip=cast_attack&dir=south&frame=3&source=core&zoom=4');
  assert.deepEqual(route, {tab: 'characters', asset: 'wl_outer_disciple', clip: 'cast_attack', direction: 'south', frame: 3,
    params: {source: 'core', zoom: '4'}});
});

test('round trip is stable and drops state that needs an asset', () => {
  const hash = '#/vfx/hit_spark?clip=burst&frame=0&mode=loop';
  assert.equal(formatHash(parseHash(hash)), hash);
  assert.equal(formatHash(parseHash('#/audio?clip=x&frame=2')), '#/audio');
  assert.equal(formatHash({tab: 'objects', asset: 'a b'}), '#/objects/a%20b');
});

test('invalid frame, clip and direction values are ignored, not trusted', () => {
  const route = parseHash('#/objects/x?frame=-1&dir=SOUTH&clip=a/b');
  assert.deepEqual([route.frame, route.direction, route.clip], [null, null, null]);
  assert.equal(parseHash('#/objects/x?frame=007').frame, null);
  assert.equal(parseHash('#/objects/x?frame=0').frame, 0);
  assert.equal(parseHash('#/objects/<script>').asset, null);
});
