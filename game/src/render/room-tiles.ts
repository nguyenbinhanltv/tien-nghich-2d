// What to draw for each cell of a room grid (sim RoomGrid rows) and where the doors are. Pure, so it is tested on the real room
// layouts without Phaser. Grid characters: # wall, . floor, ~ blood pool (walkable), P blocking prop (floor under the prop sprite),
// D locked door, O open door (contracts/combat.ts RoomGrid).
export type TileKind = 'floor' | 'pool' | 'wall-face' | 'wall-cap';

const walkable = (ch: string | undefined): boolean => ch !== undefined && ch !== '#';

/** A wall cell with floor (or a doorway) south of it shows its front face; any other wall cell shows its top. Out of range = wall. */
export function tileKind(rows: readonly string[], c: number, r: number): TileKind {
  const ch = rows[r]?.[c] ?? '#';
  if (ch === '#') return walkable(rows[r + 1]?.[c]) ? 'wall-face' : 'wall-cap';
  return ch === '~' ? 'pool' : 'floor';
}

export interface DoorSpot { col: number; row: number; /** cells high (consecutive door cells in the column) */ span: number; open: boolean; side: 'west' | 'east' }

/** One door per run of consecutive 'D'/'O' cells in a column (the layouts make them two cells high). Open when any cell is open. */
export function doorSpots(rows: readonly string[]): DoorSpot[] {
  const out: DoorSpot[] = [];
  const width = rows[0]?.length ?? 0;
  for (let c = 0; c < width; c++) {
    let r = 0;
    while (r < rows.length) {
      if (rows[r]![c] !== 'D' && rows[r]![c] !== 'O') { r++; continue; }
      const start = r; let open = false;
      while (r < rows.length && (rows[r]![c] === 'D' || rows[r]![c] === 'O')) { if (rows[r]![c] === 'O') open = true; r++; }
      out.push({ col: c, row: start, span: r - start, open, side: c < width / 2 ? 'west' : 'east' });
    }
  }
  return out;
}

/** Frame names of a prop in play order: idle if it has one, else the first still state it has. */
export function propFrames(sequence: (prefix: string) => string[], id: string): string[] {
  for (const state of ['idle', 'intact', 'closed', 'locked']) {
    const f = sequence(`props/${id}/${state}_none`);
    if (f.length) return f;
  }
  return [];
}

// blob47 autotile (assets/raw/environment_items/tilesets/blob47_mapping.json): the mask has a bit for each neighbour of the same material
// (N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128); a diagonal only counts when both its cardinals are set, which leaves 47 tiles, numbered in
// ascending order of the reduced mask. A test compares this table with the JSON the generator wrote.
const DIAG: readonly (readonly [number, number])[] = [[2, 5], [8, 20], [32, 80], [128, 65]];
const reduce = (m: number): number => { for (const [d, sides] of DIAG) if ((m & sides) !== sides) m &= ~d; return m; };
const REDUCED = [...new Set(Array.from({ length: 256 }, (_, m) => reduce(m)))].sort((a, b) => a - b);
const INDEX = new Map(REDUCED.map((m, i) => [m, i] as const));
/** Tile number (0..46) of a blob47 sheet for a raw 8-neighbour mask. */
export function blobIndex(mask: number): number { return INDEX.get(reduce(mask & 255))!; }

const RING: readonly (readonly [number, number, number])[] = [[1, 0, -1], [2, 1, -1], [4, 1, 0], [8, 1, 1], [16, 0, 1], [32, -1, 1], [64, -1, 0], [128, -1, -1]];
/** Neighbour mask of cell (c, r): a bit for each of the 8 neighbours for which `same` is true. */
export function neighbourMask(same: (c: number, r: number) => boolean, c: number, r: number): number {
  let m = 0;
  for (const [bit, dx, dy] of RING) if (same(c + dx, r + dy)) m |= bit;
  return m;
}
/** Wall tops join every wall cell (face or top) and the room's border; doors and floor are edges. */
export function wallTopIndex(rows: readonly string[], c: number, r: number): number {
  return blobIndex(neighbourMask((x, y) => (rows[y]?.[x] ?? '#') === '#', c, r));
}
/** Blood pools join each other only (a pool next to floor, wall or prop gets its rim). */
export function poolIndex(rows: readonly string[], c: number, r: number): number {
  return blobIndex(neighbourMask((x, y) => rows[y]?.[x] === '~', c, r));
}
