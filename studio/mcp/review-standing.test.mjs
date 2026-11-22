// What the MCP says about a frame nobody reviewed: awaiting review, never approved; no tool can change that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, makeProject } from './testkit.mjs';

const ASSET = 'lt_kiln_keeper';
const DIR = 'assets/processed_longtime/' + ASSET;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const frames = (root) => readdirSync(join(root, DIR)).filter((f) => f.endsWith('.png')).sort();
const record = (root, hashes) => {
  mkdirSync(join(root, 'assets/review'), { recursive: true });
  writeFileSync(join(root, 'assets/review/art_approvals.json'), JSON.stringify({ schema_version: 1, approvals: [{ id: 'r1', approved_by: 'owner',
    assets: { [ASSET]: { frame_dir: DIR, frames: Object.fromEntries(hashes) } } }] }));
};

test('frames with no revision history and no record are listed as awaiting review, not approved', () => withProject(async (p) => {
  const c = connect(p.root);
  const list = await c.ok('studio_review_list', { assetId: ASSET });
  assert.ok(list.frames > 0);
  assert.deepEqual(list.byStatus, { pending: list.frames });
  assert.equal(list.approvedByHuman, 0);
  assert.equal(list.awaitingReview, list.frames);
  const got = await c.ok('studio_asset_get', { assetId: ASSET, sections: ['reviews'] });
  assert.deepEqual(got.reviews.byStatus, { pending: list.frames });
}));

test('a hash-matching approvals entry makes the frame approved, and one changed byte makes it awaiting again', () => withProject(async (p) => {
  const names = frames(p.root);
  const files = names.map((n) => join(p.root, DIR, n));
  record(p.root, names.map((n, i) => [`longtime/${ASSET}/${n.slice(0, -4)}`, sha(readFileSync(files[i]))]));
  const c = connect(p.root);
  const all = await c.ok('studio_review_list', { assetId: ASSET });
  assert.deepEqual(all.byStatus, { approved: names.length });
  assert.equal(all.approvedByHuman, names.length);
  // change one byte of one frame: that frame is no longer covered
  const bytes = readFileSync(files[0]); bytes[bytes.length - 1] ^= 1; writeFileSync(files[0], bytes);
  const after = await c.ok('studio_review_list', { assetId: ASSET });
  assert.deepEqual(after.byStatus, { approved: names.length - 1, pending: 1 });
}));

test('a baseline frame reads "baseline" and is not counted as approved', () => withProject(async (p) => {
  const pack = JSON.parse(readFileSync(join(p.root, 'studio.project.json'), 'utf8'));
  pack.review = { baseline: { file: 'assets/review/baseline.json', roots: ['assets/processed_longtime'] } };
  writeFileSync(join(p.root, 'studio.project.json'), JSON.stringify(pack));
  const { buildBaselineRecord } = await import('../core/standing.mjs');
  mkdirSync(join(p.root, 'assets/review'), { recursive: true });
  writeFileSync(join(p.root, 'assets/review/baseline.json'), JSON.stringify(await buildBaselineRecord(p.root, pack.review)));
  const c = connect(p.root);
  const list = await c.ok('studio_review_list', { assetId: ASSET });
  assert.deepEqual(list.byStatus, { baseline: list.frames });
  assert.equal(list.approvedByHuman, 0);
  assert.equal(list.baselineNoRecord, list.frames);
}));

test('no MCP tool can set approved or baseline: a review request leaves the standing as it was', () => withProject(async (p) => {
  const c = connect(p.root);
  const refused = await c.call('studio_review_request', { assetId: ASSET, note: 'Please look.' });
  // Either asked (and status untouched) or refused for a gate/independent-check reason; never approved.
  const list = await c.ok('studio_review_list', { assetId: ASSET });
  assert.equal(list.approvedByHuman, 0);
  assert.ok(!('approved' in list.byStatus), JSON.stringify([refused.isError, list.byStatus]));
}));
