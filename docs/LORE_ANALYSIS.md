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

### 0.1 Verification pass (official Wuxiaworld translation)
Checked directly against the official licensed English translation (*Renegade Immortal* on Wuxiaworld). Chapters 1–50 are publicly readable in full; Chapters 55+ are paywalled and expose only official opening excerpts labeled `(Teaser)`. Claims marked **[VERIFIED]** below are supported directly by the readable text of the linked chapter or teaser; details beyond the paywall remain **[CANON?]** / **[BRIEF]** and are never inferred from search snippets.

- **Translation & name chronology [VERIFIED]:**
  - The protagonist is first called by his village nickname *Tie Zhu* (Thiết Trụ), son of a carpenter in the country of Zhao ([Ch.1](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-1)), and uses his formal name *Wang Lin* (Vương Lâm) as he enters the Heng Yue Sect as a gray-robed honorary disciple mocked for relying on a near-suicidal cliff jump ([Ch.3](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-3), [Ch.10](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-10)).
  - Early chapters render the bead simply as the **"stone bead"** ([Ch.8](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-8), [Ch.9](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-9), [Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)); the later true name *Thiên Nghịch Châu / Heaven Defying Bead* is retained as the project label (`wp_heaven_defying_bead`), while the exact chapter introducing that later name is beyond the free cutoff (unverified).
  - Official Wuxiaworld uses **Ji Realm** for *Cực Cảnh* (极境) ([Ch.105 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-105)); *Extreme Realm* is a project/fan rendering.
- **Acquisition & early use of the bead [VERIFIED]:**
  - After falling off a cliff, Wang Lin is pulled mid-fall into a small bone-strewn natural cave by a periodic suction force from a hole in the wall and discovers the stone bead ([Ch.8](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-8)); he collects dew produced by the bead to survive and descend the cliff ([Ch.9](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-9)).
  - At Heng Yue Sect, he uses spiritual-energy spring water and the bead's time-dilated "dream space" (enterable three times daily, ~50 hours per session) to cultivate toward Qi Condensation ([Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)).
- **Teng Huayuan placement & title [VERIFIED (Teaser) / ADAPT]:**
  - Teng Huayuan (*Đằng Hóa Nguyên*) is a canon **Nascent Soul** antagonist in Zhao whom Foundation Establishment Wang Lin dares to confront outside Jue Ming Valley ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)), and the central target of Wang Lin's later extermination of the Teng family ([Ch.234 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-234), [Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)).
  - He is **not** Heng Yue Sect's patriarch; the brief's title *"Blood-Robed Patriarch"* and Biome 1 placement are **[ADAPT]**. His exact formal family title and the full backstory of how his feud with Wang Lin starts remain unverified (paywalled beyond official teasers).
- **Jue Ming Valley vs. Blood Sea [VERIFIED (Teaser) / ADAPT]:**
  - **Jue Ming Valley** (*Quyết Minh Cốc*) is a location in Zhao outside which Wang Lin confronts Nascent Soul Teng Huayuan as Zhao loses its right to enter the Foreign Battleground ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)).
  - The **Blood Sea** (*Huyết Hải*) is in a separate, later arc inside the Land of the Ancient God: Ancient God Tu Si (*Đồ Tư*) split his Sea of Knowledge into the pitch-black **Dead Soul Sea** (guarding his knowledge inheritance) and the blood-red **Blood Sea** (trapping the red-haired man) ([Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)). Merging Jue Ming Valley and the Blood Sea into Biome 2 (`ts_blood_valley`) is **[ADAPT]**.
- **Extreme / Ji Realm association [VERIFIED (Teaser) / ADAPT]:**
  - The **Ji Realm** (*Cực Cảnh*) is an ancient spiritual-energy realm that makes a cultivator invincible among peers of the same stage, with an explicit canonical weakness: **a Ji Realm cultivator can never reach the Soul Formation stage** ([Ch.105 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-105)). Pairing Ji/Extreme Realm with Soul Formation in Form 4 (`wl_extreme_jing`, *Cực Cảnh Hóa Thần*) is therefore a deliberate **[ADAPT]**. (The exact later mechanics of Wang Lin's Ji Realm acquisition remain unverified past the paywall.)
- **Three-biome ordering [VERIFIED (Teaser) / ADAPT]:**
  - Canon chronology runs Heng Yue Sect ([Ch.3](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-3)–[Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)) → Jue Ming Valley / Foreign Battleground prelude ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)) → Land of the Ancient God, which *contains* the Blood Sea / Dead Soul Sea ([Ch.168 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-168), [Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191), [Ch.199 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-199)) → return to Zhao to exterminate the Teng family ([Ch.234 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-234)–[Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)). Compressing this into Biome 1 (Heng Yue + Teng Huayuan) → Biome 2 (Jue Ming Valley & Blood Sea) → Biome 3 (Ancient God Land) is **[ADAPT]**.
