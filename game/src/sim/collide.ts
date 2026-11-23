// Overlap tests for circles and axis-aligned boxes. Pure functions on numbers: nothing allocates.
// Touching counts as a hit for circles (<=) so a shot that ends exactly on the edge still lands.

export function circleCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx, dy = ay - by, r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

export function circleAabb(cx: number, cy: number, r: number, bx: number, by: number, bw: number, bh: number): boolean {
  const nx = cx < bx ? bx : cx > bx + bw ? bx + bw : cx;
  const ny = cy < by ? by : cy > by + bh ? by + bh : cy;
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export function aabbAabb(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

export function pointInAabb(px: number, py: number, bx: number, by: number, bw: number, bh: number): boolean {
  return px >= bx && px < bx + bw && py >= by && py < by + bh;
}

/** Distance from a point to the segment a-b, squared (continuous check for fast shots: pass last and current position). */
export function segmentPointDistSq(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const abx = bx - ax, aby = by - ay, len = abx * abx + aby * aby;
  let t = len === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - px, dy = ay + aby * t - py;
  return dx * dx + dy * dy;
}

/** A moving circle (shot) against a still circle (target) over one tick: no tunnelling at high speed. */
export function sweptCircleHit(x0: number, y0: number, x1: number, y1: number, sr: number, tx: number, ty: number, tr: number): boolean {
  const r = sr + tr;
  return segmentPointDistSq(x0, y0, x1, y1, tx, ty) <= r * r;
}
