// E9.2: golden images without a browser. A small software renderer draws a sim state at the logical 384x216 from the real Kiln frames
// (assets/processed), then the same integer-scale + letterbox maths as src/render/camera.ts (fitView) makes the device-size image.
// Only the SHA-256 of the pixels is committed (tests/golden/images.json); PNGs are written on demand (--out) for a human to look at.
// This guards the logical view, the frame data and the pixel-perfect fit. It is not a Phaser screenshot test: the engine layer's own
// goldens (plan E9.5, Playwright) come later and are the renderer lane's.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GAME, REPO, loadDecoder, sha256 } from './repo.ts';
import type { Rgba } from './repo.ts';
import { findDir } from '../draft-bodies.ts';
import { fitView } from '../../src/render/camera.ts';
import { VIEW_H, VIEW_W } from '../../src/contracts/world.ts';
import type { ActorState, Facing, WorldState } from '../../src/contracts/world.ts';
import { createWorld, startGhostKingFight, step } from '../../src/sim/loop.ts';
import type { GameEvent, InputFrame } from '../../src/contracts/world.ts';

export const IMAGES_FILE = path.join(GAME, 'tests/golden/images.json');
export interface Image { width: number; height: number; px: Uint8Array } // RGBA, alpha 255 everywhere on a finished frame

// Palette colours from studio.project.json would be ideal; the scene uses a few fixed colours so a palette edit never moves a golden.
const BG = [0x1c, 0x18, 0x26], FLOOR_A = [0x2c, 0x27, 0x33], FLOOR_B = [0x26, 0x21, 0x2d], WALL = [0x14, 0x10, 0x1a];
const HP_BG = [0x14, 0x10, 0x1a], HP_FG = [0xc8, 0x3c, 0x3c], HAZARD = [0xff, 0xd2, 0x3f], BOSS_HAZARD = [0xff, 0x6a, 0x3c];

export function newImage(w: number, h: number, c: number[] = BG): Image {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = c[0]!; px[i * 4 + 1] = c[1]!; px[i * 4 + 2] = c[2]!; px[i * 4 + 3] = 255; }
  return { width: w, height: h, px };
}
const put = (im: Image, x: number, y: number, c: number[]): void => {
  if (x < 0 || y < 0 || x >= im.width || y >= im.height) return;
  const o = (y * im.width + x) * 4; im.px[o] = c[0]!; im.px[o + 1] = c[1]!; im.px[o + 2] = c[2]!; im.px[o + 3] = 255;
};
const rect = (im: Image, x: number, y: number, w: number, h: number, c: number[]): void => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(im, x + i, y + j, c); };

/** Binary-alpha blit (the art rule: alpha is 0 or 255); `flip` mirrors horizontally. */
export function blit(dst: Image, src: Rgba, x: number, y: number, flip: boolean): void {
  for (let j = 0; j < src.height; j++) for (let i = 0; i < src.width; i++) {
    const si = ((j * src.width) + (flip ? src.width - 1 - i : i)) * 4;
    if ((src.pixels[si + 3] ?? 0) < 128) continue;
    put(dst, x + i, y + j, [src.pixels[si]!, src.pixels[si + 1]!, src.pixels[si + 2]!]);
  }
}

/** Nearest-neighbour whole-number upscale. */
export function upscale(src: Image, k: number): Image {
  const out = newImage(src.width * k, src.height * k);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < out.width; x++) { const si = (sy * src.width + Math.floor(x / k)) * 4, o = (y * out.width + x) * 4; out.px[o] = src.px[si]!; out.px[o + 1] = src.px[si + 1]!; out.px[o + 2] = src.px[si + 2]!; out.px[o + 3] = 255; }
  }
  return out;
}

/** The image a device shows: the logical frame at fitView's integer scale, centred on a letterboxed canvas of cssW x cssH at `dpr`. */
export function toDevice(logical: Image, cssW: number, cssH: number, dpr: number): { image: Image; scale: number } {
  const fit = fitView(cssW, cssH, dpr);
  const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
  const big = upscale(logical, fit.scale), canvas = newImage(devW, devH, [0, 0, 0]);
  const ox = Math.floor((devW - big.width) / 2), oy = Math.floor((devH - big.height) / 2);
  for (let y = 0; y < big.height; y++) canvas.px.set(big.px.subarray(y * big.width * 4, (y + 1) * big.width * 4), ((oy + y) * devW + ox) * 4);
  return { image: canvas, scale: fit.scale };
}

