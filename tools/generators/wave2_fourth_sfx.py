"""Render the fourth and last eight core one-shots (progression and UI cues) using the project's original DSP."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

# The isolated Python invocation excludes the script directory from sys.path.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from pilot_sfx import render

ROOT = HERE.parents[1]
PRESETS = ROOT / "assets/audio/source/wave2_fourth_sfx/presets.json"
IDS = ("sfx_seed", "sfx_harvest", "sfx_kiln", "sfx_craft",
       "sfx_gate", "sfx_bond", "sfx_ward_place", "sfx_reward")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="empty output directory")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        parser.error("choose an empty output directory")
    presets = json.loads(PRESETS.read_bytes())
    contract = json.loads((ROOT/"assets/audio_manifest.json").read_bytes())
    core = contract["core"]
    if tuple(presets) != IDS or not set(IDS) <= set(core["combat"] + core["progression_ui"]):
        raise ValueError("Unexpected Wave 2 cue IDs")
    records = [render(cue, presets[cue], out) for cue in IDS]
    sources = (Path(__file__).resolve(), HERE/"pilot_sfx.py", PRESETS)
    ledger = {
        "creator": "Claude Code (Anthropic, claude-sonnet-5-5) for Tien Nghich 2D",
        "rights": "Original procedural sound design created for Tien Nghich 2D.",
        "inputs": "Project DSP and original presets only; no source recordings, model weights or soundfonts.",
        "format": "Mono PCM16 little-endian WAV, 44100 Hz; one-shots without loops.",
        "markers": "Integer sample frames; [onset_frame, tail_end_exclusive) bounds all nonzero PCM.",
        "tuning": "Absolute Hz per layer; A4=440 Hz reference, no beat grid.",
        "synthesis": "Zero oscillator phase and filter states, MT19937 with seed + layer index, nearest-even rounding, no dither.",
        "rebuild": "python -I -B tools/generators/wave2_fourth_sfx.py --out <empty-directory>",
        "python": sys.version.split()[0],
        "source_sha256_lf": {p.relative_to(ROOT).as_posix(): hashlib.sha256(
            p.read_text(encoding="utf-8").encode()).hexdigest() for p in sources},
        "masters": records,
    }
    (out/"provenance.json").write_bytes((json.dumps(ledger, indent=2)+"\n").encode())


if __name__ == "__main__":
    main()
