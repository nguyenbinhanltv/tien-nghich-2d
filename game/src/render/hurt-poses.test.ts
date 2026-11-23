import { describe, expect, it } from 'vitest';
import { loadTables } from '../../tools/lib/tables.ts';
import type { MobRow } from '../contracts/content.ts';
import type { GameEvent } from '../contracts/world.ts';
import { contentOf, makeFight } from '../sim/ai/harness.ts';
import { damageEnemy } from '../sim/systems/combat.ts';
import { artOf } from './clip-map.ts';
import { HurtPoses, MOB_HURT_TICKS } from './hurt-poses.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const hit = (target: number, tick: number, over: object = {}): GameEvent => ({ type: 'hit', tick, source: 1, target, damage: 2, counter: true, ...over }) as GameEvent;

describe('HurtPoses', () => {
  it('records only counter hits with damage and plays the pose for MOB_HURT_TICKS from the hit tick', () => {
    const h = new HurtPoses();
    h.onEvents([hit(5, 100), hit(6, 100, { counter: false }), hit(7, 100, { damage: 0 })]);
    expect(h.startOf(5, 100)).toBe(100);
    expect(h.startOf(5, 100 + MOB_HURT_TICKS - 1)).toBe(100);
    expect(h.startOf(5, 100 + MOB_HURT_TICKS)).toBeUndefined();
    expect([h.startOf(6, 100), h.startOf(7, 100), h.startOf(8, 100)]).toEqual([undefined, undefined, undefined]);
  });
});

describe('a counter hit in the REAL sim: the mob flinches for several ticks even though its AI consumes combat.hurt at once', () => {
  for (const kind of ['mob_blood_wolf', 'mob_blood_corpse', 'mob_vengeful_soul', 'mob_blood_crow']) {
    it(kind, () => {
      const f = makeFight(3, content, 200, 150, [[kind, 60, 150]]);
      for (let i = 0; i < 5; i++) f.tick();
      const mob = f.world.actors.find((a) => a.id === f.mobs[0])!;
      const poses = new HurtPoses();
      const hitTick = f.world.tick;
      const ev: GameEvent[] = [];
      damageEnemy(f.world, mob, 1, f.player, true, ev);
      poses.onEvents(ev);
      expect(mob.combat.hurt).toBeGreaterThan(0);                       // the sim sets it ...
      expect(artOf(f.world, mob, poses.startOf(mob.id, hitTick))).toMatchObject({ clip: 'hurt', startTick: hitTick });
      const seen: string[] = [];
      for (let i = 0; i < MOB_HURT_TICKS + 2; i++) {
        f.tick();
        seen.push(artOf(f.world, mob, poses.startOf(mob.id, f.world.tick)).clip);
      }
      expect(mob.combat.hurt).toBe(0);                                  // ... and the AI has consumed it within a tick
      const flinch = seen.filter((c) => c === 'hurt').length;
      expect(flinch).toBeGreaterThanOrEqual(MOB_HURT_TICKS - 2);        // yet the art still flinches for the whole pose
      expect(seen.at(-1)).not.toBe('hurt');
    });
  }
});
