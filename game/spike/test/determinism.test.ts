import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Accumulator } from "../src/sim/loop.ts";
import { ScriptedInput } from "../src/sim/script.ts";
import { MAX_PROJ, World, type Input } from "../src/sim/world.ts";

function run(seed: number, ticks: number, tweak?: (t: number, i: Input) => Input) {
  const w = new World(seed);
  const s = new ScriptedInput(seed);
  const marks: string[] = [];
  let peak = 0;
  for (let t = 1; t <= ticks; t++) {
    let inp = s.next();
    if (tweak) inp = tweak(t, inp);
    w.step(inp);
    w.clearEvents();
    peak = Math.max(peak, w.qlive);
    if (t % 600 === 0) marks.push(w.hash());
  }
  return { w, marks, hash: w.hash(), peak };
}

test("same seed + same inputs -> same hash after 3600 ticks (and at every 600-tick checkpoint)", () => {
  const a = run(1234, 3600);
  const b = run(1234, 3600);
  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.marks, b.marks);
  assert.equal(a.marks.length, 6);
});

test("golden hash is pinned (guards against accidental sim changes and engine drift)", () => {
  const a = run(1234, 3600);
  // Recorded on Node 24.12 / V8 (arm64); the browser autopilot test must report the same value.
  assert.equal(a.hash, GOLDEN_1234_3600);
});

test("different seed changes the state", () => {
  assert.notEqual(run(1234, 3600).hash, run(1235, 3600).hash);
});

test("different input sequence changes the state", () => {
  const base = run(7, 3600).hash;
  const other = run(7, 3600, (t, i) => (t === 1800 ? { ...i, mx: -i.mx || 127 } : i)).hash;
  assert.notEqual(base, other);
});

test("stress scene reaches the 400-projectile pool and stays within it", () => {
  const r = run(99, 1800);
  assert.equal(r.peak, MAX_PROJ);
  assert.ok(r.w.qlive <= MAX_PROJ);
});

test("frame pacing does not change the result (accumulator splits ticks differently, same hash)", () => {
  const ticks = 1200;
  const hashFor = (frameMs: () => number) => {
    const w = new World(5);
    const s = new ScriptedInput(5);
    const acc = new Accumulator();
    while (w.tick < ticks) {
      const n = acc.consume(frameMs());
      for (let i = 0; i < n && w.tick < ticks; i++) {
        w.step(s.next());
        w.clearEvents();
      }
    }
    return w.hash();
  };
  let k = 0;
  const jitter = [7, 33, 16.7, 50, 8, 8, 25];
  assert.equal(
    hashFor(() => 1000 / 60),
    hashFor(() => jitter[k++ % jitter.length]!),
  );
});

test("sim sources stay engine-free and deterministic (no Phaser/DOM/Math.random/Date/sin/cos)", () => {
  const dir = fileURLToPath(new URL("../src/sim/", import.meta.url));
  for (const f of readdirSync(dir)) {
    const src = readFileSync(dir + f, "utf8").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /phaser|document|window|Math\.random|Date\.now|performance\.now|Math\.(sin|cos|atan2|tan)\b/i, f);
  }
});

const GOLDEN_1234_3600 = "1383d13016cbf58e";
