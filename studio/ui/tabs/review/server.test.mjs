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
import { handle } from './server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const lib = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'review-lib-'));
const png = (shade) => { const px = Buffer.alloc(4 * 4 * 4); for (let i = 0; i < 16; i++) px.set([shade, 0, 0, 255], i * 4); return encodePixels(4, 4, px); };

async function call(dir, name, {method = 'GET', headers = {}, body} = {}) {
  let status = 200, out;
  const req = body === undefined ? {method, headers} : Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method, headers: {'content-type': 'application/json', ...headers}});
  const res = {writeHead(s) { status = s; }, end(text) { out = JSON.parse(text); }};
  try { await handle(req, res, new URL('http://127.0.0.1/api/tabs/review/' + name), {root, prefix: '/api/tabs/review/', libraryDir: dir}); }
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
});

test('audio detail: real master, waveform, recorded measurements and hash', async () => {
  const dir = lib();
  const {body} = await call(dir, 'audio?id=bgm_dong_phu');
  assert.equal(body.master, 'assets/audio/bgm_dong_phu/master.wav');
  assert.match(body.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(body.wave.min.length, 600);
  assert.ok(body.wave.durationSeconds > 70 && body.wave.max.some(v => v > 0.05));
  assert.ok(body.measurements.qa.integrated_lufs < 0);
  assert.equal(body.signoffState, 'none');
});

test('listening sign-off: only a browser page records it, only for the exact master, and a changed master reads as stale', async () => {
  const dir = lib();
  const detail = (await call(dir, 'audio?id=bgm_hengyue')).body;
  const ok = {id: 'bgm_hengyue', content: detail.contentHash, verdict: 'signed', note: 'Heard it.'};
  const browser = {'sec-fetch-site': 'same-origin'};
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', body: ok})).error, 'human_only');                                   // no browser header
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: {'sec-fetch-site': 'none'}, body: ok})).error, 'human_only');
  assert.equal((await call(dir, 'audio?id=bgm_hengyue')).body.signoffState, 'none');                                                   // nothing was written
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, content: 'a'.repeat(64)}})).error, 'master_changed');
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, verdict: 'approved'}})).status, 422);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, extra: 1}})).status, 422);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: {...ok, id: 'nope'}})).status, 404);
  assert.equal((await call(dir, 'audio-signoff', {method: 'GET', headers: browser})).status, 405);
  assert.equal((await call(dir, 'audio-signoff', {method: 'POST', headers: browser, body: ok})).status, 200);
  const after = (await call(dir, 'audio?id=bgm_hengyue')).body;
  assert.equal(after.signoffState, 'signed');
  assert.equal(after.signoffs[0].note, 'Heard it.');
  assert.equal((await call(dir, 'inbox')).body.audio.find(a => a.id === 'bgm_hengyue').signoff.verdict, 'signed');
  // a sign-off given to other bytes no longer counts
  const other = openSignoffs(dir);
  other.record({asset: 'bgm_hengyue', content: 'b'.repeat(64), verdict: 'signed'});
  assert.equal((await call(dir, 'audio?id=bgm_hengyue')).body.signoffState, 'stale');
  other.close();
});

test('the studio database file must be a real file in a real directory', () => {
  const dir = lib();
  fs.writeFileSync(path.join(dir, 'real.txt'), '');
  fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'studio.sqlite'));
  assert.throws(() => openSignoffs(dir).record({asset: 'a', content: 'c'.repeat(64), verdict: 'signed'}), /Invalid studio database file/);
});

test('no MCP code can reach the sign-off or the review routes', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) files.push(p); } })(path.join(root, 'studio/mcp'));
  assert.ok(files.length > 10);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /listening_signoffs|audio-signoff|api\/tabs\/review|ui\/tabs\/review|\/api\/editor\/review/, f);
});
