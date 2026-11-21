# studio — Tiên Nghịch 2D HTML5 Previewer

Zero-build HTML5 Canvas previewer (`image-rendering: pixelated`, `ctx.imageSmoothingEnabled = false`, integer scaling) for **Tiên Nghịch 2D** (Soul Knight-style Xianxia roguelite).

> **Studio shell.** `/studio/` now opens the studio shell (rail with nine destinations, Overview, command palette, English/Vietnamese). The original two-tab previewer described below is unchanged and still answers `/studio/?tab=arena`, `/studio/?tab=inspector` and `/studio/previewer.html`. See [`ui/README.md`](ui/README.md) for the shell and the tab module contract.

## Quick Start

**The Drowned Court** is a separate playable Blood Sea boss encounter. Open [the duel](blood-sea/index.html) from the preview server, or use the Blood Sea boss encounter link in the top bar. Its [source, export and test guide](../assets/encounter/blood-sea/README.md) covers the Codex-generated sprites and the encounter pose inspector.

Serve the repository root so `/studio/`, `/assets/`, and `/tools/generators/palette.json` are all reachable:

```bash
# Node 20+ (zero dependencies)
node studio/serve.mjs --port 4173

# Or Python 3 stdlib fallback
python studio/serve.py --port 4173
```

Open: `http://127.0.0.1:4173/studio/` (shell) or `http://127.0.0.1:4173/studio/?tab=arena` (previewer)

Query parameters:
- `?tab=inspector` — open directly on the Asset Inspector tab.
- `?fixtures=1` — start with Dev Fixtures enabled (`assets/_fixtures/`).

## Features

### (a) Playable Arena (`Play Arena` tab)
- **4 Wang Lin Skins**: switch between all 4 manifest forms (`wl_outer_disciple`, `wl_qi_condensation`, `wl_blood_foundation`, `wl_extreme_jing`).
- **Controls**: `WASD` / Arrow keys to move, `Space` to dash (cooldown + afterimage), `Left-Click` (or hold) to fire the selected **Dharma Treasure** (1 of 12 weapons from `assets/manifest.json`) toward the cursor.
- **Procedural Soul Knight-style Rooms**: 3×3 connected dungeon floor with N/S/E/W Restriction Gate doors (walk through or click minimap to travel), 2.5D vertical walls (top cap + front face), biome terrain patches, and destructible alchemy jars.
- **47-Tile Blob Autotile**: computes gated 8-bit neighbor masks (`studio/src/blob47.js`) and maps them using the tileset worker's bitmask mapping JSON if present, falling back cleanly to the canonical 47-tile table.

### (b) Real-Time Biome Switching
- Press keys **`1`**, **`2`**, **`3`** or click the header biome buttons to swap live between:
  1. **Hằng Nhạc Phái** (`hengyue`)
  2. **Huyết Hải** (`blood_sea`)
  3. **Cổ Thần Chi Địa** (`ancient_god`)

