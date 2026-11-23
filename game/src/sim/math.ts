// Small vector helpers. sqrt is exactly rounded by IEEE 754, so these are bit-identical on every engine;
// sin/cos/atan2/hypot are not, and the sim never uses them.
import type { Facing, Vec2 } from '../contracts/world.ts';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const dist = (ax: number, ay: number, bx: number, by: number): number => { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); };

/** Unit vector of (x, y), or (0, 0) for a zero vector. Writes into `out` to avoid allocating. */
export function unitInto(out: Vec2, x: number, y: number): Vec2 {
  const n = Math.sqrt(x * x + y * y);
  if (n === 0) { out.x = 0; out.y = 0; } else { out.x = x / n; out.y = y / n; }
  return out;
}

/** Cardinal facing of a direction: the larger axis wins, ties go vertical (as in the original). */
export function facingOf(x: number, y: number): Facing {
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'east' : 'west') : (y > 0 ? 'south' : 'north');
}
