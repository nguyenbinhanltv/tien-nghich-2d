// Minimal Blood Sea room for the phone playtest (first deliverable of lane C). Floor and wall tiles of ts_blood_valley,
// the player and a few mobs from the real mobile atlas, a fixed 384x216 view. Tiles are placed by a hash of the cell so the
// picture is identical on every run (golden images later).
import Phaser from 'phaser';
import { FixedLoop, NO_INPUT } from '../../sim/loop.ts';
import type { ActorState, GameEvent, InputFrame, WorldState } from '../../contracts/world.ts';
import { VIEW_H, VIEW_W } from '../../contracts/world.ts';
import { frameIndex, resolveClip } from '../animator.ts';
import { KilnFrames, originOf, preloadKiln } from '../kiln-loader.ts';
import { PROJECTILE_KINDS } from '../../contracts/pool.ts';
import { artOf } from '../clip-map.ts';
import { FloorHud } from '../floor-hud.ts';
import { Juice } from '../juice.ts';
import { FightRunner } from '../fight-runner.ts';
import { hazardProgress, hazardShape } from '../hazard-geometry.ts';

export interface SceneHost {
  /** Latest input for this render frame (dash/fire are one-shot). */
  sample(): InputFrame;
  paused(): boolean;
  /** Floor name shown by the minimap (e.g. "Huyết Hải"). */
  floorLabel?: string;
  /** Sim events of this render frame (audio, juice). The array is cleared after the call. */
  onEvents?(events: readonly GameEvent[], world: WorldState): void;
  /** Status line (hp, result). */
  status?(world: WorldState): void;
  /** Golden-image mode: advance a fixed number of ticks once, then hold still (no wall-clock input). */
  frozen?: boolean;
}

const T = 'tilesets/ts_blood_valley/';
const cellHash = (x: number, y: number): number => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Sprite of each projectile kind (index of PROJECTILE_KINDS). Placeholders: the real shots come with the weapons (E5.1). */
const SHOT_FRAME: Record<(typeof PROJECTILE_KINDS)[number], string> = {
  spirit_blade: 'projectiles/pj_blood_jade_blade/flight_none_0',
  mob_shot: 'projectiles/pj_soul_lamp/flight_none_0',
  player_bolt: 'projectiles/pj_azure_wind_sword/flight_none_0',
};
// palette ids blood_05, blood_06, soul_05, bronze_05; hit flash = thunder_04, the lightest palette colour (pure white is not in the palette)
const HIT_FLASH = 0xe8fdff;
const HAZARD_FILL = 0xd03a4a, HAZARD_EDGE = 0xee7a80, SAFE_EDGE = 0x8f62cf;

export class BloodSeaScene extends Phaser.Scene {
  private readonly host: SceneHost;
  private frames!: KilnFrames;
  private readonly fight = new FightRunner();
  private readonly loop = new FixedLoop();
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private shots: Phaser.GameObjects.Image[] = [];
  private hazards!: Phaser.GameObjects.Graphics;
  private input0: InputFrame | null = null;
  private endedAt = -1;
  readonly juice = new Juice();
  private floor!: FloorHud;

  constructor(host: SceneHost) {
    super('blood-sea');
    this.host = host;
  }

  preload(): void { preloadKiln(this); this.load.json('content-tables', 'content/tables.json'); }

  create(): void {
    this.frames = new KilnFrames(this);
    this.cameras.main.setBackgroundColor('#14101a');
    this.buildRoom();
    this.hazards = this.add.graphics().setDepth(5);
    this.floor = new FloorHud(this, this.frames);
    // the floor map needs content/tables.json (npm run content:build); without it the game just has no minimap
    if (this.cache.json.exists('content-tables')) {
      const t = this.cache.json.get('content-tables') as { rooms?: { id: string; kind: string; next?: string }[] };
      this.floor.setFloor(t.rooms ?? [], 'room_bs_1', this.host.floorLabel ?? '');
    }
    if (this.host.frozen) for (let i = 0; i < 120; i++) this.fight.tick(NO_INPUT);
    this.draw();
  }