### (c) Asset Inspector (`Asset Inspector` tab)
- Open **Longtime art** to filter delivered web-atlas entries by group or ID, inspect native and zoomed frames, and step or play a timed clip. **Audio pilot** auditions the published music loop and individual sprite cues in Ogg or AAC. Playback starts on click. Both collections are read-only and work with either preview server. Direct links: [Longtime art](library.html#art) and [Audio pilot](library.html#audio).
- Browse every asset from `assets/manifest.json` (plus VFX contract entries): players (4), mobs (15), bosses (3), tilesets (3), weapons (12), projectiles (12), props (19), VFX (12 delivered), icons (16), UI (6).
- Frame-by-frame controls: **Play / Pause / Step Back / Step Forward / Frame Scrubber**, **FPS** (`1–24`), **Speed** (`0.25×`–`2×`), **Direction** (`south`, `east`, `north`, `west` with mirror/reuse indicators), **Integer Zoom** (`1×`–`8×`), and a **47-Tile Blob Sheet** browser for tilesets.
- **Hitbox Overlay Toggle**: reads `hitbox` / `hitboxes[anim]` from `manifest.json` when present, otherwise falls back to sprite bounds and explicitly labels the source (`Hitbox: manifest` vs `Hitbox: sprite bounds (fallback — none in manifest)`).

### (d) Local Frame Editor & Review (Catalog UI & VFX)
When served by a preview server exposing the local Inspector API v1 (`/api/editor/*`), editable catalog UI and VFX frames display an `EDIT` badge and unlock the **Frame Editor & Review** panel below the Inspector transport bar:
- **Edit Pixels**: draw with **Pencil** (`B`), **Eraser** (`E`, binary alpha `0`), **Eyedropper** (`I`), or **Set Pivot**, using only the 40-color project palette (`[`/`]` cycles colors). Focus the editor canvas to navigate with Arrow keys, paint with `Space`/`Enter`, and undo/redo with `Ctrl+Z`/`Ctrl+Y`.
- **PNG Import**: click **Import PNG…** to replace a frame with an 8-bit non-interlaced RGBA PNG matching exact frame dimensions, binary alpha, and the 40-color palette. Invalid PNGs are rejected with an inline error while leaving the current revision untouched.
- **Before / After & Metadata**: inspect side-by-side Saved vs Draft previews with optional pixel diff highlight, and edit allowed metadata (`pivot` for UI; `pivot` and `durationMs` for VFX).
- **Revisions, Restore & Conflicts**: click **Save Revision** to append a new `pending` revision (identical saves reuse `head`). Browse older revisions in **Revision History** and click **Restore** to append a new `pending` revision from an earlier version. If another tab saves first, a **409 conflict banner** lets you either **Reload Latest** or **Keep Draft & Rebase**.
- **Revision-Bound Review & Export**: post comment-only notes or set **Approve**, **Request Changes**, or **Pending** on the currently viewed revision (editing an approved frame creates a new `pending` revision while preserving prior history and comments). Click **Export JSON** to download the reproducible single-frame atlas export.
- Canonical frames open as **Approved** by default. To preview and publish an exact approved head into both project atlases, follow the [local publication instructions](server/README.md#publish-an-approved-revision-into-the-project-atlases).

## Asset Loading & Graceful Degradation

1. **Primary (Web Atlases)**: loads Phaser 3 / PixiJS `'hash'` format JSON atlases from `assets/atlases/web/*.json` using the shared `AssetKeys` contract ([`studio/src/AssetKeys.ts`](src/AssetKeys.ts)):
   - Characters (players/mobs/bosses): `characters/<asset_id>/<anim>_<dir>_<frameIndex>` (e.g. `characters/wl_outer_disciple/run_south_0`; `dir` is the full name `south|east|north|west`)
   - Tilesets: `tilesets/<ts_id>/<sheet>_f<frame>_<tileIndex>` (e.g. `tilesets/ts_hengyue/floor_blob47_f0_46`)
   - Weapons / projectiles / props: `<group>/<id>/<anim>_none_<n>` (e.g. `weapons/wp_soul_lamp/idle_none_0`)
   - VFX: `vfx/<id>_<n>` (assets are synthesized from the atlas keys; the manifest has no VFX entries)
   - UI / icons: `ui/<id>/<anim>_none_<n>`; icons `ui/<icon_id>/static_none_0` (+ `v16_none_0`)
   When a real atlas is loaded the individual-PNG fallback is skipped (add `?png=1` to force it).
2. **Dev Fallback (Individual PNGs)**: when atlases are absent, `/__preview_index.json` indexes individual PNGs under `assets/processed/` and `assets/raw/environment_items/` and maps them to canonical frame keys.
3. **Missing Groups**: missing PixelLab character/mob/boss sprites display an explicit wireframe placeholder and **`missing: pixellab not generated`** banner — never fake pixel art.
4. **Dev Fixtures (`assets/_fixtures/`)**: optional clearly-labelled geometric test fixtures generated by `python tools/scripts/generate_fixtures.py` to test atlas loading and blob-47 autotiling. Disabled by default; toggle **Dev Fixtures** in the header to inspect.

## Smoke Test

```bash
# HTTP + manifest + atlas + blob-47 contract check
node studio/smoke-test.mjs

# Include live browser verification against a running server
node studio/smoke-test.mjs --url http://127.0.0.1:4173/studio/ --ao-browser
```
