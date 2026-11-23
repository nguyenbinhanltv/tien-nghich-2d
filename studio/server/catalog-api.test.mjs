import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../serve.mjs';
import { destinations } from './catalog-api.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = file => JSON.parse(fs.readFileSync(root + file, 'utf8'));
let server, base;
test.before(async () => {
  server = createPreviewServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(ok => server.close(ok)));
const get = async path => { const r = await fetch(base + path); return {status: r.status, data: await r.json()}; };

test('project: name, theme colours and tabs come from the pack and palette', async () => {
  const {status, data} = await get('/api/studio/project');
  const pack = json('studio.project.json'), palette = json(pack.palette.file);
  assert.equal(status, 200);
  assert.equal(data.name, pack.name);
  assert.deepEqual(data.languages, pack.ui.languages);
  const hex = id => palette.colors.find(c => c.id === id).hex;
  for (const [role, id] of Object.entries(pack.ui.theme)) assert.equal(data.theme[role], hex(id), role);
  assert.deepEqual(data.tabs.map(t => t.id), destinations);
  for (const t of data.tabs) assert.equal(t.built, fs.existsSync(root + `studio/ui/tabs/${t.id}/index.mjs`), t.id);
  assert.equal(data.tabs.find(t => t.id === 'overview').built, true);
  assert.deepEqual(data.tools.map(t => t.id), pack.ui.tools.map(t => t.id));
  assert.equal(data.sources.find(s => s.id === 'longtime_effects').label.en, pack.catalog.sources[1].effectsLabel.en);
});

test('assets: lists everything and filters by category, readiness, chunk, wave and text', async () => {
  const all = await get('/api/studio/assets?limit=1000');
  assert.equal(all.data.total, all.data.assets.length);
  assert.equal((await get('/api/studio/assets?limit=7&offset=3')).data.assets.length, 7);
  const mobs = (await get('/api/studio/assets?category=mob&limit=1000')).data;
  assert.ok(mobs.total > 0 && mobs.assets.every(a => a.category === 'mob'));
  const planned = (await get('/api/studio/assets?readiness=planned&limit=1000')).data;
  // Every reserved audio cue is produced now (the Characters wave was the last), so nothing is planned: the filter must still return only planned assets.
  assert.ok(planned.assets.every(a => a.readiness === 'planned'));
  const packed = (await get('/api/studio/assets?readiness=packed&limit=1000')).data;
  assert.ok(packed.total > 0 && packed.assets.every(a => a.readiness === 'packed'));
  const longtime = json('assets/manifest_longtime.json');
  const wave1 = (await get('/api/studio/assets?wave=wave_1')).data;
  assert.equal(wave1.total, longtime.assets.filter(a => a.phase === 'wave_1').length);
  const abode = (await get('/api/studio/assets?chunk=abode&limit=1000')).data;
  assert.equal(abode.total, longtime.assets.filter(a => a.chunk_group === 'abode').length + longtime.vfx.entries.filter(e => e.chunk_group === 'abode').length);
  assert.ok(abode.assets.every(a => a.source.startsWith('longtime')));
  const byId = (await get('/api/studio/assets?q=LT_KILN_KEEPER')).data;
  assert.deepEqual(byId.assets.map(a => a.id), ['lt_kiln_keeper']);
  const byName = (await get('/api/studio/assets?q=rogue%20outer')).data;
  assert.ok(byName.assets.some(a => a.id === 'mob_rogue_disciple'));
  assert.equal((await get('/api/studio/assets?q=zzzz-no-such')).data.total, 0);
  assert.ok(all.data.facets.category.mob && all.data.facets.readiness.packed && all.data.facets.source.core);
  assert.equal(all.data.facets.source.core, 90);
});

test('asset: frames, clips and provenance pointers', async () => {
  const {status, data} = await get('/api/studio/assets/wl_outer_disciple');
  assert.equal(status, 200);
  const record = json('assets/manifest.json').assets.find(a => a.id === 'wl_outer_disciple');
  assert.deepEqual(Object.keys(data.clips), Object.keys(record.animations));
  assert.equal(data.clips.idle.frames, record.animations.idle.frames);
  assert.equal(data.frames.length, record.total_frames);
  assert.ok(data.frames.every(f => fs.existsSync(root + f.path)));
  assert.ok(data.provenance.some(p => p.note !== 'manifest' && p.exists), 'a provenance pointer other than the manifest');
  assert.ok(data.provenance.some(p => p.note === 'manifest' && p.path === 'assets/manifest.json'));
  const fx = (await get('/api/studio/assets/hit_spark')).data;
  assert.equal(fx.frames.length, 12);
  assert.ok(Object.keys(fx.clips).length > 0 && fx.frames[0].durationMs > 0);
  const lt = (await get('/api/studio/assets/lt_kiln?source=longtime')).data;
  assert.ok(lt.frames.length > 0 && lt.asset.chunk === 'abode');
  const sfx = (await get('/api/studio/assets/sfx_dash')).data;
  assert.equal(sfx.asset.source, 'audio');
  assert.ok(sfx.provenance.some(p => p.note === 'manifest'));
  assert.ok(sfx.provenance.some(p => /provenance\.json$/.test(p.path) && p.exists));
});

test('OVERVIEW-004: errors are JSON and the API is read-only and loopback-only', async () => {
  assert.equal((await get('/api/studio/assets/no_such_asset')).status, 404);
  assert.equal((await get('/api/studio/nope')).status, 404);
  assert.equal((await get('/api/studio/overview/extra')).status, 404);
  assert.equal((await get('/api/tabs/overview/anything')).status, 404);
  const post = await fetch(base + '/api/studio/project', {method: 'POST', body: '{}'});
  assert.equal(post.status, 405);
  const status = await new Promise((ok, fail) => http.get({host: '127.0.0.1', port: server.address().port, path: '/api/studio/project',
    headers: {Host: 'evil.example:' + server.address().port}}, res => { res.resume(); ok(res.statusCode); }).on('error', fail));
  assert.equal(status, 403);
  const crossOrigin = await fetch(base + '/api/studio/project', {headers: {Origin: 'http://evil.example'}});
  assert.equal(crossOrigin.status, 403);
});

test('overview: pins today\'s totals and agrees with the manifests read directly', async () => {
  const {data} = await get('/api/studio/overview');
  const core = json('assets/manifest.json'), longtime = json('assets/manifest_longtime.json');
  const vfx = json('assets/processed/vfx/vfx_index.json'), audio = json('assets/audio_manifest.json');
  // Pinned: the project today has 90 core assets, 126 Longtime IDs, 6 Longtime VFX, 12 VFX, 46 core audio IDs.
  assert.equal(data.bySource.core.total, 90);
  assert.equal(data.bySource.longtime.total, 126);
  assert.equal(data.bySource.longtime_effects.total, 6);
  assert.equal(data.bySource.vfx.total, 12);
  assert.equal(data.bySourceGroup.audio.core.total, 46);
  // And they are the manifests' own numbers, not a copy.
  assert.equal(data.bySource.core.total, core.assets.length);
  assert.equal(data.bySource.longtime.total, longtime.assets.length);
  assert.equal(data.bySource.longtime_effects.total, longtime.vfx.entries.length);
  assert.equal(data.bySource.vfx.total, vfx.effects.length);
  assert.equal(data.bySourceGroup.audio.core.total, Object.values(audio.core).flat().length);
  // Readiness adds up everywhere.
  const check = c => assert.equal(c.planned + c.authored + c.packed, c.total);
  for (const c of [data.overall, ...Object.values(data.bySource), ...Object.values(data.byCategory), ...Object.values(data.byWave)]) check(c);
  assert.equal(data.overall.total, Object.values(data.bySource).reduce((n, c) => n + c.total, 0));
  assert.deepEqual(data.readinessOrder, ['planned', 'authored', 'packed']);
  // Waves come from the design manifest's phases.
  assert.equal(data.byWave.wave_1.total, longtime.wave_1.length);
  assert.equal(Object.values(data.byWave).reduce((n, c) => n + c.total, 0), longtime.assets.length);
});

test('overview: chunk budgets use the ceilings of the Longtime manifest and the chunk atlas files', async () => {
  const {data} = await get('/api/studio/overview');
  const longtime = json('assets/manifest_longtime.json');
  assert.deepEqual(data.chunks.map(c => [c.chunk, c.ceilingPages]), Object.entries(longtime.chunks));
  const pageBytes = longtime.mobile.page[0] * longtime.mobile.page[1] * longtime.mobile.bytes_per_pixel;
  for (const c of data.chunks) {
    assert.equal(c.ceilingBytes, c.ceilingPages * pageBytes);
    const file = root + `assets/atlases_longtime/mobile/${c.chunk}/chunk-manifest.json`;
    if (fs.existsSync(file)) {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual([c.pages, c.bytes, c.frames], [m.page_count, m.rgba8_bytes, m.frame_count]);
      assert.equal(c.state, c.pages > c.ceilingPages ? 'over' : c.pages === c.ceilingPages ? 'full' : 'ok');
    } else assert.deepEqual([c.state, c.pages], ['none', 0]);
  }
  // No chunk is over its ceiling today (the build enforces it); this guards a silent regression.
  assert.ok(data.chunks.every(c => c.state !== 'over'));
});

test('the shell is served at /studio/ and the old previewer keeps its deep links', async () => {
  const shell = await (await fetch(base + '/studio/')).text();
  assert.match(shell, /ui\/shell\.js/);
  assert.doesNotMatch(shell, /arena-canvas/);
  for (const url of ['/studio/?tab=inspector', '/studio/?tab=arena', '/preview-app/?tab=inspector', '/studio/previewer.html']) {
    const html = await (await fetch(base + url)).text();
    assert.match(html, /id="arena-canvas"/, url);
    assert.match(html, /id="inspector-canvas"/, url);
  }
  assert.match(await (await fetch(base + '/preview-app/')).text(), /ui\/shell\.js/);
  assert.equal((await fetch(base + '/', {redirect: 'manual'})).headers.get('location'), '/studio/');
});
