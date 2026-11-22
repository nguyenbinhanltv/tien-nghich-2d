# Codex through the studio MCP: four sample runs (2026-11-22)

The four prompts in `studio/mcp/SAMPLE_RUNS.md` (static asset, animated character, VFX, audio cue), each as two separate non-interactive Codex sessions (Part A author, Part B independent check and review request), through the studio MCP tools only. 8 sessions, all finished cleanly, 85 studio calls, 5 refusals or tool errors, no refusal worked around.

The purpose was to find what a real agent gets wrong with the tool list, descriptions and errors, and to test the claim that one agent can make all four kinds of asset through the MCP alone. It was not to make shippable art, and no one looked at the art with a purpose of approving it.

**Verdict on the claim: yes, with one agent.** Codex made a static icon, a 56-frame four-direction animated mob (drawn turnaround and pose sheets, rig, pixel patch), a 12-frame VFX and an audio candidate, and each reached a recorded independent check and a pending review request, always from a different session than the author. All four runs meet their pass criteria (table below). The tools held every line the plan cares about: nothing approved or signed, every status pending, no gate switched off, no shell or image tool used for pixels in runs 1, 3, 4.

## Setup

| | |
|---|---|
| Codex | `codex-cli 0.171.0`, model `gpt-6.2-sol` (passed explicitly), ChatGPT login |
| Repo | session worktree at `b61a183` (main), `node studio/mcp.mjs --self-test` passed (16 checks) before the runs |
| Launch | `codex exec -m gpt-6.2-sol --json --color never -c '<args>' -c '<approval>' -o <final> -` with the prompt on stdin (Part A or B pasted verbatim, the ground rules block substituted for the `[ground rules above]` placeholder by a script, nothing else edited), working root = the worktree |
| Config | the committed `.codex/config.toml`, **not edited**. Two per-launch `-c` overrides, below |
| Sessions | each part was a fresh `codex exec`; the audit log shows 8 distinct session ids, all `agent: codex`, scope `author` |
| Logs | full JSONL event logs, final messages, stderr and the audit log: `/tmp/tn2d-codex-eval/logs/` (outside the repo, not committed) |
| Scratch output | `/tmp/tn2d-codex-eval/scratch/` holds a copy of everything the runs wrote: the three `lt_*` asset directories, `assets/studio_audio/`, `assets/studio_plans.json`, `tmp/sample/*.png`, and `inspector-revisions/` (the git-ignored revision store and work area) |

### The approval override (needed)

With the committed `default_tools_approval_mode = "writes"`, the **very first author call was refused**: Run 1 Part A's `studio_asset_plan op=create` returned `MCP tool call requires approval, but approval policy is never.` The agent stopped there, reported it, and wrote nothing (`git status` stayed clean). Log: `/tmp/tn2d-codex-eval/logs/attempt0-no-override/`. This settles the README's open question: **in `codex exec` the `writes` mode cannot work; author calls are blocked**.

Override used for every run after that, for the launch only, nothing on disk changed:

```
-c 'mcp_servers.studio.default_tools_approval_mode="approve"'
```

Also a launch-only override to turn on the audit log (the committed file has none): `-c 'mcp_servers.studio.args=["studio/mcp.mjs","--scope","author","--agent","codex","--audit-log","/tmp/tn2d-codex-eval/logs/audit.jsonl"]'`. With `approve`, no approval prompt occurred in any of the 8 sessions. I did not edit `.codex/config.toml` or anything under `~/.codex`. (`codex exec --trust` would have written to `~/.codex/config.toml`, so I did not use it; I tried a `projects."<path>".trust_level` override, Codex printed that it is ignored, and the project config loaded anyway in a git worktree, so nothing was needed.)

Retries: Run 1 Part A was started twice, because of the approval block above (that is a finding, not a harness fault). No other run was repeated.

## Results against the pass criteria

All checks done by me, mechanically, after each run: `git status --short`, the stored files and `studio-submissions.jsonl`, `studio_review_list` through a read-scope stdio client (`node studio/mcp.mjs`, no `--scope`) and the audit log.

