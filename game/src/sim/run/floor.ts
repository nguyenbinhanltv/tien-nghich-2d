// The floor: the run walks the rooms of rooms.csv from door to door (abode -> room_bs_1 .. room_bs_9 -> room_bs_boss).
// A room is loaded from its layout (content/rooms), its waves spawn one after the other, the exit door opens when the last
// wave is dead, and walking through the open door goes to the next room. The boss room ends the run through the mode
// machine ('won' -> settleRun). Rooms keep their order from the `next` column, so the room index of the run (run.room) is the
// position in the chain.
import { BLOCKING_PROPS, type RoomRow, type ContentApi, type BossRow, type RoomLayout } from '../../contracts/content.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';
import { clearProjectiles } from '../pool.ts';
import { findPlayer, spawnActor } from '../actors.ts';
import { spawnMob } from '../ai/index.ts';
import { setMode } from '../systems/combat.ts';
import { pressureAtFloor } from '../../contracts/run.ts';
import { advanceRoom, startRun } from './run.ts';

export const TILE = 16;
const PLAYER_HP = 6, PLAYER_RADIUS = 5, BOSS_RADIUS = 19, BOSS_FIRST_ATTACK = 84;

/** Biomes a run can start in, in rooms.csv order: the first is the default (the one the abode room leads to). */
export function floorBiomes(content: ContentApi): string[] {
  const rows = content.ids('rooms').map((id) => content.get<RoomRow>('rooms', id));
  const abode = rows.find((r) => r.kind === 'abode');
  const first = abode?.next ? rows.find((r) => r.id === abode.next)?.biome : undefined;
  const all = rows.filter((r) => r.kind !== 'abode').map((r) => r.biome).filter((b, i, l) => l.indexOf(b) === i);
  return first ? [first, ...all.filter((b) => b !== first)] : all;
}

/** The rooms of a biome in play order: from the room nothing leads to (the abode's `next` for the default biome), along `next`. */
export function floorChain(content: ContentApi, biome?: string): string[] {
  const rows = content.ids('rooms').map((id) => content.get<RoomRow>('rooms', id));
  const want = biome ?? floorBiomes(content)[0];
  const pointed = new Set(rows.map((r) => r.next).filter(Boolean));
  const abode = rows.find((r) => r.kind === 'abode');
  const head = rows.find((r) => r.biome === want && r.kind !== 'abode' && (!pointed.has(r.id) || abode?.next === r.id));
  const out: string[] = [];
  let id = head?.id;
  while (id && !out.includes(id)) { out.push(id); id = content.get<RoomRow>('rooms', id).next || undefined; }
  return out;
}

const center = (c: number, r: number): { x: number; y: number } => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

function buildRows(L: RoomLayout): string[] {
  const rows = L.grid.map((r) => r.split(''));
  for (const p of L.props) if (BLOCKING_PROPS.has(p.id)) rows[p.at[1]]![p.at[0]] = 'P';
  return rows.map((r) => r.join(''));
}

function setDoor(world: WorldState, L: RoomLayout, role: 'entry' | 'exit', ch: 'D' | 'O'): void {
  const side = L.doors.find((d) => d.role === role)?.side;
  if (!side || !world.grid) return;
  const d = world.stage?.doors.find((x) => x.role === role);
  if (d) d.open = ch === 'O';
  const col = side === 'west' ? 0 : L.size[0] - 1;
  world.grid.rows = world.grid.rows.map((row) => row.split('').map((c, i) => (i === col && (c === 'D' || c === 'O') ? ch : c)).join(''));
}

function spawnWave(world: WorldState, content: ContentApi, L: RoomLayout, wave: number, events: GameEvent[]): void {
  for (const s of L.waves[wave - 1]?.spawns ?? []) {
    const { x, y } = center(s.at[0], s.at[1]);
    if (s.mob.startsWith('boss_')) {
      const b = spawnActor(world, s.mob, x, y, content.get<BossRow>('bosses', s.mob).hp, events, BOSS_RADIUS);
      b.facing = 'west'; b.ai.state = 'stalk'; b.ai.timer = BOSS_FIRST_ATTACK;
    } else spawnMob(world, content, s.mob, x, y, events, s.elite === true);
  }
  events.push({ type: 'wave-spawned', tick: world.tick, wave, of: L.waves.length });
}

