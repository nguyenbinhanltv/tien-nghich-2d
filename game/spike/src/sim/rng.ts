// Seeded RNG for the simulation. Only integer ops + one division: bit-identical on every JS engine.
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** mulberry32, returns uint32 */
  u32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** float in [0,1) */
  next(): number {
    return this.u32() / 4294967296;
  }
  int(n: number): number {
    return this.u32() % n;
  }
}
