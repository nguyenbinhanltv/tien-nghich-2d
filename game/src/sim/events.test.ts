// What the sim tells the renderer, HUD and audio: footsteps, shots hitting walls, and the run/room state.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../tools/lib/tables.ts';
import { loadLayouts } from '../../tools/lib/rooms.ts';
import type { BossRow, MobRow, RoomLayout, RoomRow } from '../contracts/content.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import type { Encounter } from './ai/boss.ts';
import { findPlayer } from './actors.ts';
import { contentFromTables } from './context.ts';
import { createWorld, NO_INPUT, startGhostKingFight, step } from './loop.ts';
import { damageEnemy } from './systems/combat.ts';
import { MOB_STEP_TICKS, PLAYER_STEP_TICKS } from './systems/footsteps.ts';
import { enterRoom, startFloor, TILE } from './run/floor.ts';
import { takeGate } from './run/run.ts';

const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter>, layouts: Object.fromEntries(loadLayouts()) as Record<string, RoomLayout> });
const ctx = { content };

const run = (w: WorldState, n: number, input: Partial<InputFrame> = {}, withContent = true): GameEvent[] => {
  const all: GameEvent[] = [], ev: GameEvent[] = [];
  for (let i = 0; i < n; i++) { ev.length = 0; step(w, { ...NO_INPUT, ...input }, ev, withContent ? ctx : undefined); all.push(...ev); }
  return all;
};
const fresh = (): { w: WorldState; ev: GameEvent[] } => { const w = createWorld(1), ev: GameEvent[] = []; startFloor(w, content, 1, ev); return { w, ev }; };

describe('step clip events', () => {
  it('the walking player puts a foot down every 8 ticks; standing or dashing does not', () => {
    const { w } = fresh();
    const walk = run(w, 48, { move: { x: 1, y: 0 } }).filter((e) => e.type === 'clip-event' && e.name === 'step' && e.actor === findPlayer(w)!.id);
    expect(walk.length).toBeGreaterThanOrEqual(5); expect(walk.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < walk.length; i++) expect(walk[i]!.tick - walk[i - 1]!.tick).toBe(PLAYER_STEP_TICKS);
    const { w: w2 } = fresh();
    const mine = (e: GameEvent): boolean => e.type === 'clip-event' && e.actor === findPlayer(w2)!.id;
    expect(run(w2, 40).filter(mine)).toEqual([]);
    const dash = run(w2, 8, { move: { x: 0, y: 1 }, dash: true }).filter(mine);
    expect(dash).toEqual([]);
  });
  it('walkers (wolf, corpse) step every 10 ticks; the flying crow and the floating soul never do', () => {
    const { w, ev } = fresh();
    enterRoom(w, content, 'room_bs_2', ev); // two corpses and a wolf
    const steps = run(w, 300).filter((e) => e.type === 'clip-event' && e.name === 'step');
    const kinds = new Set(steps.map((e) => w.actors.find((a) => a.id === (e as { actor: number }).actor)?.kind));
    expect(kinds.has('mob_blood_corpse')).toBe(true);
    expect(kinds.has('mob_blood_crow')).toBe(false); expect(kinds.has('mob_vengeful_soul')).toBe(false);
    const fly = fresh(); enterRoom(fly.w, content, 'room_bs_5', fly.ev); // souls and wolves
    const flySteps = run(fly.w, 300).filter((e) => e.type === 'clip-event' && e.name === 'step').map((e) => fly.w.actors.find((a) => a.id === (e as { actor: number }).actor)?.kind);
    expect(flySteps.includes('mob_vengeful_soul')).toBe(false); expect(flySteps.includes('mob_blood_wolf')).toBe(true);
    const corpse = steps.filter((e) => w.actors.find((a) => a.id === (e as { actor: number }).actor)?.kind === 'mob_blood_corpse');
    expect(corpse.length).toBeGreaterThan(2);
    expect(MOB_STEP_TICKS).toBe(10);
  });
  it('the legacy fight (no context) emits none, so the replay goldens are untouched', () => {
    const w = createWorld(1), ev: GameEvent[] = [];
    startGhostKingFight(w, ev);
    expect(run(w, 120, { move: { x: 1, y: 0 } }, false).filter((e) => e.type === 'clip-event' && e.name === 'step')).toEqual([]);
  });
});

