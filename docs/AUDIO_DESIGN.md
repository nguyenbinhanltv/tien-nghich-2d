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
| 5 · Character lanes | 0 / 3 (authored and packed as `characters_v1`, listening pending) | After mode acceptance and approved character action sheets, add an NPC greeting, companion reply and form-change accent. Variants share these IDs across the six NPCs, six pets and four future forms. |

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
| Thư Khố Sương / Bến Tro / Mỏ Tinh Thạch | Mist Archive answers each phrase with paper friction. Ember Delta uses a soft furnace pulse and shifting slag. Star Quarry uses widely spaced stone harmonics and crystal ring. The three beds and landmark effects are delivered (`branches_v1`) and the owner listened to and approved all six on 2026-11-23. |
| Tầm Đạo Chi Lộ / Core | Current biome bed → boss trial → quiet exit. Wave 4 introduces aftermath music for the exit: `bgm_aftermath` is delivered (`modes_v1`) and approved by the owner on 2026-11-23. Chest opening, choosing a card and banking a reward have different cues. Leaving early uses the same bank confirmation. |
| Vô Tận Luân Hồi / Endless | Core music slot six supplies the dedicated Endless Samsara bed. Keep room for the five-floor marker (`sfx_floor_mark`, delivered and approved by the owner on 2026-11-23); silence during the bank-or-continue decision lets the confirmation read. |
| Trảm Tiên Đài / Boss Rush (`trial`) | Reuse the boss bed across three rounds. Oath selection (`sfx_oath`, delivered and approved by the owner on 2026-11-23), the adjudicator's tell and the defeat cadence are separate events. |
| Hộ Tông Đại Trận / Defense | Reuse the local biome until the dedicated wave ostinato arrives (`bgm_defense`, delivered and approved by the owner on 2026-11-23). A wave call precedes each wave (`sfx_wave_call`), a brittle crack marks core breach (`sfx_core_crack`) and a craft confirmation marks repair. The call (`sfx_wave_call`) and the crack (`sfx_core_crack`) are delivered and approved by the owner on 2026-11-23. |
| Động Phủ | Anchor return, kiln, planting/harvest, companion bond, NPC handoff and gate in the pilot palette. Use gesture/pitched responses for future character lanes. No dialogue recording is budgeted. The three character-lane effects are authored and packed (`sfx_keeper_call`, `sfx_pet_reply`, `sfx_form_shift`; `characters_v1`, listening pending). |

**How to read the manifest.** Each canonical asset, Longtime asset and indexed VFX belongs to one asset group or one fusion pair. Resolve its group in `families` and select the cue for the semantic event. The `silent` group covers static icons, scenery and passive HUD readouts. Opening a card, collecting a stone or triggering a breakthrough supplies the audible event; painting an icon or looping an aura adds no trigger. `modes` uses the authoritative mode keys and anchor IDs. `scenes` names tracked preview entry points for audition references. These bindings are production intentions.

The twelve canonical weapons and shots, fourteen Longtime base treasures and shots, and ten two-parent fusions and shots reuse attack and material families. Play the release once on launch and the impact once on contact. For a fusion, use the first parent's release and the second parent's impact. For example, Reed Verdict inherits Reed Blade's blade release and Seal Chisel's spirit impact. Keep a common timing envelope if a family gains a pitched or seeded variant. Each of the six wards reuses placement and break, with a distinct pulse family where appropriate. A cast, shot, hit spark and enemy reaction can depict the same contact: choose the receiver's material impact once, then play a distinct outcome only on stagger or defeat. Grant the boss tell priority over dense volleys. Seeded takes, aliases, alternate mixes, stems and encoded packs consume zero additional cue slots.

## Branches proposal (wave 3, authored and approved 2026-11-23)

