#!/usr/bin/env python3
"""Verify generated UI & card icon assets against Tiên Nghịch 2D v2 constraints.

Checks:
  1. Expected asset count & PNG presence matching gen_ui_icons_log.json (and no stale PNGs)
  2. Exact dimensions match logged specs AND palette.json size_classes.icon (16x16 or 24x24)
  3. Palette-only: 100% of opaque pixels exist in tools/generators/palette.json (v2, 43 colors)
  4. Transparency: binary alpha (0 or 255 only), both transparent and opaque pixels present
  5. Crisp 1px ink_01 (#14101a) silhouette outline (including image border edges, zero >1px warnings)
  6. Determinism: two independent runs produce byte-identical SHA-256 across all PNGs + workspace output
  7. CLI smoke check: --only filters to a single asset id cleanly
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Set, Tuple

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GEN_SCRIPT = REPO_ROOT / "tools" / "generators" / "gen_ui_icons.py"
PALETTE_PATH = REPO_ROOT / "tools" / "generators" / "palette.json"
DEFAULT_OUT = REPO_ROOT / "assets" / "raw" / "environment_items" / "ui"


def load_palette(path: Path) -> Tuple[Set[Tuple[int, int, int]], Tuple[int, int, int], Set[Tuple[int, int]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
    colors = {rgb(c["hex"].lower()) for c in raw["colors"]}
    outline = rgb(raw["outline"].lower())
    icon_sizes = {(int(w), int(h)) for w, h in raw["size_classes"]["icon"]["sizes"]}
    return colors, outline, icon_sizes


def check_png(
    path: Path,
    expected_dims: Tuple[int, int],
    palette: Set[Tuple[int, int, int]],
    outline: Tuple[int, int, int],
    icon_sizes: Set[Tuple[int, int]],
) -> Tuple[List[str], List[str]]:
    errs: List[str] = []
    warns: List[str] = []

    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if (w, h) != expected_dims:
        errs.append(f"dims mismatch: got {w}x{h}, expected {expected_dims[0]}x{expected_dims[1]}")
    if (w, h) not in icon_sizes:
        errs.append(f"dims {w}x{h} not in palette.json size_classes.icon {sorted(icon_sizes)}")

    flat = im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata()
    px = list(flat)
    rows = [px[y * w:(y + 1) * w] for y in range(h)]

    transp_count = 0
    opaque_count = 0
    soft_alpha = 0
    off_palette = 0
    bad_edge = 0
    edge_n = 0
    thick = 0

    def is_opaque(x: int, y: int) -> bool:
        return 0 <= x < w and 0 <= y < h and rows[y][x][3] == 255

    def is_transp_or_border(x: int, y: int) -> bool:
        return not (0 <= x < w and 0 <= y < h) or rows[y][x][3] == 0

    for y in range(h):
        for x in range(w):
            r, g, b, a = rows[y][x]
            if a == 0:
                transp_count += 1
                continue
            if a != 255:
                soft_alpha += 1
                continue
            opaque_count += 1
            if (r, g, b) not in palette:
                off_palette += 1
            nb = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
            if any(is_transp_or_border(nx, ny) for nx, ny in nb):
                edge_n += 1
                if (r, g, b) != outline:
                    bad_edge += 1
                else:
                    inward = [(nx, ny) for nx, ny in nb if is_opaque(nx, ny)]
                    if inward and all(rows[ny][nx][:3] == outline for nx, ny in inward):
                        thick += 1

    if opaque_count == 0:
        errs.append("no opaque pixels")
    if transp_count == 0:
        errs.append("no transparent background pixels")
    if soft_alpha:
        errs.append(f"{soft_alpha} semi-transparent pixel(s)")
    if off_palette:
        errs.append(f"{off_palette} off-palette pixel(s)")
    if bad_edge:
        errs.append(f"{bad_edge}/{edge_n} edge pixel(s) not outline color")
    if edge_n and thick * 4 > edge_n:
        warns.append(f"outline may be >1px ({thick}/{edge_n})")

    return errs, warns


def hash_tree(root: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def verify(out_dir: Path = DEFAULT_OUT) -> int:
    palette, outline, icon_sizes = load_palette(PALETTE_PATH)
    log_path = out_dir / "gen_ui_icons_log.json"
    if not log_path.exists():
        print(f"FAIL: missing log {log_path}")
        return 1

    log = json.loads(log_path.read_text(encoding="utf-8"))
    files = log["files"]
    failures = 0
    warnings = 0
    expected_rel = {e["file"] for e in files}
    actual_rel = {p.relative_to(out_dir).as_posix() for p in out_dir.rglob("*.png")}
    extra = sorted(actual_rel - expected_rel)
    if extra:
        print(f"FAIL: unexpected stale PNG(s) in {out_dir}: {extra}")
        failures += len(extra)

    for entry in files:
        fpath = out_dir / entry["file"]
        if not fpath.exists():
            print(f"FAIL: missing file {fpath}")
            failures += 1
            continue
        actual_sha = hashlib.sha256(fpath.read_bytes()).hexdigest()
        errs, warns = check_png(fpath, tuple(entry["dims"]), palette, outline, icon_sizes)
        if actual_sha != entry["sha256"]:
            errs.append("sha256 mismatch vs gen_ui_icons_log.json")
        if errs:
            print(f"FAIL {entry['file']}: {'; '.join(errs)}")
            failures += 1
        if warns:
            print(f"WARN {entry['file']}: {'; '.join(warns)}")
            warnings += len(warns)

    with tempfile.TemporaryDirectory(prefix="tn2d_det_") as tmp:
        tmp_path = Path(tmp)
        run1 = tmp_path / "run1"
        run2 = tmp_path / "run2"
        only_dir = tmp_path / "only_test"

        subprocess.run([sys.executable, str(GEN_SCRIPT), "--out", str(run1)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([sys.executable, str(GEN_SCRIPT), "--out", str(run2)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(
            [sys.executable, str(GEN_SCRIPT), "--out", str(only_dir), "--only", "icon_sinh_tu_cam"],
            check=True,
            stdout=subprocess.DEVNULL,
        )

        h1 = {k: v for k, v in hash_tree(run1).items() if k.endswith(".png")}
        h2 = {k: v for k, v in hash_tree(run2).items() if k.endswith(".png")}
        h_prod = {k: v for k, v in hash_tree(out_dir).items() if k.endswith(".png")}

        if h1 != h2:
            print("FAIL: non-deterministic output between run1 and run2!")
            failures += 1
        elif h1 != h_prod:
            print("FAIL: production output differs from fresh rerun!")
            failures += 1
        else:
            print(f"PASS determinism: {len(h1)} PNG(s) 100% byte-identical across 2 fresh runs & workspace output")

        only_pngs = sorted(p.name for p in only_dir.rglob("*.png"))
        expected_only = ["icon_sinh_tu_cam_16x16.png", "icon_sinh_tu_cam_24x24.png"]
        if only_pngs != expected_only:
            print(f"FAIL --only filter: got {only_pngs}, expected {expected_only}")
            failures += 1
        else:
            print(f"PASS --only CLI: generated exactly {only_pngs}")

    print(
        f"SUMMARY: {len(files)} PNGs across {log['total_assets']} assets | "
        f"palette_version={log.get('palette_version')} | failures={failures} | warnings={warnings}"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    sys.exit(verify(target))
