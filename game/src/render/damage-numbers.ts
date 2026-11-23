// Floating damage numbers (PX-1): driven by the sim's `hit` events like juice.ts, wall-clock ms, whole logical pixels, no Phaser here.
// The digits come from the approved pixel font (ui/pixel-text.ts, #184); the scene draws them with an ink_01 outline. Colours are
// palette ids only: ink_06 (enemy hit), bronze_05 (counter strike), blood_05 (the player was hurt).
import type { GameEvent, WorldState } from '../contracts/world.ts';

export type NumberTone = 'hit' | 'counter' | 'hurt';
export const TONE_COLOUR: Record<NumberTone, number> = { hit: 0xd4d0d8, counter: 0xe0b030, hurt: 0xd03a4a };

/** How long a number lives, how far it climbs (whole px) and the most alive at once. */
export const NUMBER_MS = 700;
export const RISE_PX = 14;
export const MAX_ALIVE = 12;

interface Floater { text: string; tone: NumberTone; x: number; y: number; start: number; dx: number }
export interface ShownNumber { text: string; tone: NumberTone; x: number; y: number }

export class DamageNumbers {
  enabled = true;
  private alive: Floater[] = [];
  private seed = 7;

  /** Feed the sim events of this render frame. Zero-damage hits (the summon call) show nothing. */
  onEvents(events: readonly GameEvent[], world: Pick<WorldState, 'actors'>, now: number): void {
    if (!this.enabled) return;
    for (const e of events) {
      if (e.type !== 'hit' || !(e.damage > 0)) continue;
      const target = world.actors.find((a) => a.id === e.target);
      if (!target) continue;
      this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
      const dx = ((this.seed >>> 16) % 7) - 3;                     // a few px of sideways scatter so stacked hits do not overprint
      const tone: NumberTone = target.role === 'player' ? 'hurt' : e.counter ? 'counter' : 'hit';
      this.alive.push({ text: String(Math.round(e.damage)), tone, x: Math.round(target.pos.x), y: Math.round(target.pos.y - target.radius - 14), start: now, dx });
      if (this.alive.length > MAX_ALIVE) this.alive.shift();
    }
  }

  /** The numbers to draw at `now`: whole-pixel positions, climbing with an ease-out, gone after NUMBER_MS. */
  visible(now: number): ShownNumber[] {
    this.alive = this.alive.filter((f) => now - f.start < NUMBER_MS);
    return this.alive.map((f) => {
      const t = Math.min(1, Math.max(0, (now - f.start) / NUMBER_MS));
      return { text: f.text, tone: f.tone, x: f.x + f.dx, y: f.y - Math.round(RISE_PX * (1 - (1 - t) * (1 - t))) };
    });
  }
}
