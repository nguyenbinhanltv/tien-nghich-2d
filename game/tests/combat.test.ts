// E1.4: the 7 original tests of playables/blood-sea/encounter.test.mjs that exercise combat.mjs (plus two more of its
// cases: facing and the dodge that crosses out of the seal), ported to the tick-based sim. Time is in ticks: 1 s = 60.
import { describe, expect, it } from 'vitest';
import { COMBAT } from '../src/contracts/combat.ts';
import type { Hazard } from '../src/contracts/combat.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../src/contracts/world.ts';
import { hashWorld } from '../src/sim/hash.ts';
import { createWorld, startGhostKingFight, step } from '../src/sim/loop.ts';
import { facingOf } from '../src/sim/math.ts';
import { addHazard, hazardIncoming } from '../src/sim/systems/telegraph.ts';

interface In { x?: number; y?: number; attack?: boolean; dodge?: boolean }
const inp = (i: In = {}): InputFrame => ({ move: { x: i.x ?? 0, y: i.y ?? 0 }, aim: null, dash: !!i.dodge, fire: !!i.attack });
const start = (): { w: WorldState; p: ActorState; b: ActorState; ev: GameEvent[] } => {
  const w = createWorld(1), ev: GameEvent[] = [];
  startGhostKingFight(w, ev);
  return { w, p: w.actors[0] as ActorState, b: w.actors[1] as ActorState, ev };
};
const advance = (w: WorldState, n: number, i: In = {}, ev: GameEvent[] = []): void => { for (let k = 0; k < n; k++) step(w, inp(i), ev); };
const seal = (w: WorldState, b: ActorState, x: number, y: number, radius: number, ev: GameEvent[]): Hazard =>
  addHazard(w, { kind: 'seal', owner: b.id, x, y, dirX: 1, dirY: 0, radius, length: 0, damage: 1, ticks: 1 }, ev);

