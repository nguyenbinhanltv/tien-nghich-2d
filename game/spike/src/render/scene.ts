import Phaser from "phaser";
import { AudioEngine } from "../platform/audio.ts";
import { InputHub } from "../platform/input.ts";
import { Accumulator } from "../sim/loop.ts";
import { ScriptedInput } from "../sim/script.ts";
import {
  ARENA, BTN_COUNTER, BTN_DODGE, EV_COUNTER, EV_DEFLECT, EV_DODGE, EV_HIT, EV_HURT, EV_KILL, EV_SHOT,
  MAX_MOBS, MAX_PROJ, MAX_SPARKS, World, type Input,
} from "../sim/world.ts";
import { Stats } from "./stats.ts";

export const VIEW_W = 384;
export const VIEW_H = 216; // 16:9 logical frame (plan), landscape; integer-scaled to the device in main.ts

const ATLAS_PAGES = 7;
const MOB_BASE = ["mob_blood_corpse", "mob_blood_wolf", "mob_blood_crow", "mob_blood_pool_lurker"];
const MOB_ANIM = ["move", "move", "move", "idle"];
const PLAYER = "characters/wl_outer_disciple";
const PROJ = "projectiles/pj_blood_jade_blade/flight_none";
const SPARK = "vfx/hit_spark";
const BLOOD = "tilesets/ts_blood_valley";

interface Pic {
  img: Phaser.GameObjects.Image;
  tex: string;
  fr: string;
}

export class SpikeScene extends Phaser.Scene {
  world!: World;
  base = "./assets";
  q = new URLSearchParams(location.search);
  stats = new Stats();
  audio = new AudioEngine();
  hub!: InputHub;
  acc = new Accumulator();
  bot: ScriptedInput | null = null;
  frameToPage = new Map<string, string>();
  frameCount = new Map<string, number>();
  mobs: Pic[] = [];
  projs: Pic[] = [];
  sparks: Pic[] = [];
  player!: Pic;
  floor!: Phaser.GameObjects.RenderTexture;
  seed = 1;
  tickCap = 0; // 0 = unlimited
  hashAtCap = "";
  capHashes = new Map<number, string>();
  hot = { count: 0, lastMs: 0, lastDoneAt: 0, lastVisibleAt: 0, frames: 0, files: [] as string[], applied: 0 };
  private awaitingPresent: number[] = [];
  private framePresses: { btn: number; t: number; src: string }[] = [];
  ignoredPresses = 0;
  private t0Frame = 0;
  paused = false;
  forceAuto = false;

  constructor() {
    super("spike");
  }

  preload(): void {
    for (let i = 0; i < ATLAS_PAGES; i++) {
      this.load.atlas(`a${i}`, `${this.base}/atlases/mobile/atlas-${i}.png`, `${this.base}/atlases/mobile/atlas-${i}.json`);
    }
  }

  create(): void {
    this.seed = Number(this.q.get("seed") ?? 1) >>> 0;
    this.tickCap = Number(this.q.get("ticks") ?? 0);
    this.world = new World(this.seed, { invulnerable: true });
    if (this.q.get("auto") === "1") this.bot = new ScriptedInput(this.seed);
    this.indexFrames();
    this.buildFloor();
    this.buildEntities();
    const cam = this.cameras.main;
    cam.setBackgroundColor(0x14101a);
    this.hub = new InputHub(document.body);
    this.hub.onGesture = (t) => {
      this.audio.unlock(t);
    };
    void this.audio.load();
    this.game.events.on(Phaser.Core.Events.POST_RENDER, () => this.onPostRender());
    this.game.events.on(Phaser.Core.Events.PRE_RENDER, () => this.stats.renderStart());
    this.game.events.on(Phaser.Core.Events.POST_RENDER, () => this.stats.renderEnd());
    const g = window as unknown as { __spike: unknown };
    g.__spike = new SpikeApi(this);
    document.body.dataset.ready = "1";
  }

  private indexFrames(): void {
    this.frameToPage.clear();
    this.frameCount.clear();
    for (let i = 0; i < ATLAS_PAGES; i++) {
      const key = `a${i}`;
      for (const n of this.textures.get(key).getFrameNames()) {
        this.frameToPage.set(n, key);
        const m = /^(.*)_(\d+)$/.exec(n);
        if (m) this.frameCount.set(m[1]!, Math.max(this.frameCount.get(m[1]!) ?? 0, Number(m[2]) + 1));
      }
    }
  }

