---
name: spritefx
description: Wrapper for the cloned spritefx skill. Write a JSON effect spec and render palette-locked pixel VFX sheets (slashes, hit sparks, qi auras, lightning, fire, explosions, portals) with audits. Use for the VFX / projectile-impact / spell-effect stage; must be run with the Xianxia 43-colour palette.
---

# spritefx (wrapper)

The real skill: `tools/skills/spritefx/SKILL.md` (clone pinned in `docs/SKILLS_INSTALLED.md`). It has a root SKILL.md and expects its own `.venv` (Python 3.11+, numpy, Pillow, jsonschema).

1. Read `tools/skills/spritefx/SKILL.md`, `README.md`, `palettes/`, `references/`.
2. Do not run from inside the clone. Create the venv outside the clone (e.g. `tools/.venvs/spritefx`, git-ignored) after reviewing `pyproject.toml`; run its module with `python -I -m fx ...` from there with the clone on `PYTHONPATH` explicitly, and write outputs to `assets/raw/environment_items/vfx/`.
3. Convert `tools/generators/palette.json` into a spritefx palette/ramps (ramps per group: jade, blood, bronze, soul, thunder, ink, orange; ids like jade_03) so every pixel is one of the 43 colours. Never relax audit thresholds without user approval (the skill's own rule).
4. VFX are Codex/Antigravity-routed work (scripted) - allowed. Never use for characters.

Pipeline stage: VFX (assets/raw/environment_items -> processed).
