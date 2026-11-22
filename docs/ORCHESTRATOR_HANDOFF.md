# Orchestrator handoff

State as of `main` at `e5fb170` (PR #88), with the changes of the PR that carries this sync. Every number below was re-counted from the repository at that commit; the command that reproduces it is named next to it. A fresh clone recovers the committed assets, manifests and tools from GitHub. Keep separate records for private Inspector revisions and local session state.

Work arrives as pull requests against `main`: workers open them, the orchestrator reviews and merges. Check `gh pr list --state open` first.

## Resume point

### Merged since the last sync (#63 to #88)

| PR | What |
|---|---|
| [#67](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/67) | `lt_fx_craft` redesigned as a rising spark, with a ward-mirror contrast report. |
| [#69](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/69), [#72](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/72), [#77](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/77) | The forge in pure Node (`studio/forge/`): sheet import, pixelisation, part rig, motion templates, baker, pixel patches, animation gates, one pipeline from sheet to gates, pose-sheet clips. |
| [#70](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/70) | Audio packs `wave2_batch2_v1`, `_batch3_v1`, `_batch4_v1` on the Mac toolchain, plus a cross-toolchain equivalence check. |
| [#71](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/71) and the tab PRs [#73](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/73), [#76](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/76), [#81](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/81), [#82](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/82), [#83](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/83), [#84](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/84), [#85](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/85), [#86](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/86) | The studio shell and the seven built tabs (see the Studio section). |
| [#74](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/74), [#87](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/87), [#88](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/88) | The MCP server grows from 1 to 25 tools; #88 hardens the generator registry and program runner. |
| [#75](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/75), [#79](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/79), [#80](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/80) | Drawn follow-pose trial of the Ink Marten, the audio engine, and the animation-default amendment. |

Work arrives as pull requests; check `gh pr list --state open`.

### In progress, not merged

- **Studio `sandbox` and `atlas` tabs**: the two ids still on the placeholder. Workers were building them when this sync was written; check the open PR list.
- Plan items beyond the plan's P5 (Provenance, packaging for another project) have not started. Ideas taken from open-source tools are a separate proposal and are **not approved**.

### What needs the human

1. **Listening approval for audio batches 2 to 4** (24 effects and 4 beds). The packs exist (#70) but no one has listened. Each batch's `VERIFICATION.md` lists the A/B pairs; the Audio tab's blind A/B and sign-off are where it is recorded. Only a person can sign.
2. **1× readability read of the six Longtime VFX.** The 188 frames passed machine checks only. Use the VFX tab's **1× read** view (it stores a typed note on the effect's first frame, shown in the Review tab as a readability read; it changes no status). Section 8.5 of the [VFX design](LONGTIME_VFX.md).
3. **Art review of the two PixelLab characters** `lt_kiln_keeper` and `lt_ink_marten` (the marten's pale left-ear notch reads in south and east only).
4. **Art review of the two forge trials**: the ImageGen + rig marten against the shipped one ([bake-off](FORGE_BAKEOFF.md)) and the drawn follow-pose marten (#75). Human art approval is pending for both.
5. Decisions that block later work: the reviewer decisions in section 7 of the [VFX design](LONGTIME_VFX.md). The audio toolchain choice in [the toolchain note](AUDIO_TOOLCHAIN_MAC.md) was taken in practice: approved packs stay Windows-pinned, new packs are built on the Mac and record their own toolchain.

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
| Pilot (`pilot_v1`) and first Wave 2 batch (`wave2_batch1_v1`) | `bgm_dong_phu`, `bgm_hengyue` | 16 | Packed as Ogg/AAC, approved by listening (Windows toolchain). |
| Batch 2 (`wave2_batch2_v1`) | `bgm_blood_sea` | 8 | Packed on the Mac toolchain. **Not listened to.** |
| Batch 3 (`wave2_batch3_v1`) | `bgm_ancient_god` | 8 | Packed on the Mac toolchain. **Not listened to.** |
| Batch 4 (`wave2_batch4_v1`) | `bgm_boss_trial`, `bgm_endless` | 8 | Packed on the Mac toolchain. **Not listened to.** |

So **all 6 beds and 40 effects are packed; 2 beds and 16 effects are approved by listening, 4 beds and 24 effects wait for a human.** (The catalog used to show four of the beds as "authored" because it read only packs that list one bed under `bgm`; batches 2 to 4 list theirs under `bgms`, and both shapes are read now.)

**Listening approvals file.** [`assets/audio/listening_approvals.json`](../assets/audio/listening_approvals.json) records the approvals given before the studio existed: 18 cues (`pilot_v1`: 9, `wave2_batch1_v1`: 9), each pinned to its master's SHA-256. The Review tab reads it. 18 of the 46 core IDs are approved and **28 wait**; a master whose hash differs is not covered. Notes for each unlistened batch are in `assets/audio/source/wave2_{second,third,fourth}_sfx/VERIFICATION.md`; beds are in `assets/audio/bgm_*/`, effect masters in `assets/audio/masters/<batch>/`, ledgers in `assets/audio/source/<batch>/provenance.json`.

**Audio engine** (`studio/audio/`, [README](../studio/audio/README.md)): a declarative, deterministic synthesiser in pure Node. A patch (one-shot) or a score (loop) is data; the engine renders PCM16 WAV, measures it (peak, true peak, RMS, LUFS, onset and tail, loop seam) and draws a waveform and spectrogram. The 40 delivered effects re-render byte-identically from converted patches (a test proves it). Nothing in it listens or signs. It is reached through `studio_audio_render` and `studio_audio_analyze` and the Audio tab's patch preview, which writes to scratch only.

**Audition pairs.** `assets/audio_manifest.json` carries `audition_pairs` (the three pairs named in the [audio design](AUDIO_DESIGN.md): dash against flying-sword whoosh, seal lock against hit, pickup against card select) for the Audio tab's blind A/B. Playing the cue under review in the A/B counts as having heard it for sign-off; playing its partner does not.

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

The packs were approved on a Windows build: FFmpeg 6.1.1 (gyan.dev essentials, SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`). This Mac has FFmpeg 8.1.2 on `PATH` without libvorbis. A 6.1.1 with libvorbis and AAC-LC can be built here (`tools/scripts/build_ffmpeg_611_mac.sh`, into the git-ignored `tools/.toolchains/`), **but it does not reproduce the approved packs byte for byte**: `--check` fails for `pilot_v1` and `wave2_batch1_v1` on every Ogg and M4A file, while frame counts, delay and loop behaviour match and decoded differences are float-rounding sized. `pack.json` also embeds the FFmpeg banner, so it cannot match across builders. Options (keep Windows as the packing authority, re-pin to a Mac build with fresh approval, run the exact Windows binary, relax `--check` to a tolerance, record the binary's libvorbis) are in [the findings](AUDIO_TOOLCHAIN_MAC.md). Batches 2 to 4 were packed on a Mac-pinned toolchain (#70, option 2 of the findings); each pack records its own toolchain.

## Studio

The studio is the app in `studio/` ([guide](../studio/README.md)), driven by the project pack (`studio.project.json` and `studio/schemas/`). One connected agent (Claude Code, Codex or Antigravity) is enough. [Plan](STUDIO_PLAN.md) · [tab contract](../studio/ui/README.md) · [MCP guide](../studio/mcp/README.md)

**Seven tabs are built; `sandbox` and `atlas` are still on the placeholder.** Run `node studio/serve.mjs --port 4173` and open `/studio/`.

| Tab | What it does |
|---|---|
| Overview | Catalog counts by source and readiness (planned, authored, packed) across core, Longtime, VFX and audio. |
| Characters | Roster by state, facing and clip viewer with per-frame timing, pivot, rigs and forge experiments, sheet and rig tools. |
| Objects | Tilesets, props, weapons, projectiles, icons and UI: frame editor, registered generators with parameters and a seed, new planned IDs. |
| VFX | The 18 effects frame by frame on floors and over a character, spec, recorded and recomputed audits, provenance, spec rounds, a human 1× readability note, and **Build + audit** (rebuilds the committed spec with the registered SpriteFX adapter into scratch and compares it with the delivered frames; it never writes into `assets/` or changes a status). |
| Audio | Beds and effects: audition master, Ogg and AAC with loop seams, pictures, sprite map, blind A/B, listening checklist with the human's signature, patch preview. |
| Review | The human inbox for art and audio: before/after pixel diff, agent requests and replies, human-only approve and request-changes, listening sign-offs and the pre-studio approvals; shows VFX 1× reads as reads. |
| Jobs | What agents are doing: their tool calls and the background jobs they started (status, log tail, cost). Read-only. |

**MCP: 25 tools** (12 `read`, 13 `author`; no tool needs `pack`, and none approves art, signs a listening, publishes into a shipped atlas or deletes). Counted from the registry in `studio/mcp/tools/index.mjs`.

- `read`: `studio_project_info`, `studio_catalog_search`, `studio_asset_get`, `studio_template_get`, `studio_preview_render`, `studio_scene_snapshot`, `studio_qa_run`, `studio_diff`, `studio_audio_analyze`, `studio_review_list`, `studio_job_status`, `studio_job_wait`.
- `author`: `studio_asset_plan`, `studio_frames_submit`, `studio_metadata_set`, `studio_sheet_import`, `studio_process`, `studio_rig_bake`, `studio_frame_patch`, `studio_generator_run`, `studio_vfx_build`, `studio_pack` (staging area only), `studio_audio_render`, `studio_review_request`, `studio_review_reply`.

Transports are stdio and loopback HTTP. `GET /mcp/jobs[?limit=n]` lists background jobs as views only (default 50, cap 200). [`studio/mcp/SAMPLE_RUNS.md`](../studio/mcp/SAMPLE_RUNS.md) holds four paste-able runs (static asset, animated character, VFX, audio cue) for a fresh agent session, plus pass criteria; they are for finding what an agent gets wrong with the tool list, not for shipping art.

**Animation default** (decision 3 and its amendment in the plan, settled by the bake-off): locomotion from drawn key poses on a **pose sheet**; idle and other small motions from the **rig**; one-sided marks (a scar, a charm) as **pixel patches**, which survive every re-bake. Environment, items and projectiles come from registered generators, VFX from `studio_vfx_build`. PixelLab is retired.

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

3. Checks that exist, all run from the repository root (counts at the time of this sync):

   ```sh
   tools/.venvs/project/bin/python -I -m unittest discover -s tools/tests -p 'test_*.py'   # 127 tests
   tools/.venvs/project/bin/python -I tools/scripts/check_manifest.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime_vfx.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_plan.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_core_masters.py
   node --test $(git ls-files 'studio/**/*.test.mjs' | grep -v browser)   # 556 tests on main at b61a183 (563 with this PR's additions)
   node studio/smoke-test.mjs               # `node preview-app/smoke-test.mjs` still works through a shim
   node studio/mcp.mjs --self-test          # must end with `self-test PASSED`
   ```

   The browser tests (`*-browser.test.mjs`) need Playwright, which is not installed here and was not run.

4. Browse: `node studio/serve.mjs --port 4173`, then open `http://127.0.0.1:4173/studio/`. The old [Asset Inspector](http://127.0.0.1:4173/studio/?tab=inspector) and **Audio pilot** pages still work. Old `/preview-app/...` URLs still resolve (shim). [Studio app guide](../studio/README.md) · [`preview-app/` shim note](../preview-app/README.md)

5. MCP: `.mcp.json`, `.codex/config.toml` and `.agents/mcp_config.json` start `node studio/mcp.mjs` for Claude Code, Codex and Antigravity with no user-level edits. It serves the 25 tools of the Studio section. One connected agent is enough.

6. Checking the approved packs (`pilot_v1`, `wave2_batch1_v1`) needs the exact Windows FFmpeg build (see the toolchain section); batches 2 to 4 check on the Mac build. Build the 6.1.1 toolchain once (`bash tools/scripts/build_ffmpeg_611_mac.sh native`; it writes `tools/.toolchains/ffmpeg-6.1.1/prefix/bin/ffmpeg`, with `prefix-nofma` and `prefix-x86` for the other variants), then run the check with the project Python, because the packer imports NumPy:

   ```sh
   tools/.venvs/project/bin/python -B tools/scripts/build_audio_wave2_batch1_pack.py \
     --ffmpeg tools/.toolchains/ffmpeg-6.1.1/prefix/bin/ffmpeg --check   # fails here: codec files differ, see AUDIO_TOOLCHAIN_MAC.md
   ```

## Backlog for a later user-directed restart

- **Characters:** **30 IDs** remain (the manifest has 32 character-profile IDs: 6 NPC, 6 pet, 12 mob, 4 boss, 4 player; 2 are produced, matching the bake-off's "30 remaining"). PixelLab is retired (2026-11-22): they wait for the studio forge (phase P2) and are made with Codex or Antigravity, either one is enough. The routes and their evidence: [Studio plan](STUDIO_PLAN.md) · [Forge bake-off](FORGE_BAKEOFF.md) · [Asset routing](ASSET_ROUTING.md). Re-derive the count from [`assets/manifest_longtime.json`](../assets/manifest_longtime.json) before dispatching. [Longtime GDD](LONGTIME_GDD.md)
- **Longtime VFX:** produced (6 IDs, 188 frames); `lt_fx_craft` was redesigned in #67. Open: the 1× human read (section 8.5) and the section 7 design decisions. [VFX design](LONGTIME_VFX.md) · [Art Bible](ART_BIBLE.md) · [Core manifest](../assets/manifest.json)
- **Audio:** core masters are complete and all packed. Remaining core work is human listening for batches 2 to 4. Extensions (5 BGM, 10 SFX) stay behind their design gates. [Audio design](AUDIO_DESIGN.md)
- **Studio:** shell, seven tabs, forge and the 25-tool MCP are on `main`. Left: the `sandbox` and `atlas` tabs, and the plan's later phases. [Studio plan](STUDIO_PLAN.md) · [MCP capabilities](MCP_CAPABILITIES.md)
- **Asset work:** use the versioned [routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md), [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) and [AssetCat](../.agents/skills/tien-nghich-assetcat/SKILL.md) skills for source routing, palette/outline checks and rights records.
