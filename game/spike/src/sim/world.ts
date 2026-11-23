// Fixed-step (60 Hz) simulation core. Pure TypeScript: no Phaser, no DOM, no Math.random/Date/sin/cos.
import { Hasher } from "./hash.ts";
import { Rng } from "./rng.ts";
import { COS, DIRS, SIN } from "./trig.ts";

export const TICK_HZ = 60;
export const ARENA = 384;
export const MAX_MOBS = 40;
export const MAX_PROJ = 400;
export const MAX_SPARKS = 64;
export const BTN_DODGE = 1;
export const BTN_COUNTER = 2;

export const EV_DODGE = 1;
export const EV_COUNTER = 2;
export const EV_HIT = 3; // a mob was struck
export const EV_SHOT = 4; // a mob fired
export const EV_HURT = 5; // player took damage
export const EV_KILL = 6;
export const EV_DEFLECT = 7; // counter swatted a projectile
const MAX_EV = 256;

const PLAYER_R = 5;
const PLAYER_SPEED = 1.2;
const DODGE_LEN = 12;
const DODGE_CD = 40;
const DODGE_SPEED = 3.4;
const COUNTER_LEN = 14;
const COUNTER_CD = 30;
const COUNTER_R = 28;
const MOB_R = 6;
const MOB_HP = 6;
const PROJ_R = 3;
const PROJ_LIFE = 300;
const SPARK_LIFE = 24;
const RESPAWN = 45;

/** One tick of input. Axes are quantised ints so replays are exact. */
export interface Input {
  mx: number; // -127..127
  my: number;
  btn: number; // BTN_* bitmask (held)
}

export const MOB_KINDS = ["corpse", "wolf", "crow", "lurker"] as const;
const MOB_SPEED = [0.38, 0.62, 0.5, 0.16];

export class World {
  seed: number;
  tick = 0;
  rng: Rng;
  invulnerable: boolean;

  // player
  px = ARENA / 2;
  py = ARENA / 2;
  pfx = 0; // facing (unit-ish)
  pfy = 1;
  hp = 100;
  dodgeT = 0;
  dodgeCd = 0;
  dodgeDx = 0;
  dodgeDy = 0;
  counterT = 0;
  counterCd = 0;
  swing = 0;
  prevBtn = 0;
  kills = 0;

  // mobs
  mx = new Float32Array(MAX_MOBS);
  my = new Float32Array(MAX_MOBS);
  mvx = new Float32Array(MAX_MOBS);
  mvy = new Float32Array(MAX_MOBS);
  mhp = new Int16Array(MAX_MOBS);
  mkind = new Uint8Array(MAX_MOBS);
  mcd = new Uint16Array(MAX_MOBS);
  mswing = new Uint16Array(MAX_MOBS);
  mflash = new Uint8Array(MAX_MOBS);
  mdead = new Uint16Array(MAX_MOBS); // >0: respawn countdown (dead)

  // projectiles
  qx = new Float32Array(MAX_PROJ);
  qy = new Float32Array(MAX_PROJ);
  qvx = new Float32Array(MAX_PROJ);
  qvy = new Float32Array(MAX_PROJ);
  qlife = new Uint16Array(MAX_PROJ);
  qlive = 0;
  private qfree = new Int16Array(MAX_PROJ);
  private qfreeN = MAX_PROJ;

  // sparks
  sx = new Float32Array(MAX_SPARKS);
  sy = new Float32Array(MAX_SPARKS);
  st = new Uint8Array(MAX_SPARKS); // 0 = inactive, else remaining ticks

  // events for the presentation layer (not part of the state hash)
  evN = 0;
  evType = new Uint8Array(MAX_EV);
  evX = new Float32Array(MAX_EV);
  evY = new Float32Array(MAX_EV);

  // spatial hash scratch (rebuilt every tick, not hashed)
  private static CELL = 24;
  private static GRID = 16;
  private cellCount = new Int16Array(16 * 16 + 1);
  private cellItems = new Int16Array(MAX_MOBS);
  private mCell = new Int16Array(MAX_MOBS);

