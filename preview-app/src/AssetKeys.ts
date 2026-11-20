/**
 * Shared AssetKeys contract for Tien Nghich 2D (Phaser 3 / PixiJS / preview-app).
 *
 * Frame keys are derived from `assets/processed/<group>/...` as
 * `<relative path without extension>` with `/` separators:
 *   - characters/<asset_id>/<anim>_<dir>_<frameIndex>
 *   - tilesets/<biome_id>/tile_<NN>
 *   - weapons/<id>
 *   - projectiles/<id>_<n>
 *   - props/<id>_<n>
 *   - vfx/<id>_<n>
 *   - ui/<id>
 *   - icons/<id>
 */

export const ASSET_GROUPS = {
  CHARACTERS: 'characters',
  TILESETS: 'tilesets',
  WEAPONS: 'weapons',
  PROJECTILES: 'projectiles',
  PROPS: 'props',
  VFX: 'vfx',
  ICONS: 'icons',
  UI: 'ui',
} as const;

export type AssetGroup = (typeof ASSET_GROUPS)[keyof typeof ASSET_GROUPS];

export const BIOME_IDS = {
  HENGYUE: 'hengyue',
  BLOOD_SEA: 'blood_sea',
  ANCIENT_GOD: 'ancient_god',
} as const;

export type BiomeId = (typeof BIOME_IDS)[keyof typeof BIOME_IDS];

export const DIRECTIONS = {
  SOUTH: 's',
  EAST: 'e',
  NORTH: 'n',
  WEST: 'w',
} as const;

export type DirectionCode = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

export const PLAYER_IDS = {
  WANGLIN_01: 'wl_outer_disciple',
  WANGLIN_02: 'wl_qi_condensation',
  WANGLIN_03: 'wl_blood_foundation',
  WANGLIN_04: 'wl_extreme_jing',
} as const;

export type PlayerId = (typeof PLAYER_IDS)[keyof typeof PLAYER_IDS];

export const MOB_IDS = {
  ROGUE_DISCIPLE: 'mob_rogue_disciple',
  COURTYARD_GUARD: 'mob_courtyard_guard',
  SWORD_ACOLYTE: 'mob_sword_acolyte',
  HERB_VIPER: 'mob_herb_viper',
  DEMONIC_TALISMAN: 'mob_demonic_talisman',
  BLOOD_WOLF: 'mob_blood_wolf',
  BLOOD_CROW: 'mob_blood_crow',
  BLOOD_CORPSE: 'mob_blood_corpse',
  VENGEFUL_SOUL: 'mob_vengeful_soul',
  BLOOD_POOL_LURKER: 'mob_blood_pool_lurker',
  STONE_PUPPET: 'mob_stone_puppet',
  STONE_ARCHER_PUPPET: 'mob_stone_archer_puppet',
  CHAIN_WARDEN: 'mob_chain_warden',
  VOID_EATER: 'mob_void_eater',
  RUNE_SENTINEL: 'mob_rune_sentinel',
} as const;

export type MobId = (typeof MOB_IDS)[keyof typeof MOB_IDS];

export const BOSS_IDS = {
  TENG_HUAYUAN: 'boss_teng_huayuan',
  GHOST_KING: 'boss_ghost_king',
  ANCIENT_GOD_REMNANT: 'boss_ancient_god_remnant',
} as const;

export type BossId = (typeof BOSS_IDS)[keyof typeof BOSS_IDS];

export const WEAPON_KEYS = {
  HEAVEN_DEFYING_BEAD: 'weapons/wp_heaven_defying_bead',
  SOUL_BANNER: 'weapons/wp_soul_banner',
  RESTRICTION_TALISMAN: 'weapons/wp_restriction_talisman',
  AZURE_WIND_SWORD: 'weapons/wp_azure_wind_sword',
  SLAUGHTER_SWORD: 'weapons/wp_slaughter_sword',
  BLOOD_JADE_BLADE: 'weapons/wp_blood_jade_blade',
  THUNDER_SEAL: 'weapons/wp_thunder_seal',
  BLOOD_FIEND_BANNER: 'weapons/wp_blood_fiend_banner',
  ANCIENT_GOD_HAMMER: 'weapons/wp_ancient_god_hammer',
  SOUL_LAMP: 'weapons/wp_soul_lamp',
  FIVE_ELEMENT_NEEDLES: 'weapons/wp_five_element_needles',
  SPIRIT_STONE_BEADS: 'weapons/wp_spirit_stone_beads',
} as const;

export type WeaponKey = (typeof WEAPON_KEYS)[keyof typeof WEAPON_KEYS];

export const PROJECTILE_IDS = {
  HEAVEN_DEFYING_BEAD: 'pj_heaven_defying_bead',
  SOUL_BANNER: 'pj_soul_banner',
  RESTRICTION_TALISMAN: 'pj_restriction_talisman',
  AZURE_WIND_SWORD: 'pj_azure_wind_sword',
  SLAUGHTER_SWORD: 'pj_slaughter_sword',
  BLOOD_JADE_BLADE: 'pj_blood_jade_blade',
  THUNDER_SEAL: 'pj_thunder_seal',
  BLOOD_FIEND_BANNER: 'pj_blood_fiend_banner',
  ANCIENT_GOD_HAMMER: 'pj_ancient_god_hammer',
  SOUL_LAMP: 'pj_soul_lamp',
  FIVE_ELEMENT_NEEDLES: 'pj_five_element_needles',
  SPIRIT_STONE_BEADS: 'pj_spirit_stone_beads',
} as const;

