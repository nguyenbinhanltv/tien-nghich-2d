// Read access to compiled content (dist-content). The game refuses content that failed its schema.
// Row shapes mirror game/schemas/table-*.schema.json; the sim only reads these types, never raw tables.

export interface MobRow { id: string; hp: number; speed: number; contact_dmg: number; ai: 'charger' | 'swooper' | 'brawler' | 'ambusher' | 'shooter'; tier: number; biome: string; attack_clip: string; tell_ms: number }
export interface BossRow { id: string; hp: number; speed: number; contact_dmg: number; biome: string; encounter: string }
export interface RoomRow { id: string; biome: string; kind: string; width_tiles: number; height_tiles: number; tileset: string; mobs: string; boss: string; next: string }

export interface ContentApi {
  readonly version: string;
  has(table: string, id: string): boolean;
  get<T>(table: string, id: string): T;
  /** Ids of a table in file order (stable, so seeded picks are reproducible). */
  ids(table: string): readonly string[];
}

/** Layout of one room (content/rooms/<id>.yaml, compiled to rooms/<id>.json); table `room_layouts` of the ContentApi. */
export interface RoomLayout {
  id: string; size: [number, number]; player_start: [number, number]; grid: string[];
  doors: { side: 'west' | 'east'; role: 'entry' | 'exit'; to: string }[];
  props: { id: string; at: [number, number]; to?: string }[];
  waves: { spawns: { mob: string; at: [number, number]; /** An elite variant of the mob (more health and damage). */ elite?: boolean }[] }[];
}

/** Props that stop movement (they occupy their base tile). The sim (sim/run/floor.ts) and the content validator (tools/lib/rooms.ts) both read this one list, so "every cell is reachable" means the same in both. */
export const BLOCKING_PROPS: ReadonlySet<string> = new Set(['prop_restriction_pillar', 'prop_mist_ravine_rock', 'prop_bone_altar', 'prop_alchemy_jar', 'prop_shrine_altar', 'prop_spirit_chest', 'prop_courtyard_pillar', 'prop_stone_lantern', 'prop_bamboo_cluster']);
