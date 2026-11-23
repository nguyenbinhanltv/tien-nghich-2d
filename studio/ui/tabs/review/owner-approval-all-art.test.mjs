// The owner's 2026-11-22 approval of the 30 new characters and the other Longtime assets awaiting review, as recorded in
// assets/review/art_approvals.json. The legacy core art (baseline_frames.json) is NOT approved. These tests only read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack, loadEditableCatalog, createStanding } from '../../../core/index.mjs';
import { artCounts } from './server.mjs';
import { readArtApprovals } from './art-approvals.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const CHARS = 'owner_new_characters_2026-11-22', OTHER = 'owner_longtime_awaiting_assets_2026-11-22';
const record = JSON.parse(fs.readFileSync(path.join(repo, 'assets/review/art_approvals.json'), 'utf8'));
const entry = id => record.approvals.find(a => a.id === id);
const tmp = prefix => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));

test('both entries carry the owner\'s own words, say the first statement was narrowed, and were recorded by an agent that judged nothing', () => {
  for (const id of [CHARS, OTHER]) {
    const e = entry(id);
    assert.equal(e.kind, 'owner_statement');
    assert.equal(e.approved_by, 'user');
    assert.match(e.recorded, /^2026-11-22T18:\d\d:\d\d\+07:00$/);
    assert.match(e.recorded_by, /judged nothing and approved nothing/);
    assert.deepEqual(e.evidence.statements.map(s => s.quote), ['Duyệt hết assets trên studio cho tôi', 'Duyệt 30 hình nhân vật mới', '30 nhân vật + asset Longtime đang chờ']);
    assert.match(e.evidence.source, /NARROWED the first statement/);
    assert.match(e.evidence.source, /legacy core art .* NOT approved/);
  }
});

test('the real project: zero awaiting, the 51 vertical-slice assets of 2026-11-23 are approved with everything Longtime, the rest of the legacy core art stays baseline', async () => {
  const counts = await artCounts(repo, tmp('review-lib-'));
  assert.deepEqual(counts, {approved: 3554, baseline: 1222, awaiting: 312, changes_requested: 0, total: 5088});
});

test('the legacy baseline is not approved by this record: no entry covers a frame of assets/processed', () => {
  for (const id of [CHARS, OTHER]) for (const [asset, info] of Object.entries(entry(id).assets)) {
    assert.ok(info.frame_dir.startsWith('assets/processed_longtime/'), `${asset} is not Longtime art`);
    assert.ok(Object.keys(info.frames).every(k => k.startsWith('longtime/')));
  }
});

test('the 30 new PixelLab characters are one entry, every processed frame and every tracked raw PNG by sha256', async () => {
  const chars = Object.keys(entry(CHARS).assets);
  const pixellab = fs.readdirSync(path.join(repo, 'assets/raw/longtime')).filter(id => {
    const g = path.join(repo, 'assets/raw/longtime', id, 'generation.json');
    return fs.existsSync(g) && JSON.parse(fs.readFileSync(g, 'utf8')).pixellab_character_id;
  });
  const earlier = record.approvals.filter(a => a.scope === 'character_art').flatMap(a => Object.keys(a.assets));
  assert.deepEqual(chars.sort(), pixellab.filter(id => !earlier.includes(id)).sort());
  assert.equal(chars.length, 30);
  for (const info of Object.values(entry(CHARS).assets)) {
    assert.ok(info.raw_dir && Object.keys(info.raw_files).length > 0 && Object.keys(info.frames).length >= 32);
  }
});

test('every asset record in the project file is current: nothing changed, missing or added', async () => {
  const records = await readArtApprovals(repo, 'assets/review');
  assert.equal(records.length, 183);
  assert.deepEqual(records.filter(r => !r.current).map(r => [r.assetId, r.changed, r.missing, r.added, r.rawChanged]), []);
  const seen = new Map();
  for (const a of record.approvals) for (const info of Object.values(a.assets ?? {})) for (const key of Object.keys(info.frames)) {
    assert.ok(!seen.has(key), `${key} is in both ${seen.get(key)} and ${a.id}`);
    seen.set(key, a.id);
  }
});

test('the orange palette approval is a colour record: exact hex, no frames, and it covers no art', () => {
  const a = entry('owner_orange_palette_2026-11-22');
  assert.equal(a.scope, 'palette_colours');
  assert.equal(a.assets, undefined);
  assert.deepEqual(a.colors, {orange_01: '#9c3f12', orange_02: '#e8701a', orange_03: '#ffb35c'});
  const palette = JSON.parse(fs.readFileSync(path.join(repo, 'tools/generators/palette.json'), 'utf8'));
  for (const [id, hex] of Object.entries(a.colors)) assert.equal(palette.colors.find(c => c.id === id)?.hex, hex, `${id} in palette.json is the approved hex`);
});

