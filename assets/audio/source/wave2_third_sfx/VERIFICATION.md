# Wave 2 third sub-batch: `bgm_ancient_god` and eight core SFX

**Listening status: no agent listened to any of this audio. Human listening approval is pending.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`) acting as the composer/sound-designer role earlier ledgers assign to Codex. Delivered records, masters, sources and packs are untouched.

## Reproducibility

Two renders from empty output directories (the bed with `python -I -B assets/audio/bgm_ancient_god/render.py <output.wav>`, the effects with `python -I -B tools/generators/wave2_third_sfx.py --out <dir>`, CPython 3.14.5, NumPy 2.5.5 for the bed) were compared with `diff -r`: the bed master, all eight effect masters and the generated ledger are byte-identical. Full hashes are in `assets/audio/bgm_ancient_god/provenance.json` and `provenance.json` beside this note. `tools/tests/test_audio_wave2_third_batch.py` repeats the rebuild and compares it with the committed files. No codec output exists for these IDs.

Bed master WAV SHA-256 `cb1d36a582cf4172e49087e185d4358eaf6828a14ba849a9b3ad3500a743bf74`, PCM SHA-256 `7d8d3a257774eb06c085a9015fb14aa1782b0c8674048e3fbdeb3b443c585d26`.

| Cue | PCM SHA-256 (prefix) | WAV SHA-256 (prefix) |
|---|---|---|
| sfx_chime | `7c8043ac94160d13…` | `a65a4f6e4b306992…` |
| sfx_crush | `6007998f601edadb…` | `4265d8777d5da186…` |
| sfx_gust | `4f2dd12af10dd479…` | `c3356686e578f1cd…` |
| sfx_thorn | `1331210dea57034c…` | `a08a123d557cff5d…` |
| sfx_flame | `79ed29c40a0e8e69…` | `8efca1d99d8ece20…` |
| sfx_shade | `bd565412758d747f…` | `d3e317a6ef6deb7a…` |
| sfx_shock | `bec0add2b97376ed…` | `f8c60343857fab89…` |
| sfx_player_fall | `7c7c279444b131a2…` | `d48dd8210e9d4885…` |

## Bed: `bgm_ancient_god`

Stereo PCM16, 44,100 Hz, 20 bars of 4/4 at 60 BPM (80 s, one beat is exactly 44,100 frames). Loop is half-open `[0, 3528000)` frames, an exact bar multiple. Tonal centre C, A4 = 440 Hz, notes limited to C D F G A. The brief ("slow displaced stone percussion and a low open fifth; break the pulse at the boss transition") is realized as:

- **Low open fifth:** a hollow five-partial drone in four-bar phrases: C2+G2 (bars 1-4), G2+D3 (bars 5-8), C2+G2 with a quiet D3 entering at bar 11 (bars 9-12), C2+G2 with a C1 sub (bars 13-16, the transition) and G2+D3 with a quiet A3 (bars 17-20). No third is ever sounded.
- **Displaced stone percussion:** four inharmonic modal stones (anvil, slab, flint, keystone). Four figures move the first strike between beat 0.0, 0.25, 0.5 and 0.75 and put the second accent off the beat (2.75, 2.5, 2.25, 2.0), so the pulse never sits on the bar grid.
- **Break at the boss transition:** bar 13 keeps one faint flint where the pulse should fall, bars 14-15 have no stone, the drone adds the C1 sub, the keystone lands on beat one of bar 16, and the pulse re-enters late at bar 17. Cue points in frames are in `provenance.json` (`boss_transition`); they are markers for a future transition, not extra loops.
- **Seam:** notes, drone tails and the reverb (circular FFT convolution) wrap modulo the loop. Signed step at the seam is [25, 5] LSB (L, R); the largest step within 10 ms either side is [59, 61].

Meter (FFmpeg 8.1.2 ebur128, not the pinned 6.1.1 build): **-22.5 LUFS**, true peak **-7.2 dBTP**, LRA 5.3 LU. Delivered beds: Động Phủ -23.2 LUFS / -7.4 dBTP, Hằng Nhạc -21.66 / -7.06, Huyết Hải -22.0 / -7.5. Measured mono energy share: below 100 Hz -0.8 dB, 100-450 Hz -8.0 dB, 450-1600 Hz -25.1 dB, 1.6-5 kHz -41.4 dB, above 5 kHz -47.0 dB of total. The bronze warning register (450-1600 Hz) is nearly empty of bed energy, leaving it open for sfx_tell_boss and sfx_counter. The bed is dark: little energy above 1.6 kHz, so thin small speakers will carry mostly the stone attack and the upper drone partials.

## Effects: selection rationale

The core combat list has 25 cues; 17 are delivered (pilot, first and second sub-batch). The eight remaining are exactly the ones below. Each is a weapon-family or outcome cue per the `families` bindings in `assets/audio_manifest.json`:

- `sfx_chime`: `arm_mirror` and `arm_bell` release; `ward_mirror` and `ward_bell` pulse. One high struck bell.
- `sfx_crush`: `arm_stone` release; `ward_anchor` pulse. Grinding rock, no sharp onset.
- `sfx_gust`: `arm_wind` release; `ward_tide` pulse. Slow-swelling wind.
- `sfx_thorn`: `arm_needle` release; `ward_thorn` pulse. Three rising needle pricks.
- `sfx_flame`: `arm_kiln` and `arm_flame` release; `ward_flare` pulse. Ignition whoomp and crackle.
- `sfx_shade`: `arm_soul` release; `shadow` activate. Breathy wail from silence, sinking.
- `sfx_shock`: `arm_thunder` release; `lightning` activate. Electric crack, buzz and thunder.
- `sfx_player_fall`: `form` and `future_form` `fall` (the player's defeat).

| Cue | Frames at 44.1 kHz | Onset | Tail end (exclusive) | Sample peak (dBFS) | RMS (dBFS) |
|---|---:|---:|---:|---:|---:|
| sfx_chime | 44100 | 1 | 39668 | -5.524 | -22.745 |
| sfx_crush | 36162 | 2 | 31302 | -5.011 | -22.918 |
| sfx_gust | 33516 | 3 | 31304 | -5.663 | -21.268 |
| sfx_thorn | 11466 | 1 | 8991 | -5.521 | -23.359 |
| sfx_flame | 34398 | 1 | 26012 | -5.062 | -21.177 |
| sfx_shade | 39690 | 4 | 37922 | -6.018 | -18.482 |
| sfx_shock | 35280 | 1 | 33942 | -4.446 | -22.166 |
| sfx_player_fall | 79380 | 1 | 78491 | -5.945 | -22.237 |

All eight are mono, begin and end at digital zero, and no loudness normalization was applied beyond a per-cue trim chosen for peaks between about -4.5 and -6.5 dBFS (the delivered cues sit between -3 and -7).

Mono distinguishability was checked with numbers only (duration to -30 dB, attack to 70 % of peak, spectral centroid, octave-band energies and a coarse time-frequency distance to every delivered master). The nearest neighbours were `sfx_thorn` to `sfx_evade` / `sfx_tell_light`, `sfx_flame` to `sfx_enemy_fall`, and `sfx_chime` to `sfx_pickup`; they are listed in the A/B pairs below because numbers cannot settle them.

## Listener A/B comparisons

Listen in mono and in stereo at matched monitoring gain, solo and then over the matching bed.

1. `sfx_chime` vs `sfx_pickup` vs `sfx_confirm`: one high glass bell with a long ring vs a rising interval vs a short pluck.
2. `sfx_chime` vs `sfx_hit_spirit` and `sfx_counter`: the chime has nothing below 1 kHz; the others have a low strike body.
3. `sfx_crush` vs `sfx_hit_stone` vs `sfx_tell_heavy`: sustained grind vs hard crack vs rising growl and one thud.
4. `sfx_gust` vs `sfx_dash` vs `sfx_evade`: 200 ms swell of wind vs immediate hiss vs narrow silk slip.
5. `sfx_thorn` vs `sfx_evade` vs `sfx_tell_light` vs `sfx_bolt`: three rising clicks above 2.5 kHz vs a silk slip with a rising tone vs two knocks near 1 kHz vs one spark with a buzzing fall.
6. `sfx_flame` vs `sfx_cast` vs `sfx_enemy_fall`: heat thump with irregular crackle ticks vs gathering breath and fifth vs a slump with a falling pitch.
7. `sfx_shade` vs `sfx_hit_spirit` vs `sfx_tell_heavy`: soft swell from silence, sinking, mid register vs struck shimmer vs low rising growl.
8. `sfx_shock` vs `sfx_bolt` vs `sfx_crush`: bright crackle front with a long thunder tail vs a 144 ms spark vs a low grind with no bright front.
9. `sfx_player_fall` vs `sfx_player_hurt` vs `sfx_enemy_fall` vs `sfx_boss_fall`: a sung collapse ending on a quiet fifth; check it reads as the player's defeat, clearly distinct from the hit and from both enemy defeats, and smaller than the boss fall.
10. `sfx_tell_boss` over `bgm_ancient_god`: the bed should leave the bronze register clear.
11. `bgm_ancient_god` looped three times at the seam, then against `bgm_hengyue`, `bgm_blood_sea` and `bgm_dong_phu` at matched monitoring gain: no click, added beat or level jump; plausible loudness neighbour.
12. Bars 12-17 of the bed: the pulse should audibly break, the keystone should land as a transition, and the late re-entry should not feel like an error.
13. Mono fold-down of the bed and of every cue.

Log any confusion; retune the score or presets and bump the revision if a pair is not distinguishable.

## Open follow-up

Ogg Vorbis and AAC-LC packing, decoded-frame evidence and the pack manifest are not part of this change. They need the pinned FFmpeg 6.1.1 build (SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`), which this machine does not have. The bed loudness should be re-measured on that build then.
