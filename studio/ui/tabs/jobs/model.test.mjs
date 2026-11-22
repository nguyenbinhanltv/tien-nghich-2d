import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, stateParams, jobPhase, durationMs, fmtDuration, sessionId, visibleJobs, groupSessions, visibleEvents, mergeEvents, counts } from './model.mjs';
import { parseHash } from '../../router.mjs';

const job = (id, status, o = {}) => ({id, name: 'qa_run', status, owner: {agent: 'codex', session: '3fa9c120'}, createdAt: '2026-11-22T10:00:00.000Z', startedAt: '2026-11-22T10:00:01.000Z', finishedAt: null, wallMs: null, ...o});

test('parseRoute is total and round-trips', () => {
  assert.doesNotThrow(() => parseRoute());
  assert.doesNotThrow(() => parseRoute({asset: '../x', params: {state: 'zzz', tool: '$(rm)', session: '<script>'}}));
  const s = parseRoute(parseHash('#/jobs/job-0a1b2c3d4e?state=failed&tool=qa_run&session=codex%7C3fa9c120'));
  assert.deepEqual([s.job, s.state, s.tool, s.session], ['job-0a1b2c3d4e', 'failed', 'qa_run', 'codex|3fa9c120']);
  assert.deepEqual(parseRoute({params: stateParams(s)}), {...s, job: null});
  assert.equal(parseRoute({asset: 'not-a-job'}).job, null);
  assert.deepEqual(stateParams(parseRoute({})), {});
});

test('durations: recorded when finished, live while running, waiting while queued', () => {
  const now = Date.parse('2026-11-22T10:00:11.000Z');
  assert.equal(durationMs(job('a', 'running'), now), 10000);
  assert.equal(durationMs(job('b', 'queued', {startedAt: null}), now), 11000);
  assert.equal(durationMs(job('c', 'succeeded', {finishedAt: '2026-11-22T10:00:03.000Z', wallMs: 1500}), now), 1500);
  assert.equal(durationMs(job('d', 'failed', {finishedAt: '2026-11-22T10:00:03.000Z'}), now), 2000);
  assert.deepEqual([450, 1500, 12000, 125000, 4000000].map(fmtDuration), ['450 ms', '1.5 s', '12 s', '2 m 5 s', '1 h 6 m']);
  assert.equal(fmtDuration(NaN), '–');
});

test('phases, filters and ordering: running first, then newest', () => {
  const jobs = [job('old', 'succeeded', {createdAt: '2026-11-22T09:00:00.000Z'}), job('new', 'succeeded'), job('run', 'running', {createdAt: '2026-11-22T08:00:00.000Z'}), job('bad', 'failed', {createdAt: '2026-11-22T09:30:00.000Z', name: 'diff', owner: {agent: 'x', session: 'abcd1234ffff'}})];
  assert.deepEqual(jobs.map(j => jobPhase(j)), ['done', 'done', 'running', 'failed']);
  assert.deepEqual(visibleJobs(jobs, {state: 'all', tool: null, session: null}).map(j => j.id), ['run', 'new', 'bad', 'old']);
  assert.deepEqual(visibleJobs(jobs, {state: 'failed', tool: null, session: null}).map(j => j.id), ['bad']);
  assert.deepEqual(visibleJobs(jobs, {state: 'all', tool: 'diff', session: null}).map(j => j.id), ['bad']);
  assert.deepEqual(visibleJobs(jobs, {state: 'all', tool: null, session: 'x|abcd1234'}).map(j => j.id), ['bad']);
  assert.deepEqual(counts(jobs, [{ok: true}, {ok: false}]), {running: 1, queued: 0, failed: 1, calls: 2, failedCalls: 1});
});

test('sessions group calls and jobs, busiest first', () => {
  const events = [{seq: 1, ts: '2026-11-22T10:00:05.000Z', agent: 'codex', session: '3fa9c120abcdef', tool: 'catalog_search', ok: true}, {seq: 2, ts: '2026-11-22T10:00:09.000Z', agent: 'codex', session: '3fa9c120abcdef', tool: 'qa_run', ok: false},
    {seq: 3, ts: '2026-11-22T10:00:07.000Z', agent: 'antigravity', session: '77d01e5b0000', tool: 'diff', ok: true}];
  const groups = groupSessions(events, [job('a', 'running', {owner: {agent: 'antigravity', session: '77d01e5b'}})]);
  assert.deepEqual(groups.map(g => [g.id, g.calls, g.failures, g.running, g.jobs]), [['antigravity|77d01e5b', 1, 0, 1, 1], ['codex|3fa9c120', 2, 1, 0, 0]]);
  assert.equal(groups[1].lastTs, '2026-11-22T10:00:09.000Z');
  assert.equal(sessionId({agent: 'codex', session: '3fa9c120abcdef'}), 'codex|3fa9c120');
  assert.deepEqual(visibleEvents(events, {state: 'failed', tool: null, session: null}).map(e => e.seq), [2]);
  assert.deepEqual(visibleEvents(events, {state: 'all', tool: null, session: null}).map(e => e.seq), [3, 2, 1]);
});

test('merging polls: new events append once; a restart (cursor moved back) clears the list', () => {
  const a = mergeEvents([], 0, {events: [{seq: 1}, {seq: 2}], next: 2});
  assert.deepEqual(a.map(e => e.seq), [1, 2]);
  assert.deepEqual(mergeEvents(a, 2, {events: [{seq: 2}, {seq: 3}], next: 3}).map(e => e.seq), [1, 2, 3]);
  assert.deepEqual(mergeEvents(a, 2, {events: [], next: 0}), []);
  assert.equal(mergeEvents(Array.from({length: 300}, (_, i) => ({seq: i})), 300, {events: [{seq: 300}], next: 301}).length, 300);
});
