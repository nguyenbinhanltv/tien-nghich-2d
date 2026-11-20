---
name: spine-animation
description: Wrapper for the cloned spine-animation-ai skill. Rig separated body-part PNGs into a Spine 2D skeleton, key walk/idle/attack animations, export Spine JSON + atlas, and an HTML5 preview. Use only for boss/character skeletal-animation experiments AFTER characters exist in assets/raw/characters/. Licensed PolyForm Noncommercial - check before shipping.
---

# spine-animation (wrapper)

The real skill lives in the untrusted clone: `tools/skills/spine-animation-ai/SKILL.md` (pinned SHA in `docs/SKILLS_INSTALLED.md`).

1. Read `tools/skills/spine-animation-ai/SKILL.md` and `README.md` first; follow them.
2. Its SKILL.md says to embed/copy helper scripts into a working dir. Copy them OUT to a temp working dir, review them, and run with `python -I`. Never run from inside the clone dir.
3. Inputs come from `assets/raw/characters/` (PixelLab output only); outputs go to `assets/processed/`.
4. Respect `.claude/skills/orchestrator-asset-routing` and `xianxia-art-bible-enforcer`.
5. **License warning:** PolyForm Noncommercial 1.0.0 - not usable in a commercial game without a separate licence. Spine runtimes also need an Esoteric Software licence. Flag to the user before adopting into the shipping pipeline.

Pipeline stage: character animation (rigging) - optional/experimental.
