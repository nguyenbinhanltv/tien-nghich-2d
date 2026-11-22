import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handle } from './server.mjs';

const realRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function caller(root) {
  return async function call(pathAndQuery, {method = 'GET', body, headers = {}, raw} = {}) {
    let status, out;
    const res = {writeHead(s) { status = s; }, end(text) { out = JSON.parse(text); }};
    const payload = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
    const req = Object.assign(Readable.from(payload ? [payload] : []), {method, headers: {'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers}});
    try { await handle(req, res, new URL('http://127.0.0.1/api/tabs/sandbox/' + pathAndQuery), {root, prefix: '/api/tabs/sandbox/'}); status ??= 200; }
    catch (error) { return {status: error.status, error: error.code, message: error.message}; }
    return {status, body: out};
  };
}

const scene = (id = 'my-room') => ({schema: 'studio.scene', version: 1, id, room: {size: [64, 48], floor: {kind: 'flat', color: 'ink_01'}},
  actors: [{id: 'a', asset: 'lt_kiln_keeper', at: [32, 40]}], effects: [{id: 'e', asset: 'hit_spark', at: {actor: 'a', anchor: 'head'}, when: {input: 'click'}}]});

test('real project: config, the three playables listed as scripted scenes, one opens', async () => {
  const call = caller(realRoot);
  const {body: config} = await call('config');
  assert.equal(config.scenesDir, 'assets/scenes');
  assert.ok(config.palette.length >= 40 && config.palette.every(c => /^#[0-9a-f]{6}$/i.test(c.hex)));
  const {body} = await call('scenes');
  assert.deepEqual(body.scenes.map(s => s.id).sort(), ['drowned-court', 'evening-bell', 'play-arena']);
  assert.ok(body.scenes.every(s => s.valid && s.kind === 'scripted' && typeof s.tracked !== 'undefined'), JSON.stringify(body.scenes.map(s => s.errors)));
  const one = (await call('scene?id=evening-bell')).body;
  assert.equal(one.valid, true);
  assert.equal(one.scene.host.url, '/studio/courtyard/index.html');
  assert.ok(one.scene.host.logic.length >= 3);
});

test('real project: routes refuse bad input, and a tracked scene is not replaced without confirmation', async () => {
  const call = caller(realRoot);
  assert.equal((await call('nope')).error, 'unknown_route');
  assert.equal((await call('scene?id=../x')).error, 'unknown_scene');
  assert.equal((await call('scene?id=ghost')).error, 'unknown_scene');
  assert.equal((await call('scenes', {method: 'DELETE'})).status, 405);
  const before = await fs.readFile(realRoot + 'assets/scenes/play-arena.scene.json', 'utf8');
  // Committed in the repository, git tracks it. In an uncommitted working copy it is untracked and a save would replace it, so never POST then.
  const tracked = (await call('scenes')).body.scenes.find(s => s.id === 'play-arena').tracked;
  if (tracked !== true) return;
  const clash = await call('scene', {method: 'POST', body: {scene: scene('play-arena')}});
  assert.equal(clash.error, 'tracked_scene');
  assert.equal(clash.status, 409);
  assert.equal(await fs.readFile(realRoot + 'assets/scenes/play-arena.scene.json', 'utf8'), before, 'nothing was written');
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene('x')}, headers: {'sec-fetch-site': 'none'}})).error, 'same_origin_required');
});

async function tinyProject(t, {git}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-sandbox-')));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = JSON.parse(await fs.readFile(realRoot + 'studio.project.json', 'utf8'));
  pack.id = 'other-game';
  pack.palette.file = 'pal.json';
  pack.catalog.sources = [{id: 'main', kind: 'asset-manifest', file: 'm.json'}];
  pack.frameKeys = {hud: 'hud/{id}/{clip}_{n}'};
  pack.editable = {overlay: 'approved.json', groups: []};
  pack.ui.tabs = {sandbox: {scenesDir: 'rooms'}};
  pack.ui.theme = {};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{id: 'ink_01', hex: '#000001'}, {id: 'sky_01', hex: '#ffffff'}]}));
  await write('m.json', JSON.stringify({assets: [{id: 'btn', category: 'hud', size: [2, 2], output_path: 'src/', animations: {idle: {frames: 1}}}]}));
  if (git) { execFileSync('git', ['init', '-q'], {cwd: dir}); }
  return {dir, write};
}

