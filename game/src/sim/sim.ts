import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import type { Sim, SimOptions } from '../contracts/host.ts';
import { hashWorld } from './hash.ts';
import { createWorld, step } from './loop.ts';

/** The Sim facade of contracts/host.ts. Systems are added to `step` by the combat PRs; the event array is reused. */
export function createSim(options: SimOptions): Sim & { readonly world: WorldState } {
  const world = createWorld(options.seed);
  const events: GameEvent[] = [];
  return {
    world,
    step(input: InputFrame): readonly GameEvent[] { events.length = 0; step(world, input, events); return events; },
    hash: () => hashWorld(world),
  };
}
