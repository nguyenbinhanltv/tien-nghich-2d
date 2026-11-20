---
name: orchestrator-asset-routing
description: Hard routing rule for all art generation in the Tien Nghich 2D project. PixelLab MCP is ONLY for characters, enemies, bosses and their frame animations (-> assets/raw/characters/). Everything else (tilesets, walls, props, Dharma Treasure weapons, projectiles, VFX, UI icons) is generated programmatically by Codex/Antigravity with tools/generators and the master palette (-> assets/raw/environment_items/). Use before dispatching ANY asset-generation task or choosing any asset-related tool.
---

# Orchestrator asset routing

## THE HARD RULE
**PixelLab MCP MUST ONLY be invoked for characters, enemies, bosses, and their frame animations. Output: `assets/raw/characters/`.**
**Codex & Antigravity MUST generate and deploy all tilesets, walls, props, weapons (Dharma Treasures), projectiles, VFX and UI icons programmatically, using the master palette (`tools/generators/palette.json`) and generator scripts in `tools/generators/`. Output: `assets/raw/environment_items/`.**

## Routing table
| Asset | Route | Output dir |
|---|---|---|
| Player skins/cultivators, NPCs, mobs, elites, bosses | PixelLab MCP | `assets/raw/characters/` |
| Character frame animations (idle/walk/attack/hurt/death) | PixelLab MCP | `assets/raw/characters/` |
| Tilesets, floors, walls, doors | Codex/Antigravity scripted generator | `assets/raw/environment_items/tiles/` |
| Props (urns, altars, crates, formations) | scripted generator | `.../props/` |
| Weapons / Dharma Treasures | scripted generator | `.../weapons/` |
| Projectiles | scripted generator | `.../projectiles/` |
| VFX (slashes, qi, lightning, fire) | scripted generator (spritefx allowed, palette-locked) | `.../vfx/` |
| UI icons, HUD | scripted generator | `.../ui/` |
| Normalize / VFX-polish / atlas | `tools/scripts/` | `assets/processed/`, `assets/atlases/{web,mobile}/` |

## Forbidden
- Calling PixelLab for any tile, wall, prop, weapon, projectile, VFX or UI.
- Writing non-PixelLab files into `assets/raw/characters/`, or PixelLab files into `environment_items/`.
- Using comfyui-pixel, asset-scout downloads, image-gen APIs (agent-sprite-forge `generate2dmedia`), or hand-painted/edited PNGs as a source of characters or of final environment art.
- Calling PixelLab tools other than character/animation ones (see docs/MCP_CAPABILITIES.md). If the `pixellab` MCP is unavailable, STOP and report; do not substitute another generator for characters.
- Generators using colors outside `palette.json`; hand-editing generated PNGs (change the generator/spec instead).
- Committing/publishing third-party downloads without license record.

## Gates
Every asset: `python -I tools/scripts/validate_palette.py <file>` must pass (see `xianxia-art-bible-enforcer`). Full spec: `docs/ASSET_ROUTING.md`. Capabilities of the MCP: `docs/MCP_CAPABILITIES.md`.
