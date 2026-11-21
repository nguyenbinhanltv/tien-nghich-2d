# Wave 2 second sub-batch: `bgm_blood_sea` and eight core SFX

**Listening status: no agent listened to any of this audio. Human listening approval is pending.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`) acting as the composer/sound-designer role earlier ledgers assign to Codex. Existing records are untouched.

## Reproducibility

Two renders from empty output directories (the bed with `python -B assets/audio/bgm_blood_sea/render.py`, the effects with `python -I -B tools/generators/wave2_second_sfx.py --out <dir>`, CPython 3.14.5, NumPy 2.5.5 for the bed) were compared with `diff -r`: the bed master, all eight effect masters and the generated ledger are byte-identical. Hashes are in `assets/audio/bgm_blood_sea/provenance.json` and `provenance.json` beside this note. No codec output exists for these IDs.

## Bed: `bgm_blood_sea`

Stereo PCM16, 44,100 Hz, 24 bars of 4/4 at 72 BPM (80 s). Loop is half-open `[0, 3528000)` frames, which is an exact bar multiple (36,750 frames per beat). Tonal centre E, A4 = 440 Hz, notes limited to E F G A B C. The bowed low pulse (E2-B2) carries the chapter; an unstable upper voice (two beating detuned sines plus a wandering inharmonic partial, G3-F4) drifts above it. Notes and reverberant tails wrap modulo the loop, so frame 0 continues frame 3,527,999 (signed seam step 1 LSB on each channel; largest step within 10 ms of the seam 102/95 LSB).

Meter (FFmpeg 8.1.2 ebur128, not the pinned 6.1.1 build): **-22.0 LUFS**, true peak **-7.5 dBTP**, LRA 4.4 LU. Delivered beds: Động Phủ -23.2 LUFS / -7.4 dBTP, Hằng Nhạc -21.66 LUFS / -7.06 dBTP. The bronze warning register (450-1600 Hz) holds -10.8 dB of the mono energy, below the 0-450 Hz band (-3.5 and -3.4 dB), so it is comparatively open, but it is not empty.

## Effects: selection rationale

The Blood Sea chapter uses `enemy_flesh` (wolves, crows, corpse, lurker) and `boss_flesh` (Teng Huayuan) families, with spirit enemies (vengeful soul, talisman) and stone enemies sharing the chapter ordering. Those families read `tell`, `impact`, `stagger` and `outcome` slots. The eight cues fill the slots the chapter needs that no delivered cue covers:

- `sfx_tell_heavy`: brute and stone wind-up (`enemy_stone` tell).
- `sfx_tell_boss`: boss tell; priority over dense volleys.
- `sfx_hit_stone`: stone impact and every boss `stagger`.
- `sfx_hit_spirit`: spirit impact.
- `sfx_counter`: form family counter accent.
- `sfx_player_hurt`: form family hurt.
- `sfx_enemy_fall`: enemy outcome.
- `sfx_boss_fall`: boss outcome.

`sfx_hit_flesh`, `sfx_tell_light` and `sfx_seal_lock` are already delivered.

| Cue | Frames at 44.1 kHz | Onset | Tail end (exclusive) | Sample peak (dBFS) | RMS (dBFS) |
|---|---:|---:|---:|---:|---:|
| sfx_tell_heavy | 22932 | 2 | 22619 | -7.014 | -19.925 |
| sfx_tell_boss | 52038 | 1 | 51152 | -5.976 | -18.772 |
| sfx_hit_stone | 12348 | 1 | 8006 | -4.018 | -22.713 |
| sfx_hit_spirit | 18522 | 1 | 15668 | -6.071 | -23.297 |
| sfx_counter | 14994 | 1 | 14990 | -4.967 | -20.082 |
| sfx_player_hurt | 15876 | 1 | 14792 | -6.096 | -21.871 |
| sfx_enemy_fall | 28224 | 2 | 26132 | -5.967 | -22.484 |
| sfx_boss_fall | 83790 | 1 | 79359 | -3.002 | -21.35 |

All eight are mono, begin and end at digital zero, and no loudness normalization was applied beyond per-cue trim chosen for peak levels near the delivered cues (-3 to -7 dBFS).

## Listener A/B comparisons

1. `sfx_tell_heavy` vs `sfx_tell_light` vs `sfx_tell_boss`: three tells should be distinguishable by size and register alone, in mono, including under the bed.
2. `sfx_hit_stone` vs `sfx_hit_flesh` vs `sfx_hit_spirit`: hard crack vs dry slap vs shimmering hollow strike.
3. `sfx_tell_boss` vs `sfx_seal_lock`: ringing bronze rising fourth vs tightening pulses and latch.
4. `sfx_counter` vs `sfx_blade`: clash then bright ring vs airy sweep.
5. `sfx_player_hurt` vs `sfx_hit_flesh`: falling pitched pain vs unpitched impact on the target.
6. `sfx_enemy_fall` vs `sfx_boss_fall`: both read as a defeat, and the boss one is clearly larger.
7. `sfx_tell_boss` over `bgm_blood_sea`: the bed should leave it clear.
8. `bgm_blood_sea` looped three times at the seam, then against `bgm_hengyue` and `bgm_dong_phu` at matched monitoring gain: no click, added beat or level jump; plausible loudness neighbour.
9. Mono fold-down of the bed and of every cue.

Log any confusion; retune presets and bump the revision if a pair is not distinguishable.

## Open follow-up

Ogg Vorbis and AAC-LC packing, decoded-frame evidence and the pack manifest are not part of this change. They need the pinned FFmpeg 6.1.1 build (SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`), which this machine does not have. The bed loudness should be re-measured on that build then.
