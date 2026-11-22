# Audio engine proof: delivered cues re-expressed as data

Experiment output only. The delivered masters (`assets/audio/masters/`, `assets/audio/bgm_*/`) and their Python renderers are
untouched and were only read. **No agent listened to any of this; every statement below is a number or a picture.**

Re-run: `node assets/experiments/audio_engine/convert.mjs && node assets/experiments/audio_engine/compare.mjs`
(`tests/images-compare-cli.test.mjs` fails if the committed files differ from a fresh run).

| file | what |
| --- | --- |
| `patches/*.patch.json` | all 40 delivered effects as `studio.audio.patch`, converted from `assets/audio/source/*/presets.json` by `convert.mjs` |
| `scores/bgm_hengyue.score.json` | the Hengyue bed as `studio.audio.score`, converted from `assets/audio/bgm_hengyue/score.json` |
| `renders/` | engine renders of four effects and the bed (WAV) |
| `images/` | waveform and spectrogram PNGs of each render, and of the delivered Hengyue master for side-by-side viewing |
| `comparison.json` | every figure quoted here |

## Effects (four of different character, plus all 40 byte-checked)

| cue | character | vs delivered master |
| --- | --- | --- |
| `sfx_dash` | broadband noise rush with a falling tone | byte-identical WAV |
| `sfx_blade` | FM tone sweeps (whistle) over filtered noise | byte-identical WAV |
| `sfx_hit_stone` | percussive impact | byte-identical WAV |
| `sfx_chime` | pitched, ringing tail | byte-identical WAV |

Because those four are identical, their envelope, spectrum and loudness differences are all zero (envelope correlation 1,
0 LSB). That is a stronger result than the comparison asked for, and it needs a reason, not a shrug: the pilot format is a
direct, structural description of what `pilot_sfx.py` computes (same layers, same operation order, same MT19937 stream, same
round-half-even), so the engine reproduces CPython's `math.sin/exp/expm1` and `random.random()` bit for bit on this machine.
`tests/determinism.test.mjs` checks **all 40** delivered effects the same way, across all five batches.

So that "zero difference" is not mistaken for a comparison that cannot fail, two controls ran through the same function
(`comparison.json`, `controls`):

| control | envelope correlation | max envelope diff | spectrum rms diff | sample-exact |
| --- | --- | --- | --- | --- |
| `sfx_dash` with seed + 1 | 0.998 | 1.76 dB | 1.48 dB | no (9,731 of 10,672 samples differ) |
| `sfx_dash` vs `sfx_blade` | 0.834 | 69.7 dB | 21.4 dB | no |

## Bed: `bgm_hengyue` (28 bars, 96 bpm, G major pentatonic, stereo, 70 s, loop `[0, 3087000)`)

Delivered master vs engine render, same sample count (3,087,000 frames):

| measure | delivered master | engine render | difference |
| --- | --- | --- | --- |
| envelope (50 ms windows, 892 live windows) | | | correlation 1.000, mean 0.01 dB, max 0.20 dB |
| spectrum, 26 third-octave bands | | | rms 0.03 dB, max 0.07 dB |
| mono energy share <100 / 100-450 / 450-1600 / 1.6-5k / >5k Hz | -38.32 / -1.84 / -4.66 / -24.20 / -40.30 dB | -38.32 / -1.84 / -4.67 / -24.19 / -40.30 dB | <= 0.01 dB |
| sample peak | -7.057 dBFS | -7.079 dBFS | -0.02 dB |
| true peak (estimate) | -7.057 dBTP | -7.077 dBTP | -0.02 dB |
| RMS | -25.555 dBFS | -25.556 dBFS | 0.00 dB |
| integrated loudness (this meter) | -21.59 LUFS | -21.59 LUFS | 0.00 LU |
| integrated loudness (FFmpeg, recorded) | -21.66 LUFS | n/a | meter agrees within 0.07 LU |
| loudness range | 5.79 LU | 5.78 LU | -0.01 LU |
| seam step first - last, L/R | -56 / -60 | -49 / -52 | verdict: within the music's own step size |
| max step within 10 ms of the seam, L/R | 510 / 414 | 495 / 395 | |

**Not sample-exact, and that is expected:** 2,124,276 of 6,174,000 samples differ (max 1,078 LSB, about -30 dBFS). The loudness,
envelope and spectrum match to hundredths of a dB; the waveform does not. The differences have identifiable causes:

1. **The flute's air noise.** The Python renderer draws from one numpy `PCG64` stream shared by all notes; the engine gives each
   note its own `MT19937([seed, eventIndex, layerIndex])`. The noise is statistically the same (same FIR, same level envelope) and
   a different realisation. The format has no way to reproduce `PCG64`.
2. **Pitch composition.** Python adds the scoop and vibrato terms (`1 - .009e^(-t/.06) + .002 sin(...)(1 - e^(-3t))`); the engine
   multiplies them. The cross-term is about 2e-5 of the pitch.
3. **Phase.** Python's `cumsum` makes the phase include the current sample; the engine's phase is that before the increment (the
   pilot-effects convention, which is exact for those cues), a one-sample offset in the flute.
4. **Summation order.** The engine adds all plucks then all flute notes, Python adds bar by bar. Same numbers, different rounding
   in the last bits.
5. The release rate 15 /s is written as a 66.667 ms time constant (`1000/15`), one ulp different from `exp(-15 t)`.

The seam differs by a few LSB for the same reasons (the notes ringing across the join are the same; the noise under them is not).

## What the format cannot express (honest gaps)

From reading the other renderers (`assets/audio/bgm_*/render.py`) and the effect renderer:

* **Effects: nothing missing.** All 40 delivered effects use only `tone`/`noise` layers with attack, decay, release, FM and flutter.
* **Hengyue: expressible** (this experiment), except the PCG64 stream.
* **Boss trial, Ancient God and Endless use a convolution reverb built from a seeded numpy gaussian impulse response.** The
  engine now has `reverb.type = "impulse"` (seeded Box-Muller over MT19937, FFT convolution that folds the tail onto the loop start),
  the same kind of reverb but a different noise, so those beds could be matched by envelope, spectrum and loudness but never sample for
  sample. They were not converted; this experiment covers one bed, as scoped.
* **Blood Sea** voices use a wandering pitch made from sums of low-frequency sines with random phases, a frequency-modulated tremor
  (`sin(2 pi (4.2 + .9 sin(...)) t)`) and a partial whose ratio drifts: *not expressible* (modulating one LFO by another is missing).
  Its reverb is `np.roll` taps like Hengyue's, which the `taps` reverb covers.
* **Ancient God and Endless** voices use per-partial random phases (supported: `partialPhase.random`) and a slow amplitude breathing
  with a random starting phase (`am` covers the shape, not the random phase).
* **Boss trial** drums and risers subtract two differently smoothed copies of the same noise (`conv(noise, ones(12)/12) - conv(..., ones(300)/300)`):
  the engine's filters are a serial chain on one signal, so a parallel difference needs a new construct. Boss trial and Ancient God
  also place events with per-event pan angles (`cos/sin`); pan here is one gain pair per instrument.
* **Dong Phu** draws a random pick position per note from the shared stream (the engine's per-instrument parameters are fixed) and
  cross-feeds channels with rolled delays (the `cross` tap covers the reflection part).

## Toolchain

Engine renders were produced on Node 24.12.0, darwin arm64; the same WAV bytes came out of Node 16.20, 18.20, 22.13 (arm64 and
x64 under Rosetta), 23.8 and 23.11 (see `studio/audio/README.md`, Determinism contract).
