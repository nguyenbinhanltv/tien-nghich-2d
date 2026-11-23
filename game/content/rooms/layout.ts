// Loader and validator for content/rooms/*.yaml (E3.2). Pure data checks: a room that passes can be played and left.
// Rules: the grid matches rooms.csv; doors, props and spawns sit on legal cells; every walkable cell is reachable from the
// player start (blocking props and mobs' own cells counted as blocked); spawns keep their distance from the start;
// the mobs of the waves equal the counts in rooms.csv; only the human-approved art ids are used.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { check } from '../../tools/lib/schemas.ts';
import { ASSETS, GAME, readJson } from '../../tools/lib/repo.ts';

export interface RoomLayout {
  id: string; size: [number, number]; player_start: [number, number]; grid: string[];
  doors: { side: 'west' | 'east'; role: 'entry' | 'exit'; to: string }[];
  props: { id: string; at: [number, number]; to?: string }[];
  waves: { spawns: { mob: string; at: [number, number] }[] }[];
}
export interface RoomRow { id: string; kind: string; width_tiles: number; height_tiles: number; mobs?: string; boss?: string; next?: string }

/** Props that stop movement (they occupy their base tile). The rest are decoration or triggers drawn over walkable floor. */
export const BLOCKING_PROPS: ReadonlySet<string> = new Set(['prop_restriction_pillar', 'prop_mist_ravine_rock', 'prop_bone_altar', 'prop_alchemy_jar', 'prop_shrine_altar', 'prop_spirit_chest']);
/** Tiles between the player start and any spawn: nothing spawns on top of the player. */
export const MIN_SPAWN_DISTANCE = 6;
export const DOOR_ROWS = [7, 8] as const;

export function loadLayouts(): Map<string, RoomLayout> {
  const dir = path.join(GAME, 'content/rooms');
  const out = new Map<string, RoomLayout>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yaml')).sort()) {
    const data = YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RoomLayout;
    out.set(f.replace(/\.yaml$/, ''), data);
  }
  return out;
}

/** The ids the owner approved as art (owner_vs_baseline_2026-11-23): layouts may only use these. */
export function approvedArtIds(): Set<string> {
  const doc = readJson<{ approvals: { id: string; assets: Record<string, unknown> }[] }>(path.join(ASSETS, 'review/art_approvals.json'));
  const a = doc.approvals.find((x) => x.id === 'owner_vs_baseline_2026-11-23');
  return new Set(Object.keys(a?.assets ?? {}));
}

const key = (c: number, r: number): string => `${c},${r}`;

