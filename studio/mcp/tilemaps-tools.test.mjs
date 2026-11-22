// F5 through the tools and the Objects tab: tile animation and collision shapes set with studio_metadata_set on a real tileset asset,
// refused with reasons, listed by the tab's route. (The exports are tested in core/tests/tilemaps.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../ui/tabs/objects/server.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connect, makeProject, REPO } from './testkit.mjs';

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

test('OBJECTS-011: patching one field of a tile keeps the other; null clears just that field', () => withProject(async p => {
  const a = connect(p.root);
  const r = await a.ok('studio_metadata_set', {assetId: TILESET, tiles});
  const shapes = [{kind: 'point', x: 4, y: 4}];
  const next = await a.ok('studio_metadata_set', {assetId: TILESET, etag: r.etag, tiles: {floor: {0: {shapes}}}});
  assert.deepEqual(next.metadata.tiles.floor[0], {animation: tiles.floor[0].animation, shapes}, 'the animation survives a shapes patch');
  const noAnim = await a.ok('studio_metadata_set', {assetId: TILESET, etag: next.etag, tiles: {floor: {0: {animation: null}}}});
  assert.deepEqual(noAnim.metadata.tiles.floor[0], {shapes});
  const gone = await a.ok('studio_metadata_set', {assetId: TILESET, etag: noAnim.etag, tiles: {floor: {0: {shapes: null}}}});
  assert.equal(gone.metadata.tiles.floor[0], undefined, 'a tile with neither field is dropped');
}));

test('OBJECTS-011 ATLAS-040: a shipped tileset takes tile data, and it reaches the Tiled export through the metadata', async () => {
  const {atlasSets} = await import('../core/atlas-sets.mjs');
  const {describeShipped} = await import('../core/export/run.mjs');
  const {formats} = await import('../core/export/index.mjs');
  const {decodeRgba} = await import('../core/png.mjs');
  const p = makeProject({git: false, extraDirs: ['assets/processed_longtime/lt_abode_stone']});
  try {
    const a = connect(p.root);
    const {milestones, isShipped} = await import('../core/assets.mjs');
    const snap = await a.project.workspace.snapshot();
    assert.equal(isShipped(await milestones(p.root, snap.index.assets.get(TILESET))), true, 'the fixture asset has processed frames');
    const anim = await a.ok('studio_metadata_set', {assetId: TILESET, tiles: {floor: {0: {animation: [{n: 0, ms: 100}, {n: 1, ms: 200}], shapes: [{kind: 'rect', x: 0, y: 0, w: 16, h: 8, properties: {solid: true}}]}}}});
    assert.ok(anim.ok);
    const refused = await a.call('studio_metadata_set', {assetId: TILESET, etag: anim.etag, pivot: [1, 1]});
    assert.match(text(refused), /processed or packed/, 'everything else is still refused once shipped');
    const pack = snap.pack, index = snap.index;
    const set = atlasSets(pack).find(s => s.id === 'longtime');
    const {desc, pages} = await describeShipped(a.project.workspace.root, pack, index, set, 'mobile', 'abode');
    const ts = desc.tilesets.find(t => t.asset === TILESET);
    assert.ok(ts, 'the shipped atlas holds the tileset');
    const built = await formats.find(f => f.id === 'tiled').build(desc, {name: desc.name, readPage: async i => decodeRgba(await fs.readFile(path.join(a.project.workspace.root, pages.find(q => q.index === i).png)))});
    const tsj = JSON.parse(built.files.find(f => f.name === `tiled/${TILESET}.floor.tsj`).data);
    const id = ts.tiles.find(t => t.n === 0).id;
    assert.deepEqual(tsj.tiles.find(t => t.id === id).animation.map(s => s.duration), [100, 200]);
    assert.equal(tsj.tiles.find(t => t.id === id).objectgroup.objects[0].properties[0].name, 'solid');
  } finally { await p.cleanup(); }
  void REPO;
});
