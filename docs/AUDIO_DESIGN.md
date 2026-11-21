# Tiên Nghịch 2D audio production plan

The first listening milestone is a return to Động Phủ. A quiet plucked phrase leaves room for the chest latch, the spirit-stone pickup and the longer rise of a realm breakthrough. The full score follows Vương Lâm from the restrained courtyard through Huyết Hải and into the weight of the Ancient God ruins. Combat sounds announce an approaching threat, contact, and its outcome. Write each so a listener can identify the event in mono.

The [audio manifest](../assets/audio_manifest.json) reserves **6 music and 40 effects IDs** for core production. Its three later allocations add **5 music and 10 effects**, for **11 music and 50 effects** across the roadmap. Every entry starts planned and staged. Delivered items default to **Approved** under the project convention once their source, masters, rights and QA evidence are attached. Graphic readiness and prototype playback confer no audio delivery status. [Core GDD](GDD.md) · [Longtime GDD](LONGTIME_GDD.md)

## Production waves

| Wave | New music / effects | Work and dependency |
|---|---:|---|
| 1 · Abode listening pilot | 1 / 8 | Establish tuning, rights ledger and a reproducible nine-cue reference. The pilot IDs are a subset of the core budget. |
| 2 · Core | 5 / 32 | After pilot master and both codec auditions pass, finish three chapter beds, boss and Endless Samsara music. Finish the remaining 21 combat and 11 progression/UI effects. Core totals are 25 combat and 15 progression/UI. |
| 3 · Branches | 3 / 3 | After core acceptance and branch encounter briefs, write one bed and one landmark sound per Longtime biome. |
| 4 · Modes | 2 / 4 | After branch acceptance and mode milestone sign-off, score aftermath and Defense. Add five-floor, oath, wave and core-breach messages. Boss Rush retains the boss score. |
| 5 · Character lanes | 0 / 3 | After mode acceptance and approved character action sheets, add an NPC greeting, companion reply and form-change accent. Variants share these IDs across the six NPCs, six pets and four future forms. |

### Wave 1 listening brief

Write `bgm_dong_phu` for 60–90 seconds. A suggested first pass is 24 bars in 4/4 at 80 BPM (72 seconds, 3,175,200 sample frames at 44.1 kHz). Use D as the tonal center, A4 = 440 Hz, and an original D–F–G–A–C figure. Trade a muted pluck against breath and a low sustained fifth. Leave one bar of open space after the cadence. Carry reverb across the loop boundary during the offline render. Document the final tempo map and actual loop points if the arrangement changes.

| Pilot cue | Perceptual acceptance |
|---|---|
| `sfx_dash` | Dash. A short, broad air rush with an immediate onset. |
| `sfx_blade` | Flying sword whoosh. A thin metallic whistle sweeps past and decays before contact. |
| `sfx_hit_flesh` | Hit. A dry impact carries the contact transient independently of the sword release. |
| `sfx_seal_lock` | Restriction seal lock. Two tightening pulses close with a final latch when the binding takes hold. |
| `sfx_pickup` | Spirit-stone pickup. A small rising interval identifies collection through the music bed. |
| `sfx_chest` | Chest open. A wooden catch and lid movement precede the pickup. |
| `sfx_confirm` | Skill card select. One restrained confirming pluck on commitment. |
| `sfx_breakthrough` | Realm breakthrough. A low intake resolves upward into a sustained harmonic. |

AGY auditions all eight effects alone and over the bed at matched monitoring gain, including a mono fold-down. Compare dash against the flying sword whoosh, seal lock against hit, and pickup against card select in a blind A/B. Log any confusion. Loop the bed three times through the marked seam on master and both decoded derivatives. Accept when onset and tail are intact, the seam has no audible click or added beat, peaks stay below clipping, and the two builds and all nine IDs reconcile. Record meter readings, encoder/decoder versions and the listener's result.

## Musical and event coverage

