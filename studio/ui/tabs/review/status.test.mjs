import test from 'node:test';
import assert from 'node:assert/strict';
import { audioStatus } from './status.mjs';
import { parseApprovals } from './approvals.mjs';

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
const signed = (content, verdict = 'signed') => ({content, verdict});

test('a verdict counts only for the exact master', () => {
  assert.deepEqual(audioStatus({hash: H1, signoffs: []}), {state: 'waiting', label: 'none', by: null});
  assert.equal(audioStatus({hash: H1, signoffs: [signed(H1)]}).state, 'decided');
  assert.equal(audioStatus({hash: H1, signoffs: [signed(H1, 'needs_work')]}).state, 'agent');
  assert.deepEqual(audioStatus({hash: H2, signoffs: [signed(H1)]}), {state: 'waiting', label: 'stale', by: null});
});

test('an approval from before the studio decides, until the master changes; a newer studio verdict wins', () => {
  const approval = {content: H1};
  assert.deepEqual(audioStatus({hash: H1, approval}), {state: 'decided', label: 'approved_before', by: 'record'});
  assert.deepEqual(audioStatus({hash: H2, approval}), {state: 'waiting', label: 'stale', by: null});
  assert.equal(audioStatus({hash: H1, approval: {}}).label, 'approved_before');                           // no hash recorded: any master
  assert.equal(audioStatus({hash: H1, approval, signoffs: [signed(H1, 'needs_work')]}).state, 'agent');   // heard again, found a problem
  assert.equal(audioStatus({hash: H2, approval, signoffs: [signed(H2)]}).label, 'signed');
  assert.equal(audioStatus({hash: null, approval}).label, 'stale');
});

test('the approvals record: both asset forms, hash binding, malformed parts ignored', () => {
  const out = parseApprovals({approvals: [
    {id: 'p1', approved_by: 'user', recorded: '2026-11-21', assets: {a: {master_sha256: H1}, b: {}, 'bad id!': {}}, evidence: {quote: 'heard it', source: 'doc'}},
    {id: 'p2', approved_by: 'user', recorded: null, assets: ['c', 'd']},
    {id: 'p3', assets: ['e']}, null, {approved_by: 'x', assets: ['f']}]});
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([out.a.content, out.b.content, out.a.approvedBy, out.a.evidence.quote, out.c.recorded], [H1, undefined, 'user', 'heard it', null]);
  assert.deepEqual(parseApprovals(undefined), {});
  assert.deepEqual(parseApprovals({approvals: 'nope'}), {});
});
