import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject, writeFrame } from './testkit.mjs';
import { openProject } from './project.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn, opts = { git: true }) => {
  const p = makeProject(opts);
  try { return await fn(p); } finally { await p.cleanup(); }
};

// ---- context -------------------------------------------------------------------------------
test('catalog_search: filters, derived status, facets and paging agree', () => withProject(async (p) => {
  const { ok, call } = connect(p.root, { scope: 'read' });
  const all = await ok('studio_catalog_search', { limit: 100 });
  assert.equal(all.total, 303, 'core 97 + longtime 126 + longtime vfx 6 + vfx 13 + audio 61');
  assert.equal(all.facets.source.core, 97);
  assert.equal(all.facets.source.audio, 61);

  const lt = await ok('studio_catalog_search', { source: 'longtime', limit: 5 });
  assert.equal(lt.total, 126);
  assert.equal(lt.count, 5);
  assert.equal(lt.hasMore, true);
  const next = await ok('studio_catalog_search', { source: 'longtime', limit: 5, offset: lt.nextOffset });
  assert.deepEqual(next.results.map((r) => r.id).filter((id) => lt.results.some((x) => x.id === id)), [], 'pages do not overlap');
  assert.ok(next.results[0].id > lt.results.at(-1).id, 'stable id order');

  // The fixture holds processed frames and atlases for exactly one Longtime asset.
  const packed = await ok('studio_catalog_search', { source: 'longtime', status: 'packed' });
  assert.deepEqual(packed.results.map((r) => r.id), ['lt_kiln_keeper']);
  const planned = await ok('studio_catalog_search', { source: 'longtime', status: 'planned', limit: 100 });
  assert.equal(planned.total, 124);   // #96 recorded one more asset as approved; lt_ashen_crown_b is one more planned ID in the fixture
  assert.equal((await ok('studio_catalog_search', { chunk: 'mist_archive', profile: 'npc', source: 'longtime' })).results.every((r) => r.profile === 'npc' && r.chunk === 'mist_archive'), true);
  const q = await ok('studio_catalog_search', { query: 'KILN' });
  assert.ok(q.results.some((r) => r.id === 'lt_kiln_keeper') && q.results.every((r) => r.id.includes('kiln') || (r.brief ?? '').toLowerCase().includes('kiln')));
  assert.equal((await ok('studio_catalog_search', { category: 'bgm' })).results.every((r) => r.source === 'audio'), true);

  assert.match(text(await call('studio_catalog_search', { limit: 0 })), /Invalid arguments/);
  assert.match(text(await call('studio_catalog_search', { status: 'approved' })), /must be one of/, 'status vocabulary has no approved');
}));

test('asset_get: spec, milestones, frames, dependencies; typos get suggestions', () => withProject(async (p) => {
  const { ok, call } = connect(p.root, { scope: 'read' });
  const kk = await ok('studio_asset_get', { assetId: 'lt_kiln_keeper' });
  assert.equal(kk.status, 'packed');
  assert.deepEqual(kk.spec.size, [32, 32]);
  assert.deepEqual(Object.keys(kk.spec.clips), ['idle', 'interact']);
  assert.equal(kk.milestones.processed.state, 'complete');
  assert.equal(kk.milestones.web.found, 32);
  assert.equal(kk.frames.processed.missingCount, 0);
  assert.equal(kk.frames.raw.count, 0);
  assert.ok(Array.isArray(kk.dependencies));

  const planned = await ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['spec', 'milestones', 'frames'] });
  assert.equal(planned.status, 'planned');
  assert.equal(planned.milestones.processed.state, 'absent');
  assert.equal(planned.frames.processed.missingCount, 32);
  assert.deepEqual(Object.keys(planned).sort(), ['category', 'frames', 'id', 'milestones', 'source', 'spec', 'status']);

  const core = await ok('studio_asset_get', { assetId: 'wl_outer_disciple', sections: ['spec'] });
  assert.equal(core.spec.source, 'core');
  const audio = await ok('studio_asset_get', { assetId: 'bgm_hengyue' });
  assert.equal(audio.milestones, null, 'audio has no frame milestones');

  const typo = await call('studio_asset_get', { assetId: 'lt_seed_brokr' });
  assert.equal(typo.isError, true);
  assert.match(text(typo), /Did you mean: lt_seed_broker/);
  assert.match(text(await call('studio_asset_get', { assetId: 'zzzzzzzz' })), /No asset "zzzzzzzz"/);
}));

