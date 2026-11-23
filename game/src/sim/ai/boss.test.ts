// Oán Hồn Quỷ Vương: the data-driven runner (boss.ts + content/encounters/oan_hon_quy_vuong.yaml) against the reference
// port (systems/ghost-king.ts). Same fight, same scripted input: the two worlds must be equal after EVERY tick.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { COMBAT } from '../../contracts/combat.ts';
import { msToTicks } from '../../contracts/world.ts';
import { findPlayer } from '../actors.ts';
import { hashState } from '../hash.ts';
import { createWorld, NO_INPUT, startGhostKingFight } from '../loop.ts';
import { Rng } from '../rng.ts';
import { sweepDead, setMode } from '../systems/combat.ts';
import { ghostKingStep } from '../systems/ghost-king.ts';
import { playerControl, tickTimers } from '../systems/movement.ts';
import { projectileSystem } from '../systems/projectile.ts';
import { bossStep, encounterProblems, phaseIndex, type Encounter } from './boss.ts';

const { tables } = loadTables();
const enc = tables.encounters['oan_hon_quy_vuong'] as Encounter;
const speed = Number(tables.bosses.find((b) => b.id === 'boss_ghost_king')!.speed);

type BossFn = (w: WorldState, ev: GameEvent[]) => void;
const reference: BossFn = (w, ev) => { for (const a of w.actors) if (a.role === 'boss') ghostKingStep(w, a, ev); };
const dataDriven: BossFn = (w, ev) => { for (const a of w.actors) if (a.role === 'boss') bossStep(w, a, enc, speed, ev); };

/** The playing branch of loop.ts `step`, with the boss system injected. */
function tick(w: WorldState, input: InputFrame, ev: GameEvent[], boss: BossFn): void {
  w.tick++;
  const p = findPlayer(w);
  if (w.mode === 'falling') { if (p) { p.combat.down = Math.max(0, p.combat.down - 1); if (!p.combat.down) setMode(w, 'lost', ev); } return; }
  if (w.mode === 'releasing') { for (const a of w.actors) if (a.role === 'boss' && a.ai.state === 'release') { a.ai.timer = Math.max(0, a.ai.timer - 1); if (!a.ai.timer) setMode(w, 'won', ev); } return; }
  if (w.mode !== 'playing') return;
  w.elapsed++;
  if (w.freeze > 0) { w.freeze--; return; }
  if (p) { tickTimers(p); playerControl(w, p, input, ev); }
  projectileSystem(w, ev);
  if (w.mode !== 'playing') return;
  boss(w, ev);
  sweepDead(w, ev);
}

/** The world without what legitimately differs: the clip names (the file's real clips vs the reference's invented `attack_seal`) and the phase label. */
function projection(w: WorldState): string {
  const actors = w.actors.map((a) => ({ ...a, clip: '', clipStartTick: 0 }));
  return hashState({ ...w, actors, projectiles: { count: w.projectiles.count } });
}

type Script = (t: number, rng: Rng) => Partial<InputFrame>;
const SCRIPTS: Record<string, Script> = {
  'stand still': () => ({}),
  'mash strike': () => ({ fire: true }),
  'strike and dodge on a rhythm': (t) => ({ move: { x: t % 140 < 70 ? 1 : -1, y: 0 }, fire: true, dash: t % 70 === 40 }),
  'dash into each telegraph': (t) => ({ dash: t % 130 === 118 }),
  'random walk, dodge and strike': (_t, r) => ({ move: { x: r.int(-1, 1), y: r.int(-1, 1) }, fire: r.next() < 0.3, dash: r.next() < 0.04 }),
};

function fight(script: Script, seed: number, ticks: number): { same: boolean; firstDiff: number; a: WorldState; b: WorldState; evA: GameEvent[]; evB: GameEvent[] } {
  const wa = createWorld(seed), wb = createWorld(seed), evA: GameEvent[] = [], evB: GameEvent[] = [];
  startGhostKingFight(wa, evA); startGhostKingFight(wb, evB);
  const ra = new Rng(seed), rb = new Rng(seed);
  let firstDiff = -1;
  for (let t = 0; t < ticks; t++) {
    tick(wa, { ...NO_INPUT, ...script(t, ra) }, evA, reference);
    tick(wb, { ...NO_INPUT, ...script(t, rb) }, evB, dataDriven);
    if (firstDiff < 0 && projection(wa) !== projection(wb)) firstDiff = t;
  }
  return { same: firstDiff < 0, firstDiff, a: wa, b: wb, evA, evB };
}