  private put(name: string, x: number, y: number, depth: number): void {
    this.add.image(x, y, this.frames.pageOf(name), name).setOrigin(0, 0).setDepth(depth);
  }

  private buildRoom(): void {
    const cols = VIEW_W / 16;
    const rows = Math.ceil(VIEW_H / 16);
    // one tile of margin on every side so a camera shake never shows the background
    for (let cy = -1; cy <= rows; cy++) {
      for (let cx = -1; cx <= cols; cx++) {
        const h = cellHash(cx, cy);
        this.put(`${T}floor_blood_variants_f0_${h % 4}`, cx * 16, cy * 16, 0);
        if (cy > 3 && h % 23 === 0) this.put(`${T}deco_f0_${(h >>> 8) % 16}`, cx * 16, cy * 16, 1);
      }
    }
    // back wall: 16x32 faces along the top, drawn over the floor
    for (let cx = -1; cx <= cols; cx++) this.put(`${T}wall_face_f0_${cellHash(cx, 99) % 12}`, cx * 16, 16, 2);
  }

  override update(_t: number, deltaMs: number): void {
    if (!this.host.paused() && !this.host.frozen) {
      const inp = this.host.sample();
      this.input0 = inp;
      const w = this.fight.world;
      // after a result, a fresh Dodge or Counter press (after a short beat) starts the fight again
      if (w.mode === 'won' || w.mode === 'lost') {
        if (this.endedAt < 0) this.endedAt = w.tick;
        if ((inp.dash || inp.fire) && w.tick - this.endedAt > 45) { this.fight.restart(); this.endedAt = -1; }
      }
      let first = true;
      this.loop.advance(deltaMs, () => {
        // dash/fire are one-shot: only the first tick of the frame sees them
        this.fight.tick(first ? inp : { ...inp, dash: false, fire: false });
        first = false;
      });
      const ev = this.fight.drain();
      if (ev.length) { this.juice.onEvents(ev, this.fight.world, this.time.now); this.host.onEvents?.(ev, this.fight.world); }
    }
    this.draw();
  }

  private draw(): void {
    const w = this.fight.world;
    const seen = new Set<number>();
    for (const a of w.actors) {
      seen.add(a.id);
      this.drawActor(a, w);
    }
    for (const [id, s] of this.sprites) if (!seen.has(id)) { s.destroy(); this.sprites.delete(id); }
    this.drawHazards(w);
    this.drawShots(w);
    const o = this.juice.offset(this.time.now);
    this.cameras.main.setScroll(o.x, o.y);
    // the sim has no room-to-room play yet: the fight is the floor's boss room; the run state's room index takes over when it exists
    this.floor.update(w.run ? w.run.room : this.floor.indexOfKind('boss'), this.host.frozen ? 0 : this.time.now); // golden mode: the marker must not blink
    this.host.status?.(w);
  }

  private drawActor(a: ActorState, w: WorldState): void {
    const art = artOf(w, a);
    const clip = resolveClip(this.frames, art.kind, art.clip, a.facing);
    if (!clip) return;
    const name = clip.frames[frameIndex(clip.frames.length, art.clip, art.startTick, w.tick)]!;
    const page = this.frames.pageOf(name);
    let s = this.sprites.get(a.id);
    if (!s) { s = this.add.image(0, 0, page, name); this.sprites.set(a.id, s); }
    s.setTexture(page, name);
    // the pivot pixel (mob-runtime anchor) sits on the actor position; west and east anchors differ by a pixel
    const f = this.textures.getFrame(page, name);
    const o = originOf([f.width, f.height], this.frames.pivot(`characters/${art.kind}`, a.facing, name));
    s.setOrigin(o.x, o.y);
    s.setFlipX(clip.flipX);
    s.setPosition(Math.round(a.pos.x), Math.round(a.pos.y));
    s.setDepth(10 + a.pos.y);
    // invulnerable blink while hurt
    s.setAlpha(a.role === 'player' && a.combat.hurt > 0 && (w.tick & 4) ? 0.45 : 1);
    // white hit flash (E2.3): fill tint for a few frames
    if (this.juice.isFlashing(a.id, this.time.now)) s.setTint(HIT_FLASH).setTintMode(Phaser.TintModes.FILL);
    else s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
  }

