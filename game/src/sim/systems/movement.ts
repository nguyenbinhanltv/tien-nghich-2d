// Player control: walk, DODGE (dash with a 280 ms guard), STRIKE (windup, release a spirit blade, recovery).
// Numbers are the original's per-second speeds divided by 60.
import { COMBAT } from '../../contracts/combat.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { nearestHostile } from '../actors.ts';
import { clamp, facingOf, unitInto } from '../math.ts';
import { fireProjectile, KIND } from './projectile.ts';

const WALK = 82 / 60, STRIKE_WALK = 29 / 60, DASH = 235 / 60;
const BLADE_SPEED = 245 / 60, BLADE_TTL = 26 /* range 105 / 4.083 per tick, rounded up */, BLADE_RADIUS = 0;
const v = { x: 0, y: 0 };

/** Count the timers down once per tick (action and dash are counted where they are used). */
export function tickTimers(a: ActorState): void {
  const c = a.combat;
  if (c.cool > 0) c.cool--;
  if (c.guard > 0) c.guard--;
  if (c.slash > 0) c.slash--;
  if (c.hurt > 0) c.hurt--;
  if (c.counterWindow > 0) c.counterWindow--;
  if (a.invuln > 0) a.invuln--;
}

export function playerControl(world: WorldState, p: ActorState, input: InputFrame, events: GameEvent[]): void {
  const c = p.combat;
  unitInto(v, input.move.x, input.move.y);
  c.moving = v.x !== 0 || v.y !== 0;
  const x0 = p.pos.x, y0 = p.pos.y;
  if (c.moving && c.dash === 0 && c.action === 0) { c.motion.x = v.x; c.motion.y = v.y; p.facing = facingOf(v.x, v.y); }

  if (input.dash && c.cool === 0 && c.dash === 0) {
    if (c.moving) { c.motion.x = v.x; c.motion.y = v.y; }
    p.facing = facingOf(c.motion.x, c.motion.y);
    c.action = 0; c.hurt = 0;
    c.dash = COMBAT.dashPush + COMBAT.dashSlide;
    c.cool = COMBAT.dodgeCooldown;
    c.guard = COMBAT.dodgeGuard; c.guardSource = 'dodge';
    world.stats.dodges++;
    p.clip = 'dash'; p.clipStartTick = world.tick;
    events.push({ type: 'dash', tick: world.tick, actor: p.id, facing: p.facing });
  }

  if (c.dash > 0) {
    p.pos.x += c.motion.x * DASH; p.pos.y += c.motion.y * DASH;
    c.dash--;
  } else {
    const speed = c.action > 0 ? STRIKE_WALK : WALK;
    p.pos.x += v.x * speed; p.pos.y += v.y * speed;
    if (input.fire && c.action === 0 && c.slash === 0) {
      c.action = COMBAT.strikeWindup + COMBAT.strikeImpact;
      c.slash = c.action + COMBAT.strikeRecovery;
      c.counterCast = c.counterWindow > 0;
      c.counterWindow = 0;
      if (input.aim) { c.aim.x = input.aim.x; c.aim.y = input.aim.y; }
      else {
        const t = nearestHostile(world, p.pos.x, p.pos.y);
        if (t) unitInto(c.aim, t.pos.x - p.pos.x, t.pos.y - p.pos.y);
        else { c.aim.x = c.motion.x; c.aim.y = c.motion.y; }
      }
      p.facing = facingOf(c.aim.x, c.aim.y);
      p.clip = 'attack'; p.clipStartTick = world.tick;
      events.push({ type: 'strike', tick: world.tick, actor: p.id, counter: c.counterCast });
    }
    if (c.action > 0) {
      const prior = c.action;
      c.action--;
      if (prior > COMBAT.strikeImpact && c.action <= COMBAT.strikeImpact) {
        fireProjectile(world, p.id, KIND.spiritBlade, p.pos.x, p.pos.y, c.aim.x, c.aim.y, BLADE_SPEED, BLADE_RADIUS, BLADE_TTL, c.counterCast ? 2 : 1, c.counterCast, events);
        events.push({ type: 'clip-event', tick: world.tick, actor: p.id, clip: 'attack', name: 'fire' });
      }
    }
  }
  p.pos.x = clamp(p.pos.x, world.room.minX, world.room.maxX);
  p.pos.y = clamp(p.pos.y, world.room.minY, world.room.maxY);
  p.vel.x = p.pos.x - x0; p.vel.y = p.pos.y - y0;
}
