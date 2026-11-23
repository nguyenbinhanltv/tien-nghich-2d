// Interface contract between lanes (plan section 7.1): the simulation owns WorldState and emits Events;
// the renderer, audio and UI only read them. Everything here is plain data so a run can be saved,
// replayed and hashed. No engine type may appear in this file.

/** Fixed simulation rate. The sim never reads a clock: time is ticks. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Logical camera of the pixel-perfect view (plan section 4.6). */
export const VIEW_W = 384;
export const VIEW_H = 216;

export type Facing = 'south' | 'east' | 'north' | 'west';

export interface Vec2 { x: number; y: number }

export interface InputFrame {
  /** -1..1 per axis; touch joystick and keyboard both reduce to this. */
  move: Vec2;
  /** Aim direction in radians, or null to auto-aim (mobile default). */
  aim: number | null;
  dash: boolean;
  fire: boolean;
}

/** Asset keys are strings; the sim never holds a texture or sound reference. */
export interface ActorState {
  id: number;
  /** Content id of the mob/boss/player, e.g. a row of a content table. */
  kind: string;
  pos: Vec2;
  facing: Facing;
  hp: number;
  /** Clip currently playing and the tick it started; the renderer derives the frame from the tick. */
  clip: string;
  clipStartTick: number;
}

export interface WorldState {
  tick: number;
  seed: number;
  rngState: number;
  actors: ActorState[];
  nextActorId: number;
}

/** Events flow sim -> render/audio through a queue; consumers must not mutate the world. */
export type GameEvent =
  | { type: 'actor-spawned'; tick: number; actor: number; kind: string }
  | { type: 'clip-event'; tick: number; actor: number; clip: string; name: ClipEventName }
  | { type: 'hit'; tick: number; source: number; target: number; damage: number }
  | { type: 'actor-died'; tick: number; actor: number };

/** The names Kiln may put on a clip frame (docs/KILN_GAME_CONTRACT.md section 3). */
export const CLIP_EVENT_NAMES = ['tell', 'hit', 'hit_end', 'fire', 'step'] as const;
export type ClipEventName = (typeof CLIP_EVENT_NAMES)[number];

/** Read access to compiled content (dist-content). The game refuses content that failed its schema. */
export interface ContentApi {
  readonly version: string;
  has(table: string, id: string): boolean;
  get<T>(table: string, id: string): T;
}
