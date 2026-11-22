// F5 and F6: tile animation and collision shapes in the asset metadata, and the Tiled (.tsj, .tmj) and LDtk (.ldtk) exports parsed back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync } from '../pack.mjs';
import { decodeRgba } from '../png.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { REPO } from '../../mcp/testkit.mjs';
import { atlasSets } from '../atlas-sets.mjs';
import { describeShipped } from '../export/run.mjs';
import { formats } from '../export/index.mjs';
import { attachTileData } from '../export/tiledata.mjs';
import { checkTiles, mergeTiles } from '../tiledata.mjs';
import { tiledObject } from '../export/tiled.mjs';

const pack = loadPackSync(REPO), index = await loadAssetIndex(pack, REPO);
const sets = Object.fromEntries(atlasSets(pack).map(s => [s.id, s]));
const core = await describeShipped(REPO, pack, index, sets.core, 'mobile');
const readPage = async i => decodeRgba(await fs.readFile(path.join(REPO, core.pages.find(p => p.index === i).png)));
const run = async (id, desc) => {
  const built = await formats.find(f => f.id === id).build(desc, {name: desc.name, readPage, pixelsPerUnit: 16});
  return {built, json: name => JSON.parse(built.files.find(x => x.name === name).data)};
};
/** The real core description with animation and shapes put on its first tileset, the way attachTileData does from metadata. */
const withData = () => {
  const desc = structuredClone(core.desc);
  const ts = desc.tilesets[0];
  ts.tiles[0].animation = [{tileId: 0, ms: 120}, {tileId: 1, ms: 80}];
  ts.tiles[1].shapes = [{kind: 'rect', x: 0, y: 8, w: 16, h: 8, name: 'floor', properties: {solid: true, friction: 0.5, kind: 'ice'}}, {kind: 'polygon', points: [[0, 0], [16, 0], [0, 16]]}, {kind: 'point', x: 8, y: 8}, {kind: 'ellipse', x: 2, y: 2, w: 4, h: 4}];
  return {desc, ts};
};

test('OBJECTS-011: tile animation and collision shapes are validated against the tile size and the sheet', () => {
  const asset = {id: 'a', size: [16, 16], clips: {sheet: {frames: 4}}};
  const ok = {sheet: {0: {animation: [{n: 0, ms: 100}, {n: 1, ms: 100}], shapes: [{kind: 'rect', x: 0, y: 0, w: 16, h: 16, properties: {solid: true}}]}}};
  checkTiles(asset, ok);
  const bad = (tiles, re) => assert.throws(() => checkTiles(asset, tiles), re);
  bad({nope: {}}, /no clip/);
  bad({sheet: {9: {}}}, /tile number/);
  bad({sheet: {0: {animation: [{n: 0, ms: 100}]}}}, /2 to/);
  bad({sheet: {0: {animation: [{n: 0, ms: 100}, {n: 7, ms: 100}]}}}, /n: 0-3/);
  bad({sheet: {0: {shapes: [{kind: 'rect', x: 10, y: 0, w: 10, h: 4}]}}}, /inside the 16x16/);
  bad({sheet: {0: {shapes: [{kind: 'polygon', points: [[0, 0], [1, 1]]}]}}}, /3 to/);
  bad({sheet: {0: {shapes: [{kind: 'rect', x: 0, y: 0, w: 4, h: 4, properties: {'Bad Name': 1}}]}}}, /snake_case/);
  bad({sheet: {0: {shapes: [{kind: 'star'}]}}}, /kind must be/);
  const merged = mergeTiles(ok, {sheet: {0: null}});
  assert.equal(merged, undefined, 'clearing the last tile drops the sheet');
  assert.deepEqual(mergeTiles(ok, {sheet: {1: {shapes: [{kind: 'point', x: 1, y: 1}]}}}).sheet[0], ok.sheet[0]);
});

