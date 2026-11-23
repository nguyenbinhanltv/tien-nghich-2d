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

/** Largest INTEGER scale in physical pixels of the 384x216 frame; letterbox the rest. Nearest-neighbour. */
function fit(): void {
  const dpr = window.devicePixelRatio || 1;
  const phys = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / VIEW_W, (innerHeight * dpr) / VIEW_H)));
  const css = phys / dpr; // CSS px per logical px
  const c = game.canvas;
  c.style.width = `${VIEW_W * css}px`;
  c.style.height = `${VIEW_H * css}px`;
  c.style.imageRendering = "pixelated";
  const root = document.getElementById("game")!;
  root.style.width = c.style.width;
  root.style.height = c.style.height;
  root.dataset.scale = String(phys);
}
game.events.once(Phaser.Core.Events.READY, fit);
addEventListener("resize", fit);
// Portrait handheld: show the rotate screen (CSS) and freeze the sim until the device is turned.
const portrait = matchMedia("(orientation: portrait) and (pointer: coarse)");
const applyOrientation = () => {
  const scene = game.scene.getScene("spike") as SpikeScene | undefined;
  if (scene) scene.paused = portrait.matches;
};
portrait.addEventListener("change", applyOrientation);
game.events.once(Phaser.Core.Events.READY, () => setTimeout(applyOrientation, 0));
// Try to lock landscape (works in installed PWAs / fullscreen; ignored elsewhere).
addEventListener("pointerdown", () => void (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {}), { once: true });
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
