// Touch / keyboard / mouse / gamepad latency + Web Audio unlock and latency. Usage: node tools/input-audio.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromiumPath, loadPlaywright, pct, spikeDir, startVite } from "./lib.mjs";

const { chromium } = loadPlaywright();
const srv = await startVite("preview");
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ["--autoplay-policy=document-user-activation-required"] });
const result = { when: new Date().toISOString(), chromium: browser.version(), runs: [] };
const r2 = (n) => Math.round(n * 100) / 100;

for (const cpu of [1, 4]) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    // Mock gamepad: no physical controller was available. window.__pad drives it.
    window.__pad = { connected: true, id: "mock", index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), timestamp: 0 };
    navigator.getGamepads = () => [window.__padOn ? window.__pad : null];
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.goto(`${srv.url}?hud=0&seed=3`);
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const audioBefore = await page.evaluate(() => ({ ctx: !!__spike.audio().ctx, ...__spike.audioStats() }));
  const box = async (sel) => (await page.locator(sel).boundingBox());
  const dodge = await box(".tc .dodge");
  const counter = await box(".tc .counter");
  const zone = await box(".tc .zone");
  const cx = (b) => b.x + b.width / 2;
  const cy = (b) => b.y + b.height / 2;
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  await page.evaluate(() => __spike.stats(true));

  // --- touch: first tap unlocks audio (the dodge button), then 30 alternating taps, with joystick held in a second finger
  const tTapStart = Date.now();
  await touch("touchStart", [{ x: cx(dodge), y: cy(dodge), id: 1 }]);
  await touch("touchEnd", []);
  await page.waitForFunction(() => __spike.audioStats().unlockMs !== null, null, { timeout: 5000 });
  const audioAfterUnlock = await page.evaluate(() => __spike.audioStats());
  // joystick: drag right 40 px, verify the player moves
  const p0 = await page.evaluate(() => __spike.player());
  await touch("touchStart", [{ x: zone.x + 80, y: zone.y + zone.height * 0.6, id: 2 }]);
  await touch("touchMove", [{ x: zone.x + 80 + 40, y: zone.y + zone.height * 0.6, id: 2 }]);
  await page.waitForTimeout(600);
  const p1 = await page.evaluate(() => __spike.player());
  for (let i = 0; i < 30; i++) {
    const b = i % 2 ? dodge : counter;
    await touch("touchStart", [{ x: zone.x + 120, y: zone.y + zone.height * 0.6, id: 2 }, { x: cx(b), y: cy(b), id: 3 }]);
    await page.waitForTimeout(40);
    await touch("touchEnd", [{ x: cx(b), y: cy(b), id: 3 }]); // CDP touchEnd: touchPoints = the points being lifted
    await page.waitForTimeout(260); // exceed the cooldowns
  }
  await touch("touchEnd", []);
  const touchStats = await page.evaluate(() => __spike.stats(true));

  // --- keyboard + mouse
  for (let i = 0; i < 20; i++) {
    await page.keyboard.down(i % 2 ? "Space" : "KeyJ");
    await page.waitForTimeout(30);
    await page.keyboard.up(i % 2 ? "Space" : "KeyJ");
    await page.waitForTimeout(260);
  }
  const keyStats = await page.evaluate(() => __spike.stats(true));
  const cvs = await box("#game");
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(cvs.x + cvs.width * 0.5, cvs.y + cvs.height * 0.5, { button: i % 2 ? "right" : "left" });
    await page.waitForTimeout(300);
  }
  const mouseStats = await page.evaluate(() => __spike.stats(true));

  // --- gamepad (mock): stick right then press A / X
  await page.evaluate(() => { __padOn = true; __pad.axes = [-1, 0, 0, 0]; });
  const g0 = await page.evaluate(() => __spike.player());
  await page.waitForTimeout(500);
  const g1 = await page.evaluate(() => __spike.player());
  for (let i = 0; i < 20; i++) {
    const idx = i % 2 ? 0 : 2;
    await page.evaluate((k) => { __pad.buttons[k].pressed = true; }, idx);
    await page.waitForTimeout(60);
    await page.evaluate((k) => { __pad.buttons[k].pressed = false; }, idx);
    await page.waitForTimeout(260);
  }
  await page.evaluate(() => { __pad.axes = [0, 0, 0, 0]; });
  const padStats = await page.evaluate(() => __spike.stats(true));
  const hub = await page.evaluate(() => __spike.hubInfo());

  // --- audio after unlock: 60 emits through the semantic API
  const audio = await page.evaluate(async () => {
    const a = __spike.audio();
    for (let i = 0; i < 120 && a.buffers.size < 6; i++) await new Promise((r) => setTimeout(r, 50));
    const ok = [];
    for (const [ev, asset] of [["release", "wp_soul_banner"], ["tell", "boss_ghost_king"], ["impact", "mob_blood_wolf"], ["release", "lt_reed_verdict"]]) {
      ok.push([ev, asset, a.emit(ev, asset)]);
    }
    for (let i = 0; i < 60; i++) { a.emit("impact", "mob_blood_wolf"); await new Promise((r) => setTimeout(r, 20)); }
    const t0 = performance.now();
    await a.playBgm();
    return { ok, bgmStartMs: performance.now() - t0, state: a.ctx.state, sampleRate: a.ctx.sampleRate, buffers: a.buffers.size };
  });
  const audioFinal = await page.evaluate(() => __spike.audioStats());
  const emit = audioFinal.emitToStartUs;
  const lat = (s) => Object.fromEntries(Object.entries(s.latency).map(([k, v]) => [k, v]));
  result.runs.push({
    cpuThrottle: cpu,
    audioBeforeGesture: { contextCreated: audioBefore.ctx },
    audioUnlock: { unlockMs: r2(audioAfterUnlock.unlockMs), baseLatencyMs: r2(audioAfterUnlock.baseLatencyMs), outputLatencyMs: r2(audioAfterUnlock.outputLatencyMs), state: audioAfterUnlock.state },
    audio: { codec: audioFinal.codec, loadMs: r2(audioFinal.loadMs), cues: audioFinal.cues, missingFamilyCues: audioFinal.missingFamilyCues, sfxBytes: audioFinal.bytes, emitToStartUs: { n: emit.length, p50: pct(emit, 50), p95: pct(emit, 95), max: Math.max(...emit) }, ...audio },
    joystick: { moved: r2(p1.x - p0.x) },
    gamepad: { movedLeft: r2(g0.x - g1.x), padSeen: hub.padSeen },
    touch: lat(touchStats),
    keyboard: lat(keyStats),
    mouse: lat(mouseStats),
    pad: lat(padStats),
    errors,
  });
  console.log("cpu", cpu, JSON.stringify({ unlock: result.runs.at(-1).audioUnlock, touch: touchStats.latency, key: keyStats.latency, mouse: mouseStats.latency, pad: padStats.latency, joy: result.runs.at(-1).joystick, gp: result.runs.at(-1).gamepad, emit: result.runs.at(-1).audio.emitToStartUs, miss: audioFinal.missingFamilyCues.length, errors }));
  await ctx.close();
}
writeFileSync(join(spikeDir, "results/input-audio.json"), JSON.stringify(result, null, 2));
await browser.close();
srv.stop();