test('OBJECTS-011: attachTileData reads the metadata sidecar into the description and drops steps that name missing tiles', async () => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tiles-'));
  try {
    const asset = {layout: {rawDir: 'raw/x'}};
    await fs.mkdir(path.join(root, 'raw/x'), {recursive: true});
    await fs.writeFile(path.join(root, 'raw/x/studio-metadata.json'), JSON.stringify({schema: 'studio.metadata', version: 1, id: 'x', clips: {}, tiles: {sheet: {0: {animation: [{n: 0, ms: 90}, {n: 1, ms: 60}, {n: 3, ms: 60}], shapes: [{kind: 'point', x: 1, y: 1}]}, 1: {animation: [{n: 0, ms: 50}, {n: 9, ms: 50}]}}}}));
    const desc = {tilesets: [{asset: 'x', sheet: 'sheet', tileSize: [16, 16], tiles: [{id: 0, key: 'k0', n: 0}, {id: 1, key: 'k1', n: 1}, {id: 2, key: 'k2', n: 2}]}]};
    await attachTileData(desc, {assets: new Map([['x', asset]])}, root);
    const [t0, t1] = desc.tilesets[0].tiles;
    assert.deepEqual(t0.animation, [{tileId: 0, ms: 90}, {tileId: 1, ms: 60}], 'the step on tile 3 is dropped');
    assert.deepEqual(t0.shapes, [{kind: 'point', x: 1, y: 1}]);
    assert.equal(t1.animation, undefined, 'one step left is no animation');
    assert.equal(desc.tilesets[0].dropped.length, 2);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test('OBJECTS-011 ATLAS-040: Tiled: .tsj carries animations and collision shapes with custom properties, and .tmj lays the sheet out; both parse back', async () => {
  const {desc, ts} = withData();
  const r = await run('tiled', desc);
  const name = `${ts.asset}.${ts.sheet}`;
  const tsj = r.json(`tiled/${name}.tsj`), tmj = r.json(`tiled/${name}.tmj`);
  assert.deepEqual(tsj.tiles[0].animation, [{tileid: 0, duration: 120}, {tileid: 1, duration: 80}]);
  const og = tsj.tiles[1].objectgroup;
  assert.equal(og.type, 'objectgroup');
  assert.deepEqual(og.objects.map(o => o.id), [1, 2, 3, 4], 'object ids are unique');
  const [rect, poly, point, ell] = og.objects;
  assert.deepEqual([rect.x, rect.y, rect.width, rect.height, rect.name], [0, 8, 16, 8, 'floor']);
  assert.deepEqual(rect.properties, [{name: 'solid', type: 'bool', value: true}, {name: 'friction', type: 'float', value: 0.5}, {name: 'kind', type: 'string', value: 'ice'}]);
  assert.deepEqual(poly.polygon, [{x: 0, y: 0}, {x: 16, y: 0}, {x: 0, y: 16}]);
  assert.equal(point.point, true);
  assert.equal(ell.ellipse, true);
  assert.ok(!('animation' in tsj.tiles[2]) && !('objectgroup' in tsj.tiles[2]));
  assert.deepEqual([tmj.type, tmj.orientation, tmj.tilewidth, tmj.tileheight, tmj.width, tmj.height], ['map', 'orthogonal', ts.tileSize[0], ts.tileSize[1], tsj.columns, Math.ceil(ts.tiles.length / tsj.columns)]);
  assert.deepEqual(tmj.tilesets, [{firstgid: 1, source: `${name}.tsj`}]);
  const layer = tmj.layers[0];
  assert.equal(layer.data.length, tmj.width * tmj.height);
  assert.deepEqual(layer.data.slice(0, ts.tiles.length), ts.tiles.map(t => t.id + 1));
  assert.ok(layer.data.slice(ts.tiles.length).every(g => g === 0));
  assert.ok(r.built.notes.some(n => /1 tile animation\(s\).*1 tile\(s\) carry collision/.test(n)));
  assert.equal(tiledObject({kind: 'polygon', points: [[2, 2], [4, 2], [2, 4]]}, () => 7).x, 2, 'polygon points are relative to the first point');
});

test('OBJECTS-011 ATLAS-040: LDtk: tileset and entity definitions have every required field, point at the files written, and carry tile data as customData', async () => {
  const {desc, ts} = withData();
  const r = await run('ldtk', desc);
  const file = r.built.files.find(f => f.name.endsWith('.ldtk'));
  const doc = JSON.parse(file.data);
  for (const k of ['bgColor', 'defs', 'externalLevels', 'iid', 'jsonVersion', 'levels', 'toc', 'worlds', 'appBuildId', 'backupLimit', 'backupOnSave', 'customCommands', 'defaultEntityHeight', 'defaultEntityWidth', 'defaultGridSize',
    'defaultLevelBgColor', 'defaultPivotX', 'defaultPivotY', 'dummyWorldIid', 'exportLevelBg', 'exportTiled', 'flags', 'identifierStyle', 'imageExportMode', 'levelNamePattern', 'minifyJson', 'nextUid', 'simplifiedExport']) assert.ok(k in doc, `root ${k}`);
  assert.equal(doc.jsonVersion, '1.5.3');
  assert.deepEqual(Object.keys(doc.defs).sort(), ['entities', 'enums', 'externalEnums', 'layers', 'levelFields', 'tilesets']);
  const tsReq = ['__cHei', '__cWid', 'customData', 'enumTags', 'identifier', 'padding', 'pxHei', 'pxWid', 'spacing', 'tags', 'tileGridSize', 'uid', 'savedSelections'];
  const enReq = ['color', 'height', 'identifier', 'nineSliceBorders', 'pivotX', 'pivotY', 'tileRenderMode', 'uid', 'width', 'allowOutOfBounds', 'exportToToc', 'fieldDefs', 'fillOpacity', 'hollow', 'keepAspectRatio', 'limitBehavior', 'limitScope', 'lineOpacity', 'maxCount', 'renderMode', 'resizableX', 'resizableY', 'showName', 'tags', 'tileOpacity'];
  const uids = [...doc.defs.tilesets, ...doc.defs.entities].map(d => d.uid);
  assert.equal(new Set(uids).size, uids.length, 'uids are unique');
  assert.ok(uids.every(u => Number.isInteger(u) && u < doc.nextUid));
  const names = [...doc.defs.tilesets, ...doc.defs.entities].map(d => d.identifier);
  assert.ok(names.every(n => /^[A-Za-z][A-Za-z0-9_]*$/.test(n)), 'identifiers are valid');
  for (const t of doc.defs.tilesets) {
    for (const k of tsReq) assert.ok(k in t, `tileset ${k}`);
    assert.equal(t.__cWid * t.tileGridSize, t.pxWid);
    assert.ok(r.built.files.some(f => f.name === `ldtk/${t.relPath}`) || r.built.copies.some(c => c.name === `ldtk/${t.relPath}`), `${t.relPath} is written`);
  }
  const sheet = doc.defs.tilesets[0];
  assert.deepEqual(sheet.customData.map(c => c.tileId), [0, 1]);
  assert.deepEqual(JSON.parse(sheet.customData[0].data), {animation: [{tileId: 0, ms: 120}, {tileId: 1, ms: 80}]});
  assert.equal(JSON.parse(sheet.customData[1].data).shapes.length, 4);
  assert.ok(doc.defs.entities.length > 20);
  const modes = {tileRenderMode: ['Cover', 'FitInside', 'Repeat', 'Stretch', 'FullSizeCropped', 'FullSizeUncropped', 'NineSlice'], renderMode: ['Rectangle', 'Ellipse', 'Tile', 'Cross'], limitScope: ['PerLayer', 'PerLevel', 'PerWorld'], limitBehavior: ['DiscardOldOnes', 'PreventAdding', 'MoveLastOne']};
  for (const e of doc.defs.entities) {
    for (const k of enReq) assert.ok(k in e, `entity ${k}`);
    for (const [k, allowed] of Object.entries(modes)) assert.ok(allowed.includes(e[k]), `${k} ${e[k]}`);
    const page = doc.defs.tilesets.find(t => t.uid === e.tileRect.tilesetUid);
    assert.ok(page, 'the tile rect names a tileset definition');
    assert.ok(e.tileRect.x + e.tileRect.w <= page.pxWid && e.tileRect.y + e.tileRect.h <= page.pxHei);
    assert.deepEqual([e.width, e.height], [e.tileRect.w, e.tileRect.h]);
    assert.match(e.color, /^#[0-9a-f]{6}$/i);
  }
  assert.equal(r.json(r.built.files.find(f => f.name.endsWith('.ldtk')).name).iid, doc.iid);
  assert.deepEqual(JSON.parse((await run('ldtk', desc)).built.files.find(f => f.name.endsWith('.ldtk')).data), doc, 'deterministic');
  void ts;
});
