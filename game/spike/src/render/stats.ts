import type { Accumulator } from "../sim/loop.ts";
import type { World } from "../sim/world.ts";

function pct(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export class Stats {
  private last = 0;
  dt: number[] = [];
  sim: number[] = [];
  cpu: number[] = []; // update start -> postrender (JS main-thread cost of a frame)
  render: number[] = [];
  ticks = 0;
  private cpuStart = 0;
  private rStart = 0;
  lat: Record<string, { sim: number[]; frame: number[] }> = {};

  frameStart(now: number, deltaMs: number): void {
    this.cpuStart = now;
    if (this.last) this.dt.push(now - this.last);
    this.last = now;
    void deltaMs;
  }
  simDone(ms: number, n: number): void {
    this.sim.push(n ? ms / n : 0);
    this.ticks += n;
  }
  renderStart(): void {
    this.rStart = performance.now();
  }
  renderEnd(): void {
    const n = performance.now();
    this.render.push(n - this.rStart);
    this.cpu.push(n - this.cpuStart);
  }
  private lastSrc = "key";
  latencySim(src: string, ms: number): void {
    this.lastSrc = src;
    (this.lat[src] ??= { sim: [], frame: [] }).sim.push(ms);
  }
  latencyFrame(ms: number): void {
    (this.lat[this.lastSrc] ??= { sim: [], frame: [] }).frame.push(ms);
  }

  snapshot(reset: boolean, w: World, acc: Accumulator) {
    const dt = this.dt;
    const total = dt.reduce((a, b) => a + b, 0);
    const out = {
      frames: dt.length,
      fpsAvg: r2(dt.length / (total / 1000 || 1)),
      frameMs: { p50: r2(pct(dt, 50)), p95: r2(pct(dt, 95)), p99: r2(pct(dt, 99)), max: r2(Math.max(0, ...dt)) },
      over20ms: dt.filter((x) => x > 20).length,
      over33ms: dt.filter((x) => x > 33.4).length,
      simMsPerTick: { p50: r2(pct(this.sim, 50) * 1000) / 1000, p95: r2(pct(this.sim, 95) * 1000) / 1000, max: r2(Math.max(0, ...this.sim) * 1000) / 1000 },
      renderSubmitMs: { p50: r2(pct(this.render, 50)), p95: r2(pct(this.render, 95)), max: r2(Math.max(0, ...this.render)) },
      cpuFrameMs: { p50: r2(pct(this.cpu, 50)), p95: r2(pct(this.cpu, 95)), max: r2(Math.max(0, ...this.cpu)) },
      ticks: this.ticks,
      droppedTicks: acc.dropped,
      liveProj: w.qlive,
      latency: Object.fromEntries(
        Object.entries(this.lat).map(([k, v]) => [
          k,
          { n: v.sim.length, simMs: { p50: r2(pct(v.sim, 50)), p95: r2(pct(v.sim, 95)), max: r2(Math.max(0, ...v.sim)) }, frameMs: { p50: r2(pct(v.frame, 50)), p95: r2(pct(v.frame, 95)), max: r2(Math.max(0, ...v.frame)) } },
        ]),
      ),
    };
    if (reset) {
      this.dt = [];
      this.sim = [];
      this.cpu = [];
      this.render = [];
      this.ticks = 0;
      this.lat = {};
      acc.dropped = 0;
    }
    return out;
  }
}
