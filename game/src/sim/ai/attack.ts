// Shared pieces of the telegraphed-attack behaviours: the wolf's pattern (hazard owned by the mob, counted down by it,
// resolved by it) factored so each behaviour is only its movement and its shape.
import type { HazardKind } from '../../contracts/combat.ts';
import type { ActorState } from '../../contracts/world.ts';
import { addHazard, markDodgedThrough, resolveHazard } from '../systems/telegraph.ts';
import type { AiContext } from './types.ts';
import { dropHazards, enter, setVel } from './util.ts';
import { ticks } from './params.ts';

/** No player: stand and idle (and drop any telegraph). Returns true when the caller should stop. */
export function noPlayer(a: ActorState, ctx: AiContext): boolean {
  if (ctx.player) return false;
  dropHazards(ctx.world, a.id); setVel(a, 0, 0);
  if (a.clip !== 'idle') enter(a, ctx.world, 'idle', 0, 'idle');
  return true;
}

/** A stagger is consumed when taken (nothing else ticks a mob's `hurt` down): the attack and its telegraph are cancelled. Returns true when it interrupted. */
export function stagger(a: ActorState, ctx: AiContext, recoverMs: number): boolean {
  if (a.combat.hurt <= 0) return false;
  a.combat.hurt = 0;
  if (a.ai.state === 'recover') return false;
  dropHazards(ctx.world, a.id); setVel(a, 0, 0); enter(a, ctx.world, 'recover', ticks(recoverMs) >> 1, 'idle');
  return true;
}

export interface Shape { kind: HazardKind; x: number; y: number; dirX: number; dirY: number; radius: number; length: number; damage: number; ticks: number }

export function begin(a: ActorState, ctx: AiContext, s: Shape): void {
  addHazard(ctx.world, { ...s, owner: a.id }, ctx.events);
}

/** Per tick while the telegraph is up: record a dash through the shape, and keep the hazard timer equal to `remaining` ticks. */
export function track(a: ActorState, ctx: AiContext, remaining: number): void {
  const h = ctx.world.hazards.find((x) => x.owner === a.id);
  if (!h || !ctx.player) return;
  markDodgedThrough(h, ctx.player);
  h.timer = remaining;
}

/** Impact: resolve the hazard against the player and remove it. */
export function impact(a: ActorState, ctx: AiContext): void {
  const h = ctx.world.hazards.find((x) => x.owner === a.id);
  if (h && ctx.player) resolveHazard(ctx.world, h, ctx.player, ctx.events);
  dropHazards(ctx.world, a.id);
}