describe('shots', () => {
  it('a shot that hits a wall says so with projectile-hit and target 0; one that hits an actor names it', () => {
    const { w } = fresh();
    findPlayer(w)!.pos.x = 100; findPlayer(w)!.pos.y = 100;
    for (const a of w.actors) if (a.role === 'mob') a.pos.x = 5000; // out of the way
    const wall = run(w, 120, { fire: true, aim: { x: -1, y: 0 } }).filter((e) => e.type === 'projectile-hit');
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.every((e) => e.target === 0)).toBe(true);
    const { w: w2, ev } = fresh();
    findPlayer(w2)!.pos.x = 120; findPlayer(w2)!.pos.y = 150;
    const wolf = w2.actors.find((a) => a.role === 'mob')!; wolf.pos.x = 200; wolf.pos.y = 150; wolf.hp = wolf.hpMax = 999;
    void ev;
    const hits = run(w2, 90, { fire: true, aim: { x: 1, y: 0 } }).filter((e) => e.type === 'projectile-hit');
    expect(hits.some((e) => e.target === wolf.id)).toBe(true);
  });
});

describe('the run state for the HUD and the renderer', () => {
  it('exposes room, wave, doors (open or shut), pressure, cluster and realm', () => {
    const { w, ev } = fresh();
    expect(w.stage).toMatchObject({ room: 'room_bs_1', wave: 1, waves: 1, cleared: false, pressure: 1 });
    expect(w.stage!.doors).toEqual([{ side: 'west', role: 'entry', to: 'room_abode_hub', open: false }, { side: 'east', role: 'exit', to: 'room_bs_2', open: false }]);
    expect(w.run).toMatchObject({ room: 0, cluster: 0, realm: 1 });
    for (const a of [...w.actors]) if (a.role === 'mob') damageEnemy(w, a, 999, 1, false, ev);
    for (let i = 0; i < 60; i++) { ev.length = 0; step(w, NO_INPUT, ev, ctx); }
    expect(w.stage!.cleared).toBe(true);
    expect(w.stage!.doors.find((d) => d.role === 'exit')!.open).toBe(true); expect(w.stage!.doors.find((d) => d.role === 'entry')!.open).toBe(false);
  });
  it('announces the realm gate once, then lets the player through after takeGate', () => {
    const { w, ev } = fresh();
    enterRoom(w, content, 'room_bs_6', ev); w.run!.room = 5; w.run!.cluster = 1;
    for (let wave = 0; wave < 2; wave++) {
      for (const a of [...w.actors]) if (a.role === 'mob' && a.hp > 0) damageEnemy(w, a, 999, 1, false, ev);
      for (let i = 0; i < 50; i++) { ev.length = 0; step(w, NO_INPUT, ev, ctx); }
    }
    expect(w.stage!.cleared).toBe(true);
    const p = findPlayer(w)!;
    p.pos.x = 23 * TILE + 8; p.pos.y = 7 * TILE + 8;
    const gate: GameEvent[] = [];
    for (let i = 0; i < 20; i++) { ev.length = 0; step(w, NO_INPUT, ev, ctx); gate.push(...ev.filter((e) => e.type === 'gate-pending')); }
    expect(gate).toHaveLength(1); expect(w.stage!.gatePending).toBe(true); expect(w.stage!.room).toBe('room_bs_6');
    takeGate(w, 'pill', ev); ev.length = 0; step(w, NO_INPUT, ev, ctx);
    expect(w.stage!.room).toBe('room_bs_7'); expect(w.run!.cluster).toBe(2);
  });
});
