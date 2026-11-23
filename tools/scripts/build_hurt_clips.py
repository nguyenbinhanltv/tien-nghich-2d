#!/usr/bin/env python
"""Derive a 3-frame `hurt` clip for the Hang Nhac and Co Than Chi Dia mobs and bosses from their existing idle frame.

Run isolated:  python -I tools/scripts/build_hurt_clips.py [--check]   (numpy + Pillow only)

Route: direct pixel edit of approved frames, no redraw. For every facing (south, east) the source is
idle_<facing>_0. The three keys are
  hurt_0  hit flash (every body colour +3 steps up its own palette ramp (clamped at the ramp's top), outline kept) + recoil 2 units
  hurt_1  half flash (+1 step) + recoil 1 unit
  hurt_2  original colours, original position (settle)
A recoil unit is canvas/32 px: 1 (mobs), 2 (64x64 boss), 3 (96x96 boss). East recoils toward -x (west is the
runtime mirror, so it recoils toward +x there), south recoils toward -y. The shift is reduced when it
would push an opaque pixel off the canvas. Output colours are palette colours only; alpha stays binary;
the outline colour is never changed. Deterministic: the same inputs give byte-identical PNGs.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
ASSETS = {
    "mobs": ["mob_rogue_disciple", "mob_courtyard_guard", "mob_sword_acolyte", "mob_herb_viper",
             "mob_demonic_talisman",
             "mob_stone_puppet", "mob_stone_archer_puppet", "mob_chain_warden", "mob_void_eater",
             "mob_rune_sentinel"],
    "bosses": ["boss_teng_huayuan", "boss_ancient_god_remnant"],
}
RED_THUNDER = {"thunder_05", "thunder_06"}
FACINGS = ("south", "east")
RECOIL = {"south": (0, -1), "east": (-1, 0)}
KEYS = ((3, 2), (1, 1), (0, 0))  # (ramp steps up, recoil units) per frame


def palette():
    data = json.loads((REPO / "tools/generators/palette.json").read_bytes())
    ramps = {}
    for color in data["colors"]:
        # heavenly-thunder-cyan-red is two ramps in one group: cyan (thunder_01-04) and red (thunder_05-06)
        ramp = color["group"] + ("/red" if color["id"] in RED_THUNDER else "")
        ramps.setdefault(ramp, []).append(color["hex"].lower())
    lookup = {}
    for group, hexes in ramps.items():
        for position, value in enumerate(hexes):
            lookup[value] = (group, position)
    return data["outline"].lower(), ramps, lookup


def rgb_hex(pixel):
    return "#%02x%02x%02x" % tuple(int(v) for v in pixel[:3])


def brighten(image, steps, outline, ramps, lookup):
    out = image.copy()
    if steps == 0:
        return out
    height, width = image.shape[:2]
    for y in range(height):
        for x in range(width):
            if image[y, x, 3] == 0:
                continue
            value = rgb_hex(image[y, x])
            if value == outline:
                continue
            group, position = lookup[value]
            ramp = ramps[group]
            new = ramp[min(position + steps, len(ramp) - 1)]
            out[y, x, :3] = [int(new[i:i + 2], 16) for i in (1, 3, 5)]
    return out


def shift(image, dx, dy):
    """Move opaque pixels by (dx, dy); reduce the move until nothing leaves the canvas."""
    height, width = image.shape[:2]
    ys, xs = np.nonzero(image[:, :, 3])
    while (dx, dy) != (0, 0):
        if (xs + dx).min() >= 0 and (xs + dx).max() < width and (ys + dy).min() >= 0 and (ys + dy).max() < height:
            break
        dx -= (dx > 0) - (dx < 0)
        dy -= (dy > 0) - (dy < 0)
    out = np.zeros_like(image)
    out[ys + dy, xs + dx] = image[ys, xs]
    return out


def build(root):
    outline, ramps, lookup = palette()
    produced = {}
    for group, ids in ASSETS.items():
        for asset in ids:
            folder = root / "assets/processed" / group / asset
            for facing in FACINGS:
                source = np.array(Image.open(folder / f"idle_{facing}_0.png").convert("RGBA"))
                unit = source.shape[0] // 32  # 1 px at 32, 2 px at 64, 3 px at 96
                for n, (steps, recoil) in enumerate(KEYS):
                    frame = brighten(source, steps, outline, ramps, lookup)
                    dx, dy = RECOIL[facing]
                    frame = shift(frame, dx * recoil * unit, dy * recoil * unit)
                    frame[frame[:, :, 3] == 0] = 0
                    produced[folder / f"hurt_{facing}_{n}.png"] = frame
    return produced


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the committed frames differ")
    args = parser.parse_args()
    produced = build(REPO)
    for path, frame in produced.items():
        if args.check:
            if not path.exists() or not np.array_equal(np.array(Image.open(path).convert("RGBA")), frame):
                print(f"hurt frame differs: {path.relative_to(REPO)}", file=sys.stderr)
                return 1
        else:
            Image.fromarray(frame, "RGBA").save(path, optimize=False)
    print(f"{'Verified' if args.check else 'Wrote'} {len(produced)} hurt frames")
    return 0


if __name__ == "__main__":
    sys.exit(main())
