// Small helpers for behaviours. Vector maths comes from ../math.ts (sqrt only: bit-identical on every engine; no hypot/trig).
import type { ActorState, Vec2, WorldState } from '../../contracts/world.ts';
import { facingOf } from '../math.ts';

/** Switch state and clip together; `ticks` is the length of the new state (0 = open ended). */
export function enter(a: ActorState, world: WorldState, state: string, ticks: number, clip?: string): void {
  a.ai.state = state; a.ai.timer = ticks;
  if (clip !== undefined && a.clip !== clip) { a.clip = clip; a.clipStartTick = world.tick; }
}

/** Set velocity; facing follows it unless the actor stops (it keeps looking where it last moved). */
export function setVel(a: ActorState, x: number, y: number): void {
  a.vel.x = x; a.vel.y = y;
  if (x !== 0 || y !== 0) a.facing = facingOf(x, y);
}

/** Remove the hazards an actor owns (interrupt or death). Hazards are created with `addHazard` from systems/telegraph.ts. */
export function dropHazards(world: WorldState, owner: number): void {
  world.hazards = world.hazards.filter((h) => h.owner !== owner);
}

export type { Vec2 };
