// What `step()` needs besides the world to run mobs and bosses from content: the compiled tables (dist-content/tables.json)
// and encounters (dist-content/encounters/<id>.json) behind the ContentApi of contracts/content.ts.
// Without a context `step()` runs the legacy reference fight (systems/ghost-king.ts) and has no mobs: that keeps the
// replay goldens and the E1.4 parity tests valid.
import type { BossRow, ContentApi, MobRow, RoomLayout, RoomRow } from '../contracts/content.ts';
import type { Encounter } from './ai/boss.ts';

export interface SimContext { content: ContentApi }

export interface ContentTables { mobs: MobRow[]; bosses: BossRow[]; rooms: RoomRow[]; encounters: Record<string, Encounter>; layouts?: Record<string, RoomLayout> }

/** ContentApi over parsed tables: tables 'mobs', 'bosses', 'rooms' (by id), 'encounters' (by encounter id) and 'room_layouts' (by room id), in file order. */
export function contentFromTables(t: ContentTables, version = 'tables'): ContentApi {
  const by: Record<string, Map<string, unknown>> = {
    mobs: new Map(t.mobs.map((r) => [r.id, r])), bosses: new Map(t.bosses.map((r) => [r.id, r])),
    rooms: new Map(t.rooms.map((r) => [r.id, r])), encounters: new Map(Object.entries(t.encounters)), room_layouts: new Map(Object.entries(t.layouts ?? {})),
  };
  return {
    version,
    has: (table, id) => by[table]?.has(id) ?? false,
    get: <T>(table: string, id: string): T => {
      const row = by[table]?.get(id);
      if (row === undefined) throw new Error(`content: no ${table}/${id}`);
      return row as T;
    },
    ids: (table) => [...(by[table]?.keys() ?? [])],
  };
}
