import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { blobIndex, doorSpots, poolIndex, propFrames, tileKind, wallTopIndex } from './room-tiles.ts';

const ROOMS = join(dirname(fileURLToPath(import.meta.url)), '../../content/rooms');
const layouts = readdirSync(ROOMS).filter((f) => f.endsWith('.yaml')).map((f) => YAML.parse(readFileSync(join(ROOMS, f), 'utf8')) as { id: string; grid: string[]; props: { id: string }[]; doors: { side: string; role: string }[] });

describe('tileKind', () => {
  const rows = ['####', '#.~#', '####'];
  it('floor, pool, and walls: the front face only where floor is south of the wall', () => {
    expect(tileKind(rows, 1, 1)).toBe('floor');
    expect(tileKind(rows, 2, 1)).toBe('pool');
    expect(tileKind(rows, 1, 0)).toBe('wall-face');
    expect(tileKind(rows, 0, 0)).toBe('wall-cap');
    expect(tileKind(rows, 1, 2)).toBe('wall-cap');
    expect(tileKind(rows, 99, 99)).toBe('wall-cap'); // outside = wall
  });
  it('a prop cell and a door cell are floor under their sprite', () => {
    expect(tileKind(['#.#', '#P#', '#D#', '#O#'], 1, 1)).toBe('floor');
    expect(tileKind(['#.#', '#P#', '#D#', '#O#'], 1, 2)).toBe('floor');
  });
});

describe('doorSpots (real room layouts)', () => {
  it('every room has one door per entry/exit, two cells high, on the matching side', () => {
    expect(layouts.length).toBeGreaterThanOrEqual(10);
    for (const L of layouts) {
      const spots = doorSpots(L.grid);
      expect(spots.length, L.id).toBe(L.doors.length);
      for (const s of spots) { expect(s.span, L.id).toBe(2); expect(L.doors.some((d) => d.side === s.side), L.id).toBe(true); }
    }
  });
  it('a door is open when any of its cells is open, locked otherwise', () => {
    expect(doorSpots(['#.#', 'D.O', 'D.O', '#.#']).map((d) => d.open)).toEqual([false, true]);
    expect(doorSpots(['D.D', 'O.D']).map((d) => d.open)).toEqual([true, false]);
    expect(doorSpots(['...', '...'])).toEqual([]);
  });
});

describe('propFrames', () => {
  const seq = (names: string[]) => (p: string) => { const o: string[] = []; for (let i = 0; names.includes(`${p}_${i}`); i++) o.push(`${p}_${i}`); return o; };
  it('prefers idle, then a still state; unknown props give nothing (not drawn, never a crash)', () => {
    const names = ['props/a/idle_none_0', 'props/a/idle_none_1', 'props/b/closed_none_0'];
    expect(propFrames(seq(names), 'a')).toHaveLength(2);
    expect(propFrames(seq(names), 'b')).toEqual(['props/b/closed_none_0']);
    expect(propFrames(seq(names), 'zzz')).toEqual([]);
  });
  it('every prop the real layouts use has art in the atlas', () => {
    const atlas = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/atlases/mobile');
    const names = new Set<string>();
    for (let i = 0; i < 7; i++) for (const n of Object.keys((JSON.parse(readFileSync(join(atlas, `atlas-${i}.json`), 'utf8')) as { frames: object }).frames)) names.add(n);
    const sequence = (p: string) => { const o: string[] = []; for (let i = 0; names.has(`${p}_${i}`); i++) o.push(`${p}_${i}`); return o; };
    for (const L of layouts) for (const p of L.props) expect(propFrames(sequence, p.id).length, `${L.id}/${p.id}`).toBeGreaterThan(0);
    expect(sequence('props/prop_room_door/locked_none').length).toBe(1);
    expect(sequence('props/prop_room_door/open_none').length).toBe(1);
  });
});

describe('blob47 autotile', () => {
  const mapping = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../assets/raw/environment_items/tilesets/blob47_mapping.json'), 'utf8')) as { raw_mask_to_index: number[] };
  it('matches the generator mapping for all 256 raw masks', () => {
    for (let m = 0; m < 256; m++) expect(blobIndex(m)).toBe(mapping.raw_mask_to_index[m]);
  });
  it('an interior wall cell is the full tile (46); a lone pool cell is the isolated tile (0)', () => {
    expect(wallTopIndex(['###', '###', '###'], 1, 1)).toBe(46);
    expect(poolIndex(['...', '.~.', '...'], 1, 1)).toBe(0);
  });
  it('a pool edge differs from its interior, and the room border (out of range) is wall', () => {
    const rows = ['.....', '.~~~.', '.~~~.', '.~~~.', '.....'];
    expect(poolIndex(rows, 2, 2)).toBe(46);
    expect(poolIndex(rows, 1, 1)).not.toBe(46);
    expect(wallTopIndex(['##', '##'], 0, 0)).toBe(46);
  });
  it('every wall-top and pool cell of the real rooms gets a tile in 0..46', () => {
    for (const l of layouts) for (let r = 0; r < l.grid.length; r++) for (let c = 0; c < l.grid[r]!.length; c++) {
      const k = tileKind(l.grid, c, r);
      const i = k === 'wall-cap' ? wallTopIndex(l.grid, c, r) : k === 'pool' ? poolIndex(l.grid, c, r) : 0;
      expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThanOrEqual(46);
    }
  });
});
