# Modes wave (wave 4): two beds and four effects

**Listening status: no agent listened to any of this audio. Human listening approval is pending, and `assets/audio/listening_approvals.json` is untouched by this change.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`). The gate was opened by the owner's choice of 2026-11-23, recorded in `assets/review/audio_gate_decisions.json` (`modes_gate_2026-11-23`, statement "Coi như đã ký, làm luôn", about the trial round and defense wave milestones). The owner settled no musical number: the sound direction is the one-sentence brief of each mode in `docs/AUDIO_DESIGN.md` (Musical and event coverage).

## What is a proposal

**The tempos, lengths, loop points, tonal centres, arrangements and the four gameplay windows below are the author's proposal. The owner has not set them.** They are written up as the "Modes proposal" in `docs/AUDIO_DESIGN.md`. If the owner dislikes any of them, change the score or patch and rebuild: every file here is reproducible from data.

| Cue | Proposed |
|---|---|
| bgm_aftermath | 48 BPM, 4/4, 16 bars = 80 s, D major pentatonic; three falling bell phrases and a breath in the empty bars, mostly rests |
| bgm_defense | 96 BPM, 4/4, 32 bars = 80 s, A minor pentatonic; low drum on beats 1 and 3, stone ostinato with a rest bar every eight bars, wave bell at the end of each group |
| sfx_floor_mark | window 650 ms + tail 600 ms = 1,250 ms |
| sfx_oath | window 650 ms + tail 800 ms = 1,450 ms |
| sfx_wave_call | window 900 ms + tail 500 ms = 1,400 ms |
| sfx_core_crack | window 770 ms + tail 480 ms = 1,250 ms |

**Where the windows come from.** `docs/LONGTIME_VFX.md` documents the clip lengths of three of the effects: the `press` clip of `lt_fx_stamp` (12 frames, 650 ms, `land` on frame 3 = 120 ms) serves both the five-floor mark and the oath, and the `breach` clip of `lt_fx_core_breach` is 769 ms (`breach` and `shake:3` on frame 0). The window is that length (650 and 770 ms), the impact is placed where the clip's event is (the seal lands at 120 ms in both patches; the crack opens at 0 ms), and the tail is the author's proposal. They are explicit milliseconds (`window: {ms, tailMs}`), not read from the clip contract by `studio_audio_render`: the clip route was not used. `sfx_wave_call` has no clip (the wave clock is a UI icon): its 900 ms is a stated length, long enough for two horn notes.

## How the audio was made

With the project's own Studio audio engine (`studio/audio`, Node 24): `node studio/audio/cli.mjs render` on each bed's `score.json` (through the bed's `render.py`, which only wraps the Node call), and `tools/generators/modes_sfx.mjs`, which calls `resolveWindow` then `renderDocument`, for the effects. Only scores, additive/FM/sine/triangle/saw oscillators, filtered noise, seeded MT19937 and a seeded-noise impulse reverb: **no sample, recording, soundfont, generative-audio model or PixelLab**. The rights strings are exact entries of the `licenceProfile.accepts` list (beds: the "additive-oscillator/FM/noise" score string; effects: "Original procedural sound design created for Tien Nghich 2D."). The ledger records the tool as the Node Studio audio engine (the Python files are wrappers).

## Reproducibility

Beds: `tools/.venvs/project/bin/python -I -B tools/scripts/build_modes_bed_provenance.py` renders both masters and writes `master.wav` and `provenance.json` (add `--check` to compare). Effects: `python -I -B tools/generators/modes_sfx.py --out <empty-directory>`. Both use `tools/.venvs/project/bin/python` (CPython 3.14.5) and Node v24.12.0. `tools/tests/test_audio_modes.py` rebuilds all six into scratch directories and compares every byte. Pack: `tools/.venvs/project/bin/python -I -B tools/scripts/build_audio_wave2_pack.py --batch 6 --ffmpeg <native ffmpeg>` (add `--check` to verify), the same per-pack toolchain as batches 2 to 5 (FFmpeg 6.1.1 native, binary SHA-256 `468833134308b22b…`).

| Asset | WAV SHA-256 |
|---|---|
| bgm_aftermath master | `44c49eec850cb91bdfb216b52bdad1b40fdd5c144ce2d9b8300135b53b653058` |
| bgm_defense master | `fd7d3d1c23145132899f89b78a959534c8919601b3fb6ac5d9d809202fffd969` |

| Cue | PCM SHA-256 (prefix) | WAV SHA-256 (prefix) | Frames | Onset / tail end (frame) | Peak dBFS | RMS dBFS | Window ms |
|---|---|---|---:|---|---:|---:|---|
| sfx_floor_mark | `72dd7f7f9c60d5ee…` | `0ba5e9785e4e10d2…` | 55,125 | 5 / 53,706 | -6.009 | -24.352 | 650 + 600 = 1250 |
| sfx_oath | `4693bdf10a6dd2bd…` | `3c1d5e1018be9574…` | 63,945 | 7 / 62,524 | -6.006 | -18.577 | 650 + 800 = 1450 |
| sfx_wave_call | `51940d716e3ce7f5…` | `650791708ef825db…` | 61,740 | 5 / 57,324 | -6.005 | -15.845 | 900 + 500 = 1400 |
| sfx_core_crack | `5b346010f564b67d…` | `cb41a68e34c5e0e0…` | 55,125 | 1 / 52,184 | -5.998 | -26.708 | 770 + 480 = 1250 |

## Beds

Both are stereo PCM16 at 44,100 Hz, 3,528,000 frames (80 s), loop `[0, 3528000)` half-open, notes and reverb wrapping modulo the loop. Meter: the engine's BS.1770 measure (not the pinned FFmpeg; the pack re-measures on FFmpeg 6.1.1 and the numbers agree to 0.1 LU). Reference beds are -21.7 to -23.2 LUFS and -7.1 to -9.9 dBTP.

| Bed | Tempo | LUFS-I | dBTP | LRA (LU) | Seam step L,R | Max step within 10 ms of the seam L,R | Three-repeat seam pass (Ogg / AAC) |
|---|---|---:|---:|---:|---|---|---|
| bgm_aftermath | 48 BPM × 16 bars | -23.51 | -10.889 | 15.48 | [-13, -9] | [346, 302] | True / True |
| bgm_defense | 96 BPM × 32 bars | -23.36 | -6.142 | 1.9 | [57, 119] | [64, 128] | True / True |

**`bgm_aftermath` is quieter in its peaks than every reference bed** (-10.9 dBTP against -7.1 to -9.9): it is mostly rests with soft bells, and its loudness range (15.5 LU) is the widest of the delivered beds. The loudness is on target; whether the peaks are too soft against the other beds is a listening question. The engine's band report floors at -40 dB, which is the value shown for its 1.6 to 5 kHz share: there is almost nothing there, so the bronze warning register is open.

**`bgm_defense` first failed the Ogg three-repeat seam rule** (join step 510 against a body 99.99th percentile of 448): its first version began the loop on a drum and a pluck onset. The fix was a pickup: every voice except the two drones now enters an eighth note after the loop start, so frame 0 is not an onset; the join step fell to 151 (Ogg) and 125 (AAC). That is a measured fix, not a listened one. Band shares (engine bands): 0-100 Hz -3.89 dB, 100-450 Hz -2.31 dB, 450-1600 Hz -22.98 dB, **1600-5000 Hz -47.2 dB**, 5000-22050 Hz -43.31 dB. The enemy-tell register is nearly empty, but the bed is bass-heavy (the drum and the drone put most energy under 450 Hz), which may be a problem on small speakers. The first version had -22 dB in the tell register and a drum 57 cents sharp; both were reduced before packing.

The decoded Ogg and AAC loops were repeated three times and the joins compared with the body (pack evidence): the join step stays under the body's 99.99th percentile in every file, with no frames added or removed. Loop SNR of the codecs against the master: Ogg 30.0 dB (Defense) and 35.0 dB (Aftermath), AAC 36.3 and 41.1 dB.

## Effects

Mono PCM16, 44,100 Hz, digital zero on the first and last frame, peaks at -6.0 dBFS (core effects sit near -6). In the pack (FFmpeg 6.1.1) the sprite loudness is -18.6 LUFS-I (Ogg and AAC), true peak -5.4 and -5.5 dBTP. Guard silence around every cue is digital zero. Per-cue codec SNR: Ogg 24.9 to 37.1 dB, AAC 27.4 to 50.2 dB; **`sfx_core_crack` is the lowest (24.9 dB Ogg)**: a noise snap with scattered shards is the hardest case for a perceptual codec, so its codec versions need listening rather than trust.

Level over `bgm_defense` (active RMS of the cue minus the bed's RMS, pack mix comparison): `sfx_core_crack` -2.0 dB, `sfx_floor_mark` +0.2 dB, `sfx_oath` +6.0 dB, `sfx_wave_call` +9.0 dB. In the manifest the floor mark plays over the Endless bed and the oath over the Boss Trial bed, not over `bgm_defense`; the pack compares every cue with every bed in it. **`sfx_core_crack` has the bed's own peak level (-6 dBFS) but is a short transient with the lowest RMS**: whether it cuts through the defense bed is the second item to check.

## Not checked

- **Nothing was listened to.** No tool can sign a listening, and none was run to pretend to.
- Whether the proposed tempos, windows and arrangements suit the game (no encounter, room or landmark animation exists to try them against; the clip route of `studio_audio_render` was not used).
- Whether the five effects and two beds fit the modes they serve: the oath against the Trial boss bed, the floor mark against the Endless bed, the wave call and the breach against the Defense bed, the aftermath after the trial bed. Only measured levels were looked at.
- Whether the enemy tells survive over `bgm_defense`. Only band energy was measured.
- Engines other than Node v24.12.0 on macOS/Apple silicon; Windows and Linux builds of the pack; the pinned Windows FFmpeg (the pack is on the native macOS toolchain like batches 2 to 5).
- Gameplay timing against real triggers; playback in the playables or the preview app (no cue is wired in).

## Listening list (a human must do this; nothing is signed)

The listening page is a session artifact (`modes_listening.html`), not committed. For each item note pass or the problem; then, if satisfied, sign in the Review tab.

1. **bgm_defense**: does the ostinato read as a wave-after-wave pulse and not as a march? Can a light enemy tell (`sfx_tell_light`) and a heavy tell (`sfx_tell_heavy`) be heard over it? Is the bed too bass-heavy on small speakers?
2. **bgm_aftermath**: does it read as a quiet exit after the trial, and is it too soft or too empty next to the other beds? Does the breath read as breath, not hiss?
3. **Loop seams**: loop each bed three times through the seam on the master and on both codecs (Ogg and AAC). No click, no added beat, no bump in the drone.
4. **sfx_core_crack** over `bgm_defense`: does it cut through, and does it read as the core failing, not as a hit (`sfx_hit`) or a crush (`sfx_crush`)? Is the Ogg version brittle in a bad way?
5. **sfx_wave_call** over `bgm_defense`: is it a call that announces a wave and not an enemy tell? Is it too loud against the bed?
6. **sfx_floor_mark**: does it read as a bronze stamp landing, and separate from `sfx_chime` and `sfx_reward`? Does the 120 ms landing match the `lt_fx_stamp` clip?
7. **sfx_oath**: does it sound like a vow held (pitched, sustained), clearly different from the floor mark that shares its clip length?
8. **Windows**: are the proposed 650, 650, 900 and 770 ms right for how long each moment lasts, and the tails too long or short?
9. Mix: each effect over its own bed at the same monitoring level.
