/**
 * Runtime ES-module mirror of AssetKeys.ts + canonical key builder helpers.
 * Keeps preview-app zero-build while adhering strictly to the shared atlas contract.
 */

export const ASSET_GROUPS = Object.freeze({
  CHARACTERS: 'characters',
  TILESETS: 'tilesets',
  WEAPONS: 'weapons',
  PROJECTILES: 'projectiles',
  PROPS: 'props',
  VFX: 'vfx',
  ICONS: 'icons',
  UI: 'ui',
});

export const BIOMES = Object.freeze([
  {
    id: 'hengyue',
    tilesetId: 'ts_hengyue',
    key: '1',
    nameVi: 'Hằng Nhạc Phái',
    nameEn: 'Hengyue Sect',
    subtitle: 'Stone courtyards, spirit-herb gardens, bamboo & lanterns',
    accent: '#2fa27a',
    palette: {
      bg: '#14101a',
      wallTop: '#49434f',
      wallTopEdge: '#6e6877',
      wallFace: '#2c2733',
      wallFaceAccent: '#22795f',
      floorA: '#49434f',
      floorB: '#6e6877',
      floorTrim: '#2c2733',
      patchA: '#17594b',
      patchB: '#22795f',
      patchEdge: '#5cc796',
      door: '#bf8a1e',
      doorGlow: '#9ae3b8',
    },
  },
  {
    id: 'blood_sea',
    tilesetId: 'ts_blood_valley',
    key: '2',
    nameVi: 'Huyết Hải',
    nameEn: 'Blood Sea & Jue Ming Valley',
    subtitle: 'Misty ravines, animated blood pools, bone altars & restriction pillars',
    accent: '#d03a4a',
    palette: {
      bg: '#14101a',
      wallTop: '#2a0a16',
      wallTopEdge: '#4f0f22',
      wallFace: '#1b1030',
      wallFaceAccent: '#7a1426',
      floorA: '#2c2733',
      floorB: '#49434f',
      floorTrim: '#2a0a16',
      patchA: '#7a1426',
      patchB: '#a51d35',
      patchEdge: '#ee7a80',
      door: '#d03a4a',
      doorGlow: '#b99aeb',
    },
  },
  {
    id: 'ancient_god',
    tilesetId: 'ts_ancient_god',
    key: '3',
    nameVi: 'Cổ Thần Chi Địa',
    nameEn: 'Ancient God Land',
    subtitle: 'Starry void cracks, petrified chains & golden Ancient God runes',
    accent: '#e0b030',
    palette: {
      bg: '#14101a',
      wallTop: '#1b1030',
      wallTopEdge: '#63400f',
      wallFace: '#2d1b4e',
      wallFaceAccent: '#bf8a1e',
      floorA: '#2d1b4e',
      floorB: '#46297a',
      floorTrim: '#1b1030',
      patchA: '#14101a',
      patchB: '#46297a',
      patchEdge: '#f5d765',
      door: '#e0b030',
      doorGlow: '#fff0b0',
    },
  },
]);

export const DIR_NAME_TO_CODE = Object.freeze({
  south: 's',
  east: 'e',
  north: 'n',
  west: 'w',
  s: 's',
  e: 'e',
  n: 'n',
  w: 'w',
});

export const PLAYER_ALIAS_MAP = Object.freeze({
  wl_outer_disciple: 'wanglin_01',
  wl_qi_condensation: 'wanglin_02',
  wl_blood_foundation: 'wanglin_03',
  wl_extreme_jing: 'wanglin_04',
});

