// Data-driven boss runner (E5.1/E5.2, lane B): plays an encounter file (content/encounters/<id>.yaml, compiled to
// dist-content/encounters/<id>.json) with the same state machine as the reference port in systems/ghost-king.ts
// (stalk -> warn -> impact -> recover). The parity test drives both with the same script and requires equal worlds.
// The boss owns its hazard: it counts it down, records dashes through it and resolves it (as ghostKingStep does).
import { COMBAT } from '../../contracts/combat.ts';
import type { ActorState, GameEvent, WorldState } from '../../contracts/world.ts';
import { msToTicks } from '../../contracts/world.ts';
import { findPlayer } from '../actors.ts';
import { unitInto } from '../math.ts';
import { addHazard, markDodgedThrough, resolveHazard } from '../systems/telegraph.ts';

export interface EncounterAttack { clip: string; tell: { ms: number; sfx_event?: string; vfx?: string }; dodge_window_ms: number; strike_window_ms: number; hit: { id: string; damage: number } }
/** `enter_clip` is played by the renderer on the `phase-changed` event of this phase (see warn()); it does not change sim timing. */
export interface EncounterPhase { id: string; hp_above: number; enter_clip?: string; opener?: string; stalk_ms?: number; loop: string[] }
export interface Encounter { id: string; boss: string; phases: EncounterPhase[]; attacks: Record<string, EncounterAttack> }

/** What each `hit.id` of an encounter looks like on the ground (px). The shapes are the original's; damage comes from the file. */
export const HIT_SHAPES = {
  claw_strip: { kind: 'claw', radius: 17, length: 124, atPlayer: false },
  seal_disc: { kind: 'seal', radius: 32, length: 124, atPlayer: true },
  wail_ring: { kind: 'wail', radius: 103, length: 124, atPlayer: false },
} as const;
export type HitId = keyof typeof HIT_SHAPES;

const STALK_RANGE = 54;
const d = { x: 0, y: 0 };

/** The phase for the boss's current health: the first whose `hp_above` the health is still strictly above. */
export function phaseIndex(enc: Encounter, hp: number, hpMax: number): number {
  for (let i = 0; i < enc.phases.length; i++) if (hp > (enc.phases[i] as EncounterPhase).hp_above * hpMax) return i;
  return enc.phases.length - 1;
}

/** Problems in an encounter the runner cannot play (unknown hit shapes, attacks, bad windows). Empty when playable. */
export function encounterProblems(enc: Encounter): string[] {
  const p: string[] = [];
  for (const [name, a] of Object.entries(enc.attacks)) {
    if (!(a.hit.id in HIT_SHAPES)) p.push(`attack ${name}: unknown hit shape ${a.hit.id}`);
    if (a.tell.ms < 250) p.push(`attack ${name}: tell ${a.tell.ms} ms is under 250 ms`);
    if (msToTicks(a.dodge_window_ms) !== COMBAT.dodgeGuard) p.push(`attack ${name}: dodge window ${a.dodge_window_ms} ms is not the ${COMBAT.dodgeGuard}-tick guard`);
    if (msToTicks(a.strike_window_ms) !== COMBAT.counterWindow) p.push(`attack ${name}: strike window ${a.strike_window_ms} ms is not the ${COMBAT.counterWindow}-tick counter window`);
  }
  enc.phases.forEach((ph, i) => {
    for (const a of [...ph.loop, ...(ph.opener ? [ph.opener] : [])]) if (!(a in enc.attacks)) p.push(`phase ${ph.id}: unknown attack ${a}`);
    if (i > 0 && ph.hp_above >= (enc.phases[i - 1] as EncounterPhase).hp_above) p.push(`phase ${ph.id}: hp_above must fall from phase to phase`);
  });
  return p;
}

