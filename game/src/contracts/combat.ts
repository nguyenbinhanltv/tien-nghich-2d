// Combat model contract: the DODGE 280 ms / STRIKE 900 ms model ported from playables/blood-sea/combat.mjs.
// Durations are whole ticks; milliseconds in design data go through msToTicks().
import type { Vec2 } from './world.ts';

export type Mode = 'ready' | 'playing' | 'falling' | 'releasing' | 'won' | 'lost';

export interface RoomBounds { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Collision grid of a room: rows of tile characters (plain JSON so it is saved and hashed). `#` wall, `P` prop that blocks,
 * `D` locked door (blocks), `O` open door, `.` floor, `~` blood pool (walkable). Blocking = `#`, `P`, `D`.
 * Tile (c, r) covers world x in [c*tile, (c+1)*tile) and y in [r*tile, (r+1)*tile). Absent = a bare arena bounded by `room`.
 */
export interface RoomGrid { tile: number; rows: string[] }

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

/**
 * Fixed numbers of the model, in ticks. Each is the number of 1/60 s steps the original's float countdown takes to reach 0
 * (so 0.19 s is 11 and 0.25 s is 16: float residue in the original adds a step), which keeps the port within 1 tick. Single source for sim and tests.
 */
export const COMBAT = {
  /** Invulnerable guard after a dash starts: DODGE 280 ms. */
  dodgeGuard: 17,
  /** A dash that is inside a telegraph when this many ticks remain counts as dodged through (the original compares the float timer with 0.28 s). */
  guardCheck: 16,
  /** Cooldown the dodge leaves after it earns a counter (0.4 s). */
  counterCool: 25,
  /** Counter window after a perfect dodge: STRIKE 900 ms. */
  counterWindow: 54,
  dashPush: 4,
  dashSlide: 7,
  dodgeCooldown: 51,
  strikeWindup: 10,
  strikeImpact: 11,
  strikeRecovery: 5,
  hurtPose: 10,
  kneelHold: 24,
  hurtBlink: 45,
  bossImpact: 16,
  bossRecovery: 34,
  clawWarning: 54,
  wailCall: 55,
  sealBreak: 42,
  freezeHit: 4,
  freezeHurt: 5,
  playerHp: 6,
} as const;
