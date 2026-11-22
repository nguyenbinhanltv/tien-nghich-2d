import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHasher } from './hashes.mjs';
import { parseArtApprovals, evaluateArtApproval, pngInventory, readArtApprovals, artApprovalsFile } from './art-approvals.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex');
const A = 'a'.repeat(64);

test('the art record: only well-formed, hash-tied assets are read', () => {
  const rec = parseArtApprovals({approvals: [
    {id: 'ok', approved_by: 'user', kind: 'owner_statement', assets: {
      good: {frame_dir: 'assets/x/good', frames: {'g/good/f_0': A, 'g/good/bad': 'zz'}},
      nodir: {frames: {'g/nodir/f_0': A}},
      escape: {frame_dir: '../outside', frames: {'g/escape/f_0': A}},
      empty: {frame_dir: 'assets/x/empty', frames: {}}}},
    {id: 'nobody', assets: {x: {frame_dir: 'a', frames: {'g/x/f_0': A}}}}, null, 'junk']});
  assert.deepEqual(rec.map(r => [r.assetId, r.frames.length, r.kind]), [['good', 1, 'owner_statement']]);
  assert.deepEqual(parseArtApprovals({}), []);
});

test('REVIEW-005: a frame is covered only while its file hashes to the recorded bytes', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'artrec-'));
  fs.mkdirSync(path.join(root, 'f'));
  fs.writeFileSync(path.join(root, 'f/a_0.png'), 'one'); fs.writeFileSync(path.join(root, 'f/a_1.png'), 'two');
  const rec = parseArtApprovals({approvals: [{id: 'r', approved_by: 'user', assets: {a: {frame_dir: 'f', frames: {'g/a/a_0': sha('one'), 'g/a/a_1': sha('two')}}}}]})[0];
  assert.deepEqual(await evaluateArtApproval(root, rec).then(e => [e.current, e.matching, e.changed, e.missing]), [true, 2, 0, 0]);
  fs.writeFileSync(path.join(root, 'f/a_1.png'), 'TWO'); fs.rmSync(path.join(root, 'f/a_0.png'));
  const e = await evaluateArtApproval(root, rec);
  assert.deepEqual([e.current, e.matching, e.changed, e.missing, e.changedKeys], [false, 0, 1, 1, ['g/a/a_0', 'g/a/a_1']]);
});

test('the project record covers the six effects and the two characters, byte for byte, as they are on disk', async () => {
  const records = await readArtApprovals(repo, 'assets/review');
  const byAsset = Object.fromEntries(records.map(r => [r.assetId, r]));
  for (const id of ['lt_fx_core_breach', 'lt_fx_craft', 'lt_fx_gate_unseal', 'lt_fx_impact', 'lt_fx_stamp', 'lt_fx_ward_pulse', 'lt_ink_marten', 'lt_kiln_keeper']) assert.ok(byAsset[id], id);
  assert.equal(records.length, 131, 'eight earlier assets, the 30 new characters and 93 other Longtime assets');
  for (const r of records) { assert.equal(r.current, true, `${r.assetId} changed since it was approved`); assert.equal(r.approvedBy, 'user'); assert.equal(r.kind, 'owner_statement'); }
  assert.equal(records.filter(r => r.assetId.startsWith('lt_fx_')).reduce((n, r) => n + r.frames, 0), 188, 'all 188 effect frames');
  assert.equal(byAsset.lt_kiln_keeper.frames, 32);
  assert.ok(fs.existsSync(path.join(repo, 'assets/review', artApprovalsFile)));
});

test('a frame ADDED to an approved asset breaks coverage even though every recorded hash still matches', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'artrec-'));
  fs.mkdirSync(path.join(root, 'f')); fs.writeFileSync(path.join(root, 'f/a_0.png'), 'one'); fs.writeFileSync(path.join(root, 'f/notes.txt'), 'ignored');
  const rec = parseArtApprovals({approvals: [{id: 'r', approved_by: 'user', assets: {a: {frame_dir: 'f', frames: {'g/a/a_0': sha('one')}}}}]})[0];
  assert.equal((await evaluateArtApproval(root, rec)).current, true);
  fs.writeFileSync(path.join(root, 'f/a_1.png'), 'new');
  const e = await evaluateArtApproval(root, rec);
  assert.deepEqual([e.current, e.matching, e.changed, e.added, e.addedFiles], [false, 1, 0, 1, ['f/a_1.png']]);
});

