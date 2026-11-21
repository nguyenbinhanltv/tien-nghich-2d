# Pilot SFX master handoff

The eight one-shots in `assets/audio/masters/pilot_sfx/` are original Codex DSP renders. Match each filename to the `file` field in [provenance.json](provenance.json). [presets.json](presets.json) holds every layer, seed and gain. The dedicated [renderer](../../../../tools/generators/pilot_sfx.py) uses the Python standard library. The pilot manifest supplies the ordered IDs.

## Rebuild evidence

From the repository root, run the ledger's rebuild command twice with different empty output directories. On Windows with CPython 3.14.0, two clean renders matched byte-for-byte for all eight WAVs and the generated JSON ledger. The source hashes use LF-normalized UTF-8. The WAV hashes cover the full files; the PCM hashes cover just the signed little-endian sample data.

Independent WAV decoding confirmed 44,100 Hz, mono, PCM16, exact frame counts, first and last samples zero, no clipped samples, and onset/tail markers matching the first and last nonzero samples. Peak values ranged from -10.369 to -1.355 dBFS. Per-cue durations, sample peaks, full-file RMS and hashes are in the ledger. RMS includes the entire one-shot and its tail.

## Listening handoff

Human listening is pending. Audition dash against the sword whistle, the dry hit against the seal's two pulses and latch, and the rising pickup interval against the single card pluck. Check that the chest catch precedes the lid and that the breakthrough's breath resolves into the sustained fifth. Repeat over the pilot bed at matched monitoring gain. Codec packing and decoded listening belong to the integration pass.
