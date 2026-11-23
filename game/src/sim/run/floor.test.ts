// The run walks the nine rooms and the boss room, door to door, through the real step().
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import { loadLayouts } from '../../../tools/lib/rooms.ts';
import type { BossRow, MobRow, RoomLayout, RoomRow } from '../../contracts/content.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import type { Encounter } from '../ai/boss.ts';
import { findPlayer } from '../actors.ts';
import { contentFromTables } from '../context.ts';
import { createWorld, NO_INPUT, step } from '../loop.ts';
import { damageEnemy } from '../systems/combat.ts';
import { enterRoom, floorChain, floorSystem, startFloor, TILE } from './floor.ts';
import { takeGate } from './run.ts';
import { dist, unitInto } from '../math.ts';
import { hazardIncoming } from '../systems/telegraph.ts';

const { tables } = loadTables();
const layouts = Object.fromEntries(loadLayouts()) as Record<string, RoomLayout>;
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter>, layouts });
const ctx = { content };

const tick = (w: WorldState, ev: GameEvent[], input: Partial<InputFrame> = {}): void => { ev.length = 0; step(w, { ...NO_INPUT, ...input }, ev, ctx); };
/** Kill what is on the field the way the player's blades do (through damageEnemy). */
const killAll = (w: WorldState, ev: GameEvent[]): void => { for (const a of [...w.actors]) if (a.role !== 'player' && a.hp > 0) damageEnemy(w, a, 999, 1, false, ev); };
/** Put the player in front of the exit door and walk east through it. */
function walkOut(w: WorldState, ev: GameEvent[]): void {
  const p = findPlayer(w)!, st = w.stage!;
  const L = layouts[st.room]!;
  p.pos.x = (L.size[0] - 3) * TILE + 8; p.pos.y = 7 * TILE + 16;
  for (let i = 0; i < 60; i++) { tick(w, ev, { move: { x: 1, y: 0 } }); if (w.stage!.room !== st.room || w.stage!.gatePending) return; }
}
const freshRun = (seed = 1): { w: WorldState; ev: GameEvent[] } => { const w = createWorld(seed), ev: GameEvent[] = []; startFloor(w, content, 1, ev); return { w, ev }; };

describe('floor chain', () => {
  it('is the nine combat rooms and the boss room, from the abode onwards', () => {
    expect(floorChain(content)).toEqual([...Array.from({ length: 9 }, (_, i) => `room_bs_${i + 1}`), 'room_bs_boss', 'room_bs_reward']);
  });
});

describe('a room', () => {
  it('loads from its layout: grid with props and a closed entry and exit, the player at the start, wave 1 on the field', () => {
    const { w, ev } = freshRun();
    const L = layouts['room_bs_1']!;
    expect(w.stage).toEqual({ room: 'room_bs_1', wave: 1, waves: 1, cleared: false, gatePending: false });
    expect(w.mode).toBe('playing'); expect(w.run!.room).toBe(0);
    expect(w.grid!.rows[5]![8]).toBe('P'); // the pillar at (8,5)
    expect(w.grid!.rows[7]![0]).toBe('D'); expect(w.grid!.rows[7]![23]).toBe('D');
    expect(findPlayer(w)!.pos).toEqual({ x: L.player_start[0] * TILE + 8, y: L.player_start[1] * TILE + 8 });
    expect(w.actors.filter((a) => a.role === 'mob').map((a) => a.kind)).toEqual(['mob_blood_wolf', 'mob_blood_wolf']);
    expect(ev.some((e) => e.type === 'room-entered')).toBe(true);
  });
  it('spawns the second wave only when the first is dead, and opens the exit door only after the last', () => {
    const { w, ev } = freshRun();
    enterRoom(w, content, 'room_bs_3', ev); // two waves: 2 crows, then 2 wolves
    expect(w.actors.filter((a) => a.role === 'mob')).toHaveLength(2);
    tick(w, ev); expect(w.stage!.wave).toBe(1);
    killAll(w, ev); for (let i = 0; i < 40; i++) tick(w, ev);
    expect(w.stage!.wave).toBe(2); expect(w.stage!.cleared).toBe(false);
    expect(w.actors.filter((a) => a.role === 'mob' && a.hp > 0).map((a) => a.kind)).toEqual(['mob_blood_wolf', 'mob_blood_wolf']);
    expect(w.grid!.rows[7]![23]).toBe('D');
    killAll(w, ev); for (let i = 0; i < 40; i++) tick(w, ev);
    expect(w.stage!.cleared).toBe(true); expect(w.grid!.rows[7]![23]).toBe('O'); expect(w.grid!.rows[8]![23]).toBe('O');
    expect(w.grid!.rows[7]![0]).toBe('D'); // the way back stays shut
  });
  it('keeps the player in while the door is locked and lets them out when it is open', () => {
    const { w, ev } = freshRun();
    walkOut(w, ev);
    expect(w.stage!.room).toBe('room_bs_1'); expect(findPlayer(w)!.pos.x).toBeLessThan(23 * TILE);
    killAll(w, ev); for (let i = 0; i < 40; i++) tick(w, ev);
    walkOut(w, ev);
    expect(w.stage!.room).toBe('room_bs_2');
  });
});

