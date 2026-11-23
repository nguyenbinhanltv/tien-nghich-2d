// Integrate the velocity the mob AI chose, inside the room. Tile and prop collision is added by the room system.
import type { WorldState } from '../../contracts/world.ts';
import { clamp } from '../math.ts';

export function mobMovement(world: WorldState): void {
  const r = world.room;
  for (const a of world.actors) {
    if (a.role !== 'mob' || a.hp <= 0) continue;
    a.pos.x = clamp(a.pos.x + a.vel.x, r.minX, r.maxX);
    a.pos.y = clamp(a.pos.y + a.vel.y, r.minY, r.maxY);
  }
}
