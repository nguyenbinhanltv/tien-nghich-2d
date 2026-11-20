#!/usr/bin/env python3
"""Validate PNG sprites against the 40-color Xianxia palette and the 1px #14101a outline rule.

Checks per file:
  1. every opaque pixel is a palette color (exact RGB match)
  2. alpha is binary (0 or 255) - no soft / anti-aliased edges
  3. every silhouette-edge pixel (opaque and 4-adjacent to a transparent pixel) is the outline
     color. The image border counts as an edge only with --border-is-edge.
  4. (with --class) canvas size matches the size class in palette.json (tile 16x16, character 32x32,
     weapon 24x24|32x32, boss square 64..96, icon 16x16|24x24)
  5. (warning) outline looks thicker than 1px (many edge pixels backed only by outline pixels)

Pillow is optional; without it a built-in stdlib PNG decoder (8-bit, non-interlaced) is used.

Usage: python -I validate_palette.py [--palette P] [--class C] [--outline-optional] [--border-is-edge] FILE_OR_DIR...
Exit 0 = all pass, 1 = failures, 2 = usage / IO error.
"""
import argparse
import json
import struct
import sys
import zlib
from pathlib import Path

DEFAULT_PALETTE = Path(__file__).resolve().parent.parent / "generators" / "palette.json"


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def load_palette(p):
    d = json.loads(Path(p).read_text(encoding="utf-8"))
    return {_rgb(c["hex"].lower()) for c in d["colors"]}, _rgb(d["outline"].lower())


def check_size(w, h, spec):
    if "sizes" in spec:
        ok = [w, h] in spec["sizes"]
        want = " or ".join(f"{a}x{b}" for a, b in spec["sizes"])
    else:
        lo, hi = spec["min"], spec["max"]
        ok = lo[0] <= w <= hi[0] and lo[1] <= h <= hi[1] and (w == h or not spec.get("square"))
        want = f"{lo[0]}x{lo[1]}..{hi[0]}x{hi[1]}" + (" square" if spec.get("square") else "")
    return None if ok else f"canvas {w}x{h} does not match size class ({want})"


