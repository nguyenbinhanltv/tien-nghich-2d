#!/usr/bin/env python3
"""Read-only cross-toolchain equivalence check for committed audio packs. It does NOT replace --check.

Rebuilds a pack into a scratch directory with the FFmpeg you pass, decodes both the committed and the rebuilt codec
files with that same FFmpeg, and requires explicit thresholds (not byte equality):
  - identical decoded frame counts and measured decoder head offsets (committed pack.json vs rebuilt);
  - identical decoded SFX cue markers and decoded BGM loop markers;
  - lossless sprite WAV byte-identical;
  - decoded SNR (committed vs rebuilt) >= SNR_FLOOR_DB for every codec file.
The committed pack is never modified. Exit 0 = equivalent within the thresholds, 1 = a threshold failed.

Usage: python -I -B tools/scripts/check_audio_pack_equivalence.py --pack pilot_v1|wave2_batch1_v1|wave2_batch2_v1|... --ffmpeg <ffmpeg> [--json]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SNR_FLOOR_DB = 35.0  # the weakest observed Mac-vs-Windows pair was 36.96 dB (AAC BGM); real codec error vs master is lower still


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"tools/scripts/{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pp = _load("build_audio_pilot_pack")


def rebuild(pack: str, ff, exe: str, out: Path) -> None:
    if pack == "pilot_v1":
        pp.build_pack(ff, out)
    elif pack == "wave2_batch1_v1":
        _load("build_audio_wave2_batch1_pack").build_pack(ff, out)
    else:
        m = _load("build_audio_wave2_pack")
        batch = next(k for k, v in m.BATCHES.items() if v["pack"] == pack)
        m.build_pack(ff, exe, out, batch)


def bgm_blocks(pack: dict) -> list[dict]:
    return pack["bgms"] if "bgms" in pack else [pack["bgm"]]


def compare_blocks(committed: dict, rebuilt: dict) -> list[str]:
    """Structural thresholds from two pack.json dicts; returns violations."""
    bad = []
    for codec, a in committed["sfx"]["codecs"].items():
        b = rebuilt["sfx"]["codecs"][codec]
        for k in ("decoded_frames", "expected_frames", "measured_head_offset_frames"):
            if a[k] != b[k]:
                bad.append(f"sfx {codec} {k}: {a[k]} != {b[k]}")
        if a["decoded_markers"] != b["decoded_markers"]:
            bad.append(f"sfx {codec} decoded cue markers differ")
    if committed["sfx"]["sprite_master"]["sha256"] != rebuilt["sfx"]["sprite_master"]["sha256"]:
        bad.append("sfx sprite master WAV differs")
    for ga, gb in zip(bgm_blocks(committed), bgm_blocks(rebuilt), strict=True):
        for codec, a in ga["codecs"].items():
            b = gb["codecs"][codec]
            for k in ("decoded_frames", "expected_frames", "measured_head_offset_frames", "decoded_loop_frames", "loop_source_frames"):
                if a[k] != b[k]:
                    bad.append(f"{ga['id']} {codec} {k}: {a[k]} != {b[k]}")
    return bad


def snr(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        return float("-inf")
    e = b.astype(np.float64) - a.astype(np.float64)
    den = float(np.sum(e * e))
    return float("inf") if den == 0 else float(10 * np.log10(max(float(np.sum(a.astype(np.float64) ** 2)), 1e-9) / den))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack", required=True)
    ap.add_argument("--ffmpeg", required=True)
    ap.add_argument("--snr-floor", type=float, default=SNR_FLOOR_DB)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    pack_dir = ROOT / "assets/audio/packs" / a.pack
    committed = json.loads((pack_dir / "pack.json").read_text(encoding="utf-8"))
    ff = pp.FF(a.ffmpeg)
    scratch = Path(tempfile.gettempdir()).resolve()
    with tempfile.TemporaryDirectory(dir=scratch) as d:
        out = Path(d)
        rebuild(a.pack, ff, a.ffmpeg, out)
        rebuilt = json.loads((out / "pack.json").read_text(encoding="utf-8"))
        violations = compare_blocks(committed, rebuilt)
        rows = []
        files = [(committed["sfx"]["codecs"][c]["file"], 1) for c in committed["sfx"]["codecs"]]
        files += [(blk["file"], 2) for g in bgm_blocks(committed) for blk in g["codecs"].values()]
        for name, ch in files:
            x, y = ff.decode(pack_dir / name, ch), ff.decode(out / name, ch)
            s = snr(x, y)
            rows.append({"file": name, "byte_identical": (pack_dir / name).read_bytes() == (out / name).read_bytes(),
                         "decoded_identical": bool(x.shape == y.shape and (x == y).all()),
                         "snr_db": None if s == float("inf") else round(s, 2), "max_abs_diff_pcm": int(np.abs(x.astype(np.int32) - y.astype(np.int32)).max()) if x.shape == y.shape else None})
            if s < a.snr_floor:
                violations.append(f"{name}: decoded SNR {s:.2f} dB < floor {a.snr_floor} dB")
    report = {"pack": a.pack, "ffmpeg": ff.version, "snr_floor_db": a.snr_floor, "files": rows, "violations": violations, "equivalent": not violations,
              "note": "Threshold equivalence only; does not replace the byte-exact --check on the pack's pinned toolchain."}
    if a.json:
        print(json.dumps(report, indent=2))
    else:
        for r in rows:
            print(f"{r['file']}: bytes {'=' if r['byte_identical'] else '!='}, decoded {'=' if r['decoded_identical'] else '!='}, SNR {r['snr_db'] if r['snr_db'] is not None else 'inf'} dB, max|diff| {r['max_abs_diff_pcm']}")
        print("EQUIVALENT within thresholds" if not violations else "NOT EQUIVALENT:\n  " + "\n  ".join(violations))
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
