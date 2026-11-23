// Minimap + floor HUD (E3.3), top-right of the 384x216 view: the real ui_minimap icons laid out as a snake of rooms, 1-px
// connectors, the floor name in the pixel font (full Vietnamese diacritics) and the room counter. Pinned to the screen
// (scroll factor 0). Room kinds differ by SHAPE (boss/shrine/room icons) as well as colour; "?" for rooms not reached.
import Phaser from 'phaser';
import { VIEW_W } from '../contracts/world.ts';
import { canDraw, rasterize } from '../ui/pixel-font.ts';
import { cellOrigin, chainFrom, CELL, connector, floorCounter, iconFrame, mapSize, roomStates, snakeLayout } from '../ui/minimap-layout.ts';
import type { MiniRoom, RoomRow } from '../ui/minimap-layout.ts';
import type { KilnFrames } from './kiln-loader.ts';

// palette ids ink_01 (outline), ink_06 (text), bronze_02 (connector), bronze_05 (visited connector)
const INK = 0x14101a, TEXT = 0xd4d0d8, LINE = 0x63400f, LINE_DONE = 0xe0b030;
const BLINK_MS = 450;
/** Distance from the screen edge in logical px (same as the pixel HUD; larger on the sides for notches). */
const MARGIN = { x: 8, y: 6 } as const;

export class FloorHud {
  private readonly scene: Phaser.Scene;
  private readonly frames: KilnFrames;
  private rooms: MiniRoom[] = [];
  private icons: Phaser.GameObjects.Image[] = [];
  private readonly lines: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Graphics;
  private origin = { x: 0, y: 0 };
  private current = -1;
  private label = '';
  private shownKey = '';

  constructor(scene: Phaser.Scene, frames: KilnFrames) {
    this.scene = scene; this.frames = frames;
    this.lines = scene.add.graphics().setScrollFactor(0).setDepth(100);
    this.text = scene.add.graphics().setScrollFactor(0).setDepth(102);
  }

  /** The rooms of the floor, in play order, and the name shown next to the map. */
  setFloor(rows: readonly RoomRow[], startId: string, label: string): void {
    this.rooms = chainFrom(rows, startId).filter((r) => r.kind !== 'abode'); // the abode is home, not a floor room
    this.label = label;
    const size = mapSize(this.rooms.length);
    this.origin = { x: VIEW_W - MARGIN.x - size.w, y: MARGIN.y };
    for (const i of this.icons) i.destroy();
    this.icons = this.rooms.map((_, i) => {
      const c = snakeLayout(this.rooms.length)[i]!;
      const o = cellOrigin(c.col, c.row);
      const f = iconFrame(this.rooms[i]!.kind, 'unknown', 0);
      return this.scene.add.image(this.origin.x + o.x, this.origin.y + o.y, this.frames.pageOf(f), f).setOrigin(0, 0).setScrollFactor(0).setDepth(101);
    });
    this.shownKey = '';
  }

  /** `current` = index into the floor rooms (the run state `room`); -1 hides the map. */
  update(current: number, now: number): void {
    this.current = current;
    const show = this.rooms.length > 0 && current >= 0;
    this.lines.setVisible(show); this.text.setVisible(show);
    for (const i of this.icons) i.setVisible(show);
    if (!show) return;
    const blink = (Math.floor(now / BLINK_MS) % 2) as 0 | 1;
    const states = roomStates(this.rooms.length, current);
    this.rooms.forEach((r, i) => {
      const f = iconFrame(r.kind, states[i]!, blink);
      this.icons[i]!.setTexture(this.frames.pageOf(f), f);
    });
    const key = `${current}|${this.label}|${this.rooms.length}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    // connectors: lit up to the current room
    const layout = snakeLayout(this.rooms.length);
    this.lines.clear();
    for (let i = 1; i < layout.length; i++) {
      const c = connector(layout[i - 1]!, layout[i]!);
      this.lines.fillStyle(i <= current ? LINE_DONE : LINE, 1).fillRect(this.origin.x + c.x, this.origin.y + c.y, c.w, c.h);
    }
    this.drawText();
  }

  private drawText(): void {
    const g = this.text;
    g.clear();
    const label = [...this.label].every(canDraw) ? this.label : '';
    const lines = [label, floorCounter(this.current, this.rooms.length)].filter(Boolean);
    // right-aligned to the left of the map, one line under the other
    let y = MARGIN.y;
    for (const t of lines) {
      const b = rasterize(t);
      const x0 = this.origin.x - 6 - b.w;
      g.fillStyle(INK, 1);
      for (let py = 0; py < b.h; py++) for (let px = 0; px < b.w; px++) if (b.px[py * b.w + px]) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) g.fillRect(x0 + px + dx, y + py + dy, 1, 1);
      g.fillStyle(TEXT, 1);
      for (let py = 0; py < b.h; py++) for (let px = 0; px < b.w; px++) if (b.px[py * b.w + px]) g.fillRect(x0 + px, y + py, 1, 1);
      y += b.h + 2;
    }
  }

  get roomCount(): number { return this.rooms.length; }
  /** Index of the room whose boss is `bossKind`'s room: the arena fight is the boss room of the floor. */
  indexOfKind(kind: string): number { return this.rooms.findIndex((r) => r.kind === kind); }
  get hasMap(): boolean { return CELL > 0 && this.icons.length > 0; }
}
