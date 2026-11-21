"""Offline Huyet Hai score renderer. Events and their tails wrap on the score period."""
import argparse
import json
from pathlib import Path
import wave

import numpy as np

ALLOWED = {4, 5, 7, 9, 11, 0}  # E F G A B C


def bowed(t, hz, gate, rng, sr):
    """Slow-bow additive saw with a faint vibrato and seeded bow rosin noise."""
    swell = -np.expm1(-t / .32)
    vibrato = 1 + .0016 * np.sin(2 * np.pi * 4.4 * t) * (1 - np.exp(-t / .9))
    phase = 2 * np.pi * np.cumsum(hz * vibrato) / sr
    tone = np.zeros_like(t)
    for h in range(1, 11):
        tone += np.sin(h * phase + .35 * h) / h**1.15
    grit = np.convolve(rng.uniform(-1, 1, len(t)), np.ones(6) / 6, "same")
    tone += grit * .35 * np.exp(-t / .5) + grit * .05
    return tone * swell * np.exp(-3.2 * np.maximum(t - gate, 0))


def unstable(t, hz, gate, rng, sr):
    """Two beating voices and a wandering inharmonic partial; pitch and level never settle."""
    wander = (.006 * np.sin(2 * np.pi * .37 * t + rng.uniform(0, 6.28))
              + .004 * np.sin(2 * np.pi * 1.13 * t + rng.uniform(0, 6.28))
              - .03 * np.exp(-t / .45))
    phase = 2 * np.pi * np.cumsum(hz * (1 + wander)) / sr
    beat = 1 + .0125 + .006 * np.sin(2 * np.pi * .21 * t)
    tone = (np.sin(phase) + .8 * np.sin(phase * beat)
            + .07 * np.sin(phase * (2.02 + .06 * np.sin(2 * np.pi * .3 * t))))
    tremor = 1 + .3 * np.sin(2 * np.pi * (4.2 + .9 * np.sin(2 * np.pi * .17 * t)) * t)
    return tone * tremor * (-np.expm1(-t / .55)) * np.exp(-2.4 * np.maximum(t - gate, 0))


def breath(t, gate, rng):
    air = np.convolve(rng.uniform(-1, 1, len(t)), np.ones(40) / 40, "same")
    air -= np.convolve(air, np.ones(900) / 900, "same")
    swell = np.sin(np.pi * np.clip(t / gate, 0, 1)) ** 2
    return air * swell * np.exp(-6 * np.maximum(t - gate, 0))


def render(score, destination):
    sr = score["sample_rate"]
    beat = 60 / score["tempo_bpm"]
    meter = score["beats_per_bar"]
    length = round(len(score["bars"]) * meter * beat * sr)
    mix = np.zeros((length, 2))
    rng = np.random.Generator(np.random.PCG64(score["seed"]))

    def place(samples, bar, offset, gains, velocity):
        samples[-441:] *= np.linspace(1, 0, 441)
        start = round((bar * meter + offset) * beat * sr)
        indices = (start + np.arange(len(samples))) % length
        mix[indices] += (samples * velocity)[:, None] * gains

    for bar, (bow, upper, wind) in enumerate(score["bars"]):
        for offset, note, duration, velocity in score["bow"][bow]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside E scale: {note}")
            gate = duration * beat
            t = np.arange(round(sr * (gate + 1.3))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(bowed(t, hz, gate, rng, sr), bar, offset, (.062, .058), velocity)
        for offset, note, duration, velocity in score["upper"][upper]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside E scale: {note}")
            gate = duration * beat
            t = np.arange(round(sr * (gate + 1.6))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(unstable(t, hz, gate, rng, sr), bar, offset, (.05, .074), velocity)
        for offset, duration, velocity in score["breath"][wind]:
            gate = duration * beat
            t = np.arange(round(sr * (gate + .8))) / sr
            place(breath(t, gate, rng), bar, offset, (.9, 1.0), velocity)
    stereo = mix.copy()
    for seconds, gain in ((.031, .06), (.067, .04), (.127, .025)):
        stereo += gain * np.roll(mix[:, ::-1], round(sr * seconds), axis=0)
    stereo *= score["master_gain"]
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
