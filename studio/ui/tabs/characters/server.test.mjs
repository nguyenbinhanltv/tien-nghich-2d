import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../../../serve.mjs';
import { summarizeRig, parseFrameFile, handle } from './server.mjs';
import { makeProject } from '../../../mcp/testkit.mjs';
import { layoutSheet, largestScale, maxSheetPixels } from './sheet.mjs';
import { decodePng } from '../../../forge/image.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const json = file => JSON.parse(fs.readFileSync(root + file, 'utf8'));
let server, base;
test.before(async () => {
  server = createPreviewServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => new Promise(ok => server.close(ok)));
const get = async path => { const r = await fetch(base + '/api/tabs/characters/' + path); return {status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer())}; };
const api = async path => { const r = await get(path); return {status: r.status, data: JSON.parse(r.body)}; };

test('roster: every character of the configured categories, with readiness, from the manifests', async () => {
  const {data} = await api('roster');
  const config = json('studio.project.json').ui.tabs.characters;
  const core = json('assets/manifest.json').assets.filter(a => config.categories.includes(a.category));
  const longtime = json('assets/manifest_longtime.json');
  const lt = longtime.assets.filter(a => config.categories.includes(longtime.profiles[a.profile].category));
  assert.equal(data.characters.length, core.length + lt.length);
  // Pinned today: 22 core characters and 32 Longtime characters.
  assert.deepEqual([core.length, lt.length, data.counts.total], [22, 32, 54]);
  assert.deepEqual(data.counts.byCategory, {player: 8, mob: 27, boss: 7, npc: 6, pet: 6});
  // Planned means no processed frames yet, worked out here from the files, not from the API.
  const planned = lt.filter(a => !fs.existsSync(root + 'assets/processed_longtime/' + a.id) ||
    fs.readdirSync(root + 'assets/processed_longtime/' + a.id).length === 0).map(a => a.id).sort();
  assert.deepEqual(data.characters.filter(c => c.readiness === 'planned').map(c => c.id).sort(), planned);
  assert.equal(data.counts.byReadiness.planned, planned.length, 'a zero count is 0, not absent');
  assert.deepEqual(Object.keys(data.counts.byReadiness).sort(), ['authored', 'packed', 'planned']);
  for (const c of data.characters) {
    assert.ok(['planned', 'authored', 'packed'].includes(c.readiness), c.id);
    assert.equal(c.frameCount > 0, c.readiness !== 'planned' || c.frameCount > 0);
    if (c.readiness === 'planned') assert.equal(c.thumb, null, c.id);
    else assert.ok(fs.existsSync(root + c.thumb), c.thumb);
  }
  assert.deepEqual(data.facings, config.facings);
});

