"""Render original one-shot pilot masters. CPython standard library, no sample inputs."""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import wave


ROOT = Path(__file__).resolve().parents[2]
PRESETS = ROOT / "assets/audio/source/pilot_sfx/presets.json"
RATE = 44100


def frames(milliseconds):
    return round(milliseconds * RATE / 1000)


def mix_layer(bus, layer, seed):
    offset = frames(layer["start_ms"])
    length = frames(layer["ms"])
    if offset + length > len(bus):
        raise ValueError("Layer exceeds the preset frame count")
    attack = frames(layer["attack_ms"])
    release = frames(layer["release_ms"])
    decay = frames(layer["decay_ms"])
    rng = random.Random(seed)
    phase = 0.0
    slow = fast = 0.0
    is_tone = layer["voice"] == "tone"
    if is_tone:
        hz = layer["hz"]
        glide = (layer["end_hz"] / hz) ** (1 / (length - 1))
    elif layer["voice"] == "noise":
        # Difference of two one-pole low passes gives a band-limited gust.
        slow_rate = -math.expm1(-math.tau * layer["low_hz"] / RATE)
        fast_rate = -math.expm1(-math.tau * layer["high_hz"] / RATE)
    else:
        raise ValueError(layer["voice"])
    for i in range(length):
        if is_tone:
            modulation = layer.get("fm_index", 0) * math.sin(phase * layer.get("fm_ratio", 1))
            sample = math.sin(phase + modulation)
            phase += math.tau * hz / RATE
            hz *= glide
        else:
            white = 2 * rng.random() - 1
            fast += fast_rate * (white - fast)
            slow += slow_rate * (white - slow)
            sample = fast - slow
        envelope = min(1, i / attack, (length - 1 - i) / release)
        flutter = layer.get("flutter_depth", 0)
        ripple = 1 - flutter * (0.5 + 0.5 * math.cos(math.tau * layer.get("flutter_hz", 0) * i / RATE))
        bus[offset + i] += sample * layer["gain"] * envelope * math.exp(-i / decay) * ripple


def sha(data):
    return hashlib.sha256(data).hexdigest()


def render(cue, preset, out):
    bus = [0.0] * frames(preset["duration_ms"])
    for i, layer in enumerate(preset["layers"]):
        mix_layer(bus, layer, preset["seed"] + i)
    samples = array("h", (round(v * preset["trim"] * 32767) for v in bus))
    peak = max(map(abs, samples))
    if not 0 < peak < 32767 or samples[0] or samples[-1]:
        raise ValueError(f"Invalid peak or endpoint in {cue}")
    onset = next(i for i, v in enumerate(samples) if v)
    end = len(samples) - next(i for i, v in enumerate(reversed(samples)) if v)
    rms = math.sqrt(sum(v * v for v in samples) / len(samples))
    if sys.byteorder != "little":
        samples.byteswap()
    pcm = samples.tobytes()
    path = out / (cue + ".wav")
    with wave.open(str(path), "wb") as stream:
        stream.setparams((1, 2, RATE, 0, "NONE", ""))
        stream.writeframes(pcm)
    return {"id": cue, "file": path.name, "seed": preset["seed"],
            "frames": len(bus), "duration_ms": len(bus) * 1000 / RATE,
            "onset_frame": onset, "tail_end_exclusive": end,
            "sample_peak_dbfs": round(20 * math.log10(peak / 32768), 3),
            "rms_dbfs": round(20 * math.log10(rms / 32768), 3),
            "pcm_sha256": sha(pcm), "wav_sha256": sha(path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="empty output directory")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if any(args.out.iterdir()):
        parser.error("choose an empty output directory")
    presets = json.loads(PRESETS.read_text(encoding="utf-8"))
    contract = json.loads((ROOT / "assets/audio_manifest.json").read_text(encoding="utf-8"))
    if list(presets) != list(contract["pilot"]["effects"].values()):
        raise ValueError("Preset IDs differ from pilot order")
    records = [render(cue, preset, args.out) for cue, preset in presets.items()]
    ledger = {"creator": "OpenAI Codex", "rights": "Original procedural audio authored for Tien Nghich 2D.",
              "inputs": "Original preset and DSP code only. No samples, soundfonts or model outputs.",
              "format": "44100 Hz mono signed PCM16 little-endian WAV",
              "markers": "Integer sample frames; onset and exclusive tail bound nonzero PCM. One-shots without loops.",
              "tuning": "Absolute Hz in each layer; pitched notes referenced to A4=440 Hz. No beat grid.",
              "synthesis": "Zero initial phases/filter states, seeded MT19937 per layer, nearest-even PCM rounding, no dither.",
              "rebuild": "python -I tools/generators/pilot_sfx.py --out <empty-directory>",
              "python": sys.version.split()[0], "source_sha256_lf": {}, "masters": records}
    for path in (Path(__file__).resolve(), PRESETS):
        ledger["source_sha256_lf"][path.relative_to(ROOT).as_posix()] = sha(path.read_text(encoding="utf-8").encode())
    (args.out / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


if __name__ == "__main__":
    main()
