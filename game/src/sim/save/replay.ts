// Mid-run save without serialising the whole world: seed + the exact input log. The sim is deterministic, so replaying the log
// rebuilds the world bit for bit, and the stored hash proves it (a mismatch means the code or content changed under the save).
// Inputs are quantised to 1/127 BEFORE the sim sees them, live and in replay alike, so analog sticks replay exactly.
import type { SuspendedRun } from '../../contracts/save.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { hashWorld } from '../hash.ts';
import { createWorld, step } from '../loop.ts';
import type { RunOutcome } from '../../contracts/run.ts';
import { advanceRoom, bankCarried, discardCarried, endRun, grantReward, learnRecipe, takeGate } from '../run/run.ts';

const q = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127)));

/** Feed the sim only quantised input: pass every live frame through this first. */
export function quantizeInput(i: InputFrame): InputFrame {
  return { move: { x: q(i.move.x) / 127, y: q(i.move.y) / 127 }, aim: i.aim ? { x: q(i.aim.x) / 127, y: q(i.aim.y) / 127 } : null, dash: i.dash, fire: i.fire };
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
function token(i: InputFrame): string {
  const aim = i.aim ? hex2(q(i.aim.x) + 127) + hex2(q(i.aim.y) + 127) : 'ffff';
  return hex2(q(i.move.x) + 127) + hex2(q(i.move.y) + 127) + aim + ((i.dash ? 1 : 0) | (i.fire ? 2 : 0)).toString(16);
}
function frameOf(t: string): InputFrame {
  const n = (k: number): number => (parseInt(t.slice(k, k + 2), 16) - 127) / 127;
  const bits = parseInt(t[8] as string, 16);
  return { move: { x: n(0), y: n(2) }, aim: t.slice(4, 8) === 'ffff' ? null : { x: n(4), y: n(6) }, dash: (bits & 1) !== 0, fire: (bits & 2) !== 0 };
}

/** Run-length encoded input log: "token*count" pieces joined by commas. */
export class InputRecorder {
  ticks = 0;
  private parts: string[] = [];
  private last = '';
  private n = 0;
  push(i: InputFrame): void {
    const t = token(i);
    if (t === this.last) this.n++;
    else { this.flush(); this.last = t; this.n = 1; }
    this.ticks++;
  }
  private flush(): void { if (this.n > 0) this.parts.push(this.n === 1 ? this.last : `${this.last}*${this.n}`); this.last = ''; this.n = 0; }
  /** A run action sits in the log between the inputs of the ticks before and after it, so replay applies it at the same moment. */
  pushAction(a: RunAction): void { this.flush(); this.parts.push(encodeAction(a)); }
  log(): string { const keep = this.parts.slice(); if (this.n > 0) keep.push(this.n === 1 ? this.last : `${this.last}*${this.n}`); return keep.join(','); }
}

/** Things that change the run outside `step`. They must go through `performRunAction` live so the log sees them. */
export type RunAction =
  | { t: 'advance' } | { t: 'gate'; choice: 'breakthrough' | 'pill' } | { t: 'grant'; id: string; amount: number }
  | { t: 'recipe'; id: string } | { t: 'bank' } | { t: 'discard' } | { t: 'end'; outcome: Exclude<RunOutcome, 'active'> };

const OUTCOMES = ['banked', 'died', 'abandoned', 'won'];
function encodeAction(a: RunAction): string {
  switch (a.t) {
    case 'gate': return `!gate|${a.choice}`;
    case 'grant': return `!grant|${encodeURIComponent(a.id)}|${a.amount}`;
    case 'recipe': return `!recipe|${encodeURIComponent(a.id)}`;
    case 'end': return `!end|${a.outcome}`;
    case 'advance': return '!advance';
    case 'bank': return '!bank';
    case 'discard': return '!discard';
  }
}
function decodeAction(part: string): RunAction {
  const [name, a, b] = part.slice(1).split('|');
  const id = (): string => { if (a === undefined) throw new Error('bad action'); return decodeURIComponent(a); };
  switch (name) {
    case 'advance': return { t: 'advance' };
    case 'bank': return { t: 'bank' };
    case 'discard': return { t: 'discard' };
    case 'recipe': return { t: 'recipe', id: id() };
    case 'gate': if (a === 'breakthrough' || a === 'pill') return { t: 'gate', choice: a }; break;
    case 'end': if (a && OUTCOMES.includes(a)) return { t: 'end', outcome: a as Exclude<RunOutcome, 'active'> }; break;
    case 'grant': { const n = Number(b); if (Number.isInteger(n) && n > 0) return { t: 'grant', id: id(), amount: n }; break; }
  }
  throw new Error('bad action');
}

/** Called after a room change so the room can be rebuilt (actors, hazards). Must be deterministic: the same hook runs in live play and replay. */
export type RoomHook = (world: WorldState, events: GameEvent[]) => void;

/** Apply a run action to the world. The single code path for live play and for resume. */
export function applyRunAction(world: WorldState, events: GameEvent[], a: RunAction, onRoom?: RoomHook): void {
  switch (a.t) {
    case 'advance': if (advanceRoom(world, events) === 'ok') onRoom?.(world, events); break;
    case 'gate': takeGate(world, a.choice, events); break;
    case 'grant': grantReward(world, a.id, a.amount, events); break;
    case 'recipe': learnRecipe(world, a.id); break;
    case 'bank': bankCarried(world, events); break;
    case 'discard': discardCarried(world); break;
    case 'end': endRun(world, a.outcome, events); break;
  }
}

/** Live play: apply the action, and only if it succeeded (did not throw) put it in the log. */
export function performRunAction(world: WorldState, events: GameEvent[], rec: InputRecorder, a: RunAction, onRoom?: RoomHook): void {
  applyRunAction(world, events, a, onRoom);
  rec.pushAction(a);
}

/** Walk the log in order: inputs (tick by tick) and actions. Returns the number of input ticks. */
export function forEachEntry(log: string, onInput: (i: InputFrame) => void, onAction: (a: RunAction) => void): number {
  if (log === '') return 0;
  let ticks = 0;
  for (const part of log.split(',')) {
    if (part.startsWith('!')) { onAction(decodeAction(part)); continue; }
    const [t, c] = part.split('*');
    if (!t || t.length !== 9) throw new Error('bad input log');
    const f = frameOf(t), count = c === undefined ? 1 : Number(c);
    if (!Number.isInteger(count) || count < 1) throw new Error('bad input log');
    for (let k = 0; k < count; k++) { onInput(f); ticks++; }
  }
  return ticks;
}

export function suspendRun(world: WorldState, rec: InputRecorder): SuspendedRun {
  return { seed: world.seed, ticks: rec.ticks, inputLog: rec.log(), stateHash: hashWorld(world) };
}

export type ResumeResult = { ok: true; world: WorldState; recorder: InputRecorder } | { ok: false; reason: 'bad-log' | 'diverged' };

/** Rebuild a world from a suspended run. `setup` must do exactly what the original did after createWorld (spawn the room, start the run); `onRoom` must be the hook live play used. */
export function resumeRun(s: SuspendedRun, setup: (w: WorldState, events: GameEvent[]) => void, onRoom?: RoomHook): ResumeResult {
  const world = createWorld(s.seed), events: GameEvent[] = [], recorder = new InputRecorder();
  setup(world, events);
  try {
    const ticks = forEachEntry(s.inputLog, (f) => { recorder.push(f); step(world, f, events); events.length = 0; },
      (a) => { applyRunAction(world, events, a, onRoom); recorder.pushAction(a); events.length = 0; });
    if (ticks !== s.ticks) return { ok: false, reason: 'bad-log' };
  } catch { return { ok: false, reason: 'bad-log' }; }
  return hashWorld(world) === s.stateHash ? { ok: true, world, recorder } : { ok: false, reason: 'diverged' };
}
