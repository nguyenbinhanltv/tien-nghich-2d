---
name: orchestrator-asset-routing
description: Hard routing rule for all art generation in the Tien Nghich 2D project (current from 2026-11-22). Characters, mobs and bosses come from the studio forge routes (image sheet from Codex or Antigravity then pixelisation; part-based rig + motion templates; direct pixel edits) into assets/raw/characters/. Environment and items (tilesets, walls, props, Dharma Treasure weapons, projectiles, VFX, UI icons) stay code-drawn with tools/generators and the master palette into assets/raw/environment_items/. No paid generation service is used and the pixellab MCP is not called. Use before dispatching ANY asset-generation task or choosing any asset-related tool.
---

# Orchestrator asset routing

## THE HARD RULE (current)
**Characters, mobs, bosses and their animations come from the studio forge routes. Output: `assets/raw/characters/<kind>/<id>/`.**
**Environment and items (tilesets, walls, props, weapons / Dharma Treasures, projectiles, VFX, UI icons) stay code-drawn: deterministic generators in `tools/generators/` using the master palette (`tools/generators/palette.json`). Output: `assets/raw/environment_items/`.**
**No paid generation service is used. The `pixellab` MCP is retired: do not call it, and do not design around it.**

PixelLab-made assets already in the repo keep their provenance. They are history, not a route.

## Forge routes for characters (see `docs/STUDIO_PLAN.md`)
| Route | Use for | Agent does | Studio / scripts do |
|---|---|---|---|
| Image sheet -> pixelisation | Character, mob, boss design; turnaround and key poses | Codex or Antigravity (either one suffices) draws a high-resolution sheet in the studio layout frame with its built-in image tool | Slice, remove background, normalise scale at the foot anchor, downscale to native size, snap to 43 colours, add outline |
| Part-based rig + motion templates | idle, walk, cast, hurt, telegraph, strike; bosses and animated props | Split parts, place joints, pick a motion template, tune keys | Bake native frames, clean pixels after rotation, hold the pivot |
| Direct pixel edits | in-between frames, asymmetric details, fixes after review | Write palette-index grids or pixel commands | Apply, return a preview, keep a revision |

The forge is built in studio phase P2. Until its tools exist, do not improvise a character route and do not substitute a generation service: plan the ID, write the brief, and report that the forge is pending.

## Routing table
| Asset | Route | Output dir |
|---|---|---|
| Player skins/cultivators, NPCs, mobs, elites, bosses | Forge routes above | `assets/raw/characters/` |
| Character frame animations (idle/walk/attack/hurt/death) | Part-based rig + motion templates, pixel fixes where needed | `assets/raw/characters/` |
| Tilesets, floors, walls, doors | Code-drawn generator | `assets/raw/environment_items/tiles/` |
| Props (urns, altars, crates, formations) | Code-drawn generator | `.../props/` |
| Weapons / Dharma Treasures | Code-drawn generator | `.../weapons/` |
| Projectiles | Code-drawn generator | `.../projectiles/` |
| VFX (slashes, qi, lightning, fire) | Code-drawn spec (spritefx allowed, palette-locked) | `.../vfx/` |
| UI icons, HUD | Code-drawn generator | `.../ui/` |
| Normalize / VFX-polish / atlas | `tools/scripts/` | `assets/processed/`, `assets/atlases/{web,mobile}/` |

## Forbidden
- Any paid image, video or sprite generation service, or the `pixellab` MCP, for any asset.
- Image-model output for environment or item art; those stay code-drawn.
- Writing environment files into `assets/raw/characters/`, or character files into `environment_items/`.
- comfyui-pixel, asset-scout downloads, `agent-sprite-forge` `generate2dmedia` / `video2dsprite`, or third-party art as a source of final characters or final environment art (reference only).
- Generators using colors outside `palette.json`; hand-editing generated environment PNGs (change the generator or spec instead; character pixel fixes go through the forge's direct-edit route so they are recorded).
- Mutating anything under `assets/raw/` after generation (process into `assets/processed/`).
- Committing/publishing third-party downloads without a license record.
- Self-approval: only a human approves art or signs audio listening. A checking session must differ from the authoring session (a different agent is better but not required).

## Gates
Every asset: `python -I tools/scripts/validate_palette.py <file>` must pass (see `xianxia-art-bible-enforcer`). Full spec: `docs/ASSET_ROUTING.md`. Tool inventory: `docs/MCP_CAPABILITIES.md`.
