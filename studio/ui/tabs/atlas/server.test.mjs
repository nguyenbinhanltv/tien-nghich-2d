// Atlas tab routes against the real project (read-only; every write goes to a temp library) and against a second tiny project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { REPO, HAVE_PYTHON } from '../../../mcp/testkit.mjs';
import { encodePixels } from '../../../core/png.mjs';
import { loadPackSync } from '../../../core/pack.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { atlasSets, packSet } from '../../../core/atlas-sets.mjs';
import { fingerprint, writeStaged } from '../../../core/atlas-proof.mjs';
import { realPack } from '../../../core/tests/helpers.mjs';
import { handle } from './server.mjs';

const realTemp = async t => { const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'atlas-tab-')); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; };

/** Call a route in process. Returns {status, headers, text, json}. Errors from the handler come back as {status: error.status, code}. */
async function call(root, libraryDir, method, route, {query = {}, body} = {}) {
  const url = new URL(`http://127.0.0.1/api/tabs/atlas/${route}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {method, headers: {}});
  const out = {status: 200, headers: {}, chunks: []};
  const res = {writeHead(status, headers) { out.status = status; out.headers = headers; }, end(data) { if (data) out.chunks.push(Buffer.from(data)); }};
  try { await handle(req, res, url, {root, prefix: '/api/tabs/atlas/', libraryDir}); }
  catch (error) { return {status: error.status, code: error.code, message: error.message}; }
  const raw = Buffer.concat(out.chunks);
  const type = String(out.headers['Content-Type'] ?? '');
  return {status: out.status, headers: out.headers, raw, text: raw.toString('utf8'), json: type.includes('json') ? JSON.parse(raw.toString('utf8')) : undefined};
}

// The abode chunk grows as characters are added, so its counts come from the shipped summary, never from literals.
const ABODE = JSON.parse(await fs.readFile(path.join(REPO, 'assets/atlases_longtime/mobile/abode/chunk-manifest.json'), 'utf8'));
const ABODE_FRAMES = ABODE.frame_count, ABODE_PAGES = ABODE.page_count, ABODE_BYTES = ABODE.rgba8_bytes, ABODE_CEILING = ABODE.mobile_page_budget;
const ABODE_STATE = ABODE_PAGES > ABODE_CEILING ? 'over' : ABODE_PAGES === ABODE_CEILING ? 'full' : 'ok';
// The real project fills its chunks as the asset lanes deliver, so "a chunk with no atlas yet" is tested on a fixture: the real pack
// with a design manifest of its own whose chunk "hollow" has no assets and no shipped atlas, and "shipped" has one assigned asset.
async function hollowProject(t) {
  const dir = await realTemp(t);
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  pack.palette.file = 'pal.json';
  pack.catalog = {sources: [{...pack.catalog.sources.find(x => x.id === 'longtime'), file: 'design.json'}]};
  pack.editable = {...pack.editable, groups: []};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}, {hex: '#ffffff'}]}));
  await write('design.json', JSON.stringify({mobile: {page: [1024, 1024], padding: 2, extrude: 1, bytes_per_pixel: 4}, chunks: {hollow: 1}, profiles: {}, assets: [], vfx: {entries: []}}));
  return dir;
}
const shipped = async () => { const pack = loadPackSync(REPO); return fingerprint(REPO, [...new Set(Object.values(pack.directories.atlases))]); };

test('sets: the core atlas and every Longtime chunk, with shipped pages, budget state and which packing methods exist', async t => {
  const lib = await realTemp(t);
  const {status, json} = await call(REPO, lib, 'GET', 'sets');
  assert.equal(status, 200);
  const [core, chunks] = ['core', 'longtime'].map(id => json.sets.find(s => s.id === id));
  assert.equal(core.chunked, false);
  assert.deepEqual(core.profiles, ['web', 'mobile']);
  assert.equal(core.shipped.mobile.pages, 7);
  assert.equal(core.shipped.web.frames, 2970);
  assert.equal(core.studioPack, true);
  assert.equal(typeof core.authority.build, 'boolean');
  const design = JSON.parse(await fs.readFile(path.join(REPO, 'assets/manifest_longtime.json'), 'utf8'));
  assert.deepEqual(chunks.chunks.map(c => c.id), Object.keys(design.chunks).sort());
  const abode = chunks.chunks.find(c => c.id === 'abode');
  assert.deepEqual([abode.shipped.mobile.pages, abode.shipped.mobile.frames, abode.shipped.mobile.bytes, abode.shipped.mobile.budget.state, abode.ceilingPages], [ABODE_PAGES, ABODE_FRAMES, ABODE_BYTES, ABODE_STATE, ABODE_CEILING]);
  assert.equal(abode.shipped.mobile.budget.ceilingBytes, 4194304);
  assert.deepEqual(json.formats.map(f => f.id), ['phaser', 'pixi', 'godot', 'unity', 'aseprite', 'tiled', 'ldtk']);
});

test('pages: every frame carries its rectangle and where it came from; the image route serves the shipped bytes', async t => {
  const lib = await realTemp(t);
  const {json} = await call(REPO, lib, 'GET', 'pages', {query: {set: 'longtime', chunk: 'abode', profile: 'mobile'}});
  assert.deepEqual(json.spec, {padding: 2, extrude: 1, limit: 1024, fixedSize: false});
  const [page] = json.pages;
  assert.equal(page.frameCount, ABODE_FRAMES);
  // The reported unused area equals the one computed here from the shipped page: its size from the chunk summary, its frame
  // rectangles from its json, and the border (padding + extrude) each frame reserves. It moves with every repack, so no literal.
  const shippedPage = ABODE.pages[page.index], shippedJson = JSON.parse(await fs.readFile(path.join(REPO, 'assets/atlases_longtime/mobile/abode', shippedPage.json), 'utf8'));
  const border = json.spec.padding + json.spec.extrude, area = shippedPage.width * shippedPage.height;
  const reserved = Object.values(shippedJson.frames).reduce((n, r) => n + (r.frame.w + 2 * border) * (r.frame.h + 2 * border), 0);
  assert.deepEqual([page.width, page.height], [shippedPage.width, shippedPage.height]);
  assert.equal(page.usage.area, area);
  assert.equal(page.usage.unused, Math.max(0, area - reserved));
  assert.equal(page.usage.unusedRatio, Math.max(0, area - reserved) / area);
  assert.ok(page.usage.unusedRatio >= 0 && page.usage.unusedRatio < 1, 'unused area is reported');
  assert.ok(page.frames.every(f => f.asset && f.clip && f.file && f.w > 0));
  for (const f of page.frames.slice(0, 5)) await fs.access(path.join(REPO, f.file));
  const png = await call(REPO, lib, 'GET', 'image', {query: {set: 'longtime', chunk: 'abode', profile: 'mobile', page: '0'}});
  assert.equal(png.headers['Content-Type'], 'image/png');
  assert.ok(png.raw.equals(await fs.readFile(path.join(REPO, 'assets/atlases_longtime/mobile/abode/atlas-0.png'))));
  assert.equal((await call(REPO, lib, 'GET', 'image', {query: {set: 'longtime', chunk: 'abode', profile: 'mobile', page: '9'}})).status, 404);
  const core = await call(REPO, lib, 'GET', 'pages', {query: {set: 'core', profile: 'web'}});
  assert.equal(core.json.pages.length, 2);
  assert.ok(core.json.pages.some(p => p.frames.some(f => f.asset && f.category === 'tileset' && f.clip)));
});

test('inputs are checked: unknown set, chunk or profile, traversal, wrong method, bad JSON', async t => {
  const lib = await realTemp(t);
  const g = query => call(REPO, lib, 'GET', 'pages', {query});
  assert.equal((await g({set: 'nope'})).status, 404);
  assert.equal((await g({set: 'longtime', chunk: '../x'})).status, 422);
  assert.equal((await g({set: 'longtime', chunk: 'nope'})).status, 404);
  assert.equal((await g({set: 'longtime', chunk: 'abode', profile: 'huge'})).status, 404);
  assert.equal((await call(REPO, lib, 'GET', 'pack', {query: {set: 'core'}})).status, 405);
  assert.equal((await call(REPO, lib, 'POST', 'sets')).status, 405);
  assert.equal((await call(REPO, lib, 'GET', 'nothing')).status, 404);
  assert.equal((await call(REPO, lib, 'POST', 'pack', {body: {set: 'longtime'}})).status, 422, 'a chunked set needs a chunk');
  for (const bad of ['export-file']) for (const p of ['../x', '/etc/passwd', 'a/../../b', '']) assert.notEqual((await call(REPO, lib, 'GET', bad, {query: {path: p}})).status, 200, p);
});

test('search finds frames by asset id or key across sets, and is capped', async t => {
  const lib = await realTemp(t);
  const {json} = await call(REPO, lib, 'GET', 'search', {query: {q: 'kiln_keeper'}});
  assert.ok(json.hits.length > 5 && json.hits.every(h => h.key.includes('kiln_keeper') || h.asset.includes('kiln_keeper')));
  assert.ok(json.hits.every(h => h.set === 'longtime' && h.chunk));
  assert.deepEqual((await call(REPO, lib, 'GET', 'search', {query: {q: 'k'}})).json.hits, []);
  const many = await call(REPO, lib, 'GET', 'search', {query: {q: 'characters/'}});
  assert.equal(many.json.hits.length, 60);
  assert.equal(many.json.truncated, true);
});

test('ATLAS-001: pack with the studio packer stages beside, compares with the shipped chunk and leaves every shipped file untouched', async t => {
  const lib = await realTemp(t), before = await shipped();
  const r = await call(REPO, lib, 'POST', 'pack', {body: {set: 'longtime', chunk: 'abode', engine: 'studio'}});
  assert.equal(r.status, 200);
  assert.equal(r.json.engine, 'studio');
  assert.match(r.json.dir, /^atlas-staging[\\/]longtime[\\/]abode[\\/]studio$/);
  for (const p of ['web', 'mobile']) assert.ok(['identical', 'equivalent'].includes(r.json.profiles[p].comparison.verdict), p);
  assert.equal(r.json.profiles.mobile.budget.state, ABODE_STATE);
  assert.equal(r.json.shipped.unchanged, true);
  assert.equal(await shipped(), before);
  const png = r.json.profiles.mobile.comparison.files.find(f => f.name === 'atlas-0.png');
  assert.ok(['identical', 'equivalent'].includes(png.status));
  if (png.status === 'equivalent') assert.match(png.note, /zlib/);
  const dir = path.join(lib, r.json.dir, r.json.profiles.mobile.dir);
  assert.ok((await fs.readdir(dir)).includes('atlas-0.png'));
  const again = await call(REPO, lib, 'POST', 'pack', {body: {set: 'longtime', chunk: 'abode', engine: 'studio'}});
  assert.equal(again.json.profiles.mobile.comparison.files.find(f => f.name === 'atlas-0.json').shipped.sha256, r.json.profiles.mobile.comparison.files.find(f => f.name === 'atlas-0.json').shipped.sha256, 'deterministic');
});

test('pack with the project packer (authority) stages byte-identical files', {skip: !HAVE_PYTHON}, async t => {
  const lib = await realTemp(t);
  const r = await call(REPO, lib, 'POST', 'pack', {body: {set: 'longtime', chunk: 'wards', engine: 'authority'}});
  assert.equal(r.status, 200, r.message);
  assert.equal(r.json.authority.ok, true);
  assert.deepEqual(Object.values(r.json.profiles).map(p => p.comparison.verdict), ['identical', 'identical']);
  assert.equal((await call(REPO, lib, 'POST', 'pack', {body: {set: 'core', engine: 'nope'}})).status, 422);
});

test('what-if for a chunk with nothing staged is empty; exports land in the export staging directory and download', async t => {
  const lib = await realTemp(t);
  const w = await call(REPO, lib, 'GET', 'whatif', {query: {set: 'longtime', chunk: 'abode'}});
  assert.deepEqual([w.json.staged, w.json.frames.before, w.json.profiles.mobile.before.pages], [[], ABODE_FRAMES, ABODE_PAGES]);
  const e = await call(REPO, lib, 'POST', 'export', {body: {set: 'longtime', chunk: 'abode', profile: 'mobile', formats: ['phaser', 'unity']}});
  assert.equal(e.status, 200, e.message);
  assert.deepEqual(e.json.formats.map(f => f.id), ['phaser', 'unity']);
  assert.match(e.json.dir, /^exports[\\/]longtime[\\/]abode[\\/]mobile$/);
  const file = e.json.formats[0].files.find(f => f.name.endsWith('multiatlas.json'));
  const got = await call(REPO, lib, 'GET', 'export-file', {query: {path: `${e.json.downloadBase}/${file.name}`}});
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.text).textures.length, 1);
  assert.equal((await call(REPO, lib, 'GET', 'export-file', {query: {path: `${e.json.downloadBase}/nope.json`}})).status, 404);
  assert.equal((await call(REPO, lib, 'POST', 'export', {body: {set: 'longtime', chunk: 'abode', profile: 'mobile', formats: ['flash']}})).status, 422);
});

test('ledger: JSON with the disclosure, Markdown in English and Vietnamese, downloads', async t => {
  const lib = await realTemp(t);
  const j = await call(REPO, lib, 'GET', 'ledger');
  assert.equal(j.json.schema, 'studio.ledger');
  assert.equal(j.json.disclosure.total, j.json.assets.length);
  const md = await call(REPO, lib, 'GET', 'ledger', {query: {format: 'md', lang: 'vi', download: '1'}});
  assert.match(md.headers['Content-Disposition'], /ledger\.vi\.md/);
  assert.match(md.text, /^# Sổ giấy phép/);
  assert.match((await call(REPO, lib, 'GET', 'ledger', {query: {format: 'md'}})).text, /^# Licence and provenance ledger/);
  assert.equal((await call(REPO, lib, 'GET', 'ledger', {query: {format: 'xml'}})).status, 422);
});

// ---- a second, tiny project: its own pack, no atlas block, no code edits ------------------------------------------------
async function tinyProject(t) {
  const dir = await realTemp(t);
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  const pack = realPack();
  Object.assign(pack, {id: 'other-game', name: 'Other Game'});
  pack.palette.file = 'pal.json';
  pack.directories = {...pack.directories, processed: {core: 'proc'}, atlases: {core: 'atl'}, raw: {core: 'src'}};
  pack.atlasProfiles = {web: {limit: 64, padding: 0, extrude: 0, fixedSize: false}, mobile: {limit: 32, padding: 1, extrude: 1, fixedSize: false}};
  pack.catalog = {sources: [{id: 'main', kind: 'asset-manifest', file: 'm.json', processed: 'core'}]};
  pack.frameKeys = {ui: 'ui/{id}/{clip}_none_{n}'};
  pack.editable = {overlay: 'approved.json', groups: [{kind: 'asset-animations', source: 'main', category: 'ui', frameKey: 'ui', raw: 'src/{id}_{clip}_{n}.png', processed: 'proc/ui/{id}/{clip}_none_{n}.png'}]};
  pack.ui = {...pack.ui, tabs: {}, tools: []};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}, {hex: '#ffffff'}, {hex: '#ff0000'}]}));
  await write('m.json', JSON.stringify({assets: [{id: 'btn', category: 'ui', size: [6, 6], output_path: 'src/', directions: ['none'], animations: {idle: {frames: 2, loop: true}}},
    {id: 'orb', category: 'ui', size: [4, 4], output_path: 'src/', directions: ['none'], animations: {spin: {frames: 1}}}]}));
  const frame = (w, h, rgb) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4); return encodePixels(w, h, px); };
  await write('proc/ui/btn/idle_none_0.png', frame(6, 6, [255, 255, 255]));
  await write('proc/ui/btn/idle_none_1.png', frame(6, 6, [255, 0, 0]));
  await write('proc/ui/orb/spin_none_0.png', frame(4, 4, [255, 255, 255]));
  return dir;
}

test('a second project works from its own pack: default set, shipped pages, byte-identical proof, a real difference found, exports, ledger', async t => {
  const root = await tinyProject(t), lib = path.join(root, 'lib');
  const got = await call(root, lib, 'GET', 'sets');
  assert.equal(got.status, 200, got.message);
  const sets = got.json.sets;
  assert.deepEqual(sets.map(s => [s.id, s.chunked, s.studioPack, s.authority.registered]), [['core', false, true, false]]);
  assert.equal(sets[0].shipped.web.pages, 0, 'nothing shipped yet');
  // ship an atlas the way this project would: the same bytes the studio packer writes
  const pack = loadPackSync(root), index = await loadAssetIndex(pack, root), [set] = atlasSets(pack);
  const packed = await packSet(root, pack, index, set, {});
  for (const [name, p] of Object.entries(packed.profiles)) await writeStaged(path.join(root, 'atl', name), p.files);
  const pages = await call(root, lib, 'GET', 'pages', {query: {set: 'core', profile: 'mobile'}});
  assert.deepEqual([pages.json.spec.padding, pages.json.pages[0].frameCount], [1, 3]);
  assert.deepEqual(pages.json.pages[0].frames.map(f => [f.key, f.asset, f.clip]).sort(), [['ui/btn/idle_none_0', 'btn', 'idle'], ['ui/btn/idle_none_1', 'btn', 'idle'], ['ui/orb/spin_none_0', 'orb', 'spin']]);
  const same = await call(root, lib, 'POST', 'pack', {body: {set: 'core'}});
  assert.equal(same.status, 200, same.message);
  assert.deepEqual(Object.values(same.json.profiles).map(p => p.comparison.verdict), ['identical', 'identical']);
  // change one processed pixel: the comparison names the first differing pixel
  const changed = Buffer.alloc(6 * 6 * 4); for (let i = 0; i < 36; i++) changed.set([255, 0, 0, 255], i * 4);
  await fs.writeFile(path.join(root, 'proc/ui/btn/idle_none_0.png'), encodePixels(6, 6, changed));
  const diff = await call(root, lib, 'POST', 'pack', {body: {set: 'core'}});
  const bad = diff.json.profiles.mobile.comparison;
  assert.equal(bad.verdict, 'differs');
  assert.deepEqual([bad.first.name, bad.first.reason], ['atlas-0.png', 'pixels']);
  assert.equal(typeof bad.first.firstDifference.x, 'number');
  const exp = await call(root, lib, 'POST', 'export', {body: {set: 'core', profile: 'mobile', formats: ['phaser', 'aseprite', 'tiled']}});
  assert.equal(exp.status, 200, exp.message);
  assert.ok(exp.json.formats[2].notes[0].includes('no tileset'));
  const ledger = (await call(root, lib, 'GET', 'ledger')).json;
  assert.deepEqual([ledger.summary.total, ledger.summary.counts['not-recorded']], [2, 2], 'nothing recorded, so nothing claimed');
  assert.deepEqual(ledger.components, []);
});

test('ATLAS-002: a packer that writes into a shipped directory and then fails is reported as a shipped change, not as an ordinary failure', async t => {
  const root = await tinyProject(t), lib = path.join(root, 'lib');
  await fs.mkdir(path.join(root, 'atl/web'), {recursive: true});
  await fs.writeFile(path.join(root, 'atl/web/atlas-0.json'), '{}');
  await fs.mkdir(path.join(root, 'bin'));
  const packFile = path.join(root, 'studio.project.json');
  const pack = JSON.parse(await fs.readFile(packFile, 'utf8'));
  const evil = {id: 'core', atlases: 'core', processed: 'core', profiles: ['web', 'mobile'], authority: {build: {command: 'pack', args: ['--output', '{out}']}}};
  pack.ui.tabs = {atlas: {sets: [evil]}};
  pack.adapters = {...pack.adapters, interpreter: {command: 'bin/interp.sh', args: []}, commands: {pack: {script: 'fake.py', args: []}}};
  await fs.writeFile(packFile, JSON.stringify(pack));
  await fs.writeFile(path.join(root, 'fake.py'), '');
  const interp = (touch) => fs.writeFile(path.join(root, 'bin/interp.sh'), `#!/bin/sh\n${touch ? `echo moved > '${path.join(root, 'atl/web/atlas-0.json')}'\n` : ''}echo boom >&2\nexit 1\n`, {mode: 0o755});
  await interp(false);
  const plain = await call(root, lib, 'POST', 'pack', {body: {set: 'core', engine: 'authority'}});
  assert.deepEqual([plain.status, plain.code], [502, 'authority_failed'], 'a failure that touched nothing is an ordinary failure');
  await interp(true);
  const moved = await call(root, lib, 'POST', 'pack', {body: {set: 'core', engine: 'authority'}});
  assert.deepEqual([moved.status, moved.code], [500, 'shipped_changed']);
  assert.match(moved.message, /atl/);
  assert.match(moved.message, /boom|exited 1|failed/);
});

test('a chunk with no shipped atlas is empty, not over budget, and has nothing to pack (409)', async t => {
  const root = await hollowProject(t), lib = path.join(root, 'lib');
  const {status, json, message} = await call(root, lib, 'GET', 'sets');
  assert.equal(status, 200, message);
  const set = json.sets.find(x => x.id === 'longtime');
  assert.deepEqual(set.chunks.map(c => c.id), ['hollow']);
  assert.equal(set.chunks[0].shipped.mobile.budget.state, 'empty');
  assert.equal(set.chunks[0].shipped.mobile.pages, 0);
  for (const engine of ['studio', 'authority']) {
    const r = await call(root, lib, 'POST', 'pack', {body: {set: 'longtime', chunk: 'hollow', engine}});
    assert.equal(r.status, 409, `${engine}: ${r.message}`);
  }
  assert.equal((await call(root, lib, 'POST', 'pack', {body: {set: 'longtime', chunk: 'nope', engine: 'studio'}})).status, 404);
});
