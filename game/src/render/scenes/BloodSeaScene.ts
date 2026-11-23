// Minimal Blood Sea room for the phone playtest (first deliverable of lane C). Floor and wall tiles of ts_blood_valley,
// the player and a few mobs from the real mobile atlas, a fixed 384x216 view. Tiles are placed by a hash of the cell so the
// picture is identical on every run (golden images later).
import Phaser from 'phaser';
import { FixedLoop, NO_INPUT } from '../../sim/loop.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { VIEW_H, VIEW_W } from '../../contracts/world.ts';
import { frameIndex, resolveClip } from '../animator.ts';
import { KilnFrames, originOf, preloadKiln } from '../kiln-loader.ts';
import { ArenaStub } from '../demo/arena-stub.ts';

export interface SceneHost {
  /** Latest input for this render frame (dash/fire are one-shot). */
  sample(): InputFrame;
  paused(): boolean;
  /** Sim events of this render frame (audio, juice). The array is cleared after the call. */
  onEvents?(events: readonly GameEvent[], world: WorldState): void;
  /** Golden-image mode: advance a fixed number of ticks once, then hold still (no wall-clock input). */
  frozen?: boolean;
}

const T = 'tilesets/ts_blood_valley/';
const cellHash = (x: number, y: number): number => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export class BloodSeaScene extends Phaser.Scene {
  private readonly host: SceneHost;
  private frames!: KilnFrames;
  private readonly stub = new ArenaStub();
  private readonly loop = new FixedLoop();
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private input0: InputFrame | null = null;

  constructor(host: SceneHost) {
    super('blood-sea');
    this.host = host;
  }

  preload(): void { preloadKiln(this); }

  create(): void {
    this.frames = new KilnFrames(this);
    this.cameras.main.setBackgroundColor('#14101a');
    this.buildRoom();
    if (this.host.frozen) for (let i = 0; i < 120; i++) this.stub.tick(NO_INPUT);
  }

  private put(name: string, x: number, y: number, depth: number): void {
    this.add.image(x, y, this.frames.pageOf(name), name).setOrigin(0, 0).setDepth(depth);
  }

  private buildRoom(): void {
    const cols = VIEW_W / 16;
    const rows = Math.ceil(VIEW_H / 16);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const h = cellHash(cx, cy);
        this.put(`${T}floor_blood_variants_f0_${h % 4}`, cx * 16, cy * 16, 0);
        if (cy > 3 && h % 23 === 0) this.put(`${T}deco_f0_${(h >>> 8) % 16}`, cx * 16, cy * 16, 1);
      }
    }
    // back wall: 16x32 faces along the top, drawn over the floor
    for (let cx = 0; cx < cols; cx++) this.put(`${T}wall_face_f0_${cellHash(cx, 99) % 12}`, cx * 16, 16, 2);
  }

  override update(_t: number, deltaMs: number): void {
    if (!this.host.paused() && !this.host.frozen) {
      const inp = this.host.sample();
      this.input0 = inp;
      let first = true;
      this.loop.advance(deltaMs, () => {
        // dash/fire are one-shot: only the first tick of the frame sees them
        this.stub.tick(first ? inp : { ...inp, dash: false, fire: false });
        first = false;
      });
      if (this.stub.events.length) { this.host.onEvents?.(this.stub.events, this.stub.world); this.stub.events.length = 0; }
    }
    this.draw();
  }

  private draw(): void {
    const w = this.stub.world;
    const seen = new Set<number>();
    for (const a of w.actors) {
      seen.add(a.id);
      this.drawActor(a, w.tick);
    }
    for (const [id, s] of this.sprites) if (!seen.has(id)) { s.destroy(); this.sprites.delete(id); }
  }

  private drawActor(a: ActorState, tick: number): void {
    const clip = resolveClip(this.frames, a.kind, a.clip, a.facing);
    if (!clip) return;
    const name = clip.frames[frameIndex(clip.frames.length, a.clip, a.clipStartTick, tick)]!;
    const page = this.frames.pageOf(name);
    let s = this.sprites.get(a.id);
    if (!s) { s = this.add.image(0, 0, page, name); this.sprites.set(a.id, s); }
    s.setTexture(page, name);
    // the pivot pixel (mob-runtime anchor) sits on the actor position; west and east anchors differ by a pixel
    const f = this.textures.getFrame(page, name);
    const o = originOf([f.width, f.height], this.frames.pivot(`characters/${a.kind}`, a.facing, name));
    s.setOrigin(o.x, o.y);
    s.setFlipX(clip.flipX);
    s.setPosition(Math.round(a.pos.x), Math.round(a.pos.y));
    s.setDepth(10 + a.pos.y);
  }

  /** For tests and screenshots. */
  debugState(): { tick: number; player: { x: number; y: number; clip: string; facing: string }; input: InputFrame | null } {
    const p = this.stub.player;
    return { tick: this.stub.world.tick, player: { x: p.pos.x, y: p.pos.y, clip: p.clip, facing: p.facing }, input: this.input0 };
  }
}
