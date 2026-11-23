// mob_blood_wolf: "lang lao" (charger). chase -> windup (tell, rect telegraph locked on the player) -> charge -> recover.
// Reading: the rectangle is fixed when the tell starts, so a player who leaves it (dodge) is never hit; the wolf
// then stands open for `recoverMs`, which is the punish window.
import type { MobBehavior } from './types.ts';
import { CHARGER, CHARGER_BY_MOB, tune, ticks } from './params.ts';
import { dist, unitInto } from '../math.ts';
import { addHazard, markDodgedThrough, resolveHazard } from '../systems/telegraph.ts';
import { dropHazards, enter, setVel } from './util.ts';

const d = { x: 0, y: 0 };
const CHASE = 'chase', WINDUP = 'windup', CHARGE = 'charge', RECOVER = 'recover';
// data[0] cooldown ticks left before the next charge; data[1..2] locked charge direction in 1/1000.

export const charger: MobBehavior = {
  ai: 'charger',
  init(a, ctx) { enter(a, ctx.world, CHASE, 0, 'move'); a.ai.data = [ticks(tune(CHARGER, CHARGER_BY_MOB, ctx.row.id).cooldownMs) >> 1, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx, P = tune(CHARGER, CHARGER_BY_MOB, row.id);
    if (!player) { dropHazards(world, a.id); setVel(a, 0, 0); if (a.clip !== 'idle') enter(a, world, 'idle', 0, 'idle'); return; }
    a.ai.target = player.id;
    const walk = row.speed / 60;
    if (a.combat.hurt > 0) { // stagger is consumed when taken (nothing else ticks a mob's `hurt` down); no re-trigger next tick
      a.combat.hurt = 0;
      if (a.ai.state !== RECOVER) { dropHazards(world, a.id); setVel(a, 0, 0); enter(a, world, RECOVER, ticks(P.recoverMs) >> 1, 'idle'); return; }
    }
    switch (a.ai.state) {
      case CHASE: {
        unitInto(d, player.pos.x - a.pos.x, player.pos.y - a.pos.y);
        setVel(a, d.x * walk, d.y * walk);
        if (a.ai.data[0] > 0) a.ai.data[0]--;
        else if (dist(a.pos.x, a.pos.y, player.pos.x, player.pos.y) <= P.triggerRange) {
          setVel(a, 0, 0);
          a.ai.data[1] = Math.round(d.x * 1000); a.ai.data[2] = Math.round(d.y * 1000);
          const tell = ticks(row.tell_ms);
          // One hazard for the whole attack: shown through the tell AND the lunge, resolved by the wolf when the lunge ends
          // (like the Ghost King owns its own countdown), so the hit lands when the wolf actually passes the player.
          addHazard(world, { kind: 'claw', owner: a.id, x: a.pos.x, y: a.pos.y, dirX: d.x, dirY: d.y, radius: P.chargeHalfWidth, length: P.chargeLength, damage: row.contact_dmg, ticks: tell + ticks(P.chargeMs) }, ctx.events);
          enter(a, world, WINDUP, tell, row.attack_clip);
        } else if (a.clip !== 'move') enter(a, world, CHASE, 0, 'move');
        break;
      }
      case WINDUP: {
        setVel(a, 0, 0);
        const h = world.hazards.find((x) => x.owner === a.id);
        if (h) markDodgedThrough(h, player);
        if (--a.ai.timer <= 0) enter(a, world, CHARGE, ticks(P.chargeMs));
        if (h) h.timer = a.ai.state === WINDUP ? a.ai.timer + ticks(P.chargeMs) : a.ai.timer;
        break;
      }
      case CHARGE: {
        const dx = a.ai.data[1] / 1000, dy = a.ai.data[2] / 1000, v = P.chargeLength / ticks(P.chargeMs);
        setVel(a, dx * v, dy * v);
        const h = world.hazards.find((x) => x.owner === a.id);
        if (h) markDodgedThrough(h, player);
        if (--a.ai.timer <= 0) {
          setVel(a, 0, 0);
          if (h) { resolveHazard(world, h, player, ctx.events); dropHazards(world, a.id); }
          enter(a, world, RECOVER, ticks(P.recoverMs), 'idle');
        } else if (h) h.timer = a.ai.timer;
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
