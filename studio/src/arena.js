/**
 * Playable Arena Tab — Soul Knight-style procedural dungeon room previewer.
 *
 * Features:
 *  - Select 1 of 4 Wang Lin skins (WASD / Arrows move, Space dash, Click fire Dharma Treasure)
 *  - Select 1 of 12 Dharma Treasures (distinct projectile behaviors + VFX)
 *  - Procedural 3x3 dungeon rooms with N/S/E/W Restriction Gate doors & 2.5D vertical walls
 *  - 47-tile blob autotile rendering driven by worker bitmask JSON (or standard fallback)
 *  - Real-time biome switching across all 3 biomes (keys 1-3 + UI)
 *  - Strict pixel-art hygiene: imageSmoothingEnabled = false, integer pixel coordinates & scaling
 *  - Honest placeholders when sprites are missing ('missing: pixellab not generated' for characters)
 */

import { BIOMES } from './assetKeys.js';
import {
  CELL,
  computeBlob47Mask,
  generateFloor,
  isFloorLike,
  isPatchLike,
  isWallLike,
} from './blob47.js';

const SKIN_ACCENTS = {
  wl_outer_disciple: { primary: '#9d98a4', trim: '#d4d0d8', aura: '#6e6877', label: 'Form 1 · Outer Disciple' },
  wl_qi_condensation: { primary: '#28a8dc', trim: '#8ae8ff', aura: '#2fa27a', label: 'Form 2 · Qi Condensation' },
  wl_blood_foundation: { primary: '#a51d35', trim: '#ee7a80', aura: '#8f62cf', label: 'Form 3 · Blood-Sea Foundation' },
  wl_extreme_jing: { primary: '#ff3b30', trim: '#e0b030', aura: '#ff9a7a', label: 'Form 4 · Extreme Jing' },
};

const WEAPON_STYLE_CONFIG = {
  wp_heaven_defying_bead: { speed: 210, cooldown: 0.22, color: '#28a8dc', glow: '#e8fdff', count: 1, spread: 0, pierce: true, radius: 5 },
  wp_soul_banner: { speed: 145, cooldown: 0.30, color: '#8f62cf', glow: '#e3d6fb', count: 2, spread: 0.22, wave: true, radius: 5 },
  wp_restriction_talisman: { speed: 165, cooldown: 0.28, color: '#e0b030', glow: '#fff0b0', count: 1, spread: 0, sticky: true, radius: 5 },
  wp_azure_wind_sword: { speed: 220, cooldown: 0.26, color: '#5cc796', glow: '#d2f5de', count: 1, spread: 0, boomerang: true, radius: 6 },
  wp_slaughter_sword: { speed: 245, cooldown: 0.34, color: '#ff3b30', glow: '#ff9a7a', count: 1, spread: 0, pierce: true, radius: 7 },
  wp_blood_jade_blade: { speed: 205, cooldown: 0.16, color: '#d03a4a', glow: '#f9c4c0', count: 1, spread: 0.06, radius: 4 },
  wp_thunder_seal: { speed: 270, cooldown: 0.36, color: '#8ae8ff', glow: '#ff3b30', count: 3, spread: 0.18, radius: 5 },
  wp_blood_fiend_banner: { speed: 175, cooldown: 0.28, color: '#a51d35', glow: '#ee7a80', count: 3, spread: 0.28, radius: 5 },
  wp_ancient_god_hammer: { speed: 130, cooldown: 0.48, color: '#bf8a1e', glow: '#f5d765', count: 1, spread: 0, heavy: true, radius: 8 },
  wp_soul_lamp: { speed: 160, cooldown: 0.24, color: '#f5d765', glow: '#e3d6fb', count: 1, spread: 0, pierce: true, radius: 5 },
  wp_five_element_needles: { speed: 235, cooldown: 0.26, color: '#5cc796', glow: '#fff0b0', count: 5, spread: 0.42, radius: 3 },
  wp_spirit_stone_beads: { speed: 180, cooldown: 0.32, color: '#28a8dc', glow: '#9ae3b8', count: 1, spread: 0, burst: true, radius: 6 },
};

const BIOME_PROP_MAP = {
  hengyue: { light: 'prop_stone_lantern', accent: 'prop_bamboo_cluster', jar: 'prop_alchemy_jar', chest: 'prop_spirit_chest', altar: 'prop_shrine_altar', portal: 'prop_teleport_array' },
  blood_sea: { light: 'prop_restriction_pillar', accent: 'prop_mist_ravine_rock', jar: 'prop_alchemy_jar', chest: 'prop_spirit_chest', altar: 'prop_bone_altar', portal: 'prop_teleport_array' },
  ancient_god: { light: 'prop_petrified_chain', accent: 'prop_ancient_statue', jar: 'prop_alchemy_jar', chest: 'prop_spirit_chest', altar: 'prop_golden_rune_glyph', portal: 'prop_teleport_array' },
};

