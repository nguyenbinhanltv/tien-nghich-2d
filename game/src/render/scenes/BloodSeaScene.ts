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
import { artOf, shotFrame } from '../clip-map.ts';
import { FloorHud } from '../floor-hud.ts';
import { drawText, Hud } from '../hud.ts';
import { DamageNumbers, TONE_COLOUR } from '../damage-numbers.ts';
import { textPixels } from '../../ui/pixel-text.ts';
import { Juice } from '../juice.ts';
import { HurtPoses } from '../hurt-poses.ts';
import { FightRunner } from '../fight-runner.ts';
import { hazardProgress, hazardShape } from '../hazard-geometry.ts';
import { attachRun, canRestartRun } from '../../meta/flow.ts';
import type { ContentApi, RoomLayout } from '../../contracts/content.ts';
import { RoomView } from '../room-view.ts';

export interface SceneHost {
  /** Latest input for this render frame (dash/fire are one-shot). */
  sample(): InputFrame;
  paused(): boolean;
  /** Display name of a content id (a boss or mob) in the player's language. */
  nameOf?(kind: string): string;
  /** Floor name shown by the minimap (e.g. "Huyết Hải"). */
  floorLabel?: string;
  /** Sim events of this render frame (audio, juice). The array is cleared after the call. */
  onEvents?(events: readonly GameEvent[], world: WorldState): void;
  /** Status line (hp, result). */
  status?(world: WorldState): void;
  /** Run mode (the Động Phủ loop): fight on this seed under a run, and leave through `onFinished` instead of retrying. */
  run?: { seed: number; runId: number };
  /** Called once, on the first Dodge/Counter press after the result beat, when `run` is set. The run in `world.run` has ended. */
  onFinished?(world: WorldState): void;
  /** The realm gate: the run waits at the door until `choose` is called with the player's pick. Shown once per gate. */
  onGate?(choose: (choice: 'breakthrough' | 'pill') => void): void;
  /** The realm and cluster lines of the floor HUD (built from the run state and the player's language). */
  runLines?(run: WorldState['run']): string[];
  /** Compiled content (tables, room layouts, encounters). With it the scene plays the real floor, room by room; without it the old boss arena. */
  content?: ContentApi | null;
  /** Golden-image mode: advance a fixed number of ticks once, then hold still (no wall-clock input). */
  frozen?: boolean;
}