test('asset_plan: create and edit planned entries without touching the locked manifest', () => withProject(async (p) => {
  const author = connect(p.root, { scope: 'author' });
  const manifestBefore = readFileSync(join(p.root, 'assets/manifest_longtime.json'));
  const created = await author.ok('studio_asset_plan', { op: 'create', id: 'lt_lantern_monk', profile: 'npc', chunk: 'abode', brief: 'A monk who carries a paper lantern.', dependencies: ['lt_kiln_keeper'] });
  assert.equal(created.created, true);
  assert.equal(created.entry.studio.createdBy.agent, 'tester');
  assert.equal(created.entry.phase, 'later');
  assert.equal(created.file, 'assets/studio_plans.json');
  assert.deepEqual(readFileSync(join(p.root, 'assets/manifest_longtime.json')), manifestBefore, 'the design manifest is byte-identical');

  const found = await author.ok('studio_catalog_search', { query: 'lantern_monk' });
  assert.deepEqual(found.results.map((r) => r.id), ['lt_lantern_monk']);
  assert.equal(found.results[0].origin, 'studio-plan');
  assert.deepEqual((await author.ok('studio_catalog_search', { origin: 'studio-plan' })).results.map((r) => r.id), ['lt_lantern_monk']);
  assert.equal((await author.ok('studio_catalog_search', { origin: 'manifest', source: 'longtime', limit: 1 })).total, 126);
  const got = await author.ok('studio_asset_get', { assetId: 'lt_lantern_monk', sections: ['spec', 'dependencies'] });
  assert.equal(got.plan.etag, created.etag);
  assert.equal(got.spec.size[0], 32);
  assert.deepEqual(got.dependencies, [{ id: 'lt_kiln_keeper', status: 'packed' }]);

  const edited = await author.ok('studio_asset_plan', { op: 'edit', id: 'lt_lantern_monk', etag: created.etag, brief: 'A monk with a lantern and a bell.', phase: 'wave_1' });
  assert.equal(edited.entry.brief, 'A monk with a lantern and a bell.');
  assert.equal(edited.entry.studio.createdBy.agent, 'tester');
  assert.ok(edited.entry.studio.updatedBy);
  assert.notEqual(edited.etag, created.etag);

  const stale = await author.call('studio_asset_plan', { op: 'edit', id: 'lt_lantern_monk', etag: created.etag, brief: 'stale' });
  assert.equal(stale.isError, true);
  assert.match(text(stale), /changed since you read it/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'edit', id: 'lt_lantern_monk', brief: 'no etag' })), /needs the etag/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'edit', id: 'lt_seed_broker', etag: 'x', brief: 'hijack' })), /locked manifest/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'edit', id: 'lt_nothing_here', etag: 'x', brief: 'y' })), /No planned entry/);

  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_lantern_monk', profile: 'npc', chunk: 'abode', brief: 'dup' })), /already exists/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_seed_broker', profile: 'npc', chunk: 'abode', brief: 'dup' })), /already exists/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lantern_monk', profile: 'npc', chunk: 'abode', brief: 'b' })), /lt_some_name/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_x_one', profile: 'wizard', chunk: 'abode', brief: 'b' })), /Unknown profile "wizard". Choose one of: player/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_x_one', profile: 'npc', chunk: 'moon', brief: 'b' })), /Unknown chunk "moon"/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_x_one', profile: 'npc', chunk: 'abode', brief: 'b', dependencies: ['lt_ghost'] })), /not a known asset id/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'create', id: 'lt_x_one', profile: 'npc', chunk: 'abode' })), /needs brief/);
  assert.match(text(await author.call('studio_asset_plan', { op: 'delete', id: 'lt_lantern_monk' })), /must be one of/, 'there is no delete');

  const read = connect(p.root, { scope: 'read' });
  assert.equal((await read.call('studio_asset_plan', { op: 'create', id: 'lt_x_two', profile: 'npc', chunk: 'abode', brief: 'b' })).isError, true);
  assert.equal((await read.rpc('tools/list')).result.tools.some((t) => t.name === 'studio_asset_plan'), false, 'hidden from read connections');
}));

