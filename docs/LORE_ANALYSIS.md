# Tiên Nghịch 2D — Lore & Gameplay Analysis (Vertical Slice: Biomes 1–3)

Source: *Renegade Immortal* (仙逆, **Tiên Nghịch**) by Er Gen (耳根). Game: a Soul Knight–style room-based action roguelite.
Companion files: `assets/manifest.json` (asset list), `tools/scripts/check_manifest.py`. Art rules live in `docs/ART_BIBLE.md` (other worker; not edited here).

## 0. How to read this document — confidence tags

My recall of the novel is solid at the level of the overall arc and main artifacts and **fuzzy on fine plot details, secondary names and exact sequence** (the novel is ~2,000 chapters; the early arcs have many minor characters). Every claim is tagged:

| Tag | Meaning |
|---|---|
| **[CANON]** | I am confident this is in the novel. |
| **[CANON?]** | Believed canon, but details/names/order should be verified against the text or an English wiki before they appear in dialogue or lore text. |
| **[ADAPT]** | Real novel element deliberately reshaped for gameplay. |
| **[INVENT]** | Our own addition (no novel basis). Fine for gameplay; do not present as canon. |
| **[BRIEF]** | Name/concept supplied by the project brief; I could not independently confirm it as exactly canon. Used as-is. |

**Rule for writers/artists:** anything tagged `[CANON?]`, `[BRIEF]` or `[INVENT]` should keep in-game text vague (no "as the novel says") until verified.

Names: Vietnamese (Hán-Việt) first, pinyin / English in parentheses.

### 0.1 Verification pass (web, partial)
A quick check against the official WuxiaWorld translation and a few reference pages resolved some items. Verified facts are marked **[VERIFIED]**; they come from search snippets of the chapters, not a full read, so line-level details are still worth confirming.
- **[VERIFIED]** Ch.1: the protagonist is a village boy with the nickname *Tie Zhu* (Thiết Trụ); Ch.3: the aptitude test has 48 candidates; Ch.10: sect life is fetching water, and he is mocked as having entered Hengyue by a near-suicidal act. [Ch.1](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-1), [Ch.3](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-3), [Ch.10](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-10)
- **[VERIFIED]** Ch.25: he cultivates inside a "dream space" produced by the bead (rendered "stone bead" in the official translation; "Heaven Defying Bead/Pearl" elsewhere). [Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)
- **[VERIFIED]** Ch.191: the Blood Sea is half of a divided *sea of knowledge* made by the Ancient God Tu Si (Đồ Tư): one half a Dead Soul Sea, the other a Blood Sea. This is the canon link between "Blood Sea" and "Ancient God". [Ch.191](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)
- **[VERIFIED]** Jue Ming Valley (Quyết Minh Cốc) exists as a small place Wang Lin passes through (fights a flying-sword user). Its relation to the Blood Sea is **not** established; the game merging them is an adaptation. [Ch.142](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-142) (search hit; chapter number unconfirmed)
- **[VERIFIED]** A soul flag ("soul banner") appears later in Ch.538 holding a billion souls. So a soul banner is canon, the early-game version and the name *Tôn Hồn Phiên* are not confirmed. [Ch.538](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-538)
- **[VERIFIED]** The *Extreme Realm* (Cực Cảnh) is a rage-born state after his family is wiped out, used to break out of barriers of an outworld battlefield. It is an emotional/will mechanic, **not** a stage tied to Soul Formation. Form 4's label stays [ADAPT].
- **Not found:** Teng Huayuan could not be verified by search.

## 1. Premise and tone

**[CANON]** Wang Lin (**Vương Lâm**, 王林) is an ordinary, bookish mortal from the country of Zhao (Triệu) with a weak cultivation aptitude. He enters the Hengyue Sect (**Hằng Nhạc Phái**) at the bottom and, through a mysterious artifact (the **Heaven Defying Bead / Thiên Nghịch Châu**), cunning, patience and ruthlessness, climbs a cultivation world that treats weak people as resources. Core themes: *defying heaven* (nghịch thiên), the cost of power, revenge and loyalty, and a cold "survival first" morality. Tone: bleak, cunning, slow-burn, moments of cold vengeance — not heroic-bright.

