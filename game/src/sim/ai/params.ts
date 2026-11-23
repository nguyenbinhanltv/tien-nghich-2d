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
