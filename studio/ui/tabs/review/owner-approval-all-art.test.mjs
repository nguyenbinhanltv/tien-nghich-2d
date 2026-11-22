// The owner's 2026-11-22 statement "Duyệt hết assets trên studio cho tôi", as recorded in assets/review/art_approvals.json:
// every art frame the Review tab counts is approved on the real project, and one changed byte takes exactly that frame's
// asset out of the approval again. No route or tool sets any status here: these tests only read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack, loadEditableCatalog, createStanding } from '../../../core/index.mjs';
import { artCounts } from './server.mjs';
import { readArtApprovals } from './art-approvals.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const ID = 'owner_all_studio_art_2026-11-22';
const record = JSON.parse(fs.readFileSync(path.join(repo, 'assets/review/art_approvals.json'), 'utf8'));
const entry = record.approvals.find(a => a.id === ID);
const tmp = prefix => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));

test('the entry is the owner\'s own words, recorded by an agent that judged nothing', () => {
  assert.equal(entry.kind, 'owner_statement');
  assert.equal(entry.approved_by, 'user');
  assert.equal(entry.evidence.quote, 'Duyệt hết assets trên studio cho tôi');
  assert.match(entry.evidence.source, /tien-nghich-2d-1/);
  assert.match(entry.recorded, /^2026-11-22T18:\d\d:\d\d\+07:00$/);
  assert.match(entry.recorded_by, /judged nothing and approved nothing/);
});

test('the real project reports every art frame approved: zero baseline, zero awaiting', async () => {
  const counts = await artCounts(repo, tmp('review-lib-'));
  const pack = await loadPack(repo);
  const frames = (await loadEditableCatalog(pack, repo)).frames.size;
  assert.equal(counts.total, frames);
  assert.deepEqual(counts, {approved: frames, baseline: 0, awaiting: 0, changes_requested: 0, total: frames});
});

test('every asset record in the project file is current: nothing changed, missing or added', async () => {
  const records = await readArtApprovals(repo, 'assets/review');
  assert.ok(records.length >= 225);
  const bad = records.filter(r => !r.current).map(r => [r.assetId, r.approvalId, r.changed, r.missing, r.added]);
  assert.deepEqual(bad, []);
  // a frame that an earlier entry approved is not listed again, so no frame is claimed by two entries
  const seen = new Map();
  for (const a of record.approvals) for (const info of Object.values(a.assets)) for (const key of Object.keys(info.frames)) {
    assert.ok(!seen.has(key), `${key} is in both ${seen.get(key)} and ${a.id}`);
    seen.set(key, a.id);
  }
});

test('one changed byte in one newly approved frame makes exactly that asset awaiting again', async () => {
  // a small plain asset and a flat-directory vfx asset whose directory other assets share
  const pick = pred => Object.entries(entry.assets).find(([, i]) => pred(i) && Object.keys(i.frames).length >= 2);
  const [aId, a] = pick(i => !i.shared_dir);
  const [bId, b] = pick(i => i.shared_dir);
  const root = tmp('art-flip-');
  const file = (info, key) => `${info.frame_dir}/${key.split('/').at(-1)}.png`;
  for (const info of [a, b]) for (const key of Object.keys(info.frames)) {
    fs.mkdirSync(path.join(root, path.dirname(file(info, key))), {recursive: true});
    fs.copyFileSync(path.join(repo, file(info, key)), path.join(root, file(info, key)));
  }
  fs.mkdirSync(path.join(root, 'assets/review'), {recursive: true});
  fs.writeFileSync(path.join(root, 'assets/review/art_approvals.json'), JSON.stringify({schema_version: 1, approvals: [{...entry, assets: {[aId]: a, [bId]: b}}]}));
  const mine = async () => Object.fromEntries((await readArtApprovals(root, 'assets/review')).map(r => [r.assetId, r]));
  const standing = () => createStanding(root, {approvalsDir: 'assets/review'});
  const rels = info => Object.keys(info.frames).map(k => file(info, k));

  assert.ok((await standing().ofMany([...rels(a), ...rels(b)])).every(([, s]) => s === 'approved'));
  assert.deepEqual([(await mine())[aId].current, (await mine())[bId].current], [true, true]);

  const victim = Object.keys(a.frames)[1];
  const buf = fs.readFileSync(path.join(root, file(a, victim)));
  buf[buf.length - 1] ^= 1;
  fs.writeFileSync(path.join(root, file(a, victim)), buf);

  const after = new Map(await standing().ofMany([...rels(a), ...rels(b)]));
  assert.equal(after.get(file(a, victim)), 'awaiting');
  assert.equal([...after.values()].filter(s => s === 'awaiting').length, 1, 'no other frame loses its approval');
  const rec = await mine();
  assert.equal(rec[aId].current, false);
  assert.deepEqual(rec[aId].changedKeys, [victim]);
  assert.equal(rec[bId].current, true, 'the other asset is untouched');

  // a removed frame and an added frame take the asset out as well; in a shared directory only the asset's own numbered files count
  const own = Object.keys(b.frames)[0];
  fs.writeFileSync(path.join(root, b.frame_dir, `${bId}_9999.png`), 'extra');
  assert.deepEqual([(await mine())[bId].current, (await mine())[bId].added], [false, 1]);
  fs.rmSync(path.join(root, b.frame_dir, `${bId}_9999.png`));
  fs.writeFileSync(path.join(root, b.frame_dir, `${bId}_big_1.png`), 'another asset');
  fs.writeFileSync(path.join(root, b.frame_dir, `${bId}_sheet.png`), 'a sheet');
  assert.equal((await mine())[bId].current, true, 'files of other assets and sheets in the shared directory are not this asset\'s frames');
  fs.rmSync(path.join(root, file(b, own)));
  assert.deepEqual([(await mine())[bId].current, (await mine())[bId].missing], [false, 1]);
  assert.equal((await standing().of(file(b, own))), 'awaiting');
});

test('the baseline record is a historical fact and never wins over an approval', async () => {
  // approved takes precedence in the resolver, so a frame can never be both; the baseline file itself is untouched by this approval
  const pack = await loadPack(repo);
  const standing = createStanding(repo, {review: pack.review, approvalsDir: pack.directories.approvals});
  const frames = [...(await loadEditableCatalog(pack, repo)).frames.values()].map(f => f.processed);
  const tally = {};
  for (const [, s] of await standing.ofMany(frames)) tally[s] = (tally[s] ?? 0) + 1;
  assert.deepEqual(tally, {approved: frames.length});
  const withoutApprovals = createStanding(repo, {review: pack.review});
  const baselineOnly = (await withoutApprovals.ofMany(frames)).filter(([, s]) => s === 'baseline').length;
  assert.ok(baselineOnly > 0, 'the legacy art still digests to the recorded baseline');
});
