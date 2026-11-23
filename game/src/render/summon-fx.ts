// The summoning circle of the Ghost King's summon attack (PX-1): the `ghost_summon_call` VFX under the boss's `circle` hazard
// (sim/ai/boss.ts summon_call: no damage, only shows where the mobs rise). The clip is 75 frames @30 fps in three sections
// (start 0-17, loop 18-41, end 42-74). Start then loop play while the hazard is up; when the hazard resolves (the summon), the end
// section plays out on its own. Pure state keyed by hazard id, driven by the sim tick, so a replay shows the same picture.
import type { Hazard } from '../contracts/combat.ts';
import { TICK_HZ } from '../contracts/world.ts';

export const SUMMON_FPS = 30;
export const SUMMON_START = 18, SUMMON_LOOP_END = 41, SUMMON_LAST = 74;
/** The 76x40 frame's anchor is its bottom: the ring is drawn 12 px above it (spec `at: [0, -12]`), so the circle's centre sits at anchor y - 12. */
export const SUMMON_RING_LIFT = 12;
export const SUMMON_ORIGIN = { x: 38 / 76, y: 38 / 40 };

export const summonFrameName = (n: number): string => `vfx/ghost_summon_call_${n}`;

/** Frame while the hazard is up, `elapsed` ticks after it appeared: the start section once, then the loop section repeating. */
export function liveFrame(elapsed: number): number {
  const f = Math.max(0, Math.floor((elapsed * SUMMON_FPS) / TICK_HZ));
  if (f < SUMMON_START) return f;
  const span = SUMMON_LOOP_END - SUMMON_START + 1;
  return SUMMON_START + ((f - SUMMON_START) % span);
}

/** Frame of the end section `elapsed` ticks after the hazard resolved, or null once it has played out. */
export function endFrame(elapsed: number): number | null {
  const f = SUMMON_LOOP_END + 1 + Math.max(0, Math.floor((elapsed * SUMMON_FPS) / TICK_HZ));
  return f > SUMMON_LAST ? null : f;
}

interface Ring { x: number; y: number; start: number; endedAt: number | null }
export interface ShownRing { x: number; y: number; frame: number }

export class SummonFx {
  private readonly rings = new Map<number, Ring>();

  /** `isBossCircle` picks the summon hazards (a boss-owned `circle`); call once per rendered frame with the world's hazards. */
  update(hazards: readonly Hazard[], isBossCircle: (h: Hazard) => boolean, tick: number): ShownRing[] {
    const live = new Set<number>();
    for (const h of hazards) {
      if (!isBossCircle(h)) continue;
      live.add(h.id);
      const r = this.rings.get(h.id);
      if (!r) this.rings.set(h.id, { x: h.x, y: h.y, start: tick - Math.max(0, h.duration - h.timer), endedAt: null });
      else { r.x = h.x; r.y = h.y; }
    }
    const out: ShownRing[] = [];
    for (const [id, r] of this.rings) {
      if (live.has(id)) { out.push({ x: r.x, y: r.y, frame: liveFrame(tick - r.start) }); continue; }
      r.endedAt ??= tick;
      const f = endFrame(tick - r.endedAt);
      if (f === null) this.rings.delete(id); else out.push({ x: r.x, y: r.y, frame: f });
    }
    return out;
  }

  clear(): void { this.rings.clear(); }
}
