// E2.3 game feel, in the renderer only (the sim owns hit-stop: world.freeze; this layer adds the camera shake and the white
// hit flash from the sim's events). Pure logic, driven by wall-clock ms, so it works while the sim is frozen and is testable
// without Phaser. Offsets are whole logical pixels (camera.ts snapPx) so the pixel grid never shimmers.
import type { GameEvent, WorldState } from '../contracts/world.ts';
import { snapPx } from './camera.ts';

export interface JuiceSettings {
  /** 0..1 multiplier of the shake (accessibility slider, plan 8.3). */
  shake: number;
  /** false turns the white hit flash off. */
  flash: boolean;
}
export const DEFAULT_JUICE: JuiceSettings = { shake: 1, flash: true };

/** Amplitude in logical px and duration in ms per event. Numbers to be tuned by the owner's feel sheet (>= 3/4). */
export const SHAKE = {
  playerHit: { amp: 3, ms: 220 },
  counterHit: { amp: 2.5, ms: 180 },
  hit: { amp: 1.5, ms: 120 },
  hazardLand: { amp: 2, ms: 160 },
  bossDown: { amp: 4, ms: 400 },
} as const;
const FLASH_MS = 70;
/** A single actor can flash at most this often, and the whole screen never flashes (no full-screen white at all). */
const FLASH_MIN_GAP_MS = 120;

interface Shake { amp: number; start: number; ms: number; phase: number }

export class Juice {
  settings: JuiceSettings;
  private shakes: Shake[] = [];
  private readonly flashUntil = new Map<number, number>();
  private readonly lastFlash = new Map<number, number>();
  private seed = 1;

  constructor(settings: JuiceSettings = DEFAULT_JUICE) { this.settings = { ...settings }; }

  private add(amp: number, ms: number, now: number): void {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    this.shakes.push({ amp, ms, start: now, phase: (this.seed >>> 8) / 0x1000000 * Math.PI * 2 });
    if (this.shakes.length > 8) this.shakes.shift();
  }
  private flash(actor: number, now: number): void {
    if (!this.settings.flash) return;
    if (now - (this.lastFlash.get(actor) ?? -1e9) < FLASH_MIN_GAP_MS) return;
    this.lastFlash.set(actor, now);
    this.flashUntil.set(actor, now + FLASH_MS);
  }

  /** Feed the sim events of this render frame. */
  onEvents(events: readonly GameEvent[], world: Pick<WorldState, 'actors'>, now: number): void {
    const role = (id: number) => world.actors.find((a) => a.id === id)?.role;
    for (const e of events) {
      if (e.type === 'hit') {
        this.flash(e.target, now);
        if (role(e.target) === 'player') this.add(SHAKE.playerHit.amp, SHAKE.playerHit.ms, now);
        else if (e.counter) this.add(SHAKE.counterHit.amp, SHAKE.counterHit.ms, now);
        else this.add(SHAKE.hit.amp, SHAKE.hit.ms, now);
      } else if (e.type === 'hazard-resolved' && e.hitActor !== 0) this.add(SHAKE.hazardLand.amp, SHAKE.hazardLand.ms, now);
      else if (e.type === 'actor-died' && role(e.actor) === 'boss') this.add(SHAKE.bossDown.amp, SHAKE.bossDown.ms, now);
    }
  }

  /** Camera offset in whole pixels at time `now`. Decays linearly; alternates direction so it reads as a shake, not a drift. */
  offset(now: number): { x: number; y: number } {
    let x = 0, y = 0;
    this.shakes = this.shakes.filter((s) => now - s.start < s.ms);
    for (const s of this.shakes) {
      const k = 1 - (now - s.start) / s.ms;
      const t = (now - s.start) / 16;
      x += Math.cos(s.phase + t * 2.4) * s.amp * k;
      y += Math.sin(s.phase * 1.7 + t * 2.9) * s.amp * k;
    }
    const m = this.settings.shake;
    return { x: snapPx(x * m), y: snapPx(y * m) };
  }

  isFlashing(actor: number, now: number): boolean { return (this.flashUntil.get(actor) ?? 0) > now; }
}
