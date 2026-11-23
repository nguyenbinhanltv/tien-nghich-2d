// Pixel HUD (E8.1) drawn at the logical 384x216 from the real "ui_hud_bars" frames: bar width cropped to the current level with
// the left end fixed, 3x5 pixel digits (palette ink_06 with an ink_01 outline), a counter-window bar and a dodge-ready pip whose
// SHAPES differ (bar vs diamond) so nothing relies on colour alone. Pinned to the screen (scroll factor 0), so camera shake
// moves the world and never the HUD. Text with diacritics is not drawn here: names, menus and results use the sharp DOM layer.
import Phaser from 'phaser';
import { COMBAT } from '../contracts/combat.ts';
import type { WorldState } from '../contracts/world.ts';
import { BAR_H, BAR_W, barCropWidth, digitPixels, HUD_POS, ratio } from '../ui/hud-layout.ts';
import type { KilnFrames } from './kiln-loader.ts';

const INK = 0x14101a, INK_LIGHT = 0xd4d0d8, SLOT = 0x2a1a2a, BRONZE = 0xe0b030, BRONZE_DIM = 0x5a4a28;
const F = { hp: 'ui/ui_hud_bars/hp_none_0', boss: 'ui/ui_hud_bars/boss_hp_none_0' };

class Bar {
  private readonly slot: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Image;
  private readonly digits: Phaser.GameObjects.Graphics;
  private shown = '';
  private readonly x: number;
  private readonly y: number;
  constructor(scene: Phaser.Scene, frames: KilnFrames, frame: string, x: number, y: number) {
    this.x = x; this.y = y;
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
    const d = digitPixels(text);
    const ox = this.x, oy = this.y + BAR_H + 3;
    this.digits.clear();
    this.digits.fillStyle(INK, 1);
    for (const [px, py] of d.pixels) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) this.digits.fillRect(ox + px + dx, oy + py + dy, 1, 1);
    this.digits.fillStyle(INK_LIGHT, 1);
    for (const [px, py] of d.pixels) this.digits.fillRect(ox + px, oy + py, 1, 1);
  }
  setVisible(v: boolean): void { this.slot.setVisible(v); this.fill.setVisible(v && this.fill.visible); this.digits.setVisible(v); }
}

export class Hud {
  private readonly player: Bar;
  private readonly boss: Bar;
  private readonly counter: Phaser.GameObjects.Graphics;
  private lastCounter = -1;
  private lastReady = -1;

  constructor(scene: Phaser.Scene, frames: KilnFrames) {
    this.player = new Bar(scene, frames, F.hp, HUD_POS.playerBar.x, HUD_POS.playerBar.y);
    this.boss = new Bar(scene, frames, F.boss, HUD_POS.bossBar.x, HUD_POS.bossBar.y);
    this.counter = scene.add.graphics().setScrollFactor(0).setDepth(102);
  }

  update(w: WorldState): void {
    const p = w.actors.find((a) => a.role === 'player');
    const b = w.actors.find((a) => a.role === 'boss');
    if (p) this.player.set(p.hp, p.hpMax);
    this.boss.setVisible(!!b && b.hp > 0);
    if (b) this.boss.set(b.hp, b.hpMax);
    if (!p) return;
    // counter window: a bar under the hp digits that drains; dodge ready: a diamond that is lit when the dodge can be used
    const win = Math.round(ratio(p.combat.counterWindow, COMBAT.counterWindow) * 24);
    const ready = p.combat.cool === 0 && p.combat.dash === 0 ? 1 : 0;
    if (win === this.lastCounter && ready === this.lastReady) return;
    this.lastCounter = win; this.lastReady = ready;
    const x = HUD_POS.playerBar.x, y = HUD_POS.playerBar.y + BAR_H + 12;
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
