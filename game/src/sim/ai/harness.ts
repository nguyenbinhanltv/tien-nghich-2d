// Test/bot harness for the AI lane: a tiny stand-in for lane A's movement + hazard systems so behaviours can be
// exercised before the real combat systems land. Not used by the game.
import type { ContentApi, MobRow } from '../../contracts/content.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { createWorld, spawn } from '../loop.ts';
import { hashWorld } from '../hash.ts';
import { aiSystem, initMobAi } from './index.ts';

export function contentOf(mobs: MobRow[]): ContentApi {
  return {
    version: 'test', has: (t, id) => t === 'mobs' && mobs.some((m) => m.id === id),
    get: <T>(t: string, id: string): T => { const m = mobs.find((x) => t === 'mobs' && x.id === id); if (!m) throw new Error(`${t}/${id}`); return m as T; },
    ids: (t) => (t === 'mobs' ? mobs.map((m) => m.id) : []),
  };
}

export interface Fight { world: WorldState; content: ContentApi; events: GameEvent[]; player: number; mobs: number[]; playerHits: number; hash(): string; tick(playerVel?: { x: number; y: number }): void }

/** Player at (px,py), one mob per [kind, x, y]. Hazards resolve like lane A's will: timer to 0, then hit if the player is inside. */
export function makeFight(seed: number, content: ContentApi, px: number, py: number, mobs: [string, number, number][]): Fight {
  const world = createWorld(seed), events: GameEvent[] = [];
  const player = spawn(world, 'player', px, py, 6, events);
  const ids = mobs.map(([k, x, y]) => { const m = content.get<MobRow>('mobs', k); const id = spawn(world, k, x, y, m.hp, events); initMobAi(world, content, id, events); return id; });
  const f: Fight = {
    world, content, events, player, mobs: ids, playerHits: 0, hash: () => hashWorld(world),
    tick(pv = { x: 0, y: 0 }) {
      const p = world.actors[0]!;
      p.pos.x += pv.x; p.pos.y += pv.y;
      aiSystem(world, content, events);
      for (const a of world.actors) if (a.role !== 'player') { a.pos.x += a.vel.x; a.pos.y += a.vel.y; }
      for (const h of world.hazards) {
        if (--h.timer > 0) continue;
        const dx = p.pos.x - h.x, dy = p.pos.y - h.y;
        let hit: boolean;
        if (h.kind === 'claw') { const along = dx * h.dir.x + dy * h.dir.y, across = Math.abs(-dx * h.dir.y + dy * h.dir.x); hit = along >= 0 && along <= h.length && across <= h.radius + 6; }
        else hit = Math.hypot(dx, dy) <= h.radius + 6;
        if (hit) f.playerHits++;
      }
      world.hazards = world.hazards.filter((h) => h.timer > 0);
      world.tick++;
    },
  };
  return f;
}
