// A frame nobody reviewed must never read as approved: the three honest states (approved, baseline, awaiting review).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sameImage, createStanding, buildBaselineRecord, tallyStandings } from '../standing.mjs';
import { revisionStore } from '../store.mjs';
import { encodePixels } from '../png.mjs';
import { loadPack } from '../pack.mjs';
import { loadEditableCatalog } from '../editable.mjs';
import { root as repoRoot } from './helpers.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const px = n => encodePixels(1, 1, Buffer.from([n, 2, 3, 255]));

async function project(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-standing-')));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const write = (file, data) => fs.mkdir(path.dirname(path.join(dir, file)), {recursive: true}).then(() => fs.writeFile(path.join(dir, file), data));
  return {dir, write};
}
const record = (rel, bytes, key = 'g/a/f_0') => ({schema_version: 1, approvals: [{id: 'r1', approved_by: 'owner',
  assets: {a: {frame_dir: path.posix.dirname(rel), frames: {[key]: sha(bytes)}}}}]});

test('a new frame with no lineage and no record is awaiting review; a matching approvals entry makes it approved; one changed byte makes it awaiting again', async t => {
  const {dir, write} = await project(t);
  await write('art/a/f_0.png', px(1));
  const none = createStanding(dir, {approvalsDir: 'rec'});
  assert.equal(await none.of('art/a/f_0.png'), 'awaiting');
  await write('rec/art_approvals.json', JSON.stringify(record('art/a/f_0.png', px(1))));
  const standing = createStanding(dir, {approvalsDir: 'rec'});
  assert.equal(await standing.of('art/a/f_0.png'), 'approved');
  await write('art/a/f_0.png', px(2));
  assert.equal(await standing.of('art/a/f_0.png'), 'awaiting');
  assert.equal(await standing.of('art/a/missing.png'), 'awaiting');
});

test('baseline: a recorded directory reads baseline, and any added, removed or changed frame sends the whole directory to awaiting review', async t => {
  const {dir, write} = await project(t);
  await write('legacy/x/a_0.png', px(1)); await write('legacy/x/a_1.png', px(2)); await write('legacy/y/b_0.png', px(3));
  const review = {baseline: {file: 'rec/baseline.json', roots: ['legacy']}};
  await write('rec/baseline.json', JSON.stringify(await buildBaselineRecord(dir, review)));
  const standing = createStanding(dir, {review});
  assert.equal(await standing.of('legacy/x/a_0.png'), 'baseline');
  assert.equal(await standing.of('legacy/y/b_0.png'), 'baseline');
  await write('legacy/x/a_2.png', px(9)); // new since the baseline
  assert.equal(await standing.of('legacy/x/a_0.png'), 'awaiting');
  assert.equal(await standing.of('legacy/x/a_2.png'), 'awaiting');
  assert.equal(await standing.of('legacy/y/b_0.png'), 'baseline');
  await fs.rm(path.join(dir, 'legacy/x/a_2.png'));
  assert.equal(await standing.of('legacy/x/a_0.png'), 'baseline');
  await write('legacy/y/b_0.png', px(4)); // bytes changed
  assert.equal(await standing.of('legacy/y/b_0.png'), 'awaiting');
  assert.equal(await standing.of('elsewhere/z_0.png'), 'awaiting');
});

test('a human record wins over baseline, and a baseline frame is never reported as approved', async t => {
  const {dir, write} = await project(t);
  await write('legacy/x/a_0.png', px(1));
  const review = {baseline: {file: 'rec/baseline.json', roots: ['legacy']}};
  await write('rec/baseline.json', JSON.stringify(await buildBaselineRecord(dir, review)));
  const baselineOnly = createStanding(dir, {review, approvalsDir: 'rec'});
  assert.equal(await baselineOnly.of('legacy/x/a_0.png'), 'baseline');
  await write('rec/art_approvals.json', JSON.stringify(record('legacy/x/a_0.png', px(1), 'g/x/a_0')));
  assert.equal(await createStanding(dir, {review, approvalsDir: 'rec'}).of('legacy/x/a_0.png'), 'approved');
});

