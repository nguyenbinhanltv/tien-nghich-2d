import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPreviewServer } from '../serve.mjs';

const repo = new URL('../../', import.meta.url).pathname;

async function withServer(mounts, body, setup = () => {}) {
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
  setup(root);
  globalThis.__root = root;
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

test('a mount may not cover the whole URL space', () => assert.rejects(
  () => withServer([{url: '/', dir: 'games'}], async () => {}), /serve\.mounts\[0\]\.url/));

test('a mount below /studio/ is tried after the studio\'s own files', () => withServer([{url: '/studio/games/', dir: 'games'}], async get => {
  assert.deepEqual(await get('/studio/games/a.txt'), [200, 'game a']);
  assert.match((await get('/studio/'))[1], /shell\.js/);
}));

test('a mount cannot reach outside the project through a symlink, nor serve a blocked directory', () => withServer(
  [{url: '/out/', dir: 'link'}, {url: '/git/', dir: '.git/pub'}, {url: '/ok/', dir: 'okdir'}],
  async get => {
    assert.equal((await get('/out/secret.txt'))[0], 404);
    assert.equal((await get('/git/h.txt'))[0], 404);
    assert.deepEqual(await get('/ok/f.txt'), [200, 'fine']);
    assert.equal((await get('/ok/leak.txt'))[0], 403);
  },
  root => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(root, 'link'));
    fs.mkdirSync(path.join(root, '.git/pub'), {recursive: true});
    fs.writeFileSync(path.join(root, '.git/pub/h.txt'), 'git');
    fs.mkdirSync(path.join(root, 'okdir'));
    fs.writeFileSync(path.join(root, 'okdir/f.txt'), 'fine');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'okdir/leak.txt'));
  }));

test('a mount whose directory is created after the first request becomes available', () => withServer([{url: '/late/', dir: 'late'}], async get => {
  assert.equal((await get('/late/f.txt'))[0], 404);
  fs.mkdirSync(path.join(globalThis.__root, 'late'));
  fs.writeFileSync(path.join(globalThis.__root, 'late/f.txt'), 'now here');
  assert.deepEqual(await get('/late/f.txt'), [200, 'now here']);
}));
