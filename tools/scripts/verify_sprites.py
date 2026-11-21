"""Verify PixelLab raw sprite frames (report only; never modifies files).

Usage (needs Pillow):  python -I tools/scripts/verify_sprites.py <dir|png> [--size 32 | --size 64,96]
                                                              [--palette tools/generators/palette.json] [--json out.json]

Per PNG frame reports:
  size / expected size match, RGBA mode, corner alpha == 0, semi-transparent pixel count,
  outline coverage (share of silhouette-edge pixels that are exactly the outline colour),
  % opaque pixels not exactly in the 40-colour palette, mean RGB distance of those pixels to the nearest palette colour.
Palette off-colours are only REPORTED; normalisation belongs to assets/processed.
"""
import argparse
import json
import os
import sys

from PIL import Image


def load_palette(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    cols = [tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in data["colors"]]
    outline = tuple(int(data["outline"][i:i + 2], 16) for i in (1, 3, 5))
    return cols, outline


def nearest_dist(px, cols):
    return min(((px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2) ** 0.5 for c in cols)


def analyse(path, cols, outline, expected):
    im = Image.open(path)
    res = {"file": path.replace("\\", "/"), "size": list(im.size), "mode": im.mode}
    res["size_ok"] = (expected is None) or (im.size in expected)
    res["has_alpha_channel"] = im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    res["corners_transparent"] = all(a == 0 for a in corners)
    opaque, semi, off, edge, edge_ok = 0, 0, 0, 0, 0
    pal = set(cols)
    dsum, dn = 0.0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if a < 255:
                semi += 1
            opaque += 1
            if (r, g, b) not in pal:
                off += 1
                dsum += nearest_dist((r, g, b), cols)
                dn += 1
            is_edge = any(
                not (0 <= nx < w and 0 <= ny < h) or px[nx, ny][3] == 0
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            )
            if is_edge:
                edge += 1
                if (r, g, b) == outline:
                    edge_ok += 1
    res["opaque_px"] = opaque
    res["semi_transparent_px"] = semi
    res["outline_coverage_pct"] = round(100.0 * edge_ok / edge, 1) if edge else None
    res["off_palette_pct"] = round(100.0 * off / opaque, 1) if opaque else 0.0
    res["off_palette_mean_dist"] = round(dsum / dn, 1) if dn else 0.0
    return res


def collect(target):
    if os.path.isfile(target):
        return [target]
    out = []
    for dp, _, fs in os.walk(target):
        out += [os.path.join(dp, f) for f in fs if f.lower().endswith(".png")]
    return sorted(out)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("target")
    ap.add_argument("--size", help="expected square size(s), e.g. 32 or 64,96")
    ap.add_argument("--palette", default=os.path.join(here, "..", "generators", "palette.json"))
    ap.add_argument("--json", dest="json_out")
    a = ap.parse_args()
    cols, outline = load_palette(a.palette)
    expected = {(int(s), int(s)) for s in a.size.split(",")} if a.size else None
    files = collect(a.target)
    results = [analyse(f, cols, outline, expected) for f in files]
    n = len(results)
    summ = {
        "files": n,
        "size_mismatch": sum(not r["size_ok"] for r in results),
        "no_alpha_channel": sum(not r["has_alpha_channel"] for r in results),
        "corner_not_transparent": sum(not r["corners_transparent"] for r in results),
        "with_semi_transparent_px": sum(r["semi_transparent_px"] > 0 for r in results),
        "mean_outline_coverage_pct": round(sum(r["outline_coverage_pct"] or 0 for r in results) / n, 1) if n else None,
        "mean_off_palette_pct": round(sum(r["off_palette_pct"] for r in results) / n, 1) if n else None,
    }
    print(json.dumps(summ, indent=1))
    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as f:
            json.dump({"summary": summ, "results": results}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
