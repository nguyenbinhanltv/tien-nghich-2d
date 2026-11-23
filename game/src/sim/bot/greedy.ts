// The "greedy dodger" bot (plan E4.3): it attacks whenever it can and only dodges when a telegraph is about to land on it.
// It reads the world like a player reads the screen (hazards, positions, cooldowns) and writes an InputFrame; its only
// randomness is its own seeded Rng (reaction time and the odd miss), so a run is reproducible.
import type { Hazard } from '../../contracts/combat.ts';
import type { ContentApi } from '../../contracts/content.ts';
import type { GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { findPlayer, nearestHostile } from '../actors.ts';
import { createWorld, NO_INPUT, step } from '../loop.ts';
import { dist, unitInto } from '../math.ts';
import { Rng } from '../rng.ts';
import { enterRoom, startFloor } from '../run/floor.ts';
import { hazardIncoming } from '../systems/telegraph.ts';

export interface BotSkill {
  /** Chance (0..1) that the bot notices a given telegraph in time; the rest of the time it just takes the hit. */
  notice: number;
  /** The bot dashes when the telegraph has this many ticks (inclusive range) left. */
  reactMin: number; reactMax: number;
  /** Preferred distance to the target while it strikes (px). */
  range: number;
}
/** Placeholder skill of a competent but not perfect player. */
export const GREEDY: BotSkill = { notice: 0.8, reactMin: 4, reactMax: 15, range: 80 };

const u = { x: 0, y: 0 };

/** Direction that takes the player out of a hazard's danger area. */
function escapeDir(h: Hazard, px: number, py: number): { x: number; y: number } {
  if (h.kind === 'wail') return { x: h.wedge.x, y: h.wedge.y }; // the open wedge is the safe place
  if (h.kind === 'claw') { // sidestep across the strip, to the side the player is already on
    const side = (px - h.x) * h.dir.y - (py - h.y) * h.dir.x;
    return side >= 0 ? { x: h.dir.y, y: -h.dir.x } : { x: -h.dir.y, y: h.dir.x };
  }
  unitInto(u, px - h.x, py - h.y); // discs: straight out
  return u.x === 0 && u.y === 0 ? { x: 1, y: 0 } : { x: u.x, y: u.y };
}

export class GreedyBot {
  private readonly rng: Rng;
  /** Hazards already decided on: id -> dash when its timer reaches this (or -1 = not noticed). */
  private readonly plan = new Map<number, number>();
  private readonly skill: BotSkill;
  constructor(seed: number, skill: BotSkill = GREEDY) { this.skill = skill; this.rng = new Rng(seed ^ 0x9e3779b9); }

  act(world: WorldState): InputFrame {
    const p = findPlayer(world);
    if (!p || world.mode !== 'playing') return NO_INPUT;
    const c = p.combat, s = this.skill;
    let dash = false, move = { x: 0, y: 0 };
    // 1. Dodge: the most urgent telegraph that would hit the player.
    let urgent: Hazard | null = null;
    for (const h of world.hazards) {
      if (!this.plan.has(h.id)) this.plan.set(h.id, this.rng.next() < s.notice ? this.rng.int(s.reactMin, s.reactMax) : -1);
      const when = this.plan.get(h.id) as number;
      if (when >= 0 && h.timer <= when && hazardIncoming(h, p.pos.x, p.pos.y) && (!urgent || h.timer < urgent.timer)) urgent = h;
    }
    if (urgent && c.cool === 0 && c.dash === 0) { dash = true; move = escapeDir(urgent, p.pos.x, p.pos.y); }
    else if (urgent === null || c.dash > 0) {
      // 2. Fight: close to striking range of the nearest enemy, back off when too close, strike whenever ready.
      const t = nearestHostile(world, p.pos.x, p.pos.y);
      if (t) {
        const d = dist(p.pos.x, p.pos.y, t.pos.x, t.pos.y);
        unitInto(u, t.pos.x - p.pos.x, t.pos.y - p.pos.y);
        if (d > s.range + 10) move = { x: u.x, y: u.y }; else if (d < s.range - 25) move = { x: -u.x, y: -u.y };
      }
    }
    if (this.plan.size > 64) for (const id of this.plan.keys()) if (!world.hazards.some((h) => h.id === id)) this.plan.delete(id);
    return { move, aim: null, dash, fire: c.counterWindow > 0 || (c.action === 0 && c.slash === 0 && !dash) };
  }
}

export type FightOutcome = 'won' | 'lost' | 'timeout';
export interface FightResult { outcome: FightOutcome; ticks: number; hitsTaken: number; dodges: number; counters: number; bossHpLeft: number }

/** Player (full hp) in the boss room against the real encounter. Gives up after `maxTicks` (default two minutes). */
export function runBossFight(seed: number, content: ContentApi, skill: BotSkill = GREEDY, maxTicks = 60 * 120): FightResult {
  const w = createWorld(seed), ev: GameEvent[] = [];
  startFloor(w, content, 1, ev);
  enterRoom(w, content, 'room_bs_boss', ev);
  const bot = new GreedyBot(seed, skill), ctx = { content };
  let t = 0;
  for (; t < maxTicks && (w.mode === 'playing' || w.mode === 'falling' || w.mode === 'releasing'); t++) { ev.length = 0; step(w, bot.act(w), ev, ctx); }
  const boss = w.actors.find((a) => a.role === 'boss');
  return { outcome: w.mode === 'won' ? 'won' : w.mode === 'lost' ? 'lost' : 'timeout', ticks: t, hitsTaken: w.stats.hitsTaken, dodges: w.stats.dodges, counters: w.stats.counters, bossHpLeft: boss?.hp ?? 0 };
}

export interface WinRate { seeds: number; won: number; lost: number; timeout: number; rate: number; medianTicks: number }
export function winRate(content: ContentApi, seeds: number, skill: BotSkill = GREEDY, first = 1): WinRate {
  const r = { seeds, won: 0, lost: 0, timeout: 0, rate: 0, medianTicks: 0 }, ticks: number[] = [];
  for (let s = first; s < first + seeds; s++) { const f = runBossFight(s, content, skill); r[f.outcome]++; ticks.push(f.ticks); }
  ticks.sort((a, b) => a - b);
  r.rate = r.won / seeds; r.medianTicks = ticks[Math.floor(ticks.length / 2)] ?? 0;
  return r;
}