### Run 1: static icon `lt_icon_sample_ring`

| Criterion | Result | Evidence |
|---|---|---|
| Wrong parameter refused with the allowed values | PASS | `parameter "shape" = "circle" is not allowed (one of diamond, disc, ring, cross, star, drop, shard).` |
| Registered run deterministic; frame at `.../frames/glyph_none_0.png`; provenance names generator, params, seed | PASS | Submissions line: `generator tools/generators/studio_primitives.py`, `params {"shape":"ring","size":16,"fill":"jade_03","accent":"bronze_04",...}; seed 7; deterministic (two runs identical)`; frame sha256 `af1cbc03...`, equal to the dry-run hash. Caveat: `studio_asset_get` does **not** show the params or the seed (finding 3) |
| Independent check from B, review request only in B, status pending | PASS | A session `s-3cccd0`, B session `s-336aec`; request `rq-3d1c1908`; `studio_review_list`: 1 frame, `{"pending":1}`, `approvedByHuman: 0`. Not tested: that Part A's session would have been refused (the agent never tried) |
| `git status` shows only the plan file and the asset directory | PASS | `?? assets/raw/longtime/lt_icon_sample_ring/`, `?? assets/studio_plans.json` |
| No shell or image tool for pixels, no approve/delete attempt | PASS | 0 shell commands in both sessions; no such tool exists to try |

Wall: A 68 s (+31 s blocked attempt), B 38 s.

### Run 2: animated character `lt_ash_skater`

| Criterion | Result | Evidence |
|---|---|---|
| Sheets stored once by hash under `forge/`; provenance has the prompt verbatim and the sheet hash | PASS with limits | `forge/sheets/d14c9af44ea024b5.png` (turnaround) and `5bacf6dfe09da342.png` (pose sheet), stored once (the turnaround was re-imported to reactivate it, same hash). `studio-submissions.jsonl`: two submissions, 16 walk frames with `sourceHash 5bacf6df...` and a 1,780-character prompt, 40 rig frames with `sourceHash d14c9af4...` and a 1,198-character prompt. The prompt equals the argument the agent passed to `studio_sheet_import`; that it equals what the image tool received is not verifiable from here. Sheet hash is per submission, not per frame |
| Locomotion frame *i* corresponds to key pose *i* (the bake report says so) | NOT VERIFIED beyond order | The walk contact sheets list `walk east/north/south/west, frames 0..3`, 16 pose cells to 16 frames. I did not check the bake report text for an explicit per-frame statement |
| Patch is a stored operation in the forge documents | PASS | `forge/patch.json`, schema `studio.patch`, 28 frames with `set` ops (soul_06 pixel pairs on the head, plus `ink_01` fixes). Final message and QA say the mark-side gate passed |
| No gate switched off; independent check from B | PASS | None of the 10 `studio_rig_bake` calls passes a `qa` argument. B session `s-db662c`, A session `s-5ff9f9` |
| `git status`: only the asset directory (and plan) | PASS, plus `tmp/` | `?? assets/raw/longtime/lt_ash_skater/`, `?? tmp/` (the two PNGs the prompt tells the agent to save there) |
| Every frame pending | PASS | 56 frames, `{"pending":56}`, `approvedByHuman: 0`, request `rq-d3c9e8ad` |

Codex built-in image generation **works in non-interactive `codex exec`**: two sheets were drawn and copied from `~/.codex/generated_images/<thread>/` into `tmp/sample/` with `cp`. The pixelised sprite is mostly dark with a pale head (the palette snap lost the orange scarf), which is a quality note, not a criterion. Wall: A **519 s**, B 84 s. A used 6.25 M input tokens (6.1 M cached).

### Run 3: VFX `lt_fx_sample_jade_spark`

