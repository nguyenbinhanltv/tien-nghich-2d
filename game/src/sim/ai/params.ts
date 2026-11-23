// Placeholder tuning for the Huyết Hải mobs (plan E4.1): numbers to make the slice playable, NOT balance.
// hp, speed (px/s), contact_dmg and tell_ms come from content/tables/mobs.csv; the rest lives here, in ms and px,
// and is converted to ticks at use. Moving these into a content table is a later step (needs a lane D schema).
import { msToTicks } from '../../contracts/world.ts';

export const CHARGER = {
  /** Start a charge when the player is closer than this (px); under chargeLength so the lunge reaches them. */
  triggerRange: 56,
  chargeLength: 64, chargeHalfWidth: 9,
  /** Charge speed as a multiple of the walk speed. */
  chargeMs: 260,
  recoverMs: 600,
  /** Cooldown after a charge, plus a seeded jitter in [0, jitterMs]. */
  cooldownMs: 700, jitterMs: 400,
} as const;

export const ticks = msToTicks;

export const SWOOPER = {
  /** Orbit radius around the player (px) and tolerance; the angular speed is the walk speed. */
  orbit: 78, orbitTolerance: 10,
  diveLength: 96, diveHalfWidth: 9, diveMs: 220,
  /** Dive when the orbit timer (ms, plus seeded jitter) runs out. */
  orbitMs: 1100, jitterMs: 600,
  recoverMs: 650,
} as const;

export const BRAWLER = {
  /** Swing when the player is closer than this (px). */
  reach: 30, swingRadius: 24, swingOffset: 18,
  recoverMs: 800, cooldownMs: 500,
} as const;

export const AMBUSHER = {
  /** The lurker surfaces when the player comes this close (px), then strikes the spot the player stood on. */
  triggerRange: 64, strikeRadius: 26,
  recoverMs: 1000, cooldownMs: 1200,
} as const;

export const SHOOTER = {
  /** Keeps this distance (px) +/- tolerance, casts a seal on the player's position. */
  keep: 96, tolerance: 14, castRange: 140, sealRadius: 20,
  recoverMs: 600, cooldownMs: 1400, jitterMs: 500,
} as const;
