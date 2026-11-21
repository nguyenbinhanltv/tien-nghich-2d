# Asset Routing Spec

## Current rule (from 2026-11-22)

Characters, mobs and bosses come from the studio forge routes. Environment and items stay code-drawn. No paid generation service is used, and the `pixellab` MCP is not called. The user retired PixelLab on 2026-11-22; see [the studio plan](STUDIO_PLAN.md) (decisions section). Enforced by the skills [`orchestrator-asset-routing`](../.claude/skills/orchestrator-asset-routing/SKILL.md) (Claude) and [`tien-nghich-asset-routing`](../.agents/skills/tien-nghich-asset-routing/SKILL.md) (Codex and Antigravity). Art validation: [`tien-nghich-art-qa`](../.agents/skills/tien-nghich-art-qa/SKILL.md).

Codex or Antigravity authors sources, and either one alone is enough: Codex with its built-in ImageGen or deterministic code, Antigravity with Google's image model. With both available, one may author and the other check, which is better but never required. The checker of an asset must be a different session from the one that authored it. Keep the original prompt or generator, source art and producer attribution with the asset. Only a human approves art or signs audio listening.

### Forge routes for characters, mobs and bosses
| Route | Use for | Agent provides | Studio or scripts do |
|---|---|---|---|
| Image sheet, then pixelisation | Design, turnaround and key poses | High-resolution sheet in the layout frame the studio supplies | Slice, remove background, scale to the foot anchor, downscale to native size, snap to 40 colours, build outline |
| Part-based rig and motion templates | Idle, walk, cast, hurt, telegraph, strike; bosses and animated props | Separated parts, joints, chosen motion template, key tuning | Bake native frames, clean pixels after rotation, hold the pivot |
| Direct pixel edits | In-between frames, asymmetric details, fixes after review | Palette-index grids or pixel commands | Apply, return a preview, keep a revision |

Default character animation is the part-based rig with motion templates, with direct pixel fixes where needed. The image sheet gives the silhouette and poses. (The [studio plan](STUDIO_PLAN.md) numbers these routes 2, 3 and 4; its route 1 is code-drawn art for environment and items.) The forge itself is built in studio phase P2; until it exists, plan the ID and record the brief, and report the character as pending rather than choosing another generator. Existing sheet processing in `tools/scripts/` stays available for assets already authored.

### Table
| Asset class | Producer | Raw output | Next stage |
|---|---|---|---|
| Player skins, mobs, elites, bosses (+ animations) | Studio forge routes | `assets/raw/characters/<kind>/<name>/` | palette remap + outline -> `assets/processed/` |
| Tiles, walls, doors, floors | Code-drawn generator | `assets/raw/environment_items/tiles/` | validate -> processed |
| Props | Code-drawn generator | `.../props/` | same |
| Dharma Treasures (weapons) | Code-drawn generator | `.../weapons/` | same |
| Projectiles | Code-drawn generator | `.../projectiles/` | same |
| VFX | Code-drawn spec (spritefx permitted) | `.../vfx/` | same |
| UI icons | Code-drawn generator | `.../ui/` | same |
| Atlases | `tools/scripts/` packers | `assets/atlases/web/`, `assets/atlases/mobile/` | preview-app |

### Forbidden actions
1. Any paid generation service for any asset, and the `pixellab` MCP in particular.
2. Image-model or downloaded art for environment items; those stay code-drawn. Third-party packs may serve as reference only.
3. Third-party downloads, comfyui-pixel, asset-scout downloads, agent-sprite-forge `generate2dmedia` / `video2dsprite` as a source of final characters.
4. Mixing outputs across the two raw directories.
5. Hardcoding colors outside `palette.json`; hand-editing generated environment PNGs (change the generator instead).
6. Mutating anything under `assets/raw/` after generation (process into `assets/processed/`).
7. Any agent approving art or signing audio listening, including the one that authored it.

### Gates
Palette/outline validation (`tools/scripts/validate_palette.py`) on every processed sprite; perspective review by eye; the animation gate (foot slide, pivot drift, flicker, asymmetric marks on the correct side) arrives with the forge.

### Open items
- agent-sprite-forge's `generate2dmedia`/`video2dsprite` use image/video APIs; excluded.
- The studio forge (P2) does not exist yet. P0 includes a trial that rebuilds `lt_ink_marten` by the image-sheet and rig routes and scores it next to the PixelLab version.

## Historical: earlier Codex-centred wording (superseded by the rule above)

Codex creates new game assets using built-in ImageGen or deterministic code authored by Codex. Antigravity may assemble animation from those sources or perform QA. This note recorded the earlier Codex-centred wording, kept for history. Existing raw art, manifests and provenance retain their original producer labels.

## Historical: PixelLab workflow (retired 2026-11-22)

The following specification records the earlier production pipeline. It is **not current**. PixelLab-made assets keep their provenance. The original characters in `assets/manifest.json` keep their legacy `assigned_agent: pixellab` labels. `lt_kiln_keeper` and `lt_ink_marten` were also made with PixelLab, but in `assets/manifest_longtime.json` they have no per-asset label: they inherit `assigned_agent` from their profile (`npc`, `pet`), and those character profiles now read `studio_forge`, so `check_longtime.py` counts their 64 frames under `studio_forge`. Their PixelLab origin is recorded in `assets/raw/longtime/<id>/provenance.json` and `generation.json`.

Historically enforced by skill `.claude/skills/orchestrator-asset-routing/`.

### Hard rule (historical)
- **PixelLab MCP: ONLY** characters, enemies, bosses and their frame animations -> `assets/raw/characters/`.
- **Codex & Antigravity: ALL** tilesets, walls, props, weapons (Dharma Treasures), projectiles, VFX, UI icons, generated and deployed **programmatically** with `tools/generators/palette.json` + scripts in `tools/generators/` -> `assets/raw/environment_items/`.

### Table (historical)
| Asset class | Producer | Raw output | Next stage |
|---|---|---|---|
| Player skins, mobs, elites, bosses (+ animations) | PixelLab MCP | `assets/raw/characters/<kind>/<name>/` | palette remap + outline -> `assets/processed/` |
| Tiles, walls, doors, floors | scripted generator | `assets/raw/environment_items/tiles/` | validate -> processed |
| Props | scripted generator | `.../props/` | same |
| Dharma Treasures (weapons) | scripted generator | `.../weapons/` | same |
| Projectiles | scripted generator | `.../projectiles/` | same |
| VFX | scripted generator (spritefx permitted) | `.../vfx/` | same |
| UI icons | scripted generator | `.../ui/` | same |
| Atlases | `tools/scripts/` packers | `assets/atlases/web/`, `assets/atlases/mobile/` | preview-app |

### Forbidden actions (historical)
1. PixelLab for anything but characters/enemies/bosses/animations.
2. Any non-PixelLab source for characters (comfyui-pixel, asset-scout, agent-sprite-forge generate2dmedia/video2dsprite, hand drawing).
3. Image-model or downloaded art for environment items; third-party packs may serve as reference only.
4. Mixing outputs across the two raw directories.
5. Hardcoding colors outside `palette.json`; hand-editing generated PNGs.
6. Mutating anything under `assets/raw/` after generation (process into `assets/processed/`).
7. Calling PixelLab's non-character tools (tilesets, maps, objects, UI, VFX, music/sfx - see docs/MCP_CAPABILITIES.md) even though they exist. If pixellab is unavailable, the character task is blocked; report it.
