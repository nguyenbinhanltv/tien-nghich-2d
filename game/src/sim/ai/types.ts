// Mob AI framework (plan E4.1, lane B). Behaviours are pure functions of (actor, world, rng): they write the actor's
// `vel`, `facing`, `clip` and `ai` slot, and create Hazards for telegraphed hits. They never move `pos` (lane A's
// movement system integrates `vel` and resolves walls) and never deal damage (lane A resolves hazards and contact).
// Randomness comes only from the sim Rng; time is ticks.
import type { MobRow, ContentApi } from '../../contracts/content.ts';
import type { ActorState, GameEvent, WorldState } from '../../contracts/world.ts';
import type { Rng } from '../rng.ts';

export interface AiContext {
  world: WorldState;
  rng: Rng;
  events: GameEvent[];
  /** The player actor, or null when none is alive (mobs idle). */
  player: ActorState | null;
  row: MobRow;
}

/** One behaviour = one `ai` kind of the mobs table. `init` runs once at spawn; `update` once per tick while alive. */
export interface MobBehavior {
  readonly ai: MobRow['ai'];
  init(actor: ActorState, ctx: AiContext): void;
  update(actor: ActorState, ctx: AiContext): void;
}

export type { MobRow, ContentApi };
