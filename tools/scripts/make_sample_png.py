"""Stdlib-only PNG writer + tiny sample sprites for smoke-testing validate_palette.py.

Usage: python -I make_sample_png.py <out_dir>   -> good.png, bad_color.png, bad_outline.png
"""
import struct
import sys
import zlib
from pathlib import Path


def write_png(path, w, h, px):
    """px: list of rows of (r, g, b, a) tuples."""
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in px)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    Path(path).write_bytes(data)


def blob(fill, outline=(0x14, 0x10, 0x1A, 255), w=12, h=12, outlined=True):
    t = (0, 0, 0, 0)
    rows = [[t] * w for _ in range(h)]
    for y in range(2, h - 2):
        for x in range(2, w - 2):
            edge = x in (2, w - 3) or y in (2, h - 3)
            rows[y][x] = outline if (edge and outlined) else fill
    return rows


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    jade = (0x2F, 0xA2, 0x7A, 255)
    write_png(out / "good.png", 12, 12, blob(jade))
    write_png(out / "bad_color.png", 12, 12, blob((0x12, 0x34, 0x56, 255)))
    write_png(out / "bad_outline.png", 12, 12, blob(jade, outlined=False))
    print("wrote samples to", out)
