// Elite = a data variant of a normal mob (G2-HN 4): same row, more health and damage, flagged for the gold outline. No new roster.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import { loadLayouts } from '../../../tools/lib/rooms.ts';
import type { MobRow, RoomLayout } from '../../contracts/content.ts';
import { spawnActor } from '../actors.ts';
import { createWorld } from '../loop.ts';
import { aiSystem, spawnMob } from './index.ts';
import { contentOf } from './harness.ts';
import { ELITE } from './params.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const row = mobs.find((m) => m.id === 'mob_courtyard_guard')!;

function fightWith(elite: boolean, seed = 1) {
  const w = createWorld(seed), ev: never[] = [];
  w.mode = 'playing';
  spawnActor(w, 'player', 200, 150, 60, ev);
  const id = spawnMob(w, content, row.id, 175, 150, ev, elite);
  return { w, ev, mob: w.actors.find((a) => a.id === id)! };
}

describe('elite mob', () => {
  it('has ELITE.hpMul times the health of the row, the same kind and the elite flag; a normal one has no flag', () => {
    const e = fightWith(true).mob, n = fightWith(false).mob;
    expect(e.hp).toBe(row.hp * ELITE.hpMul); expect(e.hpMax).toBe(row.hp * ELITE.hpMul); expect(e.kind).toBe(row.id); expect(e.elite).toBe(true);
    expect(n.hp).toBe(row.hp); expect('elite' in n).toBe(false);
  });
  it('hits harder by ELITE.bonusDamage with the same tell', () => {
    const dmg = (elite: boolean): { damage: number; duration: number } => {
      const { w, ev } = fightWith(elite);
      for (let i = 0; i < 600 && w.hazards.length === 0; i++) { w.tick++; aiSystem(w, content, ev); }
      return { damage: w.hazards[0]!.damage, duration: w.hazards[0]!.duration };
    };
    const n = dmg(false), e = dmg(true);
    expect(e.damage).toBe(n.damage + ELITE.bonusDamage); expect(e.duration).toBe(n.duration);
  });
  it('is deterministic like any mob (same seed, same hash)', () => {
    const run = (): string => { const { w, ev } = fightWith(true, 4); for (let i = 0; i < 900; i++) { w.tick++; aiSystem(w, content, ev); for (const a of w.actors) if (a.role === 'mob') { a.pos.x += a.vel.x; a.pos.y += a.vel.y; } } return JSON.stringify(w.actors.map((a) => [a.pos, a.ai, a.hp])); };
    expect(run()).toBe(run());
  });
  it('a normal mob is unchanged by the feature (the elite flag adds no key to the world)', () => {
    expect(JSON.stringify(fightWith(false).mob)).not.toContain('elite');
  });
});

describe('elites in the layouts', () => {
  const layouts = Object.fromEntries(loadLayouts()) as Record<string, RoomLayout>;
  const elites = Object.entries(layouts).flatMap(([id, L]) => L.waves.flatMap((w) => w.spawns.filter((s) => s.elite).map((s) => `${id}:${s.mob}`)));
  it('Hằng Nhạc has one elite (a normal mob, never a boss) and Huyết Hải none', () => {
    expect(elites).toEqual(['room_hy_6:mob_courtyard_guard']);
  });
});