export function validateLayout(file: string, L: RoomLayout, rooms: RoomRow[], approved: Set<string>): string[] {
  const p: string[] = [];
  const at = `rooms/${file}.yaml`;
  const bad = (m: string): void => { p.push(`${at}: ${m}`); };
  p.push(...check('room-layout.schema.json', L, at));
  if (p.length) return p;
  if (L.id !== file) bad(`id ${L.id} must equal the file name`);
  const row = rooms.find((r) => r.id === L.id);
  if (!row) { bad('not a room of rooms.csv'); return p; }
  const [W, H] = L.size;
  if (W !== row.width_tiles || H !== row.height_tiles) bad(`size ${W}x${H} differs from rooms.csv ${row.width_tiles}x${row.height_tiles}`);
  if (L.grid.length !== H || L.grid.some((r) => r.length !== W)) { bad(`grid must be ${W} columns x ${H} rows`); return p; }
  const ch = (c: number, r: number): string => L.grid[r]?.[c] ?? '#';

  // border: wall, except door cells
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if ((r === 0 || r === H - 1 || c === 0 || c === W - 1) && ch(c, r) !== '#' && ch(c, r) !== 'D') bad(`border cell ${c},${r} must be wall or door`);
  // doors
  const doorCells = (side: 'west' | 'east'): number[] => { const c = side === 'west' ? 0 : W - 1; return L.grid.map((_, r) => r).filter((r) => ch(c, r) === 'D'); };
  for (let r = 0; r < H; r++) for (let c = 1; c < W - 1; c++) if (ch(c, r) === 'D') bad(`door cell ${c},${r} is not on the west or east wall`);
  for (const side of ['west', 'east'] as const) {
    const rowsOf = doorCells(side), listed = L.doors.filter((d) => d.side === side);
    if (listed.length > 1) bad(`two doors on the ${side} wall`);
    if (listed.length === 1 && rowsOf.join() !== DOOR_ROWS.join()) bad(`${side} door must open rows ${DOOR_ROWS.join(',')} (found ${rowsOf.join(',') || 'none'})`);
    if (listed.length === 0 && rowsOf.length) bad(`${side} wall has door cells but no door entry`);
  }
  const exit = L.doors.find((d) => d.role === 'exit'), entry = L.doors.find((d) => d.role === 'entry');
  if (!entry) bad('no entry door');
  if (entry?.side !== 'west' && entry) bad('the entry door is on the west wall');
  const prev = rooms.find((r) => r.next === L.id);
  const expectPrev = prev?.id ?? 'room_abode_hub';
  if (entry && entry.to !== expectPrev) bad(`entry door leads back to ${entry.to}, rooms.csv says ${expectPrev}`);
  if (row.next) { if (!exit) bad('rooms.csv has a next room but there is no exit door'); else if (exit.to !== row.next) bad(`exit door leads to ${exit.to}, rooms.csv next is ${row.next}`); }
  else if (exit) bad('exit door in a room with no next');
  if (exit && exit.side !== 'east') bad('the exit door is on the east wall');

  // props
  const used = new Map<string, string>();
  const blocked = new Set<string>();
  const place = (what: string, c: number, r: number): boolean => {
    const k = key(c, r);
    if (used.has(k)) { bad(`${what} at ${k} shares a cell with ${used.get(k)}`); return false; }
    used.set(k, what); return true;
  };
  const walkable = (c: number, r: number): boolean => c > 0 && r > 0 && c < W - 1 && r < H - 1 && (ch(c, r) === '.' || ch(c, r) === '~');
  for (const pr of L.props) {
    if (!approved.has(pr.id)) bad(`${pr.id} is not an approved art id`);
    const [c, r] = pr.at;
    if (!walkable(c, r)) { bad(`${pr.id} at ${c},${r} is not on a floor cell`); continue; }
    if (!place(pr.id, c, r)) continue;
    if (BLOCKING_PROPS.has(pr.id)) { blocked.add(key(c, r)); if (ch(c, r) === '~') bad(`${pr.id} at ${c},${r} stands in a blood pool`); }
    if (pr.id === 'prop_teleport_array') { if (!pr.to || !rooms.some((x) => x.id === pr.to) ) bad(`teleport array at ${c},${r} needs a valid "to" room`); } else if (pr.to) bad(`${pr.id} has "to"`);
  }
  // start and spawns
  const [sc, sr] = L.player_start;
  if (!walkable(sc, sr)) bad(`player_start ${sc},${sr} is not a floor cell`);
  else if (blocked.has(key(sc, sr))) bad('player_start is under a prop');
  const counts = new Map<string, number>();
  L.waves.forEach((w, wi) => w.spawns.forEach((s) => {
    const [c, r] = s.at;
    counts.set(s.mob, (counts.get(s.mob) ?? 0) + 1);
    if (!approved.has(s.mob)) bad(`${s.mob} is not an approved art id`);
    if (!walkable(c, r)) { bad(`wave ${wi + 1} ${s.mob} at ${c},${r} is not on a floor cell`); return; }
    place(s.mob, c, r);
    if (blocked.has(key(c, r))) bad(`${s.mob} at ${c},${r} is under a prop`);
    if (s.mob === 'mob_blood_pool_lurker' !== (ch(c, r) === '~')) bad(`${s.mob} at ${c},${r}: only the lurker goes on a blood pool, and it must`);
    if (Math.hypot(c - sc, r - sr) < MIN_SPAWN_DISTANCE) bad(`${s.mob} at ${c},${r} is closer than ${MIN_SPAWN_DISTANCE} tiles to the start`);
  }));
  const want = new Map<string, number>();
  for (const part of String(row.mobs ?? '').split(';').filter(Boolean)) want.set(part.split(':')[0]!, Number(part.split(':')[1]));
  if (row.boss) want.set(row.boss, 1);
  for (const k of new Set([...want.keys(), ...counts.keys()])) if ((want.get(k) ?? 0) !== (counts.get(k) ?? 0)) bad(`${k}: ${counts.get(k) ?? 0} spawned, rooms.csv says ${want.get(k) ?? 0}`);
  if ((row.kind === 'combat' || row.kind === 'boss') && L.waves.length === 0) bad('a fight room needs waves');
  if ((row.kind === 'reward' || row.kind === 'abode') && L.waves.length) bad(`${row.kind} room has waves`);

  // reachability: flood from the start over walkable cells that no prop blocks
  const seen = new Set<string>();
  const stack: [number, number][] = walkable(sc, sr) ? [[sc, sr]] : [];
  while (stack.length) {
    const [c, r] = stack.pop()!;
    const k = key(c, r);
    if (seen.has(k) || !walkable(c, r) || blocked.has(k)) continue;
    seen.add(k);
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  let lost = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (walkable(c, r) && !blocked.has(key(c, r)) && !seen.has(key(c, r))) lost++;
  if (lost) bad(`${lost} walkable cells cannot be reached from the start`);
  for (const d of L.doors) { const c = d.side === 'west' ? 1 : W - 2; for (const r of DOOR_ROWS) if (!seen.has(key(c, r))) bad(`the cell in front of the ${d.side} door (${c},${r}) is not reachable`); }
  return p;
}

export function validateAll(rooms: RoomRow[]): string[] {
  const layouts = loadLayouts(), approved = approvedArtIds(), p: string[] = [];
  for (const [file, L] of layouts) p.push(...validateLayout(file, L, rooms, approved));
  for (const r of rooms) if ((r.kind === 'combat' || r.kind === 'boss' || r.kind === 'reward') && !layouts.has(r.id)) p.push(`rooms.csv ${r.id}: no content/rooms/${r.id}.yaml`);
  return p;
}
