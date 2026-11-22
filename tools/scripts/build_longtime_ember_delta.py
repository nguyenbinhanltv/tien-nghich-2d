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

import numpy as np

HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


blc = _load("build_longtime_characters")


FOOT_ROW = 22  # rows at or below this belong to the feet / board of a 32 px sprite
SPECK_MAX = 3  # 8-connected groups of at most this many opaque pixels count as specks


def remove_foot_specks(arr):
    """Clear opaque groups of <= SPECK_MAX pixels (8-connected) that lie entirely in rows >= FOOT_ROW. Returns (arr, removed)."""
    arr = arr.copy()
    opaque = arr[..., 3] > 0
    h, w = opaque.shape
    seen = np.zeros_like(opaque)
    removed = 0
    for y0 in range(h):
        for x0 in range(w):
            if not opaque[y0, x0] or seen[y0, x0]:
                continue
            group, stack = [], [(y0, x0)]
            seen[y0, x0] = True
            while stack:
                y, x = stack.pop()
                group.append((y, x))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and opaque[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if len(group) <= SPECK_MAX and min(y for y, _ in group) >= FOOT_ROW:
                for y, x in group:
                    arr[y, x] = 0
                removed += len(group)
    return arr, removed


def count_crop(aid, raw_root=blc.RAW):
    """Opaque pixels that centring would crop, summed over every frame. Reads only; writes nothing."""
    _asset, prof = blc.spec_for(aid)
    size = tuple(prof["native_px"])
    raw, _paths = blc.read_raw(aid, prof, raw_root)
    return sum(blc.centre(arr, size)[1] for arr in raw.values())


def build_allowing_crop(aid, raw_root=blc.RAW, out_root=blc.OUT, allow_crop=0, clean_feet=False):
    """Check the crop first (before any file is touched), then build and record the crop and this entry point."""
    crop = count_crop(aid, raw_root)
    if crop > allow_crop:
        raise SystemExit(f"{aid}: {crop} opaque pixels fall outside the profile canvas (allowed {allow_crop}); nothing was written")
    real_centre = blc.centre

    def centre(arr, size):
        out, _lost = real_centre(arr, size)
        return out, 0  # already counted and accepted above

    real_snap = blc.bp.snap_character
    removed_total = [0]

    def snap(*args, **kwargs):
        out = real_snap(*args, **kwargs)
        if clean_feet:
            out, removed = remove_foot_specks(out)
            removed_total[0] += removed
        return out

    blc.centre = centre
    blc.bp.snap_character = snap
    try:
        blc.build(aid, raw_root=raw_root, out_root=out_root)
    finally:
        blc.centre = real_centre
        blc.bp.snap_character = real_snap
    path = Path(raw_root) / aid / "provenance.json"
    prov = json.loads(path.read_text(encoding="utf8"))
    prov["processing"]["cropped_opaque_pixels"] = crop
    prov["processing"]["crop_limit"] = allow_crop
    prov["processing"]["entry_point"] = "tools/scripts/build_longtime_ember_delta.py"
    prov["processing"]["entry_point_sha256"] = blc.sha(Path(__file__))
    if clean_feet:
        prov["processing"]["cleanup"] = {"rule": f"after the 40-colour snap, clear opaque 8-connected groups of <= {SPECK_MAX} px lying entirely in rows >= {FOOT_ROW}",
                                         "removed_pixels": removed_total[0]}
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
    b.add_argument("--clean-feet", action="store_true", help="clear 1-3 px specks in the feet rows (recorded in provenance)")
    a = ap.parse_args()
    print(f"{a.id}: cropped {build_allowing_crop(a.id, allow_crop=a.allow_crop, clean_feet=a.clean_feet)} opaque pixel(s)")


if __name__ == "__main__":
    main()
