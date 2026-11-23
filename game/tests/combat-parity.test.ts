// E1.4 parity: the tick sim and the original float-seconds combat.mjs are driven with the same seeded input script and
// compared by WHEN things happen (tick of each change in boss hp, player hp, dodges, counters, mode). Plan: within +-1 tick.
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, WorldState } from '../src/contracts/world.ts';
import { createWorld, startGhostKingFight, step } from '../src/sim/loop.ts';
import { Rng } from '../src/sim/rng.ts';

interface Orig { mode: string; hits: number; dodges: number; counters: number; hitsTaken: number; player: { hp: number }; boss: { hp: number; phase: string } }
const ORIGINAL = new URL('../../playables/blood-sea/combat.mjs', import.meta.url).href;
const orig = (await import(/* @vite-ignore */ ORIGINAL)) as { encounter(): Orig; step(s: Orig, i: unknown, dt: number): void };

type Probe = { mode: string; bossHp: number; playerHp: number; dodges: number; counters: number; hitsTaken: number; hits: number };
const probeOrig = (s: Orig): Probe => ({ mode: s.mode, bossHp: s.boss.hp, playerHp: s.player.hp, dodges: s.dodges, counters: s.counters, hitsTaken: s.hitsTaken, hits: s.hits });
const probeMine = (w: WorldState): Probe => ({ mode: w.mode, bossHp: (w.actors[1]?.hp) ?? 0, playerHp: (w.actors[0]?.hp) ?? 0, dodges: w.stats.dodges, counters: w.stats.counters, hitsTaken: w.stats.hitsTaken, hits: w.stats.hits });

/** Ticks at which each field of the probe changed. */
function changes(seq: Probe[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (let t = 1; t < seq.length; t++) for (const k of Object.keys(seq[0] as Probe) as (keyof Probe)[]) if (seq[t]![k] !== seq[t - 1]![k]) (out[k] ??= []).push(t);
  return out;
}

type Script = (t: number, rng: Rng) => { x: number; y: number; attack: boolean; dodge: boolean };
function run(script: Script, ticks: number, seed: number): { a: Probe[]; b: Probe[] } {
  const s = orig.encounter() as Orig & { mode: string }; s.mode = 'playing';
  const w = createWorld(1), ev: GameEvent[] = []; startGhostKingFight(w, ev);
  const r1 = new Rng(seed), r2 = new Rng(seed);
  const a: Probe[] = [probeOrig(s)], b: Probe[] = [probeMine(w)];
  for (let t = 0; t < ticks; t++) {
    const i1 = script(t, r1), i2 = script(t, r2);
    orig.step(s, i1, 1 / 60);
    const f: InputFrame = { move: { x: i2.x, y: i2.y }, aim: null, dash: i2.dodge, fire: i2.attack };
    step(w, f, ev); ev.length = 0;
    a.push(probeOrig(s)); b.push(probeMine(w));
  }
  return { a, b };
}

const scripts: Record<string, Script> = {
  'stand still': () => ({ x: 0, y: 0, attack: false, dodge: false }),
  'mash attack': () => ({ x: 0, y: 0, attack: true, dodge: false }),
  'attack + dodge every 70 ticks': (t) => ({ x: t % 140 < 70 ? 1 : -1, y: 0, attack: true, dodge: t % 70 === 40 }),
  'random walk, dodge and strike': (_t, r) => ({ x: r.int(-1, 1), y: r.int(-1, 1), attack: r.next() < 0.3, dodge: r.next() < 0.03 }),
};

describe('E1.4 parity with playables/blood-sea/combat.mjs (+-1 tick)', () => {
  for (const [name, script] of Object.entries(scripts)) {
    it(`${name}: the first ten changes of every counter land within 1 tick, and the outcome matches`, () => {
      const { a, b } = run(script, 60 * 12, 3);
      const ca = changes(a), cb = changes(b);
      if (process.env.PARITY_DEBUG) console.log(name, JSON.stringify(ca), JSON.stringify(cb));
      let worst = 0;
      for (const k of Object.keys(ca)) {
        const xs = ca[k]!.slice(0, 10), ys = cb[k] ?? [];
        // The mode may stay 'playing' for the whole window; for every other key the same changes must exist.
        expect(ys.length, `${k}: count`).toBeGreaterThanOrEqual(xs.length);
        for (let i = 0; i < xs.length; i++) worst = Math.max(worst, Math.abs((ys[i] as number) - (xs[i] as number)));
      }
      console.log(`parity ${name}: worst deviation ${worst} tick(s)`);
      expect(worst).toBeLessThanOrEqual(1);
      expect(b[b.length - 1]!.bossHp).toBe(a[a.length - 1]!.bossHp);
      expect(b[b.length - 1]!.playerHp).toBe(a[a.length - 1]!.playerHp);
    });
  }
});