**Game pitch:** A weak disciple fights through sealed rooms; each room clear grants *restriction cards* (cấm chế); each chapter boss forces Wang Lin to evolve into a new *form*. Runs are short (≈ 15–25 rooms per biome run, 3 biomes in the slice).

## 2. Cultivation realms and the 4 playable forms

### 2.1 Realm ladder
**[CANON]** (early to mid ladder): Qi Condensation (Ngưng Khí) → Foundation Establishment (Trúc Cơ) → Core Formation (Kết Đan) → Nascent Soul (Nguyên Anh) → Soul Formation (**Hóa Thần**) → later Ascendant/Void-related stages and beyond. Each has early/middle/late/peak sub-stages.
**[VERIFIED]** "Cực Cảnh" (Extreme Realm): a rage-born state of will used in a later arc (see §0.1), not a standard cultivation stage. The project's form 4 uses "Extreme Jing Soul Formation" **[BRIEF]**; I am not certain the novel gives Extreme to Soul Formation specifically (it is better attested at earlier stages). Treat form 4 as **[ADAPT]**.

### 2.2 The four forms

| # | Form (manifest id) | Real stage | Tag | Gameplay identity | Unlock |
|---|---|---|---|---|---|
| 1 | Hằng Nhạc Tạp Dịch Đệ Tử (`wl_outer_disciple`) | Mortal / outer servant | [CANON] | Weak, 3 HP hearts-equivalent, wooden sword, no card slots beyond 1; teaches dodge & dash | Start |
| 2 | Ngưng Khí Kỳ Tu Sĩ (`wl_qi_condensation`) | Qi Condensation | [CANON] | Qi gauge unlocked, cards (2 slots), Azure Wind sword; first Heaven-Defying-Bead pulse | After Chapter 1 boss (or first rooms hub upgrade) |
| 3 | Huyết Hải Trúc Cơ (`wl_blood_foundation`) | Foundation Establishment, Blood Sea setting | [ADAPT] | Trade HP for power ("blood" cards), Soul Banner summons, 3 card slots | After Chapter 2 boss |
| 4 | Cực Cảnh Hóa Thần (`wl_extreme_jing`) | Soul Formation (Extreme) | [ADAPT]/[BRIEF] | Red lightning aura: periodic self-damaging pulses, Slaughter Sword, 4 card slots, Ancient God body synergies | Chapter 3 entrance / meta-unlock |

Design note: the realm skip (no Core Formation / Nascent Soul form) is an **[ADAPT]** — we compress ~hundreds of chapters for a 4-form arc. In-game text may call forms "Stage" rather than naming real intermediate realms.

Suggested base stats (tunable, `[INVENT]`): HP 6/8/10/12 (half-hearts ×2), Move 100/110/115/120 %, Qi 0/60/100/140, dash i-frames 8/10/12/14 frames.

Visuals: red lightning for form 4 is a good fit — Wang Lin is later strongly associated with lightning/red-tinted power **[CANON?]** (tribulation and thunder motifs recur).

## 3. Arcs → biomes

