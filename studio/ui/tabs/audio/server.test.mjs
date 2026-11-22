import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handle, previewLength, sendFile } from './server.mjs';
import { renderDocument, decodeWav } from '../../../audio/index.mjs';
import { realPack } from '../../../core/tests/helpers.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sha = buf => createHash('sha256').update(buf).digest('hex');

function mockRes() {
  const chunks = [];
  const res = new Writable({write(chunk, enc, cb) { chunks.push(chunk); cb(); }});
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.done = new Promise(resolve => res.on('finish', resolve));
  res.body = () => Buffer.concat(chunks);
  return res;
}
async function call(where, path_, {method = 'GET', headers = {}, body} = {}) {
  const prefix = '/api/tabs/audio/';
  const req = body === undefined ? {method, headers} : Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method, headers: {'content-type': 'application/json', ...headers}});
  const res = mockRes();
  try { await handle(req, res, new URL('http://127.0.0.1' + prefix + path_), {root: where, prefix}); }
  catch (error) { return {status: error.status, error: error.code, issues: error.issues}; }
  if (!res.writableEnded) await res.done;
  return {status: res.status ?? 200, headers: res.headers, raw: res.body(), json: () => JSON.parse(res.body().toString())};
}

test('the library lists every cue with a stage that follows the packs', async () => {
  const r = await call(root, 'library');
  const lib = r.json();
  assert.equal(r.status, 200);
  const count = f => lib.entries.filter(f).length;
  assert.ok(count(e => e.kind === 'bed') >= 11 && count(e => e.kind === 'effect') >= 50, 'core 6+40 plus the later allocations');
  assert.equal(count(e => e.kind === 'bed' && e.stage === 'packed'), 6, 'all six beds are in a pack, including the packs that list several beds');
  assert.equal(count(e => e.kind === 'effect' && e.stage === 'packed'), 40);
  assert.ok(count(e => e.stage === 'planned') >= 15);
  const blade = lib.entries.find(e => e.id === 'sfx_blade');
  assert.deepEqual(blade.packs.length, 1);
  assert.ok(blade.families.some(f => f.family === 'arm_blade' && f.role === 'release'));
  assert.match(blade.masterSha, /^[0-9a-f]{64}$/);
  assert.ok(lib.entries.find(e => e.id === 'bgm_hengyue').modes.some(m => m.mode === 'core' && m.event === 'entry'));
  assert.equal(lib.packs.length, 5);
});

test('a bed carries its loop, recorded figures and pack evidence', async () => {
  const d = (await call(root, 'cue?id=bgm_hengyue')).json();
  assert.deepEqual(d.loop, {start: 0, end: 3087000});
  assert.equal(d.recorded.integratedLufs, -21.66);
  assert.deepEqual(d.recorded.signedSeamStep, [-56, -60]);
  assert.equal(d.masterInfo.sampleRate, 44100);
  assert.equal(d.masterInfo.frames, 3087000);
  const pack = d.packDetails[0];
  assert.equal(pack.id, 'wave2_batch1_v1');
  assert.ok(pack.bed.codecs.ogg.loop.start > 0 && pack.bed.codecs.m4a.seam.snrDb > 20);
  assert.equal(d.docPath?.endsWith('bgm_hengyue.score.json'), true);
  assert.equal((await call(root, 'cue?id=nope')).error, 'unknown_cue');
  assert.equal((await call(root, 'cue?id=../x')).error, 'invalid_input');
});

test('an effect from a batch pack has its sprite markers and the ledger figures', async () => {
  const d = (await call(root, 'cue?id=sfx_dash')).json();
  assert.equal(d.recorded.samplePeakDbfs, -3.491);
  const sfx = d.packDetails[0].sfx;
  assert.ok(sfx.hasCue && sfx.guardFrames === 8192);
  const mark = sfx.codecs.ogg.markers.find(m => m.id === 'sfx_dash');
  assert.ok(mark.sprite_end_exclusive > mark.sprite_start);
  assert.ok(d.beds.some(b => b.id === 'bgm_hengyue'), 'beds to play it over');
});

