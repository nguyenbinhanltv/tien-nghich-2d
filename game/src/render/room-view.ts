// Draws the room the sim is in (world.grid rows + the layout's props) with the real ts_blood_valley tiles and props: floor
// variants chosen by a hash of the cell (identical on every run), blood pools, 2.5D wall faces, wall tops, and the door sprites
// (locked / open) that follow the grid state the sim keeps. One RoomView per scene; `show()` rebuilds it on a room change.
import type Phaser from 'phaser';
import { frameIndex } from './animator.ts';
import { doorSpots, propFrames, tileKind } from './room-tiles.ts';
import type { DoorSpot } from './room-tiles.ts';
import type { KilnFrames } from './kiln-loader.ts';

/** Tile frames of a room's tileset (rooms.csv `tileset`). Hằng Nhạc: stone slabs with a garden patch every few tiles; no blood pools. */
const SETS: Record<string, { dir: string; floor(c: number, r: number, h: number): string; face: string; cap: string; pool: boolean }> = {
  ts_blood_valley: { dir: 'tilesets/ts_blood_valley/', floor: (_c, _r, h) => `floor_blood_variants_f0_${h % 4}`, face: 'wall_face_f0_', cap: 'wall_top_blob47_f0_46', pool: true },
  ts_hengyue: { dir: 'tilesets/ts_hengyue/', floor: (c, r, h) => `${((c >> 2) + (r >> 2)) % 4 === 0 ? 'floor_garden_variants' : 'floor_variants'}_f0_${h % 4}`, face: 'wall_face_f0_', cap: 'wall_top_blob47_f0_46', pool: false },
};
const TILE = 16;
const DOOR_LOCKED = 'props/prop_room_door/locked_none_0', DOOR_OPEN = 'props/prop_room_door/open_none_0';
const hash = (x: number, y: number): number => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

interface DoorView { img: Phaser.GameObjects.Image; spot: DoorSpot }
interface PropView { img: Phaser.GameObjects.Image; frames: string[] }

export class RoomView {
  private readonly scene: Phaser.Scene;
  private readonly frames: KilnFrames;
  private objects: Phaser.GameObjects.GameObject[] = [];
  private doors: DoorView[] = [];
  private props: PropView[] = [];
  roomId = '';

  constructor(scene: Phaser.Scene, frames: KilnFrames) { this.scene = scene; this.frames = frames; }

  private img(frame: string, x: number, y: number, depth: number, origin: [number, number] = [0, 0]): Phaser.GameObjects.Image {
    const i = this.scene.add.image(x, y, this.frames.pageOf(frame), frame).setOrigin(origin[0], origin[1]).setDepth(depth);
    this.objects.push(i);
    return i;
  }

  /** Rebuild for a room. `props` come from the layout (content/rooms), `rows` from the sim's grid. */
  show(roomId: string, rows: readonly string[], props: readonly { id: string; at: [number, number] }[], tileset = 'ts_blood_valley'): void {
    const S = SETS[tileset] ?? SETS['ts_blood_valley']!, T = S.dir;
    for (const o of this.objects) o.destroy();
    this.objects = []; this.doors = []; this.props = [];
    this.roomId = roomId;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r]!.length; c++) {
        const k = tileKind(rows, c, r), h = hash(c, r), x = c * TILE, y = r * TILE;
        if (k === 'wall-face') this.img(`${T}${S.face}${h % 12}`, x, y - TILE, 2);
        else if (k === 'wall-cap') this.img(`${T}${S.cap}`, x, y, 2);
        else {
          this.img(`${T}${S.floor(c, r, h)}`, x, y, 0);
          if (k === 'pool' && S.pool) this.img(`${T}blood_pool_blob47_f0_46`, x, y, 1);
        }
      }
    }
    for (const p of props) {
      const frames = propFrames((prefix) => this.frames.sequence(prefix), p.id);
      if (!frames.length) continue; // no art for this prop: not drawn
      // base on the bottom of its tile, centred; depth sorts with the actors by the base line
      const img = this.img(frames[0]!, p.at[0] * TILE + TILE / 2, (p.at[1] + 1) * TILE, 10 + (p.at[1] + 1) * TILE, [0.5, 1]);
      this.props.push({ img, frames });
    }
    for (const spot of doorSpots(rows)) {
      // the door is 32 wide: centred on its wall column, spanning its two cells
      const img = this.img(DOOR_LOCKED, spot.col * TILE + TILE / 2, spot.row * TILE, 3, [0.5, 0]);
      this.doors.push({ img, spot });
    }
  }

  /** Door sprites follow the sim's grid (open/locked); idle props animate from the tick. */
  update(rows: readonly string[], tick: number): void {
    const spots = doorSpots(rows);
    for (const d of this.doors) {
      const open = spots.find((s) => s.col === d.spot.col && s.row === d.spot.row)?.open ?? d.spot.open;
      const f = open ? DOOR_OPEN : DOOR_LOCKED;
      if (d.img.frame.name !== f) d.img.setTexture(this.frames.pageOf(f), f);
    }
    for (const p of this.props) if (p.frames.length > 1) {
      const f = p.frames[frameIndex(p.frames.length, 'idle', 0, tick)]!;
      if (p.img.frame.name !== f) p.img.setTexture(this.frames.pageOf(f), f);
    }
  }
}
