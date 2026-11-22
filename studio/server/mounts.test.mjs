import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreviewServer } from '../serve.mjs';

const repo = new URL('../../', import.meta.url).pathname;

async function withServer(mounts, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mounts-'));
  const pack = JSON.parse(fs.readFileSync(path.join(repo, 'studio.project.json'), 'utf8'));
  pack.serve = {mounts};
  fs.writeFileSync(path.join(root, 'studio.project.json'), JSON.stringify(pack));
  fs.mkdirSync(path.join(root, 'games/sub'), {recursive: true});
  fs.writeFileSync(path.join(root, 'games/a.txt'), 'game a');
  fs.writeFileSync(path.join(root, 'games/sub/index.html'), 'sub index');
  fs.mkdirSync(path.join(root, 'games/studio'), {recursive: true});
  fs.writeFileSync(path.join(root, 'games/studio/x.txt'), 'under studio');
  fs.writeFileSync(path.join(root, 'plain.txt'), 'project file');
  const server = createPreviewServer({root});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const get = async u => { const r = await fetch(`http://127.0.0.1:${server.address().port}${u}`); return [r.status, await r.text()]; };
  try { await body(get); } finally { server.close(); fs.rmSync(root, {recursive: true, force: true}); }
}

test('a mount answers under any URL prefix, including directories; the project is the fallback', () => withServer([{url: '/games/', dir: 'games'}], async get => {
  assert.deepEqual(await get('/games/a.txt'), [200, 'game a']);
  assert.deepEqual(await get('/games/sub/'), [200, 'sub index']);
  assert.equal((await get('/games/missing.txt'))[0], 404);
  assert.deepEqual(await get('/plain.txt'), [200, 'project file']);
}));

test('a "/" mount maps /studio/x to <dir>/studio/x, but the studio's own files win', () => withServer([{url: '/', dir: 'games'}], async get => {
  assert.deepEqual(await get('/a.txt'), [200, 'game a']);
  assert.deepEqual(await get('/studio/x.txt'), [200, 'under studio']);
  assert.equal((await get('/studio/y.txt'))[0], 404);
  assert.match((await get('/studio/'))[1], /shell\.js/);
  assert.deepEqual(await get('/plain.txt'), [200, 'project file']);
}));
