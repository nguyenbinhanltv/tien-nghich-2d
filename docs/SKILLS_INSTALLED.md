# Skills installed

## Codex project skills

Use [asset routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md) for new art and [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) for processed frames. Both work with the tracked repository. Codex scans `.agents/skills` from the working directory up to the repository root. [OpenAI skill discovery](https://learn.chatgpt.com/docs/build-skills)

### Optional tool compatibility

At the migration baseline (`645dcd0`), all four `tools/skills/<repo>` directories were absent in both the main checkout and the migration worktree. The Git ignore rule excludes them from fresh worktrees. The historical fetch script skips existing directories without validating their revision. For any existing clone, compare `git -C <clone> rev-parse HEAD` with the full SHA below and inspect local changes before using its scripts. Discovery of either project skill requires no fetch or installation.

| Pinned tool | Local availability and dependencies | Permitted use and limits |
|---|---|---|
| SpriteFX (MIT) | Verified in disposable scratch. Requires the source checkout, Python 3.11+, NumPy 2.4.6, Pillow 12.3.0 and jsonschema 4.26.0 at this pin. | Deterministic renderer for Codex-authored VFX specs. Derive colors and ramps from the project palette and retain the spec, seed and audit results. Doctor and two real builds passed. [Package manifest](https://github.com/HoangLong256/spritefx/blob/e5867cc05f6e1dc6207b8e1c3c65cef75e6ba51a/pyproject.toml) |
| Agent Sprite Forge (MIT) | No clone. The map helpers import NumPy, Pillow and vendored Forge modules. The upstream requirements also list SciPy. Preserve the pinned directory layout. | Only map data, collision/reachability, export, and QA of existing Codex art. For example, inspect `skills/generate2dmap/scripts/map_bundle.py` and `map_nav.py`. Skip `codeart2d` as a generation route, map/sprite image-generation stages, `generate2dmedia` and `video2dsprite`. No Forge helper executed. [Map workflow](https://github.com/0x0funky/agent-sprite-forge/blob/25203d03900b46b444bdd72a75768c33d1895ad6/skills/generate2dmap/SKILL.md) |
| AssetCat (MIT) | No CLI on PATH or project library identified. The Python 3.12+ CLI and an existing indexed library are both prerequisites. | If both exist, use plain-text `assetcat search --packs <query>` then `assetcat show <pack>` for reference, license and AI provenance. Each pack has its own terms. Skip pulls, indexing, semantic model downloads and the web UI. No catalog queried. [CLI workflow](https://github.com/digitalhobbit/assetcat/blob/8784327edb240e3b940bd28901c6f994beaf78cc/skills/assetcat/SKILL.md) |
| Spine Animation AI (PolyForm Noncommercial 1.0.0) | No clone or Spine CLI on PATH. Manual part positioning uses Python, OpenCV, NumPy and Pillow. | Experimental assembly from separated Codex parts only where the tool license and applicable Spine runtime rights cover the intended use. Commercial-use rights were not established. Exclude Gemini splitting and reskinning. No rig or runtime tested. [Pinned workflow and license](https://github.com/GenielabsOpenSource/spine-animation-ai/tree/702b71689cac826efee942ee4564fef9560d6ef8) |

### SpriteFX isolated launch

With a reviewed pinned source checkout and an existing venv containing its exact dependencies, run from outside the clone. Substitute the absolute venv Python, clone and scratch-output paths. The legacy `PYTHONPATH` recipe fails because `-I` ignores that variable. Supply the clone explicitly and pass CLI arguments as separate values.

```text
<venv-python> -I -B -c "import sys, runpy; sys.path.insert(0, sys.argv.pop(1)); runpy.run_module('fx', run_name='__main__', alter_sys=True)" "<clone>" doctor --out "<scratch>"
```

After a successful doctor check, replace `doctor --out "<scratch>"` with `build "<absolute-spec.json>" --out "<scratch>"`. In the palette file, supply each ramp as a list of project hex colors. Match the effect name to the spec filename stem. For an outlined layer, set its outline to `dark` and the top-level effect outline to the hex value of `ink_01`. Omitting the effect-level color passed SpriteFX audits but failed the project outline gate. Without the clone or venv, use project-native Codex-authored deterministic code.

A scratch jade pulse authored by Codex (seed 20) produced six 16×16 frames in a 96×16 sheet. Two builds reported zero faults and identical sheet SHA-256 `549f40ebe5aeeada6734a2c406c164ac6c1b9af50fb1144625c227f6d143840c`. The project palette validator passed with a thickness warning. An independent pixel check found five project colors and alpha values of 0 and 255.

## Historical Claude installation record

The following inventory and caveats record the original installation. The pins identify the versions audited above.

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
