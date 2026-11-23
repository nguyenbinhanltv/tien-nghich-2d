// Clip lookup and frame choice. The sim stores (clip, clipStartTick); the frame is derived from the tick, so a
// replay or a save/load shows the same picture. Facing rule (assets/atlases/mob-runtime.json): S and E are drawn,
// N uses S when there is no north, W is E mirrored when there is no west.
import type { Facing } from '../contracts/world.ts';
import { TICK_HZ } from '../contracts/world.ts';

export interface FrameSource { sequence(prefix: string): string[] }
export interface ResolvedClip { frames: string[]; flipX: boolean }

/** Frames per second per clip family. Placeholders until Kiln exports clip timing (E2.2). */
export const CLIP_FPS: Record<string, number> = { idle: 6, run: 10, move: 8, dash: 16, cast_attack: 14, attack: 10, death: 8, hurt: 18 };
const LOOPING = new Set(['idle', 'run', 'move']);
export const isLooping = (clip: string): boolean => LOOPING.has(clip);

const FALLBACK_DIR: Record<Facing, Facing[]> = {
  south: ['south', 'east'],
  east: ['east', 'south'],
  north: ['north', 'south', 'east'],
  west: ['west', 'east', 'south'],
};

export function resolveClip(src: FrameSource, kind: string, clip: string, facing: Facing): ResolvedClip | null {
  for (const c of [clip, 'idle']) {
    for (const dir of FALLBACK_DIR[facing]) {
      const frames = src.sequence(`characters/${kind}/${c}_${dir}`);
      if (frames.length) return { frames, flipX: facing === 'west' && dir !== 'west' };
    }
  }
  return null;
}

/** Frame index for a clip started at `startTick`, at tick `tick`. One-shot clips hold their last frame. */
export function frameIndex(count: number, clip: string, startTick: number, tick: number): number {
  if (count <= 1) return 0;
  const i = Math.floor(((tick - startTick) * (CLIP_FPS[clip] ?? 8)) / TICK_HZ);
  if (i < 0) return 0;
  return isLooping(clip) ? i % count : Math.min(i, count - 1);
}
