// E9.1: the determinism and replay corpus. A scenario is (seed, setup, scripted-input policy, length); running it gives a
// checkpoint list (the world hash every CHECKPOINT_EVERY ticks), the final hash, event counts and a few outcome numbers.
// tests/golden/replay.json holds the recorded results: the same seed and inputs must give the same hashes on every machine and
// after every refactor. A change in sim behaviour changes them ON PURPOSE: re-record with `npm run qa:replay -- --record` and review the diff.
import type { GameEvent, InputFrame, WorldState } from '../../src/contracts/world.ts';
import { hashWorld } from '../../src/sim/hash.ts';
import { createWorld, startGhostKingFight, step } from '../../src/sim/loop.ts';
import { Rng } from '../../src/sim/rng.ts';
import { InputRecorder, performRunAction, quantizeInput, resumeRun, suspendRun } from '../../src/sim/save/replay.ts';
import type { RunAction } from '../../src/sim/save/replay.ts';
import { startRun } from '../../src/sim/run/run.ts';
import path from 'node:path';
import { GAME } from './repo.ts';
import { findPlayer } from '../../src/sim/actors.ts';

export const GOLDEN_FILE = path.join(GAME, 'tests/golden/replay.json');
export const CHECKPOINT_EVERY = 600;
type Policy = (tick: number, rng: Rng) => InputFrame;
export interface Scenario { name: string; seed: number; ticks: number; setup: 'ghost-king' | 'ghost-king-run' | 'empty'; policy: Policy; actions?: Record<number, RunAction> }
export interface Result { checkpoints: string[]; finalHash: string; events: Record<string, number>; mode: string; playerHp: number | null; bossHp: number | null; ticks: number }

const I = (mx: number, my: number, dash = false, fire = false): InputFrame => ({ move: { x: mx, y: my }, aim: null, dash, fire });
const idle: Policy = () => I(0, 0);
/** Walk in a square, dash every 90 ticks, fire all the time (auto-aim). */
const circler: Policy = (t) => { const k = Math.floor(t / 45) % 4; return I([1, 0, -1, 0][k]!, [0, 1, 0, -1][k]!, t % 90 === 0, true); };
/** Random held directions changing every 20 to 60 ticks, random dashes, random fire. */
function randomWalker(): Policy {
  let until = 0, mx = 0, my = 0;
  return (t, rng) => {
    if (t >= until) { until = t + rng.int(20, 60); mx = rng.int(-2, 2) / 2; my = rng.int(-2, 2) / 2; }
    return I(mx, my, rng.int(0, 39) === 0, rng.int(0, 2) > 0);
  };
}

export const SCENARIOS: Scenario[] = [
  { name: 'gk_idle', seed: 1, ticks: 3600, setup: 'ghost-king', policy: idle },
  { name: 'gk_circler', seed: 2, ticks: 5400, setup: 'ghost-king', policy: circler },
  { name: 'gk_random_a', seed: 7, ticks: 5400, setup: 'ghost-king', policy: randomWalker() },
  { name: 'gk_random_b', seed: 4242, ticks: 5400, setup: 'ghost-king', policy: randomWalker() },
  { name: 'empty_walk', seed: 99, ticks: 1200, setup: 'empty', policy: randomWalker() },
  { name: 'run_flow', seed: 5, ticks: 1800, setup: 'ghost-king-run', policy: circler,
    actions: { 100: { t: 'grant', id: 'ore', amount: 2 }, 300: { t: 'advance' }, 600: { t: 'bank' }, 900: { t: 'grant', id: 'seed', amount: 1 }, 1200: { t: 'advance' }, 1500: { t: 'discard' } } },
];
// A policy with state must start fresh per run: build them through a factory so two runs of one scenario do not share it.
export const freshScenario = (s: Scenario): Scenario => (s.name.includes('random') || s.name === 'empty_walk' ? { ...s, policy: randomWalker() } : s);

