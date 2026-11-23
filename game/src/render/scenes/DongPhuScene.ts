// Động Phủ (hub) scene, landscape 384x216 (plan E6.1). Draws the abode from the Longtime "abode" chunk plus the approved
// props of the core atlas, lets the player walk (render-side only, no sim here) and press Counter at a station.
// Rules live in meta/ (pure, tested); this file only draws and routes input. It owns no combat scene and starts no run by
// itself: `host.enterRun` is how the shell moves on to Huyết Hải.
import Phaser from 'phaser';
import type { SaveProfile } from '../../contracts/save.ts';
import type { Facing, InputFrame } from '../../contracts/world.ts';
import { VIEW_H, VIEW_W } from '../../contracts/world.ts';
import { clampToWalk, nearestStation, SPAWN, STATIONS, WALL_ROWS } from '../../meta/abode-layout.ts';
import type { Station, StationId } from '../../meta/abode-layout.ts';
import { interact } from '../../meta/abode-actions.ts';
import type { ActionOutcome } from '../../meta/abode-actions.ts';
import { plotStage } from '../../meta/abode.ts';
import { CLIP_FPS } from '../animator.ts';
import { loadChunk, KilnFrames, originOf, preloadKiln, CORE } from '../kiln-loader.ts';

export interface DongPhuHost {
  sample(): InputFrame;
  paused(): boolean;
  /** Current profile. The scene works on its own copy and hands every change back through `commit`. */
  profile: SaveProfile;
  commit(profile: SaveProfile): void;
  /** Counter pressed at the gate: start a run. */
  enterRun(profile: SaveProfile, biome?: string): void;
  /** Text layer (HTML, sharp): what is in reach and the last message. */
  onPrompt?(station: StationId | null, outcome: ActionOutcome | null): void;
  /** Golden-image mode: no wall-clock motion. */
  frozen?: boolean;
}

