// mob_blood_wolf: "lang lao" (charger). chase -> windup (tell, rect telegraph locked on the player) -> charge -> recover.
// Reading: the rectangle is fixed when the tell starts, so a player who leaves it (dodge) is never hit; the wolf
// then stands open for `recoverMs`, which is the punish window.
import type { MobBehavior } from './types.ts';
import { CHARGER as P, ticks } from './params.ts';
import { addHazard, dirTo, dist, enter, setVel, dropHazards } from './util.ts';

const CHASE = 'chase', WINDUP = 'windup', CHARGE = 'charge', RECOVER = 'recover';
// data[0] cooldown ticks left before the next charge; data[1..2] locked charge direction in 1/1000.

export const charger: MobBehavior = {
  ai: 'charger',
  init(a, ctx) { enter(a, ctx.world, CHASE, 0, 'move'); a.ai.data = [ticks(P.cooldownMs) >> 1, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx;
    if (!player) { setVel(a, 0, 0); if (a.clip !== 'idle') enter(a, world, 'idle', 0, 'idle'); return; }
    a.ai.target = player.id;
    const walk = row.speed / 60;
    if (a.combat.hurt > 0 && a.ai.state !== RECOVER) { // staggered: the charge is cancelled, the telegraph goes with it
      dropHazards(world, a.id); setVel(a, 0, 0); enter(a, world, RECOVER, ticks(P.recoverMs) >> 1, 'idle'); return;
    }
    switch (a.ai.state) {
      case CHASE: {
        const d = dirTo(a.pos, player.pos);
        setVel(a, d.x * walk, d.y * walk);
        if (a.ai.data[0] > 0) a.ai.data[0]--;
        else if (dist(a.pos, player.pos) <= P.triggerRange) {
          setVel(a, 0, 0);
          a.ai.data[1] = Math.round(d.x * 1000); a.ai.data[2] = Math.round(d.y * 1000);
          const tell = ticks(row.tell_ms);
          addHazard(world, ctx.events, a, { kind: 'claw', x: a.pos.x, y: a.pos.y, dir: d, radius: P.chargeHalfWidth, length: P.chargeLength, damage: row.contact_dmg, ticks: tell });
          enter(a, world, WINDUP, tell, row.attack_clip);
        } else if (a.clip !== 'move') enter(a, world, CHASE, 0, 'move');
        break;
      }
      case WINDUP: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) enter(a, world, CHARGE, ticks(P.chargeMs));
        break;
      }
      case CHARGE: {
        const dx = a.ai.data[1] / 1000, dy = a.ai.data[2] / 1000, v = P.chargeLength / ticks(P.chargeMs);
        setVel(a, dx * v, dy * v);
        if (--a.ai.timer <= 0) { setVel(a, 0, 0); enter(a, world, RECOVER, ticks(P.recoverMs), 'idle'); }
        break;
      }
      case RECOVER: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { a.ai.data[0] = ticks(P.cooldownMs) + ctx.rng.int(0, ticks(P.jitterMs)); enter(a, world, CHASE, 0, 'move'); }
        break;
      }
    }
  },
};
