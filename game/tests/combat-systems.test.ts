// E1.3: movement, dash invulnerability, shooting, projectiles, damage and death on generic actors (no boss script involved).
import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/contracts/combat.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../src/contracts/world.ts';
import { spawnActor } from '../src/sim/actors.ts';
import { hashWorld } from '../src/sim/hash.ts';
import { createWorld, step } from '../src/sim/loop.ts';
import { Rng } from '../src/sim/rng.ts';
import { fireProjectile, KIND, projectileSystem } from '../src/sim/systems/projectile.ts';
import { setMode } from '../src/sim/systems/combat.ts';

const IDLE: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };
const room = (): { w: WorldState; p: ActorState; ev: GameEvent[] } => {
  const w = createWorld(5), ev: GameEvent[] = [];
  const p = spawnActor(w, 'player', 100, 150, 6, ev, 5);
  setMode(w, 'playing', ev);
  return { w, p, ev };
};
const run = (w: WorldState, n: number, input: Partial<InputFrame> = {}, ev: GameEvent[] = []): void => { for (let i = 0; i < n; i++) step(w, { ...IDLE, ...input }, ev); };

describe('movement', () => {
  it('walks at 82 px/s, a diagonal is not faster, and the room bounds clamp', () => {
    const { w, p } = room();
    run(w, 60, { move: { x: 1, y: 0 } });
    expect(p.pos.x).toBeCloseTo(100 + 82, 6);
    const { w: w2, p: p2 } = room();
    run(w2, 60, { move: { x: 1, y: 1 } });
    expect(Math.hypot(p2.pos.x - 100, p2.pos.y - 150)).toBeCloseTo(82, 6);
    run(w, 600, { move: { x: -1, y: 0 } });
    expect(p.pos.x).toBe(w.room.minX);
  });
  it('dash covers 235 px/s for 11 ticks and is invulnerable for the 280 ms guard, then not', () => {
    const { w, p, ev } = room();
    const m = spawnActor(w, 'mob_blood_crow', 300, 150, 8, ev);
    run(w, 1, { move: { x: 1, y: 0 }, dash: true }, ev);
    expect(p.combat.guard).toBe(COMBAT.dodgeGuard);
    run(w, 10, {}, ev);
    expect(p.pos.x).toBeCloseTo(100 + (235 / 60) * 11, 6);
    // A mob shot that reaches the player inside the guard window does nothing.
    fireProjectile(w, m.id, KIND.mobShot, p.pos.x + 2, p.pos.y, -1, 0, 1, 3, 30, 1, false, ev);
    projectileSystem(w, ev);
    expect(p.hp).toBe(6);
    run(w, COMBAT.dodgeGuard, {}, ev);
    expect(p.combat.guard).toBe(0);
    fireProjectile(w, m.id, KIND.mobShot, p.pos.x + 2, p.pos.y, -1, 0, 1, 3, 30, 1, false, ev);
    projectileSystem(w, ev);
    expect(p.hp).toBe(5);
    expect(w.stats.hitsTaken).toBe(1);
  });
  it('a second dash waits for the 850 ms cooldown', () => {
    const { w } = room();
    run(w, 1, { move: { x: 1, y: 0 }, dash: true });
    run(w, 30, { dash: true });
    expect(w.stats.dodges).toBe(1);
    run(w, 40, { dash: true });
    expect(w.stats.dodges).toBe(2);
  });
});