export type ProjectileId = (typeof PROJECTILE_IDS)[keyof typeof PROJECTILE_IDS];

export const PROP_IDS = {
  SPIRIT_CHEST: 'prop_spirit_chest',
  ALCHEMY_JAR: 'prop_alchemy_jar',
  TELEPORT_ARRAY: 'prop_teleport_array',
  SHRINE_ALTAR: 'prop_shrine_altar',
  ROOM_DOOR: 'prop_room_door',
  SPAWN_CIRCLE: 'prop_spawn_circle',
  STONE_LANTERN: 'prop_stone_lantern',
  BAMBOO_CLUSTER: 'prop_bamboo_cluster',
  SPIRIT_HERB: 'prop_spirit_herb',
  COURTYARD_PILLAR: 'prop_courtyard_pillar',
  SECT_BANNER: 'prop_sect_banner',
  BONE_ALTAR: 'prop_bone_altar',
  RESTRICTION_PILLAR: 'prop_restriction_pillar',
  BLOOD_POOL_DECOR: 'prop_blood_pool_decor',
  MIST_RAVINE_ROCK: 'prop_mist_ravine_rock',
  PETRIFIED_CHAIN: 'prop_petrified_chain',
  GOLDEN_RUNE_GLYPH: 'prop_golden_rune_glyph',
  VOID_CRACK_DECOR: 'prop_void_crack_decor',
  ANCIENT_STATUE: 'prop_ancient_statue',
} as const;

export type PropId = (typeof PROP_IDS)[keyof typeof PROP_IDS];

export const VFX_IDS = {
  QI_BURST: 'vfx_qi_burst',
  BLOOD_SLASH: 'vfx_blood_slash',
  SOUL_WISP: 'vfx_soul_wisp',
  THUNDER_STRIKE: 'vfx_thunder_strike',
  RUNE_RING: 'vfx_rune_ring',
  DASH_AFTERIMAGE: 'vfx_dash_afterimage',
} as const;

export type VfxId = (typeof VFX_IDS)[keyof typeof VFX_IDS];

export const UI_KEYS = {
  CARD_FRAME: 'ui/ui_card_frame',
  HUD_BARS: 'ui/ui_hud_bars',
  SPIRIT_STONE: 'ui/ui_spirit_stone',
  MINIMAP: 'ui/ui_minimap',
  FORM_PORTRAITS: 'ui/ui_form_portraits',
  PANEL_CURSOR: 'ui/ui_panel_cursor',
} as const;

export type UiKey = (typeof UI_KEYS)[keyof typeof UI_KEYS];

export const ICON_KEYS = {
  SINH_TU_CAM: 'icons/icon_sinh_tu_cam',
  TUE_NGUYET_CAM: 'icons/icon_tue_nguyet_cam',
  THIEN_LOI_DAN: 'icons/icon_thien_loi_dan',
  VAN_HON_PHE_TAM: 'icons/icon_van_hon_phe_tam',
  HUYET_HAI_CUONG_TRIEU: 'icons/icon_huyet_hai_cuong_trieu',
  THANH_PHONG_DON: 'icons/icon_thanh_phong_don',
  HO_THE_CUONG_KHI: 'icons/icon_ho_the_cuong_khi',
  NGUNG_KHI_QUYET: 'icons/icon_ngung_khi_quyet',
  TRUC_CO_DAN: 'icons/icon_truc_co_dan',
  THIEN_NGHICH_CHI_LUC: 'icons/icon_thien_nghich_chi_luc',
  CO_THAN_THE: 'icons/icon_co_than_the',
  HU_KHONG_LIET_PHUNG: 'icons/icon_hu_khong_liet_phung',
  PHONG_AN_CAM: 'icons/icon_phong_an_cam',
  CUC_CANH_HOA_THAN: 'icons/icon_cuc_canh_hoa_than',
  HUYET_TE: 'icons/icon_huyet_te',
  TU_LINH_TRAN: 'icons/icon_tu_linh_tran',
} as const;

export type IconKey = (typeof ICON_KEYS)[keyof typeof ICON_KEYS];

export type CharacterId = PlayerId | MobId | BossId;
export type CharacterFrameKey = `characters/${CharacterId}/${string}_${DirectionCode}_${number}`;
export type TilesetFrameKey = `tilesets/${BiomeId}/tile_${string}`;
export type ProjectileFrameKey = `projectiles/${ProjectileId}_${number}`;
export type PropFrameKey = `props/${PropId}_${number}`;
export type VfxFrameKey = `vfx/${VfxId}_${number}`;

export type AssetKey =
  | CharacterFrameKey
  | TilesetFrameKey
  | WeaponKey
  | ProjectileFrameKey
  | PropFrameKey
  | VfxFrameKey
  | UiKey
  | IconKey;
