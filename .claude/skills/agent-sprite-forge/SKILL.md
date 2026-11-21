---
name: agent-sprite-forge
description: Wrapper for the cloned agent-sprite-forge suite (codeart2d, generate2dmap, generate2dmedia, generate2dsprite, video2dsprite). Use ONLY its code-drawn/data routes (codeart2d, map data/collision/Tiled export, QA, packaging) for the Xianxia roguelite; its image/video-generation routes are NOT approved by the asset-routing rule.
---

# agent-sprite-forge (wrapper)

Real skills live in the clone `tools/skills/agent-sprite-forge/skills/<name>/SKILL.md` (pinned in `docs/SKILLS_INSTALLED.md`):

| Sub-skill | Use here? |
|---|---|
| `codeart2d` | YES - code-drawn pixel sprites, autotiles, props, UI, FX; fits Codex/Antigravity scripted routing |
| `generate2dmap` | PARTIAL - map data, collision, reachability, Tiled/LDtk/Godot export, HTML preview. Its art step defaults to image generation: replace with `codeart2d`/`tools/generators` |
| `generate2dsprite` | PARTIAL - QA/slice/palette/pack stages only; do not use for characters (studio forge routes) |
| `generate2dmedia` | NO - calls paid image/video APIs or Codex/Grok CLIs; not approved routing; needs explicit owner decision (spend + routing) |
| `video2dsprite` | NO - image-to-video route for characters; characters come from the studio forge routes, not video |

Procedure: read the sub-skill SKILL.md first; copy needed scripts to a temp dir, review (it has `requirements*.txt`, `tools/`, `src/`), run with `python -I`; never run from inside the clone; do not configure API keys. Outputs must pass `tools/scripts/validate_palette.py` and `orchestrator-asset-routing`.

Pipeline stage: code-drawn environment art, map data, QA, packaging/atlas support.
