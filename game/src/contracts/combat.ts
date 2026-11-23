// Combat model contract: the DODGE 280 ms / STRIKE 900 ms model ported from playables/blood-sea/combat.mjs.
// Durations are whole ticks; milliseconds in design data go through msToTicks().
import type { Vec2 } from './world.ts';

export type Mode = 'ready' | 'playing' | 'falling' | 'releasing' | 'won' | 'lost';

export interface RoomBounds { minX: number; minY: number; maxX: number; maxY: number }

export interface FightStats { hits: number; dodges: number; counters: number; counterHits: number; hitsTaken: number }

/** Source of the guard window: a dodge guards and charges a counter, a hurt blink only blinks. */
export type GuardSource = 'none' | 'dodge' | 'hurt';

/** Per-actor combat timers, all in ticks except the vectors. Mobs carry the same record with zeros. */
export interface ActorCombat {
  /** Dodge cooldown left. */
  cool: number;
  /** Strike windup+impact ticks left; 0 when not striking. */
  action: number;
  /** Dash ticks left. */
  dash: number;
  /** Guard (dodge window or post-hurt blink) ticks left. */
  guard: number;
  guardSource: GuardSource;
  /** Hurt pose ticks left. */
  hurt: number;
  /** Counter window ticks left after a perfect dodge. */
  counterWindow: number;
  /** True when the strike now in progress was begun inside the counter window. */
  counterCast: boolean;
  /** Strike lock ticks left (windup + impact + recovery). */
  slash: number;
  /** Fall-down ticks left after the last hit point is lost. */
  down: number;
  /** Last non-zero movement direction (unit vector); dash and facing derive from it. */
  motion: Vec2;
  /** Aim unit vector fixed at the strike's start. */
  aim: Vec2;
  moving: boolean;
}

export type HazardKind = 'claw' | 'seal' | 'wail' | 'circle' | 'ring';

/** A telegraphed danger area. Shapes: claw = rectangle along dir, seal = disc, wail = disc with an open wedge, circle/ring for mobs. */
export interface Hazard {
  id: number;
  kind: HazardKind;
  /** Actor that created it. */
  owner: number;
  x: number;
  y: number;
  dir: Vec2;
  /** Unit vector at the centre of the open wedge (wail only). */
  wedge: Vec2;
  /** cos of the wedge half-angle: a point is safe inside the wedge when dot(unit(p - centre), wedge) >= gapCos. */
  gapCos: number;
  radius: number;
  length: number;
  damage: number;
  /** Ticks until impact, and the total telegraph length (>= 250 ms by the contract lint). */
  timer: number;
  duration: number;
  /** True when the player was inside the shape during the last guard ticks of a dash. */
  dodgedThrough: boolean;
}

/** Fixed numbers of the model, in ticks (seconds in the original). Single source for sim and tests. */
export const COMBAT = {
  /** Invulnerable guard after a dash starts: DODGE 280 ms. */
  dodgeGuard: 17,
  /** Counter window after a perfect dodge: STRIKE 900 ms. */
  counterWindow: 54,
  dashPush: 4,
  dashSlide: 7,
  dodgeCooldown: 51,
  strikeWindup: 9,
  strikeImpact: 11,
  strikeRecovery: 5,
  hurtPose: 9,
  kneelHold: 25,
  hurtBlink: 45,
  bossImpact: 15,
  bossRecovery: 34,
  clawWarning: 54,
  wailCall: 55,
  sealBreak: 42,
  freezeHit: 3,
  freezeHurt: 5,
  playerHp: 6,
} as const;
