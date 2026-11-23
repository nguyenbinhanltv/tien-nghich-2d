// Pixel HUD (E8.1) drawn at the logical 384x216 from the real "ui_hud_bars" frames: bar width cropped to the current level with
// the left end fixed, numbers and the boss name in the pixel font of ui/pixel-font.ts (full Vietnamese diacritics; palette ink_06
// with an ink_01 outline), a counter-window bar and a dodge-ready pip whose SHAPES differ (bar vs diamond) so nothing relies on
// colour alone. Pinned to the screen (scroll factor 0), so camera shake moves the world and never the HUD. Menus, titles and the
// result banner use the sharp DOM layer instead (owner decision: pixel HUD, sharp menus).
import Phaser from 'phaser';
import { COMBAT } from '../contracts/combat.ts';
import type { WorldState } from '../contracts/world.ts';
import { BAR_H, BAR_W, barCropWidth, BOSS_NAME_MAX_W, HUD_POS, ratio } from '../ui/hud-layout.ts';
import { DIGIT_H, textPixels, wrapText } from '../ui/pixel-text.ts';
import type { TextPixels } from '../ui/pixel-text.ts';
import { activeStatuses, STATUS_IDS, statusFrame, statusSlot } from '../ui/status-icons.ts';
import type { StatusId } from '../ui/status-icons.ts';
import type { KilnFrames } from './kiln-loader.ts';

// palette ids (tools/generators/palette.json, 43 colours, nothing invented): ink_01, ink_06, ink_02, bronze_05, bronze_02
const INK = 0x14101a, INK_LIGHT = 0xd4d0d8, SLOT = 0x2c2733, BRONZE = 0xe0b030, BRONZE_DIM = 0x63400f;
const F = { hp: 'ui/ui_hud_bars/hp_none_0', boss: 'ui/ui_hud_bars/boss_hp_none_0' };

/** Draw lit pixels with a 1-px ink outline (4-neighbour), then the text colour on top. */
export function drawText(g: Phaser.GameObjects.Graphics, t: TextPixels, ox: number, oy: number, colour: number = INK_LIGHT): void {
  g.fillStyle(INK, 1);
  for (const [px, py] of t.pixels) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) g.fillRect(ox + px + dx, oy + py + dy, 1, 1);
  g.fillStyle(colour, 1);
  for (const [px, py] of t.pixels) g.fillRect(ox + px, oy + py, 1, 1);
}

class Bar {
  private readonly slot: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Image;
  private readonly digits: Phaser.GameObjects.Graphics;
  private shown = '';
  private readonly x: number;
  private readonly y: number;
  private readonly numberRight: boolean;
  constructor(scene: Phaser.Scene, frames: KilnFrames, frame: string, x: number, y: number, numberRight = false) {
    this.x = x; this.y = y; this.numberRight = numberRight;
    this.slot = scene.add.graphics().setScrollFactor(0).setDepth(100);
    this.slot.fillStyle(INK, 1).fillRect(x - 1, y - 1, BAR_W + 2, BAR_H + 2);
    this.slot.fillStyle(SLOT, 1).fillRect(x, y, BAR_W, BAR_H);
    this.fill = scene.add.image(x, y, frames.pageOf(frame), frame).setOrigin(0, 0).setScrollFactor(0).setDepth(101);
    this.digits = scene.add.graphics().setScrollFactor(0).setDepth(102);
  }
  set(value: number, max: number): void {
    const w = barCropWidth(value, max);
    this.fill.setVisible(w > 0);
    if (w > 0) this.fill.setCrop(0, 0, w, BAR_H);
    const text = `${Math.max(0, Math.ceil(value))}/${Math.ceil(max)}`;
    if (text === this.shown) return;
    this.shown = text;
    this.digits.clear();
    // the player's number sits under the bar; the boss number to the right of its bar (the name goes under it)
    if (this.numberRight) drawText(this.digits, textPixels(text), this.x + BAR_W + 5, this.y + 1);
    else drawText(this.digits, textPixels(text), this.x, this.y + BAR_H + 3);
  }
  setVisible(v: boolean): void { this.slot.setVisible(v); this.fill.setVisible(v && this.fill.visible); this.digits.setVisible(v); }
}

