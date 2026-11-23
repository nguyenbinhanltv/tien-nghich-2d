// Tile collision, wall-phasing and the mob stagger in the real step().
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../tools/lib/tables.ts';
import type { RoomGrid } from '../contracts/combat.ts';
import type { BossRow, MobRow, RoomRow } from '../contracts/content.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import type { Encounter } from './ai/boss.ts';
import { spawnMob } from './ai/index.ts';
import { spawnActor } from './actors.ts';
import { contentFromTables } from './context.ts';
import { createWorld, NO_INPUT, step } from './loop.ts';
import { setMode } from './systems/combat.ts';
import { circleHitsSolid, pointSolid } from './systems/grid.ts';

const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter> });
const ctx = { content };

/** 24x14 tiles: border walls and a wall column at tile 12 from row 2 to row 11 (a gap at row 12). */
const rows = Array.from({ length: 14 }, (_, r) => Array.from({ length: 24 }, (_, c) => (r < 2 || r === 13 || c === 0 || c === 23 || (c === 12 && r < 12) ? '#' : '.')).join(''));
const grid: RoomGrid = { tile: 16, rows };

function arena(seed = 1): { w: WorldState; ev: GameEvent[]; player: number } {
  const w = createWorld(seed), ev: GameEvent[] = [];
  w.room = { minX: 16, minY: 32, maxX: 368, maxY: 208 }; w.grid = structuredClone(grid);
  const player = spawnActor(w, 'player', 100, 100, 6, ev, 5).id;
  setMode(w, 'playing', ev);
  return { w, ev, player };
}
const mob = (w: WorldState, c: typeof content, kind: string, x: number, y: number, ev: GameEvent[]): ActorState => { const id = spawnMob(w, c, kind, x, y, ev); return w.actors.find((a) => a.id === id)!; };
const run = (w: WorldState, ev: GameEvent[], n: number, input: Partial<InputFrame> = {}): void => { for (let i = 0; i < n; i++) { ev.length = 0; step(w, { ...NO_INPUT, ...input }, ev, ctx); } };

describe('grid maths', () => {
  it('knows walls, floor, the world outside the grid and circles touching a tile', () => {
    expect(pointSolid(grid, 5, 5)).toBe(true); expect(pointSolid(grid, 100, 100)).toBe(false); expect(pointSolid(grid, -5, 100)).toBe(true); expect(pointSolid(grid, 1000, 100)).toBe(true);
    expect(circleHitsSolid(grid, 100, 100, 5)).toBe(false);
    expect(circleHitsSolid(grid, 12 * 16 - 4, 100, 5)).toBe(true); // 4 px from the wall, radius 5
    expect(circleHitsSolid(grid, 12 * 16 - 6, 100, 5)).toBe(false);
  });
});

describe('collision in step()', () => {
  it('the player stops at a wall and slides along it', () => {
    const { w, ev } = arena();
    run(w, ev, 200, { move: { x: 1, y: 0 } });
    const p = w.actors[0]!;
    expect(p.pos.x).toBeLessThan(12 * 16); expect(p.pos.x).toBeGreaterThan(12 * 16 - 8);
    run(w, ev, 40, { move: { x: 1, y: 1 } }); // pushing into the wall and down: x stays, y moves
    expect(p.pos.x).toBeLessThan(12 * 16); expect(p.pos.y).toBeGreaterThan(110);
  });
  it('a dash cannot pass through a wall either', () => {
    const { w, ev } = arena();
    w.actors[0]!.pos.x = 12 * 16 - 9;
    run(w, ev, 1, { move: { x: 1, y: 0 }, dash: true }); run(w, ev, 20, { move: { x: 1, y: 0 } });
    expect(w.actors[0]!.pos.x).toBeLessThan(12 * 16);
  });
  it('a walking mob cannot cross the wall, but the vengeful soul floats through it', () => {
    const { w, ev } = arena();
    w.actors[0]!.pos.x = 340; // the player is far on the other side
    const wolf = mob(w, content, 'mob_blood_corpse', 150, 100, ev);
    const soul = mob(w, content, 'mob_vengeful_soul', 150, 120, ev);
    run(w, ev, 600);
    expect(wolf.pos.x).toBeLessThan(12 * 16);
    expect(soul.pos.x).toBeGreaterThan(12 * 16); // it phased through to keep its distance from the player
  });
  it('a blade stops at the wall and does not hit what stands behind it', () => {
    const { w, ev } = arena();
    const corpse = mob(w, content, 'mob_blood_corpse', 230, 100, ev);
    corpse.combat.hurt = 0; corpse.vel.x = 0;
    run(w, ev, 120, { fire: true, aim: { x: 1, y: 0 } });
    expect(w.stats.hits).toBe(0);
    expect(corpse.hp).toBe(corpse.hpMax);
  });
  it('a mob that is hit flinches for real: its windup is cancelled and the telegraph disappears', () => {
    const { w, ev } = arena();
    w.actors[0]!.pos.x = 120; w.actors[0]!.pos.y = 100;
    const wolf = mob(w, content, 'mob_blood_wolf', 60, 100, ev);
    for (let i = 0; i < 400 && wolf.ai.state !== 'windup'; i++) { ev.length = 0; step(w, NO_INPUT, ev, ctx); }
    expect(wolf.ai.state).toBe('windup'); expect(w.hazards.length).toBe(1);
    // the player's blade (spawned by a strike toward the wolf) lands during the windup
    const p = w.actors[0]!;
    p.pos.x = wolf.pos.x + 30; p.pos.y = wolf.pos.y;
    let flinched = false;
    for (let i = 0; i < 60 && !flinched; i++) { ev.length = 0; step(w, { ...NO_INPUT, fire: true, aim: { x: -1, y: 0 } }, ev, ctx); flinched = wolf.ai.state === 'recover'; }
    expect(w.stats.hits).toBeGreaterThan(0); expect(flinched).toBe(true);
    expect(w.hazards.filter((h) => h.owner === wolf.id)).toHaveLength(0);
  });
});
