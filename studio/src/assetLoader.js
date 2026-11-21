/**
 * AssetLoader — loads Phaser/Pixi 'hash' web atlases (assets/atlases/web/*.json),
 * falls back to individual PNGs (assets/processed/, assets/raw/environment_items/)
 * via /__preview_index.json, and optionally loads clearly-labelled dev fixtures
 * from assets/_fixtures/ when explicitly toggled on.
 *
 * Missing groups degrade gracefully and report truthful states
 * (e.g., 'missing: pixellab not generated' for characters/mobs/bosses).
 */

import {
  BIOMES,
  DEFAULT_VFX_ENTRIES,
  buildCandidateFrameKeys,
  primaryContractKey,
} from './assetKeys.js';
import { createDefaultBitmaskMap, parseWorkerBitmaskJson } from './blob47.js';

const IMAGE_CACHE = new Map();

function loadImage(url) {
  if (IMAGE_CACHE.has(url)) return IMAGE_CACHE.get(url);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
  IMAGE_CACHE.set(url, promise);
  return promise;
}

async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Derive a canonical frame key from a repo-relative asset PNG path.
 * E.g.:
 *   assets/processed/weapons/wp_heaven_defying_bead.png -> weapons/wp_heaven_defying_bead
 *   assets/raw/environment_items/props/prop_stone_lantern/idle_0.png -> props/prop_stone_lantern/idle_0
 *   assets/_fixtures/pngs/weapons/wp_thunder_seal.png -> weapons/wp_thunder_seal
 */
function pngPathToKeys(relPath) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const noExt = norm.replace(/\.png$/i, '');
  const keys = new Set();

  for (const prefix of [
    'assets/processed/',
    'assets/raw/environment_items/',
    'assets/raw/characters/',
    'assets/_fixtures/pngs/',
  ]) {
    if (noExt.startsWith(prefix)) {
      const stripped = noExt.slice(prefix.length);
      keys.add(stripped);
      if (prefix === 'assets/raw/characters/') {
        keys.add(`characters/${stripped}`);
      }
      // Flattened alias: weapons/wp_x/idle_0 -> weapons/wp_x
      const m = stripped.match(/^(weapons|ui|icons)\/([^/]+)\/(?:idle_0|default|0)$/);
      if (m) keys.add(`${m[1]}/${m[2]}`);

      // Nested raw convention: <group>/<id>/<id>_<anim>_<n> (e.g. ui/ui_spirit_stone/ui_spirit_stone_idle_0)
      const mAnim = stripped.match(/^(weapons|projectiles|props|vfx|ui|icons)\/([^/]+)\/\2_([a-z0-9_]+)_(\d+)$/);
      if (mAnim) {
        const [, grp, id, anim, n] = mAnim;
        keys.add(`${grp}/${id}/${anim}_${n}`);
        keys.add(`${grp}/${id}_${anim}_${n}`);
        if (anim === 'idle' || anim === 'flight' || anim === 'play') {
          keys.add(`${grp}/${id}_${n}`);
        }
      }

      // Nested raw size variant: ui/icon_x/icon_x_24x24 or ui/ui_x/ui_x_24x24
      const mSize = stripped.match(/^(ui|icons|weapons|props)\/([^/]+)\/\2_(\d+)x(\d+)$/);
      if (mSize) {
        const [, grp, id, sw] = mSize;
        keys.add(`${grp}/${id}_${sw}`);
        keys.add(`${grp}/${id}`);
        if (id.startsWith('icon_')) {
          keys.add(`icons/${id}`);
          keys.add(`ui/${id}`);
        }
      }

      // Flatten projectiles/pj_x/flight_0 -> projectiles/pj_x_0
      const mp = stripped.match(/^(projectiles|props|vfx|ui)\/([^/]+)\/(?:flight|idle|play)_(\d+)$/);
      if (mp) keys.add(`${mp[1]}/${mp[2]}_${mp[3]}`);
    }
  }
  keys.add(noExt);
  return [...keys];
}