test('a second tiny project: its own directory, validation against its palette, create, then confirm to replace', async t => {
  const {dir, write} = await tinyProject(t, {git: true});
  const call = caller(dir);
  assert.deepEqual((await call('scenes')).body.scenes, []);
  assert.equal((await call('config')).body.defaultColor, 'ink_01');

  const wrong = await call('scene', {method: 'POST', body: {scene: scene()}});
  assert.equal(wrong.status, 200, 'colour ink_01 is in this palette; unknown assets are reported, not refused');
  assert.deepEqual(wrong.body.unknownAssets, ['hit_spark', 'lt_kiln_keeper']);
  assert.equal(wrong.body.created, true);
  assert.equal((await call('scene', {method: 'POST', body: {scene: {...scene(), room: {size: [64, 48], floor: {kind: 'flat', color: 'jade_04'}}}}})).error, 'invalid_scene');
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'rooms/my-room.scene.json'), 'utf8'));
  assert.equal(saved.id, 'my-room');
  assert.deepEqual((await call('scenes')).body.scenes.map(s => [s.id, s.valid, s.tracked]), [['my-room', true, false]]);

  // Untracked: replacing needs no confirmation. Tracked: it does.
  assert.equal((await call('scene', {method: 'POST', body: {scene: {...scene(), name: {en: 'v2'}}}})).body.replaced, true);
  execFileSync('git', ['add', 'rooms/my-room.scene.json'], {cwd: dir});
  const refused = await call('scene', {method: 'POST', body: {scene: {...scene(), name: {en: 'v3'}}}});
  assert.equal(refused.error, 'tracked_scene');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'rooms/my-room.scene.json'), 'utf8')).name.en, 'v2');
  const ok = await call('scene', {method: 'POST', body: {scene: {...scene(), name: {en: 'v3'}}, confirm: true}});
  assert.equal(ok.body.tracked, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'rooms/my-room.scene.json'), 'utf8')).name.en, 'v3');

  // An invalid file in the directory is listed as invalid, not hidden.
  await write('rooms/broken.scene.json', '{nope');
  await write('rooms/other.scene.json', JSON.stringify(scene('different')));
  const listed = (await call('scenes')).body.scenes;
  assert.deepEqual(listed.map(s => [s.id, s.valid]), [['broken', false], ['my-room', true], ['other', false]]);
  assert.equal((await call('scene?id=other')).body.valid, false);
});

test('without git a scene that exists counts as tracked; the path cannot leave the directory; bodies are checked', async t => {
  const {dir} = await tinyProject(t, {git: false});
  const call = caller(dir);
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene()}})).status, 200);
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene()}})).error, 'tracked_scene');
  for (const id of ['../escape', 'a/b', '..', 'Up', '']) assert.equal((await call('scene', {method: 'POST', body: {scene: scene(id)}})).error, 'invalid_scene', id);
  assert.deepEqual((await fs.readdir(dir)).sort().includes('escape.scene.json'), false);
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene('z'), extra: 1}})).error, 'invalid_input');
  assert.equal((await call('scene', {method: 'POST', raw: Buffer.from('{bad')})).error, 'invalid_json');
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene('z')}, headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await call('scene', {method: 'POST', raw: Buffer.alloc(300 * 1024, 32)})).status, 413);
  // A symlink in place of a scene file is refused, and nothing is written through it.
  const outside = path.join(dir, 'outside.txt');
  await fs.writeFile(outside, 'keep');
  await fs.symlink(outside, path.join(dir, 'rooms/linked.scene.json'));
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene('linked'), confirm: true}})).error, 'not_a_file');
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
  // A pack with no scenes directory: nothing to list, saving says why.
  const pack = JSON.parse(await fs.readFile(path.join(dir, 'studio.project.json'), 'utf8'));
  delete pack.ui.tabs.sandbox;
  await fs.writeFile(path.join(dir, 'studio.project.json'), JSON.stringify(pack));
  assert.deepEqual((await call('scenes')).body, {scenesDir: null, scenes: []});
  assert.equal((await call('scene', {method: 'POST', body: {scene: scene('q')}})).error, 'no_scenes_dir');
});
