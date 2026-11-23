// Đằng Hóa Nguyên (G2-HN 2): the data-driven encounter content/encounters/dang_hoa_nguyen.yaml through the real step() with content.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { BossRow, MobRow } from '../../contracts/content.ts';
import { COMBAT } from '../../contracts/combat.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { msToTicks } from '../../contracts/world.ts';
import { spawnActor } from '../actors.ts';
import { contentFromTables } from '../context.ts';
import { hashWorld } from '../hash.ts';
import { createWorld, NO_INPUT, step } from '../loop.ts';
import { setMode } from '../systems/combat.ts';
import { encounterProblems, phaseIndex, type Encounter } from './boss.ts';

const { tables } = loadTables();
const enc = tables.encounters['dang_hoa_nguyen'] as Encounter;
const bossRow = tables.bosses.find((b) => b.id === 'boss_teng_huayuan') as unknown as BossRow;
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: [], encounters: { dang_hoa_nguyen: enc } });
const mobIds = new Set(tables.mobs.map((m) => String(m.id)));

/** Player at the left, the boss at the right, like floor.ts spawns them; the boss starts with its first attack 84 ticks away. */
function arena(seed: number): { w: WorldState; ev: GameEvent[]; boss: ReturnType<typeof spawnActor> } {
  const w = createWorld(seed), ev: GameEvent[] = [];
  spawnActor(w, 'player', 125, 176, 60, ev, 5);
  const boss = spawnActor(w, 'boss_teng_huayuan', 253, 139, bossRow.hp, ev, 19);
  boss.facing = 'west'; boss.ai.state = 'stalk'; boss.ai.timer = 84;
  setMode(w, 'playing', ev);
  return { w, ev, boss };
}
const run = (w: WorldState, ev: GameEvent[], n: number, input: (t: number) => Partial<InputFrame> = () => ({})): void => { for (let t = 0; t < n; t++) step(w, { ...NO_INPUT, ...input(t) }, ev, { content }); };