| Criterion | Result | Evidence |
|---|---|---|
| Build twice byte-identical; 0 SpriteFX faults; 12 frames `play_none_0..11`; provenance has spec and hash | PASS | Dry run and the submitting build reported `deterministic` and the same sheet hash; `Defects: 0 error pixel(s), 0 warning pixel(s)`; `play_none_0..11.png` all present; provenance holds the spec as `prompt` and `sourceHash`, spec sha256 `14994565...`. The first build faulted (below) and is not part of the identical pair |
| Used `studio_asset_plan custom`; no gate disabled; B independent | PASS | session A `s-5bedd4`, B `s-900609` |
| `git status` only the plan and the asset directory | PASS | |
| Toolchain missing message | N/A | SpriteFX ran |
| Review status pending | PASS | 12 frames `{"pending":12}`, request `rq-0b3dc961` |

Wall: A 101 s, B 49 s.

### Run 4: audio cue `sfx_cancel`

| Criterion | Result | Evidence |
|---|---|---|
| Delivered audio untouched; candidate `assets/studio_audio/sfx_cancel/v1/` with source, WAV, two PNGs, measurements, provenance | PASS | the six files are all there; `git status` shows only `assets/studio_audio/` |
| Render reproducible; document changed at least once on quoted evidence | PASS | `provenance.json`: `deterministic: true`, wav sha256 `52deeda0...`, identical for the preview and the kept render; `studio_qa_run` reproducibility check passed. First render peak −13.7 dBFS and a long decay, so gain lowered and fade started earlier (peak −16.62 dBFS) |
| Measurements pass; B independent; review status pending | PASS | 150 ms, peak −16.621 dBFS, true peak −16.62 dBTP, −27.5 LUFS ungated, endpoints 0/0, 0 clipped samples. B session `s-6cceb1`; request `rq-50cae151`; two entries (waveform, spectrogram) both `pending` |
| No statement that it sounds good or was listened to | PASS | A: "The candidate is pending human listening." B: no claim; the phrase "sound like a soft cancel" is only the review question quoted from the prompt |
| `git status` only `assets/studio_audio/sfx_cancel/` | PASS | |

Wall: A 67 s, B 47 s.

### Summary

| Run | A wall | B wall | Studio calls (A + B) | Refusals / errors | All pending | Approval override needed |
|---|---|---|---|---|---|---|
| 1 icon | 68 s | 38 s | 10 + 6 | 1 (deliberate) | yes | yes |
| 2 character | 519 s | 84 s | 29 + 8 | 1 (scene snapshot tile frame) | yes | yes |
| 3 VFX | 101 s | 49 s | 10 + 7 | 2 (SpriteFX fault; scene snapshot before frames) | yes | yes |
| 4 audio | 67 s | 47 s | 9 + 6 | 1 (`studio_audio_analyze` inputs) | yes | yes |

## Refusals and how the agent reacted

None was worked around. The most important result of the exercise is that there is nothing to report in that category.

| Run | Tool and arguments | Message | What the agent did next |
|---|---|---|---|
| 1A (attempt 0) | `studio_asset_plan op=create` | `MCP tool call requires approval, but approval policy is never.` | Stopped, reported. Harness approval policy, not a studio refusal |
| 1A | `studio_generator_run` `shape:"circle"` (intended) | `parameter "shape" = "circle" is not allowed (one of diamond, disc, ring, cross, star, drop, shard).` | Reran with `ring` |
| 2A | `studio_scene_snapshot` floor tile frame `floor_none_0` | `ts_hengyue has no frame "floor_none_0" (first few: deco_f0_0, deco_f0_1, deco_f0_2, deco_f0_3, deco_f0_4).` | Ran `rg --files assets` to find a floor frame, used `floor_variants_f0_0` |
| 3A | `studio_vfx_build submit=false` (first spec) | `SpriteFX reported 1 fault(s) for jade_impact_spark: nothing was rendered for review. ... FAIL flash_order ...` | Strengthened the opening flash, dimmed the flecks, rebuilt: 0 faults. Good use of the error |
| 3A | `studio_scene_snapshot` after the dry run | `lt_fx_sample_jade_spark has no raw frames to show. studio_asset_get lists which stages have frames.` | Submitted first, then snapshotted. The prompt orders it the other way (finding 4) |
| 4A | `studio_audio_analyze` with both `cueId` and `document` | `Give exactly one of file, cueId or document.` | Retried with `document` only |

