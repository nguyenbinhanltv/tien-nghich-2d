// Runs the REAL sim (contracts/host.ts Sim) for the vertical-slice fight and hands the renderer the world and the events of
// each tick. No gameplay lives here: input goes in, the sim decides. (Replaces the old demo stub.)
import type { Sim } from '../contracts/host.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { startGhostKingFight } from '../sim/loop.ts';
import { createSim } from '../sim/sim.ts';

export const FIGHT_SEED = 20261123;

export class FightRunner {
  private sim: Sim = createSim({ seed: FIGHT_SEED });
  /** Events of ticks since the last `drain()`. */
  private pending: GameEvent[] = [];

  constructor(seed = FIGHT_SEED) { this.sim = createSim({ seed }); this.begin(); }

  get world(): WorldState { return this.sim.world; }
  hash(): string { return this.sim.hash(); }

  /** (Re)start the Ghost King arena fight on a fresh world. */
  restart(seed = FIGHT_SEED): void { this.sim = createSim({ seed }); this.pending.length = 0; this.begin(); }
  private begin(): void { const ev: GameEvent[] = []; startGhostKingFight(this.sim.world, ev); this.pending.push(...ev); }

  tick(input: InputFrame): void { for (const e of this.sim.step(input)) this.pending.push(e); }

  /** Events since the last call (a copy; the runner's buffer is cleared). */
  drain(): GameEvent[] { const out = this.pending; this.pending = []; return out; }
}
