// Stress-scene benchmark. Usage: node tools/bench.mjs [seconds=12]
// Needs `npx vite build` first. Writes results/bench.json and screenshots to $TN2D_SHOTS (default /tmp).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromiumPath, loadPlaywright, spikeDir, startVite } from "./lib.mjs";

const secs = Number(process.argv[2] ?? 12);
const shots = process.env.TN2D_SHOTS ?? "/tmp";
const { chromium } = loadPlaywright();
const srv = await startVite("preview");
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const matrix = [
  { name: "desktop 1280x800 (no throttle)", viewport: { width: 1280, height: 800 }, dpr: 2, mobile: false, cpu: 1 },
  { name: "mobile 390x844 dpr3, CPU x1", viewport: { width: 390, height: 844 }, dpr: 3, mobile: true, cpu: 1 },
  { name: "mobile 390x844 dpr3, CPU x4", viewport: { width: 390, height: 844 }, dpr: 3, mobile: true, cpu: 4 },
  { name: "mobile 390x844 dpr3, CPU x6", viewport: { width: 390, height: 844 }, dpr: 3, mobile: true, cpu: 6 },
];
const out = { when: new Date().toISOString(), chromium: browser.version(), seconds: secs, runs: [] };
for (const m of matrix) {
  const ctx = await browser.newContext({ viewport: m.viewport, deviceScaleFactor: m.dpr, isMobile: m.mobile, hasTouch: m.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: m.cpu });
  await page.goto(`${srv.url}?auto=1&seed=1&hud=0`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForTimeout(2500); // warm-up (JIT, first projectiles)
  await page.evaluate(() => __spike.stats(true));
  await page.waitForTimeout(secs * 1000);
  const stats = await page.evaluate(() => __spike.stats(false));
  const info = await page.evaluate(() => ({ r: __spike.rendererType(), c: __spike.counts() }));
  await page.screenshot({ path: join(shots, `bench-${m.cpu}x-${m.mobile ? "mobile" : "desktop"}.png`) });
  out.runs.push({ ...m, stats, gpu: info.r.gpu, counts: info.c, errors });
  console.log(m.name, JSON.stringify({ fps: stats.fpsAvg, frameMs: stats.frameMs, over20: stats.over20ms, over33: stats.over33ms, simTick: stats.simMsPerTick, cpuFrame: stats.cpuFrameMs, dropped: stats.droppedTicks, proj: stats.liveProj }));
  await ctx.close();
}
writeFileSync(join(spikeDir, "results/bench.json"), JSON.stringify(out, null, 2));
await browser.close();
srv.stop();