- **Remaining unverified items (paywalled beyond official teasers):** Soul Banner's early-game acquisition and exact name *Tôn Hồn Phiên* (late-novel soul banner chapters are paywalled), exact chapter naming the bead *Heaven Defying Bead*, sword/blade names (`wp_azure_wind_sword`, `wp_slaughter_sword`, `wp_blood_jade_blade`, `wp_thunder_seal`), and Teng Huayuan's early feud backstory/title.

## 1. Premise and tone

**[CANON]** Wang Lin (**Vương Lâm**, 王林) is an ordinary, bookish mortal from the country of Zhao (Triệu) with a weak cultivation aptitude. He enters the Hengyue Sect (**Hằng Nhạc Phái**) at the bottom and, through a mysterious artifact (the **Heaven Defying Bead / Thiên Nghịch Châu**), cunning, patience and ruthlessness, climbs a cultivation world that treats weak people as resources. Core themes: *defying heaven* (nghịch thiên), the cost of power, revenge and loyalty, and a cold "survival first" morality. Tone: bleak, cunning, slow-burn, moments of cold vengeance — not heroic-bright.

**Game pitch:** A weak disciple fights through sealed rooms; each room clear grants *restriction cards* (cấm chế); each chapter boss forces Wang Lin to evolve into a new *form*. Runs are short (≈ 15–25 rooms per biome run, 3 biomes in the slice).

## 2. Cultivation realms and the 4 playable forms

### 2.1 Realm ladder
**[CANON]** (early to mid ladder): Qi Condensation (Ngưng Khí) → Foundation Establishment (Trúc Cơ) → Core Formation (Kết Đan) → Nascent Soul (Nguyên Anh) → Soul Formation (**Hóa Thần**) → later Ascendant/Void-related stages and beyond. Each has early/middle/late/peak sub-stages.
**[VERIFIED]** "Cực Cảnh" (official Wuxiaworld: **Ji Realm**, project/fan label: Extreme Realm): an ancient spiritual-energy realm making a cultivator invincible among same-level peers, but explicitly barring them from ever reaching **Soul Formation** ([Ch.105 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-105)). The project's form 4 uses "Extreme Jing Soul Formation" **[BRIEF]**; pairing Ji/Extreme Realm with Soul Formation is canonically incompatible and is therefore a deliberate **[ADAPT]**.

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
- **[VERIFIED]** Wang Lin enters Heng Yue Sect as a gray-robed honorary disciple after a near-suicidal cliff jump and faces sect politics and mockery ([Ch.3](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-3), [Ch.10](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-10)).
- **[VERIFIED]** He acquires the **stone bead** (*Thiên Nghịch Châu* / Heaven Defying Bead) before entering the sect: during his cliff fall, a periodic suction force pulls him into a bone-strewn cave where he finds the bead ([Ch.8](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-8)), survives on its dew ([Ch.9](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-9)), and later cultivates inside its time-dilated dream space toward Qi Condensation ([Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)).
- **[CANON?]** Named side cast (friends/rivals, sect elders) exist; I do not reproduce names I can't confirm. Use generic titles in-game: *Trưởng Lão* (Elder), *Ngoại Môn Đệ Tử*.
- **Rooms/theme:** stone courtyards, spirit-herb gardens, bamboo, stone lanterns (see `ts_hengyue` + props). Tutorial feel: slow enemies, telegraphed attacks, herb pickups heal.
- **Enemies [ADAPT]** (5): rogue outer disciple, courtyard guard, sword acolyte, herb-garden viper (spirit beast), demonic talisman caster (outsider/demonic-path intruder).
- **Boss: Đằng Hóa Nguyên (Teng Huayuan), Blood-Robed Patriarch** (`boss_teng_huayuan`). **[VERIFIED (Teaser)]** Teng Huayuan is a canon **Nascent Soul** antagonist of the **Teng family** in Zhao whom Foundation Establishment Wang Lin confronts outside Jue Ming Valley ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)) and later faces during the extermination of the Teng family ([Ch.234 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-234), [Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)). **[ADAPT]** He is not Heng Yue's patriarch, and placing him as the Biome 1 boss with the brief's "Blood-Robed Patriarch" title and a blood-pool/corpse-puppet kit is a game adaptation; his exact formal title and earlier feud origin remain unverified (paywalled beyond teasers).
- **Form change:** after the boss, Wang Lin condenses qi (form 2) — **[ADAPT]** (compresses the real period of training).

