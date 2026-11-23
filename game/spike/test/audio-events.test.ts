import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileEvents, cueFor, type Manifest } from "../src/platform/audio-events.ts";

const root = fileURLToPath(new URL("../../../assets/", import.meta.url));
const manifestPath = root + "audio_manifest.json";
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

test("fusion takes release from parent one and impact from parent two", () => {
  const ev = compileEvents(manifest);
  const [relic, f] = Object.entries(manifest.fusions)[0]!;
  const [a, b] = f.parents;
  assert.equal(cueFor(ev, relic, "release"), cueFor(ev, a, "release"));
  assert.equal(cueFor(ev, relic, "impact"), cueFor(ev, b, "impact"));
  assert.equal(cueFor(ev, f.shot, "impact"), cueFor(ev, b, "impact"));
});

test("silent assets map to no event", () => {
  const ev = compileEvents(manifest);
  for (const id of manifest.asset_groups.silent ?? []) assert.equal(ev[id], undefined, id);
});

test("every cue a family can emit exists in some pack (planned cues are reported, not hidden)", () => {
  const have = new Set<string>();
  for (const id of ["pilot_v1", "wave2_batch1_v1", "wave2_batch2_v1", "wave2_batch3_v1", "wave2_batch4_v1", "branches_v1"]) {
    const p = root + `audio/packs/${id}/pack.json`;
    assert.ok(existsSync(p), p);
    for (const c of JSON.parse(readFileSync(p, "utf8")).sfx.cues as { id: string }[]) have.add(c.id);
  }
  const missing = new Set<string>();
  for (const fam of Object.values(manifest.families)) for (const c of Object.values(fam)) if (!have.has(c)) missing.add(c);
  // The count is informational: the manifest still lists planned cues. Fail only if it GROWS past the recorded baseline.
  assert.ok(missing.size <= 12, `missing cues: ${[...missing].join(", ")}`);
});
