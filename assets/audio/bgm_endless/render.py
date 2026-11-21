"""Offline Endless Samsara score renderer. Events, tails and reverb wrap on the score period."""
import argparse
import json
from pathlib import Path
import wave

import numpy as np

ALLOWED = {9, 0, 2, 4, 7}  # A C D E G


def pluck(t, hz, rng, sr):
    """Soft FM pluck, kalimba-like: a short bright start that rounds off into a warm body."""
    index = 1.4 * np.exp(-t / .06)
    body = np.sin(2 * np.pi * hz * t + index * np.sin(2 * np.pi * hz * 2 * t + rng.uniform(0, .3)))
    body += .18 * np.sin(2 * np.pi * hz * 3 * t) * np.exp(-t / .15)
    return body * np.exp(-t / .55) * (-np.expm1(-t / .004))


def pad(t, hz, gate, rng, sr):
    """Quiet hollow sustained voice for the open fifth; it never stops across a marker room."""
    swell = -np.expm1(-t / 1.4)
    release = np.exp(-1.5 * np.maximum(t - gate, 0))
    breathe = 1 + .1 * np.sin(2 * np.pi * .09 * t + rng.uniform(0, 6.28))
    tone = np.zeros_like(t)
    for h, amp in ((1, 1.0), (2, .28), (3, .2), (4, .06)):
        for detune, mix in ((1.0, .6), (1.003, .4)):
            tone += mix * amp * np.sin(2 * np.pi * hz * h * detune * t + rng.uniform(0, .5))
    return tone * swell * release * breathe


def impulse(seconds, decay, seed, sr):
    rng = np.random.Generator(np.random.PCG64(seed))
    n = round(seconds * sr)
    t = np.arange(n) / sr
    ir = np.convolve(rng.standard_normal(n) * np.exp(-decay * t) * (-np.expm1(-t / .012)), np.ones(4) / 4, "same")
    return ir / np.sqrt(np.sum(ir**2))


def render(score, destination):
    sr = score["sample_rate"]
    beat = 60 / score["tempo_bpm"]
    meter = score["beats_per_bar"]
    length = round(len(score["bars"]) * meter * beat * sr)
    dry = np.zeros((length, 2))
    rng = np.random.Generator(np.random.PCG64(score["seed"]))

    def place(samples, bar, offset, gains, velocity):
        samples[-441:] *= np.linspace(1, 0, 441)
        start = round((bar * meter + offset) * beat * sr)
        indices = (start + np.arange(len(samples))) % length
        dry[indices] += (samples * velocity)[:, None] * gains

    for bar, (pads, low, mid, high) in enumerate(score["bars"]):
        for offset, note, gate_beats, velocity in score["pads"][pads]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside A scale: {note}")
            gate = gate_beats * beat
            t = np.arange(round(sr * (gate + 3.5))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(pad(t, hz, gate, rng, sr), bar, offset, (.05, .048), velocity)
        for track, gains in (("low", (.12, .1)), ("mid", (.1, .13)), ("high", (.07, .11))):
            figure = {"low": low, "mid": mid, "high": high}[track]
            for offset, note, velocity in score[track][figure]:
                if note % 12 not in ALLOWED:
                    raise ValueError(f"Outside A scale: {note}")
                t = np.arange(round(sr * 2.6)) / sr
                hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
                place(pluck(t, hz, rng, sr), bar, offset, gains, velocity)
    reverb = score["reverb"]
    wet = np.empty_like(dry)
    for ch, seed in enumerate(reverb["seeds"]):
        ir = np.zeros(length)
        ir[:round(reverb["seconds"] * sr)] = impulse(reverb["seconds"], reverb["decay_per_second"], seed, sr)
        wet[:, ch] = np.fft.irfft(np.fft.rfft(dry[:, ch]) * np.fft.rfft(ir), n=length)
    stereo = (dry + reverb["wet"] * wet) * score["master_gain"]
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
