import test from 'node:test';
import assert from 'node:assert/strict';
import { JobRunner } from '../jobs.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('a job queues, runs, logs and returns its result', async () => {
  const jobs = new JobRunner();
  const view = jobs.submit({name: 'x', owner: {agent: 'a'}, run: async ({log}) => { log('one'); await sleep(5); log('two'); return {answer: 42}; }});
  assert.equal(view.status, 'queued');
  assert.match(view.id, /^job-[0-9a-f]{10}$/);
  const done = await jobs.wait(view.id, 2000);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.result, {answer: 42});
  assert.deepEqual(done.log.map(l => l.slice(13)), ['one', 'two']);
  assert.ok(done.cost.wallMs >= 4);
  assert.ok(done.startedAt && done.finishedAt);
  assert.equal(jobs.view(view.id).result, undefined, 'status views omit the result');
});

test('a failing job is failed, with its message and no result', async () => {
  const jobs = new JobRunner();
  const {id} = jobs.submit({name: 'bad', owner: {}, run: async () => { throw Object.assign(new Error('boom'), {code: 'E_BOOM'}); }});
  const done = await jobs.wait(id, 2000);
  assert.equal(done.status, 'failed');
  assert.deepEqual(done.error, {message: 'boom', code: 'E_BOOM'});
  assert.equal(done.result, undefined);
  assert.match(done.log.at(-1), /failed: boom/);
});

test('wait returns the running view when the time is up, and finishes later', async () => {
  const jobs = new JobRunner();
  const {id} = jobs.submit({name: 'slow', owner: {}, run: async () => { await sleep(120); return 'late'; }});
  const early = await jobs.wait(id, 20);
  assert.equal(early.status, 'running');
  assert.equal(early.result, undefined);
  const late = await jobs.wait(id, 2000);
  assert.deepEqual([late.status, late.result], ['succeeded', 'late']);
  assert.equal((await jobs.wait(id, 10)).status, 'succeeded', 'waiting on a finished job is immediate');
});

test('several waiters are all released', async () => {
  const jobs = new JobRunner();
  const {id} = jobs.submit({name: 's', owner: {}, run: async () => { await sleep(30); return 1; }});
  const all = await Promise.all([jobs.wait(id, 2000), jobs.wait(id, 2000), jobs.wait(id, 2000)]);
  assert.deepEqual(all.map(v => v.status), ['succeeded', 'succeeded', 'succeeded']);
});

test('at most maxRunning jobs run at once; the rest wait their turn in order', async () => {
  const jobs = new JobRunner({maxRunning: 2});
  let live = 0, peak = 0;
  const order = [];
  const make = n => jobs.submit({name: 'j' + n, owner: {}, run: async () => { live++; peak = Math.max(peak, live); order.push(n); await sleep(25); live--; return n; }}).id;
  const ids = [1, 2, 3, 4, 5].map(make);
  await Promise.all(ids.map(id => jobs.wait(id, 3000)));
  assert.equal(peak, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('unknown ids are null; the log is bounded; old finished jobs are evicted', async () => {
  const jobs = new JobRunner({keep: 3});
  assert.equal(jobs.view('job-nope'), null);
  assert.equal(await jobs.wait('job-nope', 10), null);
  const noisy = jobs.submit({name: 'n', owner: {}, run: async ({log}) => { for (let i = 0; i < 500; i++) log('x'.repeat(900) + i); }}).id;
  const v = await jobs.wait(noisy, 2000);
  assert.equal(v.logLines, 200);
  assert.ok(v.log.length <= 20 && v.log.every(l => l.length <= 13 + 500));
  const ids = [];
  for (let i = 0; i < 6; i++) { const {id} = jobs.submit({name: 'e' + i, owner: {}, run: async () => i}); ids.push(id); await jobs.wait(id, 1000); await sleep(2); }
  assert.equal(jobs.view(ids[0]), null, 'oldest finished job was evicted');
  assert.equal(jobs.view(ids.at(-1)).status, 'succeeded');
  assert.ok(jobs.list().length <= 4);
});
