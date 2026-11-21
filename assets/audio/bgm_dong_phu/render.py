"""Offline renderer for the original Dong Phu score. Python 3.14.0, NumPy 2.5.5."""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

TAU = 2 * np.pi
SEMITONES = {"C": 0, "D": 2, "F": 5, "G": 7, "A": 9}


def frequency(note, tuning):
    midi = 12 * (int(note[1:]) + 1) + SEMITONES[note[0]]
    return tuning * 2 ** ((midi - 69) / 12)


def pluck(t, hz, gate, rng):
    # A damped pair of strings. Pick position suppresses selected upper modes.
    position = rng.uniform(.16, .23)
    tone = np.zeros_like(t)
    for k in range(1, 10):
        mode = TAU * k * hz * (1 + .00008 * k * k) * t
        amplitude = np.sin(np.pi*k*position) / k**1.32
        tone += amplitude * np.exp(-(1.65 + .52*k)*t) * (
            .82*np.sin(mode) + .18*np.sin(mode*1.0017))
    return tone * (-np.expm1(-t/.004)) * np.exp(-6*np.maximum(t-gate, 0))


def breath(t, hz, gate, rng):
    pitch = hz * (1 - .006*np.exp(-t/.085) +
                  .0024*(1-np.exp(-t/.35))*np.sin(TAU*4.7*t))
    phase = TAU*np.cumsum(pitch)/44100
    envelope = (-np.expm1(-t/.13)) * np.exp(-8*np.maximum(t-gate, 0))
    white = rng.uniform(-1,1,len(t))
    air = np.convolve(white, np.array([1,2,1])/4, mode="same")
    tone = np.sin(phase) + .13*np.sin(2*phase) + .085*np.sin(3*phase)
    return envelope * (.92+.08*np.sin(TAU*2.1*t)) * (tone + .06*air)


def render(score):
    sr = score["sample_rate"]
    beat = 60 / score["bpm"]
    length = round(sr*beat*score["meter"][0]*score["bars"])
    period = length/sr
    t = np.arange(length)/sr
    mix = np.zeros((length,2))
    rng = np.random.Generator(np.random.PCG64(score["seed"]))
    # Whole-cycle drone oscillators keep continuous phase across the bar-24 seam.
    for i,note in enumerate(score["drone"]):
        cycles = round(frequency(note,score["tuning_A4_hz"])*period)
        phase = TAU*cycles*t/period + .12*np.sin(TAU*(3+i)*t/period)
        swell = .73 + .17*np.sin(TAU*(2+i)*t/period+i) + .10*np.cos(TAU*t/period)
        voice = swell*(np.sin(phase)+.15*np.sin(2*phase)+.08*np.sin(3*phase))
        level = (.055,.032)[i]
        mix += (level*voice)[:,None] * np.array([(1,.91),(.86,1)][i])
    for bar in score["measures"]:
        for instrument, synth, level, pan in (
                ("pluck",pluck,.46,(.92,.68)), ("breath",breath,.155,(.70,.91))):
            for offset,note,duration,velocity in bar[instrument]:
                start = round(((bar["bar"]-1)*score["meter"][0]+offset)*beat*sr)
                gate = duration*beat
                samples = np.arange(round((gate+1.45)*sr))/sr
                voice = synth(samples,frequency(note,score["tuning_A4_hz"]),gate,rng)
                # End the residual release smoothly before adding it to the circular bus.
                voice[-882:] *= np.linspace(1,0,882)
                voice *= level*velocity
                at = (start+np.arange(len(voice))) % length
                mix[at] += voice[:,None]*np.array(pan)
    # Short early reflections plus a diffuse decaying tail; circular convolution
    # with the unmodified dry bus includes spill from the preceding iteration.
    wet = mix.copy()
    room = np.random.Generator(np.random.PCG64(score["seed"]+1))
    for delay in (.041,.077,.119,.173,.241):
        wet += .053*np.exp(-3*delay)*np.roll(mix[:,::-1],round(sr*delay),axis=0)
    for delay in np.linspace(.28,4.35,64):
        for ch in range(2):
            frames = round(sr*(delay+room.uniform(-.012,.012)))
            gain = room.choice([-1,1])*.036*np.exp(-1.07*delay)
            wet[:,ch] += gain*np.roll(mix[:,1-ch],frames)
    if np.max(np.abs(wet)) >= 1:
        raise ValueError("Master gain clips")
    # Nearest-even PCM16 quantization, no dither, limiter or automatic gain.
    return np.rint(wet*32767).astype("<i2")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    score=json.loads(Path(__file__).with_name("score.json").read_text(encoding="utf-8"))
    pcm=render(score)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(args.output),"wb") as wav:
        wav.setparams((2,2,score["sample_rate"],0,"NONE","not compressed"))
        wav.writeframes(pcm.tobytes())
