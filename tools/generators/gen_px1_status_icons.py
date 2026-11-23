#!/usr/bin/env python3
"""Code-drawn status icons for the Blood Sea vertical slice (PX-1, 2026-11-24), 24x24 and a 16x16 variant each.

Three states the sim already has (game/src/contracts/world.ts combat state): guard (Hộ Thể), counter window (the 900 ms
STRIKE window after a timed dodge, GDD/encounter `counterWindow`) and damage immunity (dash / hurt blink). Master palette only
(by id), binary alpha, 1 px ink_01 outline on the outer silhouette. No image model, no PixelLab.
Output: assets/raw/environment_items/ui/<id>/<id>_24x24.png and _16x16.png (the layout of the other icons) and, where the
ledger looks, assets/raw/environment_items/icons/<id>/provenance.json (source_sha256 = tree hash of the ui/<id> frames).

    python tools/generators/gen_px1_status_icons.py [--out DIR]
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PALETTE = {c["id"]: tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in
           json.loads((ROOT / "tools/generators/palette.json").read_text(encoding="utf-8"))["colors"]}
IDS = {"icon_status_guard": "Hộ Thể: guard up", "icon_status_counter": "Phản Chấn: counter-strike window",
       "icon_status_immune": "Bất Tổn: damage immunity"}
REFS = {"icon_status_guard": ["jade_03", "jade_05", "jade_06", "bronze_05", "ink_01"],
        "icon_status_counter": ["bronze_04", "bronze_06", "bronze_07", "thunder_03", "ink_01"],
        "icon_status_immune": ["soul_04", "soul_06", "soul_07", "thunder_04", "ink_01"]}


class Canvas:
    def __init__(self, size):
        self.n, self.px = size, {}

    def put(self, x, y, c):
        if 1 <= x <= self.n - 2 and 1 <= y <= self.n - 2:
            self.px[(x, y)] = c

    def row(self, y, x0, x1, c):
        for x in range(x0, x1 + 1):
            self.put(x, y, c)

    def image(self):
        out = Image.new("RGBA", (self.n, self.n), (0, 0, 0, 0))
        o = out.load()
        for (x, y), c in self.px.items():
            o[x, y] = (*PALETTE[c], 255)
        for (x, y) in list(self.px):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                p = (x + dx, y + dy)
                if 0 <= p[0] < self.n and 0 <= p[1] < self.n and p not in self.px:
                    o[p] = (*PALETTE["ink_01"], 255)
        return out


def guard(c):
    """A heater shield: flat top, tapering to a point; bronze rim, jade face, bright upper-left facet and a centre boss."""
    n = c.n
    mid, top, bottom = n // 2, 2 + (n > 16), n - 3
    half = (n - 6) // 2
    for y in range(top, bottom + 1):
        t = (y - top) / (bottom - top)
        w = half if t < 0.45 else max(0, round(half * (1 - (t - 0.45) / 0.55)))
        c.row(y, mid - w, mid + w - 1, "bronze_05")
        if w > 1:
            c.row(y, mid - w + 1, mid + w - 2, "jade_04")
    for y in range(top + 1, top + 1 + max(2, n // 6)):          # light from the top left
        c.row(y, mid - half + 1, mid - 1, "jade_06")
    for y in range(top + 1, bottom - 1):
        c.put(mid - 1, y, "jade_05")
    c.put(mid, mid, "bronze_07"); c.put(mid - 1, mid, "bronze_07")
    c.put(mid - half, top, "bronze_07")


def counter(c):
    """A four-point gold starburst with a cyan core: the strike window is open."""
    n = c.n
    mid = n // 2
    arm = mid - 2
    for i in range(-arm, arm):
        t = abs(i + 0.5) / arm
        thick = 1 if t > 0.45 else 2
        for k in range(thick):
            c.put(mid + i, mid - 1 + k, "bronze_05" if t > 0.3 else "bronze_06")
            c.put(mid - 1 + k, mid + i, "bronze_05" if t > 0.3 else "bronze_06")
    for d in range(1, max(3, arm // 2)):                          # short diagonals
        for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            c.put(mid - 1 + (d if sx > 0 else -d + 1), mid - 1 + (d if sy > 0 else -d + 1), "bronze_04")
    for dx in range(-1, 1):
        for dy in range(-1, 1):
            c.put(mid + dx, mid + dy, "thunder_03")
    c.put(mid - 1, mid - 1, "thunder_04")
    c.put(mid + arm - 1, mid - 1, "bronze_07")
    c.put(mid - 1, mid - arm, "bronze_07")


def immune(c):
    """A dashed violet ring round a pale diamond: the body is not there to be hit."""
    n = c.n
    mid = n // 2
    r = mid - 2
    import math
    steps = 16 if n > 16 else 12
    for k in range(steps):
        if k % 2:
            continue
        a0 = 2 * math.pi * k / steps
        for s in range(3 if n > 16 else 2):
            a = a0 + s * (math.pi / steps) * 0.7
            x, y = mid - 0.5 + r * math.cos(a), mid - 0.5 + r * math.sin(a)
            c.put(round(x), round(y), "soul_05" if math.cos(a) + math.sin(a) < 0.3 else "soul_04")
    d = max(2, mid // 2)
    for dy in range(-d, d):
        w = d - abs(dy + 0.5)
        for dx in range(-int(w) - 1, int(w) + 1):
            if abs(dx + 0.5) + abs(dy + 0.5) <= d:
                c.put(mid + dx, mid + dy, "soul_07" if dx + dy < 0 else "soul_06")
    c.put(mid - 1, mid - 1, "thunder_04")


DRAW = {"icon_status_guard": guard, "icon_status_counter": counter, "icon_status_immune": immune}


def render():
    return {(i, n): (lambda cv: (DRAW[i](cv), cv.image())[1])(Canvas(n)) for i in IDS for n in (24, 16)}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "assets/raw/environment_items/ui")
    args = ap.parse_args()
    for (i, n), image in render().items():
        (args.out / i).mkdir(parents=True, exist_ok=True)
        image.save(args.out / i / f"{i}_{n}x{n}.png")
    script = hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    for i, brief in IDS.items():
        folder = args.out / i
        lines = "".join(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(folder).as_posix()}\n"
                        for f in sorted(folder.rglob("*")) if f.is_file() and f.name != "provenance.json")
        record = {"id": i, "producer": "Claude Code (Anthropic), PX-1 worker session tien-nghich-2d-88, 2026-11-24",
                  "method": "Original deterministic native-grid drawing (integer primitives, master palette only); no image model, no PixelLab, no input images.",
                  "brief": brief, "rights": "Original artwork created for this project.", "seed": "none: no random generator is used",
                  "generator": "tools/generators/gen_px1_status_icons.py", "generator_sha256_lf": script,
                  "palette": "tools/generators/palette.json", "native_px": [24, 24], "variant_px": [16, 16],
                  "source_sha256": hashlib.sha256(lines.encode()).hexdigest()}
        record_dir = args.out.parent / "icons" / i   # where the manifest's output_path (and the ledger) look for a record
        record_dir.mkdir(parents=True, exist_ok=True)
        (record_dir / "provenance.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(IDS)} icons x 2 sizes to {args.out}")


if __name__ == "__main__":
    main()