// ---- frames_submit -------------------------------------------------------------------------
const idleSouth = (variantBase = 0) => clipFrames('idle', 'south', 4, 32, 32, variantBase);

test('frames_submit: a defective batch writes nothing and reports coordinates', () => withProject(async (p) => {
  const { call, session } = connect(p.root);
  const good = makeFrame(32, 32, { variant: 2 });
  const bad = makeFrame(32, 32, { variant: 3, damage: [{ x: 10, y: 12, kind: 'alpha' }, { x: 14, y: 15, kind: 'color' }, { x: 6, y: 9, kind: 'gap' }] });
  const r = await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [
    { clip: 'idle', direction: 'south', n: 0, pngBase64: good.png.toString('base64') },
    { clip: 'idle', direction: 'south', n: 1, pngBase64: bad.png.toString('base64') }] });
  assert.equal(r.isError, true);
  const rep = r.structuredContent;
  assert.equal(rep.accepted, false);
  assert.match(rep.message, /Nothing was written/);
  assert.equal(rep.frames[0].errors, 0);
  const defects = rep.frames[1].defects;
  const at = (code) => defects.filter((d) => d.code === code).map((d) => [d.x, d.y]);
  assert.deepEqual(at('partial_alpha'), [[10, 12]]);
  assert.deepEqual(at('off_palette'), [[14, 15]]);
  assert.deepEqual(at('outline_gap'), [[6, 9]]);
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames')), false, 'no directory, no files');
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-submissions.jsonl')), false, 'no log line');
  void session;
}));

test('frames_submit: writes once, records who and what, starts pending, and raw is immutable', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const dry = await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth(), dryRun: true });
  assert.equal(dry.accepted, true);
  assert.equal(dry.wouldWrite.length, 4);
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames')), false, 'dry run wrote nothing');

  const r = await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: { ...PROVENANCE, rights: 'original', parentIds: ['lt_kiln_keeper'], generator: 'tools/generators/x.py' }, frames: idleSouth() });
  assert.equal(r.accepted, true);
  assert.deepEqual(r.written, [0, 1, 2, 3].map((n) => `assets/raw/longtime/lt_seed_broker/frames/idle_south_${n}.png`));
  assert.equal(r.provenance.agent, 'codex');
  assert.equal(r.provenance.session, a.session, 'the server, not the client, supplies the session');
  assert.equal(r.progress.submitted, 4);
  assert.equal(r.progress.expected, 32);
  assert.equal(r.status, 'pending');

  const log = readFileSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].agent, log[0].session, log[0].tool, log[0].sourceHash, log[0].rights, log[0].parentIds], ['codex', a.session, PROVENANCE.tool, PROVENANCE.sourceHash, 'original', ['lt_kiln_keeper']]);
  assert.equal(log[0].frames.length, 4);
  assert.match(log[0].frames[0].sha256, /^[0-9a-f]{64}$/);

  const rawBefore = readdirSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames')).map((f) => readFileSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames', f)));
  const same = await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth() });
  assert.deepEqual(same.written, [], 'identical resubmission is idempotent');
  assert.equal(same.unchanged.length, 4);

  const changed = await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth(9) });
  assert.equal(changed.isError, true);
  assert.match(text(changed), /Raw frames are immutable/);
  const rawAfter = readdirSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames')).map((f) => readFileSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames', f)));
  assert.deepEqual(rawAfter, rawBefore, 'bytes on disk did not change');

  const reviews = await a.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' });
  assert.deepEqual(reviews.byStatus, { pending: 4 }, 'every submitted frame has a history and starts pending, not approved');
  const got = await a.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['milestones', 'provenance', 'frames'] });
  assert.equal(got.status, 'authored');
  assert.equal(got.milestones.source.state, 'present');
  assert.equal(got.provenance.submissions, 1);
  assert.deepEqual(got.provenance.authors, [{ agent: 'codex', session: a.session.slice(0, 8) }]);
  assert.equal(got.frames.raw.count, 4);
  assert.equal(got.frames.raw.missingCount, 28);
}));