/** Load a room: the player to its start, the old enemies, shots and telegraphs gone, wave 1 on the field, the entry door shut. */
export function enterRoom(world: WorldState, content: ContentApi, roomId: string, events: GameEvent[]): void {
  const L = content.get<RoomLayout>('room_layouts', roomId);
  const player = findPlayer(world);
  world.actors = world.actors.filter((a) => a.role === 'player');
  world.hazards = []; clearProjectiles(world.projectiles);
  const [cols, rows] = L.size;
  world.room = { minX: 4, minY: 2 * TILE + 4, maxX: cols * TILE - 4, maxY: (rows - 1) * TILE - 4 };
  world.grid = { tile: TILE, rows: buildRows(L) };
  world.stage = {
    room: roomId, wave: 1, waves: L.waves.length, cleared: L.waves.length === 0, gatePending: false,
    doors: L.doors.map((d) => ({ side: d.side, role: d.role, to: d.to, open: false })), pressure: pressureAtFloor(0),
  };
  if (player) { const s = center(L.player_start[0], L.player_start[1]); player.pos.x = s.x; player.pos.y = s.y; player.vel.x = 0; player.vel.y = 0; player.combat.dash = 0; player.combat.action = 0; }
  setDoor(world, L, 'entry', 'D');
  setDoor(world, L, 'exit', world.stage.cleared ? 'O' : 'D');
  events.push({ type: 'room-entered', tick: world.tick, room: roomId });
  if (L.waves.length) spawnWave(world, content, L, 1, events);
  setMode(world, 'playing', events);
}

/** Start a run on the floor: a fresh player (if none), the run state, and the first room of `biome` (default: the abode's). */
export function startFloor(world: WorldState, content: ContentApi, runId: number, events: GameEvent[], biome?: string): void {
  if (!findPlayer(world)) spawnActor(world, 'player', 0, 0, PLAYER_HP, events, PLAYER_RADIUS);
  startRun(world, runId);
  enterRoom(world, content, floorChain(content, biome)[0] as string, events);
}

const alive = (world: WorldState): number => world.actors.reduce((n, a) => n + (a.role !== 'player' && a.hp > 0 ? 1 : 0), 0);

/** Once per tick after the enemies moved: next wave, door, and the walk through the door. No-op outside a floor. */
export function floorSystem(world: WorldState, content: ContentApi, events: GameEvent[]): void {
  const st = world.stage, player = findPlayer(world);
  if (!st || !player || world.mode !== 'playing') return;
  const L = content.get<RoomLayout>('room_layouts', st.room);
  if (!st.cleared && alive(world) === 0) {
    if (st.wave < st.waves) { st.wave++; spawnWave(world, content, L, st.wave, events); }
    else if (world.mode === 'playing' && L.doors.some((d) => d.role === 'exit')) { st.cleared = true; setDoor(world, L, 'exit', 'O'); events.push({ type: 'door-opened', tick: world.tick, room: st.room }); }
  }
  if (!st.cleared) return;
  const exit = L.doors.find((d) => d.role === 'exit');
  if (!exit || !world.grid) return;
  const col = Math.floor(player.pos.x / TILE), row = Math.floor(player.pos.y / TILE);
  if (world.grid.rows[row]?.[col] !== 'O' || col !== L.size[0] - 1) return; // in the doorway of the exit
  const next = content.get<RoomRow>('rooms', st.room).next;
  if (!next) return;
  if (world.run?.outcome === 'active') {
    const r = advanceRoom(world, events);
    if (r === 'gate-pending' && !st.gatePending) events.push({ type: 'gate-pending', tick: world.tick, room: st.room });
    st.gatePending = r === 'gate-pending';
    if (r !== 'ok') return;
  }
  enterRoom(world, content, next, events);
}