def decode_png(path):
    """Return (w, h, rows) where rows is a list of lists of (r, g, b, a)."""
    try:
        from PIL import Image
    except ImportError:
        Image = None
    if Image is not None:
        im = Image.open(path).convert("RGBA")
        w, h = im.size
        px = list(im.getdata())
        return w, h, [px[y * w:(y + 1) * w] for y in range(h)]

    b = Path(path).read_bytes()
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, plte, trns = 8, b"", None, None
    w = h = depth = ct = il = 0
    while pos < len(b):
        n, t = struct.unpack(">I4s", b[pos:pos + 8])
        d = b[pos + 8:pos + 8 + n]
        pos += 12 + n
        if t == b"IHDR":
            w, h, depth, ct, _, _, il = struct.unpack(">IIBBBBB", d)
        elif t == b"PLTE":
            plte = d
        elif t == b"tRNS":
            trns = d
        elif t == b"IDAT":
            idat += d
    if depth != 8 or il != 0 or ct not in (0, 2, 3, 4, 6):
        raise ValueError("stdlib decoder supports 8-bit non-interlaced only; install Pillow")
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    bpp, stride = ch, w * ch
    raw = zlib.decompress(idat)
    out, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        cur = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = cur[x - bpp] if x >= bpp else 0
            up = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                cur[x] = (cur[x] + a) & 255
            elif f == 2:
                cur[x] = (cur[x] + up) & 255
            elif f == 3:
                cur[x] = (cur[x] + (a + up) // 2) & 255
            elif f == 4:
                p = a + up - c
                pa, pb, pc = abs(p - a), abs(p - up), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (up if pb <= pc else c)
                cur[x] = (cur[x] + pr) & 255
        out.append(cur)
        prev = cur
    rows = []
    for r in out:
        row = []
        for x in range(w):
            if ct == 6:
                row.append(tuple(r[x * 4:x * 4 + 4]))
            elif ct == 2:
                row.append((*r[x * 3:x * 3 + 3], 255))
            elif ct == 0:
                row.append((r[x], r[x], r[x], 255))
            elif ct == 4:
                row.append((r[x * 2], r[x * 2], r[x * 2], r[x * 2 + 1]))
            else:
                k = r[x]
                row.append((*plte[k * 3:k * 3 + 3], trns[k] if trns and k < len(trns) else 255))
        rows.append(row)
    return w, h, rows


def validate(path, palette, outline, need_outline=True, border_is_edge=False, size_spec=None):
    errs, warns = [], []
    w, h, rows = decode_png(path)
    if size_spec:
        m = check_size(w, h, size_spec)
        if m:
            errs.append(m)

    def inside(x, y):
        return 0 <= x < w and 0 <= y < h

    def opaque(x, y):
        return inside(x, y) and rows[y][x][3] == 255

    def transp(x, y):
        return (inside(x, y) and rows[y][x][3] == 0) or (border_is_edge and not inside(x, y))

    bad_col, soft, bad_edge, edge_n, thick = {}, 0, [], 0, 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = rows[y][x]
            if a == 0:
                continue
            if a != 255:
                soft += 1
                continue
            if (r, g, b) not in palette:
                bad_col[(r, g, b)] = bad_col.get((r, g, b), 0) + 1
            nb = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
            if any(transp(*n) for n in nb):
                edge_n += 1
                if (r, g, b) != outline:
                    bad_edge.append((x, y))
                else:
                    inward = [n for n in nb if opaque(*n)]
                    if inward and all(rows[n[1]][n[0]][:3] == outline for n in inward):
                        thick += 1
    if edge_n == 0:
        errs.append("no opaque pixels / no silhouette edge found")
    if soft:
        errs.append(f"{soft} semi-transparent pixel(s); alpha must be 0 or 255")
    for c, n in sorted(bad_col.items(), key=lambda kv: -kv[1])[:5]:
        errs.append(f"{n} px off-palette color #{c[0]:02x}{c[1]:02x}{c[2]:02x}")
    if len(bad_col) > 5:
        errs.append(f"... {len(bad_col)} distinct off-palette colors total")
    if need_outline and bad_edge:
        o = "#%02x%02x%02x" % outline
        errs.append(f"{len(bad_edge)}/{edge_n} edge pixel(s) are not outline {o}, e.g. {bad_edge[:3]}")
    if edge_n and thick * 4 > edge_n:
        warns.append(f"outline may be thicker than 1px ({thick}/{edge_n} edge px backed by outline)")
    return errs, warns


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--palette", default=str(DEFAULT_PALETTE))
    ap.add_argument("--class", dest="cls", help="size class from palette.json (tile, character, weapon, boss, icon)")
    ap.add_argument("--outline-optional", action="store_true", help="skip outline check (tiles, flat UI)")
    ap.add_argument("--border-is-edge", action="store_true", help="treat image border as transparent")
    a = ap.parse_args()
    try:
        palette, outline = load_palette(a.palette)
    except Exception as e:  # noqa: BLE001
        print("palette error:", e, file=sys.stderr)
        return 2
    spec = None
    if a.cls:
        classes = json.loads(Path(a.palette).read_text(encoding="utf-8")).get("size_classes", {})
        if a.cls not in classes:
            print(f"unknown size class {a.cls!r}; known: {', '.join(classes)}", file=sys.stderr)
            return 2
        spec = classes[a.cls]
    files = []
    for p in map(Path, a.paths):
        files += sorted(p.rglob("*.png")) if p.is_dir() else [p]
    if not files:
        print("no PNG files found", file=sys.stderr)
        return 2
    fail = 0
    for f in files:
        try:
            errs, warns = validate(f, palette, outline, not a.outline_optional, a.border_is_edge, spec)
        except Exception as e:  # noqa: BLE001
            errs, warns = [f"cannot read: {e}"], []
        print(("FAIL " if errs else "PASS ") + str(f))
        for m in errs:
            print("   error:", m)
        for m in warns:
            print("   warn: ", m)
        fail += bool(errs)
    print(f"{len(files) - fail}/{len(files)} passed")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
