# tools/generators
Programmatic pixel-art generators (Codex & Antigravity) for tilesets, walls, props, Dharma Treasures (weapons),
projectiles, VFX, UI icons. Every generator MUST load `palette.json` (43 colors (v2, stable ids)) and write to
`assets/raw/environment_items/`. Validate output with `python -I tools/scripts/validate_palette.py`.
