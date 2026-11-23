import type { Hazard, HazardKind } from '../../contracts/combat.ts';
import type { ActorState, Facing, Vec2, WorldState, GameEvent } from '../../contracts/world.ts';

export function dist(a: Vec2, b: Vec2): number { return Math.hypot(b.x - a.x, b.y - a.y); }

/** Unit vector from a to b; a fixed fallback when they coincide so the result is always finite. */
export function dirTo(a: Vec2, b: Vec2, fallback: Vec2 = { x: 0, y: 1 }): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  return d < 1e-6 ? { x: fallback.x, y: fallback.y } : { x: dx / d, y: dy / d };
}

export function facingOf(d: Vec2, prev: Facing): Facing {
  if (Math.abs(d.x) < 1e-6 && Math.abs(d.y) < 1e-6) return prev;
  return Math.abs(d.x) > Math.abs(d.y) ? (d.x > 0 ? 'east' : 'west') : (d.y > 0 ? 'south' : 'north');
}

/** Switch state and clip together; `ticks` is the length of the new state (0 = open ended). */
export function enter(a: ActorState, world: WorldState, state: string, ticks: number, clip?: string): void {
  a.ai.state = state; a.ai.timer = ticks;
  if (clip !== undefined && a.clip !== clip) { a.clip = clip; a.clipStartTick = world.tick; }
}

export function setVel(a: ActorState, x: number, y: number): void { a.vel.x = x; a.vel.y = y; a.facing = facingOf({ x, y }, a.facing); }

export interface HazardSpec { kind: HazardKind; x: number; y: number; dir: Vec2; radius: number; length: number; damage: number; ticks: number; wedge?: Vec2; gapCos?: number }

/** Telegraphed area owned by `a`; lane A's telegraph system counts it down and resolves it. Emits the telegraph event. */
export function addHazard(world: WorldState, events: GameEvent[], a: ActorState, s: HazardSpec): Hazard {
  const h: Hazard = {
    id: world.nextHazardId++, kind: s.kind, owner: a.id, x: s.x, y: s.y, dir: { x: s.dir.x, y: s.dir.y },
    wedge: s.wedge ? { x: s.wedge.x, y: s.wedge.y } : { x: 0, y: 0 }, gapCos: s.gapCos ?? 1,
    radius: s.radius, length: s.length, damage: s.damage, timer: s.ticks, duration: s.ticks, dodgedThrough: false,
  };
  world.hazards.push(h);
  events.push({ type: 'telegraph', tick: world.tick, hazard: h.id, kind: s.kind, ticks: s.ticks });
  return h;
}

/** Remove the hazards an actor owns (interrupt or death). */
export function dropHazards(world: WorldState, owner: number): void {
  world.hazards = world.hazards.filter((h) => h.owner !== owner);
}
