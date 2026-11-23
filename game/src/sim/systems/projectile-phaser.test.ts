import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../contracts/world.ts';
import { spawnActor } from '../actors.ts';
import { createWorld } from '../loop.ts';
import { fireProjectile, KIND, projectileSystem } from './projectile.ts';

// A wall-phasing soul (mob_vengeful_soul) floats 12 px inside (centre 12 px in) the east wall; the player's shots used to die at the wall edge,
// so a soul that retreated into the wall could never be killed and the room never cleared (found by the G1 web playthrough).
const rows = ['########', '#......#', '#......#', '#......#', '########'];
const world = (mobKind: string) => {
  const w = createWorld(1), ev: GameEvent[] = [];
  w.room = { minX: 16, minY: 16, maxX: 112, maxY: 64 }; w.grid = { tile: 16, rows };
  const player = spawnActor(w, 'player', 40, 40, 6, ev);
  const mob = spawnActor(w, mobKind, 7 * 16 + 12, 40, 12, ev);
  mob.role = 'mob';
  return { w, ev, player, mob };
};
const fly = (mobKind: string) => {
  const { w, ev, player, mob } = world(mobKind);
  fireProjectile(w, player.id, KIND.spiritBlade, 90, 40, 1, 0, 4, 3, 60, 3, false, ev);
  for (let i = 0; i < 40; i++) projectileSystem(w, ev);
  return mob.hp;
};
describe('an enemy shot next to a soul', () => {
  it('is still stopped by the wall (a player behind the wall is not hit)', () => {
    const { w, ev, player, mob } = world('mob_vengeful_soul');
    player.pos.y = 48; player.pos.x = 7 * 16 + 12; // standing in the wall cell behind the soul's line of fire
    fireProjectile(w, mob.id, KIND.mobShot, 90, 48, 1, 0, 4, 3, 60, 1, false, ev);
    for (let i = 0; i < 40; i++) projectileSystem(w, ev);
    expect(player.hp).toBe(6);
    expect(w.projectiles.count).toBe(0);
  });
});

describe('player shots and a wall-phasing mob inside the wall', () => {
  it('hit a vengeful soul floating in the wall', () => { expect(fly('mob_vengeful_soul')).toBeLessThan(12); });
  it('are still stopped by the wall when nothing floats in it', () => { expect(fly('mob_blood_wolf')).toBe(12); });
});
