// The boss flinches (combat.hurt) on a COUNTER hit, so its hurt clip can play, without ever interrupting its script.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../tools/lib/tables.ts';
import type { BossRow, MobRow, RoomRow } from '../contracts/content.ts';
import { COMBAT } from '../contracts/combat.ts';
import type { GameEvent, WorldState } from '../contracts/world.ts';
import type { Encounter } from './ai/boss.ts';
import { contentFromTables } from './context.ts';
import { createWorld, NO_INPUT, startGhostKingFight, step } from './loop.ts';
import { damageEnemy } from './systems/combat.ts';

const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter> });
const ctx = { content };

const fight = (): { w: WorldState; ev: GameEvent[] } => { const w = createWorld(3), ev: GameEvent[] = []; startGhostKingFight(w, ev); w.actors.find((a) => a.role === 'boss')!.hp = w.actors.find((a) => a.role === 'boss')!.hpMax = 99; return { w, ev }; };
const boss = (w: WorldState) => w.actors.find((a) => a.role === 'boss')!;
const run = (w: WorldState, n: number, withCtx: boolean, seen?: { state: string; timer: number; hurt: number }[]): void => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) { ev.length = 0; step(w, NO_INPUT, ev, withCtx ? ctx : undefined); if (seen) seen.push({ state: boss(w).ai.state, timer: boss(w).ai.timer, hurt: boss(w).combat.hurt }); }
};

describe.each([['data-driven boss', true], ['reference boss', false]])('%s', (_name, withCtx) => {
  it('a counter hit sets hurt, which runs down to 0 in hurtPose ticks (after the hit-stop); an ordinary hit does not', () => {
    const { w, ev } = fight();
    run(w, 5, withCtx);
    damageEnemy(w, boss(w), 1, 1, false, ev);
    expect(boss(w).combat.hurt).toBe(0);
    damageEnemy(w, boss(w), 1, 1, true, ev);
    expect(boss(w).combat.hurt).toBe(COMBAT.hurtPose);
    run(w, COMBAT.freezeHit, withCtx); expect(boss(w).combat.hurt).toBe(COMBAT.hurtPose); // frozen with the world
    run(w, COMBAT.hurtPose, withCtx); expect(boss(w).combat.hurt).toBe(0);
  });
  it('the flinch never changes the boss script: state and timer follow the same path with or without it', () => {
    const a = fight(), b = fight();
    run(a.w, 40, withCtx); run(b.w, 40, withCtx);
    damageEnemy(a.w, boss(a.w), 1, 1, true, a.ev); // counter hit: flinch
    damageEnemy(b.w, boss(b.w), 1, 1, false, b.ev); // ordinary hit: none
    const sa: { state: string; timer: number; hurt: number }[] = [], sb: typeof sa = [];
    run(a.w, 400, withCtx, sa); run(b.w, 400, withCtx, sb);
    expect(sa.map((s) => [s.state, s.timer])).toEqual(sb.map((s) => [s.state, s.timer]));
    expect(sa.some((s) => s.hurt > 0)).toBe(true); expect(sb.every((s) => s.hurt === 0)).toBe(true);
  });
  it('a dead boss does not flinch', () => {
    const { w, ev } = fight();
    damageEnemy(w, boss(w), 999, 1, true, ev);
    expect(boss(w).combat.hurt).toBe(0);
  });
});
