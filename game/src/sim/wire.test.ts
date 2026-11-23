// The integration of step(): with a SimContext the mobs and the boss run from content; without one nothing changes.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../tools/lib/tables.ts';
import type { BossRow, MobRow, RoomRow } from '../contracts/content.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { hashState } from './hash.ts';
import { spawnMob } from './ai/index.ts';
import type { Encounter } from './ai/boss.ts';
import { contentFromTables } from './context.ts';
import { createWorld, NO_INPUT, startGhostKingFight, step } from './loop.ts';
import { createSim } from './sim.ts';
import { spawnActor } from './actors.ts';
import { setMode } from './systems/combat.ts';
import { Rng } from './rng.ts';

const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter> });
const ctx = { content };

/** The world without the clip names (the data-driven boss plays the file's real clips, the reference invents `attack_seal`). */
const projection = (w: WorldState): string => hashState({ ...w, actors: w.actors.map((a) => ({ ...a, clip: '', clipStartTick: 0 })), projectiles: { count: w.projectiles.count } });
const script = (t: number, r: Rng): InputFrame => ({ ...NO_INPUT, move: { x: r.int(-1, 1), y: r.int(-1, 1) }, fire: r.next() < 0.3, dash: r.next() < 0.04 + (t % 90 === 40 ? 1 : 0) });

describe('step() with content', () => {
  it('the boss fight plays out the same as the reference fight, tick for tick', () => {
    const a = createWorld(5), b = createWorld(5), ea: GameEvent[] = [], eb: GameEvent[] = [];
    startGhostKingFight(a, ea); startGhostKingFight(b, eb);
    const ra = new Rng(5), rb = new Rng(5);
    for (let t = 0; t < 60 * 25; t++) {
      step(a, script(t, ra), ea); step(b, script(t, rb), eb, ctx);
      expect(projection(b)).toBe(projection(a));
    }
  });
  it('an arena of the five mobs: they chase, telegraph, and a player who stands still gets hurt', () => {
    const w = createWorld(3), ev: GameEvent[] = [];
    spawnActor(w, 'player', 192, 150, 6, ev, 5);
    for (const [k, x, y] of [['mob_blood_wolf', 80, 150], ['mob_blood_crow', 300, 100], ['mob_blood_corpse', 150, 200], ['mob_vengeful_soul', 300, 200], ['mob_blood_pool_lurker', 200, 160]] as const) spawnMob(w, content, k, x, y, ev);
    setMode(w, 'playing', ev);
    const start = w.actors.slice(1).map((a) => ({ ...a.pos }));
    let telegraphs = 0;
    for (let t = 0; t < 900 && w.mode === 'playing'; t++) { ev.length = 0; step(w, NO_INPUT, ev, ctx); telegraphs += ev.filter((e) => e.type === 'telegraph').length; }
    expect(telegraphs).toBeGreaterThanOrEqual(5);
    expect(w.stats.hitsTaken).toBeGreaterThan(0);
    expect(w.actors.slice(1).some((a, i) => a.pos.x !== start[i]!.x || a.pos.y !== start[i]!.y)).toBe(true);
    for (const a of w.actors.slice(1)) { expect(a.pos.x).toBeGreaterThanOrEqual(w.room.minX); expect(a.pos.x).toBeLessThanOrEqual(w.room.maxX); expect(a.pos.y).toBeGreaterThanOrEqual(w.room.minY); expect(a.pos.y).toBeLessThanOrEqual(w.room.maxY); }
  });
  it('is deterministic through the Sim facade, and the player can kill a mob with a blade', () => {
    const mk = (): ReturnType<typeof createSim> => {
      const s = createSim({ seed: 11, content }), ev: GameEvent[] = [];
      spawnActor(s.world, 'player', 150, 150, 6, ev, 5); spawnMob(s.world, content, 'mob_blood_corpse', 190, 150, ev); setMode(s.world, 'playing', ev);
      return s;
    };
    const a = mk(), b = mk();
    for (let t = 0; t < 600; t++) { const i = { ...NO_INPUT, fire: true, aim: { x: 1, y: 0 } }; a.step(i); b.step(i); }
    expect(a.hash()).toBe(b.hash());
    expect(a.world.stats.hits).toBeGreaterThan(0);
  });
});
