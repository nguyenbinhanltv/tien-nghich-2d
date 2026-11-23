// mob_blood_crow: "quạ lượn" (swooper). It circles the player at a distance, then dives along a rectangle locked at the
// start of the tell; after the dive it lands and is open for `recoverMs`.
import { dist, unitInto } from '../math.ts';
import { begin, impact, noPlayer, stagger, track } from './attack.ts';
import { SWOOPER as P, ticks } from './params.ts';
import type { MobBehavior } from './types.ts';
import { enter, setVel } from './util.ts';

const d = { x: 0, y: 0 };
const ORBIT = 'orbit', WINDUP = 'windup', DIVE = 'dive', RECOVER = 'recover';
// data[0] orbit direction (+1/-1), data[1..2] locked dive direction in 1/1000.

export const swooper: MobBehavior = {
  ai: 'swooper',
  init(a, ctx) { enter(a, ctx.world, ORBIT, ticks(P.orbitMs), 'move'); a.ai.data = [ctx.rng.next() < 0.5 ? 1 : -1, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx;
    if (noPlayer(a, ctx) || !player) return;
    a.ai.target = player.id;
    if (stagger(a, ctx, P.recoverMs)) return;
    const walk = row.speed / 60;
    switch (a.ai.state) {
      case ORBIT: {
        const r = dist(a.pos.x, a.pos.y, player.pos.x, player.pos.y);
        unitInto(d, player.pos.x - a.pos.x, player.pos.y - a.pos.y);
        // radial correction towards the orbit radius plus a tangent step (tangent = d rotated 90 degrees)
        const radial = r > P.orbit + P.orbitTolerance ? 1 : r < P.orbit - P.orbitTolerance ? -1 : 0;
        const tx = -d.y * a.ai.data[0], ty = d.x * a.ai.data[0];
        setVel(a, (d.x * radial * 0.7 + tx) * walk, (d.y * radial * 0.7 + ty) * walk);
        if (--a.ai.timer <= 0) {
          setVel(a, 0, 0);
          a.ai.data[1] = Math.round(d.x * 1000); a.ai.data[2] = Math.round(d.y * 1000);
          const tell = ticks(row.tell_ms);
          begin(a, ctx, { kind: 'claw', x: a.pos.x, y: a.pos.y, dirX: d.x, dirY: d.y, radius: P.diveHalfWidth, length: P.diveLength, damage: row.contact_dmg, ticks: tell + ticks(P.diveMs) });
          enter(a, world, WINDUP, tell, row.attack_clip);
        }
        break;
      }
      case WINDUP: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) enter(a, world, DIVE, ticks(P.diveMs));
        track(a, ctx, a.ai.state === WINDUP ? a.ai.timer + ticks(P.diveMs) : a.ai.timer);
        break;
      }
      case DIVE: {
        const v = P.diveLength / ticks(P.diveMs);
        setVel(a, (a.ai.data[1] / 1000) * v, (a.ai.data[2] / 1000) * v);
        if (--a.ai.timer <= 0) { setVel(a, 0, 0); impact(a, ctx); enter(a, world, RECOVER, ticks(P.recoverMs), 'idle'); }
        else track(a, ctx, a.ai.timer);
        break;
      }
      case RECOVER: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { a.ai.data[0] = ctx.rng.next() < 0.5 ? 1 : -1; enter(a, world, ORBIT, ticks(P.orbitMs) + ctx.rng.int(0, ticks(P.jitterMs)), 'move'); }
        break;
      }
    }
  },
};
