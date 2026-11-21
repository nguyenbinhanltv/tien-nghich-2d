// A second project must work from its own pack file and data, with no code edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