**Owner decision.** On 2026-11-23 the owner chose "Dùng câu định hướng làm brief": the one-sentence brief for each branch in [Musical and event coverage](#musical-and-event-coverage) is the settled brief, and the author proposes the numbers. The decision is recorded in [`assets/review/audio_gate_decisions.json`](../assets/review/audio_gate_decisions.json). **The tables below are the author's proposal**; the owner then listened to the six cues and approved them ("Đã Nghe và duyệt", 2026-11-23, recorded in `assets/audio/listening_approvals.json`). That approval covers the cues as delivered, not a change to the numbers if the game later needs different windows.

| Bed | Tempo, meter, length | Tonal center and scale | Loop `[0, end)` frames | Arrangement |
|---|---|---|---:|---|
| `bgm_mist_archive` | 72 BPM, 4/4, 24 bars, 80 s | E minor pentatonic | 3,528,000 | A soft pluck states a two-bar phrase; a band-passed noise "page" scrape and short flicks answer it in the next two bars. Triangle drone E2+B2, then A2+E3 from bar 17. |
| `bgm_ember_delta` | 66 BPM, 4/4, 22 bars, 80 s | G minor pentatonic | 3,528,000 | A soft furnace pulse on beats 1 and 3, a banked drone, sparse FM lantern notes, slow low-passed slag slides and crumble grit. |
| `bgm_star_quarry` | 60 BPM, 4/4, 20 bars, 80 s | C major pentatonic | 3,528,000 | Struck-stone harmonics four seconds apart over a quiet open fifth C2+G2; five short crystal-ring phrases (FM, inharmonic partial) in 3.4 s of room. |

Each bed follows the `bgm_dong_phu` reference (60 to 90 s, original pentatonic figure, A4 = 440 Hz, a plucked phrase against a sustained low fifth, reverb carried across the loop boundary). Notes, tails and reverb wrap modulo the loop, so there is no crossfade. The enemy tell keeps rests: the pluck and the paper answers alternate with empty bars, and no voice plays a continuous melody. The Star Quarry crystal rings reach into the 1.6 to 5 kHz band (about -21.7 dB of total energy, against -24.4 dB for Mist Archive and -36.0 dB for Ember Delta), so that bed is where a tell is most likely to be masked: it is first on the listening list.

| Effect | Window proposed (F9) | Tail | Total | Reasoning |
|---|---:|---:|---:|---|
| `sfx_paper_rustle` | 800 ms | 300 ms | 1,100 ms | A page lifts and settles when the player passes a Mist Archive shelf landmark. |
| `sfx_slag_shift` | 1,100 ms | 400 ms | 1,500 ms | A slag bank gives way over about a second and settles. |
| `sfx_crystal_ring` | 1,400 ms | 1,000 ms | 2,400 ms | A struck crystal vein rings, then fades; the ring is the event. |

The windows are set by `window` blocks in the patches (`resolveWindow`, [studio/audio/README.md](../studio/audio/README.md)) with `ms` and `tailMs`, not from a clip contract, because no landmark animation clip exists yet. When one does, replace the block with `{clip: ...}` and re-render. Each effect is mono PCM16 at 44.1 kHz with digital zero at both ends, peak near -6 dBFS like the delivered core effects. They are one landmark sound per biome, one per branch, as the wave table says.

**Rights and tools.** The score and patches are project data, rendered by the project's own Studio audio engine (`studio/audio`: oscillators, additive and FM voices, filtered noise, seeded MT19937, impulse reverb). No sample, recording, soundfont, generative-audio model or PixelLab was used. [Sources and the listening list](../assets/audio/source/branches_sfx/VERIFICATION.md) · [Pack report](../assets/audio/packs/branches_v1/PACK_REPORT.md)

## Modes proposal (wave 4, authored and approved 2026-11-23)

**Owner decision.** On 2026-11-23 the owner answered the orchestrator's question about the trial round (Trảm Tiên Đài) and defense wave (Hộ Tông Đại Trận) milestones with "Coi như đã ký, làm luôn": the milestones count as signed and the Modes wave is produced. The direction is the existing sentence of each mode in [Musical and event coverage](#musical-and-event-coverage). The decision is recorded in [`assets/review/audio_gate_decisions.json`](../assets/review/audio_gate_decisions.json) (`modes_gate_2026-11-23`). **The tables below are the author's proposal**: the owner set none of the numbers, but listened to all six cues on 2026-11-23 and approved them ("Duyệt hết", recorded by an agent as `modes_v1` in [`assets/audio/listening_approvals.json`](../assets/audio/listening_approvals.json), pinned to the master hashes). The gate decision itself signs no audio and approves no art.

| Bed | Tempo, meter, length | Tonal center and scale | Loop `[0, end)` frames | Arrangement |
|---|---|---|---:|---|
| `bgm_aftermath` | 48 BPM, 4/4, 16 bars, 80 s | D major pentatonic | 3,528,000 | Mostly rests, the quiet exit after the trial. A soft FM bell states a falling phrase every four bars (bars 1, 5, 9 an octave lower, 13); a low-passed breath answers in the empty bars; triangle drone D2+A2, then B2+F#3 from bar 9. |
| `bgm_defense` | 96 BPM, 4/4, 32 bars, 80 s | A minor pentatonic | 3,528,000 | A low drum on beats 1 and 3 and a four-partial stone ostinato in eighth notes with rests, a wave bell at the end of each eight-bar group, off-beat shaker in bars 17 to 28, saw-and-sub drone A1+E2 then D2+A2. Every voice except the drones enters an eighth note after the loop start (a bed that began on an onset failed the Ogg seam rule). |

Both beds follow the `bgm_dong_phu` reference (60 to 90 s, original pentatonic figure, A4 = 440 Hz, reverb carried across the loop boundary, no crossfade). The ostinato rests in the last bar of every group, so a wave call and an enemy tell have room; the 1.6 to 5 kHz tell register holds almost nothing in either bed (the engine's band report: -40 dB or less). `bgm_defense` is bass-heavy for that reason, which is where its risk on small speakers lies.

| Effect | Window proposed (F9) | Tail | Total | Reasoning |
|---|---:|---:|---:|---|
| `sfx_floor_mark` | 650 ms | 600 ms | 1,250 ms | The five-floor mark is a bronze seal pressed into the floor: the documented `press` clip of `lt_fx_stamp` lasts 650 ms and its `land` event falls at 120 ms, where the thud and the bell body start. |
| `sfx_oath` | 650 ms | 800 ms | 1,450 ms | The vow shares that `press` clip and its 120 ms landing, but is a held, pitched swell (a fifth rising from A) with a settling partial: not a strike. |
| `sfx_wave_call` | 900 ms | 500 ms | 1,400 ms | Two horn notes, a rising fifth (E3, B3), below the bronze warning register so the call does not read as an enemy tell. There is no clip (the wave clock is an icon), so 900 ms is a stated length. |
| `sfx_core_crack` | 770 ms | 480 ms | 1,250 ms | The documented `breach` clip of `lt_fx_core_breach` lasts 769 ms with `breach` and `shake:3` on frame 0: the snap and the low thump open at 0 ms, shards fall, a dull settle closes it. |

The windows are set by `window` blocks in the patches (`resolveWindow`, [studio/audio/README.md](../studio/audio/README.md)) with `ms` and `tailMs`, not read from the clip contract by the render tool; the clip lengths above are copied by hand from [LONGTIME_VFX.md](LONGTIME_VFX.md). Each effect is mono PCM16 at 44.1 kHz with digital zero at both ends and a peak of -6 dBFS like the delivered core effects.

**Rights and tools.** The scores and patches are project data, rendered by the project's own Studio audio engine (`studio/audio`: oscillators, additive and FM voices, filtered noise, seeded MT19937, impulse reverb). No sample, recording, soundfont, generative-audio model or PixelLab was used. [Sources and the listening list](../assets/audio/source/modes_sfx/VERIFICATION.md) · [Pack report](../assets/audio/packs/modes_v1/PACK_REPORT.md)

## Characters proposal (wave 5, authored 2026-11-23, listening pending)

**Owner decision.** On 2026-11-23 the owner answered the orchestrator's question about the NPC handoff milestones, the pet bond and the form silhouettes with "Coi như đã đủ, làm luôn": they count as sufficient (the art of the NPCs, pets and forms was approved on 2026-11-22) and the Characters wave is produced. The direction is the Động Phủ row of [Musical and event coverage](#musical-and-event-coverage): gesture and pitched responses, no dialogue recording. The decision is recorded in [`assets/review/audio_gate_decisions.json`](../assets/review/audio_gate_decisions.json) (`characters_gate_2026-11-23`). **Everything in the table below is the author's proposal, not an owner decision**; the owner may change any of it after listening. The decision signs no audio and approves no art; nothing here is a listening approval. This wave has no beds.

| Effect | Where it plays | Window proposed (F9) | Tail | Total | Reasoning |
|---|---|---:|---:|---:|---|
| `sfx_keeper_call` | `npc.first_contact`; shared by the six NPCs | 560 ms | 540 ms | 1,100 ms | The NPC profile's `interact` clip is 4 frames at 140 ms = 560 ms. The call opens with a wooden tock at frame 0 and states two soft triangle notes, D4 then F#4 (a rising major third), low enough to read as a greeting, not a warning or the `sfx_confirm` handoff. |
| `sfx_pet_reply` | `pet.reply`; shared by the six pets | 480 ms (4 × 120 ms) | 420 ms | 900 ms | The pet profile's `follow` clip is 4 frames at 120 ms. Two quick rising chirps (A5 to D6, C6 to F6, FM sines with fundamentals at or below 1.4 kHz) and a short low purr; pitched and playful, unlike a pickup or a hit. |
| `sfx_form_shift` | `future_form.change`; shared by the four future forms | 900 ms | 700 ms | 1,600 ms | No clip exists for a form change (the player profile has idle, walk, cast and hurt only), so 900 ms is a stated length. A low saw glides up an octave through an opening low-pass with a rising band of air, gathers into a seal tick and an FM bell on E5 at 560 ms, then an open D4, A4, E5 chord settles. Rising and pitched, with no strike and no fanfare, so it does not read as `sfx_breakthrough`. |

The windows are set by `window` blocks in the patches (`resolveWindow`, [studio/audio/README.md](../studio/audio/README.md)): explicit `ms` for the keeper call and the form shift, and `{frames, frameMs}` for the pet reply. The clip lengths above are copied by hand from [`assets/manifest_longtime.json`](../assets/manifest_longtime.json) (profiles `npc` and `pet`), not read through the clip contract by the render tool. Each effect is mono PCM16 at 44.1 kHz with digital zero at both ends and a peak of -6 dBFS like the delivered core effects. One variant per ID: the same cue serves every NPC, pet and form.

**Rights and tools.** The patches are project data, rendered by the project's own Studio audio engine (`studio/audio`: oscillators, FM voices, filtered noise, seeded MT19937). No sample, recording, voice, soundfont, generative-audio model or PixelLab was used. [Sources and the listening list](../assets/audio/source/characters_sfx/VERIFICATION.md) · [Pack report](../assets/audio/packs/characters_v1/PACK_REPORT.md)

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