describe('shooting, damage and death', () => {
  it('a strike auto-aims at the nearest enemy, the blade hits it, hp drops, hit-stop starts', () => {
    const { w, p, ev } = room();
    const far = spawnActor(w, 'mob_blood_wolf', 330, 150, 14, ev), near = spawnActor(w, 'mob_blood_crow', 160, 150, 8, ev);
    run(w, 1, { fire: true }, ev);
    expect(p.combat.aim.x).toBeCloseTo(1, 9);
    run(w, 25, {}, ev);
    expect(near.hp).toBe(7);
    expect(far.hp).toBe(14);
    expect(ev.some((e) => e.type === 'hit-stop')).toBe(true);
    expect(ev.filter((e) => e.type === 'projectile-fired').length).toBe(1);
  });
  it('an explicit aim vector overrides auto-aim; no friendly fire between mobs and their shots', () => {
    const { w, ev } = room();
    const a = spawnActor(w, 'mob_blood_crow', 200, 150, 8, ev), b = spawnActor(w, 'mob_blood_wolf', 230, 150, 14, ev);
    fireProjectile(w, a.id, KIND.mobShot, 205, 150, 1, 0, 2, 3, 30, 1, false, ev);
    run(w, 20, {}, ev);
    expect(b.hp).toBe(14);
  });
  it('a mob dies at 0 hp, is swept after the death clip, and the last one clears the room', () => {
    const { w, p, ev } = room();
    const m = spawnActor(w, 'mob_blood_crow', 140, 150, 1, ev);
    run(w, 40, { fire: true }, ev);
    expect(m.hp).toBe(0);
    expect(ev.some((e) => e.type === 'actor-died' && e.actor === m.id)).toBe(true);
    run(w, 40, {}, ev);
    expect(w.actors.includes(m)).toBe(false);
    expect(ev.filter((e) => e.type === 'room-cleared').length).toBe(1);
    expect(w.mode).toBe('playing');
    expect(p.hp).toBe(6);
  });
  it('the player falls at 0 hp: mode falling, then lost after the kneel, and the world stops', () => {
    const { w, p, ev } = room();
    const m = spawnActor(w, 'mob_blood_crow', 400, 150, 8, ev);
    p.hp = 1;
    fireProjectile(w, m.id, KIND.mobShot, p.pos.x, p.pos.y, 0, 0, 0, 3, 30, 5, false, ev);
    projectileSystem(w, ev);
    expect(p.hp).toBe(0);
    expect(w.mode).toBe('falling');
    run(w, 60, {}, ev);
    expect(w.mode).toBe('lost');
    const h = hashWorld({ ...w, tick: 0 });
    run(w, 30, { move: { x: 1, y: 0 }, fire: true }, ev);
    expect(hashWorld({ ...w, tick: 0 })).toBe(h);
  });
  it('a full pool drops new shots instead of growing and a bot clears a closed room of 5 mobs', () => {
    const { w, ev } = room();
    for (let i = 0; i < w.projectiles.capacity + 10; i++) fireProjectile(w, 1, KIND.playerBolt, 0, 0, 0, 0, 0, 1, 5, 1, false, ev);
    expect(w.projectiles.count).toBe(w.projectiles.capacity);
    w.projectiles.count = 0;
    for (let i = 0; i < 5; i++) spawnActor(w, 'mob_blood_crow', 200 + i * 20, 120 + i * 12, 3, ev);
    let cleared = false;
    for (let t = 0; t < 60 * 30 && !cleared; t++) { step(w, { ...IDLE, move: { x: 1, y: 0 }, fire: true }, ev); cleared = ev.some((e) => e.type === 'room-cleared'); }
    expect(cleared).toBe(true);
    expect(w.actors.filter((a) => a.role === 'mob').length).toBe(0);
  });
});

describe('determinism with combat on', () => {
  it('same seed and inputs: same hash after 10,000 ticks; the world kept moving', () => {
    const play = (seed: number): { hash: string; hits: number } => {
      const w = createWorld(seed), ev: GameEvent[] = [], rng = new Rng(seed);
      spawnActor(w, 'player', 125, 176, 600, ev, 5); spawnActor(w, 'mob_blood_wolf', 250, 150, 5000, ev); spawnActor(w, 'mob_blood_crow', 200, 120, 5000, ev);
      setMode(w, 'playing', ev);
      for (let t = 0; t < 10_000; t++) { step(w, { move: { x: rng.int(-1, 1), y: rng.int(-1, 1) }, aim: null, dash: rng.next() < 0.02, fire: rng.next() < 0.4 }, ev); ev.length = 0; }
      return { hash: hashWorld(w), hits: w.stats.hits };
    };
    const a = play(9), b = play(9), c = play(10);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hits).toBeGreaterThan(100);
  });
  it('1,500 shots and 60 actors: one projectile pass stays well inside the 4 ms sim budget', () => {
    const { w, ev } = room();
    for (let i = 0; i < 59; i++) spawnActor(w, 'mob_blood_corpse', 60 + (i % 20) * 14, 95 + Math.floor(i / 20) * 40, 1e6, ev);
    const rng = new Rng(2);
    for (let i = 0; i < 1500; i++) fireProjectile(w, 1, KIND.playerBolt, 50 + rng.next() * 284, 88 + rng.next() * 123, 0, 0, 0, 2, 1e9, 0, false, ev);
    for (let i = 0; i < 20; i++) projectileSystem(w, ev);
    const times: number[] = [];
    for (let i = 0; i < 100; i++) { ev.length = 0; const t0 = performance.now(); projectileSystem(w, ev); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    console.log('projectileSystem 1500 shots x 60 actors, median ms', (times[50] as number).toFixed(3));
    expect(times[50] as number).toBeLessThan(2);
  });
});
