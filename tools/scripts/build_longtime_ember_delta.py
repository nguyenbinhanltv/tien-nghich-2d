#!/usr/bin/env python3
"""Build the ember_delta PixelLab characters with build_longtime_characters.py, tolerating a recorded crop.

PixelLab v3 animations come back on a canvas larger than the 64 px boss profile; a paddle tip can leave the
64 px box by a pixel or two. build_longtime_characters.build() refuses any loss, so this wrapper counts the
opaque pixels that centring would crop BEFORE writing anything, refuses (and leaves every file alone) when
there are more than --allow-crop of them, and otherwise records the count, the limit and this entry point's
hash in the asset's provenance.json (processing.*), plus review.status = awaiting_owner_review.
The shared script is not modified.

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


def count_crop(aid, raw_root=blc.RAW):
    """Opaque pixels that centring would crop, summed over every frame. Reads only; writes nothing."""
    _asset, prof = blc.spec_for(aid)
    size = tuple(prof["native_px"])
    raw, _paths = blc.read_raw(aid, prof, raw_root)
    return sum(blc.centre(arr, size)[1] for arr in raw.values())


def build_allowing_crop(aid, raw_root=blc.RAW, out_root=blc.OUT, allow_crop=0):
    """Check the crop first (before any file is touched), then build and record the crop and this entry point."""
    crop = count_crop(aid, raw_root)
    if crop > allow_crop:
        raise SystemExit(f"{aid}: {crop} opaque pixels fall outside the profile canvas (allowed {allow_crop}); nothing was written")
    real_centre = blc.centre

    def centre(arr, size):
        out, _lost = real_centre(arr, size)
        return out, 0  # already counted and accepted above

    blc.centre = centre
    try:
        blc.build(aid, raw_root=raw_root, out_root=out_root)
    finally:
        blc.centre = real_centre
    path = Path(raw_root) / aid / "provenance.json"
    prov = json.loads(path.read_text(encoding="utf8"))
    prov["processing"]["cropped_opaque_pixels"] = crop
    prov["processing"]["crop_limit"] = allow_crop
    prov["processing"]["entry_point"] = "tools/scripts/build_longtime_ember_delta.py"
    prov["processing"]["entry_point_sha256"] = blc.sha(Path(__file__))
    prov["processing"]["builder_dependency"] = "tools/scripts/build_longtime_characters.py (script / script_sha256 above); it refuses any crop when run on its own, so this entry point is the one that reproduces these files"
    prov["review"] = {"status": "awaiting_owner_review",
                      "note": "PixelLab output integrated as a processed baseline. No human has approved this art; assets/review/art_approvals.json does not list it."}
    path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    return crop


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
