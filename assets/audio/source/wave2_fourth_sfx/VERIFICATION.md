# Wave 2 fourth sub-batch (last core source batch): two beds and eight UI/progression SFX

**Listening status: no agent listened to any of this audio. Human listening approval is pending.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`) acting as the composer/sound-designer role earlier ledgers assign to Codex. Delivered records, masters, sources and packs are untouched.

With this batch every core ID in `assets/audio_manifest.json` (6 music + 40 effects) has a master. `tools/scripts/check_audio_core_masters.py` proves it: it resolves each ID to a master, checks format (stereo beds, mono effects, PCM16, 44,100 Hz), loop bounds, digital-zero endpoints, PCM and WAV hashes, input hashes and exactly one ledger record per ID, and rejects masters for IDs outside the manifest. Masters existing is not delivery approval: packing and listening remain.

## Reproducibility

Two renders from empty output directories (beds with `python -I -B assets/audio/<bed>/render.py <output.wav>`, effects with `python -I -B tools/generators/wave2_fourth_sfx.py --out <dir>`, CPython 3.14.5, NumPy 2.5.5 for the beds) were compared with `diff -r`: both bed masters, all eight effect masters and the ledger are byte-identical. Full hashes are in the bed ledgers and in `provenance.json` beside this note. `tools/tests/test_audio_wave2_fourth_batch.py` repeats the rebuild and compares it with the committed files. No codec output exists for these IDs.

| Asset | WAV SHA-256 |
|---|---|
| bgm_boss_trial master | `39f85bb9a406810d8dadd364cf917f27b43cb1124bab5bc7d5aa99282b44cf0b` |
| bgm_endless master | `6e938f93277a85093a34b6ffff19527b730bff4bcf5145924d1ffb6464f327f2` |

| Cue | PCM SHA-256 (prefix) | WAV SHA-256 (prefix) |
|---|---|---|
| sfx_seed | `a11395dee1f8d7e5…` | `843ee991f4fe8bb2…` |
| sfx_harvest | `480c33c51505a24d…` | `84629e4088c99b15…` |
| sfx_kiln | `11f0f0f366ac8d0e…` | `a2c3f71110949908…` |
| sfx_craft | `0b3399480bac474e…` | `c73edd3978ea41c0…` |
| sfx_gate | `d64f9e18108339ad…` | `96fe36a20d5b544f…` |
| sfx_bond | `0d86fabd9c657bc5…` | `6711456ddcf447c7…` |
| sfx_ward_place | `ba83d945c6e27d1c…` | `29cdc737e87eecf0…` |
| sfx_reward | `2914d10503160382…` | `1ce3e544828818af…` |

## Bed: `bgm_boss_trial`

Stereo PCM16, 44,100 Hz, 24 bars of 4/4 at 96 BPM (60 s; a beat is 27,562.5 frames, a bar 110,250). Loop is half-open `[0, 2646000)`. One loop serves all three Trảm Tiên rounds. Tonal centre D with a flat second (D Eb F G A). A fast-bowed growl (A1-Eb2) and skin drums (a pitch-falling boom settling on A1 = 55 Hz and a noise rim crack with a G3 = 196 Hz body) drive the pulse; struck bronze enters from bar 5 and thickens to bar 17; seeded noise risers lead into six **cut bars** (bars 4, 8, 12, 16, 20, 24) that keep one drum beat and no bronze, as gaps for the adjudicator's tell. Cue frames: `breath_bars` in the ledger. **Drum tuning (revision 2):** the drum bodies are tuned, not free: the renderer scale-checks both against D Eb F G A, as it does the growl and bronze. Revision 1 had the boom settling at 52 Hz (G#1, a tritone from D and outside the scale) and the tak at 190 Hz; both were moved onto scale tones after review. The reverb is a circular convolution and tails wrap, so frame 0 continues frame 2,645,999 (signed seam step [54, -119] LSB; largest step within 10 ms either side [662, 617], drum-attack scale).

Meter (FFmpeg 8.1.2, not the pinned 6.1.1): **-21.6 LUFS**, **-8.4 dBTP**, LRA 1.9 LU. Measured mono energy share: below 100 Hz -1.2 dB, 100-450 Hz -8.4 dB, 450-1600 Hz -12.0 dB, 1.6-5 kHz -17.5 dB, above 5 kHz -20.7 dB of total. Low skin drum and growl carry the bed; bronze hits sit above and avoid the first beat of every bar, and the six cut bars leave the boss tell room.

**Plain caveat on the boss tell:** this bed is dense in 100-1600 Hz. It is not an open bronze register like the Blood Sea bed; the room for `sfx_tell_boss` comes from the cut bars and the bronze hits avoiding beat one. Whether the tell is clear over the bed is the first thing to judge.

## Bed: `bgm_endless`

Stereo PCM16, 44,100 Hz, 20 bars of 4/4 at 75 BPM (64 s; a beat is exactly 35,280 frames). Loop is half-open `[0, 2822400)`. Tonal centre A, notes limited to A C D E G. Four cycles of five bars, one bar per floor: soft FM plucks add a voice each bar (low root, an eight-note "wheel" in three variants, sparse high sparks) over a quiet A2+E3 open-fifth pad. **Bar 5 of every cycle is a marker room** (bars 5, 10, 15, 20): no pluck, only the pad, about 8 dB below the floor bars by RMS (-31.6 vs -23.5 dBFS). Cue frames: `floor_cycle` in the ledger. The bed does not go silent by itself. The bank-or-continue silence is a game-side duck or stop; the marker rooms and an open upper register are what the bed offers so the floor marker and `sfx_reward` read either way.

Meter: **-22.0 LUFS**, **-9.9 dBTP**, LRA 5.4 LU (the rooms drive the larger LRA). Measured mono energy share: below 100 Hz -28.8 dB, 100-450 Hz -0.1 dB, 450-1600 Hz -15.8 dB, 1.6-5 kHz -33.3 dB, above 5 kHz -78.9 dB of total. Plucks stay below about 700 Hz fundamentals so the 1.6-5 kHz band stays open for the floor marker and the reward clinks. Signed seam step [29, 21] LSB; largest step within 10 ms either side [226, 189]. Delivered beds: Động Phủ -23.2 LUFS / -7.4 dBTP, Hằng Nhạc -21.66 / -7.06, Huyết Hải -22.0 / -7.5, Cổ Thần -22.5 / -7.2.

## Effects: selection rationale

The 40 core effects are now all mastered; the eight below were the only ones missing (verified against the manifest and every delivered master). They are bound through `families` and `modes`:

- `sfx_seed`: `garden` plant. A soft earthen pat, falling hollow note and crumble.
- `sfx_harvest`: `garden` collect and `herb` activate. Stem snap, long leaf rustle, falling third.
- `sfx_kiln`: `kiln` ignite. Clay door thud, two bellows breaths, low D/A furnace hum.
- `sfx_craft`: `kiln` complete and `defense` repair. Two taps, then a simultaneous D5-A5-D6 chord.
- `sfx_gate`: `gate` activate and Abode `door`. Stone grind, one boom, soft low fifth through the opening.
- `sfx_bond`: `pet` bond. Parallel thirds rising a whole tone over a low purr.
- `sfx_ward_place`: `ward` activate and every `ward_*` place. Heavy thunk, widening shimmer, beating hum.
- `sfx_reward`: core and Endless `bank`. Four rising jade clinks, then a warm D-A-D chord.

| Cue | Frames at 44.1 kHz | Onset | Tail end (exclusive) | Sample peak (dBFS) | RMS (dBFS) |
|---|---:|---:|---:|---:|---:|
| sfx_seed | 22932 | 1 | 21595 | -6.456 | -25.185 |
| sfx_harvest | 30870 | 1 | 30425 | -6.529 | -18.356 |
| sfx_kiln | 66150 | 1 | 63940 | -5.99 | -19.891 |
| sfx_craft | 48510 | 1 | 48497 | -5.424 | -22.364 |
| sfx_gate | 61740 | 2 | 60854 | -5.438 | -22.676 |
| sfx_bond | 48510 | 1 | 48508 | -6.035 | -18.216 |
| sfx_ward_place | 44100 | 1 | 43626 | -5.474 | -21.264 |
| sfx_reward | 66150 | 1 | 63055 | -5.445 | -18.384 |

All eight are mono, begin and end at digital zero, with a per-cue trim giving peaks between about -5.4 and -6.5 dBFS. Numeric mono distinguishability was checked against every delivered cue. Nearest by time-frequency distance: `sfx_bond` to `sfx_tell_boss`, `sfx_seed` to `sfx_tell_heavy` / `sfx_hit_spirit` / `sfx_pickup`, `sfx_harvest` to `sfx_gust`, `sfx_kiln` and `sfx_gate` to `sfx_boss_fall` / `sfx_breakthrough`, `sfx_craft` to `sfx_chime`, `sfx_reward` to `sfx_breakthrough`.

## Listener A/B comparisons

Mono and stereo, matched monitoring gain, solo and over the matching bed.

1. `sfx_reward` vs `sfx_pickup` vs `sfx_craft` vs `sfx_breakthrough`: four rising clinks and a settled chord vs one rising fifth vs two taps and a chord vs a long low rise. Banking should read as different from collecting and from a breakthrough.
2. `sfx_craft` vs `sfx_chime` vs `sfx_pickup`: simultaneous chord after knocks vs one high bell vs sequential fifth.
3. `sfx_kiln` vs `sfx_flame` vs `sfx_breakthrough`: slow bellows and low hum vs combat ignition with crackle vs bright rise.
4. `sfx_gate` vs `sfx_crush` vs `sfx_breakthrough` vs `sfx_boss_fall`: grind-boom-fifth vs short stone grind vs bright rising D vs huge collapse.
5. `sfx_ward_place` vs `sfx_seal_lock` vs `sfx_hit_stone`: thunk, shimmer and beating hum vs pulses and latch vs short crack.
6. `sfx_bond` vs `sfx_confirm` vs `sfx_pickup`: soft paired thirds with a purr vs one pluck vs bright rising fifth. Check that the purr does not read as a motor.
7. `sfx_seed` vs `sfx_step` vs `sfx_chest`: damp soil pat vs heel and scuff vs wooden catch. `sfx_harvest` vs `sfx_pickup` vs `sfx_gust`: rustle and falling third vs bright stone vs wind.
8. `sfx_tell_boss` over `bgm_boss_trial`: judge clarity, especially on a cut bar and on a full bar.
9. `bgm_boss_trial` drum pitch: with the growl on D2, then in the `a` phrase on A1 (bars 8, 16), do the boom (A1) and the growl sound like one open-fifth foundation, with no sour or detuned low note? Compare against the previous G#1 boom if a listener has it.
10. `bgm_boss_trial` looped three times (one per round) at the seam, then against the other beds at matched gain: no click, added beat or level jump; check that it escalates but does not tire over three rounds.
11. `bgm_endless` over several loops: do the five-bar cycles read as floors, is the bar-5 room audible as a pause, and does `sfx_reward` read cleanly on a room bar and on a floor bar? Judge a game-side duck as well.
12. `bgm_endless` vs `bgm_dong_phu` and `bgm_hengyue`: both are plucked beds; check that Endless is distinct.
13. Mono fold-down of both beds and every cue.

Log any confusion; retune the score or presets and bump the revision if a pair is not distinguishable.

## Open follow-up

Ogg Vorbis and AAC-LC packing, decoded-frame evidence and the pack manifest are not part of this change. They need the pinned FFmpeg 6.1.1 build (SHA-256 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`), which this machine does not have. Bed loudness should be re-measured on that build then.
