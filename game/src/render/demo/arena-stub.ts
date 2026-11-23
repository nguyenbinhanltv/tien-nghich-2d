// STUB until lane A's room sim lands (E1.3/E3.2): wraps sim/step with an arena clamp, facing, clip choice and a
// visual-only dodge/counter so the phone build is playable. It does no damage, no AI, no collision beyond the
// arena rectangle. Delete this file when the real sim exposes the same data through contracts/world.ts.
import type { ActorState, Facing, GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { createWorld, spawn, step } from '../../sim/loop.ts';

export const ARENA = { x0: 14, y0: 56, x1: 370, y1: 206 };
const DASH_TICKS = 14;
const DASH_SPEED = 2.6;
const COUNTER_TICKS = 20;

export const MOB_KINDS = ['mob_blood_corpse', 'mob_blood_wolf', 'mob_blood_crow', 'mob_blood_pool_lurker', 'mob_blood_corpse'] as const;

export class ArenaStub {
  readonly world: WorldState = createWorld(20261123);
  readonly events: GameEvent[] = [];
  readonly playerId: number;
  private dashLeft = 0;
  private dashDir = { x: 0, y: 1 };
  private counterLeft = 0;

  constructor() {
    this.playerId = spawn(this.world, 'wl_outer_disciple', 192, 150, 100, this.events);
    MOB_KINDS.forEach((k, i) => spawn(this.world, k, 70 + i * 62, 100 + (i % 2) * 40, 40, this.events));
  }

  get player(): ActorState { return this.world.actors[0]!; }

  private setClip(a: ActorState, clip: string): void {
    if (a.clip !== clip) { a.clip = clip; a.clipStartTick = this.world.tick; }
  }

  tick(input: InputFrame): void {
    const p = this.player;
    if (input.dash && this.dashLeft === 0) {
      const m = Math.hypot(input.move.x, input.move.y);
      this.dashDir = m > 0.1 ? { x: input.move.x / m, y: input.move.y / m } : faceVec(p.facing);
      this.dashLeft = DASH_TICKS;
    }
    if (input.fire && this.counterLeft === 0 && this.dashLeft === 0) this.counterLeft = COUNTER_TICKS;
    const moving = Math.hypot(input.move.x, input.move.y) > 0.1;
    // the counter plants the feet
    step(this.world, this.counterLeft > 0 ? { ...input, move: { x: 0, y: 0 } } : input, this.events);
    if (this.dashLeft > 0) {
      p.pos.x += this.dashDir.x * DASH_SPEED;
      p.pos.y += this.dashDir.y * DASH_SPEED;
      this.dashLeft--;
    }
    if (moving && this.dashLeft === 0 && this.counterLeft === 0) p.facing = facingOf(input.move.x, input.move.y);
    if (this.counterLeft > 0) this.counterLeft--;
    this.setClip(p, this.dashLeft > 0 ? 'dash' : this.counterLeft > 0 ? 'cast_attack' : moving ? 'run' : 'idle');
    for (const a of this.world.actors) {
      a.pos.x = Math.min(ARENA.x1, Math.max(ARENA.x0, a.pos.x));
      a.pos.y = Math.min(ARENA.y1, Math.max(ARENA.y0, a.pos.y));
      if (a !== p) { a.facing = a.pos.x < p.pos.x ? 'east' : 'west'; this.setClip(a, 'move'); }
    }
    this.events.length = 0;
  }
}

export function facingOf(x: number, y: number): Facing {
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'east' : 'west') : y > 0 ? 'south' : 'north';
}
function faceVec(f: Facing): { x: number; y: number } {
  return f === 'east' ? { x: 1, y: 0 } : f === 'west' ? { x: -1, y: 0 } : f === 'north' ? { x: 0, y: -1 } : { x: 0, y: 1 };
}
