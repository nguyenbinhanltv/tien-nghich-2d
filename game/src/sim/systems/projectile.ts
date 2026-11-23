import { PROJECTILE_KINDS } from '../../contracts/pool.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { findActor } from '../actors.ts';
import { circleCircle } from '../collide.ts';
import { addProjectile, removeProjectile } from '../pool.ts';
import { SpatialHash } from '../spatial-hash.ts';
import { damageEnemy, hurtPlayer } from './combat.ts';
import { PHASES_WALLS } from '../ai/index.ts';
import { pointSolid } from './grid.ts';

export const KIND = { spiritBlade: PROJECTILE_KINDS.indexOf('spirit_blade'), mobShot: PROJECTILE_KINDS.indexOf('mob_shot'), playerBolt: PROJECTILE_KINDS.indexOf('player_bolt') } as const;

/** Largest shot radius the broad phase has to allow for when it queries around a target. */
const MAX_SHOT_RADIUS = 8;
const grids = new WeakMap<object, { hash: SpatialHash; out: Int32Array; key: string }>();
/** The broad phase for the room the world has now: rebuilt when the room bounds change (the floor loads rooms of other sizes). */
function scratch(world: WorldState): { hash: SpatialHash; out: Int32Array } {
  const r = world.room, key = `${r.minX},${r.minY},${r.maxX},${r.maxY}`;
  let g = grids.get(world.projectiles);
  if (!g || g.key !== key) {
    const w = r.maxX - r.minX + 64, h = r.maxY - r.minY + 64;
    g = { hash: new SpatialHash(w, h, 24, world.projectiles.capacity, r.minX - 32, r.minY - 32), out: new Int32Array(world.projectiles.capacity), key };
    grids.set(world.projectiles, g);
  }
  return g;
}

/** Fire a shot from an actor: velocity is given per tick. Returns false when the pool is full. */
export function fireProjectile(world: WorldState, ownerId: number, kind: number, x: number, y: number, dirX: number, dirY: number, speedPerTick: number, radius: number, ttl: number, damage: number, counter: boolean, events: GameEvent[]): boolean {
  const slot = addProjectile(world.projectiles, ownerId, kind, x, y, dirX * speedPerTick, dirY * speedPerTick, radius, ttl, damage, counter);
  if (slot < 0) return false;
  events.push({ type: 'projectile-fired', tick: world.tick, source: ownerId, kind: PROJECTILE_KINDS[kind] ?? 'unknown' });
  return true;
}

/** A shot may keep flying through a wall cell for this many px to reach a wall-phasing mob floating inside it (one tile). */
export const PHASER_REACH = 16;
/** True when a living wall-phasing mob (it floats inside walls) is within PHASER_REACH of this shot, so the wall must not swallow the shot before it can hit it. */
function inPhaser(world: WorldState, x: number, y: number, r: number): boolean {
  for (const a of world.actors) if (a.role === 'mob' && a.hp > 0 && PHASES_WALLS.has(a.kind) && circleCircle(x, y, r + PHASER_REACH, a.pos.x, a.pos.y, a.radius)) return true;
  return false;
}

/**
 * Move every shot one tick, test it against the actors it can hurt (owner is the player -> enemies, owner is an enemy -> the player),
 * apply damage, and drop spent shots. Order: move, hit, expire (as the original: a shot on its last tick can still hit).
 */
export function projectileSystem(world: WorldState, events: GameEvent[]): void {
  const p = world.projectiles;
  if (p.count === 0) return;
  for (let i = 0; i < p.count; i++) {
    p.x[i] = (p.x[i] as number) + (p.vx[i] as number);
    p.y[i] = (p.y[i] as number) + (p.vy[i] as number);
    p.ttl[i] = (p.ttl[i] as number) - 1;
  }
  if (world.grid) for (let i = 0; i < p.count; i++) {
    if (!pointSolid(world.grid, p.x[i] as number, p.y[i] as number)) continue;
    // the player's shot can still reach a wall-phasing mob inside the wall (the hit test below takes it); an enemy's shot never skips a wall
    if (findActor(world, p.owner[i] as number)?.role === 'player' && inPhaser(world, p.x[i] as number, p.y[i] as number, p.radius[i] as number)) continue;
    p.ttl[i] = -1; // shots stop at walls and props
    events.push({ type: 'projectile-hit', tick: world.tick, projectile: p.id[i] as number, target: 0 });
  }
  const { hash, out } = scratch(world);
  hash.rebuild(p.count, p.x, p.y);
  for (const a of world.actors) {
    if (a.hp <= 0) continue;
    const m = hash.query(a.pos.x, a.pos.y, a.radius + MAX_SHOT_RADIUS, out);
    for (let k = 0; k < m; k++) {
      const s = out[k] as number;
      if (s >= p.count || (p.ttl[s] as number) < 0) continue; // spent this tick (marked below) or the pool was cleared
      const ownerIsPlayer = findActor(world, p.owner[s] as number)?.role === 'player';
      if ((a.role === 'player') === ownerIsPlayer) continue; // no friendly fire
      if (!circleCircle(p.x[s] as number, p.y[s] as number, p.radius[s] as number, a.pos.x, a.pos.y, a.radius)) continue;
      events.push({ type: 'projectile-hit', tick: world.tick, projectile: p.id[s] as number, target: a.id });
      if (a.role === 'player') hurtPlayer(world, a, p.damage[s] as number, p.owner[s] as number, events); // a guarded dash absorbs the shot
      else damageEnemy(world, a, p.damage[s] as number, p.owner[s] as number, p.counter[s] === 1, events);
      p.ttl[s] = -1; // spent
      if (a.hp <= 0) break;
    }
  }
  for (let i = p.count - 1; i >= 0; i--) if ((p.ttl[i] as number) <= 0) removeProjectile(p, i);
}
