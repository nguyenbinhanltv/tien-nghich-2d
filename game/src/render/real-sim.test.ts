import { describe, expect, it } from 'vitest';
import { artOf, shotFrame } from './clip-map.ts';
import { FightRunner } from './fight-runner.ts';
import { hazardProgress, hazardShape } from './hazard-geometry.ts';
import { NO_INPUT } from '../sim/loop.ts';
import type { Hazard } from '../contracts/combat.ts';
import type { GameEvent } from '../contracts/world.ts';

describe('FightRunner drives the real sim', () => {
  it('starts the Ghost King fight in playing mode with a player and a boss', () => {
    const f = new FightRunner();
    expect(f.world.mode).toBe('playing');
    expect(f.world.actors.map((a) => a.role)).toEqual(['player', 'boss']);
    expect(f.drain().filter((e) => e.type === 'actor-spawned')).toHaveLength(2);
  });
  it('is deterministic: same seed and inputs give the same hash', () => {
    const run = (): string => { const f = new FightRunner(7); for (let i = 0; i < 600; i++) f.tick(i % 90 === 0 ? { ...NO_INPUT, dash: true, move: { x: 1, y: 0 } } : NO_INPUT); return f.hash(); };
    expect(run()).toBe(run());
  });
  it('a dash and a strike come out of the sim as events (not from a stub)', () => {
    const f = new FightRunner();
    f.drain();
    f.tick({ ...NO_INPUT, dash: true, move: { x: 1, y: 0 } });
    for (let i = 0; i < 60; i++) f.tick(NO_INPUT);
    f.tick({ ...NO_INPUT, fire: true });
    const types = new Set(f.drain().map((e: GameEvent) => e.type));
    expect(types.has('dash')).toBe(true);
    expect(types.has('strike')).toBe(true);
  });
  it('the boss telegraphs within a few seconds and the hazard has a shape and a progress', () => {
    const f = new FightRunner();
    let seen: Hazard | undefined;
    for (let i = 0; i < 600 && !seen; i++) { f.tick(NO_INPUT); seen = f.world.hazards[0]; }
    expect(seen).toBeDefined();
    expect(hazardProgress(seen!)).toBeGreaterThanOrEqual(0);
    expect(['bar', 'disc', 'wedge-disc']).toContain(hazardShape(seen!).type);
  });
});

describe('artOf maps sim names to atlas names', () => {
  const player = (over: object) => ({ role: 'player', kind: 'player', clip: 'idle', clipStartTick: 5, diedTick: -1, hp: 6, ai: { state: 'idle' }, combat: { down: 0, dash: 0, slash: 0, moving: false }, ...over }) as never;
  const w = { mode: 'playing' } as never;
  it('the player kind is the form art; dash, strike, run, idle, death', () => {
    expect(artOf(w, player({}))).toMatchObject({ kind: 'wl_outer_disciple', clip: 'idle' });
    expect(artOf(w, player({ combat: { down: 0, dash: 0, slash: 0, moving: true } })).clip).toBe('run');
    expect(artOf(w, player({ clip: 'dash', combat: { down: 0, dash: 3, slash: 0, moving: true } })).clip).toBe('dash');
    expect(artOf(w, player({ clip: 'attack', combat: { down: 0, dash: 0, slash: 9, moving: false } }))).toMatchObject({ clip: 'cast_attack', startTick: 5 });
    expect(artOf({ mode: 'falling' } as never, player({})).clip).toBe('death');
  });
  it('boss: seal is the soul-devour clip, stalk is move, release is death', () => {
    const boss = (state: string, clip = 'idle') => ({ role: 'boss', kind: 'boss_ghost_king', clip, clipStartTick: 9, diedTick: -1, hp: 5, ai: { state }, combat: {} }) as never;
    expect(artOf(w, boss('warn', 'attack_seal')).clip).toBe('soul_devour');
    expect(artOf(w, boss('warn', 'attack_wail')).clip).toBe('attack_wail');
    expect(artOf(w, boss('stalk')).clip).toBe('move');
    expect(artOf(w, boss('release')).clip).toBe('death');
  });
});

describe('shotFrame: an enemy shot wears the art of the mob that fired it', () => {
  it('maps the four Blood Sea mobs, loops the 4 flight frames at 12 fps, and falls back for any other owner', () => {
    expect(shotFrame('mob_blood_crow', 0, 'x')).toBe('projectiles/pj_mob_crow_feather/flight_none_0');
    expect(shotFrame('mob_blood_corpse', 5, 'x')).toBe('projectiles/pj_mob_corpse_gore/flight_none_1');
    expect(shotFrame('mob_blood_pool_lurker', 30, 'x')).toBe('projectiles/pj_mob_lurker_bubble/flight_none_2');
    expect(shotFrame('mob_vengeful_soul', 20, 'x')).toBe('projectiles/pj_mob_soul_wisp/flight_none_0');
    expect(shotFrame('boss_ghost_king', 0, 'fallback')).toBe('fallback');
    expect(shotFrame(undefined, 0, 'fallback')).toBe('fallback');
  });
});

describe('hazardShape', () => {
  const base = { id: 1, owner: 2, x: 100, y: 100, dir: { x: 1, y: 0 }, wedge: { x: 0, y: 1 }, gapCos: 0.5, radius: 10, length: 50, damage: 1, timer: 20, duration: 40, dodgedThrough: false };
  it('claw is a bar of length x 2*radius along dir', () => {
    const s = hazardShape({ ...base, kind: 'claw' });
    expect(s.type).toBe('bar');
    if (s.type === 'bar') { expect(s.points[0]).toEqual([100, 110]); expect(s.points[1]).toEqual([150, 110]); expect(s.points[2]).toEqual([150, 90]); }
  });
  it('wail keeps the safe wedge: half angle is acos(gapCos) around the wedge direction', () => {
    const s = hazardShape({ ...base, kind: 'wail' });
    expect(s.type).toBe('wedge-disc');
    if (s.type === 'wedge-disc') { expect(s.half).toBeCloseTo(Math.PI / 3); expect(s.centre).toBeCloseTo(Math.PI / 2); }
  });
  it('seal is a disc with a rim; progress runs 0..1', () => {
    expect(hazardShape({ ...base, kind: 'seal' })).toMatchObject({ type: 'disc', rim: true });
    expect(hazardProgress({ timer: 40, duration: 40 })).toBe(0);
    expect(hazardProgress({ timer: 0, duration: 40 })).toBe(1);
  });
});
