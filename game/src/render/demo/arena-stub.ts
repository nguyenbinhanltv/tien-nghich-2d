// STUB until lane A's room sim lands (E1.3/E3.2): wraps sim/step with an arena clamp, facing, clip choice and a
// visual-only dodge/counter so the phone build is playable. It does no damage, no AI, no collision beyond the
// arena rectangle. Delete this file when the real sim exposes the same data through contracts/world.ts.
import type { ActorState, Facing, GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import type { Sim } from '../../contracts/host.ts';
import { spawn } from '../../sim/loop.ts';
import { createSim } from '../../sim/sim.ts';

const DASH_TICKS = 14;
const DASH_SPEED = 2.6;
const COUNTER_TICKS = 20;

export const MOB_KINDS = ['mob_blood_corpse', 'mob_blood_wolf', 'mob_blood_crow', 'mob_blood_pool_lurker', 'mob_blood_corpse'] as const;

export class ArenaStub {
  /** The real Sim facade (contracts/host.ts). Its step is still a skeleton until lane A's combat lands. */
  private readonly sim: Sim = createSim({ seed: 20261123 });
  readonly world: WorldState = this.sim.world;
  readonly events: GameEvent[] = [];
  readonly playerId: number;
  private dashLeft = 0;
  private dashDir = { x: 0, y: 1 };
  private counterLeft = 0;

  constructor() {
    this.world.mode = 'playing'; // the real sim starts in 'ready' (frozen); the demo wants walking, not the dash/strike it fakes below
    this.playerId = spawn(this.world, 'wl_outer_disciple', 192, 150, 100, this.events);
    this.player.role = 'player'; // kind names the art (form); the contract derives role from kind 'player'
    MOB_KINDS.forEach((k, i) => spawn(this.world, k, 80 + i * 50, 110 + (i % 2) * 40, 40, this.events));
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
    this.sim.step({ ...input, move: this.counterLeft > 0 ? { x: 0, y: 0 } : input.move, dash: false, fire: false });
    if (this.dashLeft > 0) {
      p.pos.x += this.dashDir.x * DASH_SPEED;
      p.pos.y += this.dashDir.y * DASH_SPEED;
      this.dashLeft--;
    }
    if (moving && this.dashLeft === 0 && this.counterLeft === 0) p.facing = facingOf(input.move.x, input.move.y);
    if (this.counterLeft > 0) this.counterLeft--;
    this.setClip(p, this.dashLeft > 0 ? 'dash' : this.counterLeft > 0 ? 'cast_attack' : moving ? 'run' : 'idle');
    const r = this.world.room;
    for (const a of this.world.actors) {
      a.pos.x = Math.min(r.maxX, Math.max(r.minX, a.pos.x));
      a.pos.y = Math.min(r.maxY, Math.max(r.minY, a.pos.y));
      if (a !== p) { a.facing = a.pos.x < p.pos.x ? 'east' : 'west'; this.setClip(a, 'move'); }
    }
  }
}

export function facingOf(x: number, y: number): Facing {
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'east' : 'west') : y > 0 ? 'south' : 'north';
}
function faceVec(f: Facing): { x: number; y: number } {
  return f === 'east' ? { x: 1, y: 0 } : f === 'west' ? { x: -1, y: 0 } : f === 'north' ? { x: 0, y: -1 } : { x: 0, y: 1 };
}
