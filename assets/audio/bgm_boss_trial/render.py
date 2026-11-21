"""Offline boss-trial score renderer. Events, tails and reverb wrap on the score period."""
import argparse
import json
from pathlib import Path
import wave

import numpy as np

ALLOWED = {2, 3, 5, 7, 9}  # D Eb F G A
BRONZE = ((1.0, 1.0, 1.0), (2.76, .5, 2.2), (5.4, .26, 4.0), (8.93, .12, 6.0))  # ratio, amplitude, decay divisor


def growl(t, hz, gate, rng, sr):
    """Fast-bowed low saw-like voice with a gritty edge; a reed-like pressure under the drum."""
    swell = -np.expm1(-t / .06)
    phase = 2 * np.pi * hz * t * (1 + .002 * np.sin(2 * np.pi * 5.1 * t))
    tone = np.zeros_like(t)
    for h in range(1, 13):
        tone += np.sin(h * phase + rng.uniform(0, .6)) / h**1.05
    grit = np.convolve(rng.uniform(-1, 1, len(t)), np.ones(5) / 5, "same")
    return (tone + .25 * grit) * swell * np.exp(-1.1 * t / max(gate, .1)) * np.exp(-9 * np.maximum(t - gate, 0))


def drum(t, hz, decay, grit, rng, sr):
    """Skin drum: falling pitched body for the boom; a dry rim crack with noise for the tak."""
    fall = hz * (1 + 1.3 * np.exp(-t / .035))
    out = np.sin(2 * np.pi * np.cumsum(fall) / sr) * np.exp(-t / decay)
    noise = rng.uniform(-1, 1, len(t))
    if grit:
        crack = noise - np.convolve(noise, np.ones(14) / 14, "same")
        out = out * .55 + 1.1 * crack * np.exp(-t / .012)
    else:
        out += .3 * np.convolve(noise, np.ones(18) / 18, "same") * np.exp(-t / .012)
    return out


def bronze(t, hz, rng, sr):
    """Struck bronze: inharmonic partials with a slow shimmer and different decays."""
    out = np.zeros_like(t)
    for ratio, amp, divisor in BRONZE:
        out += amp * np.sin(2 * np.pi * hz * ratio * t + rng.uniform(0, .5)) * np.exp(-t / (1.4 / divisor))
    return out + .25 * np.convolve(rng.uniform(-1, 1, len(t)), np.ones(4) / 4, "same") * np.exp(-t / .006)


def riser(t, gate, rng):
    air = rng.uniform(-1, 1, len(t))
    air = np.convolve(air, np.ones(12) / 12, "same") - np.convolve(air, np.ones(300) / 300, "same")
    return air * np.clip(t / gate, 0, 1) ** 2.2 * np.exp(-14 * np.maximum(t - gate, 0))


def impulse(seconds, decay, seed, sr):
    rng = np.random.Generator(np.random.PCG64(seed))
    n = round(seconds * sr)
    t = np.arange(n) / sr
    ir = np.convolve(rng.standard_normal(n) * np.exp(-decay * t) * (-np.expm1(-t / .008)), np.ones(3) / 3, "same")
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

    stage = score["stage_gain"]
    for bar, (low, kit, metal, air) in enumerate(score["bars"]):
        for offset, note, gate_beats, velocity in score["growl"][low]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside D scale: {note}")
            gate = gate_beats * beat
            t = np.arange(round(sr * (gate + .6))) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(growl(t, hz, gate, rng, sr), bar, offset, (.05, .048), velocity)
        for offset, name, velocity, pan in score["drum_figures"][kit]:
            spec = score["drums"][name]
            if spec["midi"] % 12 not in ALLOWED:
                raise ValueError(f"Outside D scale: {spec['midi']}")
            drum_hz = score["tuning_A4_hz"] * 2 ** ((spec["midi"] - 69) / 12)
            t = np.arange(round(sr * (spec["decay_s"] * 5 + .1))) / sr
            angle = (pan + 1) * np.pi / 4
            place(drum(t, drum_hz, spec["decay_s"], spec["grit"], rng, sr), bar, offset,
                  (np.cos(angle) * stage, np.sin(angle) * stage), velocity)
        for offset, note, velocity in score["bronze"][metal]:
            if note % 12 not in ALLOWED:
                raise ValueError(f"Outside D scale: {note}")
            t = np.arange(round(sr * 1.5)) / sr
            hz = score["tuning_A4_hz"] * 2 ** ((note - 69) / 12)
            place(bronze(t, hz, rng, sr), bar, offset, (.04, .055) if note % 2 else (.055, .04), velocity)
        for offset, gate_beats, velocity in score["riser"][air]:
            gate = gate_beats * beat
            t = np.arange(round(sr * (gate + .3))) / sr
            place(riser(t, gate, rng), bar, offset, (.5, .5), velocity)
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