test('frames_submit: provenance is mandatory and specific', () => withProject(async (p) => {
  const { call } = connect(p.root);
  const frames = idleSouth();
  const tryIt = async (provenance) => text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', frames, provenance }));
  assert.match(await tryIt({ sourceHash: PROVENANCE.sourceHash, prompt: 'x' }), /Invalid arguments.*tool/s);
  assert.match(await tryIt({ tool: 't', prompt: 'x' }), /Invalid arguments.*sourceHash/s);
  assert.match(await tryIt({ tool: 't', prompt: 'x', sourceHash: 'abc' }), /does not match/);
  assert.match(await tryIt({ tool: 't', sourceHash: PROVENANCE.sourceHash }), /prompt .* or a generator/s);
  assert.match(await tryIt({ tool: 't', prompt: '   ', sourceHash: PROVENANCE.sourceHash }), /prompt .* or a generator/s);
  assert.match(await tryIt({ tool: 't', generator: '../escape.py', sourceHash: PROVENANCE.sourceHash }), /project-relative/);
  assert.match(await tryIt({ tool: 't', prompt: 'x', sourceHash: PROVENANCE.sourceHash, parentIds: ['lt_ghost'] }), /not a known asset id/);
  const missing = text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', frames }));
  assert.match(missing, /missing required property "provenance"/);
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker')), false);
}));

test('frames_submit: addressing, sizes and sources are validated', () => withProject(async (p) => {
  const { call, ok } = connect(p.root);
  const one = (extra) => call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, pngBase64: makeFrame(32, 32).png.toString('base64'), ...extra }] });
  assert.match(text(await one({ clip: 'dance' })), /no clip "dance". Clips: idle, interact/);
  assert.match(text(await one({ direction: 'up' })), /no direction "up"/);
  assert.match(text(await one({ n: 4 })), /idle has 4 frames; n must be 0 to 3/);
  assert.match(text(await one({ pngBase64: makeFrame(24, 24).png.toString('base64') })), /does not match the npc profile \(32x32\)/);
  assert.match(text(await one({ pngBase64: Buffer.from('nope').toString('base64') })), /not a readable PNG/);
  assert.match(text(await one({ pngBase64: '!!!' })), /canonical base64/);
  assert.match(text(await one({ file: 'a.png' })), /exactly one of pngBase64 or file/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0 }] })), /exactly one of pngBase64 or file/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: '../../etc/passwd' }] })), /project-relative/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: '/etc/passwd' }] })), /project-relative/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: 'nowhere/x.png' }] })), /file not found/);
  writeFileSync(join(p.root, 'work-big.png'), Buffer.alloc(200 * 1024, 1));
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: 'work-big.png' }] })), /bytes; the limit is/);
  (await import('node:fs')).mkdirSync(join(p.root, 'work-dir.png'));
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: 'work-dir.png' }] })), /not a regular file/);
  const dup = idleSouth(); dup[1] = { ...dup[0] };
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: dup })), /appears twice/);

  // A file the agent wrote in the project is read, then gated like any other source.
  writeFrame(p.root, 'work/seed.png', makeFrame(32, 32, { variant: 4 }));
  const viaFile = await ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip: 'idle', direction: 'south', n: 0, file: 'work/seed.png' }] });
  assert.equal(viaFile.accepted, true);
  assert.equal(viaFile.written.length, 1);

  // Not every asset is open for submission.
  assert.match(text(await call('studio_frames_submit', { assetId: 'lt_kiln_keeper', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) })), /already has processed or packed frames/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'wl_outer_disciple', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) })), /only design-manifest assets are/);
  assert.match(text(await call('studio_frames_submit', { assetId: 'bgm_hengyue', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) })), /an audio cue, not a frame asset/);
  const read = connect(p.root, { scope: 'read' });
  assert.equal((await read.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth() })).isError, true);
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames/idle_south_1.png')), false);
}));