test('live measurements agree with the ledger and the images are PNGs', async () => {
  const m = (await call(root, 'measure?id=sfx_dash')).json();
  assert.equal(m.measurements.peak.sampleDbfs, -3.491);
  assert.equal(m.loop, null);
  const img = await call(root, 'image?id=sfx_dash&kind=spectrogram&width=400');
  assert.deepEqual([...img.raw.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(img.headers['Content-Type'], 'image/png');
  const axes = (await call(root, 'image?id=sfx_dash&kind=waveform&width=400&axes=1')).json();
  assert.equal(axes.axes.kind, 'waveform');
  assert.equal((await call(root, 'image?id=sfx_dash&kind=waveform&width=999999')).status, 200, 'width is clamped, not refused');
});

test('files stream with ranges, and only files a pack lists are served', async () => {
  const whole = await call(root, 'master?id=sfx_dash');
  assert.equal(whole.status, 200);
  assert.equal(sha(whole.raw), (await call(root, 'cue?id=sfx_dash')).json().masterSha);
  const part = await call(root, 'master?id=sfx_dash', {headers: {range: 'bytes=0-43'}});
  assert.equal(part.status, 206);
  assert.equal(part.raw.length, 44);
  assert.equal(part.headers['Content-Range'], `bytes 0-43/${whole.raw.length}`);
  assert.equal((await call(root, 'master?id=sfx_dash', {headers: {range: 'bytes=999999999-'}})).status, 416);
  const pack = (await call(root, 'library')).json().packs[0].id;
  const ok = await call(root, `packfile?pack=${pack}&name=sfx_sprite.ogg`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'audio/ogg');
  for (const name of ['pack.json', '../pack.json', '..%2Fevidence.json', 'nope.ogg']) assert.equal((await call(root, `packfile?pack=${pack}&name=${name}`)).error, 'unknown_file', name);
  assert.equal((await call(root, 'packfile?pack=..&name=x')).error, 'unknown_file');
});

test('the closest effects by measurement are offered for a blind A/B', async () => {
  const p = (await call(root, 'pairs?count=5')).json();
  assert.equal(p.nearest.length, 5);
  assert.ok(p.nearest.every(x => x.a !== x.b && x.distance >= 0 && x.source === 'features'));
  assert.deepEqual(p.nearest.map(x => x.distance), [...p.nearest.map(x => x.distance)].sort((a, b) => a - b));
});

test('the patch behind a cue is found and validated', async () => {
  const d = (await call(root, 'doc?id=sfx_blade')).json();
  assert.equal(d.found, true);
  assert.equal(d.kind, 'patch');
  assert.deepEqual(d.issues, []);
  assert.equal((await call(root, 'doc?id=bgm_dong_phu')).json().found, false);
});

test('a preview renders into scratch, outside the repository, and matches the delivered master when nothing is changed', async () => {
  const {doc} = (await call(root, 'doc?id=sfx_dash')).json();
  const r = await call(root, 'preview', {method: 'POST', body: {doc}});
  assert.equal(r.status, 200);
  const preview = r.json();
  assert.match(preview.id, /^[0-9a-f]{16}$/);
  assert.equal(preview.kind, 'patch');
  const file = await call(root, 'preview-file?id=' + preview.id);
  assert.equal(file.status, 200);
  const master = await fs.readFile(path.join(root, (await call(root, 'cue?id=sfx_dash')).json().masterInfo.path));
  assert.ok(file.raw.equals(master), 'the unchanged document renders the delivered master byte for byte');
  // The scratch file lives in the OS temp area.
  const dir = (await fs.readdir(os.tmpdir())).find(n => n.startsWith('studio-audio-scratch-'));
  assert.ok(dir);
  assert.ok(!path.join(os.tmpdir(), dir).startsWith(root));
  // A changed parameter changes the render and the measurement.
  const louder = structuredClone(doc); louder.trim = 0.4;
  const changed = (await call(root, 'preview', {method: 'POST', body: {doc: louder}})).json();
  assert.notEqual(changed.id, preview.id);
  assert.ok(changed.measurements.peak.sampleDbfs < preview.measurements.peak.sampleDbfs - 3);
  const image = await call(root, `preview-image?id=${changed.id}&kind=waveform&width=400`);
  assert.deepEqual([...image.raw.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await call(root, 'preview-file?id=0000000000000000')).error, 'unknown_preview');
  assert.equal((await call(root, 'preview-file?id=../../etc/passwd')).error, 'unknown_preview');
});

test('a preview refuses bad documents, other rates, too-long renders, and wrong methods', async () => {
  const {doc} = (await call(root, 'doc?id=sfx_dash')).json();
  const invalid = await call(root, 'preview', {method: 'POST', body: {doc: {...doc, layers: []}}});
  assert.equal(invalid.status, 422);
  assert.ok(invalid.issues.length > 0);
  assert.equal((await call(root, 'preview', {method: 'POST', body: {doc: {...doc, sampleRate: 48000}}})).error, 'sample_rate_mismatch');
  const long = {...doc, durationMs: 60000, layers: [{...doc.layers[0], ms: 60000}]};
  assert.equal((await call(root, 'preview', {method: 'POST', body: {doc: long}})).error, 'too_long');
  assert.equal((await call(root, 'preview', {method: 'POST', body: {nothing: 1}})).error, 'invalid_input');
  assert.equal((await call(root, 'preview', {method: 'POST', body: {doc}, headers: {'content-type': 'text/plain'}})).error, 'unsupported_media_type');
  assert.equal((await call(root, 'preview')).error, 'method_not_allowed');
  assert.equal((await call(root, 'library', {method: 'POST', body: {}})).error, 'method_not_allowed');
  assert.deepEqual(previewLength({schema: 'studio.audio.patch', durationMs: 500}, 44100), {seconds: 0.5, limit: 20});
});

test('there is no sign-off route in this tab', async () => {
  for (const name of ['signoff', 'audio-signoff', 'sign', 'approve']) assert.equal((await call(root, name, {method: 'POST', body: {}})).error, 'method_not_allowed', name);
  for (const name of ['signoff', 'audio-signoff', 'sign', 'approve']) assert.equal((await call(root, name)).error, 'unknown_route', name);
});

// ---- a second project: other sample rate, its own pack and manifest, nothing named in the code ----------------------------

test('a second project with its own pack, rate and cues works with no code change', async t => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'audio-tab-second-')));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = async (rel, data) => { await fs.mkdir(path.dirname(path.join(dir, rel)), {recursive: true}); await fs.writeFile(path.join(dir, rel), data); };
  const pack = realPack();
  pack.id = 'other-game';
  pack.palette.file = 'pal.json';
  pack.catalog.sources = [{id: 'snd', kind: 'audio-plan', file: 'plan/sound.json', evidence: {packs: 'snd/packs', masters: 'snd/masters', sources: 'snd/src'}}];
  pack.editable = {overlay: 'approved.json', groups: []};
  await write('studio.project.json', JSON.stringify(pack));
  await write('pal.json', JSON.stringify({outline: '#000001', colors: [{hex: '#000001'}, {hex: '#ffffff'}]}));
  await write('plan/sound.json', JSON.stringify({core: {music: ['tune_one'], fx: ['ping', 'pong', 'later']}, families: {chime: {hit: 'ping'}}, asset_groups: {chime: ['thing_a', 'thing_b']}, modes: {main: {events: {start: 'tune_one'}}}}));
  const patch = id => ({schema: 'studio.audio.patch', version: 1, id, sampleRate: 48000, seed: 9, durationMs: 120, trim: 0.5,
    layers: [{type: 'osc', startMs: 0, ms: 120, gain: 0.8, hz: id === 'ping' ? 1200 : 700, env: {attackMs: 3, decayMs: 40, releaseMs: 30}}]});
  for (const id of ['ping', 'pong']) await write(`snd/masters/batch/${id}.wav`, renderDocument(patch(id)).wav);
  await write('snd/masters/tune_one/master.wav', renderDocument({schema: 'studio.audio.score', version: 1, id: 'tune_one', sampleRate: 48000, seed: 1, tempoBpm: 120, loop: {bars: 2},
    instruments: {p: {layers: [{type: 'osc', ratio: 1, env: {attackMs: 5, attackShape: 'exp', releaseMs: 100, releaseShape: 'exp'}}]}}, tracks: [{instrument: 'p', events: [[0, 'D4', 1, 0.5]]}]}).wav);
  await write('snd/packs/one/pack.json', JSON.stringify({pack_revision: 3, bgm: {id: 'tune_one', sample_rate_hz: 48000, channels: 2, master: {file: 'snd/masters/tune_one/master.wav', loopStart: 0, loopEnd: 96000, frames: 96000}, codecs: {}},
    sfx: {id: 'sheet', sample_rate_hz: 48000, channels: 1, guard_frames: 100, cues: [{id: 'ping', master_file: 'x', master_frames: 5760, source: {sprite_start: 100, onset: 101, tail_end_exclusive: 5000, sprite_end_exclusive: 5200}}], codecs: {}, sprite_master: {file: 'sheet.wav', frames: 6000}}}));
  await write('snd/packs/one/evidence.json', JSON.stringify({human_listening: 'pending'}));
  await write('snd/src/patches/ping.patch.json', JSON.stringify(patch('ping')));
  const first = await call(dir, 'library');
  assert.equal(first.error, undefined, JSON.stringify(first));
  const lib = first.json();
  assert.equal(lib.project, 'other-game');
  const by = id => lib.entries.find(e => e.id === id);
  assert.deepEqual([by('tune_one').kind, by('tune_one').stage, by('ping').stage, by('pong').stage, by('later').stage], ['bed', 'packed', 'packed', 'master', 'planned']);
  assert.deepEqual(by('ping').families, [{family: 'chime', role: 'hit', bound: 2}]);
  assert.equal(by('tune_one').modes[0].event, 'start');
  const cue = (await call(dir, 'cue?id=tune_one')).json();
  assert.equal(cue.masterInfo.sampleRate, 48000);
  assert.deepEqual(cue.loop, {start: 0, end: 96000});
  const ping = (await call(dir, 'cue?id=ping')).json();
  assert.equal(ping.packDetails[0].sfx.sprite.file, 'sheet.wav');
  assert.equal((await call(dir, 'doc?id=ping')).json().found, true);
  const m = (await call(dir, 'measure?id=ping')).json();
  assert.equal(m.measurements.sampleRate, 48000);
  const r = (await call(dir, 'preview', {method: 'POST', body: {doc: patch('ping')}})).json();
  assert.equal(r.sampleRate, 48000);
  assert.equal((await call(dir, 'preview', {method: 'POST', body: {doc: {...patch('ping'), sampleRate: 44100}}})).error, 'sample_rate_mismatch');
  const pairs = (await call(dir, 'pairs')).json();
  assert.deepEqual([pairs.nearest[0].a, pairs.nearest[0].b], ['ping', 'pong']);
  void decodeWav;
});

test('a file that cannot be read after it was found ends that response and does not crash the process', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-tab-vanish-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const uncaught = [];
  const onUncaught = e => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  t.after(() => process.off('uncaughtException', onUncaught));
  // stat succeeds on a directory but reading it fails (EISDIR), the same shape as a file deleted or replaced between stat and read.
  const res = mockRes();
  const closed = new Promise(resolve => res.on('close', resolve));
  await sendFile({method: 'GET', headers: {}}, res, dir, 'audio/wav');
  await closed;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(res.destroyed, true, 'the response was ended');
  assert.deepEqual(uncaught, [], 'no unhandled error escaped');
  // The ordinary path still completes.
  const file = path.join(dir, 'x.wav');
  await fs.writeFile(file, Buffer.alloc(100, 1));
  const ok = mockRes();
  await sendFile({method: 'GET', headers: {}}, ok, file, 'audio/wav');
  await ok.done;
  assert.equal(ok.body().length, 100);
});