| Location or mode | Score and events |
|---|---|
| Hằng Nhạc Phái | Sparse bamboo-like breath and alternating dry plucks. Let the light enemy tell cut through the rests. Applies to `ts_hengyue` and the courtyard reference scene. |
| Huyết Hải | Bowed low pulse and unstable upper partial. Leave the bronze warning register open. Applies to `ts_blood_valley` and the Blood Sea reference scene. |
| Cổ Thần Chi Địa | Slow displaced stone percussion and a low open fifth. Break the pulse at the boss transition. |
| Thư Khố Sương / Bến Tro / Mỏ Tinh Thạch | Mist Archive answers each phrase with paper friction. Ember Delta uses a soft furnace pulse and shifting slag. Star Quarry uses widely spaced stone harmonics and crystal ring. Until those beds are delivered, audition Hengyue, Blood Sea and Ancient God respectively as temporary references. |
| Tầm Đạo Chi Lộ / Core | Current biome bed → boss trial → quiet exit. Wave 4 introduces aftermath music for the exit. Chest opening, choosing a card and banking a reward have different cues. Leaving early uses the same bank confirmation. |
| Vô Tận Luân Hồi / Endless | Core music slot six supplies the dedicated Endless Samsara bed. Keep room for the five-floor marker; silence during the bank-or-continue decision lets the confirmation read. |
| Trảm Tiên Đài / Boss Rush (`trial`) | Reuse the boss bed across three rounds. Oath selection, the adjudicator's tell and the defeat cadence are separate events. |
| Hộ Tông Đại Trận / Defense | Reuse the local biome until the dedicated wave ostinato arrives. A wave call precedes each wave, a brittle crack marks core breach and a craft confirmation marks repair. |
| Động Phủ | Anchor return, kiln, planting/harvest, companion bond, NPC handoff and gate in the pilot palette. Use gesture/pitched responses for future character lanes. No dialogue recording is budgeted. |

**How to read the manifest.** Each canonical asset, Longtime asset and indexed VFX belongs to one asset group or one fusion pair. Resolve its group in `families` and select the cue for the semantic event. The `silent` group covers static icons, scenery and passive HUD readouts. Opening a card, collecting a stone or triggering a breakthrough supplies the audible event; painting an icon or looping an aura adds no trigger. `modes` uses the authoritative mode keys and anchor IDs. `scenes` names tracked preview entry points for audition references. These bindings are production intentions.

The twelve canonical weapons and shots, fourteen Longtime base treasures and shots, and ten two-parent fusions and shots reuse attack and material families. Play the release once on launch and the impact once on contact. For a fusion, use the first parent's release and the second parent's impact. For example, Reed Verdict inherits Reed Blade's blade release and Seal Chisel's spirit impact. Keep a common timing envelope if a family gains a pitched or seeded variant. Each of the six wards reuses placement and break, with a distinct pulse family where appropriate. A cast, shot, hit spark and enemy reaction can depict the same contact: choose the receiver's material impact once, then play a distinct outcome only on stagger or defeat. Grant the boss tell priority over dense volleys. Seeded takes, aliases, alternate mixes, stems and encoded packs consume zero additional cue slots.

## Source, rights and delivery

Codex owns original BGM composition and SFX synthesis. Use a versioned note/tempo score or MIDI with a pinned FluidSynth build and audited SF2. Record the soundfont's origin, hash, license text, attribution and permitted rendered-output use. If those terms are unresolved, use original Codex DSP instruments. For effects, save ZzFX parameters with the exact implementation and license or use a small deterministic Codex DSP patch. Pin oscillator phase, sample rate, random seed, envelopes, gain, render toolchain and any dither. Stage original PCM and independently reproduce it before encoding.

For each delivered ID record creator, source revision, relative input paths, SHA-256 for score/patch, soundfont or samples, master PCM and each codec output, exact rebuild command, tool versions, rights evidence and credits. Include tempo, tuning, key, channel layout, measured peak/loudness, onset, tail, and loop boundaries where applicable. Check the provenance of every input. Use local AssetCat word search and `show` for scoped catalog discovery. Record pack/file references, license file, AI status and reason, and reconcile them against the source ledger. Unknown catalog fields remain visible. The silent WAV in the AssetCat setup test is a lookup fixture. [AssetCat workflow](../.agents/skills/tien-nghich-assetcat/SKILL.md)

