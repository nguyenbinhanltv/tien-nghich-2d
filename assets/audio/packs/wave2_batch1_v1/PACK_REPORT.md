# Audio Wave 2 first sub-batch pack `wave2_batch1_v1` — evidence report

Pinned inputs (base `b6abede08b71f0e617c61cb013f7ea25c7c7b257`):
- BGM `55dd32c9625a5e213312380ca01992d64ba60db6` (`bgm_hengyue`, master SHA-256 `78f89b07c6e2027648bbaa61314e5cf3a0ea717d53024d08d00f5f6cea9158a6`, 70 s, `[0, 3087000)`)
- SFX `b20ef09b802f84c207d895db0752090eeb62db1d` (`wave2_first_sfx`, 8 cues: `sfx_bolt`, `sfx_cancel`, `sfx_cast`, `sfx_deny`, `sfx_evade`, `sfx_focus`, `sfx_step`, `sfx_tell_light`)

Masters are untouched; **no derived mastering** is applied. Approved `pilot_v1` and all pilot masters/sources remain 100% immutable (23/23 files exact match).

- **Rebuild**: `python -B tools/scripts/build_audio_wave2_batch1_pack.py --ffmpeg <ffmpeg> [--check]` (`--check` rebuilds all 7 generated files into a scratch directory and verifies byte-for-byte SHA-256 equality; passed).
- **Toolchain**: pre-existing pinned FFmpeg 6.1.1 (`ffmpeg version 6.1.1-essentials_build-www.gyan.dev`, executable SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`, libvorbis `-q:a 5` + native AAC-LC `96k` mono SFX / `160k` stereo BGM, `-map_metadata -1 -fflags +bitexact -flags:a +bitexact`), CPython 3.14.0, NumPy 2.5.5.

## Files

| File | Content |
|---|---|
| `sfx_sprite_master.wav` | Lossless 8-cue Wave 2 SFX sprite (`142,336` frames, `8192`-frame digital-silence guards, `1024`-aligned cue starts, SHA-256 `4ace1ea260fcde8e1dc53c8b73e48be49148eb2702720cfab7aa055a455142f5`) |
| `sfx_sprite.ogg` / `.m4a` | Vorbis q5 (`17,630 B`, `3c201bd7976b...`) / AAC-LC 96 kbps mono (`33,433 B`, `78d6bceed9f1...`) |
| `bgm_hengyue.ogg` / `.m4a` | Vorbis q5 (`681,145 B`, `8af5f318a3b1...`) / AAC-LC 160 kbps stereo (`1,195,041 B`, `bff7ca7a02f7...`), encoded as `16384` wrapped lead-in + `3087000` loop + `16384` lead-out |
| `pack.json` | Versioned cue table, source-frame map, per-codec decoded-frame map, loop bounds, container metadata, hashes |
| `evidence.json` | Automated waveform, codec, guard-isolation, loudness, peak/true-peak, and mix comparison measurements |

## Automated evidence (waveform / codec / meter)
- **Delay/padding.** FFmpeg-decoded head offset measured by FFT cross-correlation: `0` frames on both Ogg and M4A for both BGM and SFX (M4A edit list `media_time=1024` honored once; raw offset if ignored is `+1024`). SFX sprite decodes to exact `142,336` frames on both codecs.
- **Markers.** Source and decoded markers are integer sample frames per channel. BGM loop: source `[0, 3087000)`; decoded `[16384, 3103384)` on both Ogg and M4A.
- **Guard windows and bleed.** All source WAV guard samples are digital zero. All decoded guard cores (`[end + 2048, next_start - 2048)`) measure `-240.0 dBFS` (zero PCM16 counts) on both Ogg and M4A. Per-cue SNR (decoded vs master): Ogg `11.81–36.27 dB`, M4A `13.44–57.02 dB`.
- **BGM seam, three repeats.** Join steps `[201.0, 201.0]` (Ogg, vs `p99.99 = 851.0`), `[54.0, 54.0]` (M4A, vs `p99.99 = 842.0`). Loop SNR `36.79 dB` (Ogg) / `42.63 dB` (M4A). Both pass seam rules with `0` frames added or removed.
- **Peak / True Peak & Loudness.**
  - `bgm_hengyue`: Master `-21.6 LUFS-I`, LRA `5.9 LU`, `-7.1 dBTP` (`-7.057 dBFS` peak); Ogg `-21.6 LUFS-I`, `-6.9 dBTP`; M4A `-21.7 LUFS-I`, `-7.1 dBTP`.
  - `wave2_first_sfx` sprite: Ogg `-3.0 dBTP` (`-3.231 dBFS` sample peak), M4A `-2.6 dBTP` (`-2.879 dBFS` sample peak). Both remain well below `-1.0 dBTP` with no clipping.

## Listening status
- **Agent listening:** not supported by this agent; no audio was auditioned.
- **Human listening: pending.** Portable decoded audition WAV (`wave2_batch1_audition.wav`, `01:02.876`, SHA-256 `d998e86a3bd1451c449abc299ceea6c807ab194dd4396b8c87a7ca7b9cc832e6`) and timing key (`wave2_batch1_audition_timing.json` SHA-256 `e2aa0fd7ffc501b7fb80f50eb0e205b2369bb88c87ea056b69f1207936e529e2`, `wave2_batch1_audition_timing.md` SHA-256 `f5d6f310938ceea91e44b8bd2da902fb9fdc66543e8ce7b50e3670ea7b2cf`) are published on dedicated non-main handoff branch `ao/ember-delta-atlas/audio-wave2-batch1-audition` (under `audition/`) and registered as session artifacts so `main` is not bloated.
