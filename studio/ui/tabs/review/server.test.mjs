import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { revisionStore } from '../../../core/store.mjs';
import { bareFrame, agentTag } from '../../../core/review.mjs';
import { encodePixels } from '../../../core/png.mjs';
import { readInbox } from './inbox.mjs';
import { openSignoffs } from './signoff.mjs';
import { handle, clearAudioCache } from './server.mjs';
import { makeProject } from '../../../mcp/testkit.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const lib = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'review-lib-'));
const png = (shade) => { const px = Buffer.alloc(4 * 4 * 4); for (let i = 0; i < 16; i++) px.set([shade, 0, 0, 255], i * 4); return encodePixels(4, 4, px); };

async function call(dir, name, {method = 'GET', headers = {}, body, projectRoot = root} = {}) {
  let status = 200, out;
  const req = body === undefined ? {method, headers} : Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method, headers: {'content-type': 'application/json', ...headers}});
  const res = {writeHead(s) { status = s; }, end(text) { out = JSON.parse(text); }};
  try { await handle(req, res, new URL('http://127.0.0.1/api/tabs/review/' + name), {root: projectRoot, prefix: '/api/tabs/review/', libraryDir: dir}); }
  catch (error) { return {status: error.status, error: error.code}; }
  return {status, body: out};
}

test('inbox: pending heads wait on the human, changes_requested on the agent, agent requests are parsed, unjudged baselines are skipped', () => {
  const dir = lib();
  const store = revisionStore(root, '.inspector-revisions', dir);
  const frame = key => bareFrame(key, {assetId: key.split('/')[1]});
  const base = png(10);
  // a: agent submitted revision 0 as pending and asked for review
  store.operate(frame('longtime/a/idle_south_0'), base, 'review', {revision: 0, status: 'pending'});
  store.operate(frame('longtime/a/idle_south_0'), base, 'review', {revision: 0, text: agentTag({agent: 'codex', session: '3fa9c120abcd'}) + ' REVIEW REQUEST rq-0a1b2c3d: Please look.\nQuestions:\n1. Too dark?'});
  // b: edited (pending head 1), then the human asked for changes
  store.operate(frame('longtime/b/idle_south_0'), base, 'save', {baseRevision: 0, png: png(20)});
  store.operate(frame('longtime/b/idle_south_0'), base, 'review', {revision: 1, status: 'changes_requested', text: 'Redo the edge.'});
  // c: approved with a comment; d: only touched by a read, never judged
  store.operate(frame('longtime/c/idle_south_0'), base, 'review', {revision: 0, status: 'approved', text: 'Good.'});
  store.operate(frame('longtime/d/idle_south_0'), base, 'frame', {});
  store.close();

  const items = readInbox(dir);
  assert.deepEqual(items.map(i => [i.assetId, i.state, i.head]), [['a', 'waiting', 0], ['b', 'agent', 1], ['c', 'decided', 0]]);
  assert.deepEqual(items[0].requests, [{request: 'rq-0a1b2c3d', agent: 'codex', session: '3fa9c120', note: 'Please look.', questions: ['Too dark?']}]);
  assert.deepEqual(readInbox(path.join(dir, 'missing')), []);
});

test('route inbox returns art items and the audio masters waiting for a listening', async () => {
  const dir = lib();
  const {status, body} = await call(dir, 'inbox');
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.ok(body.audio.length > 10 && body.audio.every(a => a.signoff === null));
  const by = label => body.audio.filter(a => a.label === label).map(a => a.id).sort();
  // all 46 audio assets are approved on the project record: pilot_v1 and batch 1 earlier, batches 2 to 4 stated by the owner on 2026-11-22
  assert.equal(body.audio.length, 46);
  assert.equal(by('approved_before').length, 46);
  assert.ok(by('approved_before').includes('bgm_dong_phu') && by('approved_before').includes('bgm_hengyue') && by('approved_before').includes('sfx_dash') && by('approved_before').includes('sfx_tell_light'));
  assert.equal(body.audio.filter(a => a.state === 'decided').length, 46);
  assert.equal(body.audio.filter(a => a.state === 'waiting').length, 0);
  const kinds = Object.fromEntries(body.audio.map(a => [a.id, a.approval.kind]));
  assert.equal(Object.values(kinds).filter(k => k === 'owner_statement').length, 28, 'batches 2 to 4 are owner statements');
  assert.equal(kinds.bgm_blood_sea, 'owner_statement');
  assert.equal(kinds.bgm_dong_phu, 'before_studio');
});

