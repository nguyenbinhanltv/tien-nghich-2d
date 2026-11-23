// E2.1 draft boxes from frames. Pure helpers (no file reads except through the loader passed in) so they are unit-tested.
// Everything produced here is `draft-unreviewed` / `alpha-auto`: a proposal for the owner to look at, never an approval.
import type { Rgba } from './repo.ts';
import type { Box } from './kiln-contract.ts';

export const ALPHA_THRESHOLD = 128; // assets/encounter/blood-sea/contract.json alphaThreshold
export type BodyClass = 'actor' | 'player' | 'projectile' | 'prop' | 'none';

/** Which kind of collider the art category stands for. 'none' ids get no body (reason in NO_BODY_REASON). */
export function bodyClass(category: string): BodyClass {
  if (category === 'mob' || category === 'boss') return 'actor';
  if (category === 'player') return 'player';
  if (category === 'projectile') return 'projectile';
  if (category === 'prop') return 'prop';
  return 'none';
}
export const NO_BODY_REASON: Record<string, string> = {
  tileset: 'ô nền: hình va chạm ô thuộc E3.1 (tile shapes), không phải body',
  weapon: 'pháp bảo cầm tay: sát thương đến từ đạn pj_*, không có thân va chạm riêng',
  ui: 'giao diện: không va chạm',
  icon: 'biểu tượng: không va chạm',
  vfx: 'hiệu ứng: không va chạm (cửa sổ sát thương nằm ở dữ liệu encounter)',
};

const solid = (img: Rgba, x: number, y: number, t = ALPHA_THRESHOLD): boolean => (img.pixels[(y * img.width + x) * 4 + 3] ?? 0) >= t;

/** Bounding box of pixels at/above the threshold, shrunk by `inset` on every side; null if empty or too small. */
export function alphaBox(img: Rgba, inset = 1, threshold = ALPHA_THRESHOLD): Box | null {
  const raw = rawBox(img, threshold);
  if (!raw) return null;
  const box = { x: raw.x + inset, y: raw.y + inset, w: raw.w - 2 * inset, h: raw.h - 2 * inset };
  return box.w >= 1 && box.h >= 1 ? box : null;
}
export function rawBox(img: Rgba, threshold = ALPHA_THRESHOLD): Box | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (solid(img, x, y, threshold)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The part of the frame that sticks out of `body`: solid pixels outside the rectangle. Its bbox and pixel count. */
export function reach(img: Rgba, body: Box, threshold = ALPHA_THRESHOLD): { box: Box; pixels: number } | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (!solid(img, x, y, threshold)) continue;
    if (x >= body.x && x < body.x + body.w && y >= body.y && y < body.y + body.h) continue;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return n === 0 ? null : { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, pixels: n };
}

export const ATTACK_CLIP = /^(attack|cast_attack|soul_devour)/;
export const MIN_REACH_PIXELS = 4;
export interface DraftHit { frame: number; id: string; box: Box; how: 'reach' | 'lunge' }

/**
 * Draft attack boxes for one clip (east frames). Rule, written down so the owner can judge it:
 *  - 'reach': a frame whose solid pixels stick out of the idle body box; the hitbox is the bbox of that protruding part.
 *    Kept on every frame whose protruding area is >= 50% of the clip's peak (the strike frames), at most 4 frames (the peak and the 3 next best).
 *  - 'lunge': if nothing protrudes (>= 4 px) the body itself moved; the hitbox is the whole frame's alpha box (inset 1) on the frame that moves furthest from idle.
 * The real hit window is a clip event (`hit`/`hit_end`, contract section 3); until those exist this only guesses it from the pixels.
 */
export function draftClipHits(frames: Rgba[], idleBody: Box, clip: string): DraftHit[] {
  const id = clip.replace(/^attack_/, '').replace(/^cast_/, '') || clip;
  const reaches = frames.map((f, n) => ({ n, r: reach(f, idleBody) }));
  const peak = Math.max(0, ...reaches.map((x) => x.r?.pixels ?? 0));
  if (peak >= MIN_REACH_PIXELS) {
    return reaches.filter((x) => x.r && x.r.pixels >= peak / 2).sort((a, b) => b.r!.pixels - a.r!.pixels).slice(0, 4).sort((a, b) => a.n - b.n)
      .map((x) => ({ frame: x.n, id, box: x.r!.box, how: 'reach' as const }));
  }
  const cx = idleBody.x + idleBody.w / 2, cy = idleBody.y + idleBody.h / 2;
  let best: { n: number; box: Box; d: number } | null = null;
  frames.forEach((f, n) => {
    const b = alphaBox(f);
    if (!b) return;
    const d = Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy);
    if (!best || d > best.d) best = { n, box: b, d };
  });
  const lunge = best as { n: number; box: Box; d: number } | null;
  return lunge ? [{ frame: lunge.n, id, box: lunge.box, how: 'lunge' }] : [];
}

/** Clamp a box into the frame so a draft can never fail the "leaves the frame" check. */
export const clampBox = (b: Box, w: number, h: number): Box => {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.max(1, Math.min(b.w, w - x)), h: Math.max(1, Math.min(b.h, h - y)) };
};
