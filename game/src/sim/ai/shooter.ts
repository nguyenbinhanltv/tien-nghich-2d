// mob_vengeful_soul: "hồn xuyên tường" (shooter). Floats through walls (see PHASES_WALLS), keeps its distance from the
// player and fires a wailing orb (assets/manifest.json: "fires wailing orbs"). The aim is locked when the tell starts and
// shown as a thin line (a hazard that deals no damage and is never resolved); at the end of the tell the line goes and an
// orb flies along it. A dash's guard window absorbs the orb (hurtPlayer), walls stop it. The renderer dresses the orb as
// pj_mob_soul_wisp by its owner.
import { dist, unitInto } from '../math.ts';
import { fireProjectile, KIND } from '../systems/projectile.ts';
import { begin, noPlayer, stagger, track } from './attack.ts';
import { SHOOTER as P, ticks } from './params.ts';
import type { MobBehavior } from './types.ts';
import { dropHazards, enter, setVel } from './util.ts';

const d = { x: 0, y: 0 };
const FLOAT = 'float', CAST = 'cast', RECOVER = 'recover';
// data[0] cooldown ticks left; data[1..2] locked aim direction in 1/1000 during the cast.

export const shooter: MobBehavior = {
  ai: 'shooter',
  init(a, ctx) { enter(a, ctx.world, FLOAT, 0, 'move'); a.ai.data = [ticks(P.cooldownMs) >> 1, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx;
    if (noPlayer(a, ctx) || !player) return;
    a.ai.target = player.id;
    if (stagger(a, ctx, P.recoverMs)) return;
    const walk = row.speed / 60;
    switch (a.ai.state) {
      case FLOAT: {
        const r = dist(a.pos.x, a.pos.y, player.pos.x, player.pos.y);
        unitInto(d, player.pos.x - a.pos.x, player.pos.y - a.pos.y);
        const k = r > P.keep + P.tolerance ? 1 : r < P.keep - P.tolerance ? -1 : 0;
        setVel(a, d.x * k * walk, d.y * k * walk);
        if (a.ai.data[0] > 0) a.ai.data[0]--;
        else if (r <= P.castRange) {
          setVel(a, 0, 0);
          const tell = ticks(row.tell_ms);
          a.ai.data[1] = Math.round(d.x * 1000); a.ai.data[2] = Math.round(d.y * 1000);
          begin(a, ctx, { kind: 'claw', x: a.pos.x, y: a.pos.y, dirX: d.x, dirY: d.y, radius: P.aimHalfWidth, length: P.shotRange, damage: 0, ticks: tell }); // aim line only
          enter(a, world, CAST, tell, row.attack_clip);
        }
        break;
      }
      case CAST: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) {
          dropHazards(world, a.id);
          fireProjectile(world, a.id, KIND.mobShot, a.pos.x, a.pos.y, a.ai.data[1] / 1000, a.ai.data[2] / 1000, P.shotSpeed, P.shotRadius, Math.ceil(P.shotRange / P.shotSpeed), row.contact_dmg, false, ctx.events);
          enter(a, world, RECOVER, ticks(P.recoverMs), 'idle');
        }
        else track(a, ctx, a.ai.timer);
        break;
      }
      case RECOVER: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { a.ai.data[0] = ticks(P.cooldownMs) + ctx.rng.int(0, ticks(P.jitterMs)); enter(a, world, FLOAT, 0, 'move'); }
        break;
      }
    }
  },
};
