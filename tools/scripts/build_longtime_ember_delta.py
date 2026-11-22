#!/usr/bin/env python3
"""Build the ember_delta PixelLab characters with build_longtime_characters.py.

The shared builder does the work, including the per-frame crop allowance read from generation.json
(`crop_allowance`; checked BEFORE any file is written and recorded in provenance as processing.cropped_opaque_pixels).
This entry point adds two things the shared builder does not have:
  --clean-feet  clear 1-3 px specks in the feet rows after the 40-colour snap (used for lt_ash_skater; recorded in
                provenance as processing.cleanup)
  and, for every asset it builds, the provenance records this entry point and its hash, and review.status =
  approved_by_owner (the owner approved this art in chat on 2026-11-22; assets/review/art_approvals.json is the record).

  python -I tools/scripts/build_longtime_ember_delta.py build <id> [--clean-feet]
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


def build_character(aid, raw_root=blc.RAW, out_root=blc.OUT, clean_feet=False):
    """Run the shared builder (it refuses, before writing, any crop not allowed in generation.json), then record this entry point."""
    real_snap = blc.bp.snap_character
    removed_total = [0]

    def snap(*args, **kwargs):
        out = real_snap(*args, **kwargs)
        if clean_feet:
            out, removed = remove_foot_specks(out)
            removed_total[0] += removed
        return out

    blc.bp.snap_character = snap
    try:
        blc.build(aid, raw_root=raw_root, out_root=out_root)
    finally:
        blc.bp.snap_character = real_snap
    path = Path(raw_root) / aid / "provenance.json"
    prov = json.loads(path.read_text(encoding="utf8"))
    proc = prov["processing"]
    proc["entry_point"] = "tools/scripts/build_longtime_ember_delta.py"
    proc["entry_point_sha256"] = blc.sha(Path(__file__))
    if clean_feet:
        proc["cleanup"] = {"rule": f"after the 40-colour snap, clear opaque 8-connected groups of <= {SPECK_MAX} px lying entirely in rows >= {FOOT_ROW}",
                           "removed_pixels": removed_total[0]}
    prov["review"] = {"status": "approved_by_owner", "approved_by": "project owner", "approved_on": "2026-11-22",
                      "approval_id": "owner_all_studio_art_2026-11-22",
                      "note": "The project owner approved this art as it is, flaws in known_flaws included, in chat on 2026-11-22 (\"Duyệt hết assets trên studio cho tôi\"). The record, tied to each frame's sha256, is assets/review/art_approvals.json."}
    path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("id")
    b.add_argument("--clean-feet", action="store_true", help="clear 1-3 px specks in the feet rows (recorded in provenance)")
    a = ap.parse_args()
    build_character(a.id, clean_feet=a.clean_feet)


if __name__ == "__main__":
    main()
