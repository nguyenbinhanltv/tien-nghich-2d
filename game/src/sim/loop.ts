import { Rng } from './rng.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { TICK_MS } from '../contracts/world.ts';

export const NO_INPUT: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };

export function createWorld(seed: number): WorldState {
  return { tick: 0, seed, rngState: new Rng(seed).state, actors: [], nextActorId: 1 };
}

export function spawn(world: WorldState, kind: string, x: number, y: number, hp: number, events: GameEvent[]): number {
  const id = world.nextActorId++;
  world.actors.push({ id, kind, pos: { x, y }, facing: 'south', hp, clip: 'idle', clipStartTick: world.tick });
  events.push({ type: 'actor-spawned', tick: world.tick, actor: id, kind });
  return id;
}

/** One fixed step: (world, input) -> mutated world. Systems are added here by the sim lane; this is the skeleton. */
export function step(world: WorldState, input: InputFrame, events: GameEvent[]): void {
  const rng = new Rng(0);
  rng.state = world.rngState;
  const player = world.actors[0];
  if (player) {
    player.pos.x += input.move.x;
    player.pos.y += input.move.y;
  }
  // Placeholder drift so determinism tests exercise the RNG; replaced by AI systems.
  for (const a of world.actors) if (a !== player) { a.pos.x += rng.next() - 0.5; a.pos.y += rng.next() - 0.5; }
  world.rngState = rng.state;
  world.tick++;
  void events;
}

/** Fixed-step accumulator for the renderer: feed it elapsed ms, it runs whole ticks. Bounded to avoid a spiral of death. */
export class FixedLoop {
  private acc = 0;
  private readonly maxTicksPerFrame: number;
  constructor(maxTicksPerFrame = 5) { this.maxTicksPerFrame = maxTicksPerFrame; }
  advance(elapsedMs: number, run: () => void): number {
    this.acc += Math.min(elapsedMs, TICK_MS * this.maxTicksPerFrame);
    let n = 0;
    while (this.acc >= TICK_MS - 1e-6) { run(); this.acc -= TICK_MS; n++; }
    return n;
  }
}
