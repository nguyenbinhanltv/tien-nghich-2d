# Orchestrator handoff

State as of `main` at `4aad1e0` (PR #145), with the changes of the PR that carries this sync. Every number below was re-counted from the repository at that commit; the command that reproduces it is named next to it. A fresh clone recovers the committed assets, manifests and tools from GitHub. Keep separate records for private Inspector revisions and local session state.

Work arrives as pull requests against `main`: workers open them, the orchestrator reviews and merges. Check `gh pr list --state open` first.

## Resume point

### Merged since the last sync (#116 to #145)

30 PRs, all merged into `main`, none open. Reproduce the list: `gh pr list --state all --limit 200 --json number,title,state,mergedAt --jq '.[]|select(.number>=116 and .number<=145)|"\(.number) \(.state) \(.mergedAt) \(.title)"' | sort -n`. Open PRs: `gh pr list --state open` (empty at this sync).

| Group | PR | What |
|---|---|---|
| P6, 3/3 | [#116](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/116) | `studio/README.md` for a stranger, the pack reference generated from the schema, the plan's status section, the previous handoff sync. |
| **Open-source ideas, wave 2** (the last 11 of 18, plus #113 which merged just before this range) | [#113](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/113) | C4 art-bible version stamp, D7 quota estimate before a run, D3 handoff package with the AI disclosure. |
| | [#117](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/117), [#118](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/118), [#119](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/119) | E1, E3, E7 (frame tags and linked cels, scoped transforms, open in Pixelorama and LibreSprite); F5, F6 (tile animation and collision shapes, export to LDtk and Tiled maps); A6, F8, F9 (palette-bound drawing helpers, VFX recorder, audio sized by the gameplay window). |
| | [#120](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/120) | Not an idea from the plan: the owner's pack decisions (licence profile, a counting-only quota) and the rough edges from the Codex retest (proportion guide for custom assets, clearer errors, contact and landmark annotations, accent distances). No new MCP tool. |
| **Licence and provenance** | [#121](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/121) | Output rights of the 97 legacy core assets, recorded from the owner's statement "Toàn bộ là ảnh gốc dự án" in `assets/review/licence_decisions.json`; the ledger reads it (`studio/core/ledger.mjs`). It is a licence record, not a legal review, and approves no image. |
| | [#124](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/124) | Provenance fields for every asset (`assets/review/provenance_supplement.json`, built by `tools/scripts/build_provenance_supplement.py`); the Atlas tab shows known, unknown (with reason), not applicable and planned. |
| **Orange** | [#122](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/122) | Ember-orange ramp (`orange_01` to `orange_03`), palette 40 to 43 colours, colours approved by the owner (`owner_orange_palette_2026-11-22`, colour values only, no frame). Indices 1 to 40 unchanged. |
| **lt_ashen_crown_b** | [#123](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/123) | Candidate B ships as the separate ID `lt_ashen_crown_b` (72 frames, `forms` chunk) beside the unchanged `lt_ashen_crown`, on the owner's "Chọn B và bản hiện tại"; `forms` repacked from 288 to 360 frames. |
| **Pixel Kiln** (the tool, not the first project) | [#126](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/126), [#131](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/131), [#132](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/132) | Name (1/3), project management with a project list, a Projects screen and a live switch (2/3), one-line top bar (3/3). |
| | [#125](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/125), [#127](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/127), [#128](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/128) | First UI fixes: Objects thumbnails (1C, B3); Review inbox cold under 3 s and warm under 0.5 s with loading and error states (B2); Atlas left column overlap near 1280 px (B1). |
| **UI plan "Ngọc giản & Ấn triện", wave 2** | [#129](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/129), [#130](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/130), [#133](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/133) | Shared component library and styleguide (2B); viewport harness and the 72-shot capture script (2C); tokens, local fonts (Lora, VT323, both OFL) and the re-skin (2A). |
| **Wave 3** | [#134](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/134), [#135](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/135), [#136](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/136), [#137](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/137) | The nine tabs moved onto the shared kit: Overview and Jobs (3A), Characters and the importer (3B), Objects, VFX and Atlas (3C), Review, Audio and Sandbox (3D). |
| **Wave 4** | [#138](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/138), [#139](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/139), [#140](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/140), [#141](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/141) | Approval seal, shortcuts, queue bar and undo in Review (4C); pixel viewer and the Characters stage (4B); palette actions, `?` cheat-sheet, `g`+number hints (4D); Overview as the abode with a CSS scene and `ui.voice` (4A). |
| **Wave 5** | [#142](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/142), [#143](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/143), [#144](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/144), [#145](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/145) | Pixelview in Objects and VFX (5B); idle preview, clip tabs and a sticky decision bar in Characters (5A); Jobs feed without self-fetch, `.btn.sm`, UI docs (5D); three interface modes (abode, Black Ink, Edict Paper) and two densities (5C). **The five-wave UI plan is done.** |

Not in the table, on `main` after #145 and before this PR: nothing (`git log --oneline 4aad1e0..origin/main` was empty when this was written).

### Earlier: merged between the previous syncs (#89 to #115)

| PR | What |
|---|---|
| [#89](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/89), [#90](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/90), [#92](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/92) | The last three tabs: Sandbox (scene documents, the three playables as scenes) and Atlas and Provenance (engine exports for Phaser, Pixi, Godot, Unity, Aseprite and Tiled, the licence ledger), plus the tab follow-ups of P4. |
| [#91](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/91), [#93](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/93) | Four sample runs with Codex through the MCP, and what they found (forge two-sheet bake, verdicts, tool text). |
| [#94](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/94) | **P6, 1/3.** `studio/` no longer names the first project: conventions moved into the pack (`catalog.categories`, `info`, `serve`, source options); the previewer, Drowned Court and Evening Bell moved to `playables/` with their URLs kept; a whole-tree literals test guards it. |
| [#95](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/95), [#98](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/98), [#99](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/99) | Palette snapping that does not flicker (B8); pack-driven figure guides; `studio_frame_read`, text patches, inspectable previews, `dryRun` on every write tool (A1, A8, A2, A5). |
| [#105](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/105), [#106](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/106), [#107](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/107), [#108](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/108) | Spritesheet importer, asset plan from a CSV, behaviour specs with stable ids (E5, D6, E6); `studio_guide`, project rules at initialize, style-locked entities, prompt conventions (A3, C2, C3); the QA envelope, stop policy and evidence that expires (B1, B3, B4); the three review standings **approved / baseline / awaiting review**. |
| [#111](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/111), [#112](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/112), [#114](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/114) | Wave 2 of the ideas plan, first part: motion measures, clip contracts and lint, the fixed rubric (A4, B7, B2); takes, candidate runs and region change requests (D2, D1, B5); the character lineup ruler (C1). The rest of wave 2 is in the table above. |
| [#115](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/115) | **P6, 2/3.** `node studio/cli.mjs` (`init`, `serve`, `mcp`, `check`, `doctor`, `baseline`), `studio/package.json` with no dependencies, `runtime: "node"` interpreters, the second sample project `studio/examples/moss-lantern/`, the acceptance test (CLI-005). |
| [#96](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/96), [#103](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/103), [#109](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/109), [#110](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/110) | The owner's 2026-11-22 approvals recorded by hash; atlas tests that follow the shipped atlas; Characters tests on a fixture; the approval of 30 new characters and the awaiting Longtime assets. |
| [#97](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/97), [#100](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/100), [#101](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/101), [#102](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/102), [#104](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/104) | Art: the 30 remaining Longtime characters (PixelLab, on the one-day exception): star_quarry, mist_archive, ember_delta, abode and the forms and trial boss, repacked per chunk. |

Work arrives as pull requests; check `gh pr list --state open`.

### In progress, not merged

- **Nothing is open.** `gh pr list --state open` was empty at this sync.
- **Wave 2 of the [open-source ideas plan](STUDIO_OSS_IDEAS.md): 18 of 18 are on `main`.** The 18 are the rows marked wave 2 in the plan's table (`grep -E '^\| [A-F][0-9]+ \|' docs/STUDIO_OSS_IDEAS.md | awk -F'|' '$(NF-1)+0==2' | wc -l`): A4, A6, B2, B5, B7, C1, C4, D1, D2, D3, D7, E1, E3, E7, F5, F6, F8, F9. **Wave 1: all 14 are on `main`.** Wave 3 (12 ideas) is not started and waits for real need.
- **The five-wave UI plan is done** (waves 1 to 5, the table above). The studio itself has no open work: the nine tabs, the Projects screen, the forge, the audio engine and the 27-tool MCP are done, and P6 (reuse by another project) is complete.

### What needs the human

1. *(Done 2026-11-22.)* The owner approved, in chat to the orchestrator: the 28 audio items of batches 2 to 4 (listened), the six Longtime VFX including the redesigned `lt_fx_craft` (1× readability), and the art of `lt_kiln_keeper` and `lt_ink_marten`. Recorded against content hashes in [`assets/audio/listening_approvals.json`](../assets/audio/listening_approvals.json) and [`assets/review/art_approvals.json`](../assets/review/art_approvals.json); a file whose hash differs from the record is not covered. Nothing from those three items waits on the human any more. The `review pending` wording inside each effect's `assets/raw/longtime/lt_fx_*/provenance.json` was left as it is (those directories are in flux); the approvals file is the record.
   **Later the same day (18:20 to 18:27)** the owner said "Duyệt hết assets trên studio cho tôi", then "Duyệt 30 hình nhân vật mới", and when asked chose "30 nhân vật + asset Longtime đang chờ"; the last answer narrowed the first. Recorded as two entries in the same file: `owner_new_characters_2026-11-22` (the 30 new PixelLab characters: 1,568 frames and 1,930 tracked raw PNGs) and `owner_longtime_awaiting_assets_2026-11-22` (93 other Longtime assets, 306 frames), each tied to sha256. The Review tab then read 2,126 approved, 2,854 baseline, 0 awaiting (now 2,198 approved: see the entry below). The legacy core art stays "baseline, no review record" and `assets/review/baseline_frames.json` is untouched. The 20 characters that carried `review.status = awaiting_owner_review` now say `approved_by_owner` with a pointer to the first entry (written by their build scripts). Not covered: `assets/candidates/`, `assets/experiments/`, planned assets, any frame whose bytes change later.
   **Later the same day (about 22:50 to 23:20)** the owner decided, in chat to the orchestrator: the output rights of the 97 legacy core assets ("Toàn bộ là ảnh gốc dự án", `assets/review/licence_decisions.json`, #121); candidate B of `lt_ashen_crown` ships beside the current form ("Chọn B và bản hiện tại", record `ashen_crown_b_owner_choice_2026-11-22`, #123); the three ember-orange colours (record `owner_orange_palette_2026-11-22`, colour values only, #122); and filling the provenance of all assets (#124). The Pixel Kiln name, the local fonts and the UI plan were approved the same day (the name is in [STUDIO_PLAN](STUDIO_PLAN.md); the fonts are in the #133 description and their licences in `studio/ui/fonts/README.md`). The art-approvals file now holds 6 records and the Review tab reads **2,198 approved, 2,854 baseline, 0 awaiting** (5,052 frames; `curl localhost:<port>/api/tabs/review/inbox`, field `artCounts`, with `node studio/serve.mjs --port <port>` running). A record of rights, colours or a form choice approves nothing beyond what it names.
2. **Art review of the two forge trials**: the ImageGen + rig marten against the shipped one ([bake-off](FORGE_BAKEOFF.md)) and the drawn follow-pose marten (#75). Human art approval is pending for both.
3. **For the owner to confirm (ledger):** (PixelLab tier recorded: Tier 1: Pixel Apprentice on 2026-11-22; older characters' tier not recorded.) whether shipping audio encoded by the LGPL FFmpeg build needs anything more. Facts are in [LEDGER_FACTS](LEDGER_FACTS.md). Also: the rights record of #121 is the owner's statement, not a legal review; the ledger shows the 97 assets as covered by it, and whether that is enough to ship is the owner's call.
4. The [open-source ideas plan](STUDIO_OSS_IDEAS.md) is approved (wave 1 now, wave 2 next, wave 3 only on real need). **Wave 1 is built (14 of 14) and wave 2 is built (18 of 18).** Nothing for the owner to decide there unless wave 3 is wanted.
5. Decisions that block later work: the reviewer decisions in section 7 of the [VFX design](LONGTIME_VFX.md). The audio toolchain choice in [the toolchain note](AUDIO_TOOLCHAIN_MAC.md) was taken in practice: approved packs stay Windows-pinned, new packs are built on the Mac and record their own toolchain.

## Art state

Counts are IDs / frames in the nine web chunk manifests under `assets/atlases_longtime/web/*/chunk-manifest.json` (the mobile manifests are identical). `tools/.venvs/project/bin/python -I tools/scripts/check_longtime.py` and `check_longtime_vfx.py` pass: 102 inherited core IDs, 126 planned Longtime IDs, wave 1 9 IDs / 101 frames, VFX 6 new IDs / 188 frames all `packed`, 12 inherited effects reused. The palette has 43 colours (the ember-orange ramp was added in #122); `studio_project_info` reports the count.

**All 126 planned Longtime IDs and the 6 new VFX IDs are packed: 132 IDs and 2,198 frames** (the sum of the nine chunk manifests; the previous sync read 131 / 2,126, and `lt_ashen_crown_b` of #123 adds 1 ID and 72 frames). All 33 character-profile IDs (6 NPC, 6 pet, 5 player, 12 mob, 4 boss) have art. Reproduce: `python3 -c "import json,glob; m=[json.load(open(f)) for f in glob.glob('assets/atlases_longtime/web/*/chunk-manifest.json')]; print(sum(len(x['asset_ids']) for x in m), sum(x['frame_count'] for x in m))"` prints `132 2198`. The 102 inherited core entries are accounted for separately. The planned manifest still reads `planned` for every ID because the delivered state is derived from the packs, not stored in it.

| Abode | Armory | Ember Delta | Forms | Interface | Mist Archive | Star Quarry | Trial | Wards |
|---|---|---|---|---|---|---|---|---|
| **17 / 430** | **49 / 136** | 6 / 320 | **5 / 360** | **34 / 98** | 6 / 320 | 6 / 320 | 1 / 72 | **8 / 142** |

The VFX landed in four chunks: Abode `lt_fx_gate_unseal` (12 frames), Armory `lt_fx_impact` (16), Interface `lt_fx_craft` and `lt_fx_stamp` (66), Wards `lt_fx_ward_pulse` and `lt_fx_core_breach` (94). Some effects carry one frame set per palette variant, which is why frame counts exceed clip lengths. Specs are deterministic SpriteFX JSON under `tools/generators/vfx_specs/`; the ledger entry is the `vfx` block of the [Longtime manifest](../assets/manifest_longtime.json).

`lt_kiln_keeper` (NPC) and `lt_ink_marten` (pet) were made with PixelLab before it was retired; the other 30 characters were made with it on 2026-11-22 under the owner's one-day exception (five workers, the last PRs #97, #100, #101, #102 and #104). The owner approved all 32 the same day (see the first section); `lt_ashen_crown_b` was added afterwards from the existing candidate (no PixelLab call) on the owner's choice. **PixelLab is retired again and no one calls it.** Provenance, prompts, PixelLab ids and credits are in `assets/raw/longtime/<id>/provenance.json`; the pipeline is `tools/scripts/build_longtime_characters.py`. New characters now come from the studio's forge (an image sheet from Codex or Antigravity, then pixelisation) and are measured against the approved ones by the lineup ruler.

## Audio state

All **46 core IDs (6 music and 40 effects) have masters.** `tools/.venvs/project/bin/python -I tools/scripts/check_audio_core_masters.py` proves it (format, loop bounds, endpoints, PCM/WAV/input hashes, one ledger record per ID). `check_audio_plan.py` validates the allocation. The extensions reserve 5 music and 10 effects; the Branches wave (3 beds, 3 effects) and the Modes wave (2 beds, 4 effects) are authored and packed, the Characters wave (0+3) stays behind its gate. [Audio design](AUDIO_DESIGN.md) · [Audio manifest](../assets/audio_manifest.json)

| Stage | Beds | Effects | Status |
|---|---|---|---|
| Pilot (`pilot_v1`) and first Wave 2 batch (`wave2_batch1_v1`) | `bgm_dong_phu`, `bgm_hengyue` | 16 | Packed as Ogg/AAC, approved by listening (Windows toolchain). |
| Batch 2 (`wave2_batch2_v1`) | `bgm_blood_sea` | 8 | Packed on the Mac toolchain. **Approved by the owner 2026-11-22** (listened; recorded by hash). |
| Batch 3 (`wave2_batch3_v1`) | `bgm_ancient_god` | 8 | Packed on the Mac toolchain. **Approved by the owner 2026-11-22** (listened; recorded by hash). |
| Batch 4 (`wave2_batch4_v1`) | `bgm_boss_trial`, `bgm_endless` | 8 | Packed on the Mac toolchain. **Approved by the owner 2026-11-22** (listened; recorded by hash). |
| Branches (`branches_v1`, wave 3) | `bgm_mist_archive`, `bgm_ember_delta`, `bgm_star_quarry` | 3 (`sfx_paper_rustle`, `sfx_slag_shift`, `sfx_crystal_ring`) | Authored with the Studio audio engine and packed on the Mac toolchain (2026-11-23). Gate opened by the owner's choice "Dùng câu định hướng làm brief" ([record](../assets/review/audio_gate_decisions.json)); tempo, length, loop and gameplay windows are the author's proposal ([Branches proposal](AUDIO_DESIGN.md#branches-proposal-wave-3-authored-and-approved-2026-11-23), [VERIFICATION](../assets/audio/source/branches_sfx/VERIFICATION.md)). **Approved by the owner 2026-11-23** ("Đã Nghe và duyệt"; recorded by hash as `branches_v1`). |
| Modes (`modes_v1`, wave 4) | `bgm_aftermath`, `bgm_defense` | 4 (`sfx_floor_mark`, `sfx_oath`, `sfx_wave_call`, `sfx_core_crack`) | Authored with the Studio audio engine and packed on the Mac toolchain (2026-11-23). Gate opened by the owner's choice "Coi như đã ký, làm luôn" about the trial round and defense wave milestones ([record](../assets/review/audio_gate_decisions.json)); tempo, length, loop and gameplay windows are the author's proposal ([Modes proposal](AUDIO_DESIGN.md#modes-proposal-wave-4-authored-and-approved-2026-11-23), [VERIFICATION](../assets/audio/source/modes_sfx/VERIFICATION.md)). **Approved by the owner 2026-11-23** ("Duyệt hết"; recorded by hash in `listening_approvals.json`). |

So **all 6 core beds and 40 effects are packed; all 46 are approved by listening (the six Branches cues and the six Modes cues are packed and approved too, stated by the owner on 2026-11-23: 58 approved): 18 earlier, and 28 (batches 2 to 4) stated by the owner on 2026-11-22.** (The catalog used to show four of the beds as "authored" because it read only packs that list one bed under `bgm`; batches 2 to 4 list theirs under `bgms`, and both shapes are read now.)

**Listening approvals file.** [`assets/audio/listening_approvals.json`](../assets/audio/listening_approvals.json) records the approvals a human gave outside the studio's sign-off form, each pinned to its master's SHA-256: 18 cues before the studio existed (`pilot_v1`: 9, `wave2_batch1_v1`: 9; kind `before_studio`) and 40 stated by the owner in chat (28 on 2026-11-22, `wave2_batch2_v1` to `wave2_batch4_v1`; 12 on 2026-11-23, `branches_v1`, "Đã Nghe và duyệt", and `modes_v1`, "Duyệt hết"; kind `owner_statement`, recorded by an agent that only transcribed it). The Review and Audio tabs read it: **58 of 58 are approved**; a master whose hash differs is not covered. The packs' own `evidence.json` still say `human_listening: pending` on purpose, as for the pilot, batch 1, `branches_v1` and `modes_v1` (rewriting them would change pack hashes). Art approvals live in `assets/review/art_approvals.json` (the pack's `directories.approvals`), read the same way by the Review tab. Notes for each unlistened batch are in `assets/audio/source/wave2_{second,third,fourth}_sfx/VERIFICATION.md` and `assets/audio/source/branches_sfx/VERIFICATION.md`; beds are in `assets/audio/bgm_*/`, effect masters in `assets/audio/masters/<batch>/`, ledgers in `assets/audio/source/<batch>/provenance.json`.

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

The tool is called **Pixel Kiln** (the owner chose the name on 2026-11-22); the first project, Tiên Nghịch 2D, is one project it serves. The studio is the app in `studio/` ([guide](../studio/README.md)), driven by the project pack (`studio.project.json` and `studio/schemas/`) and reusable by another project: `node studio/cli.mjs init <dir>` makes one, and a second sample project, `studio/examples/moss-lantern/`, runs the whole loop in a test with the studio code untouched. One connected agent (Claude Code, Codex or Antigravity) is enough. [Plan](STUDIO_PLAN.md) (status at its end) · [tab contract](../studio/ui/README.md) · [MCP guide](../studio/mcp/README.md) · [behaviour specs](../studio/specs/README.md)

**All nine tabs are built.** Run `node studio/serve.mjs --port 4173` (or `node studio/cli.mjs serve`) and open `/studio/`. Without `--project` the server opens the **Projects screen** (#131): a user-level list of projects, open by path, create from a template, live switch; the list lives in your settings folder (`PIXEL_KILN_HOME` or the platform default), never in a project or the repo.

| Tab | What it does |
|---|---|
| Overview | Catalog counts by source and readiness (planned, authored, packed) across core, Longtime, VFX and audio; chunk budgets; importing a planned list from a CSV. |
| Characters | Roster by state, facing and clip viewer with per-frame timing, pivot, rigs and forge experiments, sheet and rig tools. |
| Objects | Tilesets, props, weapons, projectiles, icons and UI: frame editor, registered generators with parameters and a seed, new planned IDs. |
| VFX | The 18 effects frame by frame on floors and over a character, spec, recorded and recomputed audits, provenance, spec rounds, a human 1× readability note, and **Build + audit** (rebuilds the committed spec with the registered SpriteFX adapter into scratch and compares it; never writes into `assets/` or changes a status). |
| Audio | Beds and effects: audition master, Ogg and AAC with loop seams, pictures, sprite map, blind A/B, listening checklist with the human's signature, patch preview. |
| Review | The human inbox for art and audio: before/after pixel diff, agent requests and replies, takes and candidates, region change requests, human-only approve and request-changes, listening sign-offs and the pre-studio approvals. It does **not** yet show the rubric and lineup pictures. |
| Jobs | What agents are doing: their tool calls and the background jobs they started (status, log tail, cost). Read-only. |
| Sandbox | Characters, effects and sound placed in a room; saved scene documents; the three playables hosted as scripted scenes (their pages are in `playables/`). |
| Atlas | Packed pages, a "what if" against the budget, staging, exports for six engines, and the licence and AI-disclosure ledger. |

**Interface** (the UI plan, #125 to #145; the contract is [`studio/ui/README.md`](../studio/ui/README.md)): shared components and `--ui-*` tokens (`components.css`, `tokens.css`, a styleguide at `/studio/ui/styleguide.html`), local fonts (Lora and VT323, OFL, with Vietnamese), three interface modes (abode, Black Ink, Edict Paper) and two densities chosen from the top bar, a pixel viewer shared by Characters, Objects and VFX (integer zoom, grid, wipe compare, keys), the approval seal with `A`/`R`/`C`/`J`/`K`/`U` keys and a real undo in Review, a command palette with actions and a `?` cheat-sheet, and an Overview that reads its voice from the pack (`ui.voice`). The contrast of the two new modes is computed in `studio/ui/tests/theme-modes.test.mjs`.

**Review standings** (`studio/core/standing.mjs`): every frame is **approved** (a human record tied to its hash), **baseline** (legacy shipped art named by the pack's `review.baseline`, recorded in `assets/review/baseline_frames.json` for 91 frame directories: not an approval) or **awaiting review**. `node studio/cli.mjs baseline --check` reports how many baseline directories still match; `--write` freezes a baseline and must never be re-run to make awaiting art look settled.

**MCP: 27 tools** (14 `read`, 13 `author`; no tool needs `pack`, and none approves art, signs a listening, publishes into a shipped atlas or deletes). Counted by listing the tools of a live server at each scope: `node --input-type=module -e "import {StdioClient} from './studio/mcp/stdio_client.mjs'; for (const sc of ['read','author']) {const c=new StdioClient('studio/mcp.mjs',['--project','.','--scope',sc]); await c.request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'x',version:'0'}}); c.notify('notifications/initialized'); console.log(sc,(await c.request(2,'tools/list',{})).result.tools.length); await c.close()}"` prints `read 14` and `author 27`. The tool descriptions and `--self-test` no longer name the first project (this PR): the self-test reads the palette and the catalog from the pack and runs on any project, `examples/moss-lantern` included (it skips the QA and preview checks there, which has no framed asset yet).

- `read`: `studio_guide`, `studio_project_info`, `studio_catalog_search`, `studio_asset_get`, `studio_template_get`, `studio_frame_read`, `studio_preview_render`, `studio_scene_snapshot`, `studio_qa_run`, `studio_diff`, `studio_audio_analyze`, `studio_review_list`, `studio_job_status`, `studio_job_wait`.
- `author`: `studio_asset_plan`, `studio_frames_submit`, `studio_metadata_set`, `studio_sheet_import`, `studio_process`, `studio_rig_bake`, `studio_frame_patch`, `studio_generator_run`, `studio_vfx_build`, `studio_pack` (staging area only), `studio_audio_render`, `studio_review_request`, `studio_review_reply`.

Transports are stdio and loopback HTTP. `GET /mcp/jobs[?limit=n]` lists background jobs as views only (default 50, cap 200). The server sends the project's pixel-art rules (`agentGuidance.rules` in the pack) at initialize, and the stop policy (`policy.stop`: 3 fix rounds, 2 rounds without progress) ends a fix loop and asks the human. [`studio/mcp/SAMPLE_RUNS.md`](../studio/mcp/SAMPLE_RUNS.md) holds four paste-able runs (static asset, animated character, VFX, audio cue) for a fresh agent session, plus pass criteria.

**Command line** (`studio/cli.mjs`): `init <dir>` (never overwrites, never writes outside the directory; writes the three agent configs at read scope), `serve`, `mcp`, `check` (validates the pack, exit 1 on errors), `doctor` (only Node is required), `baseline`. Every command takes `--project <dir>` or `--project=<dir>`; the studio may live outside the project. The README's pack reference is generated from the schema: `node studio/schemas/reference.mjs --check`.

**Animation default** (decision 3 and its amendment in the plan, settled by the bake-off): locomotion from drawn key poses on a **pose sheet**; idle and other small motions from the **rig**; one-sided marks (a scar, a charm) as **pixel patches**, which survive every re-bake. Environment, items and projectiles come from registered generators, VFX from `studio_vfx_build`. PixelLab is retired.

**Known gaps** (also in the studio README), re-read at this sync:

- Exports were opened in Godot 4.7.2, Tiled 1.12.2, Phaser 3.90.0/4.2.1, PixiJS 8.23.0, LibreSprite 1.3 (`.ase`) and Pixelorama 1.2.4 (`.pxo`) on 2026-11-23 (`docs/STUDIO_EXPORT_VERIFICATION.md`); LDtk (including the LDtk map of #118), Unity and Aseprite itself are not opened and are checked by tests against the published formats.
- Atlas PNGs are pixel-equal, not byte-equal, to the Python packer.
- The three playables are hosted as scripted scenes; their art is not in the catalog.
- Nothing was run on Windows.
- The Review tab lacks the rubric and lineup pictures (`git grep -in "rubric\|lineup" -- 'studio/ui/tabs/review/*.mjs' | grep -v test` finds nothing).
- Browser tests need Playwright, which is not installed here: 3 of the `*.test.mjs` files are excluded by `grep -v browser` (`git ls-files 'studio/**/*.test.mjs' 'playables/**/*.test.mjs' | grep -c browser`) and were not run. The UI waves were looked at by hand in the Orchestrator Browser panel; the screenshots were not committed.
- `lt_ashen_crown_b` is only in the manifest, atlas, catalog and Studio; nothing in the game selects it. The owner approved it with its flaws (`generation.json` `known_flaws`).
- Provenance is incomplete on purpose: the Atlas ledger shows `toolPin` as unknown for 216 assets and the seed of one asset as unknown, and 3 planned audio cues as "planned, not produced" (`node studio/core/ledger-cli.mjs`, `summary.fieldStats`). No rights are recorded for those 3 cues.
- `studio/mcp/dryrun.test.mjs` was reported flaky when run in parallel with the rest (#123: it counts `studio-dry-*` directories in the temp directory). It passed in the single full run of this sync.
- The Steam and itch.io disclosure drafts of #113 are drafts of facts for a person to review; they were not checked against the stores' current forms.
- Wave 3 of the ideas plan (12 ideas) is not started, by decision.

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
   tools/.venvs/project/bin/python -I -m unittest discover -s tools/tests -p 'test_*.py'   # 148 tests
   tools/.venvs/project/bin/python -I tools/scripts/check_manifest.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime.py
   tools/.venvs/project/bin/python -I tools/scripts/check_longtime_vfx.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_plan.py
   tools/.venvs/project/bin/python -I tools/scripts/check_audio_core_masters.py
   tools/.venvs/project/bin/python -I tools/scripts/pack_atlases.py --check               # Validated 2854 frames on both profiles
   git ls-files 'studio/**/*.test.mjs' 'playables/**/*.test.mjs' | grep -v browser | sort -u | xargs node --test   # 1039 tests with this PR, 1038 on 4aad1e0 (zsh does not split $(...), hence xargs)
   node studio/smoke-test.mjs               # the studio for this project; takes --project <dir>
   node playables/smoke-test.mjs            # the first project's pages (`node preview-app/smoke-test.mjs` still works through a shim)
   node studio/mcp.mjs --self-test          # must end with `self-test PASSED`; takes --project <dir> (the sample: studio/examples/moss-lantern)
   node studio/cli.mjs check                # the pack is complete (the sample: --project studio/examples/moss-lantern)
   ```

   The browser tests (`*-browser.test.mjs`) need Playwright, which is not installed here and was not run.

4. Browse: `node studio/serve.mjs --port 4173`, then open `http://127.0.0.1:4173/studio/`. The old [Asset Inspector](http://127.0.0.1:4173/studio/?tab=inspector) and **Audio pilot** pages still work. Old `/preview-app/...` URLs still resolve (shim). [Studio app guide](../studio/README.md) · [`preview-app/` shim note](../preview-app/README.md)

5. MCP: `.mcp.json`, `.codex/config.toml` and `.agents/mcp_config.json` start `node studio/mcp.mjs` for Claude Code, Codex and Antigravity with no user-level edits. It serves the 27 tools of the Studio section (the configs committed here use author scope; the ones `studio init` writes use read scope). One connected agent is enough.

6. Checking the approved packs (`pilot_v1`, `wave2_batch1_v1`) needs the exact Windows FFmpeg build (see the toolchain section); batches 2 to 4 check on the Mac build. Build the 6.1.1 toolchain once (`bash tools/scripts/build_ffmpeg_611_mac.sh native`; it writes `tools/.toolchains/ffmpeg-6.1.1/prefix/bin/ffmpeg`, with `prefix-nofma` and `prefix-x86` for the other variants), then run the check with the project Python, because the packer imports NumPy:

   ```sh
   tools/.venvs/project/bin/python -B tools/scripts/build_audio_wave2_batch1_pack.py \
     --ffmpeg tools/.toolchains/ffmpeg-6.1.1/prefix/bin/ffmpeg --check   # fails here: codec files differ, see AUDIO_TOOLCHAIN_MAC.md
   ```

## Backlog for a later user-directed restart

- **Characters:** none of the 33 character-profile IDs (6 NPC, 6 pet, 5 player, 12 mob, 4 boss) is missing: all have art, packed in the chunks above and approved by the owner on 2026-11-22. New characters, if the game design adds any, come from the studio forge with Codex or Antigravity (either one is enough) and are measured against the approved ones by the lineup ruler. The routes and their evidence: [Studio plan](STUDIO_PLAN.md) · [Forge bake-off](FORGE_BAKEOFF.md) · [Asset routing](ASSET_ROUTING.md). Re-derive the count from [`assets/manifest_longtime.json`](../assets/manifest_longtime.json) and the chunk manifests.
- **Longtime VFX:** produced (6 IDs, 188 frames); `lt_fx_craft` was redesigned in #67. The 1× human read (section 8.5) was done by the owner on 2026-11-22: approved (`assets/review/art_approvals.json`). Open: the section 7 design decisions. [VFX design](LONGTIME_VFX.md) · [Art Bible](ART_BIBLE.md) · [Core manifest](../assets/manifest.json)
- **Audio:** core masters are complete and all packed. Human listening for batches 2 to 4 was approved by the owner on 2026-11-22 (`assets/audio/listening_approvals.json`). The Branches wave (3 BGM, 3 SFX) is packed and approved by the owner (2026-11-23); the Modes wave (2 BGM, 4 SFX) is packed and approved by the owner (2026-11-23); the Characters extension (3 SFX) stays behind its design gate. [Audio design](AUDIO_DESIGN.md)
- **Studio:** shell, all nine tabs, the Projects screen, the forge, the audio engine, the 27-tool MCP, the CLI, the sample project and the five-wave UI plan are on `main`; P0 to P6 are done. Left: wave 3 of the ideas plan (12 ideas, only on real need) and the known gaps listed in the Studio section. [Studio plan](STUDIO_PLAN.md) · [MCP capabilities](MCP_CAPABILITIES.md)
- **Asset work:** use the versioned [routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md), [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) and [AssetCat](../.agents/skills/tien-nghich-assetcat/SKILL.md) skills for source routing, palette/outline checks and rights records.

**Update 2026-11-22 (lt_ashen_crown_b).** On the owner's word "Chọn B và bản hiện tại", candidate B of `lt_ashen_crown` ships as the separate ID `lt_ashen_crown_b` (72 frames, `forms` chunk) beside the unchanged `lt_ashen_crown`: 126 planned Longtime IDs, 5 player forms. The `forms` atlas is repacked (360 frames); the 288 earlier frames match the old atlas pixel for pixel and field for field. Raw frames come from `assets/candidates/lt_ashen_crown_b/` unchanged; no PixelLab call was made.