test('asset: a core character has frames, raw frames, a foot point and a card', async () => {
  const {status, data} = await api('asset?id=wl_outer_disciple');
  assert.equal(status, 200);
  const record = json('assets/manifest.json').assets.find(a => a.id === 'wl_outer_disciple');
  assert.equal(data.frames.length, record.total_frames);
  assert.deepEqual(Object.keys(data.clips), Object.keys(record.animations));
  assert.equal(data.clips.idle.ms, null, 'the manifest defines no frame time for core clips');
  assert.equal(data.defaultFrameMs, 100);
  assert.deepEqual(data.foot, [16, 31]);
  assert.equal(data.rawFrames.length, record.total_frames);
  assert.ok(data.frames.every(f => fs.existsSync(root + f.path)) && data.rawFrames.every(f => fs.existsSync(root + f.path)));
  assert.equal(data.card.names.en, record.name.en);
  assert.deepEqual(data.card.palette.map(p => p.id), record.palette_refs);
  assert.ok(data.card.palette.every(p => /^#[0-9a-f]{6}$/.test(p.hex)));
  assert.equal(data.rig, null);
  assert.equal(data.motion, null);
  assert.equal(data.hitbox, null);
});

test('asset: the rigged character shows its rig, motion templates and forge experiment', async () => {
  const {data} = await api('asset?id=lt_ink_marten');
  assert.equal(data.clips.idle.ms, 180);
  assert.equal(data.clips.follow.ms, 120);
  assert.equal(data.rig.format, 'prototype');
  assert.deepEqual(Object.keys(data.rig.facings).sort(), ['east', 'north', 'south', 'west']);
  assert.match(data.rig.markerHex, /^#[0-9a-f]{6}$/);
  assert.ok(data.rig.facings.south.landmarks[0].box.length === 4);
  assert.equal(data.motion.bodyPlan, 'quadruped');
  assert.deepEqual(data.motion.clips.map(c => c.clip), ['idle', 'follow']);
  assert.ok(data.motion.clips.every(c => c.template && c.archetype && c.tracks.length > 0 && typeof c.loop === 'boolean'));
  assert.equal(data.motion.clips[1].template, 'pet/follow');
  assert.equal(data.experiment.frames, 32);
  assert.equal(data.bakeFrames.length, 32);
  assert.ok(fs.existsSync(root + data.experiment.turnaround) && data.experiment.sheetSha256.length === 64);
  assert.ok(data.card.provenance.tool && data.card.provenance.rights);
});

// The planned cases run on a fixture project (a trimmed copy of the pack) with one planned character added, so they
// hold whatever the real project has planned or finished.
async function onFixture(fn) {
  const p = makeProject();
  try {
    const file = p.root + '/assets/manifest_longtime.json';
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    const model = manifest.assets.find(a => manifest.profiles[a.profile].category === 'npc');
    manifest.assets.push({...model, id: 'lt_fixture_planned', brief: 'A fixture character that has no art yet.'});
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    const call = async name => {
      let status = 200, type, out;
      const res = {writeHead(s, h) { status = s; type = h?.['Content-Type']; }, end(b) { out = Buffer.from(b ?? ''); }};
      try { await handle({method: 'GET'}, res, new URL('http://127.0.0.1/api/tabs/characters/' + name), {root: fs.realpathSync(p.root), prefix: "/api/tabs/characters/"}); }
      catch (error) { return {status: error.status, data: null}; }
      return {status, type, body: out, data: type?.startsWith('application/json') ? JSON.parse(out) : null};
    };
    return await fn(call);
  } finally { await p.cleanup(); }
}

test('asset: a planned character has no frames but keeps its brief, clips and directions', () => onFixture(async call => {
  const {data: roster} = await call('roster');
  assert.equal(roster.counts.byReadiness.planned, roster.characters.filter(c => c.readiness === 'planned').length);
  const planned = roster.characters.find(c => c.id === 'lt_fixture_planned');
  assert.equal(planned.readiness, 'planned');
  assert.equal(planned.thumb, null);
  assert.ok(planned.brief && planned.clips.length > 0, 'a planned character still shows its brief and clip plan in the roster');
  const {status, data} = await call('asset?id=lt_fixture_planned');
  assert.equal(status, 200);
  assert.deepEqual([data.frames.length, data.rawFrames.length], [0, 0]);
  assert.ok(data.brief && Object.keys(data.clips).length > 0 && data.directions.length > 0);
  assert.equal(data.rig, null);
  assert.equal((await call('sheet.png?id=lt_fixture_planned&scale=2')).status, 404, 'a character with no frames has no contact sheet');
}));

test('roster: a project with no planned character reports a planned count of 0', async () => {
  const p = makeProject();
  try {
    const {readFileSync, writeFileSync} = fs;
    // give every planned character a frame by pointing the roster at a manifest with only the finished one
    const file = p.root + '/assets/manifest_longtime.json';
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    const done = fs.readdirSync(p.root + '/assets/processed_longtime');
    manifest.assets = manifest.assets.filter(a => done.includes(a.id));
    writeFileSync(file, JSON.stringify(manifest, null, 2));
    let out;
    await handle({method: 'GET'}, {writeHead() {}, end(b) { out = JSON.parse(b); }}, new URL('http://127.0.0.1/api/tabs/characters/roster'), {root: fs.realpathSync(p.root), prefix: "/api/tabs/characters/"});
    assert.equal(out.counts.byReadiness.planned, 0);
    assert.ok(out.counts.byReadiness.authored + out.counts.byReadiness.packed > 0);
  } finally { await p.cleanup(); }
});

test('asset: bad ids, unknown ids and non-characters are refused', async () => {
  assert.equal((await api('asset')).status, 422);
  assert.equal((await api('asset?id=../../etc')).status, 422);
  assert.equal((await api('asset?id=no_such_character')).status, 404);
  assert.equal((await api('asset?id=prop_alchemy_jar')).status, 404, 'props are not characters');
  assert.equal((await api('nothing')).status, 404);
  const post = await fetch(base + '/api/tabs/characters/roster', {method: 'POST', body: '{}'});
  assert.equal(post.status, 405);
});

test('contact sheet: a deterministic PNG with every clip and facing', async () => {
  const a = await get('sheet.png?id=lt_ink_marten&scale=2'), b = await get('sheet.png?id=lt_ink_marten&scale=2');
  assert.deepEqual([a.status, a.type], [200, 'image/png']);
  assert.ok(a.body.equals(b.body), 'same bytes twice');
  const sheet = decodePng(a.body);
  // 2 clips x 4 facings x 32px frames at 2x, 4 frames per row.
  const layout = layoutSheet({frames: (await api('asset?id=lt_ink_marten')).data.frames, facings: ['south', 'east', 'north', 'west'], scale: 2, size: [32, 32], labelWidth: 38});
  assert.equal(layout.rows.length, 8);
  assert.deepEqual([sheet.width, sheet.height], [layout.width, layout.height]);
  const one = await get('sheet.png?id=lt_ink_marten&scale=1&clip=idle');
  assert.ok(decodePng(one.body).height < decodePng(a.body).height);
  assert.equal((await get('sheet.png?id=lt_ink_marten&scale=99')).status, 422);
  assert.equal((await get('sheet.png?id=no_such_one&scale=2')).status, 404);
});

test('rig summaries for the studio format and the prototype format', () => {
  const studio = summarizeRig({schema: 'studio.rig', bodyPlan: 'biped', canvas: [32, 32], pivot: [16, 29], facings: {
    south: {forward: [0, 1], parts: [{id: 'leg_0', role: 'leg', phase: 0, contact: [10, 28], cut: [[0, 0]]}, {id: 'body', role: 'body'}],
      landmarks: [{id: 'left_hand', color: 'soul_07', box: [1, 2, 3, 4]}]},
    east: {mirrorOf: 'west', parts: [], landmarks: []}}});
  assert.equal(studio.format, 'studio.rig');
  assert.deepEqual(studio.facings.south.parts[0], {id: 'leg_0', role: 'leg', joint: null, contact: [10, 28], phase: 0});
  assert.equal(studio.facings.east.mirrorOf, 'west');
  assert.ok(!('cut' in studio.facings.south.parts[0]), 'polygons are not sent to the client');
  const proto = summarizeRig({marker: 'soul_07', facings: {south: {forward: [0, 1], mark_pixels: [[1, 1]], left_ear_box: [1, 2, 3, 4],
    tail: {joint: [5, 5], cut: [[0, 0]]}, paws: [{phase: 0, contact: [2, 3]}, {phase: 1, contact: [4, 5]}]}}});
  assert.deepEqual(proto.facings.south.parts.map(p => p.id), ['tail', 'paw_0', 'paw_1']);
  assert.deepEqual(proto.facings.south.landmarks[0], {id: 'left_ear', color: 'soul_07', box: [1, 2, 3, 4], expect: 'present', pixels: [[1, 1]]});
  assert.equal(proto.marker, 'soul_07');
});

test('frame file names parse into clip, direction and number', () => {
  assert.deepEqual(parseFrameFile('a/b/cast_attack_east_12.png'), {clip: 'cast_attack', direction: 'east', n: 12});
  assert.deepEqual(parseFrameFile('x/idle_none_0.png'), {clip: 'idle', direction: 'none', n: 0});
  assert.equal(parseFrameFile('anchor.json'), null);
});

test('contact sheet: oversized requests are refused with 422 and the largest allowed scale', async () => {
  const boss = (await api('asset?id=boss_ancient_god_remnant')).data;
  const facings = ['south', 'east', 'north', 'west'];
  const size = boss.size;
  const largest = largestScale({frames: boss.frames, facings, size});
  const at = scale => { const l = layoutSheet({frames: boss.frames, facings, scale, size, labelWidth: 38}); return l.width * l.height; };
  assert.ok(largest >= 1 && largest < 8, 'the biggest character cannot be exported at 8x with every clip');
  assert.ok(at(largest) <= maxSheetPixels && at(largest + 1) > maxSheetPixels, 'largest is exactly the biggest scale that fits');
  assert.ok(at(8) > 100e6, 'scale 8 would be over 100 megapixels, the case the limit exists for');
  const refused = await api('sheet.png?id=boss_ancient_god_remnant&scale=8');
  assert.equal(refused.status, 422);
  assert.equal(refused.data.error.code, 'sheet_too_large');
  assert.match(refused.data.error.message, new RegExp(`largest scale for this character is ${largest}\\.`));
  const ok = await get(`sheet.png?id=boss_ancient_god_remnant&scale=${largest}`);
  assert.equal(ok.status, 200);
  const image = decodePng(ok.body);
  assert.ok(image.width * image.height <= maxSheetPixels);
  // One clip at the top scale is allowed when it fits.
  const clip = Object.keys(boss.clips)[0];
  const l = layoutSheet({frames: boss.frames, facings, scale: 8, clip, size, labelWidth: 38});
  const single = await get(`sheet.png?id=boss_ancient_god_remnant&scale=8&clip=${clip}`);
  assert.equal(single.status, l.width * l.height <= maxSheetPixels ? 200 : 422);
  // Every ordinary character still exports at 8x for a single clip, and the limit is enforced before any decoding.
  assert.equal((await get('sheet.png?id=lt_ink_marten&scale=8&clip=idle')).status, 200);
});

test('largestScale: 0 when even 1x does not fit, 8 for a small sheet', () => {
  const frame = (n, clip = 'a') => ({clip, direction: 'south', n, path: `${clip}_${n}.png`});
  assert.equal(largestScale({frames: [frame(0)], facings: ['south'], size: [32, 32]}), 8);
  const many = Array.from({length: 4000}, (_, n) => frame(n));
  assert.equal(largestScale({frames: many, facings: ['south'], size: [96, 96]}), 0);
});
