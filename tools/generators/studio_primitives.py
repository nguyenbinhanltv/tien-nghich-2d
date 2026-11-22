"""Parametric primitive sprites on the project palette: the code-drawn route for icons, shots and small props.

Registered in studio.project.json (adapters.generators.primitives). The studio runs it in a scratch
directory with validated parameters and a seed; the same arguments always give the same bytes.

  --out DIR --palette FILE --shape diamond|disc|ring|cross|star|drop|shard --size N
  --fill ID --accent ID --clip NAME --direction DIR --frames N --seed N

Writes <clip>_<direction>_<n>.png per frame: binary alpha, project palette colours only, a 1px outline in
the palette's outline colour on every silhouette edge. More than one frame pulses the shape.
"""
import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image

SHAPES = ("diamond", "disc", "ring", "cross", "star", "drop", "shard")


def load_palette(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    colors = {c["id"]: tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in data["colors"]}
    outline = data.get("outline")
    return colors, tuple(int(outline[i:i + 2], 16) for i in (1, 3, 5))


def inside(shape, dx, dy, r):
    if shape == "diamond":
        return abs(dx) + abs(dy) <= r
    if shape == "disc":
        return dx * dx + dy * dy <= r * r
    if shape == "ring":
        d = dx * dx + dy * dy
        return (r * 0.55) ** 2 <= d <= r * r
    if shape == "cross":
        w = max(1.0, r * 0.3)
        return (abs(dx) <= w or abs(dy) <= w) and max(abs(dx), abs(dy)) <= r
    if shape == "star":
        return math.sqrt(abs(dx)) + math.sqrt(abs(dy)) <= math.sqrt(r) * 1.35
    if shape == "drop":
        if dy > 0:
            return dx * dx + dy * dy <= (r * 0.8) ** 2
        return abs(dx) <= (r * 0.8) * (1 + dy / r) and dy >= -r
    if shape == "shard":
        u = (dx + dy) * 0.7071
        v = (dx - dy) * 0.7071
        return abs(u) <= r and abs(v) <= r * 0.28
    raise ValueError(shape)


def draw(shape, size, fill, accent, outline, frame, frames, rng):
    t = frame / frames if frames > 1 else 0.0
    r = (size / 2 - 2.5) * (1.0 if frames == 1 else 0.82 + 0.18 * math.sin(2 * math.pi * t))
    c = (size - 1) / 2
    mask = [[inside(shape, x - c, y - c, r) for x in range(size)] for y in range(size)]
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            if mask[y][x]:
                light = (x - c) + (y - c) < -r * 0.2 and rng.random() < 0.55
                px[x, y] = (*(accent if light else fill), 255)
    for y in range(size):
        for x in range(size):
            if not mask[y][x]:
                continue
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if not (0 <= nx < size and 0 <= ny < size) or not mask[ny][nx]:
                    px[x, y] = (*outline, 255)
                    break
    return img


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--palette", type=Path, required=True)
    ap.add_argument("--shape", choices=SHAPES, required=True)
    ap.add_argument("--size", type=int, required=True)
    ap.add_argument("--fill", required=True)
    ap.add_argument("--accent", required=True)
    ap.add_argument("--clip", default="glyph")
    ap.add_argument("--direction", default="none")
    ap.add_argument("--frames", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    colors, outline = load_palette(args.palette)
    for name in (args.fill, args.accent):
        if name not in colors:
            raise SystemExit(f"colour {name} is not in the palette")
    if not 8 <= args.size <= 96 or not 1 <= args.frames <= 12:
        raise SystemExit("size must be 8..96 and frames 1..12")
    args.out.mkdir(parents=True, exist_ok=True)
    for frame in range(args.frames):
        rng = random.Random(args.seed * 1000 + frame)  # per-frame stream: frame n does not depend on the others
        img = draw(args.shape, args.size, colors[args.fill], colors[args.accent], outline, frame, args.frames, rng)
        img.save(args.out / f"{args.clip}_{args.direction}_{frame}.png", optimize=False)


if __name__ == "__main__":
    main()