export class AssetStore {
  constructor() {
    this.palette = null;
    this.paletteById = new Map();
    this.manifest = null;
    this.assets = [];
    this.assetsById = new Map();
    this.mobRuntime = {};
    this.index = null;
    this.vfxCatalog = new Map();
    this.bitmaskMap = createDefaultBitmaskMap();
    this.useFixtures = false;

    // Frame maps: key -> { type: 'atlas'|'png', image, sx, sy, sw, sh, url, key, isFixture }
    this.frames = new Map();
    this.loadedAtlases = [];
    this.loadedPngCount = 0;
    this.groupStatus = {};
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  async init({ useFixtures = false } = {}) {
    this.useFixtures = useFixtures;
    const [palette, manifest, index, mobRuntime, vfxIndex] = await Promise.all([
      fetchJsonSafe('/tools/generators/palette.json'),
      fetchJsonSafe('/assets/manifest.json'),
      fetchJsonSafe('/__preview_index.json'),
      fetchJsonSafe('/assets/atlases/mob-runtime.json'),
      fetchJsonSafe('/assets/processed/vfx/vfx_index.json'),
    ]);
    this.vfxCatalog = new Map((vfxIndex?.effects || []).map((e) => [e.id, e]));

    this.palette = palette;
    this.mobRuntime = mobRuntime || {};
    this.paletteById.clear();
    if (palette?.colors) {
      for (const c of palette.colors) {
        this.paletteById.set(c.id, c);
      }
    }

    this.manifest = manifest || { assets: [], summary: { total: 0, by_category: {} } };
    this.index = index || {
      atlases: [],
      processedPngs: [],
      rawEnvironmentPngs: [],
      rawCharacterPngs: [],
      bitmaskJsons: [],
      fixtureAtlases: [],
      fixturePngs: [],
    };

    // Build unified asset list (manifest assets + default VFX contract entries if manifest has no vfx)
    const rawAssets = Array.isArray(this.manifest.assets) ? [...this.manifest.assets] : [];
    const hasVfx = rawAssets.some((a) => a.category === 'vfx');
    if (!hasVfx) {
      rawAssets.push(...DEFAULT_VFX_ENTRIES.map((v) => ({ ...v, _contractEntry: true })));
    }
    this.assets = rawAssets;
    this.assetsById.clear();
    for (const a of this.assets) {
      this.assetsById.set(a.id, a);
    }

    await this.reloadAssets({ useFixtures });
  }

  async reloadAssets({ useFixtures = this.useFixtures } = {}) {
    this.useFixtures = useFixtures;
    this.frames.clear();
    this.loadedAtlases = [];
    this.loadedPngCount = 0;

    // Refresh live file index from dev server
    const freshIndex = await fetchJsonSafe('/__preview_index.json');
    if (freshIndex) this.index = freshIndex;

    // 1. Load worker bitmask mapping JSON if available
    this.bitmaskMap = createDefaultBitmaskMap();
    for (const bmPath of this.index.bitmaskJsons || []) {
      const url = `/${bmPath.replace(/^\/+/, '')}`;
      const json = await fetchJsonSafe(url);
      const parsed = json ? parseWorkerBitmaskJson(json, bmPath) : null;
      if (parsed) {
        this.bitmaskMap = parsed;
        break;
      }
    }

    // 2. Load real web atlases (assets/atlases/web/*.json)
    for (const atlasPath of this.index.atlases || []) {
      await this._loadAtlasFile(atlasPath, false);
    }

    // 3. Dev fallback: register individual PNGs under assets/processed/ & assets/raw/environment_items/ & assets/raw/characters/
    // Sort larger icon variants (e.g. 24x24) ahead of 16x16 so canonical keys default to the primary manifest size.
    const haveRealAtlas = this.loadedAtlases.some((a) => !a.isFixture);
    const forcePng = new URLSearchParams(globalThis.location?.search || '').get('png') === '1';
    const realPngs = haveRealAtlas && !forcePng ? [] : [
      ...(this.index.processedPngs || []),
      ...(this.index.rawEnvironmentPngs || []),
      ...(this.index.rawCharacterPngs || []),
    ].sort((a, b) => {
      const a24 = a.includes('_24x24') ? 0 : 1;
      const b24 = b.includes('_24x24') ? 0 : 1;
      if (a24 !== b24) return a24 - b24;
      return a.localeCompare(b);
    });
    for (const pngPath of realPngs) {
      if (pngPath.endsWith('_sheet.png')) continue;
      await this._registerPng(pngPath, false);
    }

    // 4. Optional dev fixtures (ONLY when explicitly enabled by user or ?fixtures=1)
    if (this.useFixtures) {
      for (const atlasPath of this.index.fixtureAtlases || []) {
        await this._loadAtlasFile(atlasPath, true);
      }
      for (const pngPath of this.index.fixturePngs || []) {
        await this._registerPng(pngPath, true);
      }
    }

    this._syncVfxAssets();
    this._computeGroupStatus();
    this.emit();
  }

  /** Real VFX ids come from the atlas keys `vfx/<id>_<n>` (the manifest has no VFX entries). */
  _syncVfxAssets() {
    const counts = new Map();
    for (const [key, fr] of this.frames) {
      const m = /^vfx\/(.+)_(\d+)$/.exec(key);
      if (!m || fr.isFixture) continue;
      const e = counts.get(m[1]) || { n: 0, w: fr.sw, h: fr.sh };
      e.n = Math.max(e.n, Number(m[2]) + 1);
      counts.set(m[1], e);
    }
    if (!counts.size) return;
    this.assets = this.assets.filter((a) => !(a.category === 'vfx' && a._contractEntry));
    for (const [id, e] of counts) {
      const meta = this.vfxCatalog.get(id);
      const play = { frames: e.n, loop: false };
      if (meta && meta.frame_count === e.n) {
        // Browse-only timing from the delivered catalog: per-frame ms, phase label, loop and anchor.
        play.loop = Boolean(meta.loop);
        play.fps = meta.fps;
        play.anchor = meta.anchor;
        play.events = meta.events;
        play.timeline = Array.from({ length: e.n }, (_, i) => ({
          ms: Math.round(((i + 1) * 1000) / meta.fps) - Math.round((i * 1000) / meta.fps),
          label: (meta.tags.find((t) => i >= t[1] && i <= t[2]) || [`frame ${i}`])[0],
        }));
      }
      const asset = { id, name: { vi: id, en: id }, category: 'vfx', size: meta ? [...meta.frame_size] : [e.w, e.h],
        biome: 'all', animations: { play }, palette_refs: [], _fromAtlas: true };
      this.assets.push(asset);
      this.assetsById.set(id, asset);
    }
  }

  async _loadAtlasFile(relPath, isFixture) {
    const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = `/${clean}`;
    const json = await fetchJsonSafe(url);
    if (!json || !json.frames || typeof json.frames !== 'object') return;

    const dir = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    const imgName = json.meta?.image;
    if (!imgName) return;
    const imgUrl = dir ? `/${dir}/${imgName}` : `/${imgName}`;

    let image;
    try {
      image = await loadImage(imgUrl);
    } catch {
      return;
    }

    let count = 0;
    for (const [key, entry] of Object.entries(json.frames)) {
      if (!entry?.frame) continue;
      // Never overwrite a real asset with a fixture
      if (isFixture && this.frames.has(key) && !this.frames.get(key).isFixture) continue;
      this.frames.set(key, {
        type: 'atlas',
        image,
        sx: entry.frame.x,
        sy: entry.frame.y,
        sw: entry.frame.w,
        sh: entry.frame.h,
        ground: entry.ground,
        url: imgUrl,
        atlasPath: clean,
        key,
        isFixture,
      });
      count++;
    }

    this.loadedAtlases.push({ path: clean, image: imgUrl, frameCount: count, isFixture });
    return json.meta;
  }

  /** An isolated pose catalogue for the Blood Sea duel, using the normal inspector's atlas resolver. */
  async encounterCollection() {
    const root = 'assets/encounter/blood-sea';
    const spec = await fetchJsonSafe('/' + root + '/contract.json');
    if (!spec?.actors) throw new Error('Unable to load the Blood Sea pose contract.');
    const collection = new AssetStore();
    collection.paletteById = this.paletteById;
    for (const [id, actor] of Object.entries(spec.actors)) {
      const base = this.assetsById.get(id);
      const animations = {};
      const supplements = Object.entries(spec.supplements || {}).filter(([, sheet]) => sheet.actor === id);
      for (const [page, sheet] of [[id, actor], ...supplements]) {
        const meta = await collection._loadAtlasFile(root + '/web/' + page + '.json', false);
        for (const [row, direction] of actor.rows.entries()) {
          const cells = new Map();
          for (const [col, pose] of sheet.poses.entries()) {
            const left = sheet.xEdges[row][col], top = sheet.yEdges[row];
            const replacement = sheet.replacement;
            const corrected = replacement?.direction === direction && replacement.pose === pose;
            const input = corrected ? replacement.source : (sheet.baseSource || page + '.png');
            cells.set(pose, {
              url: '/' + root + '/source/' + page + '.png', page, pose, direction,
              input, prompt: spec.sourcePrompts?.[input], digest: spec.sourceSha256[input],
              assembled: Boolean(sheet.baseSource), corrected,
              left, top, width: sheet.xEdges[row][col + 1] - left, height: sheet.yEdges[row + 1] - top,
              anchor: sheet.anchors[row][col],
            });
          }
          const clips = {...Object.fromEntries(sheet.poses.map(pose => [pose, [pose]])), ...sheet.clips};
          for (const [clip, poses] of Object.entries(clips)) {
            poses.forEach((pose, index) => {
              const frame = collection.frames.get(`characters/${id}/${clip}_${direction}_${index}`);
              if (frame) frame.sourceCell = cells.get(pose);
            });
          }
        }
        for (const [clip, poses] of Object.entries(sheet.clips)) {
          animations[clip] = { frames: poses.length, timeline: meta?.timelines?.[clip] };
        }
        for (const pose of sheet.poses) animations[pose] = { frames: 1 };
      }
      const asset = { ...base, animations, phases: undefined, assigned_agent: 'Codex ImageGen' };
      collection.assets.push(asset);
      collection.assetsById.set(id, asset);
    }
    await collection._loadAtlasFile(root + '/web/effects.json', false);
    collection._syncVfxAssets();
    for (const asset of collection.assets.filter(item => item.category === 'vfx')) {
      asset.assigned_agent = 'Codex';
      asset.name.en = asset.id.replace(/^court_/, '').replaceAll('_', ' ');
    }
    return collection;
  }

  async _registerPng(relPath, isFixture) {
    const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const url = `/${clean}`;
    const keys = pngPathToKeys(clean);
    let image;
    try {
      image = await loadImage(url);
    } catch {
      return;
    }
    for (const key of keys) {
      if (this.frames.has(key)) {
        const existing = this.frames.get(key);
        if (!existing.isFixture) continue;
        if (isFixture) continue;
      }
      this.frames.set(key, {
        type: 'png',
        image,
        sx: 0,
        sy: 0,
        sw: image.naturalWidth,
        sh: image.naturalHeight,
        url,
        key,
        isFixture,
      });
    }
    this.loadedPngCount++;
  }

  resolveFrame(asset, opts = {}) {
    const candidates = buildCandidateFrameKeys(asset, opts);
    for (const key of candidates) {
      const hit = this.frames.get(key);
      if (hit) return hit;
    }
    return null;
  }

  resolveKey(key) {
    return this.frames.get(key) || null;
  }

  resolveTileFrame(biomeId, tileIndex, sheetId = null, tileFrame = 0) {
    const biome = BIOMES.find((b) => b.id === biomeId) || BIOMES[0];
    const pseudoAsset = { category: 'tileset', id: biome.tilesetId, biome: biome.id };
    return this.resolveFrame(pseudoAsset, { tileIndex, sheetId, tileFrame });
  }

  hasAnyFrameForAsset(asset) {
    if (asset.category === 'tileset') {
      const sheetId = asset.sheets?.[0]?.id || 'floor_blob47';
      for (let i = 0; i < 47; i++) {
        const hit = this.resolveTileFrame(asset.biome, i, sheetId) || this.resolveTileFrame(asset.biome, i);
        if (hit) return hit;
      }
      return null;
    }
    const anims = asset.animations ? Object.keys(asset.animations) : ['idle'];
    const dirs = asset.directions || ['south'];
    for (const anim of anims) {
      for (const dir of dirs) {
        const hit = this.resolveFrame(asset, { anim, dir, frameIndex: 0 });
        if (hit) return hit;
      }
    }
    return this.resolveFrame(asset, { anim: 'idle', dir: 'south', frameIndex: 0 });
  }

  getMissingReason(asset) {
    if (asset.assigned_agent === 'pixellab' || ['player', 'mob', 'boss'].includes(asset.category)) {
      return 'missing: pixellab not generated';
    }
    return 'missing: asset not generated yet';
  }

  /**
   * Read hitbox from manifest if present, else fall back to full sprite bounds.
   */
  getHitbox(asset, animName = null) {
    const [w, h] = Array.isArray(asset.size) ? asset.size : [32, 32];
    const fromAnim = animName && asset.hitboxes && asset.hitboxes[animName];
    const raw = fromAnim || asset.hitbox || null;
    if (raw && typeof raw === 'object') {
      return {
        x: Number(raw.x ?? 0),
        y: Number(raw.y ?? 0),
        w: Number(raw.w ?? raw.width ?? w),
        h: Number(raw.h ?? raw.height ?? h),
        source: 'manifest',
        label: 'Hitbox: manifest',
      };
    }
    return {
      x: 0,
      y: 0,
      w,
      h,
      source: 'sprite_bounds',
      label: 'Hitbox: sprite bounds (fallback — none in manifest)',
    };
  }

  _computeGroupStatus() {
    const groups = [
      { id: 'characters', label: 'Characters (Players/Mobs/Bosses)', categories: ['player', 'mob', 'boss'], isPixelLab: true },
      { id: 'tilesets', label: 'Tilesets (47-Tile Blob)', categories: ['tileset'] },
      { id: 'weapons', label: 'Weapons (Dharma Treasures)', categories: ['weapon'] },
      { id: 'projectiles', label: 'Projectiles', categories: ['projectile'] },
      { id: 'props', label: 'Props', categories: ['prop'] },
      { id: 'vfx', label: 'VFX', categories: ['vfx'] },
      { id: 'icons', label: 'Icons', categories: ['icon'] },
      { id: 'ui', label: 'UI', categories: ['ui'] },
    ];

    const status = {};
    for (const g of groups) {
      const items = this.assets.filter((a) => g.categories.includes(a.category));
      let realAtlas = 0;
      let realPng = 0;
      let fixtureCount = 0;

      for (const a of items) {
        const hit = this.hasAnyFrameForAsset(a);
        if (!hit) continue;
        if (hit.isFixture) fixtureCount++;
        else if (hit.type === 'atlas') realAtlas++;
        else realPng++;
      }

      const realTotal = realAtlas + realPng;
      let state = 'missing';
      let badgeText = g.isPixelLab ? 'missing: pixellab not generated' : 'missing: not generated';

      if (realTotal > 0) {
        state = realTotal === items.length ? 'loaded' : 'partial';
        const src = realAtlas > 0 && realPng > 0 ? 'atlas+png' : realAtlas > 0 ? 'atlas' : 'png fallback';
        badgeText = `${realTotal}/${items.length} loaded (${src})`;
      } else if (fixtureCount > 0) {
        state = 'fixture';
        badgeText = `${fixtureCount}/${items.length} FIXTURE (dev test)`;
      }

      status[g.id] = {
        ...g,
        total: items.length,
        realAtlas,
        realPng,
        fixtureCount,
        state,
        badgeText,
      };
    }

    this.groupStatus = status;
  }

  getPlayers() {
    return this.assets.filter((a) => a.category === 'player');
  }

  getWeapons() {
    return this.assets.filter((a) => a.category === 'weapon');
  }

  getPrimaryKey(asset, opts) {
    return primaryContractKey(asset, opts);
  }
}