describe('E1.4 combat model, ported from encounter.test.mjs', () => {
  it('windup precedes release and a connected spirit blade freezes the world', () => {
    const { w, p, b, ev } = start();
    p.pos.x = b.pos.x - 34; p.pos.y = b.pos.y;
    step(w, inp({ attack: true }), ev);
    expect(p.combat.action).toBeGreaterThan(COMBAT.strikeImpact);
    expect(w.projectiles.count).toBe(0);
    for (let i = 0; i < 30 && !w.stats.hits; i++) step(w, inp(), ev);
    expect(w.stats.hits).toBe(1);
    expect(b.hp).toBe(11);
    expect(w.freeze).toBeGreaterThan(0);
    const x = p.pos.x;
    step(w, inp({ x: 1 }), ev);
    expect(p.pos.x).toBe(x);
  });

  it('all three warnings match the damage geometry, including the open wail wedge', () => {
    const base = { id: 1, owner: 0, x: 100, y: 100, radius: 20, dir: { x: 1, y: 0 }, wedge: { x: 1, y: 0 }, gapCos: 0.8775825618903728, length: 90, damage: 1, timer: 1, duration: 1, dodgedThrough: false };
    const table: [Hazard['kind'], number, number, boolean][] = [
      ['claw', 170, 105, true], ['claw', 170, 122, false], ['claw', 88, 100, false],
      ['seal', 102, 115, true], ['seal', 122, 100, false], ['wail', 119, 100, false],
      ['wail', 100, 118, true], ['wail', 100, 130, false]];
    for (const [kind, x, y, expected] of table) expect(hazardIncoming({ ...base, kind }, x, y), `${kind} ${x},${y}`).toBe(expected);
  });

  it('dodge protects at impact, respects bounds and has a cooldown', () => {
    const { w, p, b, ev } = start();
    p.pos.x = 332; p.combat.motion = { x: 1, y: 0 };
    seal(w, b, p.pos.x, p.pos.y, 32, ev);
    b.ai.state = 'warn'; b.ai.timer = 1;
    advance(w, 12, { dodge: true, x: 1 }, ev);
    expect(p.hp).toBe(6);
    expect(w.stats.dodges).toBe(1);
    expect(p.pos.x).toBe(334);
    expect(p.combat.cool).toBeGreaterThan(0);
  });

  it('full encounter reaches both outcomes, terminal states freeze, fresh encounters reset', () => {
    const fight = start();
    advance(fight.w, 60 * 40, { attack: true });
    expect(fight.w.mode).toBe('won');
    expect(fight.w.stats.hits).toBe(12);
    const fallen = start();
    advance(fallen.w, 60 * 60);
    expect(fallen.w.mode).toBe('lost');
    expect(fallen.p.hp).toBe(0);
    const old = hashWorld({ ...fallen.w, tick: 0 });
    advance(fallen.w, 60, { attack: true });
    expect(hashWorld({ ...fallen.w, tick: 0 })).toBe(old);
    const fresh = createWorld(1);
    expect(fresh.stats.hits).toBe(0);
    expect(fresh.mode).toBe('ready');
    const again = start();
    expect(again.p.hp).toBe(6);
    expect(again.b.hp).toBe(12);
  });

  it('player cardinal direction selection uses all authored rows', () => {
    expect([[0, 1], [1, 0], [0, -1], [-1, 0]].map(([x, y]) => facingOf(x as number, y as number))).toEqual(['south', 'east', 'north', 'west']);
  });

  it('crossing half health schedules a wail, and a timed dodge earns a faster recovery', () => {
    const { w, p, b, ev } = start();
    b.hp = 6; b.ai.timer = 0;
    step(w, inp(), ev);
    const h = w.hazards[0] as Hazard;
    expect(h.kind).toBe('wail');
    expect(b.ai.data[1]).toBe(1);
    expect(b.ai.timer).toBeGreaterThanOrEqual(60);
    p.pos.x = b.pos.x - 12; p.pos.y = b.pos.y;
    h.wedge = { x: 1, y: 0 };
    b.ai.timer = 1;
    step(w, inp({ dodge: true }), ev);
    expect(w.stats.counters).toBe(1);
    expect(p.hp).toBe(6);
    expect(p.combat.cool).toBeLessThanOrEqual(COMBAT.counterCool);
  });

  it('only the first strike begun within the charged window deals double damage', () => {
    for (const [delay, damage] of [[0, 2], [60, 1]] as const) {
      const { w, p, b, ev } = start();
      p.combat.counterWindow = COMBAT.counterWindow;
      p.pos.x = b.pos.x - 20; p.pos.y = b.pos.y;
      b.ai.timer = 300;
      advance(w, delay, {}, ev);
      advance(w, 20, { attack: true }, ev);
      expect(b.hp).toBe(12 - damage);
      expect(w.stats.counterHits).toBe(damage === 2 ? 1 : 0);
      advance(w, 30, { attack: true }, ev);
      expect(b.hp).toBe(11 - damage);
    }
  });

  it('a dodge cancels the sword windup and faces the newly requested movement direction', () => {
    const { w, p, ev } = start();
    step(w, inp({ attack: true }), ev);
    expect(p.combat.action).toBeGreaterThan(0);
    const x = p.pos.x;
    step(w, inp({ x: -1, dodge: true }), ev);
    expect(p.combat.action).toBe(0);
    expect(p.facing).toBe('west');
    expect(p.pos.x).toBeLessThan(x);
    expect(w.projectiles.count).toBe(0);
  });

  it('a dodge that crosses out of the seal on its last beat still charges the counter', () => {
    const { w, p, b, ev } = start();
    const h = seal(w, b, p.pos.x, p.pos.y, 13, ev);
    b.ai.state = 'warn'; b.ai.timer = 12;
    step(w, inp({ x: 1, dodge: true }), ev);
    advance(w, 13, {}, ev);
    expect(hazardIncoming(h, p.pos.x, p.pos.y)).toBe(false);
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.stats.counters).toBe(1);
    expect(p.combat.counterWindow).toBeGreaterThan(0);
  });
});
