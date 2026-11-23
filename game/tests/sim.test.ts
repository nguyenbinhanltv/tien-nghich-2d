import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng.ts';
import { hashState } from '../src/sim/hash.ts';
import { createWorld, FixedLoop, NO_INPUT, spawn, step } from '../src/sim/loop.ts';
import type { GameEvent } from '../src/contracts/world.ts';
import { TICK_MS } from '../src/contracts/world.ts';

function run(seed: number, ticks: number): string {
  const w = createWorld(seed), ev: GameEvent[] = [];
  spawn(w, 'player', 0, 0, 10, ev); spawn(w, 'mob_blood_wolf', 50, 50, 14, ev); spawn(w, 'mob_blood_crow', -30, 20, 8, ev);
  for (let i = 0; i < ticks; i++) step(w, { ...NO_INPUT, move: { x: Math.sin(i / 30), y: 0.5 } }, ev);
  return hashState(w);
}

describe('sim determinism (plan stop criterion 4, skeleton)', () => {
  it('same seed gives the same hash after 10,000 ticks, a different seed does not', () => {
    expect(run(7, 10_000)).toBe(run(7, 10_000));
    expect(run(7, 10_000)).not.toBe(run(8, 10_000));
  });
  it('state hash is independent of key order', () => { expect(hashState({ a: 1, b: [1, 2] })).toBe(hashState({ b: [1, 2], a: 1 })); });
});

describe('Rng', () => {
  it('is reproducible, in range, and resumable from its one-number state', () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 100 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 100 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const c = new Rng(1); c.next(); const d = new Rng(0); d.state = c.state;
    expect(d.next()).toBe(c.next());
    for (let i = 0; i < 1000; i++) { const n = a.int(3, 5); expect(n >= 3 && n <= 5).toBe(true); }
  });
  it('refuses to pick from nothing', () => { expect(() => new Rng(1).pick([])).toThrow(); });
});

describe('FixedLoop', () => {
  it('runs whole ticks and carries the remainder', () => {
    const l = new FixedLoop(); let n = 0;
    expect(l.advance(TICK_MS * 2.5, () => n++)).toBe(2);
    expect(l.advance(TICK_MS * 0.5, () => n++)).toBe(1);
    expect(n).toBe(3);
  });
  it('caps a long stall instead of spiralling', () => {
    expect(new FixedLoop(5).advance(10_000, () => undefined)).toBe(5);
  });
});
