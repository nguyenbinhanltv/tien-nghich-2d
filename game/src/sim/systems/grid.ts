// Tile collision against a RoomGrid. Pure number maths: circles against solid tiles, one axis at a time so an actor slides
// along a wall instead of sticking to it.
import type { RoomGrid } from '../../contracts/combat.ts';
import type { ActorState, WorldState } from '../../contracts/world.ts';

/** Does the tile character stop movement and shots. */
export const isSolidChar = (c: string | undefined): boolean => c === '#' || c === 'P' || c === 'D' || c === undefined;

export function solidAt(g: RoomGrid, col: number, row: number): boolean {
  if (row < 0 || col < 0) return true;
  return isSolidChar(g.rows[row]?.[col]);
}

/** Is the point inside a solid tile (a shot's centre). */
export function pointSolid(g: RoomGrid, x: number, y: number): boolean {
  return solidAt(g, Math.floor(x / g.tile), Math.floor(y / g.tile));
}

/** Does a circle at (x, y) with radius r overlap any solid tile. */
export function circleHitsSolid(g: RoomGrid, x: number, y: number, r: number): boolean {
  const t = g.tile;
  const c0 = Math.floor((x - r) / t), c1 = Math.floor((x + r) / t), r0 = Math.floor((y - r) / t), r1 = Math.floor((y + r) / t);
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    if (!solidAt(g, col, row)) continue;
    const nx = x < col * t ? col * t : x > (col + 1) * t ? (col + 1) * t : x;
    const ny = y < row * t ? row * t : y > (row + 1) * t ? (row + 1) * t : y;
    if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return true;
  }
  return false;
}

/** Move an actor from (x0, y0) to its current `pos`, undoing the part of the move that enters a solid tile (per axis). */
export function resolveMove(world: WorldState, a: ActorState, x0: number, y0: number): void {
  const g = world.grid;
  if (!g) return;
  const x1 = a.pos.x, y1 = a.pos.y;
  if (circleHitsSolid(g, x1, y0, a.radius)) a.pos.x = x0;
  if (circleHitsSolid(g, a.pos.x, y1, a.radius)) a.pos.y = y0;
  a.vel.x = a.pos.x - x0; a.vel.y = a.pos.y - y0;
}
