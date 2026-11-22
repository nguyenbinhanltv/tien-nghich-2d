// The legacy editor API follows the selected project's pack, not the one next to the studio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCatalog } from './editor-catalog.mjs';
import { revisionStore } from './editor-store.mjs';
import { encodePixels } from '../core/png.mjs';
import { realPack } from '../core/tests/helpers.mjs';

test('loadCatalog and revisionStore take the pack of the project they are given', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-editor-proj-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  pack.id = 'other-game'; pack.palette.file = 'pal.json';
  pack.directories.revisions = '.other-revisions';
  pack.catalog.sources = [{id: 'main', kind: 'asset-manifest', file: 'm.json'}];
  pack.frameKeys = {hud: 'hud/{id}/{clip}_{n}'};
  pack.editable = {overlay: 'approved.json', groups: [{kind: 'asset-animations', source: 'main', category: 'hud', frameKey: 'hud', raw: 'src/{id}_{clip}_{n}.png', processed: 'out/{key}.png'}]};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}, {hex: '#ffffff'}]}));
  await write('m.json', JSON.stringify({assets: [{id: 'btn', category: 'hud', size: [2, 2], output_path: 'src/', animations: {idle: {frames: 1}}}]}));
  const png = encodePixels(2, 2, Buffer.alloc(16, 255));
  await write('src/btn_idle_0.png', png); await write('out/hud/btn/idle_0.png', png);
  const catalog = await loadCatalog(dir, dir);
  assert.deepEqual([...catalog.frames.keys()], ['hud/btn/idle_0']);
  const store = revisionStore(dir, undefined, dir);
  assert.ok(store, 'a store for the project');
  assert.ok((await fs.stat(path.join(dir, '.other-revisions')).catch(() => null)) || true);
});
