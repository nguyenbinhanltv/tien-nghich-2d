import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cellOrigin, chainFrom, connector, floorCounter, iconFrame, mapSize, roomStates, snakeLayout } from './minimap-layout.ts';
import type { RoomRow } from './minimap-layout.ts';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '../..');
const rows = (): RoomRow[] => readFileSync(join(GAME, 'content/tables/rooms.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const c = l.split(','); return { id: c[0]!, kind: c[2]!, next: c[8] ?? '' }; });

describe('chainFrom (real rooms.csv)', () => {
  it('the Blood Sea floor is nine combat rooms (3 clusters of 3), the boss and the reward, in order', () => {
    const c = chainFrom(rows(), 'room_bs_1');
    expect(c.map((r) => r.id)).toEqual(['room_bs_1', 'room_bs_2', 'room_bs_3', 'room_bs_4', 'room_bs_5', 'room_bs_6', 'room_bs_7', 'room_bs_8', 'room_bs_9', 'room_bs_boss', 'room_bs_reward']);
    expect(c.filter((r) => r.kind === 'combat')).toHaveLength(9);
    expect(c.at(-2)?.kind).toBe('boss');
  });
  it('starting at the abode hub includes it first; a cycle or a dangling link ends the chain', () => {
    expect(chainFrom(rows(), 'room_abode_hub')[0]?.kind).toBe('abode');
    expect(chainFrom([{ id: 'a', kind: 'combat', next: 'b' }, { id: 'b', kind: 'combat', next: 'a' }], 'a')).toHaveLength(2);
    expect(chainFrom([{ id: 'a', kind: 'combat', next: 'zzz' }], 'a')).toHaveLength(1);
    expect(chainFrom([], 'a')).toEqual([]);
  });
});

describe('layout', () => {
  it('snake: consecutive rooms always touch (3 per row, alternating direction)', () => {
    const l = snakeLayout(10);
    expect(l.slice(0, 4)).toEqual([{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }, { col: 2, row: 1 }]);
    for (let i = 1; i < l.length; i++) expect(Math.abs(l[i]!.col - l[i - 1]!.col) + Math.abs(l[i]!.row - l[i - 1]!.row)).toBe(1);
    expect(new Set(l.map((c) => `${c.col},${c.row}`)).size).toBe(10);
  });
  it('map size: 10 rooms are 3 columns by 4 rows of 8 px cells with 3 px gaps; small floors shrink', () => {
    expect(mapSize(10)).toEqual({ w: 30, h: 41 });
    expect(mapSize(2)).toEqual({ w: 19, h: 8 });
    expect(mapSize(0)).toEqual({ w: 0, h: 0 });
  });
  it('connectors sit between touching cells', () => {
    const a = snakeLayout(4);
    expect(connector(a[0]!, a[1]!)).toEqual({ x: 8, y: 3, w: 3, h: 2 });   // horizontal
    expect(connector(a[2]!, a[3]!)).toEqual({ x: cellOrigin(2, 0).x + 3, y: 8, w: 2, h: 3 }); // vertical
  });
});

describe('states and icons', () => {
  it('visited before, current, the next one revealed, the rest unknown', () => {
    expect(roomStates(5, 2)).toEqual(['visited', 'visited', 'current', 'revealed', 'unknown']);
    expect(roomStates(3, 0)).toEqual(['current', 'revealed', 'unknown']);
  });
  it('icon frames exist in the real atlas', () => {
    const names = new Set<string>();
    for (let i = 0; i < 7; i++) for (const n of Object.keys((JSON.parse(readFileSync(join(GAME, `../assets/atlases/mobile/atlas-${i}.json`), 'utf8')) as { frames: object }).frames)) names.add(n);
    for (const kind of ['combat', 'boss', 'reward']) for (const st of ['current', 'visited', 'revealed', 'unknown'] as const) for (const b of [0, 1] as const) expect(names.has(iconFrame(kind, st, b)), `${kind}/${st}/${b}`).toBe(true);
  });
  it('the boss room is told apart by shape (boss icon), not only by colour', () => {
    expect(iconFrame('boss', 'revealed', 0)).not.toBe(iconFrame('combat', 'revealed', 0));
    expect(iconFrame('combat', 'unknown', 0)).toBe(iconFrame('boss', 'unknown', 0));
  });
});

describe('floorCounter', () => { it('is the 1-based room number out of the count, clamped', () => { expect(floorCounter(0, 10)).toBe('1/10'); expect(floorCounter(8, 10)).toBe('9/10'); expect(floorCounter(99, 10)).toBe('10/10'); }); });
