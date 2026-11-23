import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { CHECKPOINT_EVERY, GOLDEN_FILE, SCENARIOS, compareToGolden, replayHash, runScenario } from '../tools/lib/qa-replay.ts';
import type { Golden } from '../tools/lib/qa-replay.ts';

const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as Golden;

describe('E9.1 determinism and replay', () => {
  it('every scenario matches the recorded golden hashes (sim behaviour change = deliberate re-record)', () => {
    expect(compareToGolden(golden)).toEqual([]);
  }, 60_000);
  for (const s of SCENARIOS) {
    it(`${s.name}: two live runs are identical, and the input log rebuilds the same world`, () => {
      const a = runScenario(s), b = runScenario(s);
      expect(b.result).toEqual(a.result);
      expect(a.result.checkpoints).toHaveLength(Math.floor(s.ticks / CHECKPOINT_EVERY));
      const r = replayHash(s, a);
      expect(r).toMatchObject({ ok: true, hash: a.result.finalHash });
    }, 30_000);
  }
  it('the corpus covers a win, a loss, an empty room and a run with actions', () => {
    const modes = new Set(Object.values(golden.scenarios).map((r) => r.mode));
    expect(modes).toContain('won'); expect(modes).toContain('lost'); expect(modes).toContain('playing');
    expect(golden.scenarios.run_flow!.events['reward-gained']).toBeGreaterThan(0);
  });
  it('is sensitive: another seed or one changed input gives different hashes', () => {
    const base = SCENARIOS.find((s) => s.name === 'gk_circler')!;
    const a = runScenario(base).result;
    expect(runScenario({ ...base, seed: base.seed + 1 }).result.finalHash).not.toBe(a.finalHash);
    const nudged = runScenario({ ...base, policy: (t, r) => { const i = base.policy(t, r); return t === 100 ? { ...i, move: { x: 0.5, y: 0.5 } } : i; } }).result;
    expect(nudged.checkpoints[0]).not.toBe(a.checkpoints[0]);
  });
  it('a tampered golden is reported with the tick where the run diverges', () => {
    const bad = structuredClone(golden);
    bad.scenarios.gk_circler!.checkpoints[2] = 'deadbeef';
    expect(compareToGolden(bad).join('\n')).toMatch(/gk_circler: diverges at tick 1800 \(got [0-9a-f]{8}, golden deadbeef\)/);
    delete bad.scenarios.gk_idle;
    expect(compareToGolden(bad).join('\n')).toMatch(/gk_idle: not in golden/);
  }, 60_000);
});
