#!/usr/bin/env python3
"""Derive the `hurt` clip (3 frames) for the vertical-slice characters from their own idle frame 0.

Route: direct pixel edit by script (studio forge "direct pixel edits" route), no image generation of any kind.
Input : assets/processed/<players|mobs|bosses>/<id>/idle_<dir>_0.png   (already palette-locked, outlined)
Output: assets/processed/<kind>/<id>/hurt_<dir>_<n>.png                (n = 0..2, same canvas, same pivot)
No raw copy: assets/raw/characters holds the original PixelLab sources (their tree hashes are pinned in the provenance
supplement), and these frames are derived from processed idle frames, so they live in processed only.
Frame 0 impact : body shoved back + flat white flash (thunder_04) on every non-outline pixel
Frame 1 peak   : lean at its maximum, true colours
Frame 2 settle : half lean, true colours
Lean is a row shear that keeps the feet fixed (offset grows with height above the bottom row), so the pivot and the
silhouette base do not drift. Side views lean backwards along x; front/back views hunch (upper rows drop 1 px) and
lean sideways. Nothing is blended, so alpha stays binary and colours stay on the 43-colour palette.

    python tools/scripts/build_hurt_clips.py            # write
    python tools/scripts/build_hurt_clips.py --check    # fail if the files on disk differ from a fresh build
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "assets/processed"
PALETTE = {c["id"]: tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in
           json.loads((ROOT / "tools/generators/palette.json").read_text(encoding="utf-8"))["colors"]}
INK = PALETTE["ink_01"]
FLASH = PALETTE["thunder_04"]
FRAMES = 3

sys.path.insert(0, str(Path(__file__).resolve().parent))
from px1_hurt import BOSSES, MOBS, PLAYERS  # noqa: E402
TARGETS = ([("players", i, ["south", "east", "north", "west"]) for i in PLAYERS] +
           [("mobs", i, ["south", "east"]) for i in MOBS] +
           [("bosses", i, ["south", "east"]) for i in BOSSES])


def plan(direction, scale):
    """Per frame: (back_x, hunch_y, lean_x, flash). `back` is the whole-body shove, lean is the top-row shear."""
    away = {"east": -1, "west": 1}.get(direction, 0)
    if away:   # side view: shoved and tilted backwards
        keys = [(2, 0, 4, True), (2, 0, 5, False), (1, 0, 2, False)]
        return [(away * a * scale, 0, away * c * scale, f) for a, _, c, f in keys]
    sway = 1 if direction == "south" else -1  # front/back: hunch down and sway to one side
    keys = [(0, 1, 3, True), (0, 2, 4, False), (0, 1, 2, False)]
    return [(0, b * scale, sway * c * scale, f) for _, b, c, f in keys]


def build(source, direction, scale):
    """Largest shove that keeps every opaque pixel on the canvas (sprites near an edge get a smaller motion)."""
    for shrink in (1.0, 0.75, 0.5, 0.25):
        try:
            return shove(source, direction, scale, shrink)
        except ValueError:
            continue
    raise ValueError(f"no hurt motion fits the canvas for {direction}")


def shove(source, direction, scale, shrink):
    w, h = source.size
    px = source.load()
    box = source.getbbox()
    top, bottom = box[1], box[3] - 1
    span = max(1, bottom - top)
    frames = []
    for back, hunch, lean, flash in plan(direction, scale):
        back, hunch, lean = (int(round(v * shrink)) for v in (back, hunch, lean))
        out = Image.new("RGBA", source.size, (0, 0, 0, 0))
        op = out.load()
        for y in range(top, bottom + 1):
            height = (bottom - y) / span                         # 0 at the feet, 1 at the top
            dx = back + int(round(lean * height))
            dy = hunch if height > 0.55 else 0
            for x in range(w):
                r, g, b, a = px[x, y]
                if a < 128:
                    continue
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h):
                    raise ValueError("hurt frame would clip the canvas")
                colour = FLASH if flash and (r, g, b) != INK else (r, g, b)
                op[nx, ny] = (*colour, 255)
        reoutline(out)
        frames.append(out)
    return frames


def reoutline(image):
    """The shear tears the 1 px outline where rows slip; repaint every exposed edge pixel (4-neighbour) with ink_01."""
    w, h = image.size
    px = image.load()
    edge = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] == 255 and px[x, y][:3] != INK and any(
        not (0 <= x + dx < w and 0 <= y + dy < h) or px[x + dx, y + dy][3] == 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for x, y in edge:
        px[x, y] = (*INK, 255)


def render():
    result = {}
    for group, ident, directions in TARGETS:
        folder = PROCESSED / group / ident
        for direction in directions:
            source = Image.open(folder / f"idle_{direction}_0.png").convert("RGBA")
            scale = source.size[0] // 32  # canvas / 32: 1 (mob), 2 (boss 64), 3 (boss 96)
            for n, image in enumerate(build(source, direction, scale)):
                result[folder / f"hurt_{direction}_{n}.png"] = image
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    images = render()
    if args.check:
        for path, image in images.items():
            if not path.is_file() or Image.open(path).convert("RGBA").tobytes() != image.tobytes():
                sys.exit(f"hurt frame differs from build: {path.relative_to(ROOT)}")
        print(f"{len(images)} hurt frames match")
        return
    for path, image in images.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
    print(f"wrote {len(images)} hurt frames")


if __name__ == "__main__":
    main()