test('frames_submit: a failure after the files are written rolls them back', () => withProject(async (p) => {
  // Point the revision library at a regular file: the store step fails AFTER the PNGs were written.
  const brokenLibrary = join(p.root, '..', `broken-library-${process.pid}-${Date.now()}`);
  writeFileSync(brokenLibrary, 'not a directory');
  const project = openProject(p.root, { libraryDir: brokenLibrary });
  const { call } = connect(project);
  const r = await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth() });
  assert.equal(r.isError, true);
  const dir = join(p.root, 'assets/raw/longtime/lt_seed_broker/frames');
  assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], [], 'every file created by the failed call was removed');
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-submissions.jsonl')), false, 'and no log line was written');
  (await import('node:fs')).rmSync(brokenLibrary, { force: true });
}));

test('frames_submit: something that is not a regular file blocks the batch with a clear message', () => withProject(async (p) => {
  const { ok, call } = connect(p.root);
  await ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [idleSouth()[0]] });
  (await import('node:fs')).mkdirSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames/idle_south_2.png'));
  const r = await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: idleSouth() });
  assert.equal(r.isError, true);
  assert.match(text(r), /not a regular file; nothing was written/);
  assert.deepEqual(readdirSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/frames')).sort(), ['idle_south_0.png', 'idle_south_2.png']);
}));

test('frames_submit and metadata_set: inherited Object.prototype names are not clips', () => withProject(async (p) => {
  const { call } = connect(p.root);
  const png = makeFrame(32, 32).png.toString('base64');
  for (const clip of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    const r = await call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: [{ clip, direction: 'south', n: 0, pngBase64: png }] });
    assert.equal(r.isError, true, clip);
    assert.match(text(r), new RegExp(`no clip "${clip}". Clips: idle, interact`), clip);
  }
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker')), false, 'no directory, no frame, no log line, no revision history');
  assert.equal(existsSync(join(p.root, '.inspector-revisions')), false);
  // The same names as metadata clip keys, in every shape a patch can take: a real payload, an empty object
  // (which would pass every other check) and null (a "clear"). JSON.parse makes __proto__ a real own key,
  // as a client's JSON would.
  for (const clip of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    for (const value of ['{"frameMs":[100,100,100,100]}', '{}', 'null']) {
      const r = await call('studio_metadata_set', JSON.parse(`{"assetId":"lt_seed_broker","clips":{"${clip}":${value}}}`));
      assert.equal(r.isError, true, `${clip}: ${value}`);
      assert.match(text(r), new RegExp(`no clip "${clip}"`), `${clip}: ${value}`);
    }
  }
  const mixed = await call('studio_metadata_set', JSON.parse('{"assetId":"lt_seed_broker","clips":{"idle":{"frameMs":[1,1,1,1]},"constructor":{}}}'));
  assert.match(text(mixed), /no clip "constructor"/, 'one bad name refuses the whole patch');
  assert.equal(existsSync(join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-metadata.json')), false, 'no metadata file was created, not even by the mixed patch that contained a valid clip');
  assert.equal(Object.keys(Object.prototype).length, 0, 'Object.prototype was not polluted');
}));