test('audio detail: real master, waveform, recorded measurements and hash', async () => {
  const dir = lib();
  const {body} = await call(dir, 'audio?id=bgm_dong_phu');
  assert.equal(body.master, 'assets/audio/bgm_dong_phu/master.wav');
  assert.match(body.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(body.wave.min.length, 600);
  assert.ok(body.wave.durationSeconds > 70 && body.wave.max.some(v => v > 0.05));
  assert.ok(body.measurements.qa.integrated_lufs < 0);
  assert.deepEqual(body.status, {state: 'decided', label: 'approved_before'});   // the user approved the pilot before the studio existed
  assert.deepEqual([body.approval.approvedBy, body.approval.approvalId, body.approval.current], ['user', 'pilot_v1', true]);
});

test('REVIEW-001: listening sign-off: only a browser page records it, only for the exact master, and a changed master reads as stale', async () => {
  const dir = lib();
  const detail = (await call(dir, 'audio?id=bgm_blood_sea')).body;
  const ok = {id: 'bgm_blood_sea', content: detail.contentHash, verdict: 'signed', note: 'Heard it.'};
  const browser = {'sec-fetch-site': 'same-origin'};
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', body: ok})).error, 'human_only');                                   // no browser header
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: {'sec-fetch-site': 'none'}, body: ok})).error, 'human_only');
  assert.equal((await call(dir, 'audio?id=bgm_blood_sea')).body.status.label, 'approved_before');                                       // nothing was written: the record still covers it
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, content: 'a'.repeat(64)}})).error, 'master_changed');
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, verdict: 'approved'}})).status, 422);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, extra: 1}})).status, 422);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, id: 'nope'}})).status, 404);
  assert.equal((await call(dir, 'audio-signoff', {method: 'GET', headers: browser})).status, 405);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: ok})).status, 200);
  const after = (await call(dir, 'audio?id=bgm_blood_sea')).body;
  assert.equal(after.status.label, 'signed');
  assert.equal(after.signoffs[0].note, 'Heard it.');
  const row = (await call(dir, 'inbox')).body.audio.find(a => a.id === 'bgm_blood_sea');
  assert.deepEqual([row.state, row.label, row.signoff.verdict, row.signoff.current], ['decided', 'signed', 'signed', true]);
  // a sign-off given to other bytes no longer counts; the record's approval of the exact current bytes still does
  const other = openSignoffs(dir);
  other.record({asset: 'bgm_blood_sea', content: 'b'.repeat(64), verdict: 'signed'});
  assert.equal((await call(dir, 'audio?id=bgm_blood_sea')).body.status.label, 'approved_before');
  other.close();
});

test('the studio database file must be a real file in a real directory', () => {
  const dir = lib();
  fs.writeFileSync(path.join(dir, 'real.txt'), '');
  fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'studio.sqlite'));
  assert.throws(() => openSignoffs(dir).record({asset: 'a', content: 'c'.repeat(64), verdict: 'signed'}), /Invalid studio database file/);
});

test('REVIEW-002: no MCP code can reach the sign-off or the review routes', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) files.push(p); } })(path.join(root, 'studio/mcp'));
  assert.ok(files.length > 10);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /listening_signoffs|audio-signoff|api\/tabs\/review|ui\/tabs\/review|\/api\/editor\/review/, f);
});

