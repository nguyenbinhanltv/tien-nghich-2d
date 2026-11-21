# Orchestrator handoff

## Resume point

Keep scheduling paused on the new machine. Finish the existing handoff and audio review only. Start production or enable recurring jobs when the user explicitly resumes. GitHub holds the shared work. A fresh clone recovers the committed assets, manifests and tools; private Inspector revisions, listening decisions and local session state require their own records.

[PR #50](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/50) shipped at `b6abede08b71f0e617c61cb013f7ea25c7c7b257`. Its seven web chunk manifests contain **93 Longtime IDs and 306 frames**. Counts below are IDs / frames. The 102 inherited core entries are accounted for separately.

| Abode | Armory | Ember Delta | Interface | Mist Archive | Star Quarry | Wards |
|---|---|---|---|---|---|---|
| 4 / 34 | 48 / 120 | 1 / 24 | **32 / 32** | 1 / 24 | 1 / 24 | 6 / 48 |

## Audio awaiting human audition

The approved Động Phủ pilot (one bed and eight cues) remains the listening reference. The first Wave 2 sub-batch adds one chapter bed and eight cues. The two published sources are recoverable independently.

| Source branch | Exact commit and evidence |
|---|---|
| [Hằng Nhạc score](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/skills-arena-prs/hengyue-score) | [55dd32c9625a5e213312380ca01992d64ba60db6](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/55dd32c9625a5e213312380ca01992d64ba60db6). Two byte-identical renders. Stereo PCM16 at 44,100 Hz, loop [0, 3087000) frames, 70 s, −21.66 LUFS and −7.06 dBTP. |
| [Wave 2 effects](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/ao/ember-delta-tiles/wave2-first-sfx) | [b20ef09b802f84c207d895db0752090eeb62db1d](https://github.com/nguyenbinhanltv/tien-nghich-2d/commit/b20ef09b802f84c207d895db0752090eeb62db1d). Eight mono masters reproduced twice. Step, evade, cast, bolt, light tell, focus, cancel and deny have individual PCM and WAV hashes. |

**Open audio integration.** [PR #52](https://github.com/nguyenbinhanltv/tien-nghich-2d/pull/52), branch `ao/ember-delta-atlas/audio-wave2-batch1`, head `b27eb12c34a9d0786d535b750993dc3140b54a04`. The integrator reports 7/7 deterministic pack outputs, 4/4 Wave 2 tests, 5/5 pilot tests, the audio plan check passing and all 23 pilot files byte-identical. Independent technical QA was underway at handoff. [Versioned pack, manifest and report](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/b27eb12c34a9d0786d535b750993dc3140b54a04/assets/audio/packs/wave2_batch1_v1)

**Human audition pending.** Download the WAV and timing key from [the portable audition folder](https://github.com/nguyenbinhanltv/tien-nghich-2d/tree/cb0181eb463848efec0bec43ffbef41cfa2b7e29/audition) on `ao/ember-delta-atlas/audio-wave2-batch1-audition`, commit `cb0181eb463848efec0bec43ffbef41cfa2b7e29`. Compare the master, Ogg and AAC seams at 4.0, 12.8 and 21.6 seconds, then follow the key for all eight effects solo and over the bed. Check mono and record the listener's decision against the exact audio head before merging #52.

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

   Open [Asset Inspector](http://127.0.0.1:4173/preview-app/?tab=inspector), then **Longtime art → interface** for the shipped icons, or **Audio pilot** for the approved reference. Wave 2 is auditioned from the integration package. The [Preview App guide](../preview-app/README.md) gives the fallback server and browser controls.

3. To adopt an **open** audio PR after ownership transfer is authorized, use a clean worker checkout. Record the live head, compare it with the reviewed SHA, then attach ownership and check out the verified branch. If the head moved, inspect the new diff and repeat its checks before carrying forward earlier evidence.

   ```powershell
   $pr = 52
   $info = gh pr view $pr --json state,headRefName,headRefOid,url | ConvertFrom-Json
   if ($info.state -ne 'OPEN' -or (git status --porcelain)) { throw 'Check PR state and worktree' }
   if ($info.headRefOid -ne 'b27eb12c34a9d0786d535b750993dc3140b54a04') { throw 'Review updated audio head first' }
   git fetch origin $info.headRefName
   if ((git rev-parse "origin/$($info.headRefName)") -ne $info.headRefOid) { throw 'Remote head moved' }
   ao session claim-pr $info.url
   gh pr checkout $pr
   git status --short --branch
   git rev-parse HEAD
   ```

   Confirm the final HEAD equals the recorded full SHA. On that audio head, run `python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg (Get-Command ffmpeg).Source --check`. The reference FFmpeg 6.1.1 binary SHA-256 is `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`. For a merged PR, use the merged main checkout and its recorded pack hash.

## Backlog for a later user-directed restart

- **PixelLab:** The coordinator?s production backlog is **30 IDs total**: two wave-one subjects (kiln keeper and ink marten) and 28 later assignments. Confirm authorized access and available quota before allocating them. [Longtime GDD](LONGTIME_GDD.md) · [Longtime manifest](../assets/manifest_longtime.json)
- **Longtime VFX:** scope IDs, visual purpose, frame profiles, budgets and acceptance in design before producing art. Preserve the 12 inherited effects and the existing core delivery contract. [GDD](GDD.md) · [Core manifest](../assets/manifest.json) · [Art Bible](ART_BIBLE.md)
- **Audio:** after this sub-batch is accepted, core production has four beds and 24 effects outstanding. Later waves reserve five beds and ten effects behind their design gates. [Audio design](AUDIO_DESIGN.md) · [Audio manifest](../assets/audio_manifest.json)
- **Asset work:** use the versioned [routing](../.agents/skills/tien-nghich-asset-routing/SKILL.md), [art QA](../.agents/skills/tien-nghich-art-qa/SKILL.md) and [AssetCat](../.agents/skills/tien-nghich-assetcat/SKILL.md) skills for source routing, palette/outline checks and rights records.
