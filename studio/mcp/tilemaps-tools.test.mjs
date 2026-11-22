// F5 through the tools and the Objects tab: tile animation and collision shapes set with studio_metadata_set on a real tileset asset,
// refused with reasons, listed by the tab's route. (The exports are tested in core/tests/tilemaps.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../ui/tabs/objects/server.mjs';
import { connect, makeProject } from './testkit.mjs';

const TILESET = 'lt_abode_stone'; // 16x16 tiles; sheets floor (4), edge (16), wall_cap (4)
const text = r => r.content?.[0]?.text ?? '';
const withProject = async fn => { const p = makeProject({git: false}); try { return await fn(p); } finally { await p.cleanup(); } };
const tiles = {floor: {0: {animation: [{n: 0, ms: 120}, {n: 1, ms: 120}, {n: 2, ms: 240}], shapes: [{kind: 'rect', x: 0, y: 8, w: 16, h: 8, name: 'ledge', properties: {solid: true, damage: 0}}]}, 3: {shapes: [{kind: 'polygon', points: [[0, 0], [16, 0], [0, 16]]}]}}};

test('OBJECTS-011: studio_metadata_set stores tile animation and collision shapes, merges per tile, clears with null, and refuses bad ones', () => withProject(async p => {
  const a = connect(p.root);
  const dry = await a.ok('studio_metadata_set', {assetId: TILESET, tiles, dryRun: true});
  assert.deepEqual(dry.changes.map(c => c.field), ['tiles.floor.0', 'tiles.floor.3']);
  const r = await a.ok('studio_metadata_set', {assetId: TILESET, tiles});
  assert.deepEqual(r.metadata.tiles, tiles);
  const more = await a.ok('studio_metadata_set', {assetId: TILESET, etag: r.etag, tiles: {edge: {5: {shapes: [{kind: 'point', x: 8, y: 8}]}}}});
  assert.deepEqual(Object.keys(more.metadata.tiles).sort(), ['edge', 'floor']);
  assert.deepEqual(more.metadata.tiles.floor, tiles.floor, 'other sheets are kept');
  const cleared = await a.ok('studio_metadata_set', {assetId: TILESET, etag: more.etag, tiles: {floor: {0: null}, edge: null}});
  assert.deepEqual(Object.keys(cleared.metadata.tiles), ['floor']);
  assert.deepEqual(Object.keys(cleared.metadata.tiles.floor), ['3']);
  for (const [bad, re] of [[{floor: {9: {}}}, /tile number/], [{nope: {0: {}}}, /no clip/], [{floor: {0: {animation: [{n: 0, ms: 5}, {n: 1, ms: 0}]}}}, /ms: 1-60000/],
    [{floor: {0: {shapes: [{kind: 'rect', x: 8, y: 8, w: 16, h: 16}]}}}, /inside the 16x16/], [{floor: {0: {shapes: [{kind: 'rect', x: 0, y: 0, w: 4, h: 4, properties: {X: 1}}]}}}, /snake_case/]]) {
    const x = await a.call('studio_metadata_set', {assetId: TILESET, etag: cleared.etag, tiles: bad});
    assert.match(text(x), re);
    assert.ok(x.isError);
  }
}));

test('OBJECTS-011: the Objects tab lists an asset\'s tile data read only, and is empty for an asset with none', () => withProject(async p => {
  const a = connect(p.root);
  await a.ok('studio_metadata_set', {assetId: TILESET, tiles});
  const get = async id => {
    let body;
    await handle({method: 'GET'}, {writeHead() {}, end(t) { body = JSON.parse(t); }}, new URL(`http://127.0.0.1/api/tabs/objects/tiles?id=${id}`), {root: p.root, prefix: '/api/tabs/objects/'});
    return body;
  };
  assert.deepEqual((await get(TILESET)).sheets, tiles);
  assert.deepEqual((await get('lt_mist_archive')).sheets, {});
}));
