# Asset Routing Spec

## Current Codex workflow

Codex creates new game assets using built-in ImageGen or deterministic code authored by Codex. Antigravity may assemble animation from those sources or perform QA. Keep the original prompt or generator, source art and producer attribution with the asset. The repository skills cover [asset routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md) and [art validation](../.agents/skills/tien-nghich-art-qa/SKILL.md).

## Historical PixelLab workflow

The following specification records the earlier production pipeline. Existing raw art, manifests and provenance retain their original producer labels.

Enforced by skill `.claude/skills/orchestrator-asset-routing/`.

## Hard rule
- **PixelLab MCP: ONLY** characters, enemies, bosses and their frame animations -> `assets/raw/characters/`.
- **Codex & Antigravity: ALL** tilesets, walls, props, weapons (Dharma Treasures), projectiles, VFX, UI icons, generated and deployed **programmatically** with `tools/generators/palette.json` + scripts in `tools/generators/` -> `assets/raw/environment_items/`.

## Table
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

## Forbidden actions
1. PixelLab for anything but characters/enemies/bosses/animations.
2. Any non-PixelLab source for characters (comfyui-pixel, asset-scout, agent-sprite-forge generate2dmedia/video2dsprite, hand drawing).
3. Image-model or downloaded art for environment items; third-party packs may serve as reference only.
4. Mixing outputs across the two raw directories.
5. Hardcoding colors outside `palette.json`; hand-editing generated PNGs.
6. Mutating anything under `assets/raw/` after generation (process into `assets/processed/`).
7. Calling PixelLab's non-character tools (tilesets, maps, objects, UI, VFX, music/sfx - see docs/MCP_CAPABILITIES.md) even though they exist. If pixellab is unavailable, the character task is blocked; report it.

## Gates
Palette/outline validation (`tools/scripts/validate_palette.py`) on every processed sprite; perspective review by eye.

## Open items
- agent-sprite-forge's `generate2dmedia`/`video2dsprite` use image/video APIs; excluded unless the owner amends this spec.
- Generators in `tools/generators/` are not written yet.
