---
name: tien-nghich-asset-routing
description: Choose the source, raw asset path and provenance for new Tien Nghich game art. Characters, mobs and bosses use the studio forge routes; environment and items stay code-drawn; no paid generation service.
---

# Route new game art

Current rule (2026-11-22): characters, mobs and bosses come from the studio forge routes; environment and items stay code-drawn; no paid generation service is used and the `pixellab` MCP is not called. Codex or Antigravity authors sources; either one alone suffices, and neither is required in addition to the other. Use the existing manifest ID, dimensions, directions, animation names and output path when present.

- **Characters, mobs and bosses.** Three forge routes, detailed in the [studio plan](../../../docs/STUDIO_PLAN.md): a high-resolution image sheet from Codex or Antigravity (whichever is connected), then pixelisation to native size and the 40-colour palette; a part-based rig with motion templates for animation; direct pixel edits for in-between frames and fixes. Prefer one turnaround prompt per subject covering the requested directions, with facing order, costume landmarks, scale, lighting and a common foot anchor. Keep the full original and prompt. Store sources under `assets/raw/characters/<kind>/<id>/`. When feeding the character processor, supply individual frames under `<animation>/<direction>/frame_000.png` and its numbered siblings. The forge tools arrive in studio phase P2; until then plan the ID and report the character as pending rather than improvising another route.
- **Environment and items.** Code-drawn only. Use the matching directory under `assets/raw/environment_items/` for tiles, props, weapons, projectiles, VFX and UI. Prefer the existing generators for repeatable tiles and item variants. Read palette IDs and colors from `tools/generators/palette.json`.
- **Provenance.** Associate the exact prompt or generator path, spec/seed where applicable, and original source with the asset ID. Trace derived frames back to it and record which agent and session authored and which session checked. The checking session must differ from the authoring session; a different agent is better but not required. Keep earlier raw files and their producer attribution, including PixelLab-made assets, which stay as recorded. Write normalization and frame derivatives under `assets/processed/`.
- **Approval.** Only a human approves art or signs audio listening.

Use `tien-nghich-art-qa` on processed frames. The producer labels in the legacy manifest and the historical Claude wrappers describe the original pipeline. See [the optional tool inventory](../../../docs/SKILLS_INSTALLED.md) before relying on a third-party helper. Neither project skill needs an external clone, service, or API key.
