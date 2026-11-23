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
