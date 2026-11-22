import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArtApprovals, evaluateArtApproval, readArtApprovals, artApprovalsFile } from './art-approvals.mjs';

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

test('a frame is covered only while its file hashes to the recorded bytes', async () => {
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
  assert.deepEqual(Object.keys(byAsset).sort(), ['lt_fx_core_breach', 'lt_fx_craft', 'lt_fx_gate_unseal', 'lt_fx_impact', 'lt_fx_stamp', 'lt_fx_ward_pulse', 'lt_ink_marten', 'lt_kiln_keeper']);
  for (const r of records) { assert.equal(r.current, true, `${r.assetId} changed since it was approved`); assert.equal(r.approvedBy, 'user'); assert.equal(r.kind, 'owner_statement'); }
  assert.equal(records.filter(r => r.assetId.startsWith('lt_fx_')).reduce((n, r) => n + r.frames, 0), 188, 'all 188 effect frames');
  assert.equal(byAsset.lt_kiln_keeper.frames, 32);
  assert.ok(fs.existsSync(path.join(repo, 'assets/review', artApprovalsFile)));
});
