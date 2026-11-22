#!/usr/bin/env python3
"""Build the ember_delta PixelLab characters with build_longtime_characters.py, tolerating a recorded crop.

PixelLab v3 animations come back on a canvas larger than the 64 px boss profile; a paddle tip can leave the
64 px box by a pixel or two. build_longtime_characters.build() refuses any loss, so this wrapper counts the
opaque pixels that centring crops, allows at most --allow-crop of them, and writes the count into the
asset's provenance.json (processing.cropped_opaque_pixels). The shared script is not modified.

  python -I tools/scripts/build_longtime_ember_delta.py build <id> [--allow-crop N]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


blc = _load("build_longtime_characters")


def build_allowing_crop(aid, raw_root=blc.RAW, out_root=blc.OUT, allow_crop=0):
    real_centre = blc.centre
    lost_total = [0]

    def centre(arr, size):
        out, lost = real_centre(arr, size)
        lost_total[0] += lost
        return out, 0

    blc.centre = centre
    try:
        blc.build(aid, raw_root=raw_root, out_root=out_root)
    finally:
        blc.centre = real_centre
    if lost_total[0] > allow_crop:
        raise SystemExit(f"{aid}: {lost_total[0]} opaque pixels fall outside the profile canvas (allowed {allow_crop})")
    path = Path(raw_root) / aid / "provenance.json"
    prov = json.loads(path.read_text(encoding="utf8"))
    prov["processing"]["cropped_opaque_pixels"] = lost_total[0]
    path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    return lost_total[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("id")
    b.add_argument("--allow-crop", type=int, default=0)
    a = ap.parse_args()
    print(f"{a.id}: cropped {build_allowing_crop(a.id, allow_crop=a.allow_crop)} opaque pixel(s)")


if __name__ == "__main__":
    main()
