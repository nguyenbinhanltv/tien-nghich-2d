---
name: assetcat
description: Wrapper for the cloned assetcat skill. Search the user's local indexed asset library (sprites, tilesets, sfx, music, fonts), check licenses / AI provenance, and pull files into a project with credits. Use for reference-gathering, license checks and SFX/music/fonts - NOT as a source of characters (PixelLab only) or of final environment art (scripted generators only).
---

# assetcat (wrapper)

The real skill: `tools/skills/assetcat/skills/assetcat/SKILL.md` (clone pinned in `docs/SKILLS_INSTALLED.md`).

1. Read that SKILL.md and `tools/skills/assetcat/README.md` first.
2. It needs the `assetcat` CLI and a user-indexed library. Neither is installed. Do not run an installer blindly: read `pyproject.toml`, then propose `uv tool install` from the reviewed local path and ask the user.
3. `assetcat pull` must target a staging dir (e.g. temp), never `assets/raw/characters/`. Pulled third-party art may be used for sfx/music/fonts/reference only; any sprite that enters the game must pass `tools/scripts/validate_palette.py` after palette-remap and be routed per `orchestrator-asset-routing`.

Pipeline stage: asset discovery / licensing / audio + font sourcing.
