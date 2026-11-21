# Audio pilot pack `pilot_v1` — evidence report

Pinned inputs (base `46e6ae48`): BGM `fd8f2f74` (`bgm_dong_phu`, master SHA-256 `e1e1bfe6…c854f71`), SFX `ff1974c6` (8 cues). Masters are untouched; **no derived mastering** is applied.
Rebuild: `python -B tools/scripts/build_audio_pilot_pack.py --ffmpeg <ffmpeg> [--check]` (`--check` rebuilds to a temp dir and requires byte-identical output; passed).
Toolchain: pre-existing `ffmpeg-static` b6.1.1 (FFmpeg 6.1.1 gyan.dev essentials, libvorbis + native AAC-LC) found under `D:/Temp`; no ffprobe exists there, so container facts are parsed from bytes by the script and stream facts come from FFmpeg decode. Nothing installed, nothing on PATH.

## Files
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
- **Bleed.** Core guard (between 2048 frames after one cue and 2048 before the next) is digital silence (−240 dBFS) on both codecs for all cues. Pre-echo reaches the 2048-frame edge before a cue start on Ogg (worst `sfx_chest` −22 dBFS, `sfx_dash` −35, `sfx_hit_flesh` −27); M4A is lower (worst −37). Edges stay inside the guard. Per-cue SNR (decoded vs master): Ogg 8.8–31.8 dB (lowest `sfx_dash`), M4A 12.7–52.7 dB.
- **BGM seam, three repeats.** Join steps 99/99 (Ogg), 97/97 (M4A) PCM counts vs the master's own 96; below the 99.99th-percentile body step (≈1670). Seam-window error ≤46 PCM. Loop SNR 34.8 dB (Ogg) / 33.0 dB (M4A).
- **Loudness.** Master −23.2 LUFS-I, LRA 3.8 LU, −7.4 dBTP. Ogg −23.2 / −7.5 dBTP; M4A −23.2 / −7.4 dBTP. Decoded SFX sprite true peak: **Ogg −0.5 dBTP, M4A −0.8 dBTP** (masters' sample peaks reach −1.36 dBFS; codec overshoot, no clipping, sample peaks −1.64/−1.04 dBFS). Both exceed a −1 dBTP guideline; treat as a flag for the runtime gain stage.
- **Mix target.** BGM −23.2 LUFS-I is 0.2 LU from an EBU R128 −23 target (needs +0.2 dB, true peak −7.2 dBTP). A −16 LUFS mobile target would need +7.2 dB and put true peak at −0.2 dBTP (headroom −0.8 dB to −1 dBTP), so it is not baked in. Active-region RMS of SFX is 2.2–9.5 dB above the bed RMS (−25.4 dBFS). Proposed lever: runtime gain; any mastered variant needs a recorded recipe and measured headroom.

## Listening status
- **Agent listening:** not supported; nothing was auditioned by the agent.
- **Human listening: pending.** Audition WAV (decoded Ogg and M4A seam excerpts, then each cue over the bed) accompanies the PR report; it is not part of this PR.
