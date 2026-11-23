// The DODGE / STRIKE telegraph model: a hazard is shown for its whole duration, a dash that is in the shape during the
// last guard ticks counts as a dodge, and a dodge at impact opens the counter window. Ported from
// playables/blood-sea/combat.mjs (incoming, warn, the warn -> impact branch).
import { COMBAT } from '../../contracts/combat.ts';
import type { Hazard, HazardKind } from '../../contracts/combat.ts';
import type { ActorState, GameEvent, WorldState } from '../../contracts/world.ts';
import { unitInto } from '../math.ts';
import { hurtPlayer, setMode } from './combat.ts';

/** cos / sin of 0.72 rad (the wail's open wedge is centred 0.72 rad off the boss->player axis) and cos of the 0.5 rad half-angle. Literals: the sim has no trig. */
const COS_072 = 0.751805729140895, SIN_072 = 0.6593846719714731, COS_GAP = 0.8775825618903728;

const u = { x: 0, y: 0 };

/** Is the point (px, py) inside the danger part of the hazard. Geometry matches the three warnings drawn by the original. */
export function hazardIncoming(h: Hazard, px: number, py: number): boolean {
  const dx = px - h.x, dy = py - h.y;
  if (h.kind === 'seal' || h.kind === 'circle') return dx * dx + dy * dy <= h.radius * h.radius;
  if (h.kind === 'wail' || h.kind === 'ring') {
    if (dx * dx + dy * dy > h.radius * h.radius) return false;
    if (h.kind === 'ring') return true;
    unitInto(u, dx, dy);
    // Safe inside the open wedge: angle to its centre <= gap  <=>  cos >= cos(gap). At the exact centre of the ring there is no angle: danger.
    return !(u.x !== 0 || u.y !== 0) || u.x * h.wedge.x + u.y * h.wedge.y < COS_GAP;
  }
  const along = dx * h.dir.x + dy * h.dir.y, across = Math.abs(dx * h.dir.y - dy * h.dir.x);
  return along >= -8 && along <= h.length && across <= h.radius;
}

export interface HazardSpec { kind: HazardKind; owner: number; x: number; y: number; dirX: number; dirY: number; radius: number; length: number; damage: number; ticks: number }

/** Create a hazard. The wail wedge is centred 0.72 rad counter-clockwise (screen: y down) of dir, as in the original. */
export function addHazard(world: WorldState, s: HazardSpec, events: GameEvent[]): Hazard {
  const h: Hazard = {
    id: world.nextHazardId++, kind: s.kind, owner: s.owner, x: s.x, y: s.y, dir: { x: s.dirX, y: s.dirY },
    wedge: { x: s.dirX * COS_072 - s.dirY * SIN_072, y: s.dirX * SIN_072 + s.dirY * COS_072 }, gapCos: COS_GAP,
    radius: s.radius, length: s.length, damage: s.damage, timer: s.ticks, duration: s.ticks, dodgedThrough: false,
  };
  world.hazards.push(h);
  events.push({ type: 'telegraph', tick: world.tick, hazard: h.id, kind: s.kind, ticks: s.ticks });
  return h;
}

/** While a dash is in progress during the last guard ticks of a telegraph, remember that it crossed the shape (the dodge counts even if the dash ends outside). */
export function markDodgedThrough(h: Hazard, player: ActorState): void {
  if (h.timer <= COMBAT.guardCheck && player.combat.dash > 0 && hazardIncoming(h, player.pos.x, player.pos.y)) h.dodgedThrough = true;
}

/** Impact: a guarded dodge earns the counter window; an unguarded actor inside takes the damage; dying makes the player fall. */
export function resolveHazard(world: WorldState, h: Hazard, player: ActorState, events: GameEvent[]): void {
  const threatened = hazardIncoming(h, player.pos.x, player.pos.y);
  let hitActor = 0;
  if (threatened || h.dodgedThrough) {
    const c = player.combat;
    if (c.guard > 0 && c.guardSource === 'dodge') {
      c.cool = COMBAT.counterCool; c.slash = 0; c.counterWindow = COMBAT.counterWindow;
      world.stats.counters++;
      events.push({ type: 'dodge-counter', tick: world.tick, actor: player.id, hazard: h.id });
    } else if (threatened && c.guard === 0) {
      if (hurtPlayer(world, player, h.damage, h.owner, events)) hitActor = player.id;
    }
  }
  events.push({ type: 'hazard-resolved', tick: world.tick, hazard: h.id, hitActor });
  if (player.hp === 0) setMode(world, 'falling', events);
}