### 3.1 Biome 1 — Hằng Nhạc Phái (Hengyue Sect)
- **[CANON]** Wang Lin is chosen/accepted at a minor sect of Zhao: low aptitude, assigned to menial/outer work; sect politics, bullying, resource scarcity; first exposure to killing/survival; learns the world's rules.
- **[CANON]** Heaven Defying Bead is in his possession by this stage and begins quietly altering his progress. **[CANON?]** How exactly he first obtains/awakens it and when its first power shows should be verified before dialogue.
- **[CANON?]** Named side cast (friends/rivals, sect elders) exist; I do not reproduce names I can't confirm. Use generic titles in-game: *Trưởng Lão* (Elder), *Ngoại Môn Đệ Tử*.
- **Rooms/theme:** stone courtyards, spirit-herb gardens, bamboo, stone lanterns (see `ts_hengyue` + props). Tutorial feel: slow enemies, telegraphed attacks, herb pickups heal.
- **Enemies [ADAPT]** (5): rogue outer disciple, courtyard guard, sword acolyte, herb-garden viper (spirit beast), demonic talisman caster (outsider/demonic-path intruder).
- **Boss: Đằng Hóa Nguyên (Teng Huayuan), Blood-Robed Patriarch** (`boss_teng_huayuan`). **[CANON?]** Teng Huayuan is a real character, a dangerous high-level cultivator antagonist who pursues Wang Lin over the Bead and is tied to blood-sect power. **[ADAPT]** Placing him as the Hengyue-biome boss and giving him a blood-robe, blood-pool and corpse-puppet kit is our design; the precise timing/relationship (he is not literally the sect's patriarch) must not be written as canon. If verification shows a mismatch, rename the boss's title only ("Blood Robe Elder") — assets stay valid.
- **Form change:** after the boss, Wang Lin condenses qi (form 2) — **[ADAPT]** (compresses the real period of training).

### 3.2 Biome 2 — Quyết Minh Cốc (Jue Ming Valley) & Huyết Hải (Blood Sea)
- **[VERIFIED]** Jue Ming Valley is a small canon location; **[VERIFIED]** the Blood Sea is canon as half of the Ancient God Tu Si's divided sea of knowledge (Ch.191), alongside a Dead Soul Sea. I could not confirm how the valley relates to the Blood Sea; the game merges them as one misty-ravine → blood-sea biome (`ts_blood_valley`) **[ADAPT]**. Design bonus: the Blood Sea ↔ Ancient God link justifies the biome 2 → 3 transition (the Ghost King can be flavored as a guardian of the Dead Soul half).
- **[CANON]** Blood Sea (**Huyết Hải**, 血海): a dangerous domain of blood-cultivation sects, beasts and ghosts, where Wang Lin must kill to live; hardens him.
- **Gameplay themes [ADAPT]:** HP-for-power economy, animated blood pools (lurkers), restriction pillars, bone altars (HP sacrifice for cards), mist that reduces visibility (shader/vignette optional).
- **Enemies** (5): blood wolf, blood crow (flyer), blood corpse cultivator, vengeful soul (ghost), blood-pool lurker.
- **Soul Restraining Banner / Tôn Hồn Phiên** **[BRIEF]** — see §5. Wang Lin gains it as Blood Sea power; unlock at form 3.
- **Boss: Oán Hồn Quỷ Vương (Soul-Devouring Ghost King)** (`boss_ghost_king`). **[INVENT]/[ADAPT]** Soul/ghost cultivation exists in the novel's world, and Wang Lin deals with ghosts, but this specific boss is a game construct. Design hook: it **devours soul-cards/minions**, so the player is rewarded for using Banner/soul synergy and punishing its feeding window.
- **Form change:** form 3 Blood-Sea Foundation Establishment — **[ADAPT]**.

### 3.3 Biome 3 — Cổ Thần Chi Địa (Ancient God Land)
- **[CANON]** The Ancient God (**Cổ Thần**) lineage is a major later part of the novel: a body-cultivation path of colossal ancient beings, relics, remnants and heritage; Wang Lin interacts with Ancient God inheritance in later arcs. **[CANON?]** The **early-arc** placement (as the end of the slice) is a compression **[ADAPT]**. Do not claim Wang Lin is at Soul Formation when meeting this in canon.
- **Themes [ADAPT]:** starry void cracks (pits), petrified chains (obstacles/pull), golden runes (puzzle/buff glyphs), stone puppets (the lore explanation: Ancient God remnant guardians **[INVENT]**).
- **Enemies** (5): stone puppet, stone archer puppet, petrified chain warden, void rift eater, golden rune sentinel.
- **Boss: Cổ Thần Tàn Khu (Colossal Ancient God Avatar / Remnant)** (`boss_ancient_god_remnant`) **[INVENT]/[ADAPT]**: a residual will inhabiting a ruined colossus; 3 phases.
- **Form change:** form 4 Extreme Jing Soul Formation with red lightning — final-stage power-fantasy, then chapter end / vertical-slice cutoff.

## 4. Characters (slice-relevant)
| Character | Tag | Role |
|---|---|---|
| Wang Lin / Vương Lâm | [CANON] | Player; 4 forms. Silent protagonist w/ occasional cold one-liners (`ui_form_portraits`). |
| Đằng Hóa Nguyên (Teng Huayuan) | [CANON?] role / [ADAPT] placement | Chapter 1 boss. |
| Oán Hồn Quỷ Vương | [INVENT] | Chapter 2 boss. |
| Cổ Thần Tàn Khu | [INVENT] on canon theme | Chapter 3 boss. |
| Sect elders, rival disciples, Blood-Sea masters | [CANON?] generic | NPC shrine/merchant dialogue using generic titles only. |
| Heaven Defying Bead spirit/presence | [CANON?] | Optional narrator voice; recommend **no speech**, only UI flashes (avoids misrepresenting its canon nature). |

Optional hub NPCs (e.g., a merchant) should be **[INVENT]** and named generically ("Lão Thương Nhân").

## 5. Artifacts → weapons/projectiles (manifest category `weapon` + `projectile`)

| Manifest id | VN / EN | Tag | Notes & mapping |
|---|---|---|---|
| `wp_heaven_defying_bead` | Thiên Nghịch Châu / Heaven Defying Bead | [CANON] | Central artifact. Orbiting bead; dormant at run start; charges with kills and emits piercing pulses. Never a "normal" weapon: it is the **meta-progression** object (upgrades persist). |
| `wp_soul_banner` | Tôn Hồn Phiên / Soul Restraining Banner | [BRIEF] | A soul/ghost banner: I recall Wang Lin using a soul-refined banner of ghosts, but cannot confirm this exact name (the usual translation of a similar Chinese name is "Soul Restraining/Subduing Banner"). Wisps homing, with soul-stack scaling. |
| `wp_restriction_talisman` | Cấm Chế Phù Lục / Restriction Talismans | [CANON?] concept | Restrictions (cấm chế) and talismans are core cultivation tools in the novel. Thrown/stuck talismans. |
| `wp_azure_wind_sword` | Phi Kiếm Thanh Phong / Azure Wind Flying Sword | [BRIEF]/[ADAPT] | Flying swords are canon; this exact sword name unverified. Returns to hand. |
| `wp_slaughter_sword` | Sát Lục Tiên Kiếm / Slaughter Immortal Sword | [BRIEF]/[ADAPT] | Name unverified; form-4 melee. |
| `wp_blood_jade_blade` | Huyết Ngọc Đoản Đao / Blood Jade Short Blade | [BRIEF]/[ADAPT] | Lifesteal dagger (Blood Sea theme). |
| `wp_thunder_seal` | Lôi Ấn / Thunder Seal | [BRIEF]/[ADAPT] | Lightning stamp; ties to form 4. |
| `wp_blood_fiend_banner` | Huyết Sát Phiên / Blood Fiend Banner | [INVENT] | Blood-themed counterpart to Soul Banner. |
| `wp_ancient_god_hammer` | Cổ Thần Thạch Chùy / Ancient God Stone Hammer | [INVENT] | Biome-3 heavy weapon. |
| `wp_soul_lamp` | Hồn Đăng / Soul Lamp | [INVENT] | Ghost-fire orbit weapon. |
| `wp_five_element_needles` | Ngũ Hành Phi Châm / Five-Element Needles | [INVENT] on canon-genre trope | Five-element is a staple xianxia trope. |
| `wp_spirit_stone_beads` | Linh Thạch Bạo Châu / Spirit-Stone Burst Beads | [INVENT] | Spirit stones (linh thạch) are canon currency; the weapon is ours. |

The 5 added weapons were picked to be *world-consistent* (xianxia/Blood-Sea/Ancient-God flavored) rather than claimed canon. Projectile sprite ids are `pj_<weapon>`.

**Weapon loadout rules [INVENT]:** 1 main weapon slot + Bead (always on). Weapon pickups from chests/shrines; weapons are tagged `orbit / throw / melee / summon_cast / flying_sword / stamp` for design variety. Qi cost: melee 0, ranged 1–3, summons 5.

## 6. Restriction & skill cards (manifest category `icon`, 24×24 + 16×16)

The "cấm chế" (restriction) idea is canon-flavored (restrictions/seals are a core xianxia/novel mechanic **[CANON?]**); **the card system itself is [INVENT]** — a Soul Knight "buff pick" analog but with a cost/risk twist: **restriction cards are powerful with drawbacks; skill cards are plain buffs.**

| Icon id | Card | Type | Effect (draft, tunable) | Tag |
|---|---|---|---|---|
| `icon_sinh_tu_cam` | Sinh Tử Cấm | restriction | −max HP, one-time revive | [BRIEF] |
| `icon_tue_nguyet_cam` | Tuế Nguyệt Cấm | restriction | time-slow field + enemy DoT | [BRIEF] |
| `icon_thien_loi_dan` | Thiên Lôi Dẫn | skill | lightning on marked foes | [BRIEF] |
| `icon_van_hon_phe_tam` | Vạn Hồn Phệ Tâm | restriction | kill → soul stacks (heal/damage), cost max HP | [BRIEF] |
| `icon_huyet_hai_cuong_trieu` | Huyết Hải Cuồng Triều | skill | knockback blood wave | [INVENT] |
| `icon_thanh_phong_don` | Thanh Phong Độn | skill | longer dash | [INVENT] |
| `icon_ho_the_cuong_khi` | Hộ Thể Cương Khí | skill | shield | [INVENT] |
| `icon_ngung_khi_quyet` | Ngưng Khí Quyết | skill | qi regen | [INVENT] |
| `icon_truc_co_dan` | Trúc Cơ Đan | skill | permanent max HP | [INVENT] (pill trope canon) |
| `icon_thien_nghich_chi_luc` | Thiên Nghịch Chi Lực | restriction | Bead pulse: huge damage, costs HP | [ADAPT] |
| `icon_co_than_the` | Cổ Thần Thể | skill | armor, KB immunity | [ADAPT] |
| `icon_hu_khong_liet_phung` | Hư Không Liệt Phùng | skill | void pull | [INVENT] |
| `icon_phong_an_cam` | Phong Ấn Cấm | restriction | seals enemy skills | [INVENT] |
| `icon_cuc_canh_hoa_than` | Cực Cảnh Hóa Thần | restriction | aura pulses w/ self-damage | [ADAPT] |
| `icon_huyet_te` | Huyết Tế | restriction | HP → cooldown refund | [INVENT] |
| `icon_tu_linh_tran` | Tụ Linh Trận | skill | spirit array regen zone | [INVENT] |

Card frames/rarity: `ui_card_frame` (common / rare / forbidden). Counts: 7 restriction, 9 skill. 16×16 variants are generated for in-HUD use (the checker does not verify the 16 variants, only their listing in `variant_sizes`).

## 7. Run structure (rooms, progression)

**Room types [INVENT]:** combat (wave of 2–3 spawns telegraphed by `prop_spawn_circle`), treasure (`prop_spirit_chest`), shrine (`prop_shrine_altar`: card choice; blood biome uses `prop_bone_altar`), herb/rest (`prop_spirit_herb`), elite (1 mini-boss mob + buff), boss. Doors (`prop_room_door`) lock until clear; teleport array (`prop_teleport_array`) = chapter exit. Alchemy jars (`prop_alchemy_jar`) = breakable loot.

Per biome (target): 8 combat, 1–2 shrine, 1 chest, 1 herb/rest, 1 elite, 1 boss. Currency: spirit stones (`ui_spirit_stone`), spent at hub for permanent Bead upgrades (meta-progression, since the Bead *is* the story's power source).

**Forms as progression:** forms are *run-persistent chapter upgrades*, not just skins: sprite + base stats + slot count. Dying returns to form 1 (Soul Knight-like) while Bead meta-upgrades persist.

## 8. Enemy & boss design hooks

Archetypes: melee, tank, ranged, fast_melee, caster, flyer, ambush, controller. Each biome has 1 flyer or ambusher to pressure positioning. Soul-themed enemies (vengeful soul, soul banner wisps) ignore walls briefly to showcase the Banner's counter-play.

| Boss | Chapter | Phases | Signature rule |
|---|---|---|---|
| Teng Huayuan | 1 | 3 (100–60 / 60–30 / 30–0) | Blood pools restrict movement; kill puppets to stop healing. |
| Soul-Devouring Ghost King | 2 | 3 (100–65 / 65–35 / 35–0) | Devours minion souls to heal; restriction pillars light up as hazards. |
| Ancient God Avatar | 3 | 3 (100–70 / 70–35 / 35–0) | Arena shrinks into void cracks; rune lattice beams. |

Animation sets are in the manifest (phase_transition + death included). Bosses are generated in 2 directions (S, E).

## 9. Asset ↔ design cross-reference

- **pixellab (22):** 4 players (4 dirs × 22 frames), 15 mobs (2 dirs; 4 anim sets), 3 bosses (2 dirs). Output under `assets/raw/characters/`.
- **codex_antigravity (68):** 3 tilesets (47-tile blob, 16 px; each with floor, wall-top, 16×32 wall face for 2.5D, deco, and animated liquids/runes), 12 weapons + 12 projectiles, 19 props, 16 icons, 6 UI.
- **Directions:** players use 4 dirs because aiming/dash direction matter and held weapons/banner are asymmetric; the primary view is front-facing (south) as in Soul Knight. Mobs/bosses use S+E with W mirrored.
- **Palette:** `palette_refs` use palette v2 ids from `tools/generators/palette.json` (jade_/blood_/bronze_/soul_/thunder_/ink_). No hex is stored in the manifest; the outline `ink_01` is implicit. Skin tones use `blood_07`/`blood_06` per the ART_BIBLE. Non-standard sizes (projectiles 16×16, props, UI) are not yet in `size_classes`; the art owner must propose classes.

## 10. Uncertainty register / to verify before shipping text

1. Exact acquisition of the Heaven Defying Bead (dream-space use is verified, Ch.25). [CANON?]
2. Teng Huayuan's real timeline, title and relation to Hengyue/Blood Sea. [CANON?] — the "Blood-Robed Patriarch" title is from the brief.
3. Quyết Minh Cốc exists (verified) but its relation to the Blood Sea is unconfirmed; merged by design. [ADAPT]
4. A soul flag is canon (Ch.538, later); the name Tôn Hồn Phiên and the sword/blade names are unverified. [BRIEF]
5. Extreme Realm is a rage-born state, not tied to Soul Formation; form 4 is [ADAPT]. (Resolved to [ADAPT].)
6. Ancient God arc's real chronological place; our biome 3 is a compression. [ADAPT]
7. Secondary character names (friends, rivals, elders, Blood Sea masters) intentionally omitted.
8. Ghost King and Ancient God Remnant are our bosses, not canon fights.

Recommended follow-up: a 1-hour pass against an English wiki/Vietnamese translation of the first ~300 chapters to convert every `[CANON?]` to `[CANON]` or `[ADAPT]`.