test('the revision store reports revision 0 by standing, a human decision wins, and no one can store "baseline"', t => {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-standing-lib-')));
  t.after(() => rmSync(tmp, {recursive: true, force: true}));
  mkdirSync(path.join(tmp, 'repo'));
  const store = revisionStore(path.join(tmp, 'repo'), '.revs', path.join(tmp, 'library'));
  t.after(() => store.close());
  const mk = (n, standing, standingPng = px(1)) => ({info: {key: 'k/a_' + n}, metadata: {pivot: [0, 0]}, standing, standingPng});
  const base = px(1);
  assert.equal(store.operate(mk(0), base, 'frame', {}).status, 'pending');
  assert.equal(store.operate(mk(0, 'awaiting'), base, 'frame', {}).status, 'pending');
  assert.equal(store.operate(mk(0, 'baseline'), base, 'frame', {}).status, 'baseline');
  assert.equal(store.operate(mk(0, 'approved'), base, 'frame', {}).status, 'approved');
  assert.equal(store.operate(mk(0, 'baseline'), base, 'frame', {}).history[0].status, 'baseline');
  // a comment without a verdict keeps the derived standing; it does not make the frame approved
  const commented = store.operate(mk(0, 'baseline'), base, 'review', {revision: 0, text: 'looks flat'});
  assert.equal(commented.status, 'baseline');
  assert.equal(commented.comments[0].status, 'baseline');
  assert.throws(() => store.operate(mk(0, 'baseline'), base, 'review', {revision: 0, status: 'baseline'}), /Invalid review status/);
  // revision 1 is never derived: a saved edit awaits review even on a baseline frame
  const saved = store.operate(mk(0, 'baseline'), base, 'save', {baseRevision: 0, png: px(5)});
  assert.equal(saved.status, 'pending');
  assert.deepEqual(saved.history.map(h => h.status), ['pending', 'baseline']);
  // a standing judged on other bytes than the stored revision 0 does not apply: rev 0 (bytes A) must not inherit a record for bytes B
  assert.equal(store.operate(mk(0, 'approved', px(9)), base, 'frame', {}).history.at(-1).status, 'pending');
  assert.equal(store.operate(mk(0, 'baseline', px(9)), base, 'frame', {}).history.at(-1).status, 'pending');
  assert.equal(store.operate(mk(0, 'approved', undefined), base, 'frame', {}).history.at(-1).status, 'approved');
  assert.equal(store.operate({...mk(0, 'approved'), standingPng: undefined}, base, 'frame', {}).history.at(-1).status, 'pending');
  // a human verdict wins over the derived standing, in both directions
  assert.equal(store.operate(mk(0, 'baseline'), base, 'review', {revision: 0, status: 'approved'}).status, 'approved');
  assert.equal(store.operate(mk(0, 'approved'), base, 'review', {revision: 0, status: 'changes_requested'}).status, 'changes_requested');
});

test('counts add up: every frame is in exactly one standing', async t => {
  const {dir, write} = await project(t);
  await write('legacy/x/a_0.png', px(1)); await write('new/n/a_0.png', px(2)); await write('new/n/a_1.png', px(3));
  const review = {baseline: {file: 'rec/baseline.json', roots: ['legacy']}};
  await write('rec/baseline.json', JSON.stringify(await buildBaselineRecord(dir, review)));
  await write('rec/art_approvals.json', JSON.stringify(record('new/n/a_1.png', px(3), 'g/n/a_1')));
  const standing = createStanding(dir, {review, approvalsDir: 'rec'});
  const tally = await tallyStandings(standing, ['legacy/x/a_0.png', 'new/n/a_0.png', 'new/n/a_1.png']);
  assert.deepEqual(tally, {approved: 1, baseline: 1, awaiting: 1, total: 3});
  assert.equal(tally.approved + tally.baseline + tally.awaiting, tally.total);
});