// ---- metadata_set --------------------------------------------------------------------------
test('metadata_set: pivot, hitbox, durations and events, with bounds and etags', () => withProject(async (p) => {
  const { ok, call } = connect(p.root);
  const first = await ok('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [16, 30], hitbox: { x: 8, y: 6, w: 16, h: 24 },
    clips: { idle: { frameMs: [200, 200, 220, 200], events: [{ frame: 2, name: 'sway' }] } } });
  assert.equal(first.file, 'assets/raw/longtime/lt_seed_broker/studio-metadata.json');
  assert.deepEqual(first.metadata.pivot, [16, 30]);
  assert.equal(first.metadata.updated.agent, 'tester');
  const got = await ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['metadata'] });
  assert.equal(got.metadata.etag, first.etag);
  assert.deepEqual(got.metadata.clips.idle.events, [{ frame: 2, name: 'sway' }]);

  assert.match(text(await call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [1, 1] })), /pass the etag/);
  assert.match(text(await call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [1, 1], etag: 'old' })), /changed since you read it|pass the etag/);

  const second = await ok('studio_metadata_set', { assetId: 'lt_seed_broker', etag: first.etag, pivot: [15, 29], clips: { interact: { frameMs: [140, 140, 140, 300] } } });
  assert.deepEqual(second.metadata.pivot, [15, 29]);
  assert.deepEqual(second.metadata.hitbox, { x: 8, y: 6, w: 16, h: 24 }, 'unmentioned fields keep their value');
  assert.deepEqual(second.metadata.clips.idle.frameMs, [200, 200, 220, 200], 'unmentioned clips keep theirs');
  const clearedClip = await ok('studio_metadata_set', { assetId: 'lt_seed_broker', etag: second.etag, clips: { interact: null } });
  assert.equal('interact' in clearedClip.metadata.clips, false, 'null still clears a real clip');
  const cleared = await ok('studio_metadata_set', { assetId: 'lt_seed_broker', etag: clearedClip.etag, hitbox: null });
  assert.equal('hitbox' in cleared.metadata, false, 'null clears a field');

  const bad = (args) => call('studio_metadata_set', { assetId: 'lt_seed_broker', etag: cleared.etag, ...args }).then(text);
  assert.match(await bad({ pivot: [32, 0] }), /inside the 32x32 frame/);
  assert.match(await bad({ pivot: [-1, 4] }), /inside the 32x32 frame/);
  assert.match(await bad({ hitbox: { x: 20, y: 0, w: 20, h: 4 } }), /fully inside/);
  assert.match(await bad({ hitbox: { x: 0, y: 0, w: 0, h: 4 } }), /at least 1/);
  assert.match(await bad({ clips: { idle: { frameMs: [100, 100] } } }), /must list 4 integers/);
  assert.match(await bad({ clips: { idle: { frameMs: [100, 100, 100, 0] } } }), /Invalid arguments|1 to 60000/);
  assert.match(await bad({ clips: { idle: { events: [{ frame: 4, name: 'x' }] } } }), /frame: 0-3/);
  assert.match(await bad({ clips: { idle: { events: [{ frame: 1, name: 'Bad Name' }] } } }), /lower_snake_case/);
  assert.match(await bad({ clips: { dance: { frameMs: [1] } } }), /no clip "dance"/);
  assert.match(await bad({}), /at least one of pivot, hitbox, clips/);
  assert.match(text(await call('studio_metadata_set', { assetId: 'lt_kiln_keeper', pivot: [1, 1] })), /already has processed or packed frames/);
  assert.match(text(await call('studio_metadata_set', { assetId: 'wl_outer_disciple', pivot: [1, 1] })), /only design-manifest assets/);
  const after = await ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['metadata'] });
  assert.equal(after.metadata.etag, cleared.etag, 'rejected calls changed nothing');
}));
