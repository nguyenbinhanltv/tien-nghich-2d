// Runs the REAL sim (contracts/host.ts Sim) for the vertical-slice fight and hands the renderer the world and the events of
// each tick. No gameplay lives here: input goes in, the sim decides. With content it walks the real floor (sim/run/floor.ts:
// rooms, waves, doors, the boss room); without it it runs the old boss-arena fight (kept for tests and a build without content).
import type { ContentApi } from '../contracts/content.ts';
import type { Sim } from '../contracts/host.ts';
import type { GameEvent, InputFrame, WorldState } from '../contracts/world.ts';
import { startGhostKingFight } from '../sim/loop.ts';
import { startFloor } from '../sim/run/floor.ts';
import { takeGate } from '../sim/run/run.ts';
import { createSim } from '../sim/sim.ts';

export const FIGHT_SEED = 20261123;

export class FightRunner {
  private sim: Sim;
  private readonly content: ContentApi | null;
  private readonly runId: number;
  /** Events of ticks since the last `drain()`. */
  private pending: GameEvent[] = [];

  constructor(seed = FIGHT_SEED, content: ContentApi | null = null, runId = 1) {
    this.content = content; this.runId = runId;
    this.sim = createSim({ seed, ...(content ? { content } : {}) });
    this.begin();
  }

  get world(): WorldState { return this.sim.world; }
  hash(): string { return this.sim.hash(); }

  /** (Re)start the Ghost King arena fight on a fresh world. */
  restart(seed = FIGHT_SEED): void { this.sim = createSim({ seed, ...(this.content ? { content: this.content } : {}) }); this.pending.length = 0; this.begin(); }
  private begin(): void {
    const ev: GameEvent[] = [];
    if (this.content) startFloor(this.sim.world, this.content, this.runId, ev); else startGhostKingFight(this.sim.world, ev);
    this.pending.push(...ev);
  }
  /** The realm-gate choice (cluster 2). The sim waits at the door until it is made; its events (realm-breakthrough, reward-gained) are queued. */
  takeGate(choice: 'breakthrough' | 'pill'): void {
    const ev: GameEvent[] = [];
    takeGate(this.sim.world, choice, ev);
    this.pending.push(...ev);
  }
  /** True when this runner walks the real floor (a run exists from the first tick; the shell must not attach another). */
  get hasFloor(): boolean { return this.content !== null; }

  tick(input: InputFrame): void { for (const e of this.sim.step(input)) this.pending.push(e); }

  /** Events since the last call (a copy; the runner's buffer is cleared). */
  drain(): GameEvent[] { const out = this.pending; this.pending = []; return out; }
}