test('a second tiny project with no baseline declaration shows everything awaiting review', async t => {
  const {dir, write} = await project(t);
  await write('out/a_0.png', px(1)); await write('out/a_1.png', px(2));
  const standing = createStanding(dir, {});
  assert.equal(standing.declared, false);
  assert.deepEqual(await tallyStandings(standing, ['out/a_0.png', 'out/a_1.png']), {approved: 0, baseline: 0, awaiting: 2, total: 2});
});

test('the real project: every Longtime frame is approved on record, the legacy core art stays baseline except the 51 slice assets, only the 122 PX-1 frames (hurt clips, enemy projectiles, status icons) await', async () => {
  const pack = await loadPack(repoRoot, undefined, {verifyFiles: false});
  const catalog = await loadEditableCatalog(pack, repoRoot);
  const standing = createStanding(repoRoot, {review: pack.review, approvalsDir: pack.directories.approvals});
  const longtime = [...catalog.frames.values()].filter(f => f.info.key.startsWith('longtime/'));
  assert.ok(longtime.length > 1500);
  for (const f of longtime) assert.equal(await standing.of(f.processed), 'approved', f.info.key);
  const core = [...catalog.frames.values()].filter(f => !f.info.key.startsWith('longtime/'));
  assert.ok(core.length > 1000);
  // the owner approved only the 51 legacy assets of the Huyết Hải vertical slice (2026-11-23): the rest keeps the baseline label (no review record)
  const record = JSON.parse(await fs.readFile(path.join(repoRoot, 'assets/review/art_approvals.json'), 'utf8'));
  const vs = new Set(Object.values(record.approvals.find(a => a.id === 'owner_vs_baseline_2026-11-23').assets)
    .flatMap(info => Object.keys(info.frames).map(k => `${info.frame_dir}/${k.split('/').at(-1)}.png`)));
  assert.equal(vs.size, 1356);
  let baseline = 0;
  for (const f of core) {
    // PX-1 (2026-11-24): the script-made `hurt` frames of ten slice assets and the four enemy projectiles await the owner; nothing else does.
    const want = vs.has(f.processed) ? 'approved' : /^projectiles\/pj_mob_|^ui\/icon_status_|^characters\/(wl_outer_disciple|wl_qi_condensation|wl_blood_foundation|wl_extreme_jing|mob_blood_wolf|mob_blood_crow|mob_blood_corpse|mob_vengeful_soul|mob_blood_pool_lurker|boss_ghost_king)\/hurt_/.test(f.info.key) ? 'awaiting' : /^characters\/(mob_(rogue_disciple|courtyard_guard|sword_acolyte|herb_viper|demonic_talisman|stone_puppet|stone_archer_puppet|chain_warden|void_eater|rune_sentinel)|boss_(teng_huayuan|ancient_god_remnant))\//.test(f.info.key) ? 'awaiting' : 'baseline'; // Hằng Nhạc: the asset-level baseline lapses when frames are added
    baseline += want === 'baseline';
    assert.equal(await standing.of(f.processed), want, f.info.key);
  }
  assert.ok(baseline > 800, 'most of the legacy core art stays baseline');
});

test('a transparent pixel with colour does not break the match with the normalized stored copy', () => {
  const file = encodePixels(2, 1, Buffer.from([10, 20, 30, 0, 1, 2, 3, 255]));
  const stored = encodePixels(2, 1, Buffer.from([0, 0, 0, 0, 1, 2, 3, 255])); // what normalizePng stores
  assert.equal(sameImage(stored, file), true);
  assert.equal(sameImage(encodePixels(2, 1, Buffer.from([0, 0, 0, 0, 1, 2, 4, 255])), file), false);
  assert.equal(sameImage(encodePixels(2, 1, Buffer.from([0, 0, 0, 255, 1, 2, 3, 255])), file), false);
});