export class ArenaController {
  constructor(store, canvas, uiCallbacks = {}) {
    this.store = store;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.uiCallbacks = uiCallbacks;

    // Logical pixel resolution: 21 cols * 16px = 336, 15 rows * 16px = 240
    this.logicalW = 336;
    this.logicalH = 240;
    this.scaleMode = 'auto'; // 'auto' | 1 | 2 | 3 | 4
    this.activeScale = 2;

    this.biomeIndex = 0;
    this.skinId = 'wl_outer_disciple';
    this.weaponId = 'wp_heaven_defying_bead';

    this.floor = generateFloor(104729);
    this.roomKey = this.floor.startKey;

    this.debug = {
      hitboxes: false,
      bitmasks: false,
      grid: false,
      wallGuides: false,
    };

    // Player entity (center coordinates in world pixels)
    this.player = {
      x: 168,
      y: 128,
      vx: 0,
      vy: 0,
      dir: 'south',
      anim: 'idle',
      animTime: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 0,
      dashDirY: 1,
      castTimer: 0,
      fireCooldown: 0,
      afterimages: [],
    };

    this.keys = new Set();
    this.mouse = { x: 220, y: 128, down: false, inside: false };
    this.projectiles = [];
    this.vfx = [];
    this.time = 0;
    this.active = true;
    this.roomBannerTimer = 2.0;

    this._bindEvents();
    this.resize();
  }

  get biome() {
    return BIOMES[this.biomeIndex] || BIOMES[0];
  }

  get room() {
    return this.floor.rooms.get(this.roomKey);
  }

  setBiome(index) {
    this.biomeIndex = ((index % BIOMES.length) + BIOMES.length) % BIOMES.length;
    this.roomBannerTimer = 2.2;
    this.uiCallbacks.onStateChange?.();
  }

  setSkin(skinId) {
    this.skinId = skinId;
    this.uiCallbacks.onStateChange?.();
  }

  setWeapon(weaponId) {
    this.weaponId = weaponId;
    this.uiCallbacks.onStateChange?.();
  }

  setScaleMode(mode) {
    this.scaleMode = mode;
    this.resize();
  }

  regenerateFloor(seed = Math.floor(Math.random() * 900000) + 100000) {
    this.floor = generateFloor(seed);
    this.roomKey = this.floor.startKey;
    this.player.x = 168;
    this.player.y = 128;
    this.projectiles = [];
    this.vfx = [];
    this.roomBannerTimer = 2.2;
    this.uiCallbacks.onStateChange?.();
  }

  goToRoom(key, spawnX = 168, spawnY = 128) {
    if (!this.floor.rooms.has(key)) return;
    this.roomKey = key;
    this.player.x = spawnX;
    this.player.y = spawnY;
    this.projectiles = [];
    this.vfx = [];
    this.roomBannerTimer = 1.8;
    this.uiCallbacks.onStateChange?.();
  }

  resize() {
    const parent = this.canvas.parentElement;
    let scale = 2;
    if (this.scaleMode === 'auto' && parent) {
      const availW = Math.max(336, parent.clientWidth - 24);
      const availH = Math.max(240, parent.clientHeight - 24);
      scale = Math.max(1, Math.min(4, Math.floor(Math.min(availW / this.logicalW, availH / this.logicalH))));
    } else if (typeof this.scaleMode === 'number') {
      scale = this.scaleMode;
    }
    this.activeScale = scale;
    this.canvas.width = this.logicalW;
    this.canvas.height = this.logicalH;
    this.canvas.style.width = `${this.logicalW * scale}px`;
    this.canvas.style.height = `${this.logicalH * scale}px`;
    this.ctx.imageSmoothingEnabled = false;
    this.uiCallbacks.onScaleChange?.(scale, this.logicalW, this.logicalH);
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key === '1' || e.key === '2' || e.key === '3') {
        this.setBiome(Number(e.key) - 1);
        return;
      }

