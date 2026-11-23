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
  // Pinned by name: a new missing cue (or a planned one that gets delivered) changes this list and must be reviewed.
  assert.deepEqual([...missing].sort(), EXPECTED_MISSING);
});

// 4 planned SFX cues (no pack yet) + 7 BGM ids (BGM lives in separate files, not in the SFX sprite cue tables).
const EXPECTED_MISSING = [
  "bgm_ancient_god", "bgm_blood_sea", "bgm_dong_phu", "bgm_ember_delta", "bgm_hengyue", "bgm_mist_archive", "bgm_star_quarry",
  "sfx_core_crack", "sfx_form_shift", "sfx_keeper_call", "sfx_pet_reply",
];