test('a hasher keeps its own entries: a big scan on one cannot evict another', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hasher-'));
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(root, i + '.bin'), String(i));
  const audio = createHasher(4), art = createHasher(1024);
  await audio(root, '0.bin');
  for (let i = 0; i < 12; i++) await art(root, i + '.bin');
  assert.equal(audio.size(), 1, 'the audio hasher still holds its master');
  assert.equal(art.size(), 12);
  for (let i = 1; i < 12; i++) await audio(root, i + '.bin');
  assert.equal(audio.size(), 4, 'and each is still bounded');
});

test('a raw PNG added under an approved character breaks coverage', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'artrec-'));
  fs.mkdirSync(path.join(root, 'p')); fs.mkdirSync(path.join(root, 'raw/c/idle'), {recursive: true});
  fs.writeFileSync(path.join(root, 'p/c_0.png'), 'p'); fs.writeFileSync(path.join(root, 'raw/c/idle/f0.png'), 'r');
  const rec = parseArtApprovals({approvals: [{id: 'r', approved_by: 'user', assets: {c: {frame_dir: 'p', raw_dir: 'raw/c', frames: {'g/c/c_0': sha('p')}, raw_files: {'raw/c/idle/f0.png': sha('r')}}}}]})[0];
  assert.equal((await evaluateArtApproval(root, rec)).current, true);
  fs.writeFileSync(path.join(root, 'raw/c/idle/f1.png'), 'new');
  const e = await evaluateArtApproval(root, rec);
  assert.deepEqual([e.current, e.added, e.addedFiles], [false, 1, ['raw/c/idle/f1.png']]);
});

test('a frame_dir that is a symlink out of the project is unverified and its file names are not exposed', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artrec-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-')));
  fs.writeFileSync(path.join(outside, 'secret_0.png'), 'x'); fs.symlinkSync(outside, path.join(root, 'link'));
  const rec = parseArtApprovals({approvals: [{id: 'r', approved_by: 'user', assets: {a: {frame_dir: 'link', frames: {'g/a/a_0': A}}}}]})[0];
  const e = await evaluateArtApproval(root, rec);
  assert.deepEqual([e.current, e.unverified, e.addedFiles], [false, true, []]);
  assert.equal(await pngInventory(root, 'nonexistent'), null, 'unreadable is unverified too');
});

test('counts: changed/missing are measured against recorded files (frames + raw), added files are reported apart', async () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'artrec-'));
  fs.mkdirSync(path.join(root, 'p')); fs.mkdirSync(path.join(root, 'raw/c'), {recursive: true});
  fs.writeFileSync(path.join(root, 'p/c_0.png'), 'p');
  const rawFiles = {}; for (let i = 0; i < 5; i++) { fs.writeFileSync(path.join(root, `raw/c/${i}.png`), 'r' + i); rawFiles[`raw/c/${i}.png`] = sha('r' + i); }
  const rec = parseArtApprovals({approvals: [{id: 'r', approved_by: 'user', assets: {c: {frame_dir: 'p', raw_dir: 'raw/c', frames: {'g/c/c_0': sha('p')}, raw_files: rawFiles}}}]})[0];
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `raw/c/${i}.png`), 'changed');
  const e = await evaluateArtApproval(root, rec);
  assert.deepEqual([e.changed + e.missing + e.rawChanged, e.frames + e.rawFiles, e.added], [5, 6, 0], '5 of 6, never more changed than recorded');
});

test('the repaint signature of the Review inbox covers every displayed art count', () => {
  const src = fs.readFileSync(path.join(repo, 'studio/ui/tabs/review/index.mjs'), 'utf8');
  for (const field of ['matching', 'changed', 'missing', 'rawChanged', 'added', 'unverified', 'current']) assert.match(src, new RegExp(`artRecords[^\\n]*r\\.${field}\\b`), field);
});