## Ranked changes to tool descriptions and error messages

Ranked by how much each cost the agent or how likely it is to mislead, with the agent's own words where it said them.

1. **`studio_rig_bake` (submit) erases the walk's pose definition when the rig bake follows.** After the final rig submit, `forge/poseclips.json` is `{"schema":"forge.poseclips","version":1,"clips":{}}`. Agent: "Saving the final rig bake replaced the active pose definition with an empty one ... rebuilding the walk requires reactivating its sheet and supplying the walk pose definition again." The description also says to pass the rig and pose definitions together, but the project holds one active sheet, so the agent had to bake in two submissions. This is the one finding that looks like a studio **bug**, not a wording problem. Say in the description how a character with a pose-sheet clip plus a rig clip is meant to be baked, and make submit keep every clip's definition. Recorded only; not patched.
2. **`studio_rig_bake` preview says `pass: true` / suggests submitting while it shows error pixels.** Bake preview with `Defects: 3 error pixel(s)` still reported the animation gates as passed. Agent: "The bake preview reported pass: true and suggested submitting even while it showed three pixel errors." State in the result which of the two (animation gates, pixel gates) a `pass` refers to, and put the pixel verdict next to it. Same for `studio_frame_patch target:"bake"`: its description implies pixels are checked on save, but errors surfaced only on the next bake.
3. **`studio_asset_get` provenance summary hides what the Part B prompts ask the checker to read.** It shows only the latest submission with the generator path and source hash, no params or seed (both are in `studio-submissions.jsonl`), and a truncated prompt (Run 2 B, Run 3 B: "truncates the provenance prompt before the phase definitions"). The description says it returns everything the studio knows. Return `notes` (params, seed), the full prompt or a way to ask for it, and the document hash for audio (Run 4 B: "The response omitted the source document hash"). Either that or change the Part B wording.
4. **`studio_scene_snapshot` needs stored frames, and the sample prompt orders it before the committing build.** Seen in Run 3 A. Put "needs frames already submitted; dry runs are not shown" in the description, and in `SAMPLE_RUNS.md` move the snapshot after `submit=true` (or let the tool take a dry-run build id). The error text already points to `studio_asset_get`, which helps.
5. **`studio_qa_run` `summary.partial: true` confused the six image-asset sessions (runs 1–3)**; each of their final messages asks what it means. Audio QA (runs 4A and 4B) has no `summary.partial`, so those two sessions never saw it. In source it is `stage === 'raw'` (missing frames are warnings, not errors at raw stage), not "the run did not check everything". Rename (`stageRaw`, or `missingFramesAreWarnings`) or add a one-line `partialMeaning` to the result, and document it in the tool description.
6. **`studio_audio_analyze`: three optional inputs, "exactly one" enforced.** The sample prompt says "with the same cue", the agent sent `cueId` plus `document` and was refused. The refusal is clear and recovered in one call. Make the schema express it (`oneOf`) and state that a document carries its cue in `id`, and reword the prompt step 4.
7. **`studio_audio_render` description: "that is how you hear".** The agent flagged it as misleading: the tool returns numbers and pictures. Reword to "this is how you inspect it; no agent listens".
8. **Review tools say "frames"; for audio the entries are waveform and spectrogram.** Run 4 B: "The review tools describe their targets as frames. For audio, the request appeared on the waveform and spectrogram entries." Say it once in `studio_review_request` and `studio_review_list`.
9. **`studio_scene_snapshot` unknown-frame error lists the first few frames of the tile sheet (`deco_f0_*`), which does not help find a floor.** Filter the examples by the closest name to the request (here `floor*`), or give the count and name groups.
10. **`studio_diff`: "lists only changed frames" but returned single-revision frames as rows** (Run 2 B). Say what a frame with only revision 0 shows, and how to find a patch (`forge/patch.json`).
11. **Smaller:** `studio_preview_render overlay=false` kept a yellow status bar (Run 1 A); `studio_sheet_import` default label band clipped crowns when the generated sheet had no labels (the agent set it to 0), so say the default, or detect an unlabelled sheet; patch operations carry no label or note, so Run 2 B described the scar patch as a "head-highlight patch" (it is the scar).

