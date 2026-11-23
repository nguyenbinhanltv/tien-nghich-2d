// The flinch of a counter-struck mob (PX-1). The sim sets `combat.hurt` on the mob, but its AI consumes it on its next tick
// (sim/ai/attack.ts stagger, charger.ts), so the renderer cannot read the pose from the actor: it records the counter `hit`
// event's tick per target, like juice.ts consumes events, and the pose plays from that tick for a fixed span.
import { COMBAT } from '../contracts/combat.ts';
import type { GameEvent } from '../contracts/world.ts';

/** Ticks the flinch lasts: the 3-frame clip (COMBAT.hurtPose) after the hit-stop (COMBAT.freezeHit) that the same hit causes. */
export const MOB_HURT_TICKS = COMBAT.freezeHit + COMBAT.hurtPose;

export class HurtPoses {
  private readonly at = new Map<number, number>();

  /** Feed the sim events of this render frame. Only a counter hit with damage staggers a mob (sim/systems/combat.ts damageEnemy). */
  onEvents(events: readonly GameEvent[]): void {
    for (const e of events) if (e.type === 'hit' && e.counter && e.damage > 0) this.at.set(e.target, e.tick);
    if (this.at.size > 64) this.at.clear();   // actors that died or left the room: nothing to keep
  }

  /** Tick the flinch of `actor` began while it is still playing at `tick`, else undefined. */
  startOf(actor: number, tick: number): number | undefined {
    const start = this.at.get(actor);
    if (start === undefined) return undefined;
    if (tick - start >= MOB_HURT_TICKS) { this.at.delete(actor); return undefined; }
    return tick >= start ? start : undefined;
  }

  clear(): void { this.at.clear(); }
}