describe('encounter dang_hoa_nguyen', () => {
  it('is playable by the runner, names real mobs, and every tell is at least 250 ms', () => {
    expect(encounterProblems(enc, mobIds)).toEqual([]);
    for (const a of Object.values(enc.attacks)) expect(msToTicks(a.tell.ms)).toBeGreaterThanOrEqual(msToTicks(250));
  });
  it('has the three phases of the GDD (100-60 / 60-30 / 30-0 %) and the behaviours it lists', () => {
    expect(enc.phases.map((p) => [p.id, p.hp_above])).toEqual([['p1', 0.6], ['p2', 0.3], ['p3', 0]]);
    expect(phaseIndex(enc, 31, 50)).toBe(0); expect(phaseIndex(enc, 30, 50)).toBe(1); expect(phaseIndex(enc, 16, 50)).toBe(1); expect(phaseIndex(enc, 15, 50)).toBe(2);
    expect(enc.phases[0]!.loop).toEqual(['slash', 'bolt']);               // sword arcs, bolt volleys
    expect(enc.phases[1]!.loop).toContain('summon');                       // summons corpse puppets
    expect(enc.attacks['summon']!.summon!.mobs.map((m) => m.mob)).toEqual(['mob_blood_corpse']);
    expect(enc.phases[2]!.opener).toBe('nova'); expect(enc.phases[2]!.loop).toContain('nova'); // full-room nova
    expect(enc.phases[2]!.speed_mul).toBeGreaterThan(1);                   // faster in the last phase
    expect(enc.phases.slice(0, 2).some((p) => p.loop.includes('nova'))).toBe(false);
    expect(enc.phases[0]!.loop).not.toContain('summon');
  });
  it('the boss row points at the encounter', () => {
    expect(bossRow.encounter).toBe('dang_hoa_nguyen'); expect(enc.boss).toBe('boss_teng_huayuan'); expect(bossRow.biome).toBe('hengyue');
  });

  it('is deterministic: the same scripted fight twice gives the same hash', () => {
    const script = (t: number): Partial<InputFrame> => ({ move: { x: t % 140 < 70 ? 1 : -1, y: 0 }, fire: true, dash: t % 70 === 40 });
    const a = arena(7), b = arena(7);
    run(a.w, a.ev, 60 * 30, script); run(b.w, b.ev, 60 * 30, script);
    expect(hashWorld(a.w)).toBe(hashWorld(b.w));
  });
  it('p1 telegraphs sword arc then bolt, each as its hazard shape, and a standing player is hit at the end of the tell', () => {
    const { w, ev } = arena(1);
    const kinds: string[] = [];
    for (let t = 0; t < 60 * 12; t++) { const n = w.hazards.length; step(w, NO_INPUT, ev, { content }); if (w.hazards.length > n) kinds.push(w.hazards.at(-1)!.kind); if (kinds.length === 2) break; }
    expect(kinds).toEqual(['claw', 'seal']);
    run(w, ev, 60 * 3);
    expect(w.stats.hitsTaken).toBeGreaterThanOrEqual(1);
  });
  it('a dash into a telegraph is a dodge-counter, not a hit', () => {
    const { w, ev } = arena(1);
    let dodged = false;
    for (let t = 0; t < 60 * 20 && !dodged; t++) {
      const h = w.hazards[0];
      step(w, { ...NO_INPUT, dash: !!h && h.timer === COMBAT.guardCheck - 4, move: { x: 0, y: 1 } }, ev, { content });
      dodged = ev.some((e) => e.type === 'dodge-counter');
    }
    expect(dodged).toBe(true);
  });
  it('announces p2 then p3, plays the nova first in p3, and the summon only in p2 or later', () => {
    const { w, ev, boss } = arena(1);
    const phases: string[] = [], names: string[] = [];
    let was = 0;
    for (let t = 0; t < 60 * 60 && w.mode === 'playing'; t++) {
      // the boss loses health in steps so every phase is entered (the player is kept alive and untouched)
      if (t === 60 * 8) boss.hp = Math.floor(bossRow.hp * 0.55);
      if (t === 60 * 20) boss.hp = Math.floor(bossRow.hp * 0.25);
      w.actors[0]!.hp = 60; w.actors[0]!.invuln = 5;
      step(w, NO_INPUT, ev, { content });
      for (const e of ev) if (e.type === 'phase-changed') phases.push(e.phase);
      for (const e of ev) if (e.type === 'telegraph' && w.hazards.length > was) names.push(w.hazards.at(-1)!.kind);
      was = w.hazards.length; ev.length = 0;
    }
    expect(phases).toEqual(['p2', 'p3']);
    expect(names).toContain('wail'); expect(names).toContain('circle');
  });
  it('the summon calls blood corpses at the end of its tell, never above max_alive (3)', () => {
    const { w, ev, boss } = arena(1);
    boss.hp = Math.floor(bossRow.hp * 0.5); boss.ai.data[2] = bossRow.hp;
    const seen = new Set<string>();
    for (let t = 0; t < 60 * 40; t++) {
      w.actors[0]!.hp = 60; w.actors[0]!.invuln = 5;
      step(w, NO_INPUT, ev, { content });
      expect(w.actors.filter((a) => a.role === 'mob' && a.hp > 0).length).toBeLessThanOrEqual(3);
      for (const a of w.actors) if (a.role === 'mob') seen.add(a.kind);
    }
    expect([...seen]).toEqual(['mob_blood_corpse']);
  });
  it('walks faster in p3 than in p1 (speed_mul)', () => {
    const dist = (hp: number): number => {
      const { w, ev, boss } = arena(1);
      boss.hp = hp; boss.ai.timer = 600; boss.ai.data[2] = hp; boss.ai.data[1] = 2; // stalking, far from the player, phase already announced
      w.actors[0]!.pos.x = 20;
      const x0 = boss.pos.x; run(w, ev, 30);
      return x0 - boss.pos.x;
    };
    const p1 = dist(bossRow.hp), p3 = dist(Math.floor(bossRow.hp * 0.2));
    expect(p3).toBeGreaterThan(p1 * 1.3);
  });
});
