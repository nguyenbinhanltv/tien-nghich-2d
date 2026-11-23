// Deterministic scripted "bot" input, shared by the Node determinism test and the browser autopilot.
import { Rng } from "./rng.ts";
import { BTN_COUNTER, BTN_DODGE, type Input } from "./world.ts";

export class ScriptedInput {
  private r: Rng;
  private mx = 0;
  private my = 0;
  private hold = 0;
  private btnT = 0;
  private btn = 0;
  constructor(seed: number) {
    this.r = new Rng((seed ^ 0xa5a5a5a5) >>> 0);
  }
  /** Next tick's input. Call exactly once per tick, in order. */
  next(): Input {
    if (this.hold-- <= 0) {
      this.hold = 20 + this.r.int(60);
      const d = this.r.int(9);
      // 8 directions + stand still
      const ax = [0, 127, 90, 0, -90, -127, -90, 0, 90][d]!;
      const ay = [0, 0, 90, 127, 90, 0, -90, -127, -90][d]!;
      this.mx = ax;
      this.my = ay;
    }
    if (this.btnT-- <= 0) {
      this.btnT = 6 + this.r.int(40);
      const k = this.r.int(4);
      this.btn = k === 0 ? BTN_DODGE : k === 1 ? BTN_COUNTER : k === 2 ? BTN_COUNTER : 0;
    }
    return { mx: this.mx, my: this.my, btn: this.btn };
  }
}
