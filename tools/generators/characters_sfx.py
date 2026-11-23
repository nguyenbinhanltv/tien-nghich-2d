"""Render the three Characters one-shots (sfx_keeper_call, sfx_pet_reply, sfx_form_shift) with the Studio audio engine.

The patches (assets/audio/source/characters_sfx/*.patch.json) are project data; the engine is the project's own
studio/audio (oscillators, FM and filtered noise, MT19937 seeds, no samples). This script runs the Node renderer,
measures the PCM and writes the ledger. Usage: python -I -B tools/generators/characters_sfx.py --out <empty-directory>
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import wave

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / "assets/audio/source/characters_sfx"
IDS = ("sfx_keeper_call", "sfx_pet_reply", "sfx_form_shift")
RATE = 44100
RIGHTS = "Original procedural sound design created for Tien Nghich 2D."


def sha(data):
    return hashlib.sha256(data).hexdigest()


def lf_sha(path):
    return sha(path.read_text(encoding="utf-8").encode())


def record(cue, path, patch):
    with wave.open(str(path)) as stream:
        params = stream.getparams()
        pcm = stream.readframes(params.nframes)
    if (params.nchannels, params.sampwidth, params.framerate) != (1, 2, RATE):
        raise ValueError(f"{cue}: expected mono PCM16 at 44100 Hz")
    samples = [int.from_bytes(pcm[i:i + 2], "little", signed=True) for i in range(0, len(pcm), 2)]
    peak = max(map(abs, samples))
    if not 0 < peak < 32767 or samples[0] or samples[-1]:
        raise ValueError(f"Invalid peak or endpoint in {cue}")
    onset = next(i for i, v in enumerate(samples) if v)
    end = len(samples) - next(i for i, v in enumerate(reversed(samples)) if v)
    rms = math.sqrt(sum(v * v for v in samples) / len(samples))
    return {"id": cue, "file": path.name, "seed": patch["seed"], "frames": len(samples),
            "duration_ms": len(samples) * 1000 / RATE, "onset_frame": onset, "tail_end_exclusive": end,
            "sample_peak_dbfs": round(20 * math.log10(peak / 32768), 3),
            "rms_dbfs": round(20 * math.log10(rms / 32768), 3),
            "pcm_sha256": sha(pcm), "wav_sha256": sha(path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="empty output directory")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        parser.error("choose an empty output directory")
    contract = json.loads((ROOT / "assets/audio_manifest.json").read_bytes())
    if list(IDS) != contract["extensions"]["characters"]["sfx"]:
        raise ValueError("Unexpected Characters cue IDs")
    node = shutil.which("node")
    subprocess.run([node, str(HERE / "characters_sfx.mjs"), "--out", str(out)], check=True, cwd=ROOT)
    windows = json.loads((out / "windows.json").read_bytes())
    patches = {cue: json.loads((SOURCE / f"{cue}.patch.json").read_bytes()) for cue in IDS}
    records = []
    for cue in IDS:
        rec = record(cue, out / f"{cue}.wav", patches[cue])
        win = windows[cue]
        rec["window"] = {k: win[k] for k in ("kind", "windowMs", "tailMs", "totalMs", "scale", "baseDurationMs", "configSha256")}
        records.append(rec)
    engine = sorted(p for p in (ROOT / "studio/audio").glob("*.mjs"))
    sources = [Path(__file__).resolve(), HERE / "characters_sfx.mjs", *engine, *(SOURCE / f"{c}.patch.json" for c in IDS)]
    ledger = {
        "creator": "Claude Code (Anthropic, claude-sonnet-5-5) for Tien Nghich 2D",
        "rights": RIGHTS,
        "inputs": "Project patches and the project's own Studio audio engine (oscillator, FM, filtered noise) only; no source recordings, samples, soundfonts or generative-audio models.",
        "format": "Mono PCM16 little-endian WAV, 44100 Hz; one-shots without loops.",
        "markers": "Integer sample frames; [onset_frame, tail_end_exclusive) bounds all nonzero PCM.",
        "tuning": "Absolute Hz per layer; A4=440 Hz reference, no beat grid.",
        "synthesis": "Studio audio engine: zero oscillator phase and filter states, MT19937 with seed + layer index, round-half-even frame conversion, nearest-even PCM16, no dither. Each patch is sized by its gameplay window (F9) before rendering.",
        "gameplay_windows": "Proposed by the author, not set by the project owner: each cue is sized to the gameplay moment it marks (the documented length of its VFX clip, or a stated length when no clip exists) plus a tail; see docs/AUDIO_DESIGN.md, 'Characters proposal'.",
        "rebuild": "python -I -B tools/generators/characters_sfx.py --out <empty-directory>",
        "python": sys.version.split()[0],
        "node": subprocess.run([node, "--version"], check=True, capture_output=True, text=True).stdout.strip(),
        "source_sha256_lf": {p.relative_to(ROOT).as_posix(): lf_sha(p) for p in sources},
        "masters": records,
    }
    (out / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


if __name__ == "__main__":
    main()