function setupWorld(s: Scenario, events: GameEvent[]): WorldState {
  const w = createWorld(s.seed);
  if (s.setup !== 'empty') startGhostKingFight(w, events);
  if (s.setup === 'ghost-king-run') startRun(w, 1);
  if (s.setup === 'empty') { w.mode = 'playing'; }
  return w;
}

export interface Live { result: Result; log: string; suspended: ReturnType<typeof suspendRun> }

/** Run a scenario live: inputs go through quantizeInput and the recorder exactly as the game does. */
export function runScenario(s0: Scenario): Live {
  const s = freshScenario(s0);
  const events: GameEvent[] = [], counts: Record<string, number> = {};
  const rec = new InputRecorder(), policyRng = new Rng(s.seed ^ 0x9e3779b9);
  const w = setupWorld(s, events);
  events.length = 0;
  const checkpoints: string[] = [];
  const addEvents = (): void => { for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1; events.length = 0; };
  for (let t = 0; t < s.ticks; t++) {
    const a = s.actions?.[t];
    // A refused action (the run already ended: the player died or won) is simply not logged, as in live play.
    if (a) { try { performRunAction(w, events, rec, a); } catch { /* run over */ } addEvents(); }
    const input = quantizeInput(s.policy(t, policyRng));
    rec.push(input); step(w, input, events); addEvents();
    if ((t + 1) % CHECKPOINT_EVERY === 0) checkpoints.push(hashWorld(w));
  }
  const boss = w.actors.find((a) => a.role === 'boss');
  const result: Result = { checkpoints, finalHash: hashWorld(w), events: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))), mode: w.mode, playerHp: findPlayer(w)?.hp ?? null, bossHp: boss?.hp ?? null, ticks: s.ticks };
  return { result, log: rec.log(), suspended: suspendRun(w, rec) };
}

/** Rebuild the world from the suspended run (seed + input log) and return its hash: must equal the live final hash. */
export function replayHash(s0: Scenario, live: Live): { ok: boolean; reason?: string; hash?: string } {
  const s = freshScenario(s0);
  const r = resumeRun(live.suspended, (w, ev) => {
    if (s.setup !== 'empty') startGhostKingFight(w, ev);
    if (s.setup === 'ghost-king-run') startRun(w, 1);
    if (s.setup === 'empty') w.mode = 'playing';
    ev.length = 0;
  });
  return r.ok ? { ok: true, hash: hashWorld(r.world) } : { ok: false, reason: r.reason };
}

export interface Golden { schema: 'tien-nghich-2d.replay-golden'; version: 1; note: string; checkpointEvery: number; scenarios: Record<string, Result> }
export const GOLDEN_NOTE = 'Recorded by `npm run qa:replay -- --record`. The same seed and inputs must give the same hashes. A diff here means sim behaviour changed: review it before committing.';
export const recordAll = (): Golden => ({ schema: 'tien-nghich-2d.replay-golden', version: 1, note: GOLDEN_NOTE, checkpointEvery: CHECKPOINT_EVERY, scenarios: Object.fromEntries(SCENARIOS.map((s) => [s.name, runScenario(s).result])) });

/** Compare a fresh run to the golden: readable lines, the first diverging checkpoint named. */
export function compareToGolden(golden: Golden): string[] {
  const out: string[] = [];
  for (const s of SCENARIOS) {
    const want = golden.scenarios[s.name];
    if (!want) { out.push(`${s.name}: not in golden (run qa:replay -- --record)`); continue; }
    const got = runScenario(s).result;
    const i = got.checkpoints.findIndex((h, k) => h !== want.checkpoints[k]);
    if (i >= 0) out.push(`${s.name}: diverges at tick ${(i + 1) * CHECKPOINT_EVERY} (got ${got.checkpoints[i]}, golden ${want.checkpoints[i]})`);
    else if (got.finalHash !== want.finalHash) out.push(`${s.name}: final hash ${got.finalHash} differs from golden ${want.finalHash}`);
    else if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${s.name}: hashes equal but the summary differs (events/outcome)`);
  }
  for (const n of Object.keys(golden.scenarios)) if (!SCENARIOS.some((s) => s.name === n)) out.push(`${n}: in golden but no such scenario`);
  return out;
}
