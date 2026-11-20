# Skills installed

Clones live in `tools/skills/<repo>/` (shallow, `--depth 1`) and are **git-ignored, not vendored** (third-party, untrusted, large - agent-sprite-forge alone is 875 files). They are reproducible from the pinned SHAs below: `bash tools/scripts/fetch_skills.sh`. If you need offline/vendored copies later, switch to `git submodule add` at these SHAs.
Nothing from any clone has been executed. Claude discovers each via a thin wrapper in `.claude/skills/<name>/SKILL.md` that points at the clone and states usage limits. All four cloned successfully.

| Repo | Commit SHA | License | Wrapper | Purpose | Pipeline stage |
|---|---|---|---|---|---|
| [GenielabsOpenSource/spine-animation-ai](https://github.com/GenielabsOpenSource/spine-animation-ai) | `702b71689cac826efee942ee4564fef9560d6ef8` | **PolyForm Noncommercial 1.0.0** | `.claude/skills/spine-animation` | Rig body-part PNGs into Spine skeletons, animate, export Spine JSON + preview. Has root `SKILL.md` (auto-generated from `SKILL.template.md`; scripts embedded). | Character skeletal animation (optional, experimental) |
| [digitalhobbit/assetcat](https://github.com/digitalhobbit/assetcat) | `8784327edb240e3b940bd28901c6f994beaf78cc` | MIT | `.claude/skills/assetcat` | Index/search a local asset library, license + AI-provenance checks, pull with credits. Skill at `skills/assetcat/SKILL.md`; requires the `assetcat` CLI (not installed). | Discovery / licensing / sfx, music, fonts |
| [HoangLong256/spritefx](https://github.com/HoangLong256/spritefx) | `e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a` | MIT | `.claude/skills/spritefx` | JSON-spec pixel VFX sheets, palette-locked, 22 audits. Root `SKILL.md`; needs Python 3.11+, numpy, Pillow, jsonschema (not installed). | VFX |
| [0x0funky/agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) | `25203d03900b46b444bdd72a75768c33d1895ad6` | MIT | `.claude/skills/agent-sprite-forge` | Suite of 5 skills (codeart2d, generate2dmap, generate2dmedia, generate2dsprite, video2dsprite). | Code-drawn env art, map data/export, QA, packaging; image/video routes excluded |

## Caveats
- **spine-animation-ai is non-commercial licensed**; also Spine runtimes require an Esoteric Software licence. Do not adopt into the shipping pipeline without a decision.
- **agent-sprite-forge** generation routes (`generate2dmedia`, `video2dsprite`, image-first `generate2dsprite`/`generate2dmap`) conflict with `docs/ASSET_ROUTING.md`; only code-drawn/data/QA parts are sanctioned.
- None of the 4 repos is wired to the Xianxia palette yet; spritefx/codeart2d need palette conversion from `tools/generators/palette.json`.
- Only the SKILL.md headers/READMEs were read (not a full code audit). Review scripts before first run; use `python -I`, run outside the clone dir.
