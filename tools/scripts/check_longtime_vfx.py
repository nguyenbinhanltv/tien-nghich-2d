#!/usr/bin/env python3
"""Machine checks for the processed Longtime VFX frames (docs/LONGTIME_VFX.md section 5).

For every `vfx` entry of assets/manifest_longtime.json whose status is not `planned`:
  - exact frame inventory `<clip>_<palette>_<n>.png` (no extras, no zero padding), size = native_px
  - binary alpha, transparent RGB (0,0,0), every opaque pixel in the 40 colours
  - per variant: colours inside the variant's declared ramps plus ink_01, at most max_colors_per_palette
  - no opaque pixel in the outer 1 px ring; pivot inside the canvas
  - variants are recolours: identical alpha masks per frame and one consistent colour bijection per clip
  - first/last/peak/jump opaque coverage against the entry's acceptance numbers
  - project outline gate: every silhouette-edge pixel of a non-empty frame is ink_01
  - provenance.json frame hashes equal the files on disk
Empty frames are legal (a one-shot may end on nothing); the outline gate skips them.

Run: tools/.venvs/project/bin/python -I tools/scripts/check_longtime_vfx.py [--json] [ids...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "assets/manifest_longtime.json"
PALETTE = ROOT / "tools/generators/palette.json"
RAMPS = ROOT / "tools/generators/vfx_specs/palettes/tien_nghich_40.json"
PROCESSED = ROOT / "assets/processed_longtime"
RAW = ROOT / "assets/raw/longtime"
NAME_RE = re.compile(r"^(?P<clip>[a-z_]+)_(?P<pal>[a-z_]+)_(?P<n>\d+)\.png$")


def rgb_int(h: str) -> int:
    h = h.lstrip("#")
    return int(h, 16)


def pack(arr: np.ndarray) -> np.ndarray:
    return (arr[..., 0].astype(np.uint32) << 16) | (arr[..., 1].astype(np.uint32) << 8) | arr[..., 2]


def load_ref():
    pal = json.loads(PALETTE.read_text(encoding="utf-8"))
    ramps = json.loads(RAMPS.read_text(encoding="utf-8"))
    all40 = {rgb_int(c["hex"]) for c in pal["colors"]}
    return all40, rgb_int(pal["outline"]), {k: {rgb_int(h) for h in v} for k, v in ramps["ramps"].items()}


def edge_not_outline(opaque: np.ndarray, px: np.ndarray, outline: int) -> int:
    t = ~opaque
    nb = np.zeros_like(opaque)
    nb[1:, :] |= t[:-1, :]
    nb[:-1, :] |= t[1:, :]
    nb[:, 1:] |= t[:, :-1]
    nb[:, :-1] |= t[:, 1:]
    return int((opaque & nb & (px != outline)).sum())


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def check_entry(entry: dict, processed: Path = PROCESSED, raw: Path = RAW, manifest_ref=None) -> tuple[list, dict]:
    """Return (issues, stats) for one vfx entry. Issues are (code, where, detail)."""
    all40, outline, ramps = manifest_ref or load_ref()
    issues: list[tuple[str, str, str]] = []
    eid = entry["id"]
    w, h = entry["native_px"]
    px_, py_ = entry["pivot_px"]
    if not (0 <= px_ < w and 0 <= py_ < h):
        issues.append(("pivot", eid, f"pivot {entry['pivot_px']} outside {w}x{h}"))
    clips, palettes, acc = entry["clips"], entry["palettes"], entry["acceptance"]
    d = processed / eid
    want = {f"{c}_{p}_{i}.png" for c, cd in clips.items() for p in palettes for i in range(cd["n"])}
    have = {p.name for p in d.glob("*.png")} if d.is_dir() else set()
    for name in sorted(want - have):
        issues.append(("missing_frame", f"{eid}/{name}", "frame not found"))
    for name in sorted(have - want):
        m = NAME_RE.match(name)
        code = "zero_padded" if m and m["n"] != str(int(m["n"])) else "extra_frame"
        issues.append((code, f"{eid}/{name}", "not declared by the manifest"))
    cov: dict[tuple[str, str], list[float]] = {}
    masks: dict[tuple[str, str, int], np.ndarray] = {}
    pxs: dict[tuple[str, str, int], np.ndarray] = {}
    colours: dict[str, set] = {p: set() for p in palettes}
    for clip, cd in clips.items():
        for pal in palettes:
            row = []
            for i in range(cd["n"]):
                name = f"{clip}_{pal}_{i}.png"
                where = f"{eid}/{name}"
                if name not in have:
                    row.append(None)
                    continue
                im = Image.open(d / name)
                arr = np.array(im.convert("RGBA"))
                if (im.width, im.height) != (w, h):
                    issues.append(("size", where, f"{im.width}x{im.height} != {w}x{h}"))
                    row.append(None)
                    continue
                a = arr[..., 3]
                if ((a != 0) & (a != 255)).any():
                    issues.append(("alpha", where, "alpha must be 0 or 255"))
                opaque = a == 255
                if ((a == 0) & (arr[..., :3].sum(-1) != 0)).any():
                    issues.append(("dirty_transparent", where, "transparent RGB must be (0,0,0)"))
                px = pack(arr[..., :3])
                if not np.isin(px[opaque], list(all40)).all():
                    issues.append(("off_palette", where, "opaque pixel outside the 40 colours"))
                border = np.zeros_like(opaque)
                border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
                if (opaque & border).any():
                    issues.append(("border", where, "opaque pixel in the outer 1 px ring"))
                if opaque.any():
                    bad = edge_not_outline(opaque, px, outline)
                    if bad:
                        issues.append(("outline_gate", where, f"{bad} silhouette-edge pixels are not ink_01"))
                colours[pal] |= set(np.unique(px[opaque]).tolist())
                masks[(clip, pal, i)] = opaque
                pxs[(clip, pal, i)] = px
                row.append(100.0 * opaque.sum() / (w * h))
            cov[(clip, pal)] = row
    for pal, spec in palettes.items():
        allowed = {outline}
        for r in spec["ramps"]:
            allowed |= ramps[r]
        extra = colours[pal] - allowed
        if extra:
            issues.append(("ramp", f"{eid}/{pal}", "colours outside declared ramps: " +
                           ", ".join("#%06x" % c for c in sorted(extra))))
        if len(colours[pal]) > acc["max_colors_per_palette"]:
            issues.append(("colors", f"{eid}/{pal}", f"{len(colours[pal])} colours > {acc['max_colors_per_palette']}"))
    names = list(palettes)
    for clip, cd in clips.items():
        for other in names[1:]:
            bij, inv = {}, {}
            for i in range(cd["n"]):
                ka, kb = (clip, names[0], i), (clip, other, i)
                if ka not in masks or kb not in masks:
                    continue
                if not np.array_equal(masks[ka], masks[kb]):
                    issues.append(("mask", f"{eid}/{clip}_{i}", f"{names[0]} and {other} alpha masks differ"))
                    continue
                for ca, cb in zip(pxs[ka][masks[ka]].tolist(), pxs[kb][masks[kb]].tolist()):
                    if bij.setdefault(ca, cb) != cb or inv.setdefault(cb, ca) != ca:
                        issues.append(("recolour", f"{eid}/{clip}_{i}",
                                       f"{other} is not a one-to-one recolour of {names[0]}"))
                        break
    stats = {"coverage_pct": {f"{c}_{p}": [None if v is None else round(v, 2) for v in r] for (c, p), r in cov.items()}}
    for (clip, pal), row in cov.items():
        if any(v is None for v in row):
            continue
        if row[0] > acc["first_frame_max_opaque_pct"]:
            issues.append(("first_frame", f"{eid}/{clip}_{pal}", f"{row[0]:.2f}% > {acc['first_frame_max_opaque_pct']}%"))
        if row[-1] > acc["last_frame_max_opaque_pct"]:
            issues.append(("last_frame", f"{eid}/{clip}_{pal}", f"{row[-1]:.2f}% > {acc['last_frame_max_opaque_pct']}%"))
        if max(row) > acc["peak_opaque_pct"][1]:
            issues.append(("peak_high", f"{eid}/{clip}_{pal}", f"{max(row):.2f}% > {acc['peak_opaque_pct'][1]}%"))
        jump = max(abs(b - a) for a, b in zip(row, row[1:])) if len(row) > 1 else 0
        if jump > acc["max_frame_jump_pct"]:
            issues.append(("jump", f"{eid}/{clip}_{pal}", f"{jump:.2f}% > {acc['max_frame_jump_pct']}%"))
    peaks = [max(r) for r in cov.values() if r and all(v is not None for v in r)]
    if peaks and max(peaks) < acc["peak_opaque_pct"][0]:
        issues.append(("peak_low", eid, f"best peak {max(peaks):.2f}% < {acc['peak_opaque_pct'][0]}%"))
    prov = raw / eid / "provenance.json"
    if not prov.is_file():
        issues.append(("provenance", eid, "provenance.json missing"))
    else:
        doc = json.loads(prov.read_text(encoding="utf-8"))
        for f in doc.get("frames", []):
            p = ROOT / f["path"] if processed == PROCESSED else processed / Path(f["path"]).relative_to(f"assets/processed_longtime")
            if not p.is_file() or sha256(p) != f["sha256"]:
                issues.append(("provenance_hash", f["key"], "frame hash differs from provenance.json"))
    return issues, stats


def check_all(manifest: dict, ids: list[str] | None = None, **kw) -> tuple[list, dict]:
    ref = load_ref()
    issues, stats = [], {}
    for e in manifest["vfx"]["entries"]:
        if (ids and e["id"] not in ids) or e["status"] == "planned":
            continue
        i, s = check_entry(e, manifest_ref=ref, **kw)
        issues += i
        stats[e["id"]] = s
    return issues, stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    issues, stats = check_all(manifest, a.ids or None)
    if a.json:
        print(json.dumps({"issues": issues, "stats": stats}, indent=1))
    else:
        for code, where, detail in issues:
            print(f"error {code:16} {where}: {detail}")
        print(f"checked {len(stats)} VFX ids; {len(issues)} problems")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
