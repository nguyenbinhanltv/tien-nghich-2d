// mob_blood_corpse: "thi tanker" (brawler). Slow and sturdy: walks at the player and, in reach, swings a disc just in
// front of it after the tell. Then it is open (recover), then it must close in again after a short cooldown.
import { dist, unitInto } from '../math.ts';
import { begin, impact, noPlayer, stagger, track } from './attack.ts';
import { BRAWLER as P, ticks } from './params.ts';
import type { MobBehavior } from './types.ts';
import { enter, setVel } from './util.ts';

const d = { x: 0, y: 0 };
const CHASE = 'chase', SWING = 'swing', RECOVER = 'recover';
// data[0] cooldown ticks left.

export const brawler: MobBehavior = {
  ai: 'brawler',
  init(a, ctx) { enter(a, ctx.world, CHASE, 0, 'move'); a.ai.data = [0, 0, 0, 0]; },
  update(a, ctx) {
    const { world, row, player } = ctx;
    if (noPlayer(a, ctx) || !player) return;
    a.ai.target = player.id;
    if (stagger(a, ctx, P.recoverMs)) return;
    switch (a.ai.state) {
      case CHASE: {
        unitInto(d, player.pos.x - a.pos.x, player.pos.y - a.pos.y);
        const walk = row.speed / 60;
        if (a.ai.data[0] > 0) a.ai.data[0]--;
        if (a.ai.data[0] === 0 && dist(a.pos.x, a.pos.y, player.pos.x, player.pos.y) <= P.reach) {
          setVel(a, 0, 0);
          const tell = ticks(row.tell_ms);
          begin(a, ctx, { kind: 'circle', x: a.pos.x + d.x * P.swingOffset, y: a.pos.y + d.y * P.swingOffset, dirX: d.x, dirY: d.y, radius: P.swingRadius, length: 0, damage: row.contact_dmg, ticks: tell });
          enter(a, world, SWING, tell, row.attack_clip);
        } else { setVel(a, d.x * walk, d.y * walk); if (a.clip !== 'move') enter(a, world, CHASE, 0, 'move'); }
        break;
      }
      case SWING: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { impact(a, ctx); enter(a, world, RECOVER, ticks(P.recoverMs), 'idle'); }
        else track(a, ctx, a.ai.timer);
        break;
      }
      case RECOVER: {
        setVel(a, 0, 0);
        if (--a.ai.timer <= 0) { a.ai.data[0] = ticks(P.cooldownMs); enter(a, world, CHASE, 0, 'move'); }
        break;
      }
    }
  },
};
