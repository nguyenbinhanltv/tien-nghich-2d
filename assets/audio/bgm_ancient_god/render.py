"""Offline Ancient God score renderer. Events, tails and reverb wrap on the score period."""
import argparse
import json
from pathlib import Path
import wave

import numpy as np

ALLOWED = {0, 2, 5, 7, 9}  # C D F G A
MODES = ((1.0, 1.0, 1.0), (2.32, .5, 1.6), (3.87, .28, 2.4), (5.61, .14, 3.4))  # ratio, amplitude, decay divisor


def drone(t, hz, gate, rng, sr):
    """Hollow open-fifth voice: slow swell, detuned twin, odd-leaning partials, gentle breathing."""
    swell = -np.expm1(-t / 1.6) * (1 - np.exp(-t / 0.35))
    release = np.exp(-1.7 * np.maximum(t - gate, 0))
    breathe = 1 + .12 * np.sin(2 * np.pi * .11 * t + rng.uniform(0, 6.28))
    tone = np.zeros_like(t)
    for h, amp in ((1, 1.0), (2, .3), (3, .24), (4, .08), (5, .07)):
        for detune, mix in ((1.0, .6), (1.0034, .4)):
            tone += mix * amp * np.sin(2 * np.pi * hz * h * detune * t + rng.uniform(0, .5))
    dust = np.convolve(rng.uniform(-1, 1, len(t)), np.ones(30) / 30, "same")
    return (tone + .05 * dust) * swell * release * breathe


def stone(t, hz, decay, thud, rng, sr):
    """Struck stone: inharmonic decaying modes, a falling low thud and a short grit click."""
    out = np.zeros_like(t)
    for ratio, amp, divisor in MODES:
        mode_hz = hz * ratio * (1 + .015 * np.exp(-t / .04))
        out += amp * np.sin(2 * np.pi * np.cumsum(mode_hz) / sr) * np.exp(-t / (decay / divisor))
    fall = hz * .5 * (1 + 1.2 * np.exp(-t / .05))
    out += thud * 1.1 * np.sin(2 * np.pi * np.cumsum(fall) / sr) * np.exp(-t / .16)
    grit = np.convolve(rng.uniform(-1, 1, len(t)), np.ones(5) / 5, "same")
    out += .9 * grit * np.exp(-t / .008)
    return out


def impulse(seconds, decay, seed, sr):
    rng = np.random.Generator(np.random.PCG64(seed))
    n = round(seconds * sr)
    t = np.arange(n) / sr
    ir = rng.standard_normal(n) * np.exp(-decay * t) * (-np.expm1(-t / .012))
    ir = np.convolve(ir, np.ones(4) / 4, "same")
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

    for bar, (phrase, figure) in enumerate(score["bars"]):
        for offset, note, gate_beats, velocity in score["drone"][phrase]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside C scale: {note}")
            gate = gate_beats * beat
            t = np.arange(round(sr * (gate + 4.5))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(drone(t, hz, gate, rng, sr), bar, offset, (.058, .056), velocity)
        for offset, name, velocity, pan in score["stone_figures"][figure]:
            spec = score["stones"][name]
            if spec["midi"] % 12 not in ALLOWED:
                raise ValueError(f"Outside C scale: {spec['midi']}")
            t = np.arange(round(sr * (spec["decay_s"] * 2.6 + .2))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((spec["midi"] - 69) / 12)
            angle = (pan + 1) * np.pi / 4
            place(stone(t, hz, spec["decay_s"], spec["thud"], rng, sr), bar, offset,
                  (np.cos(angle) * .12, np.sin(angle) * .12), velocity)
    reverb = score["reverb"]
    wet = np.empty_like(dry)
    for ch, seed in enumerate(reverb["seeds"]):
        ir = np.zeros(length)
        ir[:round(reverb["seconds"] * sr)] = impulse(reverb["seconds"], reverb["decay_per_second"], seed, sr)
        # Circular convolution: the tail of the last bar re-enters bar one.
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
