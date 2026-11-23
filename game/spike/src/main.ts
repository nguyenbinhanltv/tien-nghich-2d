import Phaser from "phaser";
import { SpikeScene, VIEW_H, VIEW_W } from "./render/scene.ts";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: "#14101a",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  powerPreference: "high-performance",
  scene: [SpikeScene],
  scale: { mode: Phaser.Scale.NONE },
  input: { mouse: false, touch: false, keyboard: false, gamepad: false }, // our own InputHub reads raw events
  banner: false,
});

/** Integer CSS scale of the 195x422 logical canvas (x2 = 390x844). Nearest-neighbour. */
function fit(): void {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H)));
  const c = game.canvas;
  c.style.width = `${VIEW_W * s}px`;
  c.style.height = `${VIEW_H * s}px`;
  c.style.imageRendering = "pixelated";
  const root = document.getElementById("game")!;
  root.style.width = c.style.width;
  root.style.height = c.style.height;
}
game.events.once(Phaser.Core.Events.READY, fit);
addEventListener("resize", fit);
addEventListener("orientationchange", fit);

// ---- HUD (DOM, updated twice a second so it does not distort the measurement) ----
const hud = document.getElementById("hud")!;
if (new URLSearchParams(location.search).get("hud") !== "0") {
  let frames = 0;
  let t0 = performance.now();
  game.events.on(Phaser.Core.Events.POST_RENDER, () => frames++);
  setInterval(() => {
    const api = (window as unknown as { __spike?: { counts(): { mobs: number; proj: number } } }).__spike;
    if (!api) return;
    const now = performance.now();
    const c = api.counts();
    hud.textContent = `${Math.round((frames * 1000) / (now - t0))} fps · mob ${c.mobs} · đạn ${c.proj}`;
    frames = 0;
    t0 = now;
  }, 500);
} else hud.remove();

// ---- hot reload from Pixel Kiln (dev only; Vite websocket on loopback) ----
if (import.meta.hot) {
  import.meta.hot.on("kiln:update", (d: { files: string[]; t: number }) => {
    const scene = game.scene.getScene("spike") as SpikeScene;
    void scene.hotReload(d.files, d.t);
  });
}

// ---- service worker (production build only) ----
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
}
