// The Projects screen's server side: the user-level list, switching the open project while the server runs,
// opening a wrong path, creating from templates, editing settings, and that a folder is never browsed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../serve.mjs';
import { createRegistry, pixelKilnHome, normalizeProjectPath } from '../core/project-registry.mjs';

const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const MOSS = path.join(STUDIO, 'examples', 'moss-lantern');

function sandbox(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pk-projects-')));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
async function start(t, {root = null, revisionDir} = {}) {
  const base = sandbox(t);
  const home = path.join(base, 'home');
  const registry = createRegistry({home});
  const server = createPreviewServer({root, registry, revisionDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(origin + url, {method, headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {status: res.status, json, text};
  };
  return {base, home, registry, server, origin, call};
}

test('PROJECTS-001: the user-level list lives in PIXEL_KILN_HOME, or the platform config directory, never in a repo', () => {
  assert.equal(pixelKilnHome({env: {PIXEL_KILN_HOME: '/tmp/pk-home'}, platform: 'darwin', home: '/Users/x'}), '/tmp/pk-home');
  assert.equal(pixelKilnHome({env: {}, platform: 'darwin', home: '/Users/x'}), '/Users/x/Library/Application Support/Pixel Kiln');
  assert.equal(pixelKilnHome({env: {XDG_CONFIG_HOME: '/cfg'}, platform: 'linux', home: '/home/x'}), '/cfg/pixel-kiln');
  assert.equal(pixelKilnHome({env: {}, platform: 'linux', home: '/home/x'}), '/home/x/.config/pixel-kiln');
  assert.throws(() => pixelKilnHome({env: {PIXEL_KILN_HOME: 'relative/dir'}}), /absolute/);
});

test('PROJECTS-002: the list remembers projects by real path, most recently opened first, and removing one deletes no file', async t => {
  const base = sandbox(t);
  const ticks = ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z'];
  let i = 0;
  const registry = createRegistry({home: path.join(base, 'home'), now: () => new Date(ticks[i++])});
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b); fs.writeFileSync(path.join(a, 'keep.txt'), 'x');
  const ea = await registry.add({root: a, name: 'A'});
  const eb = await registry.add({root: b, name: 'B'});
  assert.equal((await registry.add({root: a, name: 'A'})).id, ea.id, 'the same folder is the same entry');
  assert.deepEqual((await registry.list()).map(p => p.name), ['B', 'A']);
  await registry.touch(ea.id);
  assert.deepEqual((await registry.list()).map(p => p.name), ['A', 'B']);
  assert.equal(await registry.remove(eb.id), true);
  assert.equal(await registry.remove(eb.id), false);
  assert.ok(fs.existsSync(b) && fs.existsSync(path.join(a, 'keep.txt')), 'the folders are untouched');
  fs.writeFileSync(registry.file, '{not json');
  assert.deepEqual(await registry.list(), [], 'a damaged list starts empty instead of failing');
});

test('PROJECTS-003: a typed path is normalised and checked before anything is read', () => {
  assert.throws(() => normalizeProjectPath('relative/path'), {code: 'path_not_absolute'});
  assert.throws(() => normalizeProjectPath('/tmp/a/../b'), {code: 'invalid_path'});
  assert.throws(() => normalizeProjectPath('/tmp/a\u0000b'), {code: 'invalid_path'});
  assert.throws(() => normalizeProjectPath('   '), {code: 'invalid_path'});
  assert.throws(() => normalizeProjectPath('/' + 'a'.repeat(2000)), {code: 'invalid_path'});
  assert.equal(normalizeProjectPath('/tmp//x/./y'), '/tmp/x/y');
  assert.equal(normalizeProjectPath('~/proj', {home: '/Users/x'}), '/Users/x/proj');
  assert.equal(normalizeProjectPath('rel', {strict: false, cwd: '/work'}), '/work/rel', 'the command line may use a relative path');
});

test('PROJECTS-004: with no project the server serves the studio and the projects API only, never a project file', async t => {
  const s = await start(t);
  assert.equal((await fetch(s.origin + '/studio/')).status, 200);
  assert.equal((await fetch(s.origin + '/studio.project.json')).status, 404);
  assert.equal((await fetch(s.origin + '/README.md')).status, 404);
  for (const url of ['/api/studio/project', '/api/editor/frames', '/api/tabs/overview/x', '/mcp']) {
    const r = await s.call('GET', url);
    assert.equal(r.status, 409, url);
    assert.equal(r.json.error.code, 'no_project');
  }
  const list = await s.call('GET', '/api/projects');
  assert.equal(list.status, 200);
  assert.equal(list.json.current, null);
  assert.deepEqual(list.json.projects, []);
  assert.deepEqual(list.json.templates.map(x => x.id), ['blank', 'moss-lantern']);
});

test('PROJECTS-005: opening a wrong path says why: missing folder, a file, no pack, a pack that fails the schema, a relative or ".." path', async t => {
  const s = await start(t);
  const file = path.join(s.base, 'file.txt'); fs.writeFileSync(file, 'x');
  const empty = path.join(s.base, 'empty'); fs.mkdirSync(empty);
  const broken = path.join(s.base, 'broken'); fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, 'studio.project.json'), JSON.stringify({schema: 'studio.project', version: 1, id: 'x', name: 'X'}));
  const bad = fs.mkdtempSync(path.join(s.base, 'bad-')); fs.writeFileSync(path.join(bad, 'studio.project.json'), '{oops');
  const cases = [[path.join(s.base, 'nope'), 404, 'not_found'], [file, 422, 'not_a_directory'], [empty, 422, 'no_pack'],
    [broken, 422, 'invalid_pack'], [bad, 422, 'invalid_pack'], ['relative/x', 422, 'path_not_absolute'], [s.base + '/a/../b', 422, 'invalid_path'], ['', 422, 'invalid_path']];
  for (const [p, status, code] of cases) {
    const r = await s.call('POST', '/api/projects/add', {path: p});
    assert.deepEqual([r.status, r.json.error.code], [status, code], p);
  }
  const schema = await s.call('POST', '/api/projects/add', {path: broken});
  assert.ok(schema.json.error.issues.length > 0, 'a schema failure lists what is wrong');
  assert.deepEqual((await s.call('GET', '/api/projects')).json.projects, [], 'nothing wrong was remembered');
  assert.equal((await s.call('POST', '/api/projects/add', {path: MOSS, extra: 1})).status, 422);
});

test('PROJECTS-006: moss-lantern runs through the hub: add, open, the catalog API now answers for it, the old project is not served', async t => {
  const s = await start(t);
  const added = await s.call('POST', '/api/projects/add', {path: MOSS});
  assert.equal(added.status, 200);
  const card = added.json.project;
  assert.equal(card.status, 'ok');
  assert.ok(card.swatches.length > 0 && /^#[0-9a-f]{6}$/i.test(card.swatches[0]));
  assert.equal(typeof card.assets, 'number');
  assert.equal(card.lastOpened, null);
  const sw = await s.call('POST', '/api/projects/switch', {id: card.id});
  assert.equal(sw.status, 200);
  assert.equal(sw.json.current.id, 'moss-lantern');
  const info = await s.call('GET', '/api/studio/project');
  assert.equal(info.status, 200);
  assert.equal(info.json.id, 'moss-lantern');
  const overview = await s.call('GET', '/api/studio/overview');
  assert.equal(overview.status, 200);
  assert.equal((await fetch(s.origin + '/studio.project.json')).status, 200, 'the open project answers its own files');
  assert.ok((await s.call('GET', '/api/projects')).json.projects[0].lastOpened, 'opening stamps the list');
});

test('PROJECTS-007: switching a running server reloads the workspace: tabs read the new project, a failed switch leaves the old one open', async t => {
  const s = await start(t, {root: MOSS});
  assert.equal((await s.call('GET', '/api/studio/project')).json.id, 'moss-lantern');
  const made = await s.call('POST', '/api/projects/create', {template: 'blank', dir: path.join(s.base, 'pond'), name: 'Tiny Pond'});
  assert.equal(made.status, 201);
  assert.equal((await s.call('POST', '/api/projects/switch', {id: made.json.project.id})).status, 200);
  const info = (await s.call('GET', '/api/studio/project')).json;
  assert.equal(info.name, 'Tiny Pond');
  assert.equal((await s.call('GET', '/api/studio/assets')).json.total, 0, 'the catalog is the new project\'s');
  // A project whose pack broke after it was listed: the switch is refused and the open project stays.
  const moved = path.join(s.base, 'pond-gone');
  fs.renameSync(path.join(s.base, 'pond'), moved);
  const gone = await s.call('POST', '/api/projects/switch', {id: made.json.project.id});
  assert.equal(gone.status, 404);
  assert.equal(gone.json.error.code, 'not_found');
  assert.equal((await s.call('GET', '/api/studio/project')).json.name, 'Tiny Pond');
  const card = (await s.call('GET', '/api/projects')).json.projects.find(p => p.id === made.json.project.id);
  assert.equal(card.status, 'missing', 'the card says the folder is gone');
  assert.equal((await s.call('POST', '/api/projects/switch', {id: 'p_unknown'})).status, 404, 'only a project in the list can be opened');
});

test('PROJECTS-008: creating from a template: blank is init, moss-lantern is a copy; neither overwrites or leaves the chosen folder', async t => {
  const s = await start(t);
  const blank = await s.call('POST', '/api/projects/create', {template: 'blank', dir: path.join(s.base, 'one'), name: 'One'});
  assert.equal(blank.status, 201);
  assert.ok(fs.existsSync(path.join(s.base, 'one', 'studio.project.json')));
  const moss = await s.call('POST', '/api/projects/create', {template: 'moss-lantern', dir: path.join(s.base, 'two'), name: 'My Lantern'});
  assert.equal(moss.status, 201);
  assert.equal(moss.json.project.name, 'My Lantern');
  const mcp = JSON.parse(fs.readFileSync(path.join(s.base, 'two', '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.studio.args.some(a => a.endsWith('mcp.mjs') && path.isAbsolute(a)), 'agent configs point at this studio, not at ../../');
  assert.equal(JSON.parse(fs.readFileSync(path.join(MOSS, 'studio.project.json'), 'utf8')).name !== 'My Lantern', true, 'the sample itself is not edited');
  const busy = path.join(s.base, 'busy'); fs.mkdirSync(busy); fs.writeFileSync(path.join(busy, 'mine.txt'), 'keep');
  assert.equal((await s.call('POST', '/api/projects/create', {dir: busy})).json.error.code, 'dir_not_empty');
  assert.equal(fs.readFileSync(path.join(busy, 'mine.txt'), 'utf8'), 'keep');
  assert.equal((await s.call('POST', '/api/projects/create', {dir: path.join(s.base, 'no', 'such', 'parent')})).json.error.code, 'parent_missing');
  assert.equal((await s.call('POST', '/api/projects/create', {dir: path.join(STUDIO, 'inside')})).json.error.code, 'invalid_path');
  assert.equal((await s.call('POST', '/api/projects/create', {dir: path.join(s.base, 'x'), template: 'nope'})).json.error.code, 'unknown_template');
  assert.equal((await s.call('POST', '/api/projects/create', {dir: path.join(s.base, 'y'), id: 'Bad Id'})).status, 422);
  assert.equal(fs.existsSync(path.join(s.base, 'y')), false, 'a refused request creates nothing');
});

test('PROJECTS-009: removing a project drops it from the list only', async t => {
  const s = await start(t);
  const dir = path.join(s.base, 'keepme');
  const made = await s.call('POST', '/api/projects/create', {dir});
  assert.equal((await s.call('POST', '/api/projects/remove', {id: made.json.project.id})).status, 200);
  assert.deepEqual((await s.call('GET', '/api/projects')).json.projects, []);
  assert.ok(fs.existsSync(path.join(dir, 'studio.project.json')), 'the project folder is still there');
  assert.equal((await s.call('POST', '/api/projects/remove', {id: made.json.project.id})).status, 404);
});

test('PROJECTS-010: settings: read, change through the schema check with a revision kept, stale and invalid changes refused', async t => {
  const s = await start(t);
  const made = await s.call('POST', '/api/projects/create', {dir: path.join(s.base, 'set'), name: 'Set'});
  await s.call('POST', '/api/projects/switch', {id: made.json.project.id});
  const got = (await s.call('GET', '/api/projects/settings')).json;
  assert.equal(got.settings.name, 'Set');
  assert.ok(got.baseSha && got.palette.length >= 8);
  const ok = await s.call('POST', '/api/projects/settings', {baseSha: got.baseSha, changes: {name: 'Renamed', subtitle: {en: 'Sub', vi: 'Phụ'}}});
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.changed.sort(), ['name', 'subtitle']);
  assert.equal(ok.json.settings.settings.name, 'Renamed');
  assert.equal((await s.call('GET', '/api/studio/project')).json.name, 'Renamed', 'the open workspace re-read the pack');
  assert.equal((await s.call('GET', '/api/projects')).json.projects[0].name, 'Renamed', 'the list shows the new name');
  const revision = JSON.parse(fs.readFileSync(path.join(s.base, 'set', ok.json.revision), 'utf8'));
  assert.equal(revision.previous.name, 'Set', 'the pack as it was is kept');
  const stale = await s.call('POST', '/api/projects/settings', {baseSha: got.baseSha, changes: {name: 'Late'}});
  assert.equal(stale.json.error.code, 'stale_pack');
  const fresh = ok.json.baseSha;
  const badSize = await s.call('POST', '/api/projects/settings', {baseSha: fresh, changes: {sizeClasses: {tile: {min: [32, 32], max: [16, 16]}}}});
  assert.equal(badSize.json.error.code, 'invalid_pack');
  assert.ok(badSize.json.error.issues.length);
  const badTheme = await s.call('POST', '/api/projects/settings', {baseSha: fresh, changes: {theme: {accent: 'no_such_colour'}}});
  assert.equal(badTheme.json.error.code, 'invalid_pack');
  assert.equal((await s.call('POST', '/api/projects/settings', {baseSha: fresh, changes: {colour: 'x'}})).status, 422);
  assert.equal((await s.call('POST', '/api/projects/settings', {baseSha: fresh, changes: {name: ''}})).status, 422);
  assert.equal((await s.call('GET', '/api/projects/settings')).json.baseSha, fresh, 'refused changes wrote nothing');
});

test('PROJECTS-011: licenceProfile and quota are the owner\'s decisions: refused without the owner flag, recorded with it', async t => {
  const s = await start(t, {root: MOSS});
  const got = (await s.call('GET', '/api/projects/settings')).json;
  const quota = {window: 'day', ceilings: {'image-tool': 5}};
  const refused = await s.call('POST', '/api/projects/settings', {baseSha: got.baseSha, changes: {quota}});
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error.code, 'owner_decision_required');
  const copy = path.join(s.base, 'moss'); // the sample itself must never be rewritten by a test
  fs.cpSync(MOSS, copy, {recursive: true});
  const added = await s.call('POST', '/api/projects/add', {path: copy});
  await s.call('POST', '/api/projects/switch', {id: added.json.project.id});
  const g2 = (await s.call('GET', '/api/projects/settings')).json;
  const done = await s.call('POST', '/api/projects/settings', {baseSha: g2.baseSha, changes: {quota}, ownerDecision: true});
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual(done.json.settings.settings.quota, quota);
  assert.equal(JSON.parse(fs.readFileSync(path.join(copy, done.json.revision), 'utf8')).ownerDecision, true);
});

test('PROJECTS-012: the projects API is loopback and same origin only, takes JSON only, and has no folder browser', async t => {
  const s = await start(t);
  const wrongOrigin = await fetch(s.origin + '/api/projects', {headers: {Origin: 'http://evil.example'}});
  assert.equal(wrongOrigin.status, 403);
  const wrongHost = await new Promise((resolve, reject) => http.get({host: '127.0.0.1', port: s.server.address().port, path: '/api/projects', headers: {Host: 'evil.example'}}, res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  assert.equal(wrongHost, 403, 'a DNS-rebinding style Host is refused');
  const form = await fetch(s.origin + '/api/projects/add', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: '{}'});
  assert.equal(form.status, 415);
  for (const url of ['/api/projects/browse', '/api/projects/ls', '/api/projects/files', '/api/projects/..%2f']) assert.equal((await s.call('GET', url)).status, 404, url);
  assert.equal((await s.call('DELETE', '/api/projects')).status, 405);
});

test('PROJECTS-015: --revision-dir stays with the project the server started with, through a settings save and a switch away and back', async t => {
  const base = sandbox(t);
  const project = path.join(base, 'proj'), library = path.join(base, 'library');
  fs.mkdirSync(project);
  const { scaffold } = await import('../core/scaffold.mjs');
  await scaffold(project, STUDIO, {name: 'Lib'});
  const s = await start(t, {root: project, revisionDir: library});
  assert.equal(s.server.revisionDirInUse(), library);
  const got = (await s.call('GET', '/api/projects/settings')).json;
  assert.equal((await s.call('POST', '/api/projects/settings', {baseSha: got.baseSha, changes: {name: 'Lib 2'}})).status, 200);
  assert.equal(s.server.revisionDirInUse(), library, 'a settings save reloads the workspace with the same library');
  const other = await s.call('POST', '/api/projects/create', {dir: path.join(base, 'other')});
  const back = await s.call('POST', '/api/projects/add', {path: project});
  await s.call('POST', '/api/projects/switch', {id: other.json.project.id});
  assert.equal(s.server.revisionDirInUse(), undefined, 'another project does not borrow it');
  await s.call('POST', '/api/projects/switch', {id: back.json.project.id});
  assert.equal(s.server.revisionDirInUse(), library, 'coming back to the start project uses it again');
});

test('PROJECTS-016: create validates name and id before writing anything, for every template', async t => {
  const s = await start(t);
  const dir = n => path.join(s.base, n);
  for (const [template, body, label] of [['moss-lantern', {name: 5}, 'name 5'], ['blank', {name: {}}, 'name object'], ['blank', {id: 5}, 'id 5'], ['moss-lantern', {id: 'my-id'}, 'id on a sample'], ['blank', {id: 'Bad Id'}, 'bad id']]) {
    const r = await s.call('POST', '/api/projects/create', {template, dir: dir('v-' + label.replace(/\W/g, '')), ...body});
    assert.equal(r.status, 422, label);
    assert.equal(r.json.error.code, 'invalid_input', label);
    assert.equal(fs.existsSync(dir('v-' + label.replace(/\W/g, ''))), false, `${label}: nothing was written`);
  }
  assert.equal((await s.call('POST', '/api/projects/create', {template: 'blank', dir: dir('ok'), id: 'fine-id', name: 'Fine'})).status, 201);
});
