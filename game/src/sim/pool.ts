import type { ProjectilePool } from '../contracts/pool.ts';

/** Allocate the projectile pool once, at world creation. Nothing in the tick loop allocates after this. */
export function createProjectilePool(capacity: number): ProjectilePool {
  return {
    capacity, count: 0, nextId: 1,
    id: new Int32Array(capacity), owner: new Int32Array(capacity), kind: new Uint8Array(capacity),
    x: new Float64Array(capacity), y: new Float64Array(capacity), vx: new Float64Array(capacity), vy: new Float64Array(capacity),
    radius: new Float64Array(capacity), ttl: new Int32Array(capacity), damage: new Int32Array(capacity), counter: new Uint8Array(capacity),
  };
}

/** Add a shot. Returns its slot, or -1 when the pool is full (the shot is dropped, never allocated). */
export function addProjectile(p: ProjectilePool, owner: number, kind: number, x: number, y: number, vx: number, vy: number, radius: number, ttl: number, damage: number, counter: boolean): number {
  if (p.count >= p.capacity) return -1;
  const i = p.count++;
  p.id[i] = p.nextId++; p.owner[i] = owner; p.kind[i] = kind;
  p.x[i] = x; p.y[i] = y; p.vx[i] = vx; p.vy[i] = vy; p.radius[i] = radius;
  p.ttl[i] = ttl; p.damage[i] = damage; p.counter[i] = counter ? 1 : 0;
  return i;
}

/** Swap-remove: the last live shot takes slot i. Callers iterating forwards must revisit slot i (iterate backwards instead). */
export function removeProjectile(p: ProjectilePool, i: number): void {
  const last = --p.count;
  if (i !== last) {
    p.id[i] = p.id[last] as number; p.owner[i] = p.owner[last] as number; p.kind[i] = p.kind[last] as number;
    p.x[i] = p.x[last] as number; p.y[i] = p.y[last] as number; p.vx[i] = p.vx[last] as number; p.vy[i] = p.vy[last] as number;
    p.radius[i] = p.radius[last] as number; p.ttl[i] = p.ttl[last] as number; p.damage[i] = p.damage[last] as number; p.counter[i] = p.counter[last] as number;
  }
}

/** Move every live shot one tick and expire by ttl. Iterates backwards so swap-remove is safe. Allocation free. */
export function advanceProjectiles(p: ProjectilePool): void {
  for (let i = p.count - 1; i >= 0; i--) {
    p.x[i] = (p.x[i] as number) + (p.vx[i] as number);
    p.y[i] = (p.y[i] as number) + (p.vy[i] as number);
    const t = (p.ttl[i] as number) - 1;
    p.ttl[i] = t;
    if (t <= 0) removeProjectile(p, i);
  }
}

export function clearProjectiles(p: ProjectilePool): void { p.count = 0; }
