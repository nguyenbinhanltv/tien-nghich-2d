// mob_blood_pool_lurker: "thủy quái phục kích" (ambusher). Never moves. Dormant in its pool until the player comes
// close, then strikes the spot where the player stood when the tell began (a disc), then is exposed, then submerges.
import { dist } from '../math.ts';
import { begin, impact, noPlayer, stagger, track } from './attack.ts';
import { AMBUSHER as P, ticks } from './params.ts';
import type { MobBehavior } from './types.ts';
import { enter, setVel } from './util.ts';

const DORMANT = 'dormant', STRIKE = 'strike', RECOVER = 'recover';
// data[0] cooldown ticks left before it can surface again.

export const ambusher: MobBehavior = {
  ai: 'ambusher',
  init(a, ctx) { enter(a, ctx.world, DORMANT, 0, 'idle'); a.ai.data = [0, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx;
    setVel(a, 0, 0);
    if (noPlayer(a, ctx) || !player) return;
    a.ai.target = player.id;
    if (stagger(a, ctx, P.recoverMs)) return;
    switch (a.ai.state) {
      case DORMANT: {
        if (a.ai.data[0] > 0) { a.ai.data[0]--; break; }
        if (dist(a.pos.x, a.pos.y, player.pos.x, player.pos.y) <= P.triggerRange) {
          const tell = ticks(row.tell_ms);
          begin(a, ctx, { kind: 'seal', x: player.pos.x, y: player.pos.y, dirX: 0, dirY: 1, radius: P.strikeRadius, length: 0, damage: row.contact_dmg, ticks: tell });
          enter(a, world, STRIKE, tell, row.attack_clip);
        }
        break;
      }
      case STRIKE: {
        if (--a.ai.timer <= 0) { impact(a, ctx); enter(a, world, RECOVER, ticks(P.recoverMs), 'idle'); }
        else track(a, ctx, a.ai.timer);
        break;
      }
      case RECOVER: {
        if (--a.ai.timer <= 0) { a.ai.data[0] = ticks(P.cooldownMs); enter(a, world, DORMANT, 0, 'idle'); }
        break;
      }
    }
  },
};