test('REVIEW-003: a regenerated master drops back to waiting, whether the old verdict was a sign-off here or an approval from before the studio', async () => {
  const p = makeProject({extraDirs: ['assets/audio/bgm_blood_sea', 'assets/audio/bgm_hengyue']});
  for (const d of ['assets/atlases/web', 'assets/audio/packs', 'assets/audio/source']) fs.mkdirSync(path.join(p.root, d), {recursive: true}); // dirs the pack names but this test does not need
  fs.cpSync(path.join(root, 'assets/audio/listening_approvals.json'), path.join(p.root, 'assets/audio/listening_approvals.json'));
  const dir = lib();
  try {
    clearAudioCache();
    const here = async id => (await call(dir, 'inbox', {projectRoot: p.root})).body.audio.find(a => a.id === id);
    const hash = (await call(dir, 'audio?id=bgm_blood_sea', {projectRoot: p.root})).body.contentHash;
    await call(dir, 'audio-signoff', {method: 'POST', headers: {'sec-fetch-site': 'same-origin'}, projectRoot: p.root, body: {id: 'bgm_blood_sea', content: hash, verdict: 'signed'}});
    clearAudioCache();
    assert.deepEqual([(await here('bgm_blood_sea')).state, (await here('bgm_hengyue')).label], ['decided', 'approved_before']);
    // regenerate both masters (different bytes, different size)
    for (const id of ['bgm_blood_sea', 'bgm_hengyue']) fs.appendFileSync(path.join(p.root, 'assets/audio', id, 'master.wav'), Buffer.alloc(8));
    clearAudioCache();
    const signed = await here('bgm_blood_sea'), earlier = await here('bgm_hengyue');
    assert.deepEqual([signed.state, signed.label, signed.signoff.current], ['waiting', 'stale', false]);
    assert.deepEqual([earlier.state, earlier.label, earlier.approval.current], ['waiting', 'stale', false]);
    const detail = (await call(dir, 'audio?id=bgm_hengyue', {projectRoot: p.root})).body;
    assert.deepEqual(detail.status, {state: 'waiting', label: 'stale'});
    assert.equal(detail.approval.current, false);
  } finally { clearAudioCache(); await p.cleanup(); }
});

test('the inbox hashes each master once: unchanged files are not read again', async () => {
  const {hashOf} = await import('./hashes.mjs');
  const first = await hashOf(root, 'assets/audio/bgm_dong_phu/master.wav');
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) assert.equal(await hashOf(root, 'assets/audio/bgm_dong_phu/master.wav'), first);
  assert.ok(performance.now() - t0 < 500, 'cached hashes are a stat each, not a 12 MB read');
});

test('the inbox carries the art approved on record, and a changed frame stops being covered', async () => {
  const {body} = await call(lib(), 'inbox');
  assert.equal(body.artRecords.length, 132, 'eight earlier assets, the 30 new characters and 93 other Longtime assets approved on 2026-11-22, plus lt_ashen_crown_b');
  assert.ok(body.artRecords.every(r => r.current && r.matching === r.frames));
  const p = makeProject({extraDirs: ['assets/audio/bgm_blood_sea']});
  fs.mkdirSync(path.join(p.root, 'assets/review'), {recursive: true});
  const frame = 'assets/x/a/a_0.png';
  fs.mkdirSync(path.join(p.root, 'assets/x/a'), {recursive: true}); fs.writeFileSync(path.join(p.root, frame), 'png');
  const sha = (await import('node:crypto')).createHash('sha256').update('png').digest('hex');
  fs.writeFileSync(path.join(p.root, 'assets/review/art_approvals.json'), JSON.stringify({approvals: [{id: 'r', approved_by: 'user', assets: {a: {frame_dir: 'assets/x/a', frames: {'g/a/a_0': sha}}}}]}));
  try {
    for (const d of ['assets/atlases/web', 'assets/audio/packs', 'assets/audio/source']) fs.mkdirSync(path.join(p.root, d), {recursive: true});
    clearAudioCache();
    const pack = JSON.parse(fs.readFileSync(path.join(p.root, 'studio.project.json'), 'utf8'));
    pack.directories.approvals = 'assets/review'; fs.writeFileSync(path.join(p.root, 'studio.project.json'), JSON.stringify(pack));
    clearAudioCache();
    assert.deepEqual((await call(lib(), 'inbox', {projectRoot: p.root})).body.artRecords.map(r => [r.assetId, r.current]), [['a', true]]);
    fs.writeFileSync(path.join(p.root, frame), 'edited');
    assert.deepEqual((await call(lib(), 'inbox', {projectRoot: p.root})).body.artRecords.map(r => [r.current, r.changed]), [[false, 1]]);
  } finally { clearAudioCache(); p.cleanup?.(); }
});

test('Review and Audio both read 46 of 46 audio assets as approved', async () => {
  const {listeningOf, stageOf} = await import('../audio/model.mjs');
  const {body} = await call(lib(), 'inbox');
  assert.equal(body.audio.length, 46);
  assert.equal(body.audio.filter(a => a.state === 'decided').length, 46, 'Review: 46 decided, none waiting');
  const audioTab = body.audio.map(a => listeningOf({stage: stageOf(a.readiness), signoff: a.signoff, masterSha: null, evidence: 'pending', record: a.label}));
  assert.deepEqual([audioTab.filter(x => x === 'approved').length, audioTab.length], [46, 46], 'Audio tab: 46 of 46 approved');
});
