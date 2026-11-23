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