export class Hud {
  private readonly player: Bar;
  private readonly boss: Bar;
  private readonly counter: Phaser.GameObjects.Graphics;
  private readonly bossName: Phaser.GameObjects.Graphics;
  private bossNameText = '';
  private lastCounter = -1;
  private lastReady = -1;
  private readonly statusIcons: Record<StatusId, Phaser.GameObjects.Image>;

  private readonly names: (kind: string) => string;
  constructor(scene: Phaser.Scene, frames: KilnFrames, names: (kind: string) => string = () => '') {
    this.names = names;
    this.player = new Bar(scene, frames, F.hp, HUD_POS.playerBar.x, HUD_POS.playerBar.y);
    this.boss = new Bar(scene, frames, F.boss, HUD_POS.bossBar.x, HUD_POS.bossBar.y, true);
    this.bossName = scene.add.graphics().setScrollFactor(0).setDepth(102);
    this.counter = scene.add.graphics().setScrollFactor(0).setDepth(102);
    // status icons: lit only while active (nothing to show at rest), one fixed slot each so they never jump around
    this.statusIcons = Object.fromEntries(STATUS_IDS.map((id, i) => {
      const slot = statusSlot(i), frame = statusFrame(id);
      return [id, scene.add.image(slot.x, slot.y, frames.pageOf(frame), frame).setOrigin(0, 0).setScrollFactor(0).setDepth(102).setVisible(false)];
    })) as Record<StatusId, Phaser.GameObjects.Image>;
  }

  update(w: WorldState): void {
    const p = w.actors.find((a) => a.role === 'player');
    const b = w.actors.find((a) => a.role === 'boss');
    if (p) this.player.set(p.hp, p.hpMax);
    this.boss.setVisible(!!b && b.hp > 0);
    this.bossName.setVisible(!!b && b.hp > 0);
    if (b) {
      this.boss.set(b.hp, b.hpMax);
      const name = this.names(b.kind);
      if (name !== this.bossNameText) {
        this.bossNameText = name;
        this.bossName.clear();
        // at most two lines, kept clear of the minimap column on the right (hud-layout BOSS_NAME_MAX_W)
        let y = HUD_POS.bossBar.y + BAR_H + 3;
        for (const line of wrapText(name, BOSS_NAME_MAX_W, 2)) {
          const t = textPixels(line);
          drawText(this.bossName, t, HUD_POS.bossBar.x, y);
          y += t.h + 3;
        }
      }
    }
    if (!p) return;
    const active = activeStatuses(p);
    for (const id of STATUS_IDS) this.statusIcons[id].setVisible(active[id]);
    // counter window: a bar under the hp digits that drains; dodge ready: a diamond that is lit when the dodge can be used
    const win = Math.round(ratio(p.combat.counterWindow, COMBAT.counterWindow) * 24);
    const ready = p.combat.cool === 0 && p.combat.dash === 0 ? 1 : 0;
    if (win === this.lastCounter && ready === this.lastReady) return;
    this.lastCounter = win; this.lastReady = ready;
    const x = HUD_POS.playerBar.x, y = HUD_POS.playerBar.y + BAR_H + 3 + DIGIT_H + 3;
    const g = this.counter;
    g.clear();
    g.fillStyle(INK, 1).fillRect(x - 1, y - 1, 26, 5);
    g.fillStyle(BRONZE_DIM, 1).fillRect(x, y, 24, 3);
    if (win > 0) g.fillStyle(BRONZE, 1).fillRect(x, y, win, 3);
    // diamond (5x5) at the right of the bar
    const dx = x + 30, dy = y - 1;
    const px = [[2, 0], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3], [3, 3], [2, 4]];
    for (const [a, c] of px) g.fillStyle(INK, 1).fillRect(dx + a! - 0, dy + c!, 1, 1);
    g.fillStyle(ready ? BRONZE : BRONZE_DIM, 1);
    for (const [a, c] of px) g.fillRect(dx + a!, dy + c!, 1, 1);
  }
}
