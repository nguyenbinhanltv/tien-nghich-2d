import { describe, expect, it } from 'vitest';
import { loadTables } from '../tools/lib/tables.ts';
import { approvedArtIds, loadLayouts, validateAll, validateLayout, type RoomLayout, type RoomRow } from '../content/rooms/layout.ts';

const rooms = loadTables().tables.rooms as unknown as RoomRow[];
const layouts = loadLayouts();
const approved = approvedArtIds();
const clone = (id: string): RoomLayout => structuredClone(layouts.get(id)!);
const problems = (id: string, L: RoomLayout): string => validateLayout(id, L, rooms, approved).join('\n');

describe('Huyết Hải room layouts (E3.2)', () => {
  it('cover the 9 fight rooms + the reward room and all pass validation', () => {
    expect(rooms.filter((r) => r.kind === 'combat' || r.kind === 'boss')).toHaveLength(9);
    expect(validateAll(rooms)).toEqual([]);
  });
  it('chain by their doors: abode -> 1 ... 8 -> boss -> reward, every exit locked room leads to the next row', () => {
    let id = 'room_bs_1';
    const seen: string[] = [];
    for (let i = 0; i < 20 && id; i++) { seen.push(id); id = layouts.get(id)!.doors.find((d) => d.role === 'exit')?.to ?? ''; }
    expect(seen).toEqual([...Array.from({ length: 8 }, (_, i) => `room_bs_${i + 1}`), 'room_bs_boss', 'room_bs_reward']);
  });
  it('use only approved art ids, and the reward room leads home by the teleport array', () => {
    for (const L of layouts.values()) for (const id of [...L.props.map((p) => p.id), ...L.waves.flatMap((w) => w.spawns.map((s) => s.mob))]) expect(approved.has(id)).toBe(true);
    expect(layouts.get('room_bs_reward')!.props.find((p) => p.id === 'prop_teleport_array')!.to).toBe('room_abode_hub');
  });
  it('use every one of the five Huyết Hải mobs and the boss somewhere', () => {
    const all = new Set([...layouts.values()].flatMap((L) => L.waves.flatMap((w) => w.spawns.map((s) => s.mob))));
    for (const m of ['mob_blood_wolf', 'mob_blood_crow', 'mob_blood_corpse', 'mob_vengeful_soul', 'mob_blood_pool_lurker', 'boss_ghost_king']) expect(all.has(m)).toBe(true);
  });

  describe('the validator catches', () => {
    it('a wall that cuts the room in two', () => {
      const L = clone('room_bs_1');
      for (const r of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) L.grid[r] = L.grid[r]!.slice(0, 12) + '#' + L.grid[r]!.slice(13);
      expect(problems('room_bs_1', L)).toMatch(/cannot be reached/);
    });
    it('a prop on a wall, a spawn on a prop, an unapproved prop, a spawn at the start', () => {
      const L = clone('room_bs_1');
      L.props.push({ id: 'prop_mist_ravine_rock', at: [0, 0] }, { id: 'prop_fake_thing', at: [4, 4] });
      L.waves[0]!.spawns[0]!.at = [8, 5]; // the pillar
      L.waves[0]!.spawns[1]!.at = [3, 7]; // next to the start
      const p = problems('room_bs_1', L);
      expect(p).toMatch(/not on a floor cell/); expect(p).toMatch(/prop_fake_thing is not an approved/); expect(p).toMatch(/under a prop|shares a cell/); expect(p).toMatch(/closer than 6 tiles/);
    });
    it('mob counts that differ from rooms.csv, a lurker off the pool, a wrong exit', () => {
      const L = clone('room_bs_4');
      L.waves[0]!.spawns.pop(); L.waves[0]!.spawns[0]!.at = [20, 4]; L.doors[1]!.to = 'room_bs_1';
      const p = problems('room_bs_4', L);
      expect(p).toMatch(/mob_blood_corpse: 1 spawned, rooms.csv says 2/); expect(p).toMatch(/only the lurker goes on a blood pool/); expect(p).toMatch(/exit door leads to room_bs_1/);
    });
    it('a door that does not open the standard rows', () => {
      const L = clone('room_bs_2');
      L.grid[7] = '#' + L.grid[7]!.slice(1);
      expect(problems('room_bs_2', L)).toMatch(/door must open rows/);
    });
    it('a size that differs from the table', () => {
      const L = clone('room_bs_2');
      L.size = [24, 13];
      expect(problems('room_bs_2', L)).toMatch(/size 24x13 differs/);
    });
  });
});
