// The legacy editor API follows the selected project's pack, not the one next to the studio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCatalog } from './editor-catalog.mjs';
import { createPreviewServer } from '../serve.mjs';
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
  // A write through the server of the selected project creates its database under the project pack's revisions directory.
  const server = createPreviewServer({root: dir});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/editor/save`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({key: 'hud/btn/idle_0', baseRevision: 0, pngBase64: encodePixels(2, 2, Buffer.concat([Buffer.from([0, 0, 1, 255]), Buffer.alloc(12, 255)])).toString('base64')})});
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await res.json()).head, 1, 'a new revision was stored');
  assert.ok((await fs.readdir(path.join(dir, '.other-revisions'))).length > 0, 'database under the pack\'s revisions directory');
  await assert.rejects(fs.stat(path.join(dir, realPack().directories.revisions)), {code: 'ENOENT'});
});