  constructor(seed: number, opts: { invulnerable?: boolean } = {}) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.invulnerable = opts.invulnerable ?? true;
    for (let i = 0; i < MAX_PROJ; i++) this.qfree[i] = MAX_PROJ - 1 - i;
    for (let i = 0; i < MAX_MOBS; i++) {
      this.mkind[i] = i % 4;
      this.spawnMob(i);
    }
  }

  clearEvents(): void {
    this.evN = 0;
  }
  private ev(type: number, x: number, y: number): void {
    if (this.evN >= MAX_EV) return;
    this.evType[this.evN] = type;
    this.evX[this.evN] = x;
    this.evY[this.evN] = y;
    this.evN++;
  }

  private spawnMob(i: number): void {
    // random point on the arena border band
    const r = this.rng;
    const side = r.int(4);
    const t = 12 + r.next() * (ARENA - 24);
    this.mx[i] = side === 0 ? 12 : side === 1 ? ARENA - 12 : t;
    this.my[i] = side === 2 ? 12 : side === 3 ? ARENA - 12 : t;
    this.mvx[i] = 0;
    this.mvy[i] = 0;
    this.mhp[i] = MOB_HP;
    this.mcd[i] = 30 + r.int(60);
    this.mdead[i] = 0;
    this.mflash[i] = 0;
  }

  private spawnProj(x: number, y: number, dir: number, speed: number): void {
    if (this.qfreeN === 0) return;
    const i = this.qfree[--this.qfreeN]!;
    this.qx[i] = x;
    this.qy[i] = y;
    this.qvx[i] = COS[dir]! * speed;
    this.qvy[i] = SIN[dir]! * speed;
    this.qlife[i] = PROJ_LIFE;
    this.qlive++;
  }
  private killProj(i: number): void {
    this.qlife[i] = 0;
    this.qfree[this.qfreeN++] = i;
    this.qlive--;
  }
  private spark(x: number, y: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.st[i] === 0) {
        this.sx[i] = x;
        this.sy[i] = y;
        this.st[i] = SPARK_LIFE;
        return;
      }
    }
  }

  private dirOf(dx: number, dy: number): number {
    // nearest of 64 table directions without atan2: compare via dot products on a coarse search
    let best = 0;
    let bd = -1e9;
    for (let d = 0; d < DIRS; d += 1) {
      const dot = COS[d]! * dx + SIN[d]! * dy;
      if (dot > bd) {
        bd = dot;
        best = d;
      }
    }
    return best;
  }

  step(inp: Input): void {
    this.tick++;
    const nx = inp.mx / 127;
    const ny = inp.my / 127;
    const mag2 = nx * nx + ny * ny;

    // ---- player ----
    const pressed = inp.btn & ~this.prevBtn;
    this.prevBtn = inp.btn;
    let ax = nx;
    let ay = ny;
    if (mag2 > 1) {
      const m = Math.sqrt(mag2);
      ax /= m;
      ay /= m;
    }
    if (mag2 > 0.04) {
      this.pfx = ax;
      this.pfy = ay;
    }
    if (this.dodgeCd > 0) this.dodgeCd--;
    if (this.counterCd > 0) this.counterCd--;
    if ((pressed & BTN_DODGE) && this.dodgeCd === 0 && this.dodgeT === 0) {
      this.dodgeT = DODGE_LEN;
      this.dodgeCd = DODGE_CD;
      this.dodgeDx = this.pfx;
      this.dodgeDy = this.pfy;
      this.ev(EV_DODGE, this.px, this.py);
    }
    if ((pressed & BTN_COUNTER) && this.counterCd === 0 && this.counterT === 0) {
      this.counterT = COUNTER_LEN;
      this.counterCd = COUNTER_CD;
      this.swing++;
      this.ev(EV_COUNTER, this.px, this.py);
    }
    if (this.dodgeT > 0) {
      this.dodgeT--;
      this.px += this.dodgeDx * DODGE_SPEED;
      this.py += this.dodgeDy * DODGE_SPEED;
    } else {
      this.px += ax * PLAYER_SPEED;
      this.py += ay * PLAYER_SPEED;
    }
    this.px = Math.min(ARENA - 10, Math.max(10, this.px));
    this.py = Math.min(ARENA - 10, Math.max(10, this.py));

    // ---- spatial hash of live mobs ----
    const G = World.GRID;
    const C = World.CELL;
    this.cellCount.fill(0);
    for (let i = 0; i < MAX_MOBS; i++) {
      if (this.mdead[i]! > 0) {
        this.mCell[i] = -1;
        continue;
      }
      const cx = Math.min(G - 1, Math.max(0, (this.mx[i]! / C) | 0));
      const cy = Math.min(G - 1, Math.max(0, (this.my[i]! / C) | 0));
      const c = cy * G + cx;
      this.mCell[i] = c;
      this.cellCount[c + 1]!++;
    }
    for (let c = 0; c < G * G; c++) this.cellCount[c + 1]! += this.cellCount[c]!;
    const fill = new Int16Array(G * G);
    for (let i = 0; i < MAX_MOBS; i++) {
      const c = this.mCell[i]!;
      if (c < 0) continue;
      this.cellItems[this.cellCount[c]! + fill[c]!++] = i;
    }

    // ---- mobs ----
    for (let i = 0; i < MAX_MOBS; i++) {
      if (this.mdead[i]! > 0) {
        if (--this.mdead[i]! === 0) this.spawnMob(i);
        continue;
      }
      if (this.mflash[i]! > 0) this.mflash[i]!--;
      const kind = this.mkind[i]!;
      let x = this.mx[i]!;
      let y = this.my[i]!;
      let dx = this.px - x;
      let dy = this.py - y;
      const d2 = dx * dx + dy * dy + 0.0001;
      const d = Math.sqrt(d2);
      dx /= d;
      dy /= d;
      let sp = MOB_SPEED[kind]!;
      // crows keep distance (orbit), lurkers hold ground
      if (kind === 2 && d < 90) {
        sp = -sp;
      }
      let vx = dx * sp;
      let vy = dy * sp;
      if (kind === 2) {
        // strafe sideways
        vx += -dy * 0.3;
        vy += dx * 0.3;
      }
      // separation from neighbours in the 3x3 cells around
      const cx = this.mCell[i]! % G;
      const cy = (this.mCell[i]! / G) | 0;
      for (let oy = Math.max(0, cy - 1); oy <= Math.min(G - 1, cy + 1); oy++) {
        for (let ox = Math.max(0, cx - 1); ox <= Math.min(G - 1, cx + 1); ox++) {
          const cc = oy * G + ox;
          for (let k = this.cellCount[cc]!; k < this.cellCount[cc + 1]!; k++) {
            const j = this.cellItems[k]!;
            if (j === i) continue;
            const ex = x - this.mx[j]!;
            const ey = y - this.my[j]!;
            const e2 = ex * ex + ey * ey;
            if (e2 < MOB_R * MOB_R * 4 && e2 > 0.0001) {
              const e = Math.sqrt(e2);
              vx += (ex / e) * 0.25;
              vy += (ey / e) * 0.25;
            }
          }
        }
      }
      // knockback velocity decays
      vx += this.mvx[i]!;
      vy += this.mvy[i]!;
      this.mvx[i] = this.mvx[i]! * 0.85;
      this.mvy[i] = this.mvy[i]! * 0.85;
      x += vx;
      y += vy;
      x = Math.min(ARENA - 8, Math.max(8, x));
      y = Math.min(ARENA - 8, Math.max(8, y));
      this.mx[i] = x;
      this.my[i] = y;

      // shooting
      if (kind >= 2) {
        if (this.mcd[i]! > 0) this.mcd[i]!--;
        else {
          this.mcd[i] = 40 + this.rng.int(30);
          const base = this.dirOf(dx, dy);
          if (kind === 3) {
            for (let k = 0; k < 8; k++) this.spawnProj(x, y, (base + k * 8) % DIRS, 0.95);
          } else {
            for (let k = -1; k <= 1; k++) this.spawnProj(x, y, (base + DIRS + k * 2) % DIRS, 1.25);
          }
          this.ev(EV_SHOT, x, y);
        }
      }

      // contact with player
      const pdx = x - this.px;
      const pdy = y - this.py;
      if (pdx * pdx + pdy * pdy < (PLAYER_R + MOB_R) * (PLAYER_R + MOB_R) && this.dodgeT === 0 && this.mflash[i] === 0) {
        this.hurt(x, y);
      }
    }

    // ---- counter swing ----
    if (this.counterT > 0) {
      this.counterT--;
      const R2 = COUNTER_R * COUNTER_R;
      for (let i = 0; i < MAX_MOBS; i++) {
        if (this.mdead[i]! > 0 || this.mswing[i] === this.swing) continue;
        const ex = this.mx[i]! - this.px;
        const ey = this.my[i]! - this.py;
        const e2 = ex * ex + ey * ey;
        if (e2 > R2) continue;
        this.mswing[i] = this.swing;
        this.mhp[i]! -= 3;
        this.mflash[i] = 8;
        const e = Math.sqrt(e2) + 0.0001;
        this.mvx[i] = (ex / e) * 3;
        this.mvy[i] = (ey / e) * 3;
        this.spark(this.mx[i]!, this.my[i]!);
        this.ev(EV_HIT, this.mx[i]!, this.my[i]!);
        if (this.mhp[i]! <= 0) {
          this.mdead[i] = RESPAWN;
          this.kills++;
          this.ev(EV_KILL, this.mx[i]!, this.my[i]!);
        }
      }
    }

    // ---- projectiles ----
    const PR = (PLAYER_R + PROJ_R) * (PLAYER_R + PROJ_R);
    const CR = COUNTER_R * COUNTER_R;
    for (let i = 0; i < MAX_PROJ; i++) {
      if (this.qlife[i] === 0) continue;
      this.qx[i]! += this.qvx[i]!;
      this.qy[i]! += this.qvy[i]!;
      const x = this.qx[i]!;
      const y = this.qy[i]!;
      if (--this.qlife[i]! === 0 || x < 0 || y < 0 || x > ARENA || y > ARENA) {
        if (this.qlife[i] !== 0) this.qlife[i] = 1;
        this.killProj(i);
        continue;
      }
      const dx = x - this.px;
      const dy = y - this.py;
      const d2 = dx * dx + dy * dy;
      if (this.counterT > 0 && d2 < CR) {
        this.spark(x, y);
        this.ev(EV_DEFLECT, x, y);
        this.killProj(i);
        continue;
      }
      if (d2 < PR && this.dodgeT === 0) {
        this.hurt(x, y);
        this.killProj(i);
      }
    }

    // ---- sparks ----
    for (let i = 0; i < MAX_SPARKS; i++) if (this.st[i]! > 0) this.st[i]!--;
  }

  private hurt(x: number, y: number): void {
    this.ev(EV_HURT, x, y);
    this.spark(this.px, this.py);
    if (this.invulnerable) this.hp = Math.max(1, this.hp - 1) === 1 ? 100 : this.hp - 1;
    else this.hp = Math.max(0, this.hp - 5);
  }

  hash(): string {
    const h = new Hasher();
    h.u32(this.tick).u32(this.rng.s).u32(this.swing).u32(this.kills);
    h.f64(this.px).f64(this.py).f64(this.pfx).f64(this.pfy).f64(this.dodgeDx).f64(this.dodgeDy);
    h.u32(this.hp).u32(this.dodgeT).u32(this.dodgeCd).u32(this.counterT).u32(this.counterCd).u32(this.prevBtn);
    h.typed(this.mx).typed(this.my).typed(this.mvx).typed(this.mvy).typed(this.mhp).typed(this.mkind);
    h.typed(this.mcd).typed(this.mswing).typed(this.mflash).typed(this.mdead);
    h.typed(this.qx).typed(this.qy).typed(this.qvx).typed(this.qvy).typed(this.qlife);
    h.typed(this.sx).typed(this.sy).typed(this.st);
    return h.hex();
  }
}