// ---- scene -----------------------------------------------------------------------------------------------------------------------------
const ART: Record<string, string> = { player: 'wl_blood_foundation', boss_ghost_king: 'boss_ghost_king' };
const cache = new Map<string, Rgba | null>();
let decoder: ((b: Buffer) => Rgba) | null = null;
async function frame(asset: string, clip: string, dir: string, n: number): Promise<Rgba | null> {
  const key = `${asset}/${clip}_${dir}_${n}`;
  if (cache.has(key)) return cache.get(key)!;
  decoder ??= await loadDecoder();
  const d = findDir(asset), f = d ? path.join(d, `${clip}_${dir}_${n}.png`) : '';
  const img = f && fs.existsSync(f) ? decoder(fs.readFileSync(f)) : null;
  cache.set(key, img);
  return img;
}
const anchorOf = (asset: string): [number, number] => { const d = findDir(asset); return d ? (JSON.parse(fs.readFileSync(path.join(d, 'anchor.json'), 'utf8')) as { anchor_px: [number, number] }).anchor_px : [16, 31]; };
const dirOf = (f: Facing): { dir: 'east' | 'south'; flip: boolean } => (f === 'west' ? { dir: 'east', flip: true } : f === 'east' ? { dir: 'east', flip: false } : { dir: 'south', flip: false });
const FRAME_TICKS = 6; // 100 ms per drawn frame

/** Draw one sim state. Clips the asset lacks fall back to idle; frames cycle every 100 ms. */
export async function renderWorld(w: WorldState): Promise<Image> {
  const im = newImage(VIEW_W, VIEW_H);
  const r = w.room;
  for (let y = r.minY; y < r.maxY; y += 8) for (let x = r.minX; x < r.maxX; x += 8) rect(im, x, y, 8, 8, ((x - r.minX) / 8 + (y - r.minY) / 8) % 2 === 0 ? FLOOR_A : FLOOR_B);
  for (let x = r.minX - 1; x <= r.maxX; x++) { put(im, x, r.minY - 1, WALL); put(im, x, r.maxY, WALL); }
  for (let y = r.minY - 1; y <= r.maxY; y++) { put(im, r.minX - 1, y, WALL); put(im, r.maxX, y, WALL); }
  for (const h of w.hazards) { // telegraph: ring of radius, fills as the timer runs down
    const c = h.kind === 'claw' ? BOSS_HAZARD : HAZARD, rad = Math.round(h.radius);
    for (let a = 0; a < 360; a += 3) put(im, Math.round(h.x + Math.cos((a * Math.PI) / 180) * rad), Math.round(h.y + Math.sin((a * Math.PI) / 180) * rad), c);
  }
  const actors: ActorState[] = [...w.actors].filter((a) => a.hp > 0 || a.diedTick >= 0).sort((a, b) => a.pos.y - b.pos.y || a.id - b.id);
  for (const a of actors) {
    const asset = ART[a.kind];
    if (!asset) continue;
    const { dir, flip } = dirOf(a.facing), t = Math.max(0, w.tick - a.clipStartTick);
    let clip = a.clip, n = Math.floor(t / FRAME_TICKS);
    let f = await frame(asset, clip, dir, n);
    if (!f) { f = await frame(asset, clip, dir, 0); }
    if (!f) { clip = 'idle'; n = Math.floor(w.tick / FRAME_TICKS) % 4; f = await frame(asset, clip, dir, n); }
    if (!f) continue;
    const [ax, ay] = anchorOf(asset);
    blit(im, f, Math.round(a.pos.x) - (flip ? f.width - 1 - ax : ax), Math.round(a.pos.y) - ay, flip);
    const bw = Math.min(24, Math.round(a.radius * 2 + 8));
    rect(im, Math.round(a.pos.x) - (bw >> 1), Math.round(a.pos.y) - ay - 5, bw, 3, HP_BG);
    rect(im, Math.round(a.pos.x) - (bw >> 1) + 1, Math.round(a.pos.y) - ay - 4, Math.max(0, Math.round(((bw - 2) * a.hp) / a.hpMax)), 1, HP_FG);
  }
  return im;
}