  private drawHazards(w: WorldState): void {
    const g = this.hazards;
    g.clear();
    for (const h of w.hazards) {
      const sh = hazardShape(h);
      const p = hazardProgress(h);
      g.fillStyle(HAZARD_FILL, 0.18 + 0.35 * p);
      g.lineStyle(1, HAZARD_EDGE, 0.9);
      if (sh.type === 'bar') { g.beginPath(); g.moveTo(sh.points[0]![0], sh.points[0]![1]); for (const q of sh.points.slice(1)) g.lineTo(q[0], q[1]); g.closePath(); g.fillPath(); g.strokePath(); }
      else if (sh.type === 'disc') { g.fillCircle(sh.x, sh.y, sh.r); g.strokeCircle(sh.x, sh.y, sh.r); if (sh.rim) g.strokeCircle(sh.x, sh.y, sh.r * (1 - p)); }
      else if (sh.type === 'wedge-disc') {
        // the disc minus the safe wedge: fill two arcs, outline the wedge in a second colour so it reads without colour
        g.beginPath(); g.moveTo(sh.x, sh.y); g.arc(sh.x, sh.y, sh.r, sh.centre + sh.half, sh.centre - sh.half + Math.PI * 2, false); g.closePath(); g.fillPath(); g.strokePath();
        g.lineStyle(1, SAFE_EDGE, 1);
        g.lineBetween(sh.x, sh.y, sh.x + Math.cos(sh.centre - sh.half) * sh.r, sh.y + Math.sin(sh.centre - sh.half) * sh.r);
        g.lineBetween(sh.x, sh.y, sh.x + Math.cos(sh.centre + sh.half) * sh.r, sh.y + Math.sin(sh.centre + sh.half) * sh.r);
      } else g.strokeCircle(sh.x, sh.y, sh.r);
    }
  }

  private drawShots(w: WorldState): void {
    const pool = w.projectiles;
    while (this.shots.length < pool.count) {
      const name = SHOT_FRAME.spirit_blade;
      this.shots.push(this.add.image(0, 0, this.frames.pageOf(name), name).setDepth(60));
    }
    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i]!;
      if (i >= pool.count) { s.setVisible(false); continue; }
      const kind = PROJECTILE_KINDS[pool.kind[i]!] ?? 'spirit_blade';
      const name = SHOT_FRAME[kind];
      s.setVisible(true).setTexture(this.frames.pageOf(name), name);
      s.setPosition(Math.round(pool.x[i]!), Math.round(pool.y[i]!));
      s.setRotation(Math.atan2(pool.vy[i]!, pool.vx[i]!));
    }
  }

  /** For tests and screenshots. */
  debugState(): { tick: number; mode: string; player: { x: number; y: number; hp: number; clip: string; facing: string }; boss: { hp: number; state: string } | null; hazards: number; hash: string; input: InputFrame | null } {
    const w = this.fight.world;
    const p = w.actors.find((a) => a.role === 'player')!;
    const b = w.actors.find((a) => a.role === 'boss');
    return { tick: w.tick, mode: w.mode, player: { x: p.pos.x, y: p.pos.y, hp: p.hp, clip: p.clip, facing: p.facing }, boss: b ? { hp: b.hp, state: b.ai.state } : null, hazards: w.hazards.length, hash: this.fight.hash(), input: this.input0 };
  }
}