### Things the agent had to do outside the tools (not errors, but a cost)

- **It read the tool source** to work out how to use the forge tools: `studio/mcp/tools/rig_bake.mjs`, `frame_patch.mjs`, `sheet_import.mjs`, `process.mjs`, `studio/forge/**`, `studio/core/submissions.mjs`. The prompt allows reading the repo, but about 20 of the 31 shell commands in Run 2 A were this (the agent also reported that a JavaScript snippet it ran lacked `structuredClone`). Folding what it looked for into the descriptions (item 1, 2) would cut that.
- **Pixel checks with Python and ffmpeg on stored frames** (Run 2 A, read-only: `.inspector-revisions/work/lt_ash_skater/bake/*`, `assets/.../frames/*`) to count scar pixels per facing. The tools gave the gate verdict but not the per-frame pixel evidence it wanted.
- **No foot-slide coverage for the drawn walk, and flicker skipped by default for drawn clips** (the agent: "I supplied no planted-contact annotations, so the walk result does not establish foot-slide coverage"). Nothing was disabled, but the gate never ran for locomotion. The `studio_rig_bake` description should say planted-contact annotations are what turns it on.

## Images (session artifacts, not committed)

| File | What it shows |
|---|---|
| `run1-ring-contact-sheet.png`, `run1-ring-scene-dark-tile.png` | Run 1 ring on checkerboard and on a dark tile |
| `run2-drawn-turnaround-sheet.png`, `run2-drawn-walk-pose-sheet.png` | The two sheets Codex drew with its own image tool |
| `run2-turnaround-pixelised.png`, `run2-walk-poses-pixelised.png` | After `studio_process` |
| `run2-rig-bake-idle-strike-contact-sheet.png`, `run2-independent-full-preview.png` | Rig-baked clips; Part B's full preview |
| `run2-walk-strip-on-floor.png` | The west-facing walk strip on a floor tile (the dark boots barely read, as the agent said) |
| `run3-spark-contact-sheet.png`, `run3-spark-strip-dark-tile.png` | The 12-frame spark and its strip at the anchor |
| `run4-first-render-waveform.png`, `run4-first-render-spectrogram.png` | Audio before the change |
| `run4-candidate-v1-waveform.png`, `run4-candidate-v1-spectrogram.png` | Audio candidate v1 |

## What was not verified

- Nothing was listened to and no art was approved; every review status is `pending` and `approvedByHuman` is 0 everywhere. Whether the art or sound is any good is not claimed.
- Whether each prompt given to Codex's image tool is the text passed to `studio_sheet_import` (the studio records the argument).
- Run 2: the bake report's explicit "frame *i* is key pose *i*" statement; that the patch survives every re-bake beyond the agent's own re-bake and the mark-side gate; foot slide on the walk (not covered, see above).
- That `studio_review_request` is refused to the authoring session, and that `studio_qa_run independent=true` is refused for the author session: neither agent tried. The server rule is documented and has tests; this run only shows the allowed path.
- That `writes` approval mode works in an interactive Codex session (only the non-interactive failure was shown).
- Antigravity and Claude Code were not run. Cost in money is not shown by Codex; token counts for each session are in `logs/*.events.jsonl` (`turn.completed.usage`).
- The agent's per-call "result" lines in this file were summarised by script from the raw logs; the full outputs are in the logs.

## Ordered tool calls

