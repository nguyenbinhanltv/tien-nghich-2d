// Mob AI system: one call per tick from the sim step. Registry maps the mobs-table `ai` kind to a behaviour.
import type { ContentApi, MobRow } from '../../contracts/content.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { Rng } from '../rng.ts';
import { charger } from './charger.ts';
import type { AiContext, MobBehavior } from './types.ts';

export const BEHAVIORS: Partial<Record<MobRow['ai'], MobBehavior>> = { charger };

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

/** Update every living mob in actor order (stable, so the RNG draw order is reproducible). */
export function aiSystem(world: WorldState, content: ContentApi, events: GameEvent[]): void {
  const rng = new Rng(0); rng.state = world.rngState;
  const player = world.actors.find((x) => x.role === 'player' && x.diedTick < 0) ?? null;
  for (const a of world.actors) {
    if (a.role !== 'mob' || a.diedTick >= 0 || a.hp <= 0) continue;
    const row = content.get<MobRow>('mobs', a.kind);
    const ctx: AiContext = { world, rng, events, player, row };
    behaviorOf(row).update(a, ctx);
  }
  world.rngState = rng.state;
}