### 3.2 Biome 2 — Quyết Minh Cốc (Jue Ming Valley) & Huyết Hải (Blood Sea)
- **[VERIFIED (Teaser)]** **Jue Ming Valley** (*Quyết Minh Cốc*) is a location in Zhao outside which Foundation Establishment Wang Lin confronts Nascent Soul Teng Huayuan as Zhao loses entry to the Foreign Battleground ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)). **[VERIFIED (Teaser)]** The **Blood Sea** (*Huyết Hải*) is in a separate later arc inside the Land of the Ancient God, formed as one half of Ancient God Tu Si's divided Sea of Knowledge alongside the Dead Soul Sea ([Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)). Merging these two unrelated canon locales into one misty-ravine → blood-sea biome (`ts_blood_valley`) is **[ADAPT]**. Design bonus: the Blood Sea ↔ Ancient God link justifies the biome 2 → 3 transition (the Ghost King can be flavored as a guardian of the Dead Soul half).
- **[ADAPT]** Blood-cultivation sect mobs, beasts, and ghosts populating the merged Blood Sea biome are gameplay theming rather than a literal blood-sect domain at Jue Ming Valley.
- **Gameplay themes [ADAPT]:** HP-for-power economy, animated blood pools (lurkers), restriction pillars, bone altars (HP sacrifice for cards), mist that reduces visibility (shader/vignette optional).
- **Enemies** (5): blood wolf, blood crow (flyer), blood corpse cultivator, vengeful soul (ghost), blood-pool lurker.
- **Soul Restraining Banner / Tôn Hồn Phiên** **[BRIEF]** — see §5. Wang Lin gains it as Blood Sea power; unlock at form 3.
- **Boss: Oán Hồn Quỷ Vương (Soul-Devouring Ghost King)** (`boss_ghost_king`). **[INVENT]/[ADAPT]** Soul/ghost cultivation exists in the novel's world, and Wang Lin deals with ghosts, but this specific boss is a game construct. Design hook: it **devours soul-cards/minions**, so the player is rewarded for using Banner/soul synergy and punishing its feeding window.
- **Form change:** form 3 Blood-Sea Foundation Establishment — **[ADAPT]**.

### 3.3 Biome 3 — Cổ Thần Chi Địa (Ancient God Land)
- **[VERIFIED (Teaser)]** The **Land of the Ancient God** (*Cổ Thần Chi Địa*) is a canon arc spanning [Ch.168 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-168) through [Ch.199 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-199), containing Ancient God Tu Si's divided Blood Sea / Dead Soul Sea ([Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)) and body-reconstruction inheritance ([Ch.199 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-199)). **[ADAPT]** Separating Blood Sea into Biome 2 before Ancient God Land, moving Teng Huayuan ahead of both to Biome 1, and ending Biome 3 in Soul Formation / Ji Realm Form 4 are deliberate vertical-slice compressions.
- **Themes [ADAPT]:** starry void cracks (pits), petrified chains (obstacles/pull), golden runes (puzzle/buff glyphs), stone puppets (the lore explanation: Ancient God remnant guardians **[INVENT]**).
- **Enemies** (5): stone puppet, stone archer puppet, petrified chain warden, void rift eater, golden rune sentinel.
- **Boss: Cổ Thần Tàn Khu (Colossal Ancient God Avatar / Remnant)** (`boss_ancient_god_remnant`) **[INVENT]/[ADAPT]**: a residual will inhabiting a ruined colossus; 3 phases.
- **Form change:** form 4 Extreme Jing Soul Formation with red lightning — final-stage power-fantasy, then chapter end / vertical-slice cutoff.

