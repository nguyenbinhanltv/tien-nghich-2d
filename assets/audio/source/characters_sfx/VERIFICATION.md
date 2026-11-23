# Characters wave (wave 5): three effects

**Listening status: no agent listened to any of this audio. Human listening approval is pending, and `assets/audio/listening_approvals.json` is untouched by this change.** Every statement below comes from code, hashes and numeric measurements, not from hearing the result.

Creator: Claude Code (Anthropic, `claude-sonnet-5-5`). The gate was opened by the owner's choice of 2026-11-23, recorded in `assets/review/audio_gate_decisions.json` (`characters_gate_2026-11-23`, statement "Coi như đã đủ, làm luôn", about the NPC handoff milestones, the pet bond and the form silhouettes). The art of the NPCs, pets and forms was approved on 2026-11-22. The owner settled no musical number: the sound direction is the Động Phủ row of `docs/AUDIO_DESIGN.md` (gesture and pitched responses, no dialogue recording). This wave has no beds.

## What is a proposal

**The lengths and the three gameplay windows below are the author's proposal. The owner has not set them.** They are written up as the "Characters proposal" in `docs/AUDIO_DESIGN.md`. If the owner dislikes any of them, change the patch and rebuild: every file here is reproducible from data.

| Cue | Plays at | Proposed |
|---|---|---|
| sfx_keeper_call | `npc.first_contact`, six NPCs | window 560 ms + tail 540 ms = 1,100 ms; two soft triangle notes D4, F#4, a wooden tock at 0 ms |
| sfx_pet_reply | `pet.reply`, six pets | window 4 frames × 120 ms = 480 ms + tail 420 ms = 900 ms; two rising FM chirps and a short low purr |
| sfx_form_shift | `future_form.change`, four forms | window 900 ms + tail 700 ms = 1,600 ms; octave glide, seal tick and E5 bell at 560 ms, open D4 A4 E5 settle |

**Where the windows come from.** The longtime manifest (`assets/manifest_longtime.json`, profiles `npc` and `pet`) gives the `interact` clip of the NPC as 4 frames at 140 ms (560 ms) and the `follow` clip of the pet as 4 frames at 120 ms (480 ms). These were copied by hand, not read through the clip contract by `studio_audio_render`: the clip route was not used. The pet patch states its window as `{frames: 4, frameMs: 120}`, the NPC and form patches as explicit milliseconds. No clip exists for a form change (the player profile has idle, walk, cast and hurt only), so 900 ms for `sfx_form_shift` is a stated length. The tails are the author's proposal.

## How the audio was made

With the project's own Studio audio engine (`studio/audio`, Node 24): `tools/generators/characters_sfx.mjs` calls `resolveWindow` then `renderDocument` for each patch. Only sine, triangle, saw and FM oscillators, filtered and amplitude-modulated noise and seeded MT19937: **no sample, recording, voice, soundfont, generative-audio model or PixelLab**. The rights string is the exact entry of the `licenceProfile.accepts` list ("Original procedural sound design created for Tien Nghich 2D."). The ledger records the tool as the Node Studio audio engine (the Python file is a wrapper that measures and writes the ledger).

## Reproducibility

`python -I -B tools/generators/characters_sfx.py --out <empty-directory>` (use `tools/.venvs/project/bin/python`, CPython 3.14.5, Node v24.12.0). `tools/tests/test_audio_characters.py` rebuilds all three into a scratch directory and compares every byte of the WAVs, `provenance.json` and `windows.json`. Pack: `tools/.venvs/project/bin/python -I -B tools/scripts/build_audio_wave2_pack.py --batch 7 --ffmpeg <native ffmpeg>` (add `--check` to verify), the same per-pack toolchain as batches 2 to 6 (FFmpeg 6.1.1 native, binary SHA-256 `468833134308b22b…`). Batch 7 has no beds.

| Cue | PCM SHA-256 (prefix) | WAV SHA-256 (prefix) | Frames | Onset / tail end (frame) | Peak dBFS | RMS dBFS | Window ms |
|---|---|---|---:|---|---:|---:|---|
| sfx_keeper_call | `6c83559311cec079…` | `854afc2b87bf04ee…` | 48,510 | 1 / 48,502 | -5.992 | -16.154 | 560 + 540 = 1100 |
| sfx_pet_reply | `38cee6962993999a…` | `0de78ebb1d232dbf…` | 39,690 | 1 / 33,469 | -5.994 | -17.567 | 480 + 420 = 900 |
| sfx_form_shift | `8c68dc46264ef23f…` | `274a27b8e1a14cdd…` | 70,560 | 8 / 70,553 | -6.003 | -19.330 | 900 + 700 = 1600 |

## Effects in the pack

Mono PCM16, 44,100 Hz, digital zero on the first and last frame, peaks at -6.0 dBFS (like the core effects). In the pack (FFmpeg 6.1.1) the sprite loudness is -17.6 LUFS-I (Ogg) and -17.7 (AAC), true peak -5.8 and -6.0 dBTP. Guard silence around every cue is digital zero. Per-cue codec SNR: Ogg 31.0 to 39.5 dB, AAC 34.3 to 56.6 dB; **`sfx_form_shift` is the lowest on both codecs (31.0 dB Ogg, 34.3 dB AAC)** (a noise band and a bright bell are the hard case for a perceptual codec), and `sfx_pet_reply` is next on Ogg (31.6 dB), so those two need listening in their codec versions rather than trust.

## What needs a human listening

Nobody listened. Open questions, all of them for ears:

1. Does `sfx_keeper_call` read as a greeting, in mono, and stay distinct from `sfx_confirm` (the NPC handoff)? Is the tock at 0 ms useful or fussy?
2. Does `sfx_pet_reply` read as a small animal answering, not a UI blip, and is the purr audible on small speakers (it sits under 400 Hz)? Do the same chirps suit all six pets, or does each species want a variant under the same ID?
3. Does `sfx_form_shift` read as a body changing shape and not as `sfx_breakthrough`? Is 1.6 s too long for a form change that may repeat?
4. Do the three proposed windows fit the animations they accompany (the NPC and pet clips are 560 and 480 ms; the form change has no clip)?
5. Whether the Ogg and AAC versions of `sfx_form_shift` and `sfx_pet_reply` hold up.

Nothing is wired into the game: no code plays these cues.
