// Damage, hit-stop, death and the mode machine. Every system calls these so rules live in one place.
import { COMBAT } from '../../contracts/combat.ts';
import type { Mode } from '../../contracts/combat.ts';
import type { ActorState, GameEvent, WorldState } from '../../contracts/world.ts';
import { clearProjectiles } from '../pool.ts';
import { findPlayer } from '../actors.ts';

export function setMode(world: WorldState, mode: Mode, events: GameEvent[]): void {
  if (world.mode === mode) return;
  world.mode = mode;
  events.push({ type: 'mode-changed', tick: world.tick, mode });
}

export function hitStop(world: WorldState, ticks: number, events: GameEvent[]): void {
  world.freeze = ticks;
  events.push({ type: 'hit-stop', tick: world.tick, ticks });
}

/** A hit on a mob or boss. Returns true when the hit lands (always, for now: enemies have no guard). */
export function damageEnemy(world: WorldState, target: ActorState, damage: number, source: number, counter: boolean, events: GameEvent[]): void {
  const before = target.hp;
  target.hp = Math.max(0, before - damage);
  world.stats.hits++;
  if (counter) world.stats.counterHits++;
  events.push({ type: 'hit', tick: world.tick, source, target: target.id, damage, counter });
  hitStop(world, COMBAT.freezeHit, events);
  if (target.role === 'mob' && target.hp > 0) target.combat.hurt = COMBAT.hurtPose; // a mob that is hit flinches: its AI cancels the attack in progress (sim/ai stagger)
  if (target.hp === 0 && before > 0) killActor(world, target, events);
}

/** Player takes a hit unless guarded or blinking. Returns whether it landed. */
export function hurtPlayer(world: WorldState, player: ActorState, damage: number, source: number, events: GameEvent[]): boolean {
  const c = player.combat;
  if (c.guard > 0 || player.invuln > 0 || player.hp <= 0) return false;
  player.hp = Math.max(0, player.hp - damage);
  world.stats.hitsTaken++;
  c.guard = COMBAT.hurtBlink; c.guardSource = 'hurt'; c.hurt = COMBAT.hurtPose;
  events.push({ type: 'hit', tick: world.tick, source, target: player.id, damage, counter: false });
  hitStop(world, COMBAT.freezeHurt, events);
  if (player.hp === 0) killActor(world, player, events);
  return true;
}

/** Death: players fall (mode 'falling'), bosses release (mode 'releasing'), mobs are swept after a short death clip. */
export function killActor(world: WorldState, a: ActorState, events: GameEvent[]): void {
  a.diedTick = world.tick;
  events.push({ type: 'actor-died', tick: world.tick, actor: a.id });
  if (a.role === 'player') {
    world.hazards.length = 0;
    a.combat.down = COMBAT.hurtPose + COMBAT.kneelHold;
    setMode(world, 'falling', events);
  } else if (a.role === 'boss') {
    world.hazards.length = 0; clearProjectiles(world.projectiles);
    a.ai.state = 'release'; a.ai.timer = COMBAT.sealBreak;
    setMode(world, 'releasing', events);
  }
}

/** Frames a mob's corpse stays before it is removed from the world (the renderer plays the death clip meanwhile). */
export const CORPSE_TICKS = 30;

/** Remove swept mobs and report a cleared room when the last hostile goes. Runs once per tick, after all systems. */
export function sweepDead(world: WorldState, events: GameEvent[]): void {
  let removed = false;
  for (let i = world.actors.length - 1; i >= 0; i--) {
    const a = world.actors[i] as ActorState;
    if (a.role === 'mob' && a.hp <= 0 && world.tick - a.diedTick >= CORPSE_TICKS) { world.actors.splice(i, 1); removed = true; }
  }
  if (removed && world.mode === 'playing' && findPlayer(world) && !world.actors.some((a) => a.role !== 'player')) events.push({ type: 'room-cleared', tick: world.tick });
}