const T = 'tilesets/ts_blood_valley/';
const cellHash = (x: number, y: number): number => {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Sprite of each projectile kind (index of PROJECTILE_KINDS). Placeholders: the real shots come with the weapons (E5.1); an enemy's `mob_shot` wears its own art (shotFrame). */
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
  private readonly fight: FightRunner;
  private readonly loop = new FixedLoop();
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private shots: Phaser.GameObjects.Image[] = [];
  private hazards!: Phaser.GameObjects.Graphics;
  private input0: InputFrame | null = null;
  private endedAt = -1;
  private finished = false;
  readonly juice = new Juice();
  readonly numbers = new DamageNumbers();
  private numbersGfx!: Phaser.GameObjects.Graphics;
  private readonly hurts = new HurtPoses();
  private hud!: Hud;
  private floor!: FloorHud;
  private room!: RoomView;
  private gateAsked = false;

  constructor(host: SceneHost) {
    super('blood-sea');
    this.host = host;
    this.fight = new FightRunner(host.run?.seed, host.content ?? null, host.run?.runId);
    // the boss-only fallback attaches its own run; on the real floor the sim started the run in the first room
    if (host.run && !this.fight.hasFloor) attachRun(this.fight.world, host.run.runId);
  }

  preload(): void { preloadKiln(this); this.load.json('content-tables', 'content/tables.json'); }

  create(): void {
    this.frames = new KilnFrames(this);
    this.cameras.main.setBackgroundColor('#14101a');
    this.room = new RoomView(this, this.frames);
    if (!this.fight.hasFloor) this.buildRoom();
    this.hazards = this.add.graphics().setDepth(5);
    this.numbersGfx = this.add.graphics().setDepth(200);
    this.hud = new Hud(this, this.frames, (kind) => this.host.nameOf?.(kind) ?? '');
    this.floor = new FloorHud(this, this.frames);
    // the floor map needs content/tables.json (npm run content:build); without it the game just has no minimap
    if (this.cache.json.exists('content-tables')) {
      const t = this.cache.json.get('content-tables') as { rooms?: { id: string; kind: string; next?: string }[] };
      this.floor.setFloor(t.rooms ?? [], 'room_bs_1', this.host.floorLabel ?? '');
    }
    if (this.host.frozen) for (let i = 0; i < 120; i++) this.fight.tick(NO_INPUT);
    this.draw();
  }

  /** Run mode: the fight reached a result (or its run ended), so Restart must not be offered. */
  resultShown(): boolean { return !canRestartRun(this.fight.world); }

  /** Menu: start the fight again from the beginning. */
  restartFight(): void {
    // in run mode the same seed and run id stay: a restart never rerolls the fight or skips the result handling
    const r = this.host.run;
    if (r && !canRestartRun(this.fight.world)) return; // a finished run leaves only through onFinished
    this.fight.restart(r?.seed);
    if (r && !this.fight.hasFloor) attachRun(this.fight.world, r.runId);
    this.endedAt = -1; this.finished = false;
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
        if ((inp.dash || inp.fire) && w.tick - this.endedAt > 45) {
          if (this.host.run) { if (!this.finished) { this.finished = true; this.host.onFinished?.(w); } } else { this.fight.restart(); this.endedAt = -1; }
        }
      }
      let first = true;
      this.loop.advance(deltaMs, () => {
        // dash/fire are one-shot: only the first tick of the frame sees them
        this.fight.tick(first ? inp : { ...inp, dash: false, fire: false });
        first = false;
      });
      // the realm gate: ask once, and stay 'asked' until the sim has moved past it (it may not tick this very frame)
      if (w.stage?.gatePending) {
        if (!this.gateAsked) { this.gateAsked = true; this.host.onGate?.((c) => this.fight.takeGate(c)); }
      } else this.gateAsked = false;
      const ev = this.fight.drain();
      if (ev.length) { this.juice.onEvents(ev, this.fight.world, this.time.now); this.hurts.onEvents(ev); this.numbers.onEvents(ev, this.fight.world, this.time.now); this.host.onEvents?.(ev, this.fight.world); }
    }
    this.draw();
  }

  /** The room the sim is in: rebuild the view when it changes, keep the doors in step with the grid. */
  private syncRoom(w: WorldState): void {
    const st = w.stage, grid = w.grid;
    if (!st || !grid || !this.host.content) return;
    if (this.room.roomId !== st.room) {
      const layout = this.host.content.get<RoomLayout>('room_layouts', st.room);
      this.room.show(st.room, grid.rows, layout.props);
      if (this.room.roomId && this.fight.world.tick > 0) this.cameras.main.fadeIn(180, 20, 16, 26);
    }
    this.room.update(grid.rows, w.tick);
  }

  private draw(): void {
    const w = this.fight.world;
    this.syncRoom(w);
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
    this.drawNumbers();
    this.hud.update(w);
    // the sim has no room-to-room play yet: the fight is the floor's boss room; the run state's room index takes over when it exists
    this.floor.update(w.run ? w.run.room : this.floor.indexOfKind('boss'), this.host.frozen ? 0 : this.time.now); // golden mode: the marker must not blink
    this.floor.setRunLines(this.host.runLines?.(w.run) ?? []);
    this.host.status?.(w);
  }

  private drawActor(a: ActorState, w: WorldState): void {
    const art = artOf(w, a, this.hurts.startOf(a.id, w.tick));
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

  /** Floating damage numbers: pixel-font digits with an ink outline, in world space above the actor that was hit. */
  private drawNumbers(): void {
    const g = this.numbersGfx;
    g.clear();
    for (const n of this.numbers.visible(this.time.now)) {
      const t = textPixels(n.text);
      drawText(g, t, n.x - (t.w >> 1), n.y, TONE_COLOUR[n.tone]);
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
      const owner = kind === 'mob_shot' ? w.actors.find((x) => x.id === pool.owner[i]) : undefined;
      const name = shotFrame(owner?.kind, w.tick, SHOT_FRAME[kind]);
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