/** A plain real-input player: dash out of any telegraph that is about to land, otherwise close in on the boss and hold strike. */
function playBoss(seed: number, maxTicks: number): { won: boolean; ticks: number; bossHp: number } {
  const w = createWorld(seed), ev: GameEvent[] = [];
  startFloor(w, content, 1, ev); enterRoom(w, content, 'room_bs_boss', ev);
  const d = { x: 0, y: 0 };
  let t = 0;
  for (; t < maxTicks && w.mode !== 'won' && w.mode !== 'lost'; t++) {
    const p = findPlayer(w)!, boss = w.actors.find((a) => a.role === 'boss')!;
    const h = w.hazards.find((x) => x.timer <= 11 && hazardIncoming(x, p.pos.x, p.pos.y));
    let move = { x: 0, y: 0 }, dash = false;
    if (h && p.combat.cool === 0 && p.combat.dash === 0) {
      dash = true;
      if (h.kind === 'wail') move = { x: h.wedge.x, y: h.wedge.y };
      else if (h.kind === 'claw') { const side = (p.pos.x - h.x) * h.dir.y - (p.pos.y - h.y) * h.dir.x; move = side >= 0 ? { x: h.dir.y, y: -h.dir.x } : { x: -h.dir.y, y: h.dir.x }; }
      else { unitInto(d, p.pos.x - h.x, p.pos.y - h.y); move = { x: d.x || 1, y: d.y }; }
    } else if (dist(p.pos.x, p.pos.y, boss.pos.x, boss.pos.y) > 80) { unitInto(d, boss.pos.x - p.pos.x, boss.pos.y - p.pos.y); move = { x: d.x, y: d.y }; }
    ev.length = 0; step(w, { move, aim: null, dash, fire: true }, ev, ctx);
  }
  return { won: w.mode === 'won', ticks: t, bossHp: w.actors.find((a) => a.role === 'boss')?.hp ?? 0 };
}

describe('the boss with real blades', () => {
  it('starts at the placeholder hp of the mobs-and-reference scale (not the 420 of the format sample)', () => {
    const { w } = freshRun(); enterRoom(w, content, 'room_bs_boss', []);
    const hp = w.actors.find((a) => a.role === 'boss')!.hpMax;
    expect(hp).toBeGreaterThanOrEqual(12); expect(hp).toBeLessThanOrEqual(80);
  });
  it('can be killed by blades in under 60 s of play, and every seed lands blades on it', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((s) => playBoss(s, 60 * 60));
    for (const r of runs) expect(r.bossHp).toBeLessThan(60);
    const kills = runs.filter((r) => r.won);
    expect(kills.length).toBeGreaterThanOrEqual(1);
    for (const k of kills) expect(k.ticks).toBeLessThanOrEqual(60 * 60);
  });
});

describe('the whole floor', () => {
  it('walks 9 combat rooms (gate at the end of cluster 2), then the boss, and the run ends won with the rewards banked', () => {
    const { w, ev } = freshRun(7);
    const seen: string[] = [w.stage!.room];
    for (let guard = 0; guard < 12 && w.stage!.room !== 'room_bs_boss'; guard++) {
      killAll(w, ev); for (let i = 0; i < 80; i++) { tick(w, ev); if (w.stage!.cleared) break; }
      for (let i = 0; i < 3 && !w.stage!.cleared; i++) { killAll(w, ev); for (let k = 0; k < 80 && !w.stage!.cleared; k++) tick(w, ev); }
      expect(w.stage!.cleared).toBe(true);
      walkOut(w, ev);
      if (w.stage!.gatePending) {
        expect(w.stage!.room).toBe('room_bs_6'); expect(w.run!.room).toBe(5);
        takeGate(w, 'breakthrough', ev); tick(w, ev);
      }
      if (seen[seen.length - 1] !== w.stage!.room) seen.push(w.stage!.room);
    }
    expect(seen).toEqual([...Array.from({ length: 9 }, (_, i) => `room_bs_${i + 1}`), 'room_bs_boss']);
    expect(w.run!.room).toBe(9); expect(w.run!.realm).toBe(2);
    expect(w.actors.some((a) => a.kind === 'boss_ghost_king')).toBe(true);
    killAll(w, ev);
    for (let i = 0; i < 400 && w.run!.outcome === 'active'; i++) tick(w, ev);
    expect(w.mode).toBe('won'); expect(w.run!.outcome).toBe('won');
    expect(w.run!.banked.length).toBeGreaterThan(0); expect(w.run!.carried).toEqual([]);
  });
  it('is deterministic', () => {
    const play = (): string => {
      const { w, ev } = freshRun(3);
      for (let i = 0; i < 1200; i++) tick(w, ev, { move: { x: i % 90 < 45 ? 1 : -1, y: 0 }, fire: i % 20 === 0, dash: i % 120 === 60 });
      return JSON.stringify({ t: w.tick, p: findPlayer(w)!.pos, s: w.stats, st: w.stage });
    };
    expect(play()).toBe(play());
  });
  it('floorSystem is a no-op without a floor', () => {
    const w = createWorld(1), ev: GameEvent[] = [];
    floorSystem(w, content, ev);
    expect(ev).toEqual([]);
  });
});
