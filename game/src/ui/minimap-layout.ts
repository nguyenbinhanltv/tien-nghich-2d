// Minimap and floor HUD maths (E3.3), pure and unit-tested. The floor is the chain of rooms linked by `next` in
// content/tables/rooms.csv (Huyết Hải: room_bs_1 ... room_bs_8, boss, reward); the map lays it out as a 3-wide snake so a
// 10-room floor is 3x4 cells. Icons are the real ui_minimap frames (8x8). The sim does not move the player between rooms yet,
// so the caller says which room is current (the run state `room` index when it exists).
export type RoomKind = 'combat' | 'boss' | 'reward' | 'abode' | string;
export interface RoomRow { id: string; kind: RoomKind; next?: string }
export interface MiniRoom { id: string; kind: RoomKind }

export const CELL = 8;
export const GAP = 3;
export const PER_ROW = 3;

/** Rooms in play order from `startId`, following `next`. Stops at a missing link or a cycle (never loops forever). */
export function chainFrom(rows: readonly RoomRow[], startId: string): MiniRoom[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: MiniRoom[] = [];
  const seen = new Set<string>();
  for (let id: string | undefined = startId; id && !seen.has(id); id = byId.get(id)?.next || undefined) {
    const r = byId.get(id);
    if (!r) break;
    seen.add(id);
    out.push({ id: r.id, kind: r.kind });
  }
  return out;
}

/** Snake layout: row 0 left to right, row 1 right to left, ... so consecutive rooms always touch. */
export function snakeLayout(count: number, perRow = PER_ROW): { col: number; row: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow), k = i % perRow;
    return { col: row % 2 === 0 ? k : perRow - 1 - k, row };
  });
}

export type RoomState = 'current' | 'visited' | 'revealed' | 'unknown';
/** Rooms before the current one are visited, the next one is revealed (its type shows), everything else is a "?". */
export function roomStates(count: number, current: number): RoomState[] {
  return Array.from({ length: count }, (_, i) => (i === current ? 'current' : i < current ? 'visited' : i === current + 1 ? 'revealed' : 'unknown'));
}

/** Atlas frame of a cell. `blink` (0|1) animates the current-room marker. */
export function iconFrame(kind: RoomKind, state: RoomState, blink: 0 | 1): string {
  const f = (n: string, i = 0): string => `ui/ui_minimap/${n}_none_${i}`;
  if (state === 'current') return f('current', blink);
  if (state === 'unknown') return f('unknown');
  if (kind === 'boss') return f('boss', blink);
  if (kind === 'reward') return f('shrine');
  return f('room');
}

export interface MapSize { w: number; h: number }
export function mapSize(count: number, perRow = PER_ROW): MapSize {
  const rows = Math.ceil(count / perRow), cols = Math.min(count, perRow);
  return { w: cols * CELL + Math.max(0, cols - 1) * GAP, h: rows * CELL + Math.max(0, rows - 1) * GAP };
}

/** Pixel position of a cell inside the map. */
export const cellOrigin = (col: number, row: number): { x: number; y: number } => ({ x: col * (CELL + GAP), y: row * (CELL + GAP) });

/** 1-px connector between consecutive rooms: a short segment in the gap between their cells. */
export function connector(a: { col: number; row: number }, b: { col: number; row: number }): { x: number; y: number; w: number; h: number } {
  const pa = cellOrigin(a.col, a.row), pb = cellOrigin(b.col, b.row);
  if (a.row === b.row) { const left = Math.min(pa.x, pb.x); return { x: left + CELL, y: pa.y + CELL / 2 - 1, w: GAP, h: 2 }; }
  const top = Math.min(pa.y, pb.y); return { x: pa.x + CELL / 2 - 1, y: top + CELL, w: 2, h: GAP };
}

/** "3/10": the room number out of the rooms of the floor (the abode is not counted). */
export const floorCounter = (current: number, count: number): string => `${Math.min(count, Math.max(0, current) + 1)}/${count}`;