      if (!this.active) return;

      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault();
      }
      this.keys.add(k);

      if (e.code === 'Space') {
        this.triggerDash();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.down = false;
    });

    const updatePointer = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * this.logicalW;
      this.mouse.y = ((e.clientY - rect.top) / rect.height) * this.logicalH;
    };

    this.canvas.addEventListener('mousemove', (e) => {
      this.mouse.inside = true;
      updatePointer(e);
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.mouse.inside = false;
      this.mouse.down = false;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      updatePointer(e);
      this.mouse.down = true;
      this.tryFire();
    });
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
    });
    window.addEventListener('resize', () => this.resize());
  }

  triggerDash() {
    const p = this.player;
    if (p.dashCooldown > 0 || p.dashTimer > 0) return;

    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;

    if (dx === 0 && dy === 0) {
      if (p.dir === 'north') dy = -1;
      else if (p.dir === 'south') dy = 1;
      else if (p.dir === 'west') dx = -1;
      else dx = 1;
    } else {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
    }

    p.dashDirX = dx;
    p.dashDirY = dy;
    p.dashTimer = 0.16;
    p.dashCooldown = 0.65;
    p.anim = 'dash';
    p.animTime = 0;
  }

  tryFire() {
    const p = this.player;
    if (p.fireCooldown > 0) return;
    const cfg = WEAPON_STYLE_CONFIG[this.weaponId] || WEAPON_STYLE_CONFIG.wp_heaven_defying_bead;
    const weaponAsset = this.store.assetsById.get(this.weaponId);
    const projId = weaponAsset?.projectile_id || 'pj_heaven_defying_bead';

    const baseAngle = Math.atan2(this.mouse.y - (p.y - 4), this.mouse.x - p.x);
    const count = cfg.count || 1;
    const spread = cfg.spread || 0;

    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread;
      const angle = baseAngle + offset;
      this.projectiles.push({
        x: p.x + Math.cos(angle) * 10,
        y: p.y - 4 + Math.sin(angle) * 10,
        vx: Math.cos(angle) * cfg.speed,
        vy: Math.sin(angle) * cfg.speed,
        angle,
        age: 0,
        maxAge: cfg.boomerang ? 1.1 : 1.4,
        cfg,
        projId,
        weaponId: this.weaponId,
        returning: false,
      });
    }

    p.fireCooldown = cfg.cooldown;
    p.castTimer = 0.22;
    p.anim = 'cast_attack';
    p.animTime = 0;

    // Face cursor direction briefly
    if (Math.abs(Math.cos(baseAngle)) > Math.abs(Math.sin(baseAngle))) {
      p.dir = Math.cos(baseAngle) >= 0 ? 'east' : 'west';
    } else {
      p.dir = Math.sin(baseAngle) >= 0 ? 'south' : 'north';
    }
  }

  update(dt) {
    if (!this.active) return;
    const clampedDt = Math.min(dt, 0.05);
    this.time += clampedDt;
    if (this.roomBannerTimer > 0) this.roomBannerTimer -= clampedDt;

    const p = this.player;
    p.animTime += clampedDt;
    if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - clampedDt);
    if (p.fireCooldown > 0) p.fireCooldown = Math.max(0, p.fireCooldown - clampedDt);
    if (p.castTimer > 0) p.castTimer = Math.max(0, p.castTimer - clampedDt);

    if (this.mouse.down && this.mouse.inside) {
      this.tryFire();
    }

    // Movement
    let vx = 0;
    let vy = 0;
    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - clampedDt);
      vx = p.dashDirX * 260;
      vy = p.dashDirY * 260;
      p.afterimages.push({ x: p.x, y: p.y, life: 0.2 });
    } else {
      let ix = 0;
      let iy = 0;
      if (this.keys.has('w') || this.keys.has('arrowup')) iy -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) iy += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) ix -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) ix += 1;

      if (ix !== 0 || iy !== 0) {
        const len = Math.hypot(ix, iy);
        ix /= len;
        iy /= len;
        vx = ix * 92;
        vy = iy * 92;
        if (Math.abs(ix) > Math.abs(iy)) p.dir = ix > 0 ? 'east' : 'west';
        else p.dir = iy > 0 ? 'south' : 'north';
      }
    }

    this._movePlayerWithCollisions(vx * clampedDt, vy * clampedDt);
    this._checkDoorTransitions();

    // Update animation state
    if (p.dashTimer > 0) p.anim = 'dash';
    else if (p.castTimer > 0) p.anim = 'cast_attack';
    else if (Math.abs(vx) > 1 || Math.abs(vy) > 1) p.anim = 'run';
    else p.anim = 'idle';

    // Update dash afterimages
    for (let i = p.afterimages.length - 1; i >= 0; i--) {
      p.afterimages[i].life -= clampedDt;
      if (p.afterimages[i].life <= 0) p.afterimages.splice(i, 1);
    }

    // Update props hit flash
    for (const prop of this.room.props) {
      if (prop.hitFlash > 0) prop.hitFlash = Math.max(0, prop.hitFlash - clampedDt);
    }

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.age += clampedDt;
      if (pr.cfg.boomerang && pr.age > 0.35 && !pr.returning) {
        pr.returning = true;
      }
      if (pr.returning) {
        const dx = p.x - pr.x;
        const dy = p.y - 4 - pr.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 10) {
          this.projectiles.splice(i, 1);
          continue;
        }
        pr.vx = (dx / dist) * pr.cfg.speed * 1.15;
        pr.vy = (dy / dist) * pr.cfg.speed * 1.15;
      } else if (pr.cfg.wave) {
        const perp = Math.sin(pr.age * 16) * 45;
        const nx = -Math.sin(pr.angle);
        const ny = Math.cos(pr.angle);
        pr.x += nx * perp * clampedDt;
        pr.y += ny * perp * clampedDt;
      }

      pr.x += pr.vx * clampedDt;
      pr.y += pr.vy * clampedDt;
      pr.angle = Math.atan2(pr.vy, pr.vx);

      let dead = pr.age >= pr.maxAge;
      const gx = Math.floor(pr.x / 16);
      const gy = Math.floor(pr.y / 16);
      if (gx < 0 || gy < 0 || gx >= this.room.cols || gy >= this.room.rows || this.room.grid[gy][gx] === CELL.WALL) {
        dead = true;
      }

      // Prop collisions
      if (!dead) {
        for (const prop of this.room.props) {
          if (prop.broken) continue;
          if (Math.hypot(pr.x - prop.x, pr.y - prop.y) < 10) {
            prop.hitFlash = 0.14;
            if (prop.breakable) {
              prop.hp -= 1;
              if (prop.hp <= 0) prop.broken = true;
            }
            if (!pr.cfg.pierce) dead = true;
            this._spawnImpact(pr.x, pr.y, pr.cfg.color, pr.cfg.glow);
            break;
          }
        }
      }

      if (dead) {
        this._spawnImpact(pr.x, pr.y, pr.cfg.color, pr.cfg.glow);
        this.projectiles.splice(i, 1);
      }
    }

    // Update impact VFX
    for (let i = this.vfx.length - 1; i >= 0; i--) {
      this.vfx[i].age += clampedDt;
      if (this.vfx[i].age >= this.vfx[i].duration) this.vfx.splice(i, 1);
    }
  }

  _spawnImpact(x, y, color, glow) {
    this.vfx.push({ x, y, color, glow, age: 0, duration: 0.24 });
  }

  _collides(cx, cy) {
    const halfW = 5;
    const halfH = 4;
    const room = this.room;
    const corners = [
      [cx - halfW, cy - halfH],
      [cx + halfW, cy - halfH],
      [cx - halfW, cy + halfH],
      [cx + halfW, cy + halfH],
    ];
    for (const [px, py] of corners) {
      const gx = Math.floor(px / 16);
      const gy = Math.floor(py / 16);
      if (gx < 0 || gy < 0 || gx >= room.cols || gy >= room.rows) return true;
      if (room.grid[gy][gx] === CELL.WALL) return true;
    }
    for (const prop of room.props) {
      if (prop.broken) continue;
      if (Math.abs(cx - prop.x) < 10 && Math.abs(cy - prop.y) < 8) return true;
    }
    return false;
  }

  _movePlayerWithCollisions(dx, dy) {
    const p = this.player;
    if (!this._collides(p.x + dx, p.y)) p.x += dx;
    if (!this._collides(p.x, p.y + dy)) p.y += dy;
  }

  _checkDoorTransitions() {
    const p = this.player;
    const r = this.room;
    if (r.doors.north && p.y < 14) {
      this.goToRoom(`${r.rx},${r.ry - 1}`, p.x, (r.rows - 2) * 16 - 4);
    } else if (r.doors.south && p.y > r.rows * 16 - 10) {
      this.goToRoom(`${r.rx},${r.ry + 1}`, p.x, 36);
    } else if (r.doors.west && p.x < 10) {
      this.goToRoom(`${r.rx - 1},${r.ry}`, (r.cols - 2) * 16 - 4, p.y);
    } else if (r.doors.east && p.x > r.cols * 16 - 10) {
      this.goToRoom(`${r.rx + 1},${r.ry}`, 28, p.y);
    }
  }

  render() {
    const ctx = this.ctx;
    const room = this.room;
    const biome = this.biome;
    const pal = biome.palette;
    const bm = this.store.bitmaskMap;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.logicalW, this.logicalH);

    // 1. Render floors, blob-47 patches, and 2.5D walls
    for (let y = 0; y < room.rows; y++) {
      for (let x = 0; x < room.cols; x++) {
        const cell = room.grid[y][x];
        const px = x * 16;
        const py = y * 16;

        if (cell === CELL.WALL) {
          const isFrontFace = y + 1 < room.rows && room.grid[y + 1][x] !== CELL.WALL;
          const mask = computeBlob47Mask(x, y, (nx, ny) => isWallLike(room.grid, nx, ny));
          const tileIdx = bm.maskToTile.get(mask) ?? 46;

          const sheet = isFrontFace ? 'wall_face' : 'wall_top_blob47';
          const faceIdx = (room.wallFaceVariants[y * room.cols + x] || 0) % 12;
          const frame = isFrontFace
            ? this.store.resolveTileFrame(biome.id, faceIdx, 'wall_face')
            : this.store.resolveTileFrame(biome.id, tileIdx, sheet) ||
              this.store.resolveTileFrame(biome.id, tileIdx);

          if (frame) {
            // wall_face tiles are 16x32 (2.5D): anchor the bottom of the face on this cell.
            if (frame.sh === 32) ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, px, py - 16, 16, 32);
            else ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, px, py, 16, 16);
          } else {
            this._drawPlaceholderWallTile(ctx, px, py, mask, isFrontFace, pal, room.wallFaceVariants[y * room.cols + x]);
          }

          if (this.debug.wallGuides && isFrontFace) {
            ctx.strokeStyle = '#ff9a7a';
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 0.5, py + 0.5, 15, 15);
          }
          if (this.debug.bitmasks) {
            this._drawTinyMask(ctx, px, py, tileIdx);
          }
        } else {
          // Floor or Patch or Door
          const floorMask = computeBlob47Mask(x, y, (nx, ny) => isFloorLike(room.grid, nx, ny));
          const floorIdx = bm.maskToTile.get(floorMask) ?? 46;
          const floorFrame =
            this.store.resolveTileFrame(biome.id, floorIdx, 'floor_blob47') ||
            this.store.resolveTileFrame(biome.id, floorIdx);

          if (floorFrame) {
            ctx.drawImage(floorFrame.image, floorFrame.sx, floorFrame.sy, floorFrame.sw, floorFrame.sh, px, py, 16, 16);
          } else {
            this._drawPlaceholderFloorTile(ctx, px, py, x, y, floorMask, pal);
          }

          if (cell === CELL.PATCH) {
            const pMask = computeBlob47Mask(x, y, (nx, ny) => isPatchLike(room.grid, nx, ny));
            const pIdx = bm.maskToTile.get(pMask) ?? 46;
            const patchSheet =
              biome.id === 'hengyue'
                ? 'floor_garden_blob47'
                : biome.id === 'blood_sea'
                  ? 'blood_pool_blob47'
                  : 'void_crack_blob47';
            const patchFrame = this.store.resolveTileFrame(biome.id, pIdx, patchSheet);
            if (patchFrame) {
              ctx.drawImage(patchFrame.image, patchFrame.sx, patchFrame.sy, patchFrame.sw, patchFrame.sh, px, py, 16, 16);
            } else {
              this._drawPlaceholderPatchTile(ctx, px, py, pMask, pal, biome.id);
            }
          }

          if (cell === CELL.DOOR) {
            this._drawDoorTile(ctx, px, py, pal);
          }

          if (this.debug.bitmasks) {
            this._drawTinyMask(ctx, px, py, floorIdx);
          }
        }

        if (this.debug.grid) {
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.strokeRect(px + 0.5, py + 0.5, 15, 15);
        }
      }
    }

    // 2. Subtle drop shadow below 2.5D north walls onto walkable floor
    for (let y = 1; y < room.rows; y++) {
      for (let x = 0; x < room.cols; x++) {
        if (room.grid[y][x] !== CELL.WALL && room.grid[y - 1][x] === CELL.WALL) {
          ctx.fillStyle = 'rgba(20, 16, 26, 0.45)';
          ctx.fillRect(x * 16, y * 16, 16, 4);
        }
      }
    }

    // 3. Y-sorted entities (props + player)
    const drawList = [];
    for (const prop of room.props) {
      drawList.push({ y: prop.y, kind: 'prop', prop });
    }
    drawList.push({ y: this.player.y, kind: 'player' });
    drawList.sort((a, b) => a.y - b.y);

    for (const item of drawList) {
      if (item.kind === 'prop') {
        this._drawProp(ctx, item.prop);
      } else {
        this._drawPlayer(ctx);
      }
    }

    // 4. Projectiles & Impact VFX
    for (const pr of this.projectiles) {
      this._drawProjectile(ctx, pr);
    }
    for (const fx of this.vfx) {
      this._drawImpactVfx(ctx, fx);
    }

    // 5. Aiming reticle (pixelated)
    if (this.mouse.inside) {
      const mx = Math.round(this.mouse.x);
      const my = Math.round(this.mouse.y);
      ctx.fillStyle = '#14101a';
      ctx.fillRect(mx - 4, my - 1, 9, 3);
      ctx.fillRect(mx - 1, my - 4, 3, 9);
      ctx.fillStyle = '#fff0b0';
      ctx.fillRect(mx - 3, my, 2, 1);
      ctx.fillRect(mx + 2, my, 2, 1);
      ctx.fillRect(mx, my - 3, 1, 2);
      ctx.fillRect(mx, my + 2, 1, 2);
    }

    // 6. On-canvas compact HUD strip (Room + Biome + Dash Cooldown + Missing PixelLab tag)
    this._drawCanvasHud(ctx);
  }

  _drawPlaceholderFloorTile(ctx, px, py, gx, gy, mask, pal) {
    ctx.fillStyle = (gx + gy) % 2 === 0 ? pal.floorA : pal.floorB;
    ctx.fillRect(px, py, 16, 16);
    ctx.fillStyle = pal.floorTrim;
    ctx.fillRect(px, py + 15, 16, 1);
    ctx.fillRect(px + 15, py, 1, 16);
    // Subtle blob edge trim along wall boundaries
    if (!(mask & 1)) ctx.fillRect(px, py, 16, 2);
    if (!(mask & 64)) ctx.fillRect(px, py, 2, 16);
  }

  _drawPlaceholderWallTile(ctx, px, py, mask, isFrontFace, pal, variant) {
    if (isFrontFace) {
      // 2.5D vertical wall front face
      ctx.fillStyle = pal.wallFace;
      ctx.fillRect(px, py, 16, 16);
      ctx.fillStyle = pal.wallTopEdge;
      ctx.fillRect(px, py, 16, 3);
      ctx.fillStyle = '#14101a';
      ctx.fillRect(px, py + 15, 16, 1);
      ctx.fillRect(px, py + 3, 16, 1);
      // Brick/relief joints
      ctx.fillStyle = pal.wallFaceAccent;
      if (variant % 4 === 0) {
        ctx.fillRect(px + 4, py + 6, 8, 6);
        ctx.fillStyle = '#14101a';
        ctx.fillRect(px + 5, py + 7, 6, 4);
      } else {
        ctx.fillRect(px + 7, py + 4, 1, 5);
        ctx.fillRect(px + 2, py + 9, 12, 1);
        ctx.fillRect(px + 11, py + 10, 1, 5);
      }
    } else {
      // 2.5D wall top cap (blob-47 silhouette)
      ctx.fillStyle = pal.wallTop;
      ctx.fillRect(px, py, 16, 16);
      ctx.fillStyle = pal.wallTopEdge;
      if (!(mask & 1)) ctx.fillRect(px, py, 16, 2);
      if (!(mask & 64)) ctx.fillRect(px, py, 2, 16);
      if (!(mask & 4)) ctx.fillRect(px + 14, py, 2, 16);
      if (!(mask & 16)) ctx.fillRect(px, py + 14, 16, 2);
      ctx.fillStyle = '#14101a';
      if (!(mask & 1)) ctx.fillRect(px, py, 16, 1);
      if (!(mask & 16)) ctx.fillRect(px, py + 15, 16, 1);
    }
  }

  _drawPlaceholderPatchTile(ctx, px, py, mask, pal, biomeId) {
    const frame = Math.floor(this.time * 4) % 4;
    ctx.fillStyle = pal.patchA;
    ctx.fillRect(px, py, 16, 16);
    ctx.fillStyle = pal.patchB;
    const shift = biomeId === 'hengyue' ? 0 : frame;
    ctx.fillRect(px + 2 + (shift % 2), py + 3, 12 - (shift % 2), 10);

    // Blob-47 border highlight
    ctx.fillStyle = pal.patchEdge;
    if (!(mask & 1)) ctx.fillRect(px, py, 16, 2);
    if (!(mask & 16)) ctx.fillRect(px, py + 14, 16, 2);
    if (!(mask & 64)) ctx.fillRect(px, py, 2, 16);
    if (!(mask & 4)) ctx.fillRect(px + 14, py, 2, 16);

    // Animated sparkle / bubble / star pixel
    if (biomeId === 'ancient_god') {
      ctx.fillStyle = '#fff0b0';
      ctx.fillRect(px + ((4 + frame * 3) % 12), py + ((5 + frame * 2) % 10), 1, 1);
    } else if (biomeId === 'blood_sea') {
      ctx.fillStyle = '#f9c4c0';
      ctx.fillRect(px + 4 + (frame % 3) * 3, py + 6 + (frame % 2) * 2, 2, 1);
    }
  }

  _drawDoorTile(ctx, px, py, pal) {
    ctx.fillStyle = pal.door;
    ctx.fillRect(px + 1, py + 1, 14, 14);
    ctx.fillStyle = pal.floorA;
    ctx.fillRect(px + 3, py + 3, 10, 10);
    ctx.fillStyle = pal.doorGlow;
    const pulse = Math.floor(this.time * 3) % 2 === 0;
    if (pulse) {
      ctx.fillRect(px + 7, py + 6, 2, 4);
      ctx.fillRect(px + 6, py + 7, 4, 2);
    }
  }

  _drawProp(ctx, prop) {
    const biomeProps = BIOME_PROP_MAP[this.biome.id] || BIOME_PROP_MAP.hengyue;
    const propAssetId = biomeProps[prop.role] || 'prop_alchemy_jar';
    const propAsset = this.store.assetsById.get(propAssetId);
    const anim = prop.broken ? 'debris' : 'idle';
    const frameIdx = Math.floor(this.time * 6) % 4;
    const frame = propAsset ? this.store.resolveFrame(propAsset, { anim, frameIndex: frameIdx }) : null;

    const px = Math.round(prop.x);
    const py = Math.round(prop.y);

    if (frame) {
      ctx.drawImage(
        frame.image,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        Math.round(px - frame.sw / 2),
        Math.round(py - frame.sh + 8),
        frame.sw,
        frame.sh
      );
    } else {
      // Explicit diagnostic wireframe prop placeholder
      const w = propAsset?.size?.[0] || 16;
      const h = propAsset?.size?.[1] || 16;
      const x0 = Math.round(px - w / 2);
      const y0 = Math.round(py - h + 8);
      ctx.fillStyle = prop.broken ? 'rgba(73,67,79,0.35)' : prop.hitFlash > 0 ? '#fff0b0' : 'rgba(20,16,26,0.65)';
      ctx.fillRect(x0, y0, w, prop.broken ? 6 : h);
      ctx.strokeStyle = prop.broken ? '#6e6877' : this.biome.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, (prop.broken ? 6 : h) - 1);
      if (!prop.broken) {
        ctx.fillStyle = '#d4d0d8';
        ctx.font = '6px monospace';
        ctx.fillText(prop.role.slice(0, 3).toUpperCase(), x0 + 2, y0 + 8);
      }
    }

    if (this.debug.hitboxes && !prop.broken) {
      ctx.strokeStyle = '#5cc796';
      ctx.strokeRect(px - 8.5, py - 6.5, 17, 13);
    }
  }

  _drawPlayer(ctx) {
    const p = this.player;
    const skinAsset = this.store.assetsById.get(this.skinId) || {
      id: this.skinId,
      category: 'player',
      size: [32, 32],
    };
    const accent = SKIN_ACCENTS[this.skinId] || SKIN_ACCENTS.wl_outer_disciple;

    // Dash afterimages
    for (const ghost of p.afterimages) {
      ctx.fillStyle = `rgba(138, 232, 255, ${(ghost.life / 0.2) * 0.45})`;
      ctx.fillRect(Math.round(ghost.x - 10), Math.round(ghost.y - 22), 20, 22);
    }

    // Ground shadow
    ctx.fillStyle = 'rgba(20, 16, 26, 0.55)';
    ctx.fillRect(Math.round(p.x - 7), Math.round(p.y + 1), 14, 4);

    // Resolve real character sprite if ever generated by PixelLab
    const animInfo = skinAsset.animations?.[p.anim] || { frames: 4 };
    const frameIdx = Math.floor(p.animTime * 9) % Math.max(1, animInfo.frames);
    const frame = this.store.resolveFrame(skinAsset, {
      anim: p.anim,
      dir: p.dir,
      frameIndex: frameIdx,
    });

    const drawX = Math.round(p.x - 16);
    const drawY = Math.round(p.y - 26);

    if (frame) {
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, drawX, drawY, frame.sw, frame.sh);
    } else {
      // HONEST WIREFRAME PLACEHOLDER — NEVER FAKE PIXELLAB ART
      ctx.fillStyle = 'rgba(20, 16, 26, 0.78)';
      ctx.fillRect(drawX + 4, drawY + 4, 24, 24);
      ctx.strokeStyle = accent.primary;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(drawX + 4.5, drawY + 4.5, 23, 23);
      ctx.setLineDash([]);

      // Directional facing indicator arrow inside wireframe box
      const cx = Math.round(p.x);
      const cy = Math.round(p.y - 10);
      ctx.fillStyle = accent.trim;
      ctx.fillRect(cx - 1, cy - 1, 3, 3);
      if (p.dir === 'north') ctx.fillRect(cx - 1, cy - 6, 3, 4);
      else if (p.dir === 'south') ctx.fillRect(cx - 1, cy + 3, 3, 4);
      else if (p.dir === 'east') ctx.fillRect(cx + 3, cy - 1, 4, 3);
      else ctx.fillRect(cx - 6, cy - 1, 4, 3);

      // Tiny state + missing label
      ctx.fillStyle = '#ee7a80';
      ctx.font = '6px monospace';
      ctx.fillText('NO PIXELLAB', drawX - 2, drawY + 2);
      ctx.fillStyle = accent.trim;
      ctx.fillText(p.anim.slice(0, 4), drawX + 7, drawY + 26);
    }

    // Orbiting/held Dharma Treasure indicator next to Wang Lin
    const weaponAsset = this.store.assetsById.get(this.weaponId);
    const angle = Math.atan2(this.mouse.y - (p.y - 8), this.mouse.x - p.x);
    const wx = Math.round(p.x + Math.cos(angle) * 14);
    const wy = Math.round(p.y - 8 + Math.sin(angle) * 10);
    const wFrame = weaponAsset ? this.store.resolveFrame(weaponAsset, { anim: p.castTimer > 0 ? 'attack' : 'idle', frameIndex: 0 }) : null;
    if (wFrame) {
      ctx.drawImage(
        wFrame.image,
        wFrame.sx,
        wFrame.sy,
        wFrame.sw,
        wFrame.sh,
        Math.round(wx - wFrame.sw / 2),
        Math.round(wy - wFrame.sh / 2),
        wFrame.sw,
        wFrame.sh
      );
    } else {
      const cfg = WEAPON_STYLE_CONFIG[this.weaponId] || WEAPON_STYLE_CONFIG.wp_heaven_defying_bead;
      ctx.fillStyle = '#14101a';
      ctx.fillRect(wx - 4, wy - 4, 8, 8);
      ctx.fillStyle = cfg.color;
      ctx.fillRect(wx - 3, wy - 3, 6, 6);
      ctx.fillStyle = cfg.glow;
      ctx.fillRect(wx - 1, wy - 1, 2, 2);
    }

    if (this.debug.hitboxes) {
      const hb = this.store.getHitbox(skinAsset, p.anim);
      ctx.strokeStyle = '#ff3b30';
      ctx.strokeRect(drawX + hb.x + 0.5, drawY + hb.y + 0.5, hb.w - 1, hb.h - 1);
      // Foot collision box
      ctx.strokeStyle = '#8ae8ff';
      ctx.strokeRect(Math.round(p.x - 5) + 0.5, Math.round(p.y - 4) + 0.5, 10, 8);
    }
  }

  _drawProjectile(ctx, pr) {
    const projAsset = this.store.assetsById.get(pr.projId);
    const fIdx = Math.floor(pr.age * 14) % 4;
    const frame = projAsset ? this.store.resolveFrame(projAsset, { anim: 'flight', frameIndex: fIdx }) : null;

    const px = Math.round(pr.x);
    const py = Math.round(pr.y);

    if (frame) {
      ctx.drawImage(
        frame.image,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        Math.round(px - frame.sw / 2),
        Math.round(py - frame.sh / 2),
        frame.sw,
        frame.sh
      );
    } else {
      const r = pr.cfg.radius || 4;
      ctx.fillStyle = '#14101a';
      ctx.fillRect(px - r - 1, py - r - 1, (r + 1) * 2, (r + 1) * 2);
      ctx.fillStyle = pr.cfg.color;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
      ctx.fillStyle = pr.cfg.glow;
      ctx.fillRect(px - Math.max(1, r - 2), py - Math.max(1, r - 2), Math.max(2, (r - 2) * 2), Math.max(2, (r - 2) * 2));
    }

    if (this.debug.hitboxes) {
      ctx.strokeStyle = '#fff0b0';
      ctx.strokeRect(px - 6.5, py - 6.5, 13, 13);
    }
  }

  _drawImpactVfx(ctx, fx) {
    const t = fx.age / fx.duration;
    const vfxAsset = this.store.assetsById.get('hit_spark') || this.store.assetsById.get('vfx_qi_burst');
    const vfxFrames = vfxAsset?.animations?.play?.frames || 4;
    const fIdx = Math.min(vfxFrames - 1, Math.floor(t * vfxFrames));
    const frame = vfxAsset ? this.store.resolveFrame(vfxAsset, { anim: 'play', frameIndex: fIdx }) : null;

    const px = Math.round(fx.x);
    const py = Math.round(fx.y);

    if (frame) {
      ctx.drawImage(
        frame.image,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        Math.round(px - frame.sw / 2),
        Math.round(py - frame.sh / 2),
        frame.sw,
        frame.sh
      );
    } else {
      const rad = Math.round(3 + t * 8);
      ctx.strokeStyle = fIdx % 2 === 0 ? fx.glow : fx.color;
      ctx.strokeRect(px - rad + 0.5, py - rad + 0.5, rad * 2 - 1, rad * 2 - 1);
    }
  }

  _drawTinyMask(ctx, px, py, tileIdx) {
    ctx.fillStyle = 'rgba(20,16,26,0.72)';
    ctx.fillRect(px + 1, py + 1, 10, 7);
    ctx.fillStyle = '#fff0b0';
    ctx.font = '6px monospace';
    ctx.fillText(String(tileIdx).padStart(2, '0'), px + 2, py + 7);
  }

  _drawCanvasHud(ctx) {
    // Top-left room tag
    ctx.fillStyle = 'rgba(20, 16, 26, 0.78)';
    ctx.fillRect(4, 4, 148, 12);
    ctx.fillStyle = this.biome.accent;
    ctx.fillRect(4, 4, 2, 12);
    ctx.fillStyle = '#d4d0d8';
    ctx.font = '7px monospace';
    ctx.fillText(
      `[${this.biome.key}] ${this.biome.id.toUpperCase()} · RM ${this.roomKey} (${this.room.type})`,
      9,
      12
    );

    // Bottom-left dash cooldown bar
    const dashReady = this.player.dashCooldown <= 0;
    const pct = dashReady ? 1 : 1 - this.player.dashCooldown / 0.65;
    ctx.fillStyle = 'rgba(20, 16, 26, 0.8)';
    ctx.fillRect(4, this.logicalH - 14, 72, 10);
    ctx.fillStyle = dashReady ? '#5cc796' : '#28a8dc';
    ctx.fillRect(6, this.logicalH - 12, Math.round(68 * pct), 6);
    ctx.fillStyle = '#14101a';
    ctx.font = '6px monospace';
    ctx.fillText(dashReady ? 'DASH [SPACE]' : 'RECHARGING', 10, this.logicalH - 7);

    // Bottom-right PixelLab missing indicator if character sprite not loaded
    const charStatus = this.store.groupStatus.characters;
    if (charStatus && charStatus.state === 'missing') {
      ctx.fillStyle = 'rgba(122, 20, 38, 0.88)';
      ctx.fillRect(this.logicalW - 148, this.logicalH - 14, 144, 10);
      ctx.fillStyle = '#f9c4c0';
      ctx.font = '6px monospace';
      ctx.fillText('CHAR: missing: pixellab not generated', this.logicalW - 144, this.logicalH - 7);
    }
  }
}
