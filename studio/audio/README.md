# Audio engine (P4)

A declarative, deterministic audio synthesiser in pure Node 24 (ES modules, no dependencies, no build). An agent
creates a sound effect or a music bed by sending **data**: a *patch* (one-shot) or a *score* (loop). The engine renders
PCM16 WAV, measures it, and draws a waveform and a spectrogram so the agent can *look* at the result.

**No agent listened to anything.** Every claim here is a number or a picture. Listening sign-off stays a human step
in the Review tab; nothing in this directory can perform it.

```
patch / score (JSON) ──validate──► render ──► WAV bytes + PCM
                                       └────► measure ──► peak, true peak, RMS, LUFS, onset/tail, seam, scale check
                                       └────► images  ──► waveform.png, spectrogram.png + axis mapping
delivered WAV / other render ───────────────► compare ──► envelope, spectrum, loudness differences
```

Nothing project-specific lives here (`tests/literals.test.mjs` enforces it). The sample rate belongs to the project
(see [Project sample rate](#project-sample-rate)); palette, tuning and scale arrive in the document.

## Run it

```sh
node --test 'studio/audio/tests/*.test.mjs'
node studio/audio/cli.mjs validate studio/audio/examples/zap.patch.json
node studio/audio/cli.mjs render   studio/audio/examples/dusk.score.json --out /tmp/dusk.wav --images /tmp/dusk-img --report /tmp/dusk.json
node studio/audio/cli.mjs analyze  /tmp/dusk.wav --loop 0:470400 --out-dir /tmp/dusk-img   # without --out-dir nothing is written
```

`render` accepts `--project <root>`: the document's sample rate is then checked against (or filled from) the project's
packed audio, and `--out` is refused when it lies inside the project's delivered audio directories. JSON goes to stdout;
a problem goes to stderr as `{"error": ...}` with exit code 1.

## Library API (`studio/audio/index.mjs`)

All functions are synchronous and pure except `projectAudio` (reads the pack). Documents are plain objects; none is mutated.

| call | returns |
| --- | --- |
| `validateDocument(doc)` / `validatePatch` / `validateScore` | `string[]` of issues with a JSON-path prefix (`$.layers[2]: ...`); empty is valid |
| `renderDocument(doc)` (`renderPatch`, `renderScore`) | `{kind, id, sampleRate, channels, frames, pcm: Int16Array[], wav: Buffer, loop: null \| {start, end}}`; a score also has `scale` and `events`. Throws a coded `Error`, with `.issues` for invalid documents |
| `analyze(input, {loop?, images?, width?, spectrum?})` | `{source, measurements, pitch?, images?: {waveform, spectrogram}}`. `input` is a WAV `Buffer`, a render result, decoded audio or a document. `images.*` is `{png: Buffer, width, height, axes}` |
| `measure(audio, {loop?, spectrum?})` | the measurement record below; `audio` is `{sampleRate, samples: Float64Array[], pcm16?}` (`decodeWav` produces it) |
| `pitchCheck(scoreDoc)` | scale membership and measured pitch of every distinct pitched voice |
| `compare(reference, candidate, {envelopeMs?, floorDb?})` | envelope, spectrum and loudness differences plus sample-exact facts |
| `waveformPng(audio, opts)`, `spectrogramPng(audio, opts)` | the pictures alone |
| `decodeWav(buf)`, `encodeWav(pcm, rate)`, `audioFromPcm(pcm, rate)` | WAV I/O (PCM16/24/32 and float32 in; canonical 44-byte-header PCM16 out) |
| `projectAudio(root)`, `applyProjectRate(doc, rate)`, `insideProtected(root, dirs, path)` | project sample rate and the delivered-audio guard |
| `audioSchema()`, `schemaPath` | `schemas/audio.schema.json`, checked by `studio/core/json-schema.mjs` |

### Suggested MCP mapping

* `studio_audio_render {document, project?}` → `projectAudio(root)` → `applyProjectRate` → `validateDocument` →
  `renderDocument` → write the WAV to a scratch/experiments location (never under the protected directories;
  `insideProtected` is the guard) → return `{id, kind, frames, sampleRate, loop, scale}` plus `analyze(render)`'s
  `measurements`, `pitch` and the two PNGs.
* `studio_audio_analyze {file | document, loop?}` → `analyze(...)`; return the measurements and PNGs. The `axes` objects tell
  an agent which pixel is which time or frequency.
* Errors: surface `error.code` and `error.issues`. Codes: `invalid_document`, `invalid_patch`, `invalid_score`,
  `layer_overflow`, `endpoint`, `clip`, `silent`, `out_of_scale`, `sample_rate_mismatch`, `mixed_sample_rates`, `bad_wav`, `bad_input`.
* The engine never decides approval. The MCP server must keep exposing no tool that signs a listening.

## Patch format: `studio.audio.patch` (one-shot)

Schema: `$defs.patch` in [`schemas/audio.schema.json`](schemas/audio.schema.json). Example: [`examples/zap.patch.json`](examples/zap.patch.json).

```jsonc
{
  "schema": "studio.audio.patch", "version": 1,
  "id": "zap",                      // [A-Za-z0-9][A-Za-z0-9_.-]*
  "sampleRate": 44100,              // required; must equal the project's rate when the project has audio packs
  "channels": 1,                    // 1 (default) or 2
  "seed": 4242,                     // integer >= 0; layer i draws from MT19937(seed + i)
  "durationMs": 220,                // frames = round-half-even(durationMs * rate / 1000)
  "trim": 0.7,                      // multiplies the summed bus before PCM conversion (default 1)
  "gains": [1, 1],                  // channels 2 only: default per-channel gain for layers without their own
  "layers": [ /* layer, see below */ ]
}
```

A patch must render **digital zero at its first and last frame** and must not clip or be silent; otherwise
`renderPatch` throws (`endpoint`, `clip`, `silent`) with advice. Give the layer that ends last a linear `releaseMs` and
the first one a non-zero `attackMs`.

### Layer (shared by patches and score instruments)

```jsonc
{
  "type": "osc" | "noise",
  "startMs": 0, "ms": 180,            // patches only: placement and length (startMs + ms must fit durationMs)
  "gain": 1, "gains": [l, r],         // gains: per-channel, stereo patches only
  "env": {                            // all optional
    "attackMs": 4,                    //   linear ramp min(1, frame/attackFrames); with attackShape "exp": 1 - exp(-t/attackMs)
    "attackShape": "linear" | "exp",
    "decayMs": 73,                    //   multiplies exp(-frame/decayFrames); decayFrames = round-half-even(ms*rate/1000)
    "releaseMs": 55,                  //   releaseShape "linear" (default): ramp to 0 over the last releaseMs of the layer
    "releaseShape": "linear" | "exp", //   "exp" (notes only): exp(-(t - gate)/releaseMs) after the note's gate
    "level": {"from": .155, "to": .045, "tauMs": 90}   // multiplier to + (from - to) * exp(-t/tau)
  },
  "am": {"hz": 9, "depth": 0.4},      // flutter: multiplies 1 - depth * (0.5 + 0.5 cos(2 pi hz t))
  "filters": [ /* applied in order to the raw source, before the envelope */ ],

  // osc only
  "wave": "sine" | "triangle" | "saw" | "square" | "additive",   // saw/square are PolyBLEP band-limited
  "hz": 210, "endHz": 74,             // exponential glide over the layer's length; or, in a score, "ratio"/"endRatio" times the note
  "fm": {"ratio": 1.491, "index": 0.38},          // sin(phase + index * sin(phase * ratio)); wave "sine" only
  "scoop": {"depth": -0.009, "tauMs": 60},        // pitch multiplier 1 + depth * exp(-t/tau)
  "vibrato": {"hz": 4.8, "depth": 0.002, "riseMs": 333},   // pitch multiplier 1 + depth * sin(2 pi hz t) * (1 - exp(-t/riseMs))
  "harmonics": [{"n": 1, "gain": 1, "decay": 4.2}, ...]   // wave "additive"; decay in 1/s
           // or {"count": 7, "rolloff": 1.3, "pickPosition": 0.21, "decayBase": 2.9, "decayStep": 1.3}:
           //    partial n has gain sin(pickPosition*pi*n)/n^rolloff and decay decayBase + n*decayStep
  "partialPhase": {"slope": 0.35, "random": 0.5}  // additive: phase offset slope*n plus uniform(0, random) from the layer's stream
}
```

Filters: `{type: "lowpass1"|"highpass1", hz, endHz?}` (one-pole, optional exponential sweep);
`{type: "band", lowHz, highHz}` (difference of two one-poles: low pass at `highHz` minus low pass at `lowHz`; a gust band);
`{type: "biquad", mode: "lowpass"|"highpass"|"bandpass"|"notch", hz, q?, endHz?}` (RBJ cookbook, optional sweep);
`{type: "box", taps: N}` and `{type: "fir", taps: [...], align?: "same"|"causal"}` (non-causal "same" matches `numpy.convolve(..., "same")`).
Filters apply to oscillators too, so `saw` through a sweeping `biquad` lowpass is plain subtractive synthesis.

Frequencies at or above Nyquist are validation errors. `ms`, `decayMs` and the like are converted to whole frames with
round-half-to-even (the rule CPython and numpy use); the converted patches in `assets/experiments/audio_engine/` depend on it.

## Score format: `studio.audio.score` (loop)

Schema: `$defs.score`. Example: [`examples/dusk.score.json`](examples/dusk.score.json).

```jsonc
{
  "schema": "studio.audio.score", "version": 1, "id": "dusk", "sampleRate": 44100, "seed": 99,
  "tempoBpm": 90, "beatsPerBar": 4, "tuningA4Hz": 440,
  "key": {"tonic": "A", "scale": "minor-pentatonic", "enforce": true},   // or {"pitchClasses": [9, 0, 2, 4, 7]}
  "loop": {"bars": 4},                // or {"frames": N}; length = round-half-even(bars * beatsPerBar * (60/tempo) * rate)
  "instruments": {
    "pluck": {"gains": [0.5, 0.35],   // left/right gain (default [1, 1]); the bed is always stereo
              "tailMs": 900,          // each note lasts gate + tailMs (default 600)
              "fadeOutMs": 10,        // linear 1 -> 0 over the last frames of every note
              "pitched": true,        // default: true when any layer has "ratio"/"endRatio"
              "layers": [ /* layers; osc uses "ratio" (times the note frequency) or "hz" */ ]}
  },
  "patterns": {"walk": [[0, "A3", 0.5, 0.8], ...]},     // events: [beat, note, gateBeats, velocity, instrument?] or {beat, note, gate, vel, instrument}
  "tracks": [
    {"instrument": "pluck", "events": [[0, "A3", 1, 0.9]],               // beats from the loop start
     "sequence": [{"bar": 0, "pattern": "walk", "transpose": 0}]}        // pattern placed at a bar; transpose in semitones
  ],
  "reverb": { ... },                  // see below
  "masterGain": 1
}
```

* `note` is a MIDI number or a name (`"G3"`, `"F#4"`, `"Bb2"`; C4 = 60); frequency is `tuningA4Hz * 2^((midi - 69)/12)`.
* Known scales: chromatic, major, minor, dorian, phrygian, lydian, mixolydian, major-pentatonic, minor-pentatonic, hirajoshi,
  or explicit `pitchClasses`. With `key.enforce: true` an out-of-scale pitched note is an error (`out_of_scale`); otherwise the
  render carries `scale: {declared, ok, outOfScale: [...]}`.
* **Half-open loop `[0, end)`.** Every note and its tail is added modulo the loop length, so a note near the end rings across
  the join and the join needs no crossfade. Notes do not stop at the end. The loop has no lead-in: frame 0 may already be sounding.
* Event order is the summation order (tracks in document order, then events, then sequence entries); it is part of the
  determinism contract (see below).
* Each note draws its layers from `MT19937([seed, eventIndex, layerIndex])`.

### Reverb (`reverb`)

* `{"type": "taps", "taps": [{"ms", "gain", "cross"}]}` copies of the dry mix, delayed, optionally with left and right swapped.
  Circular in a loop (this is what the delivered Hengyue bed uses).
* `{"type": "feedback", "combs": [{"ms","feedback","damp"}], "allpasses": [{"ms","gain"}], "wet", "dry", "inputGain", "spreadMs"}`
  a Schroeder room (damped parallel combs, series all-passes, right channel delays offset by `spreadMs`). For a loop the engine runs
  warm-up passes until the slowest comb has decayed 80 dB, so the tail is exactly periodic across the join.
* `{"type": "impulse", "seconds", "decayPerSecond", "seeds": [L, R], "attackMs", "smoothTaps", "wet", "dry"}` FFT convolution with a
  seeded gaussian-noise response of unit energy (Box-Muller over MT19937). In a loop the tail past the end folds onto the start.
  It resembles the noise-IR reverbs of three delivered beds (boss trial, Ancient God, Endless) in kind but **not sample for sample**: numpy's generators are not reproduced.

## Determinism contract

Two renders of one document are **byte-identical**. How:

* Seeded integer PRNG: MT19937 with CPython-compatible `init_by_array` seeding (`random.Random(n)` and `new Mt19937(n)` give
  the same draws; checked by tests). Uniform doubles are 53-bit dyadic rationals.
* Fixed sample rate from the document (and, for a project, from its packs); every length, offset and delay is converted to
  integer frames with round-half-even.
* Plain float64 arithmetic in a fixed order. No `Date`, `Math.random`, typed-array sorting of floats, hash-order iteration or
  threads. Transcendental functions are V8's own bundled `ieee754` ports (fdlibm), not the platform libm, so they do not vary
  with the OS C library. JavaScript forbids fused multiply-add, so compilers cannot change the rounding.
* PCM16 conversion is nearest-even with no dither; a clip is an error, never silently saturated.
* The WAV is canonical (44-byte header, no metadata chunks).

**Verified** (WAV bytes of 43 renders: the two examples, the 28-bar Hengyue bed score, and all 40 converted effect patches,
compared by one combined SHA-256): Node 16.20.0, 18.20.7, 22.13.0 (arm64 *and* x64, the latter under Rosetta), 23.8.0, 23.11.0
and 24.12.0, all on macOS 15 / Apple silicon. All identical. The 40 effects are also byte-identical to the delivered masters,
which CPython produced on Windows; that is independent evidence that the rendering does not depend on the machine.

**Not verified**: Linux, Windows, native x64 hardware, non-V8 engines. **What could break it**:

* a JavaScript engine whose `Math.sin/cos/exp/expm1/log/pow/tan` differ from V8's fdlibm ports (JavaScriptCore, SpiderMonkey, or a
  future V8 that swaps an implementation); the one-ulp difference would flip a PCM rounding now and then;
* reordering tracks, events or sequence entries (summation order changes the last bits);
* editing the engine (any change to an expression's operation order is a format change);
* **PNG files are not part of the contract**: pixels are identical on Node 22.13, 23.11 and 24.12 (checked after decoding), but
  the compressed bytes depend on the zlib bundled with Node, and differed between Node 24.12 and 22.13/23.11.
  Measurements are plain data and were identical on all three.

`tests/determinism.test.mjs` pins the Hengyue bed render against the committed copy and re-renders in a fresh process; a platform
difference fails there first.

## Measurements (`measure`, returned by `analyze`)

All figures come from the decoded PCM, so the same call measures a render or a delivered master.

```
sampleRate, channels, frames, durationMs
peak:  {sample (int), sampleDbfs, perChannel[], truePeakDbtp, truePeakMethod, clippedSamples}
rms:   {dbfs, activeDbfs (onset..tail), perChannelDbfs[]}
loudness: {integratedLufs, momentaryMaxLufs, loudnessRangeLu, ungatedLufs, blocks, gatedBlocks}
endpoints: {firstFrame[], lastFrame[], digitalZeroStart, digitalZeroEnd}
onset: {frame, ms, audibleFrame, audibleMs}      // first nonzero sample, and first sample >= -60 dBFS
tail:  {endExclusive, ms, silentFrames, lastAudibleFrame, decayBelow60DbMs}
spectrum: {bandsDb: [{fromHz, toHz, db}] (mono energy share of the total), centroidHz, rolloff99Hz}
loop (when {start, end} is given): {frames, perChannel: [{firstPcm, lastPcm, signedStep (first - last),
        maxAbsStepWithin10ms, interiorP99AbsStep, interiorMedianAbsStep}], worstSeamStep, seamToInteriorP99, verdict}
```

* **Loudness** is ITU-R BS.1770-4 implemented here: K-weighting (shelf + RLB high-pass, coefficients derived for any rate and
  equal to the published 48 kHz constants to 1e-8), 400 ms blocks at 75 % overlap, -70 LUFS absolute gate, -10 LU relative gate,
  channel weights 1. Loudness range follows EBU Tech 3342 (3 s windows, -20 LU gate, 10th to 95th percentile). Integrated,
  momentary and range are `null` when the file is shorter than one block (3 s for range): **every effect in this project is**.
  `ungatedLufs` (K-weighted mean square of the whole file) always exists; compare short cues by it.
* **True peak** is an estimate: 4x oversampling with a Hann-windowed sinc (24 taps per phase), not the 48-tap BS.1770 Annex 2 filter.
  Circular for loops.
* **Seam**: `signedStep = first - last` frame; `maxAbsStepWithin10ms` is the largest sample-to-sample step in the last 10 ms
  followed by the first 10 ms. `verdict` flags a seam step larger than the music's own 99th-percentile step.
* **Scale check** (`pitchCheck`, returned as `pitch` for score documents): static membership of every pitched note in the declared
  key, and a *measured* pitch for each distinct (instrument, note): the voice is rendered alone and its fundamental is found by
  normalised autocorrelation within +-1 semitone of the expected pitch. Result per voice:
  `{instrument, midi, expectedHz, measuredHz, centsError, strength, inScale}`; `ok` when every voice is within 25 cents and in the scale.
  Noise instruments (`pitched: false`) are skipped. This tells you a voice sits where the score says; it cannot tell you it is pleasant.

### Checked against the figures recorded for delivered masters

`tests/measure.test.mjs` measures the six delivered beds and compares them with the FFmpeg ebur128/loudnorm figures in their
ledgers. Observed differences (this implementation minus the recorded figure) and the stated tolerance:

| bed | integrated LUFS | true peak dBTP | loudness range LU |
| --- | --- | --- | --- |
| first bed | -23.17 vs -23.2 (+0.03) | -7.446 vs -7.4 (-0.05) | n/a |
| Hengyue | -21.59 vs -21.66 (+0.07) | -7.057 vs -7.06 (0.00) | 5.79 vs 6.0 (-0.21) |
| Blood Sea | -22.03 vs -22.0 (-0.03) | -7.541 vs -7.5 (-0.04) | 4.34 vs 4.4 (-0.06) |
| Ancient God | -22.45 vs -22.5 (+0.05) | -7.236 vs -7.2 (-0.04) | 5.32 vs 5.3 (+0.02) |
| Boss trial | -21.60 vs -21.6 (0.00) | -8.368 vs -8.4 (+0.03) | 1.88 vs 1.9 (-0.02) |
| Endless | -22.01 vs -22.0 (-0.01) | -9.916 vs -9.9 (-0.02) | 5.29 vs 5.4 (-0.11) |

**Tolerance: 0.10 LU integrated, 0.10 dB true peak, 0.25 LU range.** The recorded figures are rounded to 0.1 and came from a
different implementation, so agreement closer than that would be luck. The same tests assert that the sample peaks, first and
last frames, seam steps and 10 ms steps of the Hengyue master equal the recorded integers **exactly**, and that sample peak and
active RMS of the eight pilot effects equal their ledger values to 0.001 dB. The 997 Hz-sine, gating, K-weighting-constant and
inter-sample-peak unit tests cover the meter itself, at 22.05, 32, 44.1, 48 and 96 kHz.

## Images

`waveformPng(audio, {width = 1000, laneHeight = 150, marks})`: one lane per channel; light peak envelope over a darker RMS
envelope; 0 and -6 dBFS guides; green onset line and orange tail line for one-shots, cyan loop bounds for beds.
`spectrogramPng(audio, {width = 1000, height = 300, minHz = 40, rangeDb = 80, marks})`: Hann-windowed FFT (1024, or 2048 above
50 kHz) of the mono mix, logarithmic frequency axis, dB colour scale over `rangeDb` below the loudest cell, with labelled
time and frequency ticks. Both are 8-bit RGBA PNGs from `studio/core/png.mjs`. Each returns `axes`: pixel to time
(`plotLeftPx`, `framesPerPx`), amplitude (`lanes[].midPx`, `halfHeightPx`) and frequency (`minHz`, `maxHz`, `dbRange`), so an agent can
say "the energy at x = 640 is at 2.1 kHz" by arithmetic.

## Second project

`tests/second-fixture.test.mjs` builds a second project in a temp directory: its own pack, 48 kHz audio packs, A4 = 432 Hz,
D hirajoshi, 3/4 at 72 bpm, a square-wave reed through a biquad, an additive bell and a swept band-pass noise hush. It checks the
rate comes from that project, a document at another rate is refused, the bed renders deterministically with the right length,
the measured pitches match 432-based frequencies, an out-of-scale note is refused, and a 22.05 kHz patch honours its own Nyquist.

## Project sample rate

`projectAudio(root)` reads the pack, finds the `audio-plan` catalog source, reads every `<packs>/*/pack.json` under its
`evidence.packs` directory and returns the single `sample_rate_hz` they agree on (`null` without packs; `mixed_sample_rates` if
they disagree) and the delivered directories (`evidence.packs/masters/sources`) as `protectedDirs`. The pack schema has no
audio section of its own yet; if one is added, `projectAudio` is the one place to read it.

## Proof against the delivered renderers

[`assets/experiments/audio_engine/`](../../assets/experiments/audio_engine/REPORT.md) holds the converted patches (all 40
delivered effects), the Hengyue score, comparison renders, pictures and `comparison.json`. Headline: the 40 effects reproduce
their masters **byte for byte**; the bed matches by envelope (correlation 1.000, max 0.2 dB), spectrum (0.03 dB rms over
third-octave bands) and loudness (integrated LUFS identical, sample peak -0.02 dB) but not sample for sample. The report lists what
the format cannot express.

## Limits and honest gaps

* No per-event pan or random per-note parameters; pan is a fixed gain pair per instrument.
* No parallel filter branches (a difference of two differently filtered copies of one noise), no modulation of one LFO by another,
  no inter-channel feed other than the `taps` reverb's `cross`.
* numpy's `PCG64` and its ziggurat gaussian are not reproduced; delivered beds that draw from them cannot be matched sample for sample.
* No sample playback, no MIDI import, no pitch bend per note beyond `scoop` and `vibrato`.
* The true-peak figure is an estimate; the loudness meter is checked to the tolerance above, not bit-exact with FFmpeg.
