// mob_vengeful_soul: "hồn xuyên tường" (shooter). Floats through walls (see PHASES_WALLS), keeps its distance from the
// player and casts a seal (disc) on the player's position. There is no projectile art for mobs yet, so the cast is a
// telegraphed area, which the renderer shows with the existing hazard drawing.
import { dist, unitInto } from '../math.ts';
import { begin, impact, noPlayer, stagger, track } from './attack.ts';
import { SHOOTER as P, ticks } from './params.ts';
import type { MobBehavior } from './types.ts';
import { enter, setVel } from './util.ts';

const d = { x: 0, y: 0 };
const FLOAT = 'float', CAST = 'cast', RECOVER = 'recover';
// data[0] cooldown ticks left.

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
          begin(a, ctx, { kind: 'seal', x: player.pos.x, y: player.pos.y, dirX: d.x, dirY: d.y, radius: P.sealRadius, length: 0, damage: row.contact_dmg, ticks: tell });
          enter(a, world, CAST, tell, row.attack_clip);
        }
        break;
      }
      case CAST: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { impact(a, ctx); enter(a, world, RECOVER, ticks(P.recoverMs), 'idle'); }
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