## 4. Characters (slice-relevant)
| Character | Tag | Role |
|---|---|---|
| Wang Lin / Vương Lâm | [CANON] | Player; 4 forms. Silent protagonist w/ occasional cold one-liners (`ui_form_portraits`). |
| Đằng Hóa Nguyên (Teng Huayuan) | [VERIFIED (Teaser)] Nascent Soul Teng antagonist / [ADAPT] Biome 1 placement & title | Chapter 1 boss ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118), [Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)). |
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

*Historical (as of 2026-11-21): the producer labels below record the original manifest split. PixelLab has been retired since 2026-11-22; see `docs/ASSET_ROUTING.md` for the current routing.*

- **pixellab (22):** 4 players (4 dirs × 22 frames), 15 mobs (2 dirs; 4 anim sets), 3 bosses (2 dirs). Output under `assets/raw/characters/`.
- **codex_antigravity (68):** 3 tilesets (47-tile blob, 16 px; each with floor, wall-top, 16×32 wall face for 2.5D, deco, and animated liquids/runes), 12 weapons + 12 projectiles, 19 props, 16 icons, 6 UI.
- **Directions:** players use 4 dirs because aiming/dash direction matter and held weapons/banner are asymmetric; the primary view is front-facing (south) as in Soul Knight. Mobs/bosses use S+E with W mirrored.
- **Palette:** `palette_refs` use palette v2 ids from `tools/generators/palette.json` (jade_/blood_/bronze_/soul_/thunder_/ink_). No hex is stored in the manifest; the outline `ink_01` is implicit. Skin tones use `blood_07`/`blood_06` per the ART_BIBLE. Non-standard sizes (projectiles 16×16, props, UI) are not yet in `size_classes`; the art owner must propose classes.

## 10. Uncertainty register / to verify before shipping text

1. **Resolved [VERIFIED]:** Acquisition and early use of the stone bead (*Heaven Defying Bead*) — found in a cliffside cave via periodic suction pull ([Ch.8](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-8)), dew collected to survive ([Ch.9](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-9)), dream-space cultivation at Heng Yue ([Ch.25](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-25)). *Still open:* exact later chapter introducing the name "Heaven Defying Bead" (paywalled).
2. **Partially resolved [VERIFIED (Teaser) / ADAPT]:** Teng Huayuan is a Nascent Soul antagonist of the Teng family in Zhao ([Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118), [Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)), not Heng Yue's patriarch; Biome 1 placement and the "Blood-Robed Patriarch" title are **[ADAPT]**. *Still open:* exact family title and earlier feud backstory (paywalled beyond official teasers).
3. **Resolved [VERIFIED (Teaser) / ADAPT]:** Jue Ming Valley (Zhao, [Ch.118 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-118)) and the Blood Sea (Ancient God Tu Si's divided Sea of Knowledge inside the Land of the Ancient God, [Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)) are separate canon locales; Biome 2 merges them as **[ADAPT]**.
4. **Still open [BRIEF]:** Soul Banner's early-game acquisition and exact name *Tôn Hồn Phiên*, plus sword/blade/seal names (`wp_azure_wind_sword`, `wp_slaughter_sword`, `wp_blood_jade_blade`, `wp_thunder_seal`) remain unverified (relevant later chapters are paywalled on Wuxiaworld).
5. **Resolved [VERIFIED (Teaser) / ADAPT]:** Ji Realm (*Cực Cảnh*) explicitly prevents a cultivator from reaching Soul Formation ([Ch.105 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-105)); Form 4 (`wl_extreme_jing`) is **[ADAPT]**. *Still open:* full later mechanics of Wang Lin's Ji Realm acquisition (paywalled).
6. **Resolved [VERIFIED (Teaser) / ADAPT]:** Land of the Ancient God spans [Ch.168 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-168)–[Ch.199 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-199) and contains the Blood Sea ([Ch.191 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-191)), preceding the Teng family showdown ([Ch.234 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-234)–[Ch.246 (Teaser)](https://www.wuxiaworld.com/novel/renegade-immortal/rge-chapter-246)). The game's 3-biome order is **[ADAPT]**.
7. Secondary character names (friends, rivals, elders, Blood Sea masters) intentionally omitted.
8. Ghost King and Ancient God Remnant are our bosses (**[INVENT]** / **[ADAPT]**), not canon fights.

Recommended follow-up: consult full licensed chapters beyond Ch.50 (or licensed Chinese original on Qidian) before writing dialogue that references Teng Huayuan's early feud, the bead's later renaming, or the Soul Banner's canon name.
