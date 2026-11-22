---
name: xianxia-art-bible-enforcer
description: Enforce the Tien Nghich (Renegade Immortal) 2D art bible on every sprite - 3/4 top-down Soul Knight perspective (front-facing characters, 2.5D walls), 1px #14101a outline, unified 40-color Xianxia palette, and canvas size classes. Use when generating, reviewing, processing or accepting any PNG asset, or when writing a generator script.
---

# Xianxia art bible enforcer

Authoritative spec: `docs/ART_BIBLE.md`. Machine palette: `tools/generators/palette.json` (43 colors, includes outline `#14101a`).

## Non-negotiables
1. **Perspective:** 3/4 top-down dungeon view (Soul Knight): front-facing characters; floors are flat top faces; 2.5D vertical walls (front face + top cap). No side-view, no isometric 2:1 diamond.
2. **Outline:** exactly 1px solid `#14101a` around the outer silhouette of every sprite, prop, weapon, projectile. No anti-aliasing, no soft alpha (alpha is 0 or 255).
3. **Palette:** only the 43 colors in `palette.json` (groups: jade greens, Blood-Sea crimsons, Ancient God bronze/gold, Soul-Banner obsidian/violet, heavenly-thunder cyan/red, ink-wash stone grays, ember orange). Refer to colors by stable id (e.g. `jade_03`). Light from top-left.
4. **Canvas size classes:** tile 16x16; character (player, humanoid mobs) 32x32; weapon (Dharma Treasure) 24x24 or 32x32; boss square 64x64-96x96; icon (skill/restriction) 16x16 or 24x24.
5. **Pixel grid:** 1 art pixel = 1 px, integer scaling only (nearest-neighbor); no rotation resampling of finished art.

## Procedure
- Generators must read `palette.json`; never hardcode other hex values.
- Gate every file: `python -I tools/scripts/validate_palette.py <png|dir>`; add `--class tile|character|weapon|boss|icon` to check canvas size; `--outline-optional` only for seamless tiles and flat UI fills. Non-zero exit = reject; fix the source/generator, not the PNG by hand.
- Character output that arrives off-palette (image-model sheets after pixelisation, or older PixelLab frames): remap to the nearest palette color (in `assets/processed/`, never mutating `raw/`), add the outline, then validate.
- Review perspective by eye (the validator cannot check it); reject anything violating rule 1.
