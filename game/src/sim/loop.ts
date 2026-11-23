import { Rng } from './rng.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { TICK_MS } from '../contracts/world.ts';
import { MAX_PROJECTILES } from '../contracts/pool.ts';
import { createProjectilePool } from './pool.ts';
import { findPlayer, spawnActor } from './actors.ts';
import { playerControl, tickTimers } from './systems/movement.ts';
import { projectileSystem } from './systems/projectile.ts';
import { setMode, sweepDead } from './systems/combat.ts';
import { BOSS_SCRIPT, ghostKingStep } from './systems/ghost-king.ts';
import { settleRun } from './run/run.ts';
import type { BossRow } from '../contracts/content.ts';
import { aiSystem } from './ai/index.ts';
import { bossStep, type Encounter } from './ai/boss.ts';
import type { SimContext } from './context.ts';
import { mobMovement } from './systems/mob-move.ts';
import { resolveMove } from './systems/grid.ts';
import { floorSystem } from './run/floor.ts';
import { footsteps } from './systems/footsteps.ts';

export const NO_INPUT: InputFrame = { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false };

export function createWorld(seed: number): WorldState {
  return {
    tick: 0, seed, rngState: new Rng(seed).state, actors: [], nextActorId: 1,
    projectiles: createProjectilePool(MAX_PROJECTILES), hazards: [], nextHazardId: 1,
    room: { minX: 50, minY: 88, maxX: 334, maxY: 211 }, mode: 'ready', freeze: 0, elapsed: 0,
    stats: { hits: 0, dodges: 0, counters: 0, counterHits: 0, hitsTaken: 0 }, run: null,
  };
}

/** Spawn an actor and return its id (kept for callers of the skeleton API). */
export function spawn(world: WorldState, kind: string, x: number, y: number, hp: number, events: GameEvent[]): number {
  return spawnActor(world, kind, x, y, hp, events).id;
}

/**
 * One fixed step: (world, input) -> mutated world. Order matches the original: timers and player control, shots and their hits,
 * then the enemy scripts; the mode machine ('falling' and 'releasing' play out, 'ready'/'won'/'lost' freeze the world).
 * With a `ctx` the enemies run from content: mob AI (sim/ai) and the data-driven boss encounter. Without one, the legacy
 * reference fight (systems/ghost-king.ts) runs and there are no mobs.
 */
export function step(world: WorldState, input: InputFrame, events: GameEvent[], ctx?: SimContext): void {
  world.tick++;
  settleRun(world, events);
  const player = findPlayer(world);
  if (world.mode === 'falling') {
    if (player) { player.combat.down = Math.max(0, player.combat.down - 1); if (!player.combat.down) setMode(world, 'lost', events); }
    return;
  }
  if (world.mode === 'releasing') {
    for (const a of world.actors) if (a.role === 'boss' && a.ai.state === 'release') { a.ai.timer = Math.max(0, a.ai.timer - 1); if (!a.ai.timer) setMode(world, 'won', events); }
    return;
  }
  if (world.mode !== 'playing') return;
  world.elapsed++;
  if (world.freeze > 0) { world.freeze--; return; }
  if (player) {
    tickTimers(player);
    const x0 = player.pos.x, y0 = player.pos.y;
    playerControl(world, player, input, events);
    if (world.grid) resolveMove(world, player, x0, y0);
  }
  projectileSystem(world, events);
  if (world.mode !== 'playing') return;
  for (const a of world.actors) if (a.role === 'boss' && a.combat.hurt > 0) a.combat.hurt--; // the boss's hurt pose runs down (its script is not interrupted by it)
  if (ctx) {
    aiSystem(world, ctx.content, events);
    mobMovement(world);
    for (const a of world.actors) {
      if (a.role !== 'boss' || !ctx.content.has('bosses', a.kind)) continue;
      const row = ctx.content.get<BossRow>('bosses', a.kind);
      bossStep(world, a, ctx.content.get<Encounter>('encounters', row.encounter), row.speed, events, ctx.content);
    }
  } else for (const a of world.actors) if (a.role === 'boss' && a.kind === BOSS_SCRIPT) ghostKingStep(world, a, events);
  sweepDead(world, events);
  if (ctx) { floorSystem(world, ctx.content, events); footsteps(world, ctx.content, events); }
}

/** Start the original Drowned Court arena: the player at (125,176) with 6 hp, the Ghost King at (253,139) with 12 hp, 1.4 s before the first attack. */
export function startGhostKingFight(world: WorldState, events: GameEvent[]): void {
  world.actors.length = 0; world.hazards.length = 0; world.projectiles.count = 0;
  const p = spawnActor(world, 'player', 125, 176, 6, events, 5);
  p.facing = 'east';
  const b = spawnActor(world, BOSS_SCRIPT, 253, 139, 12, events, 19);
  b.facing = 'west'; b.ai.state = 'stalk'; b.ai.timer = 84;
  setMode(world, 'playing', events);
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
