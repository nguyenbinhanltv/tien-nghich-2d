// Interface contract between lanes (plan section 7.1): the simulation owns WorldState and emits Events;
// the renderer, audio and UI only read them. Everything here is plain data so a run can be saved,
// replayed and hashed. No engine type may appear in this file. Lane A owns this folder; a change here
// is its own small PR so lanes B, C and D can rebase on it.
import type { ActorCombat, Hazard, Mode, RoomBounds, RoomGrid, FightStats } from './combat.ts';
import type { ProjectilePool } from './pool.ts';
import type { RunState } from './run.ts';

/** Fixed simulation rate. The sim never reads a clock: time is ticks. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
/** Seconds or milliseconds of design data to whole ticks. Rounds to nearest so 0.28 s is 17 ticks and 0.9 s is 54. */
export const secondsToTicks = (s: number): number => Math.round(s * TICK_HZ);
export const msToTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);

/** Logical camera of the pixel-perfect landscape view (plan section 4.6): 16:9, integer scale, letterboxed. */
export const VIEW_W = 384;
export const VIEW_H = 216;

export type Facing = 'south' | 'east' | 'north' | 'west';

export interface Vec2 { x: number; y: number }

/**
 * One tick of player intent. Touch (left stick + right buttons) and keyboard/pad all reduce to this.
 * `dash` is the DODGE button (Né): an invulnerable dash whose first 280 ms is the guard window.
 * `fire` is the STRIKE/attack button (Phản đòn): a strike begun inside the counter window after a perfect dodge deals double damage.
 */
export interface InputFrame {
  /** -1..1 per axis. The sim normalises; a diagonal is not faster. */
  move: Vec2;
  /** Aim as a unit vector (the input layer derives it; the sim does no trigonometry), or null to auto-aim at the nearest threat (mobile default). */
  aim: Vec2 | null;
  dash: boolean;
  fire: boolean;
}

export type ActorRole = 'player' | 'mob' | 'boss';

/** Generic AI slot so lane B can add behaviours without changing this contract. `state` is a content-defined name. */
export interface AiState {
  state: string;
  /** Ticks left in `state`. */
  timer: number;
  /** Actor id being chased/aimed at, or 0 for none. */
  target: number;
  /** Behaviour-private numbers (attack kind index, cycle counter, charge direction...). Must be integers or finite floats. */
  data: [number, number, number, number];
}

/** Asset keys are strings; the sim never holds a texture or sound reference. */
export interface ActorState {
  id: number;
  role: ActorRole;
  /** Content id of the mob/boss/player, e.g. a row of a content table. */
  kind: string;
  pos: Vec2;
  /** Units per tick. */
  vel: Vec2;
  facing: Facing;
  hp: number;
  hpMax: number;
  /** Collision circle radius in world pixels (hurtbox from bodies.json is the drawn truth; this is the sim's circle). */
  radius: number;
  /** Clip currently playing and the tick it started; the renderer derives the frame from the tick. */
  clip: string;
  clipStartTick: number;
  /** Ticks of damage immunity left (dash, hurt blink). While > 0 hits are ignored. */
  invuln: number;
  combat: ActorCombat;
  ai: AiState;
  /** Tick when `hp` reached 0, or -1 while alive. Dead actors are removed by the sim after the death clip. */
  diedTick: number;
}

/** State of the room being played (sim/run/floor.ts). */
export interface FloorState {
  /** Room id of rooms.csv. */
  room: string;
  /** Wave on the field (1-based) and how many the room has. */
  wave: number;
  waves: number;
  /** Every wave dead: the exit door is open. */
  cleared: boolean;
  /** The exit is open but the realm gate must be chosen first (takeGate); the player waits in the doorway. */
  gatePending: boolean;
  /** Doors of the room and whether each is open now (the HUD and the renderer draw them from here; `grid` holds the collision). */
  doors: { side: 'west' | 'east'; role: 'entry' | 'exit'; to: string; open: boolean }[];
  /** Pressure P of the floor (contracts/run.ts pressureAtFloor); 1 on the first floor. */
  pressure: number;
}

export interface WorldState {
  tick: number;
  seed: number;
  rngState: number;
  actors: ActorState[];
  nextActorId: number;
  /** Struct-of-arrays pool; see contracts/pool.ts. */
  projectiles: ProjectilePool;
  /** Telegraphed areas waiting to resolve (claw, seal, wail, mob telegraphs). */
  hazards: Hazard[];
  nextHazardId: number;
  room: RoomBounds;
  /** Optional tile collision of the room; omitted (not null) when absent so worlds without one hash as before. */
  grid?: RoomGrid;
  /** Where the run is in the floor: the room being played, its waves and doors. Omitted outside a floor. */
  stage?: FloorState;
  mode: Mode;
  /** Hit-stop: ticks left in which the world does not advance (but time-to-render does). */
  freeze: number;
  /** Ticks spent in `playing`, hit-stop included (the result clock). `tick` counts every step call. */
  elapsed: number;
  stats: FightStats;
  /** Absent until a run starts. */
  run: RunState | null;
}

/** Events flow sim -> render/audio through a queue; consumers must not mutate the world. */
export type GameEvent =
  | { type: 'actor-spawned'; tick: number; actor: number; kind: string }
  | { type: 'clip-event'; tick: number; actor: number; clip: string; name: ClipEventName }
  | { type: 'hit'; tick: number; source: number; target: number; damage: number; counter: boolean }
  | { type: 'actor-died'; tick: number; actor: number }
  | { type: 'dash'; tick: number; actor: number; facing: Facing }
  | { type: 'strike'; tick: number; actor: number; counter: boolean }
  | { type: 'dodge-counter'; tick: number; actor: number; hazard: number }
  | { type: 'telegraph'; tick: number; hazard: number; kind: string; ticks: number }
  | { type: 'hazard-resolved'; tick: number; hazard: number; hitActor: number }
  | { type: 'projectile-fired'; tick: number; source: number; kind: string }
  /** `target` is the actor hit, or 0 when the shot hit a wall or prop. */
  | { type: 'projectile-hit'; tick: number; projectile: number; target: number }
  | { type: 'hit-stop'; tick: number; ticks: number }
  | { type: 'phase-changed'; tick: number; actor: number; phase: string }
  | { type: 'mode-changed'; tick: number; mode: Mode }
  | { type: 'room-cleared'; tick: number }
  | { type: 'room-entered'; tick: number; room: string }
  | { type: 'wave-spawned'; tick: number; wave: number; of: number }
  | { type: 'door-opened'; tick: number; room: string }
  | { type: 'gate-pending'; tick: number; room: string }
  | { type: 'realm-breakthrough'; tick: number; from: number; to: number }
  | { type: 'reward-gained'; tick: number; id: string; amount: number }
  | { type: 'run-ended'; tick: number; outcome: 'banked' | 'died' | 'abandoned' | 'won' };

/** The names Kiln may put on a clip frame (docs/KILN_GAME_CONTRACT.md section 3). */
export const CLIP_EVENT_NAMES = ['tell', 'hit', 'hit_end', 'fire', 'step'] as const;
export type ClipEventName = (typeof CLIP_EVENT_NAMES)[number];