  private buildFloor(): void {
    const rt = this.add.renderTexture(0, 0, ARENA, ARENA).setOrigin(0, 0).setDepth(-1000);
    const nVar = this.frameCount.get(`${BLOOD}/floor_blood_variants_f0`) ?? 1;
    for (let ty = 0; ty < ARENA / 16; ty++) {
      for (let tx = 0; tx < ARENA / 16; tx++) {
        const v = ((tx * 7 + ty * 13 + ((tx * ty) % 5)) >>> 0) % nVar;
        const name = `${BLOOD}/floor_blood_variants_f0_${v}`;
        rt.stamp(this.frameToPage.get(name)!, name, tx * 16, ty * 16, { originX: 0, originY: 0 });
      }
    }
    rt.render();
    this.floor = rt;
  }

  private mkPic(tex: string, fr: string, depth: number): Pic {
    const img = this.add.image(0, 0, tex, fr).setDepth(depth);
    return { img, tex, fr };
  }

  private setFrame(p: Pic, name: string): void {
    if (p.fr === name) return;
    const page = this.frameToPage.get(name);
    if (!page) return;
    p.img.setTexture(page, name);
    p.tex = page;
    p.fr = name;
  }

  private buildEntities(): void {
    const any = (n: string) => `${n}_0`;
    this.player = this.mkPic(this.frameToPage.get(any(`${PLAYER}/idle_south`))!, any(`${PLAYER}/idle_south`), 0);
    this.player.img.setOrigin(0.5, 31 / 32);
    for (let i = 0; i < MAX_MOBS; i++) {
      const base = `characters/${MOB_BASE[i % 4]}/${MOB_ANIM[i % 4]}_south_0`;
      const m = this.mkPic(this.frameToPage.get(base) ?? this.frameToPage.get(`${PLAYER}/idle_south_0`)!, this.frameToPage.has(base) ? base : `${PLAYER}/idle_south_0`, 0);
      m.img.setOrigin(0.5, 31 / 32);
      this.mobs.push(m);
    }
    for (let i = 0; i < MAX_PROJ; i++) {
      const p = this.mkPic(this.frameToPage.get(`${PROJ}_0`)!, `${PROJ}_0`, 5000);
      p.img.setVisible(false);
      this.projs.push(p);
    }
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.mkPic(this.frameToPage.get(`${SPARK}_0`)!, `${SPARK}_0`, 6000);
      s.img.setVisible(false);
      this.sparks.push(s);
    }
  }

  /** Force every picture to re-resolve its frame (after an atlas page was replaced). */
  invalidateFrames(): void {
    for (const p of [this.player, ...this.mobs, ...this.projs, ...this.sparks]) {
      const name = p.fr;
      p.fr = "";
      this.setFrame(p, name);
    }
  }

  private pick(base: string, anim: string, dx: number, dy: number): { name: string; flip: boolean } {
    const east = Math.abs(dx) > Math.abs(dy);
    const order = east ? ["east", "south"] : ["south", "east"];
    for (const f of order) {
      const k = `${base}/${anim}_${f}`;
      if (this.frameCount.has(k)) return { name: k, flip: f === "east" && dx < 0 };
    }
    return { name: `${base}/idle_south`, flip: false };
  }

  update(_t: number, deltaMs: number): void {
    const now = performance.now();
    this.stats.frameStart(now, deltaMs);
    if (this.paused) return;
    const w = this.world;
    const frameInput: Input = this.bot ? { mx: 0, my: 0, btn: 0 } : this.hub.sample(now);
    // Presses seen up to this sample belong to this frame; ones the sim ignores (cooldown) are dropped, not carried over.
    this.framePresses = this.hub.pending.splice(0);
    const n = this.acc.consume(deltaMs);
    const simT0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (this.tickCap && w.tick >= this.tickCap) break;
      const input = this.bot ? this.bot.next() : frameInput;
      w.step(input); // edge detection lives in the sim, so one sampled Input per frame is safe
      this.consumeEvents(now);
      if (this.tickCap && w.tick === this.tickCap) this.hashAtCap = w.hash();
      if (this.capHashes.has(w.tick)) this.capHashes.set(w.tick, w.hash());
    }
    this.ignoredPresses += this.framePresses.length;
    this.framePresses = [];
    this.stats.simDone(performance.now() - simT0, n);
    this.draw();
  }

  private consumeEvents(now: number): void {
    const w = this.world;
    for (let e = 0; e < w.evN; e++) {
      const t = w.evType[e]!;
      if (t === EV_DODGE || t === EV_COUNTER) {
        const bit = t === EV_DODGE ? BTN_DODGE : BTN_COUNTER;
        const k = this.framePresses.findIndex((p) => p.btn === bit);
        if (k >= 0) {
          const [p] = this.framePresses.splice(k, 1);
          this.stats.latencySim(p!.src, now - p!.t);
          this.awaitingPresent.push(p!.t);
          this.audioFor(t);
        } else this.audioFor(t);
      } else if (t === EV_HIT || t === EV_DEFLECT) this.audio.emit("impact", "mob_blood_wolf");
      else if (t === EV_SHOT && (w.tick & 7) === 0) this.audio.emit("tell", "mob_blood_crow");
      else if (t === EV_HURT || t === EV_KILL) this.audio.emit("outcome", "mob_blood_corpse");
    }
    w.clearEvents();
  }

  private audioFor(t: number): void {
    if (t === EV_DODGE) this.audio.playCue("sfx_dash");
    else this.audio.emit("release", "wl_blood_foundation") || this.audio.playCue("sfx_counter");
  }

  private draw(): void {
    const w = this.world;
    const cam = this.cameras.main;
    cam.scrollX = Math.round(Math.min(ARENA - VIEW_W, Math.max(0, w.px - VIEW_W / 2)));
    cam.scrollY = Math.round(Math.min(ARENA - VIEW_H, Math.max(0, w.py - VIEW_H / 2)));
    const t = w.tick;
    // player
    {
      const mvx = this.hub.lastSource === "none" && !this.bot ? 0 : w.pfx;
      let anim = "idle";
      if (w.dodgeT > 0) anim = "dash";
      else if (w.counterT > 0) anim = "cast_attack";
      else if (this.moving()) anim = "run";
      const f = this.pick(PLAYER, anim, mvx, w.pfy);
      const cnt = this.frameCount.get(f.name) ?? 1;
      const idx = anim === "dash" ? Math.min(cnt - 1, 12 - w.dodgeT >> 1) : anim === "cast_attack" ? Math.min(cnt - 1, (14 - w.counterT) >> 1) : (t / 6) | 0;
      this.setFrame(this.player, `${f.name}_${idx % cnt}`);
      this.player.img.setPosition(Math.round(w.px), Math.round(w.py)).setFlipX(f.flip).setDepth(w.py);
    }
    for (let i = 0; i < MAX_MOBS; i++) {
      const m = this.mobs[i]!;
      if (w.mdead[i]! > 0) {
        m.img.setVisible(false);
        continue;
      }
      const kind = i % 4;
      const dx = w.px - w.mx[i]!;
      const dy = w.py - w.my[i]!;
      const f = this.pick(`characters/${MOB_BASE[kind]}`, MOB_ANIM[kind]!, dx, dy);
      const cnt = this.frameCount.get(f.name) ?? 1;
      this.setFrame(m, `${f.name}_${(((t + i * 3) / 6) | 0) % cnt}`);
      m.img.setVisible(true).setPosition(Math.round(w.mx[i]!), Math.round(w.my[i]!)).setFlipX(f.flip).setDepth(w.my[i]!);
      if (w.mflash[i]! > 0) {
        m.img.tintMode = Phaser.TintModes.FILL;
        m.img.setTint(0xffffff);
      } else if (m.img.isTinted) m.img.clearTint();
    }
    const pn = this.frameCount.get(PROJ) ?? 4;
    for (let i = 0; i < MAX_PROJ; i++) {
      const p = this.projs[i]!;
      if (w.qlife[i] === 0) {
        if (p.img.visible) p.img.setVisible(false);
        continue;
      }
      this.setFrame(p, `${PROJ}_${((t >> 2) + i) % pn}`);
      p.img.setVisible(true).setPosition(Math.round(w.qx[i]!), Math.round(w.qy[i]!));
    }
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparks[i]!;
      const life = w.st[i]!;
      if (life === 0) {
        if (s.img.visible) s.img.setVisible(false);
        continue;
      }
      const k = Math.min(11, (24 - life) >> 1);
      this.setFrame(s, `${SPARK}_${k}`);
      s.img.setVisible(true).setPosition(Math.round(w.sx[i]!), Math.round(w.sy[i]!));
    }
  }

  private lastPx = 0;
  private lastPy = 0;
  private movingNow = false;
  private moving(): boolean {
    const w = this.world;
    if (w.tick % 2 === 0) {
      this.movingNow = Math.abs(w.px - this.lastPx) + Math.abs(w.py - this.lastPy) > 0.05;
      this.lastPx = w.px;
      this.lastPy = w.py;
    }
    return this.movingNow;
  }

  private onPostRender(): void {
    if (this.hot.applied && !this.hot.lastVisibleAt) this.hot.lastVisibleAt = Date.now();
    // Next rAF after this render approximates when the produced frame reaches the screen.
    if (this.awaitingPresent.length) {
      const stamps = this.awaitingPresent.splice(0);
      requestAnimationFrame((ts) => {
        for (const s of stamps) this.stats.latencyFrame(ts - s);
      });
    }
  }

  // ---------- hot reload ----------
  async hotReload(files: string[], serverT: number): Promise<void> {
    const pages = new Set<number>();
    for (const f of files) {
      const m = /atlas-(\d+)\.(png|json)$/.exec(f);
      if (m) pages.add(Number(m[1]));
    }
    if (!pages.size) return;
    const t0 = performance.now();
    const v = Date.now();
    this.hot.applied = 0;
    this.hot.lastVisibleAt = 0;
    await Promise.all(
      [...pages].map(async (i) => {
        const key = `a${i}`;
        let img = new Image();
        let json: unknown;
        for (let attempt = 0; ; attempt++) {
          // a file caught mid-write fails to decode/parse: wait and retry once
          try {
            img = new Image();
            img.src = `${this.base}/atlases/mobile/atlas-${i}.png?v=${v + attempt}`;
            [json] = await Promise.all([fetch(`${this.base}/atlases/mobile/atlas-${i}.json?v=${v + attempt}`).then((r) => r.json()), img.decode()]);
            break;
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 120));
          }
        }
        this.textures.remove(key);
        this.textures.addAtlas(key, img, json as object);
      }),
    );
    this.indexFrames();
    this.invalidateFrames();
    // the floor is baked from atlas frames; rebuild it too when its page changed
    this.floor.destroy();
    this.buildFloor();
    this.hot.count++;
    this.hot.files = files;
    this.hot.lastMs = performance.now() - t0;
    this.hot.lastDoneAt = Date.now();
    this.hot.applied = 1;
    this.hot.frames = serverT; // server-side detection stamp (Date.now at the watcher)
  }
}

