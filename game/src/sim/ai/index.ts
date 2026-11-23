// Mob AI system: one call per tick from the sim step. Registry maps the mobs-table `ai` kind to a behaviour.
import type { ContentApi, MobRow } from '../../contracts/content.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { findPlayer, spawnActor } from '../actors.ts';
import { Rng } from '../rng.ts';
import { ambusher } from './ambusher.ts';
import { brawler } from './brawler.ts';
import { charger } from './charger.ts';
import { shooter } from './shooter.ts';
import { swooper } from './swooper.ts';
import { dropHazards } from './util.ts';
import type { AiContext, MobBehavior } from './types.ts';

export const BEHAVIORS: Partial<Record<MobRow['ai'], MobBehavior>> = { charger, swooper, brawler, ambusher, shooter };

/** Mob kinds that float through walls: lane A's movement must skip tile collision for them. */
export const PHASES_WALLS: ReadonlySet<string> = new Set(['mob_vengeful_soul']);

const behaviorOf = (row: MobRow): MobBehavior => {
  const b = BEHAVIORS[row.ai];
  if (!b) throw new Error(`no AI behaviour for kind '${row.ai}' (mob ${row.id})`);
  return b;
};

/** Call right after `spawn()` of a mob: puts the AI slot in its first state. */
export function initMobAi(world: WorldState, content: ContentApi, actorId: number, events: GameEvent[]): void {
  const a = world.actors.find((x) => x.id === actorId);
  if (!a || a.role !== 'mob') return;
  const row = content.get<MobRow>('mobs', a.kind);
  const rng = new Rng(0); rng.state = world.rngState;
  const player = world.actors.find((x) => x.role === 'player') ?? null;
  behaviorOf(row).init(a, { world, rng, events, player, row });
  world.rngState = rng.state;
}

/** Spawn a mob of the table at (x, y) with the table's hp and start its AI. Returns the actor id. */
export function spawnMob(world: WorldState, content: ContentApi, kind: string, x: number, y: number, events: GameEvent[]): number {
  const row = content.get<MobRow>('mobs', kind);
  const id = spawnActor(world, kind, x, y, row.hp, events).id;
  initMobAi(world, content, id, events);
  return id;
}

/** Update every living mob in actor order (stable, so the RNG draw order is reproducible). */
export function aiSystem(world: WorldState, content: ContentApi, events: GameEvent[]): void {
  const rng = new Rng(0); rng.state = world.rngState;
  const found = findPlayer(world), player = found && found.diedTick < 0 ? found : null;
  for (const a of world.actors) {
    if (a.role !== 'mob') continue;
    if (a.diedTick >= 0 || a.hp <= 0) { if (world.hazards.length > 0) dropHazards(world, a.id); continue; } // a dead mob leaves no telegraph
    const row = content.get<MobRow>('mobs', a.kind);
    const ctx: AiContext = { world, rng, events, player, row };
    behaviorOf(row).update(a, ctx);
  }
  world.rngState = rng.state;
}