describe('encounter oan_hon_quy_vuong', () => {
  it('is playable by the runner and keeps the contract windows', () => {
    expect(encounterProblems(enc)).toEqual([]);
    for (const a of Object.values(enc.attacks)) expect(msToTicks(a.tell.ms)).toBeGreaterThanOrEqual(msToTicks(250));
    expect(msToTicks(enc.attacks['wail']!.tell.ms)).toBe(COMBAT.wailCall + COMBAT.dodgeGuard);
    expect(msToTicks(enc.attacks['claw']!.tell.ms)).toBe(COMBAT.clawWarning);
  });
  it('has two phases split at half health, with the wail as the opener of the second', () => {
    expect(enc.phases.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(phaseIndex(enc, 7, 12)).toBe(0); expect(phaseIndex(enc, 6, 12)).toBe(1); expect(phaseIndex(enc, 1, 12)).toBe(1);
    expect(enc.phases[1]!.opener).toBe('wail');
  });
  it('rejects a broken encounter (unknown hit shape, short tell, unknown attack, non-falling phases)', () => {
    const bad = structuredClone(enc);
    bad.attacks['claw']!.hit.id = 'nope'; bad.attacks['seal']!.tell.ms = 100; bad.phases[0]!.loop.push('ghost'); bad.phases[1]!.hp_above = 0.9; bad.phases[1]!.opener = 'wial';
    const p = encounterProblems(bad).join('\n');
    expect(p).toMatch(/unknown hit shape nope/); expect(p).toMatch(/under 250 ms/); expect(p).toMatch(/unknown attack ghost/); expect(p).toMatch(/unknown attack wial/); expect(p).toMatch(/must fall/);
  });

  for (const [name, script] of Object.entries(SCRIPTS)) {
    it(`${name}: world equals the reference after every tick (parity)`, () => {
      const r = fight(script, 5, 60 * 25);
      expect(r.firstDiff, 'first differing tick').toBe(-1);
      expect(r.a.stats).toEqual(r.b.stats);
      expect(r.evA.map((e) => e.type)).toEqual(r.evB.map((e) => e.type));
    });
  }
  it('the scripts reach both phases and a dodge, so the parity covers them', () => {
    const strike = fight(SCRIPTS['strike and dodge on a rhythm']!, 5, 60 * 25), dash = fight(SCRIPTS['dash into each telegraph']!, 5, 60 * 25);
    expect(strike.evB.some((e) => e.type === 'phase-changed')).toBe(true);
    expect(dash.evB.some((e) => e.type === 'dodge-counter')).toBe(true);
    const r = dash;
    expect(r.evB.filter((e) => e.type === 'telegraph').length).toBeGreaterThanOrEqual(4);
  });
  it('announces every phase entry with phase-changed, opener or not', () => {
    const r = fight(SCRIPTS['strike and dodge on a rhythm']!, 5, 60 * 25);
    expect(r.evB.filter((e) => e.type === 'phase-changed').map((e) => (e as { phase: string }).phase)).toEqual(['p2']);
    const noOpener = structuredClone(enc); delete noOpener.phases[1]!.opener;
    const w = createWorld(1), ev: GameEvent[] = [];
    startGhostKingFight(w, ev);
    const boss = w.actors.find((a) => a.role === 'boss')!;
    boss.hp = 5; boss.ai.data[2] = boss.hpMax; boss.ai.timer = 0; // already below half and about to attack
    for (let i = 0; i < 3; i++) bossStep(w, boss, noOpener, speed, ev);
    expect(ev.filter((e) => e.type === 'phase-changed')).toHaveLength(1);
    expect(boss.clip).toBe(noOpener.attacks[noOpener.phases[1]!.loop[0]!]!.clip);
  });
  it('is deterministic: the same fight twice gives the same hash', () => {
    const a = fight(SCRIPTS['random walk, dodge and strike']!, 9, 1500), b = fight(SCRIPTS['random walk, dodge and strike']!, 9, 1500);
    expect(projection(a.b)).toBe(projection(b.b));
  });
});
