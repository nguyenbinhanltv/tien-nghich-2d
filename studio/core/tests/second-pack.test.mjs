// A second project must work from its own pack file and data, with no code edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../pack.mjs';
import { buildCatalog } from '../catalog.mjs';
import { loadEditableCatalog } from '../editable.mjs';
import { encodePixels } from '../png.mjs';
import { realPack } from './helpers.mjs';

test('a different project pack drives catalog and editable frames', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-second-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true})
    .then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  pack.id = 'other-game';
  pack.palette.file = 'pal.json';
  pack.catalog.sources = [{id: 'main', kind: 'asset-manifest', file: 'm.json'}];
  pack.frameKeys = {hud: 'hud/{id}/{clip}_{n}'};
  pack.editable = {overlay: 'approved.json', groups: [{kind: 'asset-animations', source: 'main', category: 'hud',
    frameKey: 'hud', raw: 'src/{id}_{clip}_{n}.png', processed: 'out/{key}.png'}]};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}, {hex: '#ffffff'}]}));
  await write('m.json', JSON.stringify({assets: [{id: 'btn', category: 'hud', size: [2, 2], output_path: 'src/', animations: {idle: {frames: 1}}},
    {id: 'orb', category: 'misc', size: [2, 2], output_path: 'src/', animations: {}}]}));
  const pixels = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) pixels.set([255, 255, 255, 255], i * 4);
  const png = encodePixels(2, 2, pixels);
  await write('src/btn_idle_0.png', png);
  await write('out/hud/btn/idle_0.png', png);
  const loaded = await loadPack(dir);
  const catalog = await buildCatalog(loaded, dir);
  assert.deepEqual(catalog.totals, {total: 2, bySource: {main: 2}, byCategory: {hud: 1, misc: 1}});
  const editable = await loadEditableCatalog(loaded, dir);
  assert.deepEqual([...editable.frames.keys()], ['hud/btn/idle_0']);
});

test('the VFX layout of the MCP indexer reads the source\'s own atlas settings, like the catalog', async t => {
  const { loadAssetIndex } = await import('../../mcp/asset-index.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-vfxatlas-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  pack.palette.file = 'pal.json';
  pack.frameKeys = {fx: 'fx/{id}_{n}'};
  pack.catalog.sources = [{id: 'fx', kind: 'vfx-index', file: 'fx.json', processed: Object.keys(pack.directories.processed)[0], atlas: {dir: 'custom/atlas-here', frameKey: 'fx'}}];
  pack.editable = {overlay: 'a.json', groups: []};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}]}));
  await fs.mkdir(path.join(dir, 'custom/atlas-here'), {recursive: true});
  await write('fx.json', JSON.stringify({effects: [{id: 'puff', frame_size: [2, 2], anchor: [1, 1], frame_count: 1, loop: false, fps: 10, total_ms: 100, descriptor: 'd.json'}]}));
  const index = await loadAssetIndex(await loadPack(dir), dir);
  const puff = index.assets.get('puff');
  assert.equal(puff.layout.atlas.web, 'custom/atlas-here');
  assert.equal(puff.layout.keyOf('play', 'none', 0), 'fx/puff_0');
});

test('a vfx-index source without "processed" keeps the legacy layout (the index file\'s own directory)', async t => {
  const { loadAssetIndex } = await import('../../mcp/asset-index.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-vfxlegacy-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  pack.palette.file = 'pal.json'; pack.frameKeys = {vfx: 'vfx/{id}_{n}'};
  pack.catalog.sources = [{id: 'fx', kind: 'vfx-index', file: 'out/vfx/index.json'}];
  pack.editable = {overlay: 'a.json', groups: []};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}]}));
  await write('out/vfx/index.json', JSON.stringify({effects: [{id: 'puff', frame_size: [2, 2], anchor: [1, 1], frame_count: 1, loop: false, fps: 10, total_ms: 100, descriptor: 'd.json'}]}));
  const index = await loadAssetIndex(await loadPack(dir), dir);
  assert.equal(index.assets.get('puff').layout.processedDir, 'out/vfx');
});

test('a legacy vfx-index source (no processed/atlases keys, atlas.dir = the web directory) finds the same web AND mobile atlases as the real project', async () => {
  const { loadAssetIndex } = await import('../../mcp/asset-index.mjs');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const real = await loadPack(repo);
  const legacy = structuredClone(real);
  const src = legacy.catalog.sources.find(s => s.kind === 'vfx-index');
  delete src.processed; delete src.processedSubdir; delete src.atlases;
  const [a, b] = [await loadAssetIndex(real, repo), await loadAssetIndex(legacy, repo)];
  const effect = [...a.assets.values()].find(x => x.source === src.id);
  assert.ok(effect, 'the real project has packed VFX');
  const twin = b.assets.get(effect.id);
  assert.deepEqual(twin.layout.atlas, effect.layout.atlas);
  assert.equal(twin.layout.atlas.mobile.endsWith('/mobile') && !twin.layout.atlas.mobile.includes('/web/'), true);
  assert.equal(twin.layout.processedDir, effect.layout.processedDir);
});
