// Struct-of-arrays entity pool (plan E1.2). Typed arrays are allocated once at `capacity`; the hot loop only
// reads and writes slots, so nothing is allocated per tick. `count` live entries are packed at the front
// (swap-remove), so iteration order is deterministic and hashes depend only on live data.

export interface ProjectilePool {
  capacity: number;
  count: number;
  /** Monotonic id of the shot in each slot (ids are never reused within a world). */
  id: Int32Array;
  /** Actor id that fired it; 0 when the source is gone. */
  owner: Int32Array;
  /** Index into PROJECTILE_KINDS; the renderer maps it to a sprite. */
  kind: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  /** Units per tick. */
  vx: Float64Array;
  vy: Float64Array;
  radius: Float64Array;
  /** Ticks of life left; the shot disappears at 0. */
  ttl: Int32Array;
  damage: Int32Array;
  /** 1 when the shot was begun inside the counter window (double damage in the original model). */
  counter: Uint8Array;
  /** Next id to hand out. */
  nextId: number;
}

/** Projectile kind table. Index into this from `ProjectilePool.kind`; extend at the END only (saves store the index). */
export const PROJECTILE_KINDS = ['spirit_blade', 'mob_shot', 'player_bolt'] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** Hot-entity ceilings from plan 8.1; the sim asserts against them and the bot reports overruns. */
export const MAX_PROJECTILES = 1500;
export const MAX_ACTORS = 80;