test('one changed byte in one newly approved frame makes exactly that frame and asset awaiting again', async () => {
  const [aId, a] = Object.entries(entry(OTHER).assets).find(([, i]) => Object.keys(i.frames).length >= 2);
  const [cId, c] = Object.entries(entry(CHARS).assets)[0];
  const root = tmp('art-flip-');
  const file = (info, key) => `${info.frame_dir}/${key.split('/').at(-1)}.png`;
  for (const info of [a, c]) for (const key of Object.keys(info.frames)) {
    fs.mkdirSync(path.join(root, path.dirname(file(info, key))), {recursive: true});
    fs.copyFileSync(path.join(repo, file(info, key)), path.join(root, file(info, key)));
  }
  for (const f of Object.keys(c.raw_files)) { fs.mkdirSync(path.join(root, path.dirname(f)), {recursive: true}); fs.copyFileSync(path.join(repo, f), path.join(root, f)); }
  fs.mkdirSync(path.join(root, 'assets/review'), {recursive: true});
  fs.writeFileSync(path.join(root, 'assets/review/art_approvals.json'), JSON.stringify({schema_version: 1, approvals: [
    {...entry(OTHER), assets: {[aId]: a}}, {...entry(CHARS), assets: {[cId]: c}}]}));
  const mine = async () => Object.fromEntries((await readArtApprovals(root, 'assets/review')).map(r => [r.assetId, r]));
  const standing = () => createStanding(root, {approvalsDir: 'assets/review'});
  const rels = info => Object.keys(info.frames).map(k => file(info, k));

  assert.ok((await standing().ofMany([...rels(a), ...rels(c)])).every(([, s]) => s === 'approved'));
  assert.deepEqual([(await mine())[aId].current, (await mine())[cId].current], [true, true]);

  const victim = Object.keys(a.frames)[1];
  const buf = fs.readFileSync(path.join(root, file(a, victim)));
  buf[buf.length - 1] ^= 1;
  fs.writeFileSync(path.join(root, file(a, victim)), buf);
  const after = new Map(await standing().ofMany([...rels(a), ...rels(c)]));
  assert.equal(after.get(file(a, victim)), 'awaiting');
  assert.equal([...after.values()].filter(s => s === 'awaiting').length, 1, 'no other frame loses its approval');
  const rec = await mine();
  assert.equal(rec[aId].current, false);
  assert.deepEqual(rec[aId].changedKeys, [victim]);
  assert.equal(rec[cId].current, true, 'the other asset is untouched');

  // a changed tracked raw PNG, an added frame and a removed frame take a character out as well
  const raw = Object.keys(c.raw_files)[0], rawBytes = fs.readFileSync(path.join(root, raw));
  fs.writeFileSync(path.join(root, raw), Buffer.concat([rawBytes, Buffer.from([0])]));
  assert.deepEqual([(await mine())[cId].current, (await mine())[cId].rawChanged], [false, 1]);
  fs.writeFileSync(path.join(root, raw), rawBytes);
  fs.writeFileSync(path.join(root, c.frame_dir, 'extra_0.png'), 'x');
  assert.deepEqual([(await mine())[cId].current, (await mine())[cId].added], [false, 1]);
  fs.rmSync(path.join(root, c.frame_dir, 'extra_0.png'));
  const gone = Object.keys(c.frames)[0];
  fs.rmSync(path.join(root, file(c, gone)));
  assert.deepEqual([(await mine())[cId].current, (await mine())[cId].missing], [false, 1]);
  assert.equal(await standing().of(file(c, gone)), 'awaiting');
});

test('the baseline record is kept untouched and never wins over an approval', async () => {
  const pack = await loadPack(repo);
  const frames = [...(await loadEditableCatalog(pack, repo)).frames.values()].map(f => f.processed);
  const baselineOnly = createStanding(repo, {review: pack.review});
  const tally = {};
  for (const [, s] of await baselineOnly.ofMany(frames)) tally[s] = (tally[s] ?? 0) + 1;
  assert.equal(tally.baseline, 2578, 'baseline_frames.json still labels exactly the legacy art');
  const withApprovals = createStanding(repo, {review: pack.review, approvalsDir: pack.directories.approvals});
  const both = {};
  for (const [, s] of await withApprovals.ofMany(frames)) both[s] = (both[s] ?? 0) + 1;
  assert.deepEqual(both, {approved: 3554, baseline: 1222, awaiting: 312});
});

const VS = 'owner_vs_baseline_2026-11-23';
test('the vertical-slice entry: the owner\'s answer verbatim, 51 assets and 1,356 frames, hash-tied to the files, recorded by an agent that judged nothing', () => {
  const e = entry(VS);
  assert.equal(e.kind, 'owner_statement');
  assert.equal(e.approved_by, 'user');
  assert.equal(e.evidence.quote, 'Duyệt 41 ID + 10 đạo cụ (51 ID)');
  assert.match(e.recorded_by, /judged nothing and approved nothing/);
  assert.equal(Object.keys(e.assets).length, 51);
  let frames = 0;
  for (const [id, info] of Object.entries(e.assets)) {
    assert.ok(info.frame_dir.startsWith('assets/processed/'), id);
    for (const [key, sha] of Object.entries(info.frames)) {
      frames++;
      assert.ok(key.startsWith(`core/${id}/`), key);
      const bytes = fs.readFileSync(path.join(repo, info.frame_dir, `${key.split('/').at(-1)}.png`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), sha, key);
    }
  }
  assert.equal(frames, 1356);
});

test('the vertical-slice entry covers exactly its 51 assets: no other legacy asset and no sheet image', () => {
  const ids = Object.keys(entry(VS).assets);
  assert.equal(new Set(ids).size, 51);
  assert.ok(ids.includes('boss_ghost_king') && ids.includes('ts_blood_valley') && ids.includes('prop_room_door') && ids.includes('hit_spark'));
  assert.ok(!ids.includes('mob_stone_puppet') && !ids.includes('boss_teng_huayuan') && !ids.includes('huyet_hai_kiem_khi'));
  for (const info of Object.values(entry(VS).assets)) assert.ok(Object.keys(info.frames).every(k => !k.endsWith('_sheet')));
});