AudioCraft is an optional isolated research lane. Its upstream distribution distinguishes MIT code from noncommercial model weights. Before any experiment, review the exact checkpoint, weight license, input rights, intended use and output restrictions. Keep experiments outside the production packs pending a documented rights decision; the core plan uses deterministic synthesis and scoring. [Upstream weight license](https://github.com/facebookresearch/audiocraft/blob/main/LICENSE_weights)

### Masters, packing and migration

- Master at 44,100 Hz in lossless integer PCM WAV (24-bit target). Keep music stereo and short effects mono unless localization requires stereo. Record integer **sample frames per channel**. Mark one-shots with onset and tail end, and loops with half-open `[start, end)` boundaries. Align phrase length to the score and inspect the join on both channels.
- Keep music loops individually addressable. AGY builds effects sprites with explicit guard silence and a versioned cue table. Each entry carries stable cue ID, variant, master hash, pack revision, codec, sample rate, decoded start/end and any loop points. Store both the source-frame map and each codec's decoded-frame map. Never infer offsets from byte position or rounded milliseconds.
- Render Ogg Vorbis and AAC-LC in M4A from the same masters with pinned FFmpeg settings. Capture ffprobe stream metadata and packet side data where available. Decode each **whole pack** with the documented decoder. Measure head delay/priming, tail padding and actual sample count; account for edit lists or decoder trimming exactly once. Compare decoded onset, boundary and tail against the master, and listen to adjacent sprite entries for bleed. Recalculate the markers independently for each codec and decoder convention. Test loop alignment by concatenating the decoded marked section and checking the seam by ear and waveform. Playback latency depends on the consumer and device. [ffprobe documentation](https://ffmpeg.org/ffprobe.html)
- Keep ID resolution stable when promoting loose pilot masters into packs. Add variant keys beneath an existing ID; keep retired IDs as versioned aliases only where their meaning survives. Rebuild and publish a pack and its matching marker table together. Reject an unknown schema or hash mismatch and retain the previous compatible pack. Compare all previously delivered IDs and their decoded excerpts on cumulative pack rebuilds.
- The proposed **Audio Inspector** offers listen, loop and level-matched A/B of master versus decoded release. It reads the pack revision and marker units for the selected codec. The production and independent QA workflow ends at offline audition.

### Legacy references

At the planning base `583fa784`, the tracked Blood Sea Web Audio score defines seven short two-partial sketches. Use `dodge` for dash timing, `evade` for successful avoidance, `counterHit` for the counter accent, `hurt` for player hurt, `awaken` for the boss tell, `releasing` for a release contour and `falling` for a defeat contour. These are reference aliases with zero budget weight. They lack pilot PCM masters, score-to-master hashes, decoded-pack evidence and delivery records. The browser test references the prototype. The tracked inventory contained no standalone production music or effects masters. [Legacy score](../studio/blood-sea/sound.mjs)

## PR sequence and owners

1. **Planning, Codex.** Land this document, the planned cue manifest and the offline contract check. Run `python -I tools/scripts/check_audio_plan.py` from the checkout.
2. **Pilot authoring, Codex.** Introduce the planned `xianxia-audio-director` skill for thematic briefs, cue allocation and score provenance, and `procedural-sfx-synthesizer` for seeds, patches and master checks. Deliver the nine pilot sources and reproducible masters in a dedicated production PR.
3. **Pilot packaging, AGY.** Independently rebuild and audition, then deliver decoded evidence, marker tables and a compatibility report. The planned `mobile-audio-sprite-packer` skill documents the repeatable pack workflow. A separate listening-only Inspector PR may consume those fixtures.
4. **Core completion, then extensions.** Codex delivers source batches against the wave gates above. AGY independently checks each exact source SHA and submits cumulative package updates. A change to scope or an additional unique cue gets a manifest budget revision before production.
