# Orchestrator handoff

State as of `main` at `99bec8fee7f165c71f6b8cd25fe93ecd90c826f5` (PR #63). Every number below was re-counted from the repository at that commit; the command that reproduces it is named next to it. A fresh clone recovers the committed assets, manifests and tools from GitHub. Keep separate records for private Inspector revisions and local session state.

Work arrives as pull requests against `main`: workers open them, the orchestrator reviews and merges. Check `gh pr list --state open` first.

## Resume point

### Merged since the last sync

| PR | What |
|---|---|
| [#55](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/55) | Longtime VFX design contract ([VFX design](LONGTIME_VFX.md)). |
| [#56](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/56) | PixelLab `lt_kiln_keeper` and `lt_ink_marten` (64 native frames), Abode repacked. |
| [#57](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/57) | Project pack (`studio.project.json`, schema) and the studio core, extracted from the old preview app with no behaviour change. |
| [#58](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/58) | [Studio plan](STUDIO_PLAN.md) v4, three Anthropic skills, asset routing without PixelLab ([routing](ASSET_ROUTING.md)). |
| [#59](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/59), [#64](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/64) | Studio MCP server over stdio with one read-only tool, `studio_project_info`; project-scoped configs for Claude Code, Codex and Antigravity; pack-based project module; byte-accurate line limit. A real Codex session passed the connection trial on 2026-11-22 (reported by the orchestrator; the repository README still says the live trial was pending when it was written). [MCP guide](../studio/mcp/README.md) |
| [#60](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/60) | Forge bake-off: `lt_ink_marten` rebuilt from an ImageGen sheet plus a rig, scored beside the PixelLab version. [Bake-off](FORGE_BAKEOFF.md) |
| [#61](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/61), [#66](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/66) | Audio source batches 3 and 4. Every one of the 46 core audio IDs now has a master (see the audio section). |
| [#62](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/62) | The app moved from `preview-app/` to `studio/`, with shims and the macOS symlinked-temp-dir fix. |
| [#63](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/63) | macOS FFmpeg 6.1.1 toolchain finding ([audio toolchain on macOS](AUDIO_TOOLCHAIN_MAC.md)). |
| [#65](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/65) | The six Longtime VFX (188 frames), four chunks repacked. |

### In progress, not merged

- **Studio shell and Overview (P1)** and **forge sheet import and rig/bake in Node (P2)**: the [studio plan](STUDIO_PLAN.md) phases. Neither has landed; the only forge code on `main` is the Python prototype in `studio/forge/prototype/`.
- **VFX polish of `lt_fx_craft`**: open [PR #67](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/67) (redesign as a rising spark and a ward-mirror contrast report). Until it merges, `main` has the first-pass craft effect.
- **Audio packing of batches 2 to 4** on a Mac-pinned toolchain. Nothing is packed yet; see the audio section and [the toolchain findings](AUDIO_TOOLCHAIN_MAC.md).

### What needs the human

1. **Listening approval for audio batches 2 to 4** (24 effects and 4 beds, listed below). No agent has heard them. Each batch's `VERIFICATION.md` lists the A/B pairs to compare. Packing should wait for approval, since a pack revision needs a fresh approval anyway.
2. **1× readability review of the six Longtime VFX.** The 188 frames passed machine checks only (`check_longtime_vfx.py`), and acceptance numbers were retuned once against real output. Section 8.5 (what still needs a human look) of the [VFX design](LONGTIME_VFX.md).
3. **Art review of the two PixelLab characters.** `lt_kiln_keeper` and `lt_ink_marten`: the marten's pale left-ear notch reads in south and east only.
4. **Art review of the forge bake-off.** The ImageGen + rig marten against the shipped one; the bake-off recommends funding P2 but human art approval is pending. [Bake-off verdict](FORGE_BAKEOFF.md).
5. Decisions that block later work: the audio toolchain choice (the options are in the toolchain note) and the reviewer decisions in section 7 of the [VFX design](LONGTIME_VFX.md).

## Art state

Counts are IDs / frames in the seven web chunk manifests under `assets/atlases_longtime/web/*/chunk-manifest.json` (the mobile manifests are identical). `python -I tools/scripts/check_longtime.py` and `check_longtime_vfx.py` pass: 102 inherited core IDs, 125 planned Longtime IDs, wave 1 9 IDs / 101 frames, VFX 6 new IDs / 188 frames all `packed`, 12 inherited effects reused.

**101 Longtime IDs and 558 frames are packed** (previously 93 / 306: +2 characters / 64 frames, +6 VFX / 188 frames). The 102 inherited core entries are accounted for separately.

| Abode | Armory | Ember Delta | Interface | Mist Archive | Star Quarry | Wards |
|---|---|---|---|---|---|---|
| **7 / 110** | **49 / 136** | 1 / 24 | **34 / 98** | 1 / 24 | 1 / 24 | **8 / 142** |

The VFX landed in four chunks: Abode `lt_fx_gate_unseal` (12 frames), Armory `lt_fx_impact` (16), Interface `lt_fx_craft` and `lt_fx_stamp` (66), Wards `lt_fx_ward_pulse` and `lt_fx_core_breach` (94). Some effects carry one frame set per palette variant, which is why frame counts exceed clip lengths. Specs are deterministic SpriteFX JSON under `tools/generators/vfx_specs/`; the ledger entry is the `vfx` block of the [Longtime manifest](../assets/manifest_longtime.json).

`lt_kiln_keeper` (NPC) and `lt_ink_marten` (pet) were made with PixelLab before it was retired. Provenance, prompts, PixelLab ids and credits are in `assets/raw/longtime/<id>/provenance.json`; the pipeline is `tools/scripts/build_longtime_characters.py`.

## Audio state

All **46 core IDs (6 music and 40 effects) have masters.** `tools/.venvs/project/bin/python -I tools/scripts/check_audio_core_masters.py` proves it (format, loop bounds, endpoints, PCM/WAV/input hashes, one ledger record per ID). `check_audio_plan.py` validates the allocation. The extensions still reserve 5 music and 10 effects behind their design gates. [Audio design](AUDIO_DESIGN.md) · [Audio manifest](../assets/audio_manifest.json)

| Stage | Beds | Effects | Status |
|---|---|---|---|
| Pilot (`pilot_v1`) and first Wave 2 batch (`wave2_batch1_v1`) | `bgm_dong_phu`, `bgm_hengyue` | 16 | Packed as Ogg/AAC, approved by listening. |
| Batch 2 | `bgm_blood_sea` | 8 | Source and masters only. Unpacked, unlistened. |
| Batch 3 | `bgm_ancient_god` | 8 | Source and masters only. Unpacked, unlistened. |
| Batch 4 | `bgm_boss_trial`, `bgm_endless` | 8 | Source and masters only. Unpacked, unlistened. |

So **2 beds and 16 effects are packed and approved; 4 beds and 24 effects are unpacked and unlistened.** Notes for each unlistened batch are in `assets/audio/source/wave2_{second,third,fourth}_sfx/VERIFICATION.md` (batch 2's bed sits in `assets/audio/bgm_blood_sea/`, and so on). Masters were loudness-checked with FFmpeg 8.1.2; re-measure when packing. Beds in `assets/audio/bgm_*/`, effect masters in `assets/audio/masters/<batch>/`, ledgers in `assets/audio/source/<batch>/provenance.json`.

### Approved Hằng Nhạc audio (history, still the listening reference)

The approved Động Phủ pilot (one bed and eight cues) remains the listening reference. The first Wave 2 sub-batch adds one chapter bed and eight cues. The two published sources are recoverable independently.

| Source branch | Exact commit and evidence |
|---|---|
| [Hằng Nhạc score](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/skills-arena-prs/hengyue-score) | [55dd32c9625a5e213312380ca01992d64ba60db6](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/55dd32c9625a5e213312380ca01992d64ba60db6). Two byte-identical renders. Stereo PCM16 at 44,100 Hz, loop [0, 3087000) frames, 70 s, −21.66 LUFS and −7.06 dBTP. |
| [Wave 2 effects](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/ember-delta-tiles/wave2-first-sfx) | [b20ef09b802f84c207d895db0752090eeb62db1d](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/b20ef09b802f84c207d895db0752090eeb62db1d). Eight mono masters reproduced twice. Step, evade, cast, bolt, light tell, focus, cancel and deny have individual PCM and WAV hashes. |

The user heard and approved the Hằng Nhạc Ogg/AAC A/B. [PR #52](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/52) merged audio head `b27eb12c34a9d0786d535b750993dc3140b54a04` into `main` at `c1db17870829ae4cdadf310786567efb8b99489e`. The current package is [assets/audio/packs/wave2_batch1_v1](../assets/audio/packs/wave2_batch1_v1).

Independent technical QA rebuilt all five codec files byte-for-byte (on the Windows toolchain), verified all 23 pilot files and matched the portable audition to the decoded audio across three loop seams and 16 solo SFX excerpts. The listening status in the QA comment predates the user's approval. [Exact-head QA on #52](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/52#issuecomment-7068634787)

To replay the comparison, download the WAV and timing key from the [portable audition at `cb0181eb463848efec0bec43ffbef41cfa2b7e29`](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/cb0181eb463848efec0bec43ffbef41cfa2b7e29/audition). The master, Ogg and AAC seams occur at 4.0, 12.8 and 21.6 seconds, followed by all eight effects solo and over the bed.

| File under `audition/` | SHA-256 of Git blob contents |
|---|---|
| `wave2_batch1_audition.wav` | `d998e86a3bd1451c449abc299ceea6c807ab194dd4396b8c87a7ca7b9cc832e6` |
| `wave2_batch1_audition_timing.json` | `e2aa0fd7ffc501b7fb80f50eb0e205b2369bb88c87ea056b69f1207936e529e2` |
| `wave2_batch1_audition_timing.md` | `f5d6f310938ceea91e44b47b8bd2da902fb9fdc66543e8ce7b50e3670ea7b2cf` |

### Audio toolchain on this Mac

The packs were approved on a Windows build: FFmpeg 6.1.1 (gyan.dev essentials, SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`). This Mac has FFmpeg 8.1.2 on `PATH` without libvorbis. A 6.1.1 with libvorbis and AAC-LC can be built here (`tools/scripts/build_ffmpeg_611_mac.sh`, into the git-ignored `tools/.toolchains/`), **but it does not reproduce the approved packs byte for byte**: `--check` fails for `pilot_v1` and `wave2_batch1_v1` on every Ogg and M4A file, while frame counts, delay and loop behaviour match and decoded differences are float-rounding sized. `pack.json` also embeds the FFmpeg banner, so it cannot match across builders. Options (keep Windows as the packing authority, re-pin to a Mac build with fresh approval, run the exact Windows binary, relax `--check` to a tolerance, record the binary's libvorbis) are in [the findings](AUDIO_TOOLCHAIN_MAC.md). Packing batches 2 to 4 on a Mac-pinned toolchain is the in-progress work above.

## Bring up on this Mac

The earlier version of these steps was written for PowerShell on Windows. These are the macOS (zsh) equivalents; the project-level facts are in [skills installed, "This machine"](SKILLS_INSTALLED.md).

1. Install Git, GitHub CLI and Orchestrator, and authenticate GitHub. Clone, register the checkout (absolute path) and look at the state:

   ```sh
   git clone https://github.com/nguyenbinhanltv/tien-nghich-2d.git
   cd tien-nghich-2d
   ao project add --path "$PWD" --name tien-nghich-2d
   ao project ls
   git fetch origin main && git log -1 origin/main
   gh pr list --state open
   ```

2. Tooling. There is no `python` on `PATH` and system `python3` lacks NumPy and Pillow; use the git-ignored environments (they live in the main checkout, worktrees reach them through symlinks that must not be committed): `tools/.venvs/project/bin/python -I` (CPython 3.14, NumPy 2.5.5, Pillow 12.3.0) for checks and tests, and `tools/.venvs/spritefx/bin/python` for SpriteFX (launch it with the isolated recipe in [skills installed](SKILLS_INSTALLED.md)). Node is 24.x. Third-party skill clones live once in the main checkout's `tools/skills/` (`bash tools/scripts/fetch_skills.sh` recreates them).

3. Checks that exist, all run from the repository root (counts at `99bec8f`):

   ```sh
   tools/.venvs/project/bin/python -I -m unittest discover -s tools/tests -p 'test_*.py'   # 113 tests
   tools/.venvs/project/bin/python -I tools/scripts/check_manifest.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime_vfx.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_plan.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_core_masters.py
   node studio/smoke-test.mjs               # `node preview-app/smoke-test.mjs` still works through a shim
   node --test studio/core/tests/*.test.mjs # 41 tests
   node --test studio/mcp/*.test.mjs        # 30 tests
   node --test studio/server/editor.test.mjs studio/tests/editor.test.mjs   # 6 + 6 tests
   node studio/mcp.mjs --self-test          # must end with `self-test PASSED`
   tools/.venvs/project/bin/python -I studio/forge/prototype/test_bake.py   # 7 tests
   ```

   The browser tests in `studio/tests/*-browser.test.mjs` need Playwright, which is not installed here and was not run for this sync.

4. Browse: `node studio/serve.mjs --port 4173`, then open [Asset Inspector](http://127.0.0.1:4173/studio/?tab=inspector): **Longtime art → interface** for shipped icons, **Audio pilot** for the approved reference. Old `/preview-app/...` URLs still resolve (shim). [Studio app guide](../studio/README.md) · [`preview-app/` shim note](../preview-app/README.md)

5. MCP: `.mcp.json`, `.codex/config.toml` and `.agents/mcp_config.json` start `node studio/mcp.mjs` for Claude Code, Codex and Antigravity with no user-level edits. The server exposes one tool today (`studio_project_info`); the 25-tool plan is P3. One connected agent is enough.

6. Audio pack checks need the exact Windows FFmpeg build (see the toolchain section). On this Mac, only exploration builds are possible today:

   ```sh
   python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg <ffmpeg-6.1.1> --check   # fails here, see AUDIO_TOOLCHAIN_MAC.md
   ```

## Backlog for a later user-directed restart

- **Characters:** **30 IDs** remain (the manifest has 32 character-profile IDs: 6 NPC, 6 pet, 12 mob, 4 boss, 4 player; 2 are produced, matching the bake-off's "30 remaining"). PixelLab is retired (2026-11-22): they wait for the studio forge (phase P2) and are made with Codex or Antigravity, either one is enough. The routes and their evidence: [Studio plan](STUDIO_PLAN.md) · [Forge bake-off](FORGE_BAKEOFF.md) · [Asset routing](ASSET_ROUTING.md). Re-derive the count from [`assets/manifest_longtime.json`](../assets/manifest_longtime.json) before dispatching. [Longtime GDD](LONGTIME_GDD.md)
- **Longtime VFX:** produced (6 IDs, 188 frames). Open: the 1× human review (section 8.5), the section 7 design decisions, and the `lt_fx_craft` redesign in PR #67. [VFX design](LONGTIME_VFX.md) · [Art Bible](ART_BIBLE.md) · [Core manifest](../assets/manifest.json)
- **Audio:** core masters are complete. Remaining core work is human listening for batches 2 to 4 and packing them. Extensions (5 BGM, 10 SFX) stay behind their design gates. [Audio design](AUDIO_DESIGN.md)
- **Studio:** P0 is done in substance (pack, core extraction, relocation, skills, routing, minimal MCP, bake-off). P1 (shell, Overview) and P2 (forge) are in progress; P3 onward (25-tool MCP, review and jobs, VFX and audio tools) have not started. [Studio plan](STUDIO_PLAN.md) · [MCP capabilities](MCP_CAPABILITIES.md)
- **Asset work:** use the versioned [routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md), [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) and [AssetCat](../.agents/skills/tien-nghich-assetcat/SKILL.md) skills for source routing, palette/outline checks and rights records.
