# Art Bible - Tien Nghich 2D (Xianxia, "Renegade Immortal")

Machine-readable twin: `tools/generators/palette.json` (v2: stable `id`, `index`, `name`, `group`, `hex`). PixelLab prompts and Codex/Antigravity scripts MUST take hex values from that file. Validator: `tools/scripts/validate_palette.py`.

## Rules
1. **Perspective:** 3/4 top-down dungeon view, Soul Knight style. Front-facing characters; 2.5D vertical walls (front face + top cap); floors are flat top faces. No side-view, no 2:1 isometric diamond.
2. **Outline:** 1px solid `#14101a` (`ink_01`) on the outer silhouette of every sprite. Alpha is binary (0 or 255).
3. **Palette:** exactly the 40 colors below, nothing else. Light from top-left; shade ramps run dark->light inside one group.
4. **Grid:** native pixel art, integer nearest-neighbor scaling only.
5. **Mood:** ink-wash stone as the dungeon base; jade (life/wood), Blood-Sea crimson (demonic cultivation), Ancient God bronze/gold (treasures, relics), Soul-Banner obsidian/violet (souls, banners, curses), heavenly-thunder cyan/red (tribulation lightning).

## Canvas / size classes
| Class | Canvas | Used for |
|---|---|---|
| `tile` | 16x16 | floors, walls, doors |
| `character` | 32x32 | player skins, humanoid mobs (front-facing) |
| `weapon` | 24x24 to 32x32 (24x24 or 32x32) | Dharma Treasures |
| `boss` | 64x64 to 96x96, square | chapter bosses |
| `icon` | 16x16 or 24x24 | UI skill / restriction icons |

Canvas size is the sprite frame size; animations use one canvas per frame. Non-standard sizes (e.g. projectiles, props, VFX) are not yet specified - propose a class before generating and add it to `palette.json` `size_classes`.

## Palette (40, 6 groups)
| # | id | name | group | hex |
|---|---|---|---|---|
| 1 | `jade_01` | jade-abyss | jade-greens | `#0f3d3a` |
| 2 | `jade_02` | jade-deep | jade-greens | `#17594b` |
| 3 | `jade_03` | jade-forest | jade-greens | `#22795f` |
| 4 | `jade_04` | jade-jade | jade-greens | `#2fa27a` |
| 5 | `jade_05` | jade-bright | jade-greens | `#5cc796` |
| 6 | `jade_06` | jade-mist | jade-greens | `#9ae3b8` |
| 7 | `jade_07` | jade-pale | jade-greens | `#d2f5de` |
| 8 | `blood_01` | blood-abyss | blood-sea-crimsons | `#2a0a16` |
| 9 | `blood_02` | blood-dried | blood-sea-crimsons | `#4f0f22` |
| 10 | `blood_03` | blood-deep | blood-sea-crimsons | `#7a1426` |
| 11 | `blood_04` | blood-crimson | blood-sea-crimsons | `#a51d35` |
| 12 | `blood_05` | blood-bright | blood-sea-crimsons | `#d03a4a` |
| 13 | `blood_06` | blood-foam | blood-sea-crimsons | `#ee7a80` |
| 14 | `blood_07` | blood-pale | blood-sea-crimsons | `#f9c4c0` |
| 15 | `bronze_01` | bronze-dark | ancient-god-bronze-gold | `#3a2410` |
| 16 | `bronze_02` | bronze-aged | ancient-god-bronze-gold | `#63400f` |
| 17 | `bronze_03` | bronze-bronze | ancient-god-bronze-gold | `#8f5f14` |
| 18 | `bronze_04` | bronze-brass | ancient-god-bronze-gold | `#bf8a1e` |
| 19 | `bronze_05` | bronze-gold | ancient-god-bronze-gold | `#e0b030` |
| 20 | `bronze_06` | bronze-bright | ancient-god-bronze-gold | `#f5d765` |
| 21 | `bronze_07` | bronze-glow | ancient-god-bronze-gold | `#fff0b0` |
| 22 | `soul_01` | soul-obsidian | soul-banner-obsidian-violet | `#1b1030` |
| 23 | `soul_02` | soul-night | soul-banner-obsidian-violet | `#2d1b4e` |
| 24 | `soul_03` | soul-deep | soul-banner-obsidian-violet | `#46297a` |
| 25 | `soul_04` | soul-violet | soul-banner-obsidian-violet | `#6a3fa8` |
| 26 | `soul_05` | soul-bright | soul-banner-obsidian-violet | `#8f62cf` |
| 27 | `soul_06` | soul-wisp | soul-banner-obsidian-violet | `#b99aeb` |
| 28 | `soul_07` | soul-pale | soul-banner-obsidian-violet | `#e3d6fb` |
| 29 | `thunder_01` | thunder-cyan-deep | heavenly-thunder-cyan-red | `#0f5f8c` |
| 30 | `thunder_02` | thunder-cyan | heavenly-thunder-cyan-red | `#28a8dc` |
| 31 | `thunder_03` | thunder-cyan-bright | heavenly-thunder-cyan-red | `#8ae8ff` |
| 32 | `thunder_04` | thunder-flash | heavenly-thunder-cyan-red | `#e8fdff` |
| 33 | `thunder_05` | thunder-red | heavenly-thunder-cyan-red | `#ff3b30` |
| 34 | `thunder_06` | thunder-red-glow | heavenly-thunder-cyan-red | `#ff9a7a` |
| 35 | `ink_01` | ink-outline | ink-wash-stone-grays | `#14101a` |
| 36 | `ink_02` | ink-dark | ink-wash-stone-grays | `#2c2733` |
| 37 | `ink_03` | ink-slate | ink-wash-stone-grays | `#49434f` |
| 38 | `ink_04` | ink-stone | ink-wash-stone-grays | `#6e6877` |
| 39 | `ink_05` | ink-mist | ink-wash-stone-grays | `#9d98a4` |
| 40 | `ink_06` | ink-pale | ink-wash-stone-grays | `#d4d0d8` |

Group sizes: jade 7, Blood-Sea 7, bronze/gold 7, Soul-Banner 7, thunder 6 (4 cyan + 2 red), ink-wash 6. The earlier v1 palette (paper/earth/skin colors) is superseded; skin and hair tones must come from bronze/gold, Blood-Sea pale and ink-wash ramps. Changing a color means editing `palette.json` and this table together and keeping exactly 40.

## Enforcement
`python -I tools/scripts/validate_palette.py [--class tile|character|weapon|boss|icon] <png|dir>` checks palette membership, binary alpha, the `#14101a` outline on every silhouette-edge pixel, and (with `--class`) canvas size. Perspective is reviewed by eye. Use `--outline-optional` for seamless tiles and flat UI only.
Smoke test: `python -I tools/scripts/make_sample_png.py <tmp>`, then validate the three samples (good passes; bad_color and bad_outline fail).
