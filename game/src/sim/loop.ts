import { Rng } from './rng.ts';
import type { ActorRole, ActorState, GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { TICK_MS } from '../contracts/world.ts';
import { MAX_PROJECTILES } from '../contracts/pool.ts';
import { createProjectilePool } from './pool.ts';

export const NO_INPUT: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };

export function createWorld(seed: number): WorldState {
  return {
    tick: 0, seed, rngState: new Rng(seed).state, actors: [], nextActorId: 1,
    projectiles: createProjectilePool(MAX_PROJECTILES), hazards: [], nextHazardId: 1,
    room: { minX: 50, minY: 88, maxX: 334, maxY: 211 }, mode: 'playing', freeze: 0, elapsed: 0,
    stats: { hits: 0, dodges: 0, counters: 0, counterHits: 0, hitsTaken: 0 }, run: null,
  };
}

export function spawn(world: WorldState, kind: string, x: number, y: number, hp: number, events: GameEvent[]): number {
  const id = world.nextActorId++;
  const role: ActorRole = kind === 'player' ? 'player' : kind.startsWith('boss_') ? 'boss' : 'mob';
  const actor: ActorState = {
    id, role, kind, pos: { x, y }, vel: { x: 0, y: 0 }, facing: 'south', hp, hpMax: hp, radius: 6, clip: 'idle', clipStartTick: world.tick,
    invuln: 0, diedTick: -1,
    combat: { cool: 0, action: 0, dash: 0, guard: 0, guardSource: 'none', hurt: 0, counterWindow: 0, counterCast: false, slash: 0, down: 0, motion: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, moving: false },
    ai: { state: 'idle', timer: 0, target: 0, data: [0, 0, 0, 0] },
  };
  world.actors.push(actor);
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