export const DEFAULT_VFX_ENTRIES = Object.freeze([
  {
    id: 'vfx_qi_burst',
    name: { vi: 'Linh Khí Bạo Phát', en: 'Qi Burst Impact' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [24, 24],
    biome: 'all',
    description: 'Cyan spirit qi burst on projectile impact or qi release.',
    animations: { play: { frames: 4, loop: false } },
    palette_refs: ['thunder_02', 'thunder_03', 'thunder_04', 'ink_01'],
    status: 'pending',
  },
  {
    id: 'vfx_blood_slash',
    name: { vi: 'Huyết Trảm Quang', en: 'Blood Slash Arc' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [32, 32],
    biome: 'blood_sea',
    description: 'Crimson sword/claw cleave arc for Blood-Sea weapons & bosses.',
    animations: { play: { frames: 4, loop: false } },
    palette_refs: ['blood_03', 'blood_05', 'blood_07', 'ink_01'],
    status: 'pending',
  },
  {
    id: 'vfx_soul_wisp',
    name: { vi: 'Oán Hồn Hỏa', en: 'Soul Banner Wisp Trail' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [16, 16],
    biome: 'blood_sea',
    description: 'Obsidian-violet soul wisps trailing Soul Restraining Banner.',
    animations: { play: { frames: 4, loop: true } },
    palette_refs: ['soul_03', 'soul_05', 'soul_07', 'ink_01'],
    status: 'pending',
  },
  {
    id: 'vfx_thunder_strike',
    name: { vi: 'Thiên Lôi Giáng Thế', en: 'Heavenly Thunder Strike' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [32, 48],
    biome: 'all',
    description: 'Cyan-and-red tribulation lightning bolt for Thunder Seal & Form 4.',
    animations: { play: { frames: 4, loop: false } },
    palette_refs: ['thunder_02', 'thunder_04', 'thunder_05', 'ink_01'],
    status: 'pending',
  },
  {
    id: 'vfx_rune_ring',
    name: { vi: 'Cổ Thần Phù Hoàn', en: 'Ancient God Rune Ring' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [32, 32],
    biome: 'ancient_god',
    description: 'Expanding golden rune shockwave for Ancient God relics.',
    animations: { play: { frames: 4, loop: false } },
    palette_refs: ['bronze_04', 'bronze_06', 'bronze_07', 'ink_01'],
    status: 'pending',
  },
  {
    id: 'vfx_dash_afterimage',
    name: { vi: 'Độn Pháp Tàn Ảnh', en: 'Azure Wind Dash Trail' },
    category: 'vfx',
    assigned_agent: 'codex_antigravity',
    size: [32, 32],
    biome: 'all',
    description: 'Translucent cyan/jade silhouette echo during Space dash.',
    animations: { play: { frames: 4, loop: false } },
    palette_refs: ['jade_05', 'thunder_03', 'ink_01'],
    status: 'pending',
  },
]);

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Returns candidate canonical frame keys (ordered by preference) for an asset frame.
 * Supports both exact shared contract keys and minor manifest/raw path variations.
 */
export function buildCandidateFrameKeys(asset, { anim = 'idle', dir = 'south', frameIndex = 0, tileIndex = 0, sheetId = null } = {}) {
  const cat = asset.category;
  const id = asset.id;
  const d = DIR_NAME_TO_CODE[dir] || 's';
  const keys = [];

  if (cat === 'player' || cat === 'mob' || cat === 'boss') {
    const alias = PLAYER_ALIAS_MAP[id];
    const subFolder = cat === 'player' ? 'players' : cat === 'mob' ? 'mobs' : 'bosses';
    keys.push(`characters/${id}/${anim}_${d}_${frameIndex}`);
    if (alias) keys.push(`characters/${alias}/${anim}_${d}_${frameIndex}`);
    keys.push(`characters/${subFolder}/${id}/${anim}_${d}_${frameIndex}`);
    keys.push(`characters/${id}/${anim}/${dir}_${frameIndex}`);
    keys.push(`characters/${id}/${anim}_${dir}_${frameIndex}`);
    if (frameIndex === 0) {
      keys.push(`characters/${id}/${anim}_${d}`);
    }
    return keys;
  }

  if (cat === 'tileset') {
    const biomeId = asset.biome || id.replace(/^ts_/, '');
    const nn = pad2(tileIndex);
    if (sheetId) {
      keys.push(`tilesets/${biomeId}/${sheetId}/tile_${nn}`);
      keys.push(`tilesets/${id}/${sheetId}/tile_${nn}`);
      keys.push(`tilesets/${biomeId}/${sheetId}_${nn}`);
      keys.push(`tilesets/${id}/${sheetId}_${nn}`);
    }
    keys.push(`tilesets/${biomeId}/tile_${nn}`);
    keys.push(`tilesets/${id}/tile_${nn}`);
    keys.push(`tilesets/${biomeId}/tile_${tileIndex}`);
    return keys;
  }

  if (cat === 'weapon') {
    if (anim && anim !== 'idle') {
      keys.push(`weapons/${id}/${anim}_${frameIndex}`);
      keys.push(`weapons/${id}_${anim}_${frameIndex}`);
    }
    keys.push(`weapons/${id}_${frameIndex}`);
    keys.push(`weapons/${id}`);
    keys.push(`weapons/${id}/idle_${frameIndex}`);
    return keys;
  }

  if (cat === 'projectile') {
    if (anim && anim !== 'flight') {
      keys.push(`projectiles/${id}/${anim}_${frameIndex}`);
      keys.push(`projectiles/${id}_${anim}_${frameIndex}`);
    }
    keys.push(`projectiles/${id}_${frameIndex}`);
    keys.push(`projectiles/${id}/${anim || 'flight'}_${frameIndex}`);
    keys.push(`projectiles/${id}`);
    return keys;
  }

  if (cat === 'prop') {
    if (anim) {
      keys.push(`props/${id}/${anim}_${frameIndex}`);
      keys.push(`props/${id}_${anim}_${frameIndex}`);
    }
    keys.push(`props/${id}_${frameIndex}`);
    keys.push(`props/${id}`);
    return keys;
  }

  if (cat === 'vfx') {
    if (anim) {
      keys.push(`vfx/${id}/${anim}_${frameIndex}`);
      keys.push(`vfx/${id}_${anim}_${frameIndex}`);
    }
    keys.push(`vfx/${id}_${frameIndex}`);
    keys.push(`vfx/${id}`);
    return keys;
  }

  if (cat === 'icon') {
    keys.push(`ui/${id}`);
    keys.push(`icons/${id}`);
    keys.push(`ui/icons/${id}`);
    keys.push(`icons/${id}_24`);
    keys.push(`ui/${id}_${frameIndex}`);
    return keys;
  }

  if (cat === 'ui') {
    if (anim) {
      keys.push(`ui/${id}/${anim}_${frameIndex}`);
      keys.push(`ui/${id}_${anim}_${frameIndex}`);
      keys.push(`ui/${id}_${anim}`);
    }
    keys.push(`ui/${id}_${frameIndex}`);
    keys.push(`ui/${id}`);
    return keys;
  }

  keys.push(`${cat}/${id}_${frameIndex}`, `${cat}/${id}`);
  return keys;
}

export function primaryContractKey(asset, opts = {}) {
  const cat = asset.category;
  const id = asset.id;
  const d = DIR_NAME_TO_CODE[opts.dir || 'south'] || 's';
  const fi = opts.frameIndex ?? 0;
  if (cat === 'player' || cat === 'mob' || cat === 'boss') {
    return `characters/${id}/${opts.anim || 'idle'}_${d}_${fi}`;
  }
  if (cat === 'tileset') {
    const biomeId = asset.biome || id.replace(/^ts_/, '');
    return `tilesets/${biomeId}/tile_${pad2(opts.tileIndex ?? 0)}`;
  }
  if (cat === 'weapon') return `weapons/${id}`;
  if (cat === 'projectile') return `projectiles/${id}_${fi}`;
  if (cat === 'prop') return `props/${id}_${fi}`;
  if (cat === 'vfx') return `vfx/${id}_${fi}`;
  if (cat === 'icon') return `ui/${id}`;
  if (cat === 'ui') return `ui/${id}`;
  return `${cat}/${id}`;
}