const STONE = 'longtime/lt_abode_stone/';
const SPEED = 62; // px per second, placeholder until the sim lane gives the hub a real walk speed
const hash = (x: number, y: number): number => { let h = Math.imul(x + 3, 374761393) ^ Math.imul(y + 11, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

export class DongPhuScene extends Phaser.Scene {
  private readonly host: DongPhuHost;
  private profile: SaveProfile;
  private frames!: KilnFrames;
  private player!: Phaser.GameObjects.Image;
  private px: number = SPAWN.x;
  private py: number = SPAWN.y;
  private facing: Facing = 'south';
  private moving = false;
  private near: Station | null = null;
  private fireWas = false;
  private readonly beds: Phaser.GameObjects.Image[] = [];
  private kiln!: Phaser.GameObjects.Image;
  private readonly cyclers: { img: Phaser.GameObjects.Image; frames: string[]; fps: number }[] = [];

  constructor(host: DongPhuHost) { super('dong-phu'); this.host = host; this.profile = host.profile; }

  preload(): void { preloadKiln(this); }

  create(): void {
    void loadChunk(this, 'abode').then((set) => {
      this.frames = new KilnFrames(this, [CORE, set]);
      this.cameras.main.setBackgroundColor('#14101a');
      this.build();
      this.refresh();
      this.built = true;
    });
  }
  private built = false;

  private put(name: string, x: number, y: number, depth: number, origin: 'tl' | 'feet' = 'tl'): Phaser.GameObjects.Image {
    const img = this.add.image(x, y, this.frames.pageOf(name), name).setDepth(depth);
    return origin === 'feet' ? img.setOrigin(0.5, 1) : img.setOrigin(0, 0);
  }
  private cycle(prefix: string, x: number, y: number, fps: number): Phaser.GameObjects.Image {
    const frames = this.frames.sequence(prefix);
    const img = this.put(frames[0]!, x, y, y, 'feet');
    this.cyclers.push({ img, frames, fps });
    return img;
  }

  private build(): void {
    const cols = VIEW_W / 16, rows = Math.ceil(VIEW_H / 16);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const wall = cy < WALL_ROWS;
      this.put(`${STONE}${wall ? 'wall_cap_none' : 'floor_none'}_${hash(cx, cy) % 4}`, cx * 16, cy * 16, 0);
    }
    const at = (id: StationId): Station => STATIONS.find((s) => s.id === id)!;
    this.kiln = this.cycle('longtime/lt_kiln/cold_none', at('kiln').x, at('kiln').y, 1);
    this.cycle('longtime/lt_kiln_keeper/idle_south', at('kiln').x + 36, at('kiln').y + 4, CLIP_FPS.idle ?? 6);
    this.put('props/prop_alchemy_jar/intact_none_0', at('jar').x, at('jar').y, at('jar').y, 'feet');
    this.cycle('props/prop_shrine_altar/idle_none', at('altar').x, at('altar').y, 2);
    this.put('props/prop_spirit_chest/closed_none_0', at('chest').x, at('chest').y, at('chest').y, 'feet');
    for (const id of ['bed0', 'bed1', 'bed2'] as const) this.beds.push(this.put('longtime/lt_herb_bed/bare_none_0', at(id).x, at(id).y, at(id).y, 'feet'));
    this.cycle('props/prop_teleport_array/idle_none', at('gate').x, at('gate').y, 3);
    this.cycle('props/prop_teleport_array/idle_none', at('gate_hengyue').x, at('gate_hengyue').y, 3);
    this.cycle('longtime/lt_ink_marten/idle_south', 238, 168, CLIP_FPS.idle ?? 6);
    this.player = this.put(this.playerFrame(), this.px, this.py, this.py, 'feet');
  }

  private playerFrame(): string {
    const dir = this.facing === 'west' ? 'east' : this.facing;
    const seq = this.frames.sequence(`characters/wl_outer_disciple/${this.moving ? 'run' : 'idle'}_${dir}`);
    const fps = CLIP_FPS[this.moving ? 'run' : 'idle'] ?? 8;
    const fallback = this.frames.sequence('characters/wl_outer_disciple/idle_south');
    const use = seq.length ? seq : fallback;
    return use[Math.floor((this.time.now / 1000) * fps) % use.length]!;
  }

  /** Re-skin the beds and the kiln from the profile (called after every change). */
  private refresh(): void {
    this.profile.plots.forEach((p, i) => {
      const name = `longtime/lt_herb_bed/${plotStage(p) === 'bare' ? 'bare' : plotStage(p)}_none_0`;
      this.beds[i]?.setTexture(this.frames.pageOf(name), name);
    });
    const hot = this.profile.furnaceOre > 0;
    const c = this.cyclers.find((k) => k.img === this.kiln);
    if (c) { c.frames = this.frames.sequence(hot ? 'longtime/lt_kiln/hot_none' : 'longtime/lt_kiln/cold_none'); }
  }

  override update(_t: number, deltaMs: number): void {
    if (!this.built) return;
    const inp = this.host.sample();
    if (!this.host.paused() && !this.host.frozen) {
      const m = Math.hypot(inp.move.x, inp.move.y);
      this.moving = m > 0.1;
      if (this.moving) {
        const k = (SPEED * deltaMs) / 1000 / Math.max(1, m);
        const c = clampToWalk(this.px + inp.move.x * k, this.py + inp.move.y * k);
        this.px = c.x; this.py = c.y;
        this.facing = Math.abs(inp.move.x) > Math.abs(inp.move.y) ? (inp.move.x > 0 ? 'east' : 'west') : (inp.move.y > 0 ? 'south' : 'north');
      }
      const near = nearestStation(this.px, this.py);
      if (near?.id !== this.near?.id) { this.near = near; this.host.onPrompt?.(near?.id ?? null, null); }
      if (inp.fire && !this.fireWas && near) this.act(near.id);
      this.fireWas = inp.fire;
    }
    for (const c of this.cyclers) {
      const f = c.frames[Math.floor((this.time.now / 1000) * c.fps) % c.frames.length]!;
      c.img.setTexture(this.frames.pageOf(f), f);
    }
    const f = this.playerFrame();
    const page = this.frames.pageOf(f);
    const fr = this.textures.getFrame(page, f);
    const o = originOf([fr.width, fr.height], this.frames.pivot('characters/wl_outer_disciple', this.facing === 'west' ? 'east' : this.facing, f));
    this.player.setTexture(page, f).setOrigin(o.x, o.y).setFlipX(this.facing === 'west').setPosition(Math.round(this.px), Math.round(this.py)).setDepth(this.py);
  }

  private act(id: StationId): ActionOutcome {
    const out = interact(this.profile, id);
    if (out.changed) { this.profile = out.profile; this.host.commit(out.profile); this.refresh(); }
    this.host.onPrompt?.(id, out);
    if (out.enterRun) this.host.enterRun(this.profile, out.biome);
    return out;
  }

  /** Test/screenshot hook: stand at a station and press Counter. */
  debugAct(id: StationId): ActionOutcome {
    const s = STATIONS.find((x) => x.id === id)!;
    this.px = s.x; this.py = s.y + 8;
    return this.act(id);
  }
  debugState(): { built: boolean; x: number; y: number; near: StationId | null; profile: SaveProfile } {
    return { built: this.built, x: this.px, y: this.py, near: this.near?.id ?? null, profile: this.profile };
  }
}
