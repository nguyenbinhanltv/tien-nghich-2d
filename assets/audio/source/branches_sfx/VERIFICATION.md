# Branches wave (wave 3): three beds and three landmark effects

**Listening status: no agent listened to any of this audio. The project owner listened to and approved all six cues on 2026-11-23 ("Đã Nghe và duyệt"), recorded by an agent as `branches_v1` in `assets/audio/listening_approvals.json`, pinned to the master hashes below. The listening list at the end is kept as the record of what was to be judged.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`). The gate was opened by the owner's choice of 2026-11-23, recorded in `assets/review/audio_gate_decisions.json` (`branches_gate_brief_2026-11-23`, statement "Dùng câu định hướng làm brief"). The owner settled only the one-sentence brief of each branch (`docs/AUDIO_DESIGN.md`, Musical and event coverage).

## What is a proposal

**The tempos, lengths, loop points, tonal centres, arrangements and the three gameplay windows below are the author's proposal. The owner has not set them.** They are written up as the "Branches proposal" in `docs/AUDIO_DESIGN.md`. If the owner dislikes any of them, change the score or patch and rebuild: every file here is reproducible from data.

| Cue | Proposed |
|---|---|
| bgm_mist_archive | 72 BPM, 4/4, 24 bars = 80 s, E minor pentatonic; plucked phrase answered by paper scrape and flicks |
| bgm_ember_delta | 66 BPM, 4/4, 22 bars = 80 s, G minor pentatonic; furnace pulse on beats 1 and 3, slag slides, crumble |
| bgm_star_quarry | 60 BPM, 4/4, 20 bars = 80 s, C major pentatonic; struck stone four seconds apart, crystal-ring phrases |
| sfx_paper_rustle | window 800 ms + tail 300 ms = 1,100 ms |
| sfx_slag_shift | window 1,100 ms + tail 400 ms = 1,500 ms |
| sfx_crystal_ring | window 1,400 ms + tail 1,000 ms = 2,400 ms |

No landmark clip exists, so the windows are explicit milliseconds (`window: {ms, tailMs}`), not read from a clip contract.

## How the audio was made

With the project's own Studio audio engine (`studio/audio`, Node 24, `node studio/audio/cli.mjs render` for the beds and `tools/generators/branches_sfx.mjs`, which calls `resolveWindow` then `renderDocument`, for the effects). Only scores, additive/FM/sine/triangle/saw oscillators, filtered noise, seeded MT19937 and a seeded-noise impulse reverb: **no sample, recording, soundfont, generative-audio model or PixelLab**. The rights strings are exact entries of the `licenceProfile.accepts` list (beds: the "additive-oscillator/noise" or "additive-oscillator/FM/noise" score string; effects: "Original procedural sound design created for Tien Nghich 2D.").

## Reproducibility

Beds: `python -I -B assets/audio/<bed>/render.py <output.wav>`. Effects: `python -I -B tools/generators/branches_sfx.py --out <empty-directory>`. Both use `tools/.venvs/project/bin/python` (CPython 3.14.5) and Node v24.12.0. `tools/tests/test_audio_branches.py` rebuilds all six into scratch directories and compares every byte with the committed masters and ledger. Pack: `tools/.venvs/project/bin/python -I -B tools/scripts/build_audio_wave2_pack.py --batch 5 --ffmpeg <native ffmpeg>` (add `--check` to verify), on the same per-pack toolchain as batches 2 to 4. The builder gained batch 5 (three beds, three effects); batches 1 to 4 are unchanged.

| Asset | WAV SHA-256 |
|---|---|
| bgm_mist_archive master | `81e8b50b2cbdf505184abebf975c6761889922565f77160c2be82c767db2153c` |
| bgm_ember_delta master | `4c7225c5f905134d435c4635950653c1e03fc02098f3ebc55693744688372c50` |
| bgm_star_quarry master | `ea897d1ef1e26b9afdbe21e2575f3b5ce34335ce52c99dca4808252782ad70e9` |

| Cue | PCM SHA-256 (prefix) | WAV SHA-256 (prefix) | Frames | Onset / tail end (frame) | Peak dBFS | RMS dBFS | Window ms |
|---|---|---|---:|---|---:|---:|---|
| sfx_paper_rustle | `95d7f6dc170c1672…` | `0408e3128e0277ad…` | 48,510 | 1 / 47,608 | -6.463 | -26.972 | 800 + 300 = 1100 |
| sfx_slag_shift | `246d5374e89efb1b…` | `614ecd4f5ae9ca66…` | 66,150 | 10 / 60,852 | -6.03 | -22.01 | 1100 + 400 = 1500 |
| sfx_crystal_ring | `b3ade0dc0f9fbc4b…` | `548884b7bc23682a…` | 105,840 | 1 / 101,603 | -5.953 | -23.273 | 1400 + 1000 = 2400 |

## Beds

All three are stereo PCM16 at 44,100 Hz, 3,528,000 frames (80 s), loop `[0, 3528000)` half-open, notes and reverb wrapping modulo the loop. Meter: the engine's BS.1770 measure (not the pinned FFmpeg; the pack re-measures on FFmpeg 6.1.1 and the numbers agree to 0.1 LU). Reference beds are -21.7 to -23.2 LUFS and -7.1 to -9.9 dBTP.

| Bed | Tempo | LUFS-I | dBTP | LRA (LU) | Seam step L,R | Max step within 10 ms of the seam L,R | Three-repeat seam pass (Ogg / AAC) |
|---|---|---:|---:|---:|---|---|---|
| bgm_mist_archive | 72 BPM × 24 bars | -23.55 | -6.61 | 7.7 | [10, 8] | [415, 284] | True / True |
| bgm_ember_delta | 66 BPM × 22 bars | -22.89 | -6.555 | 9.54 | [-10, 10] | [28, 38] | True / True |
| bgm_star_quarry | 60 BPM × 20 bars | -22.61 | -8.272 | 6.94 | [76, 64] | [352, 362] | True / True |

The decoded Ogg and AAC loops were repeated three times and the joins compared with the body (pack evidence): the join step stays under the body's 99.99th percentile in every file, with no frames added or removed. The loop SNR of the codecs against the master is 28 to 38 dB.

The 1.6 to 5 kHz share of total energy is the register the enemy tells need: Mist Archive -24.4 dB, Ember Delta -36.0 dB, **Star Quarry -21.7 dB** (crystal partials). Star Quarry is the bed most likely to mask a tell.

## Effects

Mono PCM16, 44,100 Hz, digital zero on the first and last frame, peaks about -6 dBFS (core effects sit near -6). In the pack (FFmpeg 6.1.1) the sprite loudness is -21.8 LUFS-I (Ogg) and -21.9 (AAC), true peak -6.0 and -5.9 dBTP. Guard silence around every cue is below -37 dBFS in the first 2,048 frames and digital zero beyond them; decoded onset and tail agree with the master. Per-cue codec SNR: Ogg 10.2 to 32.6 dB, AAC 13.2 to 45.1 dB. **`sfx_paper_rustle` is the lowest (10.2 dB Ogg)**: noise-like material is the hardest case for a perceptual codec, so its codec versions need listening rather than trust.

## Not checked

- **Nothing was listened to.** No tool can sign a listening, and none was run to pretend to.
- Whether the proposed tempos, windows and arrangements suit the game (no encounter, room or landmark animation exists to try them against).
- Whether the enemy tells survive over each bed. Only band energy was measured.
- Engines other than Node v24.12.0 on macOS/Apple silicon; Windows and Linux builds of the pack; the pinned Windows FFmpeg (the pack is on the native macOS toolchain like batches 2 to 4).
- Gameplay timing against real landmark triggers; playback in the playables or the preview app (no cue is wired in).

## Listening list (done by the owner on 2026-11-23; see the status line)

The listening page is a session artifact (`branches_listening.html`), not committed. For each item note pass or the problem; then, if satisfied, sign in the Review tab.

1. **bgm_star_quarry**: can a light enemy tell (`sfx_tell_light`) and a heavy tell (`sfx_tell_heavy`) still be heard over the crystal rings? Is the open fifth too thin or the stone too sparse?
2. **bgm_mist_archive**: does the paper scrape read as paper, not as hiss? Does it call and answer? Is the E drone steady, not droning on?
3. **bgm_ember_delta**: does the pulse feel like a furnace, not a heartbeat? Do slag and crumble stay out of the way, and is the bed too bass-heavy on small speakers?
4. **Loop seams**: loop each bed three times through the seam on the master and on both codecs (Ogg and AAC). No click, no added beat, no bump in the drone.
5. **sfx_paper_rustle** against the harvest rustle (`sfx_harvest`): can you tell them apart in mono? Does it read as paper?
6. **sfx_slag_shift**: granular and low, not a noise burst? Does it separate from `sfx_crush` and `sfx_kiln`?
7. **sfx_crystal_ring**: does it ring as glass and not as the chime (`sfx_chime`)? Is 2.4 s too long for a landmark?
8. **Windows**: are the proposed 800 ms, 1,100 ms and 1,400 ms right for how long each landmark moment lasts in play, and the tails too long or short?
9. Mix: each effect over its own bed at the same monitoring level.
