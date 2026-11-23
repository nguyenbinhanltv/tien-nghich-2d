// Integrate the velocity the mob AI chose, inside the room and (when the room has a grid) around walls and props.
// Wall-phasing mobs (PHASES_WALLS) ignore the grid but stay inside the room bounds.
import type { WorldState } from '../../contracts/world.ts';
import { clamp } from '../math.ts';
import { PHASES_WALLS } from '../ai/index.ts';
import { resolveMove } from './grid.ts';

export function mobMovement(world: WorldState): void {
  const r = world.room;
  for (const a of world.actors) {
    if (a.role !== 'mob' || a.hp <= 0) continue;
    const x0 = a.pos.x, y0 = a.pos.y;
    a.pos.x = clamp(x0 + a.vel.x, r.minX, r.maxX);
    a.pos.y = clamp(y0 + a.vel.y, r.minY, r.maxY);
    if (!PHASES_WALLS.has(a.kind)) resolveMove(world, a, x0, y0);
  }
}
