# Audio pilot pack `pilot_v1` — evidence report

Pinned inputs (base `46e6ae48`): BGM `fd8f2f74` (`bgm_dong_phu`, master SHA-256 `e1e1bfe6…c854f71`), SFX `ff1974c6` (8 cues). Masters are untouched; **no derived mastering** is applied.
Rebuild: `python -B tools/scripts/build_audio_pilot_pack.py --ffmpeg <ffmpeg> [--check]` (`--check` rebuilds to a temp dir and requires byte-identical output; passed).
Toolchain: pre-existing `ffmpeg-static` b6.1.1 (FFmpeg 6.1.1 gyan.dev essentials, libvorbis + native AAC-LC) found under `D:/Temp`; no ffprobe exists there, so container facts are parsed from bytes by the script and stream facts come from FFmpeg decode. Nothing installed, nothing on PATH.

## Files

Verification on Windows x64 used CPython 3.14.0, NumPy 2.5.5 and FFmpeg 6.1.1 (executable SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`). With temp storage under `D:/Temp`, `--check` rebuilt the seven generated files below in scratch and compared their bytes to the target. Git checks out the two generated JSON files with LF. The handwritten report is outside the comparison.

The intact pack returned 0. A scratch copy with an altered Ogg and missing evidence JSON returned 1 and named both files. Target contents and modification times were preserved in both runs. The pack and plan suites passed 11 tests, and the audio-plan validator passed.

All 14 WAV, Ogg and M4A file hashes matched PR head `5fd81839`. The SHA-256 of the inventory is `2791a11da644e5a3fcee5521b1f5665116a0d4c85a041756678de25da4af3184` (sorted repo-relative paths, each line formatted as lowercase SHA-256, two spaces, path, LF). Individual file hashes are recorded in `pack.json`.

| File | Content |
|---|---|
| `sfx_sprite_master.wav` | Lossless 8-cue sprite: 8192-frame guards, every cue start 1024-aligned |
| `sfx_sprite.ogg` / `.m4a` | Vorbis q5 / AAC-LC 96 kbps mono |
| `bgm_dong_phu.ogg` / `.m4a` | Vorbis q5 / AAC-LC 160 kbps stereo, encoded as 16384 wrapped lead-in + loop + 16384 lead-out |
| `pack.json` | Versioned cue table: source-frame map and per-codec decoded-frame map, hashes, loop bounds |
| `evidence.json` | Automated measurements below |

## Automated evidence (waveform / codec / meter)
- **Delay/padding.** FFmpeg-decoded head offset measured by cross-correlation: 0 frames for Ogg and M4A (M4A edit list `media_time=1024` is honoured once; a decoder ignoring the edit list would be +1024). Ogg final granule equals frames. SFX sprite decodes to exactly 263168 frames on both codecs. BGM M4A decodes 224 trailing padding frames (inside the lead-out, outside the loop region).
- **Markers.** Source and decoded markers are integer sample frames. Decoded = source + measured offset (0). Loop: source `[0, 3175200)`; decoded `[16384, 3191584)` on both codecs.
- **Guard windows and bleed.** All source WAV guard samples are zero. For decoded audio, the packer measures signed PCM16 on the aligned 44.1 kHz timeline. Given a physical guard interval `[end, next_start)`, the recorded core is `[end + 2048, next_start - 2048)`. The first and last guards use stream bounds. All nine such cores measured zero counts with pinned FFmpeg 6.1.1 on both codecs. The reported ?240 dBFS is the meter floor for zero. The regression requires a core peak strictly below ?60 dBFS.
- The independent ?84.288 dBFS measurement is two PCM16 counts on both codecs in the post-dash edge, frames `[177584, 179632)`. The adjacent core `[179632, 184320)` measures zero on both. The guard between pickup and seal lock is `[221661, 230400)`. Trimming 1024 frames from each side leaves 91 nonzero Ogg PCM16 samples with a peak of 1 count (?90.31 dBFS). Including the 2048 frames nearest each cue also captures stronger codec pre-echo. The worst pre-onset peaks occur before chest at ?22 dBFS Ogg and ?37 dBFS M4A. Guard samples lie outside the extracted cue markers. Per-cue SNR (decoded vs master): Ogg 8.8–31.8 dB (lowest `sfx_dash`), M4A 12.7–52.7 dB.
- **BGM seam, three repeats.** Join steps 99/99 (Ogg), 97/97 (M4A) PCM counts vs the master's own 96; below the 99.99th-percentile body step (≈1670). Seam-window error ≤46 PCM. Loop SNR 34.8 dB (Ogg) / 33.0 dB (M4A).
- **Loudness.** Master −23.2 LUFS-I, LRA 3.8 LU, −7.4 dBTP. Ogg −23.2 / −7.5 dBTP; M4A −23.2 / −7.4 dBTP. Decoded SFX sprite true peak: **Ogg −0.5 dBTP, M4A −0.8 dBTP** (masters' sample peaks reach −1.36 dBFS; codec overshoot, no clipping, sample peaks −1.64/−1.04 dBFS). Both exceed a −1 dBTP guideline; treat as a flag for the runtime gain stage.
- **Mix target.** BGM −23.2 LUFS-I is 0.2 LU from an EBU R128 −23 target (needs +0.2 dB, true peak −7.2 dBTP). A −16 LUFS mobile target would need +7.2 dB and put true peak at −0.2 dBTP (headroom −0.8 dB to −1 dBTP), so it is not baked in. Active-region RMS of SFX is 2.2–9.5 dB above the bed RMS (−25.4 dBFS). Proposed lever: runtime gain; any mastered variant needs a recorded recipe and measured headroom.

## Listening status
- **Agent listening:** not supported; nothing was auditioned by the agent.
- **Human listening: pending.** Audition WAV (decoded Ogg and M4A seam excerpts, then each cue over the bed) accompanies the PR report; it is not part of this PR.
