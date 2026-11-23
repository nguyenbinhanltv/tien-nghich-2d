// Fixed-step accumulator. The sim result depends on tick count only, never on frame pacing.
import { TICK_HZ } from "./world.ts";

export const STEP_MS = 1000 / TICK_HZ;
export const MAX_CATCHUP = 5; // ticks per frame, to avoid the spiral of death

export class Accumulator {
  acc = 0;
  dropped = 0;
  /** Returns how many sim ticks to run for this frame delta (ms). */
  consume(dtMs: number): number {
    this.acc += Math.min(dtMs, 250);
    let n = 0;
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      n++;
    }
    if (n > MAX_CATCHUP) {
      this.dropped += n - MAX_CATCHUP;
      n = MAX_CATCHUP;
    }
    return n;
  }
}
