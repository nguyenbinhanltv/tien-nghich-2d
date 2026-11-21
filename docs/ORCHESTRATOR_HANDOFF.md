# Orchestrator handoff

## Resume point

Both schedules are paused until the user explicitly restarts them. A fresh clone recovers the committed assets, manifests and tools from GitHub. Keep separate records for private Inspector revisions and local session state.

[PR #50](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/50) shipped at `b6abede08b71f0e617c61cb013f7ea25c7c7b257`. Its seven web chunk manifests contain **93 Longtime IDs and 306 frames**. Counts below are IDs / frames. The 102 inherited core entries are accounted for separately.

The first two PixelLab characters, `lt_kiln_keeper` (NPC) and `lt_ink_marten` (pet), add 64 frames to Abode (now 6 IDs / 98 frames, 95 IDs / 370 frames overall). Provenance, prompts, PixelLab ids and credits are in `assets/raw/longtime/<id>/provenance.json`; the pipeline is `tools/scripts/build_longtime_characters.py`. The art review is open: the marten's pale left-ear notch reads in south and east only.

| Abode | Armory | Ember Delta | Interface | Mist Archive | Star Quarry | Wards |
|---|---|---|---|---|---|---|
| **6 / 98** | 48 / 120 | 1 / 24 | **32 / 32** | 1 / 24 | 1 / 24 | 6 / 48 |

## Approved Hằng Nhạc audio on main

The approved Động Phủ pilot (one bed and eight cues) remains the listening reference. The first Wave 2 sub-batch adds one chapter bed and eight cues. The two published sources are recoverable independently.

| Source branch | Exact commit and evidence |
|---|---|
| [Hằng Nhạc score](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/skills-arena-prs/hengyue-score) | [55dd32c9625a5e213312380ca01992d64ba60db6](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/55dd32c9625a5e213312380ca01992d64ba60db6). Two byte-identical renders. Stereo PCM16 at 44,100 Hz, loop [0, 3087000) frames, 70 s, −21.66 LUFS and −7.06 dBTP. |
| [Wave 2 effects](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/ember-delta-tiles/wave2-first-sfx) | [b20ef09b802f84c207d895db0752090eeb62db1d](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/b20ef09b802f84c207d895db0752090eeb62db1d). Eight mono masters reproduced twice. Step, evade, cast, bolt, light tell, focus, cancel and deny have individual PCM and WAV hashes. |

The user heard and approved the Hằng Nhạc Ogg/AAC A/B. [PR #52](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/52) merged audio head `b27eb12c34a9d0786d535b750993dc3140b54a04` into `main` at `c1db17870829ae4cdadf310786567efb8b99489e`. The current package is [assets/audio/packs/wave2_batch1_v1](../assets/audio/packs/wave2_batch1_v1).

Independent technical QA rebuilt all five codec files byte-for-byte, verified all 23 pilot files and matched the portable audition to the decoded audio across three loop seams and 16 solo SFX excerpts. The listening status in the QA comment predates the user’s approval. [Exact-head QA on #52](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/52#issuecomment-7068634787)

To replay the comparison, download the WAV and timing key from the [portable audition at `cb0181eb463848efec0bec43ffbef41cfa2b7e29`](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/cb0181eb463848efec0bec43ffbef41cfa2b7e29/audition). The master, Ogg and AAC seams occur at 4.0, 12.8 and 21.6 seconds, followed by all eight effects solo and over the bed.

| File under `audition/` | SHA-256 of Git blob contents |
|---|---|
| `wave2_batch1_audition.wav` | `d998e86a3bd1451c449abc299ceea6c807ab194dd4396b8c87a7ca7b9cc832e6` |
| `wave2_batch1_audition_timing.json` | `e2aa0fd7ffc501b7fb80f50eb0e205b2369bb88c87ea056b69f1207936e529e2` |
| `wave2_batch1_audition_timing.md` | `f5d6f310938ceea91e44b47b8bd2da902fb9fdc66543e8ce7b50e3670ea7b2cf` |

## Bring up a fresh machine

1. Install Git, GitHub CLI and Orchestrator, and authenticate GitHub locally with repository access. Clone the repository and register that local clone in Orchestrator. Run these commands in PowerShell. Registration needs the absolute checkout path.

   ```powershell
   git clone https://github.com/nguyenbinhanltv/tien-nghich-2d.git
   cd tien-nghich-2d
   ao project add --path (Get-Location).Path --name tien-nghich-2d
   ao project ls
   git fetch origin main
   git log -1 origin/main
   gh pr list --state open
   ```

2. From the repository root, verify local Python, Node and audio tooling. The pilot-compatible measurement build is FFmpeg 6.1.1 with libvorbis and native AAC. The Hằng Nhạc renderer used CPython 3.14.0 and NumPy 2.5.5. Use an isolated Python environment for dependencies. Inspector browsing runs on Node 20+ or the documented Python fallback.

   ```powershell
   node --version
   python --version
   python -c "import numpy; print(numpy.__version__)"
   ffmpeg -version
   ffmpeg -hide_banner -encoders | Select-String 'libvorbis|\baac\b'
   python -I tools/scripts/check_longtime.py
   python -I tools/scripts/check_audio_plan.py
   node preview-app/smoke-test.mjs
   node preview-app/serve.mjs --port 4173
   ```

   Open [Asset Inspector](http://127.0.0.1:4173/preview-app/?tab=inspector), then **Longtime art → interface** for the shipped icons, or **Audio pilot** for the approved reference. For Wave 2 playback, use the merged package or portable audition linked above. The [Preview App guide](../preview-app/README.md) gives the fallback server and browser controls.

3. On a fresh `main` checkout, verify the Wave 2 package with the pinned FFmpeg 6.1.1 binary (SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`). The check compares seven rebuilt files with the committed outputs. [Package report](../assets/audio/packs/wave2_batch1_v1/PACK_REPORT.md)

   ```powershell
   python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg (Get-Command ffmpeg).Source --check
   ```

## Backlog for a later user-directed restart

- **PixelLab** has **28 IDs** left in the production backlog (wave one's `lt_kiln_keeper` and `lt_ink_marten` are produced, pending art review). Confirm authorized access and available quota before allocating them. [Longtime GDD](LONGTIME_GDD.md) · [Longtime manifest](../assets/manifest_longtime.json)
- **Longtime VFX** has a design contract: six planned IDs (188 frames), the 12 inherited effects reused, and all budgets inside existing chunk ceilings. Art waits for the reviewer's open decisions at the end of the design. [VFX design](LONGTIME_VFX.md) · [Longtime manifest `vfx` block](../assets/manifest_longtime.json) · [Core manifest](../assets/manifest.json) · [Art Bible](ART_BIBLE.md)
- **Audio** has **3 BGM and 16 SFX** remaining in core after the pilot, first Wave 2 batch and the unlistened second sub-batch (`bgm_blood_sea` + 8 SFX, source and masters only, pending human listening and codec packing). The extensions reserve **5 BGM and 10 SFX** behind their design gates. [Audio design](AUDIO_DESIGN.md) · [Audio manifest](../assets/audio_manifest.json)
- **Asset work:** use the versioned [routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md), [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) and [AssetCat](../.agents/skills/tien-nghich-assetcat/SKILL.md) skills for source routing, palette/outline checks and rights records.
