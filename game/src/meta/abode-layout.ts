// Where things stand in the Động Phủ hub, in logic pixels of the 384x216 view. Feet positions (the sprite origin is bottom centre).
// Pure data + one query, so the layout is testable without Phaser and the scene only draws it.
import { VIEW_H, VIEW_W } from '../contracts/world.ts';

export type StationId = 'kiln' | 'jar' | 'altar' | 'chest' | 'bed0' | 'bed1' | 'bed2' | 'gate' | 'gate_hengyue';
export interface Station { id: StationId; x: number; y: number; /** Reach in px from the feet position. */ reach: number }

export const STATIONS: readonly Station[] = [
  { id: 'kiln', x: 64, y: 92, reach: 26 },
  { id: 'jar', x: 124, y: 92, reach: 22 },
  { id: 'altar', x: 192, y: 88, reach: 26 },
  { id: 'chest', x: 262, y: 92, reach: 24 },
  { id: 'bed0', x: 72, y: 156, reach: 24 },
  { id: 'bed1', x: 112, y: 156, reach: 24 },
  { id: 'bed2', x: 152, y: 156, reach: 24 },
  { id: 'gate', x: 328, y: 168, reach: 28 },
  /** Second teleport array: the Hằng Nhạc biome (the one at 'gate' leads to Huyết Hải). */
  { id: 'gate_hengyue', x: 328, y: 112, reach: 28 },
];

/** Walkable rectangle for the player's feet: below the back wall, inside the side walls. */
export const WALK = { x0: 20, x1: VIEW_W - 20, y0: 60, y1: VIEW_H - 8 } as const;
export const SPAWN = { x: 192, y: 130 } as const;
export const WALL_ROWS = 2; // 16 px tall rows of wall cap along the top

export function nearestStation(x: number, y: number): Station | null {
  let best: Station | null = null, bd = Infinity;
  for (const s of STATIONS) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= s.reach && d < bd) { best = s; bd = d; }
  }
  return best;
}

export const clampToWalk = (x: number, y: number): { x: number; y: number } => ({
  x: Math.min(WALK.x1, Math.max(WALK.x0, x)), y: Math.min(WALK.y1, Math.max(WALK.y0, y)),
});
