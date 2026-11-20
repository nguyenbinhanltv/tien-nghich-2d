#!/usr/bin/env python
"""Deterministically build QA fixtures (intentionally defective) into assets/_fixtures/.

Run:  python -I tools/scripts/make_qa_fixtures.py [out_dir]
Fixtures live OUTSIDE assets/processed on purpose. Layout: <out>/manifest.json, <out>/raw/<group>/<id>/<file>.png
EXPECTED lists the defects each file must trigger (used by tools/tests/test_qa_assets.py).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

INK = (0x14, 0x10, 0x1A)
JADE, JADE_D, SKIN = (0x2F, 0xA2, 0x7A), (0x17, 0x59, 0x4B), (0xF9, 0xC4, 0xC0)

# file (relative to raw/) -> set of error codes that qa_assets must report for it
EXPECTED = {
    "mobs/fx_mob/idle_south_0.png": set(),
    "mobs/fx_mob/idle_south_1.png": {"partial_alpha", "outline_gap"},
    "mobs/fx_mob/idle_east_0.png": {"dirty_transparent"},
    "mobs/fx_mob/idle_east_1.png": {"off_palette"},
    "mobs/fx_mob/move_south_0.png": {"outline_gap"},
    "mobs/fx_mob/move_south_1.png": {"size"},
    "mobs/fx_mob/move_east_0.png": set(),
    "mobs/fx_mob/idle-south-3.png": {"bad_name"},
    "mobs/fx_mob/idle_south_2.png": set(),   # exact duplicate of idle_south_0 -> warn duplicate_frame
    "mobs/fx_mob/idle_east_2.png": set(),
    "mobs/fx_mob/idle_south_9.png": {"orphan_frame"},
    "mobs/fx_mob/idle_west_0.png": {"orphan_frame"},
    "mobs/ghost_mob/idle_south_0.png": {"orphan_asset"},
    "icons/fx_icon/static_none_0.png": {"empty_frame"},
    "icons/fx_icon/v16_none_0.png": set(),
    "tilesets/fx_tiles/floor_f0_0.png": {"corrupt_png"},
    "tilesets/fx_tiles/floor_f0_1.png": set(),
}
# asset-level expectations: missing frame (move_east_1 never written), duplicate frame warn
EXPECTED_ASSET_LEVEL = {"missing_frames": "mobs/fx_mob", "duplicate_frame": "mobs/fx_mob/idle_south_2.png"}


def blob(w=32, h=32, outline=True, fill=JADE, shade=JADE_D, pad=6):
    a = np.zeros((h, w, 4), np.uint8)
    cy, cx = h / 2, w / 2
    ry, rx = h / 2 - pad + 2, w / 2 - pad + 2
    yy, xx = np.mgrid[0:h, 0:w]
    inner = ((yy + .5 - cy) / ry) ** 2 + ((xx + .5 - cx) / rx) ** 2 <= 1
    a[inner] = (*fill, 255)
    a[inner & (yy > cy)] = (*shade, 255)
    a[(yy == int(cy) - 3) & (abs(xx - cx) < 3) & inner] = (*SKIN, 255)
    if outline:  # 1px 4-connected ring around the silhouette
        op = a[..., 3] == 255
        ring = np.zeros_like(op)
        ring[1:, :] |= op[:-1, :]; ring[:-1, :] |= op[1:, :]; ring[:, 1:] |= op[:, :-1]; ring[:, :-1] |= op[:, 1:]
        ring &= ~op
        a[ring] = (*INK, 255)
    return a


def save(path: Path, arr):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGBA").save(path)


def build(out: Path):
    raw = out / "raw"
    manifest = {
        "schema": "tien-nghich-2d.asset-manifest", "version": "fixture",
        "assets": [
            {"id": "fx_mob", "category": "mob", "size": [32, 32], "directions": ["south", "east"],
             "animations": {"idle": {"frames": 3}, "move": {"frames": 2}},
             "frames_per_direction": 5, "total_frames": 10, "output_path": "assets/raw/characters/mobs/fx_mob/"},
            {"id": "fx_icon", "category": "icon", "size": [24, 24], "variant_sizes": [[24, 24], [16, 16]],
             "output_path": "assets/raw/environment_items/icons/fx_icon/"},
            {"id": "fx_tiles", "category": "tileset", "size": [16, 16], "tile_size": 16,
             "sheets": [{"id": "floor", "tiles": 2, "anim_frames": 1}],
             "output_path": "assets/raw/environment_items/tilesets/fx_tiles/"},
        ]}
    out.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf8")
    good = blob()
    m = raw / "mobs/fx_mob"
    save(m / "idle_south_0.png", good)
    # idle_south_1: identical-looking body but anti-aliased (partial alpha) edge ring AND a duplicate of frame 0 otherwise
    pa = good.copy()
    ring = (pa[..., :3] == INK).all(-1) & (pa[..., 3] == 255)
    pa[ring, 3] = 140
    save(m / "idle_south_1.png", pa)
    # idle_east_0: transparent pixels carry hidden colour
    de = blob(fill=(0x5C, 0xC7, 0x96)); de[0:3, 0:3] = (255, 0, 255, 0)
    save(m / "idle_east_0.png", de)
    # idle_east_1: off-palette body colours (close to jade + a far orange)
    op = blob(fill=(0x30, 0xA0, 0x7C)); op[14:17, 14:17] = (255, 128, 0, 255)
    save(m / "idle_east_1.png", op)
    # move_south_0: two outline pixels replaced by body colour -> gap
    og = blob(); ys, xs = np.where((og[..., :3] == INK).all(-1))
    for i in (0, len(ys) // 2):
        og[ys[i], xs[i], :3] = JADE
    save(m / "move_south_0.png", og)
    save(m / "move_south_1.png", blob(30, 32))
    save(m / "move_east_0.png", blob(fill=(0x8A, 0xE8, 0xFF)))
    save(m / "idle-south-3.png", good)
    save(m / "idle_south_2.png", good)
    save(m / "idle_east_2.png", blob(fill=(0x9A, 0xE3, 0xB8)))
    save(m / "idle_south_9.png", good)
    save(m / "idle_west_0.png", good)
    save(raw / "mobs/ghost_mob/idle_south_0.png", good)
    save(raw / "icons/fx_icon/static_none_0.png", np.zeros((24, 24, 4), np.uint8))
    save(raw / "icons/fx_icon/v16_none_0.png", blob(16, 16, pad=3))
    p = raw / "tilesets/fx_tiles"
    p.mkdir(parents=True, exist_ok=True)
    (p / "floor_f0_0.png").write_bytes(b"\x89PNG\r\n\x1a\nnot really a png")
    t = np.full((16, 16, 4), 255, np.uint8); t[..., :3] = (0x49, 0x43, 0x4F)
    save(p / "floor_f0_1.png", t)


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "assets/_fixtures")
