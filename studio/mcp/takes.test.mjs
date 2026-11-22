// Takes (D2), candidate runs (D1) and region change requests (B5): the review loop's append-only side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { bareFrame, addRegionRequest } from '../core/review.mjs';
import { saveRevision } from '../core/revisions.mjs';
import { pickCandidate } from '../core/candidates.mjs';
import { handle as reviewRoute } from '../ui/tabs/review/server.mjs';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject } from './testkit.mjs';
import { openProject } from './project.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const KEY = (n) => `longtime/lt_seed_broker/idle_south_${n}`;
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const variant = (n, count = 2, damage) => Array.from({ length: count }, (_, i) => ({ clip: 'idle', direction: 'south', n: i, pngBase64: makeFrame(32, 32, { variant: n + i, damage }).png.toString('base64') }));

async function route(p, name, { method = 'GET', headers = {}, body } = {}) {
  let status = 200, out, type;
  const req = body === undefined ? { method, headers } : Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, headers: { 'content-type': 'application/json', ...headers } });
  const res = { writeHead(s, h) { status = s; type = h?.['Content-Type']; }, end(data) { out = type?.startsWith('image/') ? data : JSON.parse(data); } };
  try { await reviewRoute(req, res, new URL('http://127.0.0.1/api/tabs/review/' + name), { root: p.root, prefix: '/api/tabs/review/', libraryDir: undefined }); }
  catch (error) { return { status: error.status, error: error.code }; }
  return { status, body: out };
}

test('REVIEW-006: a new take moves only "newest"; selected and in use stay where they were', () => withProject(async (p) => {
  const project = openProject(p.root);
  const author = connect(project, { agent: 'codex' });
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 2) });
  const ws = project.workspace, store = await ws.store();
  const file = fs.readFileSync(`${p.root}/assets/raw/longtime/lt_seed_broker/frames/idle_south_0.png`);
  const frame = { ...bareFrame(KEY(0)), standingPng: file };
  const read = () => store.operate(frame, file, 'frame', {}).takes;
  assert.deepEqual(read(), { newest: 0, selected: null, inUse: 0 });
  const r1 = await saveRevision(ws, { key: KEY(0), baseline: file, png: makeFrame(32, 32, { variant: 9 }).png });
  assert.equal(r1.head, 1);
  assert.deepEqual(read(), { newest: 1, selected: null, inUse: 0 }, 'a new take changes only newest');
  store.operate(frame, file, 'select', { revision: 1 });
  assert.deepEqual(read(), { newest: 1, selected: 1, inUse: 0 }, 'selecting records a pick, never edits the file in use');
  await saveRevision(ws, { key: KEY(0), baseline: file, png: makeFrame(32, 32, { variant: 11 }).png });
  assert.deepEqual(read(), { newest: 2, selected: 1, inUse: 0 }, 'a later take does not replace the selected one');
  const hist = store.operate(frame, file, 'frame', {}).history;
  assert.deepEqual(hist.map((h) => [h.revision, h.newest, h.selected, h.inUse]), [[2, true, false, false], [1, false, true, false], [0, false, false, true]]);
  assert.throws(() => store.operate(frame, file, 'select', { revision: 7 }), /does not exist/);
  assert.equal(store.operate(frame, file, 'frame', {}).status, 'pending', 'selecting is not approving');
}));

test('REVIEW-008, REVIEW-007: candidates: broken ones are rejected, survivors become takes, nothing is selected until a person picks', () => withProject(async (p) => {
  const project = openProject(p.root);
  const author = connect(project, { agent: 'codex' });
  const r = await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, note: 'three tries',
    candidates: [{ label: 'A', frames: variant(0) }, { label: 'B', frames: variant(3), provenance: { prompt: 'a different try', sourceHash: 'b'.repeat(64) } }, { label: 'C', frames: variant(1, 2, [{ kind: 'color', x: 16, y: 12 }]) }] });
  assert.equal(r.accepted, true);
  assert.deepEqual(r.candidates.map((c) => [c.label, c.verdict]), [['A', 'survivor'], ['B', 'survivor'], ['C', 'rejected']]);
  assert.match(r.candidates[2].reason, /palette|color/i);
  assert.equal(r.generations, 3);
  assert.deepEqual(r.candidates[0].revisions, { [KEY(0)]: 0, [KEY(1)]: 0 });
  assert.deepEqual(r.candidates[1].revisions, { [KEY(0)]: 1, [KEY(1)]: 1 });
  assert.match(r.status, /Nothing selected/);
  const store = await project.workspace.store();
  assert.equal(store.operate(bareFrame(KEY(0)), Buffer.alloc(0), 'frame', {}).takes.selected, null);

  // the sheet is a PNG; picking needs a same-origin browser request
  const sheet = await route(p, `candidate-sheet?run=${r.run}`);
  assert.equal(sheet.status, 200);
  assert.deepEqual([...sheet.body.subarray(1, 4)], [80, 78, 71]);
  assert.equal((await route(p, 'candidate-pick', { method: 'POST', body: { run: r.run, label: 'B' } })).status, 403);
  assert.equal((await route(p, 'candidate-pick', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: { run: r.run, label: 'C' } })).error, 'rejected_candidate');
  const picked = await route(p, 'candidate-pick', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: { run: r.run, label: 'B' } });
  assert.equal(picked.status, 200);
  const t = store.operate(bareFrame(KEY(1)), Buffer.alloc(0), 'frame', {}).takes;
  assert.equal(t.selected, 1);
  const runs = await route(p, 'candidates');
  assert.equal(runs.body.runs[0].picked.label, 'B');
  // nothing of this is reachable from MCP: no tool takes a pick, and every candidate is on one run
  const listed = await author.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' });
  assert.equal(listed.items[0].takes.newest, 1);
  assert.equal(typeof pickCandidate, 'function');
  // a run with every candidate broken writes nothing
  const none = await author.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, candidates: [{ frames: variant(1, 2, [{ kind: 'color', x: 16, y: 12 }]) }], dryRun: true });
  assert.match(text(none), /survivor|rejected/);
}));