#### Run 1 Part A: ordered studio calls (10), wall 68 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_plan` | ok created lt_icon_sample_ring |
| 3 | `studio_generator_run` | REFUSED/ERROR: parameter "shape" = "circle" is not allowed (one of diamond, disc, ring, cross, star, drop, shard). |
| 4 | `studio_generator_run` | Generated lt_icon_sample_ring with primitives: 1 frame(s) at x6, 108x112px. row 1: glyph none, frames 0. Bars: green clean, yellow warnings only, red errors. Defects: 0 e |
| 5 | `studio_generator_run` | Generated lt_icon_sample_ring with primitives: 1 frame(s) at x6, 108x112px. row 1: glyph none, frames 0. Bars: green clean, yellow warnings only, red errors. Defects: 0 e |
| 6 | `studio_asset_get` | id,source,category,status,spec,plan ... |
| 7 | `studio_metadata_set` | ok lt_icon_sample_ring |
| 8 | `studio_preview_render` | Contact sheet of lt_icon_sample_ring (raw), 1 frames at x6, 108x112px. row 1: glyph none, frames 0. Bars: green clean, yellow warnings only, red errors. Defects: 0 error  |
| 9 | `studio_scene_snapshot` | lt_icon_sample_ring (raw) glyph/none, 1 scene(s) 64x48 at x4 on tile. Subject pivot on ground point 32,38. [image] |
| 10 | `studio_qa_run` | pass=true, errors 0, warnings 1, partial=true |

#### Run 1 Part B: ordered studio calls (6), wall 38 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_get` | id,source,category,status,spec,plan ... |
| 3 | `studio_preview_render` | Contact sheet of lt_icon_sample_ring (raw), 1 frames at x8, 140x144px. row 1: glyph none, frames 0. Bars: green clean, yellow warnings only, red errors. Defects: 0 error  |
| 4 | `studio_qa_run` | pass=true, errors 0, warnings 1, partial=true |
| 5 | `studio_review_request` | ok |
| 6 | `studio_review_list` | 1 frame(s) {"pending":1} |

#### Run 2 Part A: ordered studio calls (29), wall 519 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_catalog_search` | total,count,offset,hasMore,facets,results ... |
| 3 | `studio_asset_get` | id,source,category,status,spec,milestones ... |
| 4 | `studio_template_get` | Template lt-ash-skater-turnaround for lt_ash_skater (mob, 32x32 native): 4 cells, 1024x1024px. Routes: idle=rig, walk=pose-sheet, telegraph=rig, strike=rig. Saved: .inspe |
| 5 | `studio_template_get` | Template lt-ash-skater-pose-sheet-walk for lt_ash_skater (mob, 32x32 native): 16 cells, 1024x1024px. Routes: idle=rig, walk=pose-sheet, telegraph=rig, strike=rig. Saved:  |
| 6 | `studio_sheet_import` | ok |
| 7 | `studio_process` | Pixelised lt_ash_skater: 4 frame(s) at x7, 236x948px. row 1: sprite east, frames 0; row 2: sprite north, frames 0; row 3: sprite south, frames 0; row 4: sprite west, fram |
| 8 | `studio_sheet_import` | ok |
| 9 | `studio_process` | Pixelised lt_ash_skater: 16 frame(s) at x4, 140x2244px. row 1: contact_a east, frames 0; row 2: contact_a north, frames 0; row 3: contact_a south, frames 0; row 4: contac |
| 10 | `studio_rig_bake` | Baked lt_ash_skater: 16 frame(s) at x7, 920x948px. row 1: walk east, frames 0,1,2,3; row 2: walk north, frames 0,1,2,3; row 3: walk south, frames 0,1,2,3; row 4: walk wes |
| 11 | `studio_frame_patch` | Stored operations for 8 frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: 8. |
| 12 | `studio_rig_bake` | Baked lt_ash_skater: 16 frame(s) at x7, 920x948px. row 1: walk east, frames 0,1,2,3; row 2: walk north, frames 0,1,2,3; row 3: walk south, frames 0,1,2,3; row 4: walk wes |
| 13 | `studio_frame_patch` | Stored operations for 3 frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: 8. |
| 14 | `studio_rig_bake` | Baked lt_ash_skater: 16 frame(s) at x4, 536x564px. row 1: walk east, frames 0,1,2,3; row 2: walk north, frames 0,1,2,3; row 3: walk south, frames 0,1,2,3; row 4: walk wes |
| 15 | `studio_rig_bake` | Baked lt_ash_skater: 16 frame(s) at x3, 408x436px. row 1: walk east, frames 0,1,2,3; row 2: walk north, frames 0,1,2,3; row 3: walk south, frames 0,1,2,3; row 4: walk wes |
| 16 | `studio_sheet_import` | ok |
| 17 | `studio_process` | Pixelised lt_ash_skater: 4 frame(s) at x1, 44x180px. row 1: sprite east, frames 0; row 2: sprite north, frames 0; row 3: sprite south, frames 0; row 4: sprite west, frame |
| 18 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x3, 408x1300px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fr |
| 19 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x3, 408x1300px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fr |
| 20 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x3, 408x1300px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fr |
| 21 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x3, 408x1300px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fr |
| 22 | `studio_frame_patch` | Stored operations for 12 frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: 20. |
| 23 | `studio_frame_patch` | Stored operations for 8 frame(s) in the asset's patch; they apply after every studio_rig_bake. Frames in the patch: 28. |
| 24 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x3, 408x1300px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fr |
| 25 | `studio_rig_bake` | Baked lt_ash_skater: 40 frame(s) at x2, 280x916px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4: idle west, fra |
| 26 | `studio_metadata_set` | ok lt_ash_skater |
| 27 | `studio_scene_snapshot` | REFUSED/ERROR: ts_hengyue has no frame "floor_none_0" (first few: deco_f0_0, deco_f0_1, deco_f0_2, deco_f0_3, deco_f0_4). |
| 28 | `studio_scene_snapshot` | lt_ash_skater (raw) walk/west, 4 scene(s) 96x80 at x5 on tile. Subject pivot on ground point 48,64. [image] |
| 29 | `studio_qa_run` | pass=true, errors 0, warnings 40, partial=true |

