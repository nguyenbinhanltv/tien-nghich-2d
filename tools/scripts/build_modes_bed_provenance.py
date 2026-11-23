"""Render the two Modes beds with the Studio audio engine (Node) and write each bed's master.wav and provenance.json.

The master is rendered by `assets/audio/<bed>/render.py`, which runs studio/audio/cli.mjs on the bed's score.json. This script
measures the master with the engine's own `analyze` (BS.1770 LUFS, 4x oversampled true peak, loop seam), hashes the inputs and
the engine files, and writes the ledger. It listens to nothing and signs nothing.

Usage (from the checkout root): tools/.venvs/project/bin/python -I -B tools/scripts/build_modes_bed_provenance.py [--check]
--check renders into a temporary directory and requires the committed master.wav and provenance.json to match byte for byte.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[2]
BASE = "c72f601fad4874c672c0bba110788b068db9c186"
CREATOR = "Claude Code (Anthropic, claude-sonnet-5-5) for Tien Nghich 2D"
RIGHTS = ("Original note score, voice synthesis and arrangement created for the project. All audible input is generated from the supplied "
          "score and additive-oscillator/FM/noise patch. No recordings, samples, soundfont or generative-audio model.")
PROPOSAL = ("Tempo, length, loop point and structure are the author's proposal (docs/AUDIO_DESIGN.md, 'Modes proposal'); the project owner "
            "settled only the one-sentence brief of the mode and the order to go ahead.")
REFERENCE_BEDS = json.loads((ROOT / "assets/audio/bgm_ember_delta/provenance.json").read_text(encoding="utf-8"))["verification"]["reference_beds"]

BEDS = {
    "bgm_aftermath": {
        "tempo_bpm": 48, "bars": 16, "tuning": "D major pentatonic (D E F# A B), tonal center D; A4 = 440 Hz",
        "patch": ("Studio audio score, MT19937 seed 6301 (per note [seed, event, layer]). Voices: soft bell (FM sine, ratio 2, index 0.35, plus a faint "
                  "2.003x partial, 1.7 s decay) stating three falling phrases D4-A4; breath (low-passed noise sweeping 700 to 260 Hz with 0.4 Hz swell) "
                  "answering in the empty bars; triangle drone D2+A2, then B2+F#3 from bar 9. Seeded-noise impulse reverb 3.0 s, wet 0.42, folded across the loop boundary."),
        "structure": ("16 bars at 48 BPM. Bell phrases enter at bars 1, 5, 9 (an octave lower) and 13 (two bars each); the breath exhales in bars 3, 7, 11 and 15; "
                      "bars 3-4, 7-8, 11-12 and 15-16 hold no bell, so the bed is mostly rests. The drone moves from D2+A2 to B2+F#3 at bar 9 and the loop wraps back to D."),
    },
    "bgm_defense": {
        "tempo_bpm": 96, "bars": 32, "tuning": "A minor pentatonic (A C D E G), tonal center A; A4 = 440 Hz",
        "patch": ("Studio audio score, MT19937 seed 6401 (per note [seed, event, layer]). Voices: low drum (sine with a short pitch scoop plus an octave partial) on "
                  "beats 1 and 3; stone ostinato (four-partial additive pluck, A2-G3) in eighth notes with rests; wave bell (FM sine, ratio 2, index 0.3) at the end of "
                  "every eighth bar; shaker (6-10.5 kHz band noise) in bars 17-28; low-passed saw plus sub-sine drone A1+E2, then D2+A2 from bar 17. "
                  "Seeded-noise impulse reverb 1.5 s, wet 0.22, folded across the loop boundary."),
        "structure": ("32 bars at 96 BPM in four eight-bar groups. The drum plays every bar (the bass moves to D on bars 3-4 and E on bar 7 of each group). The ostinato plays "
                      "bars 1-7 of each group and rests in bar 8, where the wave bell calls (bars 8, 16, 24, 32), so a wave call and the enemy tell have room; bars 30 and 31 also rest "
                      "so the loop ebbs before it wraps. The shaker adds off-beat ticks in bars 17-28. Every voice except the two drones enters an eighth note after the loop start, "
                      "so frame 0 is not a note onset (a first version that began on a drum onset failed the Ogg three-repeat seam rule; this pickup fixed it); the last bell note of bar 32 "
                      "therefore wraps onto the start of the next pass."),
    },
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def lf_sha(path):
    return sha(path.read_text(encoding="utf-8").encode())


def render(bed, out):
    subprocess.run([sys.executable, "-I", "-B", str(ROOT / "assets/audio" / bed / "render.py"), str(out)], check=True, cwd=ROOT)


def analyze(wav, frames):
    node = shutil.which("node")
    raw = subprocess.run([node, str(ROOT / "studio/audio/cli.mjs"), "analyze", str(wav), "--loop", f"0:{frames}"], check=True, capture_output=True, text=True, cwd=ROOT).stdout
    return json.loads(raw)["measurements"]


def ledger(bed, wav):
    cfg = BEDS[bed]
    folder = ROOT / "assets/audio" / bed
    with wave.open(str(wav)) as w:
        params, pcm = w.getparams(), w.readframes(w.getnframes())
    assert (params.nchannels, params.sampwidth, params.framerate) == (2, 2, 44100), bed
    frames = params.nframes
    m = analyze(wav, frames)
    bands = {(b["fromHz"], b["toHz"]): b["db"] for b in m["spectrum"]["bandsDb"]}
    band_text = ", ".join(f"{lo}-{hi} Hz {db} dB" for (lo, hi), db in bands.items())
    loop = m["loop"]
    pc = loop["perChannel"]
    return {
        "id": bed, "revision": 1, "base": BASE, "creator": CREATOR, "rights": RIGHTS,
        "inputs": {"score.json": lf_sha(folder / "score.json"), "render.py": lf_sha(folder / "render.py")},
        "input_hash_convention": "SHA-256, text normalized to LF",
        "engine_sha256_lf": {p.relative_to(ROOT).as_posix(): lf_sha(p) for p in sorted((ROOT / "studio/audio").glob("*.mjs"))},
        "render": (f"From the checkout root, run python -I -B assets/audio/{bed}/render.py <output.wav> with CPython {sys.version.split()[0]} "
                   f"(tools/.venvs/project/bin/python) and Node 24 ({subprocess.run([shutil.which('node'), '--version'], check=True, capture_output=True, text=True).stdout.strip()} used). "
                   "render.py runs studio/audio/cli.mjs on score.json; the output parent directory must exist."),
        "patch": cfg["patch"], "tempo_bpm": cfg["tempo_bpm"], "meter": "4/4", "bars": cfg["bars"], "tuning": cfg["tuning"],
        "register_note": (f"The 1.6-5 kHz band that carries the enemy tells holds {bands[(1600, 5000)]} dB of total energy. "
                          f"Measured mono energy share (engine bands): {band_text}."),
        "structure": cfg["structure"], "proposal": PROPOSAL, "master": "master.wav",
        "format": "44100 Hz stereo PCM signed 16-bit little-endian",
        "loop_units": "sample frames per channel, half-open [loopStart, loopEnd)",
        "loopStart": 0, "loopEnd": frames, "frames": frames, "duration_seconds": frames / 44100,
        "onset_tail": "Notes, drone and reverb tails wrap modulo the loop; frame 0 continues from frame loopEnd - 1.",
        "wav_sha256": sha(wav.read_bytes()), "pcm_sha256": sha(pcm),
        "verification": {
            "rebuild": "Rendered by the Studio audio engine; render twice gives byte-identical WAV (tools/tests/test_audio_modes.py rebuilds into a scratch directory and compares).",
            "meter": "Studio audio engine measure (BS.1770 K-weighted LUFS, 4x oversampled true-peak estimate); pack evidence re-measures with the pinned FFmpeg 6.1.1 ebur128.",
            "integrated_lufs": m["loudness"]["integratedLufs"], "true_peak_dbtp": m["peak"]["truePeakDbtp"],
            "loudness_range_lu": m["loudness"]["loudnessRangeLu"], "reference_beds": REFERENCE_BEDS,
            "sample_peak_abs_lr": m["peak"]["perChannel"],
            "last_pcm_lr": [c["lastPcm"] for c in pc], "first_pcm_lr": [c["firstPcm"] for c in pc],
            "signed_seam_step_lr": [c["signedStep"] for c in pc],
            "max_abs_step_within_10ms_either_side_lr": [c["maxAbsStepWithin10ms"] for c in pc],
            "interior_p99_abs_step_lr": [c["interiorP99AbsStep"] for c in pc],
            "scale_check": "Every pitched note is inside the declared pentatonic (key.enforce true; the engine raises out_of_scale otherwise).",
            "human_listening": "Pending. No agent listened to this audio.",
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    check = parser.parse_args().check
    status = 0
    with tempfile.TemporaryDirectory() as tmp:
        for bed in BEDS:
            folder = ROOT / "assets/audio" / bed
            wav = Path(tmp) / f"{bed}.wav"
            render(bed, wav)
            text = (json.dumps(ledger(bed, wav), indent=2) + "\n").encode()
            if check:
                same = (folder / "master.wav").read_bytes() == wav.read_bytes() and (folder / "provenance.json").read_bytes() == text
                print(f"{bed}: {'OK' if same else 'MISMATCH'}")
                status |= not same
            else:
                shutil.copyfile(wav, folder / "master.wav")
                (folder / "provenance.json").write_bytes(text)
                print(f"{bed}: wrote master.wav and provenance.json")
    return status


if __name__ == "__main__":
    sys.exit(main())