export class SpikeApi {
  private s: SpikeScene;
  constructor(s: SpikeScene) {
    this.s = s;
  }
  get tick(): number { return this.s.world.tick; }
  hash(): string { return this.s.world.hash(); }
  hashAtCap(): string { return this.s.hashAtCap; }
  watchTick(n: number): void { this.s.capHashes.set(n, ""); }
  hashAt(n: number): string { return this.s.capHashes.get(n) ?? ""; }
  stats(reset = false) { return this.s.stats.snapshot(reset, this.s.world, this.s.acc); }
  audioStats() { return { ...this.s.audio.stats, emitToStartUs: this.s.audio.stats.emitToStartUs.slice() }; }
  audio() { return this.s.audio; }
  hot() { return { ...this.s.hot }; }
  player() { const w = this.s.world; return { x: w.px, y: w.py, dodgeT: w.dodgeT, counterT: w.counterT, tick: w.tick }; }
  setPaused(p: boolean) { this.s.paused = p; }
  texturePixel(page: number, frame: string, x: number, y: number) {
    const c = this.s.textures.getPixel(x, y, `a${page}`, frame);
    return c ? [c.red, c.green, c.blue, c.alpha] : null;
  }
  hubInfo() { return { padSeen: this.s.hub.padSeen, source: this.s.hub.lastSource }; }
  rendererType() {
    const gl = (this.s.game.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return { type: this.s.game.config.renderType, gpu: ext && gl ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
  }
  playBgm() { return this.s.audio.playBgm(); }
  counts() { const w = this.s.world; let m = 0; for (let i = 0; i < MAX_MOBS; i++) if (w.mdead[i] === 0) m++; return { mobs: m, proj: w.qlive }; }
}
