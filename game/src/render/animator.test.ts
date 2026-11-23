import { describe, expect, it } from 'vitest';
import { frameIndex, resolveClip } from './animator.ts';

const names = new Set<string>();
for (const d of ['south', 'east']) for (let i = 0; i < 4; i++) names.add(`characters/mob_x/idle_${d}_${i}`);
for (let i = 0; i < 6; i++) names.add(`characters/mob_x/move_east_${i}`);
const src = { sequence: (p: string) => { const o: string[] = []; for (let i = 0; names.has(`${p}_${i}`); i++) o.push(`${p}_${i}`); return o; } };

describe('resolveClip', () => {
  it('west is east mirrored when there is no west', () => {
    const r = resolveClip(src, 'mob_x', 'move', 'west')!;
    expect(r.flipX).toBe(true);
    expect(r.frames).toHaveLength(6);
    expect(r.frames[0]).toBe('characters/mob_x/move_east_0');
  });
  it('north uses south', () => { expect(resolveClip(src, 'mob_x', 'idle', 'north')!.frames[0]).toBe('characters/mob_x/idle_south_0'); });
  it('an unknown clip falls back to idle; an unknown kind gives null', () => {
    expect(resolveClip(src, 'mob_x', 'dance', 'south')!.frames[0]).toBe('characters/mob_x/idle_south_0');
    expect(resolveClip(src, 'nobody', 'idle', 'south')).toBeNull();
  });
});

describe('frameIndex', () => {
  it('loops idle and derives from ticks only', () => {
    expect(frameIndex(4, 'idle', 0, 0)).toBe(0);
    expect(frameIndex(4, 'idle', 0, 10)).toBe(1); // 6 fps = 10 ticks per frame
    expect(frameIndex(4, 'idle', 0, 40)).toBe(0);
    expect(frameIndex(4, 'idle', 5, 3)).toBe(0); // before start
  });
  it('one-shot clips hold the last frame', () => { expect(frameIndex(4, 'dash', 0, 9999)).toBe(3); });
});
