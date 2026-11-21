---
name: tien-nghich-asset-routing
description: Choose the source, raw asset path and provenance for new Tien Nghich game art, including character turnarounds, arena tiles and VFX.
---

# Route new game art

Codex creates every new asset with built-in ImageGen or deterministic code authored by Codex. Antigravity may assemble animation from Codex source frames or perform QA. Use the existing manifest ID, dimensions, directions, animation names and output path when present.

- **Characters, mobs and bosses.** Prefer one turnaround prompt per subject covering the requested directions. Specify facing order, costume landmarks, scale, lighting and a common foot anchor. Keep the full original and prompt. Store sources under `assets/raw/characters/<kind>/<id>/`. When feeding the character processor, supply individual frames under `<animation>/<direction>/frame_000.png` and its numbered siblings.
- **Environment and items.** Use the matching directory under `assets/raw/environment_items/` for tiles, props, weapons, projectiles, VFX and UI. Prefer the existing generators for repeatable tiles and item variants. Read palette IDs and colors from `tools/generators/palette.json`.
- **Provenance.** Associate the exact prompt or generator path, spec/seed where applicable, and original source with the asset ID. Trace derived frames back to it and record any Antigravity assembly. Keep earlier raw files and their producer attribution. Write normalization and frame derivatives under `assets/processed/`.

Use `tien-nghich-art-qa` on processed frames. The producer labels in the legacy manifest and Claude wrappers describe the original pipeline. See [the optional tool inventory](../../../docs/SKILLS_INSTALLED.md) before relying on a third-party helper. Neither project skill needs an external clone, service, or API key.
