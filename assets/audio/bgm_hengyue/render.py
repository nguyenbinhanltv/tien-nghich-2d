"""Offline Hengyue score renderer. Events and their tails wrap on the score period."""
import argparse
import json
from pathlib import Path
import wave

import numpy as np


def string(t, hz, gate, bright):
    phase = 2 * np.pi * hz * t
    tone = np.zeros_like(t)
    for harmonic in range(1, 8):
        pick = np.sin((0.21 if bright else 0.32) * np.pi * harmonic)
        tone += (pick / harmonic**1.3 * np.sin(harmonic * phase)
                 * np.exp(-(2.9 + harmonic * 1.3) * t))
    return tone * (-np.expm1(-t / .003)) * np.exp(-15 * np.maximum(t - gate, 0))


def flute(t, hz, gate, rng, sr):
    pitch = hz * (1 - .009 * np.exp(-t / .06)
                  + .002 * np.sin(2 * np.pi * 4.8 * t) * (1 - np.exp(-3 * t)))
    phase = 2 * np.pi * np.cumsum(pitch) / sr
    air = np.convolve(rng.uniform(-1, 1, len(t)), [0.125, .375, .375, .125], "same")
    voice = np.sin(phase) + .15 * np.sin(2 * phase) + .12 * np.sin(3 * phase)
    return ((voice + air * (.045 + .11 * np.exp(-t / .09)))
            * (-np.expm1(-t / .072)) * np.exp(-10 * np.maximum(t - gate, 0)))


def render(score, destination):
    sr = score["sample_rate"]
    beat = 60 / score["tempo_bpm"]
    meter = score["beats_per_bar"]
    length = round(len(score["bars"]) * meter * beat * sr)
    mix = np.zeros((length, 2))
    rng = np.random.Generator(np.random.PCG64(score["seed"]))
    for bar, (figure, answer) in enumerate(score["bars"]):
        for lead, events in ((False, score["figures"][figure]), (True, score["answers"][answer])):
            for index, (offset, note, duration, velocity) in enumerate(events):
                if note % 12 not in (7, 9, 11, 2, 4):
                    raise ValueError(f"Outside G pentatonic: {note}")
                hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
                gate = duration * beat
                t = np.arange(round(sr * (gate + .85))) / sr
                if lead:
                    samples = flute(t, hz, gate, rng, sr)
                    gains = (.143, .157)
                else:
                    bright = index % 2 == 1
                    samples = string(t, hz, gate, bright)
                    gains = (.21, .29) if bright else (.35, .26)
                samples[-441:] *= np.linspace(1, 0, 441)
                start = round((bar * meter + offset) * beat * sr)
                indices = (start + np.arange(len(t))) % length
                mix[indices] += (samples * velocity)[:, None] * gains
    stereo = mix.copy()
    for seconds, gain in ((.023, .054), (.049, .032), (.091, .018)):
        stereo += gain * np.roll(mix[:, ::-1], round(sr * seconds), axis=0)
    if np.max(np.abs(stereo)) >= 1:
        raise ValueError("Master clips")
    with wave.open(str(destination), "wb") as master:
        master.setparams((2, 2, sr, 0, "NONE", "not compressed"))
        master.writeframes(np.rint(stereo * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    render(json.loads(Path(__file__).with_name("score.json").read_bytes()), args.output)
