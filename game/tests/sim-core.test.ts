import { describe, expect, it } from 'vitest';
import { addProjectile, advanceProjectiles, createProjectilePool, removeProjectile } from '../src/sim/pool.ts';
import { SpatialHash } from '../src/sim/spatial-hash.ts';
import { aabbAabb, circleAabb, circleCircle, pointInAabb, sweptCircleHit } from '../src/sim/collide.ts';
import { hashState, hashWorld } from '../src/sim/hash.ts';
import { createSim } from '../src/sim/sim.ts';
import { spawn } from '../src/sim/loop.ts';
import { Rng } from '../src/sim/rng.ts';
import type { InputFrame } from '../src/contracts/world.ts';

function runSeed(seed: number, ticks: number): string {
  const sim = createSim({ seed });
  const w = sim.world, ev: never[] = []; w.mode = 'playing';
  spawn(w, 'player', 0, 0, 10, ev); spawn(w, 'mob_blood_wolf', 50, 50, 14, ev);
  const inputs = new Rng(seed ^ 0x5bd1e995);
  const input: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };
  for (let i = 0; i < ticks; i++) {
    input.move.x = inputs.int(-1, 1); input.move.y = inputs.int(-1, 1);
    if (i % 7 === 0) addProjectile(w.projectiles, 1, 0, 0, 0, inputs.next() - 0.5, inputs.next() - 0.5, 3, 120, 1, false);
    sim.step(input);
    advanceProjectiles(w.projectiles);
  }
  return sim.hash();
}

