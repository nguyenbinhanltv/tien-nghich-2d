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

// Per-mob tuning (plan G2-HN): a mob of the table may override single numbers of its behaviour's block above, keyed by mob id.
// The five Hằng Nhạc mobs reuse the five behaviours; a viper is a quicker charger, a guard a slower, wider brawler, and so on.
// Placeholder numbers, NOT balance. Mobs without an entry (the Huyết Hải five) keep the base block, so their fights are unchanged.
type Block = Record<string, number>;
type Overrides<T extends Block> = Readonly<Record<string, Partial<Record<keyof T, number>>>>;

/** The base block with the mob's overrides (if any) on top. Returns the base itself when there are none. */
export function tune<T extends Block>(base: T, overrides: Overrides<T>, mobId: string): Readonly<Record<keyof T, number>> {
  const o = overrides[mobId];
  return o ? ({ ...base, ...o } as Record<keyof T, number>) : base;
}

export const CHARGER_BY_MOB: Overrides<typeof CHARGER> = {
  // mob_rogue_disciple: "charges with iron sword" - the base charge, a little slower to recover.
  mob_rogue_disciple: { chargeLength: 60, recoverMs: 650 },
  // mob_herb_viper: "fast melee, lunging bite" - shorter, much quicker lunge, short recovery, often.
  mob_herb_viper: { triggerRange: 48, chargeLength: 56, chargeMs: 180, recoverMs: 550, cooldownMs: 500 },
};
export const BRAWLER_BY_MOB: Overrides<typeof BRAWLER> = {
  // mob_courtyard_guard: "slow shielded bruiser, shield bash" - a wider bash that comes out of a long guard, then a long recovery.
  mob_courtyard_guard: { swingRadius: 28, swingOffset: 20, recoverMs: 900, cooldownMs: 600 },
};
export const SHOOTER_BY_MOB: Overrides<typeof SHOOTER> = {
  // mob_sword_acolyte: "flying-sword volleys, keeps distance" - stays further off and casts more often.
  mob_sword_acolyte: { keep: 112, castRange: 150, sealRadius: 18, cooldownMs: 1200 },
  // mob_demonic_talisman: "hurls talismans" - a caster: a wider talisman seal, slower rhythm.
  mob_demonic_talisman: { keep: 100, sealRadius: 24, recoverMs: 700, cooldownMs: 1600 },
};