function warn(world: WorldState, b: ActorState, p: ActorState, enc: Encounter, events: GameEvent[]): void {
  unitInto(d, p.pos.x - b.pos.x, p.pos.y - b.pos.y);
  // At a shared ground point the sweep still needs a unit axis for both drawing and damage.
  if (d.x === 0 && d.y === 0) { if (b.facing === 'south') d.y = 1; else d.x = b.facing === 'west' ? -1 : 1; }
  const pi = phaseIndex(enc, b.hp, b.hpMax), phase = enc.phases[pi] as EncounterPhase;
  let name: string;
  if (pi > b.ai.data[1]) { // entering a new phase: tell the renderer/audio, then its opener (if any) plays once and does not advance the loop
    b.ai.data[1] = pi;
    // The renderer plays the phase's `enter_clip` when this event arrives (a short cinematic over the boss); the sim itself
    // keeps the attack timeline unchanged, which is what keeps tick parity with the reference port.
    events.push({ type: 'phase-changed', tick: world.tick, actor: b.id, phase: phase.id });
    name = phase.opener ?? phase.loop[b.ai.data[0]++ % phase.loop.length] as string;
  } else name = phase.loop[b.ai.data[0]++ % phase.loop.length] as string;
  const atk = enc.attacks[name] as EncounterAttack, shape = HIT_SHAPES[atk.hit.id as HitId];
  b.ai.state = 'warn';
  b.ai.timer = msToTicks(atk.tell.ms);
  b.facing = Math.abs(d.x) > 0.35 ? (d.x < 0 ? 'west' : 'east') : 'south';
  addHazard(world, {
    kind: shape.kind, owner: b.id, x: shape.atPlayer ? p.pos.x : b.pos.x, y: shape.atPlayer ? p.pos.y : b.pos.y, dirX: d.x, dirY: d.y,
    radius: shape.radius, length: shape.length, damage: atk.hit.damage, ticks: b.ai.timer,
  }, events);
  b.clip = atk.clip; b.clipStartTick = world.tick;
}

/** One tick of the boss while the fight is `playing` (after the player and shots moved). `speed` is px/s from bosses.csv. */
export function bossStep(world: WorldState, b: ActorState, enc: Encounter, speed: number, events: GameEvent[]): void {
  const p = findPlayer(world);
  if (!p || b.hp <= 0) return;
  const ai = b.ai, stalkSpeed = speed / 60;
  if (ai.data[2] === 0) ai.data[2] = b.hpMax;
  const h = world.hazards.find((x) => x.owner === b.id);
  if (ai.state === 'warn' && h) markDodgedThrough(h, p);
  // Falling into a later phase while stalking starts the next attack at once (the original does this at half health).
  if (ai.state === 'stalk' && phaseIndex(enc, ai.data[2], b.hpMax) < phaseIndex(enc, b.hp, b.hpMax)) ai.timer = 0;
  ai.timer--;
  if (h && ai.state === 'warn') h.timer = ai.timer;
  if (ai.state === 'stalk' || ai.state === 'idle') {
    if ((b.pos.x - p.pos.x) ** 2 + (b.pos.y - p.pos.y) ** 2 > STALK_RANGE * STALK_RANGE) {
      unitInto(d, p.pos.x - b.pos.x, p.pos.y - b.pos.y);
      b.pos.x += d.x * stalkSpeed; b.pos.y += d.y * stalkSpeed;
      b.facing = Math.abs(d.x) > 0.35 ? (d.x < 0 ? 'west' : 'east') : 'south';
    }
    if (ai.timer <= 0) warn(world, b, p, enc, events);
  } else if (ai.state === 'warn' && ai.timer <= 0 && h) {
    ai.state = 'impact'; ai.timer = COMBAT.bossImpact;
    resolveHazard(world, h, p, events);
  } else if (ai.state === 'impact' && ai.timer <= 0) {
    world.hazards.length = 0;
    ai.state = 'recover'; ai.timer = COMBAT.bossRecovery;
  } else if (ai.state === 'recover' && ai.timer <= 0) {
    const phase = enc.phases[phaseIndex(enc, b.hp, b.hpMax)] as EncounterPhase;
    ai.state = 'stalk'; ai.timer = msToTicks(phase.stalk_ms ?? 1000);
  }
  ai.data[2] = b.hp;
}