// ---- scenarios and sizes ----------------------------------------------------------------------------------------------------------------
const I = (mx: number, my: number, dash = false, fire = false): InputFrame => ({ move: { x: mx, y: my }, aim: null, dash, fire });
export interface ImageScenario { name: string; seed: number; ticks: number; policy: (t: number) => InputFrame }
export const IMAGE_SCENARIOS: ImageScenario[] = [
  { name: 'arena_start', seed: 1, ticks: 0, policy: () => I(0, 0) },
  { name: 'arena_t300_fight', seed: 2, ticks: 300, policy: (t) => { const k = Math.floor(t / 45) % 4; return I([1, 0, -1, 0][k]!, [0, 1, 0, -1][k]!, t % 90 === 0, true); } },
  { name: 'arena_t900_fight', seed: 2, ticks: 900, policy: (t) => { const k = Math.floor(t / 45) % 4; return I([1, 0, -1, 0][k]!, [0, 1, 0, -1][k]!, t % 90 === 0, true); } },
];
/** Viewports that matter: desktop 720p (x3), a landscape phone 844x390 CSS px at DPR 3 (x5), and 1080p at DPR 2 (x10). */
export const SIZES: { name: string; w: number; h: number; dpr: number }[] = [
  { name: 'logical', w: VIEW_W, h: VIEW_H, dpr: 1 },
  { name: '1280x720', w: 1280, h: 720, dpr: 1 },
  { name: 'phone-844x390@3', w: 844, h: 390, dpr: 3 },
  { name: '1920x1080@2', w: 1920, h: 1080, dpr: 2 },
];

export async function renderScenario(s: ImageScenario): Promise<Image> {
  const w = createWorld(s.seed), ev: GameEvent[] = [];
  startGhostKingFight(w, ev);
  for (let t = 0; t < s.ticks; t++) { ev.length = 0; step(w, s.policy(t), ev); }
  return renderWorld(w);
}
export const hashImage = (im: Image): string => sha256(im.px);
export interface ImagesGolden { schema: 'tien-nghich-2d.image-golden'; version: 1; note: string; images: Record<string, { size: [number, number]; scale: number; sha256: string }> }
const NOTE = 'SHA-256 of RGBA pixels of software-rendered scenes at several viewports. Recorded by `npm run qa:golden -- --record`; a mismatch means the view, frames or fit changed: look at the PNGs (--out) before re-recording.';

export async function renderAll(outDir?: string): Promise<ImagesGolden> {
  const g: ImagesGolden = { schema: 'tien-nghich-2d.image-golden', version: 1, note: NOTE, images: {} };
  const pngEncode = outDir ? ((await import(pathToFileURL(path.join(REPO, 'studio/core/png.mjs')).href)) as { encodePixels: (w: number, h: number, p: Buffer) => Buffer }).encodePixels : null;
  for (const s of IMAGE_SCENARIOS) {
    const logical = await renderScenario(s);
    for (const z of SIZES) {
      const d = z.name === 'logical' ? { image: logical, scale: 1 } : toDevice(logical, z.w, z.h, z.dpr);
      g.images[`${s.name}@${z.name}`] = { size: [d.image.width, d.image.height], scale: d.scale, sha256: hashImage(d.image) };
      if (outDir && pngEncode) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `${s.name}@${z.name}.png`), pngEncode(d.image.width, d.image.height, Buffer.from(d.image.px))); }
    }
  }
  return g;
}
export function compareImages(got: ImagesGolden, want: ImagesGolden): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(want.images)) {
    const g = got.images[k];
    if (!g) out.push(`${k}: not rendered any more`);
    else if (g.size.join('x') !== v.size.join('x') || g.scale !== v.scale) out.push(`${k}: size/scale ${g.size.join('x')} x${g.scale}, golden ${v.size.join('x')} x${v.scale}`);
    else if (g.sha256 !== v.sha256) out.push(`${k}: pixels differ (got ${g.sha256.slice(0, 12)}, golden ${v.sha256.slice(0, 12)})`);
  }
  for (const k of Object.keys(got.images)) if (!(k in want.images)) out.push(`${k}: not in golden (run qa:golden -- --record)`);
  return out;
}
