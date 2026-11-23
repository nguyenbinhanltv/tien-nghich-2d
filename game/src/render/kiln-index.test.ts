import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { animsJson, indexClips, parseFrameName, pivotFor } from './kiln-index.ts';

const ATLAS = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/atlases/mobile');
const coreNames = (): string[] => readdirSync(ATLAS).filter((f) => /^atlas-\d+\.json$/.test(f)).flatMap((f) => Object.keys((JSON.parse(readFileSync(join(ATLAS, f), 'utf8')) as { frames: object }).frames));

describe('parseFrameName', () => {
  it('splits asset, clip, direction and index', () => {
    expect(parseFrameName('characters/mob_blood_wolf/move_east_3')).toEqual({ group: 'characters', asset: 'mob_blood_wolf', clip: 'move', direction: 'east', index: 3 });
    expect(parseFrameName('characters/boss_ghost_king/attack_claw_south_12')).toMatchObject({ clip: 'attack_claw', direction: 'south', index: 12 });
    expect(parseFrameName('tilesets/ts_blood_valley/deco_f0_4')).toMatchObject({ clip: 'deco_f0', direction: null, index: 4 });
    expect(parseFrameName('vfx/hit_spark_7')).toMatchObject({ group: 'vfx', asset: '', clip: 'hit_spark', index: 7 });
    expect(parseFrameName('nonsense')).toBeNull();
  });
});

describe('core atlas (real mobile pages)', () => {
  const names = coreNames();
  const { clips, unparsed } = indexClips(names);
  it('has 2938 frames and 453 clips, the counts of the Studio Phaser check', () => {
    expect(names.length).toBe(2938);
    expect(new Set(names).size).toBe(2938);
    expect(unparsed).toEqual([]);
    expect(clips.size).toBe(453);
  });
  it('clip frames are consecutive from 0 and every frame belongs to exactly one clip', () => {
    let total = 0;
    for (const c of clips.values()) {
      total += c.frames.length;
      c.frames.forEach((f, i) => expect(f.endsWith(`_${i}`), f).toBe(true));
    }
    expect(total).toBe(2938);
  });
  it('builds a fromJSON document with one animation per clip, loops for idle/move, one-shot for attacks', () => {
    const doc = animsJson(clips.values(), () => 'page', (c) => (c === 'idle' ? 6 : 8)) as { anims: { key: string; repeat: number; frames: unknown[] }[] };
    expect(doc.anims.length).toBe(453);
    expect(doc.anims.find((a) => a.key === 'characters/mob_blood_wolf/move_east')?.repeat).toBe(-1);
    expect(doc.anims.find((a) => a.key === 'characters/boss_ghost_king/attack_claw_east')?.repeat).toBe(0);
  });
});

describe('pivotFor', () => {
  const table = { mob_x: { canvas: [32, 32], anchor_px: [16, 31], facings: { east: { source: 'east', flip_x: false, anchor_px: [16, 31] }, west: { source: 'east', flip_x: true, anchor_px: [15, 31] } } } } as never;
  it('uses the per-facing anchor (west is mirrored east, one pixel left)', () => {
    expect(pivotFor(table, 'characters/mob_x', 'west', 32, 32)).toEqual({ x: 15, y: 31 });
    expect(pivotFor(table, 'characters/mob_x', 'east', 32, 32)).toEqual({ x: 16, y: 31 });
  });
  it('falls back to bottom-centre when the asset has no entry', () => {
    expect(pivotFor(table, 'characters/wl_outer_disciple', 'south', 32, 32)).toEqual({ x: 16, y: 31 });
    expect(pivotFor(null, 'characters/boss_x', null, 96, 96)).toEqual({ x: 48, y: 95 });
  });
});
