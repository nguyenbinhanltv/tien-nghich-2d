// PWA check: first-load size, service worker, offline reload. Usage: node tools/pwa.mjs  (needs a fresh `vite build`)
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { chromiumPath, loadPlaywright, spikeDir, startVite } from "./lib.mjs";

const dist = join(spikeDir, "dist");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const kind = (f) => (f.startsWith("assets/atlases") ? "atlas" : f.startsWith("assets/audio/") ? "audio" : f.endsWith(".js") ? "js" : "shell");
const disk = {};
for (const f of walk(dist)) {
  const rel = relative(dist, f).split(sep).join("/");
  const buf = readFileSync(f);
  const k = kind(rel);
  const gz = /\.(js|json|html|webmanifest)$/.test(rel) ? gzipSync(buf, { level: 9 }).length : buf.length; // png/ogg/m4a are already compressed
  disk[k] ??= { files: 0, raw: 0, gzip: 0 };
  disk[k].files++; disk[k].raw += buf.length; disk[k].gzip += gz;
}
const { chromium } = loadPlaywright();
const srv = await startVite("preview");
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const reqs = new Map();
cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, fromSW: e.response.fromServiceWorker }));
cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
const t0 = Date.now();
await page.goto(`${srv.url}?hud=0&auto=1`);
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
const readyMs = Date.now() - t0;
await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated", null, { timeout: 15000 });
await page.waitForTimeout(1500);
const cold = { atlas: 0, audio: 0, js: 0, shell: 0, total: 0, requests: reqs.size };
for (const r of reqs.values()) {
  const rel = r.url.replace(srv.url, "");
  const k = kind(rel.split("?")[0]);
  cold[k] += r.bytes ?? 0; cold.total += r.bytes ?? 0;
}
const cacheInfo = await page.evaluate(async () => {
  const names = await caches.keys();
  const c = await caches.open(names[0]);
  const keys = await c.keys();
  return { names, entries: keys.length, audio: keys.filter((k) => k.url.includes("/audio/")).length, atlas: keys.filter((k) => k.url.includes("atlas-")).length };
});
const manifest = await page.evaluate(async () => (await (await fetch("./manifest.webmanifest")).json()).display);
// offline reload through the service worker
await ctx.setOffline(true);
reqs.clear();
page.on("console", (m) => console.log("console", m.type(), m.text().slice(0, 160)));
page.on("requestfailed", (r) => console.log("FAILED", r.url()));
const t1 = Date.now();
await page.reload();
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 30000 });
const offlineReadyMs = Date.now() - t1;
await page.waitForTimeout(2000);
const offline = await page.evaluate(() => ({ stats: __spike.stats(false), audioCues: __spike.audioStats().cues }));
const fromSW = [...reqs.values()].filter((r) => r.fromSW).length;
const out = { when: new Date().toISOString(), chromium: browser.version(), distOnDisk: disk, coldLoadBytes: cold, coldReadyMs: readyMs, serviceWorkerCache: cacheInfo, display: manifest, offline: { readyMs: offlineReadyMs, requests: reqs.size, servedBySW: fromSW, fps: offline.stats.fpsAvg, audioCues: offline.audioCues } };
writeFileSync(join(spikeDir, "results/pwa.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
srv.stop();
