// Test/bot harness for the AI lane. Until lane A wires `aiSystem` into `step()`, this drives the REAL player control,
// timers and hazard resolution (systems/movement.ts, systems/telegraph.ts, systems/combat.ts) around the AI, in the
// same order as `step()`, so tests exercise the game's hit geometry, guard window and hit-stop. Not used by the game.
import type { ContentApi, MobRow } from '../../contracts/content.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { spawnActor } from '../actors.ts';
import { createWorld, NO_INPUT } from '../loop.ts';
import { hashWorld } from '../hash.ts';
import { playerControl, tickTimers } from '../systems/movement.ts';
import { sweepDead } from '../systems/combat.ts';
import { projectileSystem } from '../systems/projectile.ts';
import { aiSystem, initMobAi } from './index.ts';

export function contentOf(mobs: MobRow[]): ContentApi {
  return {
    version: 'test', has: (t, id) => t === 'mobs' && mobs.some((m) => m.id === id),
    get: <T>(t: string, id: string): T => { const m = mobs.find((x) => t === 'mobs' && x.id === id); if (!m) throw new Error(`${t}/${id}`); return m as T; },
    ids: (t) => (t === 'mobs' ? mobs.map((m) => m.id) : []),
  };
}

export interface Fight { world: WorldState; content: ContentApi; events: GameEvent[]; player: number; mobs: number[]; hash(): string; tick(input?: Partial<InputFrame>): void }

/** Player at (px,py) with 6 hp, one mob per [kind, x, y]. */
export function makeFight(seed: number, content: ContentApi, px: number, py: number, mobs: [string, number, number][]): Fight {
  const world = createWorld(seed), events: GameEvent[] = [];
  world.mode = 'playing';
  const player = spawnActor(world, 'player', px, py, 6, events).id;
  const ids = mobs.map(([k, x, y]) => { const m = content.get<MobRow>('mobs', k); const a = spawnActor(world, k, x, y, m.hp, events); initMobAi(world, content, a.id, events); return a.id; });
  return {
    world, content, events, player, mobs: ids, hash: () => hashWorld(world),
    tick(input = {}) {
      world.tick++; world.elapsed++;
      if (world.mode !== 'playing') return;
      if (world.freeze > 0) { world.freeze--; return; }
      const p = world.actors[0]!;
      tickTimers(p); playerControl(world, p, { ...NO_INPUT, ...input }, events);
      projectileSystem(world, events);
      aiSystem(world, content, events);
      for (const a of world.actors) if (a.role === 'mob' && a.hp > 0) { a.pos.x += a.vel.x; a.pos.y += a.vel.y; }
      sweepDead(world, events);
    },
  };
}