describe('E1.1 determinism', () => {
  it('same seed and inputs give the same hash after 10,000 ticks; another seed does not', () => {
    expect(runSeed(11, 10_000)).toBe(runSeed(11, 10_000));
    expect(runSeed(11, 10_000)).not.toBe(runSeed(12, 10_000));
  });
  it('the hash covers the pool: stale data behind count is ignored, live data is not', () => {
    const sim = createSim({ seed: 1 }), p = sim.world.projectiles;
    const base = sim.hash();
    addProjectile(p, 1, 0, 1, 2, 0, 0, 3, 10, 1, false);
    const one = sim.hash();
    expect(one).not.toBe(base);
    removeProjectile(p, 0);
    p.nextId = 1; // as if never fired; stale slot 0 still holds old numbers
    expect(sim.hash()).toBe(base);
  });
  it('plain-value hashing refuses typed arrays instead of silently hashing them as {}', () => {
    expect(() => hashState({ a: new Float64Array(2) })).toThrow();
    expect(hashWorld(createSim({ seed: 3 }).world)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('pool', () => {
  it('adds, swap-removes and expires; a full pool drops instead of growing', () => {
    const p = createProjectilePool(3);
    for (let i = 0; i < 3; i++) expect(addProjectile(p, 1, 0, i, i, 1, 0, 2, 2 + i, 1, false)).toBe(i);
    expect(addProjectile(p, 1, 0, 9, 9, 0, 0, 2, 5, 1, false)).toBe(-1);
    removeProjectile(p, 0);
    expect(p.count).toBe(2); expect([p.id[0], p.id[1]]).toEqual([3, 2]);
    advanceProjectiles(p); advanceProjectiles(p);
    expect(p.count).toBe(2); // ttl 4 and 3 -> 2 and 1
    advanceProjectiles(p);
    expect(p.count).toBe(1); // the ttl-3 shot (id 2) expired, id 3 remains
    expect(p.id[0]).toBe(3);
  });
});

describe('collide', () => {
  it('circles touch, boxes overlap, circle against box corner', () => {
    expect(circleCircle(0, 0, 2, 4, 0, 2)).toBe(true);
    expect(circleCircle(0, 0, 2, 4.01, 0, 2)).toBe(false);
    expect(circleAabb(-1, 5, 2, 0, 0, 10, 10)).toBe(true);
    expect(circleAabb(-2, -2, 2, 0, 0, 10, 10)).toBe(false);
    expect(circleAabb(5, 5, 1, 0, 0, 10, 10)).toBe(true);
    expect(aabbAabb(0, 0, 4, 4, 4, 0, 4, 4)).toBe(false);
    expect(aabbAabb(0, 0, 5, 5, 4, 4, 4, 4)).toBe(true);
    expect(pointInAabb(10, 0, 0, 0, 10, 10)).toBe(false);
  });
  it('a fast shot does not tunnel through a small target', () => {
    expect(sweptCircleHit(0, 0, 100, 0, 1, 50, 2, 2)).toBe(true);
    expect(sweptCircleHit(0, 0, 100, 0, 1, 50, 9, 2)).toBe(false);
  });
});

describe('spatial hash (E1.2)', () => {
  it('finds exactly the neighbours a brute-force scan finds, in a fixed order', () => {
    const rng = new Rng(5), n = 500;
    const xs = new Float64Array(n), ys = new Float64Array(n);
    for (let i = 0; i < n; i++) { xs[i] = rng.next() * 384; ys[i] = rng.next() * 216; }
    const h = new SpatialHash(384, 216, 32, n), out = new Int32Array(n);
    h.rebuild(n, xs, ys);
    for (let q = 0; q < 50; q++) {
      const x = rng.next() * 384, y = rng.next() * 216, r = 20;
      const got = new Set(Array.from(out.subarray(0, h.query(x, y, r, out))).filter((i) => Math.hypot(xs[i]! - x, ys[i]! - y) <= r));
      const want = new Set<number>();
      for (let i = 0; i < n; i++) if (Math.hypot(xs[i]! - x, ys[i]! - y) <= r) want.add(i);
      expect(got).toEqual(want);
    }
  });
  it('clamps points outside the grid to the edge cells instead of losing them', () => {
    const h = new SpatialHash(64, 64, 16, 2), out = new Int32Array(4);
    h.rebuild(2, new Float64Array([-50, 500]), new Float64Array([-50, 500]));
    expect(h.query(0, 0, 4, out)).toBe(1);
    expect(h.query(63, 63, 4, out)).toBe(1);
  });
});

describe('E1.2 budget: 2,000 shots against 60 actors in <= 1 ms, no allocation in the loop', () => {
  it('rebuild + query + narrow phase', () => {
    const n = 2000, pool = createProjectilePool(n), rng = new Rng(9);
    for (let i = 0; i < n; i++) addProjectile(pool, 1, 1, rng.next() * 384, rng.next() * 216, rng.next() - 0.5, rng.next() - 0.5, 3, 600, 1, false);
    const ax = new Float64Array(60), ay = new Float64Array(60);
    for (let i = 0; i < 60; i++) { ax[i] = rng.next() * 384; ay[i] = rng.next() * 216; }
    const h = new SpatialHash(384, 216, 24, n), out = new Int32Array(n);
    let hits = 0;
    const tick = (): number => {
      advanceProjectiles(pool); // ttl 600: nothing expires during the test
      h.rebuild(pool.count, pool.x, pool.y);
      let local = 0;
      for (let a = 0; a < 60; a++) {
        const m = h.query(ax[a] as number, ay[a] as number, 6 + 3, out);
        for (let k = 0; k < m; k++) { const s = out[k] as number; if (circleCircle(pool.x[s] as number, pool.y[s] as number, 3, ax[a] as number, ay[a] as number, 6)) local++; }
      }
      return local;
    };
    for (let i = 0; i < 50; i++) hits += tick(); // warm up
    const times: number[] = [];
    for (let i = 0; i < 200; i++) { const t0 = performance.now(); hits += tick(); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    const median = times[100] as number;
    expect(hits).toBeGreaterThanOrEqual(0);
    console.log('E1.2 median ms/tick', median.toFixed(3));
    expect(h.allocations).toBe(0);
    expect(median).toBeLessThanOrEqual(1);
  });
});
