// Hot reload: change one frame of an atlas page on disk -> the running game picks it up, without losing sim state.
// Runs against a temp COPY of assets/ (TN2D_ASSETS_DIR), never the real atlas. Usage: node tools/hot.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumPath, loadPlaywright, pct, spikeDir, startVite } from "./lib.mjs";
import { ScriptedInput } from "../src/sim/script.ts";
import { World } from "../src/sim/world.ts";

const repo = join(spikeDir, "../..");
const tmp = mkdtempSync(join(tmpdir(), "tn2d-hot-"));
cpSync(join(repo, "assets/atlases/mobile"), join(tmp, "atlases/mobile"), { recursive: true });
cpSync(join(repo, "assets/audio_manifest.json"), join(tmp, "audio_manifest.json"));
cpSync(join(repo, "assets/audio/packs"), join(tmp, "audio/packs"), { recursive: true });
const png = join(tmp, "atlases/mobile/atlas-5.png");
const json = join(tmp, "atlases/mobile/atlas-5.json");
const KEY = "vfx/hit_spark_0";
const py = join(repo, "tools/.venvs/project/bin/python");

// reference hash from the pure sim in Node (no browser involved)
const REF_TICK = 900;
const w = new World(1);
const s = new ScriptedInput(1);
for (let i = 0; i < REF_TICK; i++) { w.step(s.next()); w.clearEvents(); }
const refHash = w.hash();

const { chromium } = loadPlaywright();
const srv = await startVite("dev", { TN2D_ASSETS_DIR: tmp });
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${srv.url}?auto=1&seed=1&hud=0`);
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
await page.evaluate((n) => __spike.watchTick(n), REF_TICK);

const colors = [[0, 255, 0], [0, 128, 255], [255, 0, 255], [255, 255, 0], [0, 255, 255]];
const runs = [];
// first opaque pixel of the frame, found in the running game before any change
const px = await page.evaluate(() => { for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const c = __spike.texturePixel(5, "vfx/hit_spark_0", x, y); if (c && c[3]) return [x, y]; } return null; });
let pixelPrev = await page.evaluate(([x, y]) => __spike.texturePixel(5, "vfx/hit_spark_0", x, y), px);
for (const [r, g, b] of colors) {
  const tickBefore = await page.evaluate(() => __spike.tick);
  const out = spawnSync(py, ["-I", join(spikeDir, "tools/recolor_frame.py"), png, json, KEY, r, g, b], { encoding: "utf8" }).stdout.trim().split(" ").map(Number);
  const tWritten = out[2]; // epoch ms printed by python right after the png was saved
  writeFileSync(json, readFileSync(json)); // Kiln rewrites the json next to the png
  // done when the running game reports the NEW colour for that pixel (extra reloads from partial writes are tolerated)
  await page.waitForFunction(([x, y, c]) => { const p = __spike.texturePixel(5, "vfx/hit_spark_0", x, y); return p && p[0] === c[0] && p[1] === c[1] && p[2] === c[2] && __spike.hot().lastVisibleAt > 0; }, [px[0], px[1], [r, g, b]], { timeout: 8000, polling: 5 });
  const hot = await page.evaluate(() => __spike.hot());
  const pixelAfter = await page.evaluate(([x, y]) => __spike.texturePixel(5, "vfx/hit_spark_0", x, y), px);
  const tickAfter = await page.evaluate(() => __spike.tick);
  runs.push({ color: [r, g, b], writeToApplied: hot.lastDoneAt - tWritten, writeToVisible: hot.lastVisibleAt - tWritten, reloadMs: Math.round(hot.lastMs), pixelBefore: pixelPrev, pixelAfter, changed: JSON.stringify(pixelPrev) !== JSON.stringify(pixelAfter), tickBefore, tickAfter });
  pixelPrev = pixelAfter;
  await page.waitForTimeout(400);
}
await page.waitForFunction((n) => __spike.tick > n + 5, REF_TICK, { timeout: 30000 });
const hashInPage = await page.evaluate((n) => __spike.hashAt(n), REF_TICK);
const out = {
  when: new Date().toISOString(),
  reloads: runs,
  writeToVisibleMs: { p50: pct(runs.map((r) => r.writeToVisible), 50), max: Math.max(...runs.map((r) => r.writeToVisible)) },
  allPixelsChanged: runs.every((r) => r.changed),
  simStateKept: { refTick: REF_TICK, nodeHash: refHash, pageHash: hashInPage, equal: refHash === hashInPage },
  errors,
};
writeFileSync(join(spikeDir, "results/hot.json"), JSON.stringify(out, null, 2));
await page.screenshot({ path: join(process.env.TN2D_SHOTS ?? "/tmp", "hot-after.png") });
console.log(JSON.stringify(out, null, 1));
await browser.close();
srv.stop();
rmSync(tmp, { recursive: true, force: true });
