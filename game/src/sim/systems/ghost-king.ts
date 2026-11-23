// Reference port of the Drowned Court boss script (playables/blood-sea/combat.mjs: stalk -> warn -> impact -> recover,
// claw/seal/wail cycle, wail awakening at half health). The data-driven Oan Hon Quy Vuong (E4.3, lane B) must match this.
import { COMBAT } from '../../contracts/combat.ts';
import type { ActorState, GameEvent, WorldState } from '../../contracts/world.ts';
import { findPlayer } from '../actors.ts';
import { unitInto } from '../math.ts';
import { addHazard, markDodgedThrough, resolveHazard } from './telegraph.ts';

const STALK_SPEED = 29 / 60, STALK_RANGE = 54;
const KINDS = ['claw', 'seal', 'wail'] as const;
const d = { x: 0, y: 0 };

export const BOSS_SCRIPT = 'boss_ghost_king';

function warn(world: WorldState, b: ActorState, p: ActorState, events: GameEvent[]): void {
  unitInto(d, p.pos.x - b.pos.x, p.pos.y - b.pos.y);
  // At a shared ground point the sweep still needs a unit axis for both drawing and damage.
  if (d.x === 0 && d.y === 0) { if (b.facing === 'south') d.y = 1; else d.x = b.facing === 'west' ? -1 : 1; }
  const half = b.hpMax / 2, low = b.hp <= half;
  const awakening = low && b.ai.data[1] === 0;
  let kind: (typeof KINDS)[number];
  if (awakening) { b.ai.data[1] = 1; kind = 'wail'; events.push({ type: 'phase-changed', tick: world.tick, actor: b.id, phase: 'awakened' }); }
  else { const cycle = low ? 3 : 2; kind = KINDS[b.ai.data[0] % cycle] as (typeof KINDS)[number]; b.ai.data[0]++; }
  b.ai.state = 'warn';
  b.ai.timer = kind === 'wail' ? COMBAT.wailCall + COMBAT.dodgeGuard : COMBAT.clawWarning;
  b.facing = Math.abs(d.x) > 0.35 ? (d.x < 0 ? 'west' : 'east') : 'south';
  const seal = kind === 'seal';
  addHazard(world, {
    kind, owner: b.id, x: seal ? p.pos.x : b.pos.x, y: seal ? p.pos.y : b.pos.y, dirX: d.x, dirY: d.y,
    radius: seal ? 32 : kind === 'wail' ? 103 : 17, length: 124, damage: kind === 'wail' ? 2 : 1, ticks: b.ai.timer,
  }, events);
  b.clip = 'attack_' + kind; b.clipStartTick = world.tick;
}

/** Called once per tick while the fight is `playing` (after the player and shots moved). */
export function ghostKingStep(world: WorldState, b: ActorState, events: GameEvent[]): void {
  const p = findPlayer(world);
  if (!p || b.hp <= 0) return;
  const ai = b.ai;
  if (ai.data[2] === 0) ai.data[2] = b.hpMax;
  const h = world.hazards.find((x) => x.owner === b.id);
  if (ai.state === 'warn' && h) markDodgedThrough(h, p);
  // Crossing half health while stalking schedules the wail at once (the original sets the timer to 0 inside the hit).
  if (ai.state === 'stalk' && ai.data[2] > b.hpMax / 2 && b.hp <= b.hpMax / 2) ai.timer = 0;
  ai.timer--;
  if (h && ai.state === 'warn') h.timer = ai.timer;
  const low = b.hp <= b.hpMax / 2;
  if (ai.state === 'stalk' || ai.state === 'idle') {
    if ((b.pos.x - p.pos.x) ** 2 + (b.pos.y - p.pos.y) ** 2 > STALK_RANGE * STALK_RANGE) {
      unitInto(d, p.pos.x - b.pos.x, p.pos.y - b.pos.y);
      b.pos.x += d.x * STALK_SPEED; b.pos.y += d.y * STALK_SPEED;
      b.facing = Math.abs(d.x) > 0.35 ? (d.x < 0 ? 'west' : 'east') : 'south';
    }
    if (ai.timer <= 0) warn(world, b, p, events);
  } else if (ai.state === 'warn' && ai.timer <= 0 && h) {
    ai.state = 'impact'; ai.timer = COMBAT.bossImpact;
    resolveHazard(world, h, p, events);
  } else if (ai.state === 'impact' && ai.timer <= 0) {
    world.hazards.length = 0;
    ai.state = 'recover'; ai.timer = COMBAT.bossRecovery;
  } else if (ai.state === 'recover' && ai.timer <= 0) {
    ai.state = 'stalk'; ai.timer = low ? 39 : 60; /* .65 s / 1.0 s */
  }
  ai.data[2] = b.hp;
}