test('REVIEW-008: with every candidate broken nothing is written', () => withProject(async (p) => {
  const author = connect(openProject(p.root), { agent: 'codex' });
  const r = await author.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, candidates: [{ frames: variant(1, 2, [{ kind: 'color', x: 16, y: 12 }]) }, { frames: variant(2, 2, [{ kind: 'alpha', x: 16, y: 12 }]) }] });
  assert.equal(r.isError, true);
  assert.deepEqual(r.structuredContent.candidates.map((c) => c.verdict), ['rejected', 'rejected']);
  assert.equal(fs.existsSync(`${p.root}/assets/raw/longtime/lt_seed_broker/frames`), false);
  const different = await author.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, candidates: [{ frames: variant(0, 2) }, { frames: variant(0, 1) }] });
  assert.match(text(different), /same frames/);
}));

test('REVIEW-009: a change request is pinned, append-only, and answered only by a later revision that names it', () => withProject(async (p) => {
  const project = openProject(p.root);
  const author = connect(project, { agent: 'codex' });
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 2) });
  const ws = project.workspace;
  const asked = await route(p, 'region-request', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: { key: KEY(0), revision: 0, x: 10, y: 4, w: 6, h: 6, text: 'The hat is too tall' } });
  assert.equal(asked.status, 200);
  assert.match(asked.body.hash, /^[0-9a-f]{64}$/);
  assert.equal((await route(p, 'region-request', { method: 'POST', body: { key: KEY(0), revision: 0, x: 1, y: 1, w: 2, h: 2, text: 'x' } })).status, 403);
  assert.equal((await route(p, 'region-request', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: { key: KEY(0), revision: 0, x: 30, y: 30, w: 9, h: 9, text: 'outside' } })).error, 'invalid_input');
  const id = asked.body.id;

  const listed = await author.ok('studio_review_list', { assetId: 'lt_seed_broker' });
  assert.equal(listed.openChangeRequestCount, 1);
  assert.deepEqual(listed.openChangeRequests[0].box, { x: 10, y: 4, w: 6, h: 6 });
  // asking again with an open request is refused, and the same revision cannot answer
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Fixed it.' })), /change request/);
  assert.match(text(await author.call('studio_review_reply', { key: KEY(0), revision: 0, text: 'done', answers: [id] })), /later revision/);
  const file = fs.readFileSync(`${p.root}/assets/raw/longtime/lt_seed_broker/frames/idle_south_0.png`);
  await saveRevision(ws, { key: KEY(0), baseline: file, png: makeFrame(32, 32, { variant: 12 }).png });
  const answered = await author.ok('studio_review_reply', { key: KEY(0), text: 'Shortened the hat by two pixels.', answers: [id] });
  assert.equal(answered.revision, 1);
  assert.equal(answered.answers[0].id, id);
  const db = await ws.db();
  assert.deepEqual(db.changeRequests(KEY(0))[0].answers.map((a) => a.revision), [1]);
  assert.equal((await author.ok('studio_review_list', { assetId: 'lt_seed_broker' })).openChangeRequestCount, 0);
  // append-only: not even the database path can edit or delete a note
  const raw = new (await import('node:sqlite')).DatabaseSync(`${ws.libraryDir()}/studio.sqlite`);
  assert.throws(() => raw.exec("UPDATE change_requests SET text='x'"), /append-only/);
  assert.throws(() => raw.exec('DELETE FROM change_requests'), /append-only/);
  raw.close();
  assert.equal(typeof addRegionRequest, 'function');
}));