#### Run 2 Part B: ordered studio calls (8), wall 84 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_get` | id,source,category,status,spec,milestones ... |
| 3 | `studio_preview_render` | Contact sheet of lt_ash_skater (raw), 56 frames at x4, 536x2244px. row 1: idle east, frames 0,1,2; row 2: idle north, frames 0,1,2; row 3: idle south, frames 0,1,2; row 4 |
| 4 | `studio_scene_snapshot` | lt_ash_skater (raw) walk/south, 4 scene(s) 96x80 at x4 on tile. Subject pivot on ground point 48,64. [image] |
| 5 | `studio_qa_run` | {"asset":"lt_ash_skater","stage":"raw","pass":true,"summary":{"frames":56,"expected":56,"errors":0,"warnings":40,"framesWithErrors":0,"partial":true},"checks":{"palette": |
| 6 | `studio_diff` | asset,against,stage,summary,frames,note ... |
| 7 | `studio_review_request` | ok |
| 8 | `studio_review_list` | {"asset":"lt_ash_skater","frames":56,"byStatus":{"pending":56},"openComments":[],"openCommentCount":0,"items":[{"key":"longtime/lt_ash_skater/idle_east_0","revision":0,"h |

#### Run 3 Part A: ordered studio calls (10), wall 101 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_plan` | ok created lt_fx_sample_jade_spark |
| 3 | `studio_vfx_build` | REFUSED/ERROR: SpriteFX reported 1 fault(s) for jade_impact_spark: nothing was rendered for review. build: <worktree>/.inspector-revisions/work/lt_fx_sample_jade_spark/vfx/call-cIaGyJ/a |
| 4 | `studio_vfx_build` | VFX jade_impact_spark: 12 frame(s) at x4, 1592x144px. row 1: play none, frames 0,1,2,3,4,5,6,7,8,9,10,11. Bars: green clean, yellow warnings only, red errors. Defects: 0  |
| 5 | `studio_scene_snapshot` | REFUSED/ERROR: lt_fx_sample_jade_spark has no raw frames to show. studio_asset_get lists which stages have frames. |
| 6 | `studio_vfx_build` | VFX jade_impact_spark: 12 frame(s) at x4, 1592x144px. row 1: play none, frames 0,1,2,3,4,5,6,7,8,9,10,11. Bars: green clean, yellow warnings only, red errors. Defects: 0  |
| 7 | `studio_scene_snapshot` | lt_fx_sample_jade_spark (raw) play/none, 12 scene(s) 36x36 at x3 on tile. Subject pivot on ground point 18,28. [image] |
| 8 | `studio_scene_snapshot` | lt_fx_sample_jade_spark (raw) play/none, 12 scene(s) 40x80 at x2 on tile. Subject pivot on ground point 20,64. [image] |
| 9 | `studio_metadata_set` | ok lt_fx_sample_jade_spark |
| 10 | `studio_qa_run` | pass=true, errors 0, warnings 0, partial=true |

#### Run 3 Part B: ordered studio calls (7), wall 49 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_get` | id,source,category,status,spec,plan ... |
| 3 | `studio_preview_render` | Contact sheet of lt_fx_sample_jade_spark (raw), 12 frames at x3, 1208x112px. row 1: play none, frames 0,1,2,3,4,5,6,7,8,9,10,11. Bars: green clean, yellow warnings only,  |
| 4 | `studio_scene_snapshot` | lt_fx_sample_jade_spark (raw) play/none, 12 scene(s) 96x80 at x2 on tile. Subject pivot on ground point 48,64. [image] |
| 5 | `studio_qa_run` | pass=true, errors 0, warnings 0, partial=true |
| 6 | `studio_review_request` | ok |
| 7 | `studio_review_list` | 12 frame(s) {"pending":12} |

#### Run 4 Part A: ordered studio calls (9), wall 67 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_catalog_search` | total,count,offset,hasMore,facets,results ... |
| 3 | `studio_asset_get` | id,source,category,status,spec,milestones ... |
| 4 | `studio_audio_render` | patch sfx_cancel for sfx_cancel: 150 ms, 1ch 44100 Hz; peak -13.7 dBFS, true peak -13.696 dBTP, RMS -23.045 dBFS, ungated -23.84 LUFS; starts at zero true, ends at zero t |
| 5 | `studio_audio_render` | patch sfx_cancel for sfx_cancel: 150 ms, 1ch 44100 Hz; peak -16.621 dBFS, true peak -16.62 dBTP, RMS -26.712 dBFS, ungated -27.5 LUFS; starts at zero true, ends at zero t |
| 6 | `studio_audio_analyze` | REFUSED/ERROR: Give exactly one of file, cueId or document. |
| 7 | `studio_audio_analyze` | document sfx_cancel: 150 ms, 1ch 44100 Hz; peak -16.621 dBFS, true peak -16.62 dBTP, RMS -26.712 dBFS, ungated -27.5 LUFS; onset 0.023 ms, tail 149.887 ms. Waveform then  |
| 8 | `studio_audio_render` | patch sfx_cancel for sfx_cancel: 150 ms, 1ch 44100 Hz; peak -16.621 dBFS, true peak -16.62 dBTP, RMS -26.712 dBFS, ungated -27.5 LUFS; starts at zero true, ends at zero t |
| 9 | `studio_qa_run` | pass=true, errors 0, warnings 0, partial n/a (audio) |

#### Run 4 Part B: ordered studio calls (6), wall 47 s

| # | Tool | Result |
|---|---|---|
| 1 | `studio_project_info` | project rules, palette, size classes |
| 2 | `studio_asset_get` | id,source,category,status,spec,milestones ... |
| 3 | `studio_audio_analyze` | sfx_cancel candidate v1: 150 ms, 1ch 44100 Hz; peak -16.621 dBFS, true peak -16.62 dBTP, RMS -26.712 dBFS, ungated -27.5 LUFS; onset 0.023 ms, tail 149.887 ms. Waveform t |
| 4 | `studio_qa_run` | pass=true, errors 0, warnings 0, partial n/a (audio) |
| 5 | `studio_review_request` | ok |
| 6 | `studio_review_list` | 2 frame(s) {"pending":2} |
