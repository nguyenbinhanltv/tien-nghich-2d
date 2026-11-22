import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from './cache.mjs';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('concurrent callers share one load', async () => {
  const cache = createCache({ttlMs: 1000});
  let runs = 0;
  const load = async () => { runs++; await wait(20); return {n: runs}; };
  const results = await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
  assert.equal(runs, 1);
  assert.ok(results.every(r => r === results[0]));
  assert.equal(cache.version('k'), 1);
});

test('a fresh value is reused; an old one is served at once while one background load replaces it', async () => {
  let clock = 0, runs = 0;
  const cache = createCache({ttlMs: 100, staleMs: 1000, now: () => clock});
  const load = async () => { runs++; await wait(20); return runs; };
  assert.equal(await cache.get('k', load), 1);
  clock = 50;
  assert.equal(await cache.get('k', load), 1);
  assert.equal(runs, 1);
  clock = 500; // stale: answered from the old value, refreshed behind it
  assert.equal(await cache.get('k', load), 1);
  assert.equal(await cache.get('k', load), 1); // the refresh is still running: no second one starts
  assert.equal(runs, 2);
  await wait(40);
  assert.equal(await cache.get('k', load), 2);
  assert.equal(cache.version('k'), 2);
});

test('a value past staleMs makes the caller wait for the new one', async () => {
  let clock = 0, runs = 0;
  const cache = createCache({ttlMs: 100, staleMs: 300, now: () => clock});
  const load = async () => { await wait(10); return ++runs; };
  await cache.get('k', load);
  clock = 400;
  assert.equal(await cache.get('k', load), 2);
});

test('a failed load is not kept; a failed background refresh keeps the old value', async () => {
  let clock = 0;
  const cache = createCache({ttlMs: 100, staleMs: 1000, now: () => clock});
  await assert.rejects(cache.get('k', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(cache.version('k'), 0);
  assert.equal(await cache.get('k', async () => 'ok'), 'ok');
  clock = 200;
  assert.equal(await cache.get('k', async () => { throw new Error('later'); }), 'ok'); // stale served, refresh failed quietly
  await wait(5);
  clock = 250;
  assert.equal(await cache.get('k', async () => 'fresh'), 'ok'); // still stale-but-allowed: the next refresh starts
  await wait(5);
  assert.equal(await cache.get('k', async () => 'again'), 'fresh');
});

test('clear forgets everything', async () => {
  const cache = createCache({ttlMs: 1000});
  await cache.get('k', async () => 1);
  cache.clear();
  assert.equal(await cache.get('k', async () => 2), 2);
});
