#!/usr/bin/env python3
"""Ingest and process PixelLab Longtime characters (profiles npc / pet / ...).

Run isolated with the project venv:  python -I tools/scripts/build_longtime_characters.py <cmd> ...

  ingest <id> --zip FILE   unpack a PixelLab character ZIP (public MCP download) into
                           assets/raw/longtime/<id>/  (rotations/, <clip>/<dir>/frame_NNN.png,
                           metadata.json). Raw files are written once and never edited.
  build  <id>              raw -> assets/processed_longtime/<id>/<clip>_<dir>_<n>.png, plus in the raw
                           folder: source.png (untouched raw frames on one sheet), contact_1x.png,
                           contact_4x.png and provenance.json (merged with generation.json).

Processing per frame (deterministic, idempotent)
  1. every raw canvas (32 / 40 / 44 px) is centred on the manifest canvas with no scaling and no vertical
     shift, so the PixelLab pivot lands on the manifest pivot; opaque pixels cropped away are counted
     and reported (the build fails when any are lost)
  2. PixelLab outline #020105 -> #14101a; alpha -> 0/255; RGB under alpha 0 -> 0
  3. snap to the 40 palette colours with ink_01 reserved for the 1px outline (build_processed.snap_character,
     Lab distance); speckle removal is OFF so 1-2 px identity marks (ear notch) survive
Clips, directions, frame counts, canvas, pivot and timings come from assets/manifest_longtime.json.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import shutil
import sys
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


bp = _load("build_processed")
qa = bp.qa
MANIFEST = REPO / "assets/manifest_longtime.json"
PALETTE = REPO / "tools/generators/palette.json"
RAW = REPO / "assets/raw/longtime"
OUT = REPO / "assets/processed_longtime"
INK = np.array(qa.hex_to_rgb("#14101a"), np.uint8)


def sha(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def spec_for(aid):
    m = json.loads(MANIFEST.read_text(encoding="utf8"))
    a = next(x for x in m["assets"] if x["id"] == aid)
    return a, m["profiles"][a["profile"]]


def ingest(aid, zpath):
    dst = RAW / aid
    if dst.exists() and any(dst.iterdir()):
        raise SystemExit(f"{dst} already exists; raw is write-once (delete it deliberately to re-ingest)")
    z = zipfile.ZipFile(zpath)
    names = [n for n in z.namelist() if not n.endswith("/")]
    states = {n.split("/")[0] for n in names if n != "metadata.json"}
    if len(states) != 1:
        raise SystemExit(f"expected one character state in the ZIP, found {sorted(states)}")
    state = states.pop()
    dst.mkdir(parents=True, exist_ok=True)
    for n in names:
        if n == "metadata.json":
            rel = "metadata.json"
        else:
            rel = n[len(state) + 1:]
            if rel.startswith("animations/"):
                rel = rel[len("animations/"):]
        if ".." in rel.split("/"):
            raise SystemExit("unsafe path in ZIP: " + n)
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        (dst / rel).write_bytes(z.read(n))
    print("ingested", len(names), "files into", dst)


def read_raw(aid, prof, raw_root=RAW):
    frames, raw_paths = {}, {}
    for clip, (count, _ms) in prof["clips"].items():
        for d in prof["directions"]:
            for n in range(count):
                p = raw_root / aid / clip / d / f"frame_{n:03d}.png"
                if not p.is_file():
                    raise SystemExit(f"missing raw frame {p}")
                arr = np.array(Image.open(p).convert("RGBA"))
                frames[(clip, d, n)] = arr
                raw_paths[(clip, d, n)] = p
            extra = sorted((raw_root / aid / clip / d).glob("frame_*.png"))
            if len(extra) != count:
                raise SystemExit(f"{aid}/{clip}/{d}: {len(extra)} raw frames, manifest wants {count}")
    return frames, raw_paths


def centre(arr, size):
    tw, th = size
    h, w = arr.shape[:2]
    ox, oy = (tw - w) // 2, (th - h) // 2
    out = np.zeros((th, tw, 4), np.uint8)
    lost = 0
    for y in range(h):
        for x in range(w):
            if arr[y, x, 3] < 128:
                continue
            ty, tx = y + oy, x + ox
            if 0 <= ty < th and 0 <= tx < tw:
                out[ty, tx] = arr[y, x]
            else:
                lost += 1
    return out, lost


def mark(img, xy, rgb=(255, 0, 255)):
    img.putpixel(xy, rgb + (255,))


def contact(frames, prof, scale, path, bg=(110, 104, 119)):
    w, h = prof["native_px"]
    clips = list(prof["clips"].items())
    rows = [(c, d) for c, _ in clips for d in prof["directions"]]
    cols = max(n for _, (n, _ms) in clips)
    gap = 1 if scale == 1 else 4
    sheet = Image.new("RGBA", (cols * (w * scale + gap) + gap, len(rows) * (h * scale + gap) + gap), bg + (255,))
    for r, (c, d) in enumerate(rows):
        for n in range(prof["clips"][c][0]):
            im = Image.fromarray(frames[(c, d, n)], "RGBA").resize((w * scale, h * scale), Image.NEAREST)
            sheet.alpha_composite(im, (gap + n * (w * scale + gap), gap + r * (h * scale + gap)))
    sheet.save(path)
    return rows


def build(aid, raw_root=RAW, out_root=OUT):
    """Raw under raw_root/<aid> -> processed under out_root/<aid>. Recorded paths stay repo-relative."""
    a, prof = spec_for(aid)
    size = tuple(prof["native_px"])
    palette, outline = qa.load_palette(PALETTE)
    raw, raw_paths = read_raw(aid, prof, raw_root)
    stats = Counter()
    gen_path = raw_root / aid / "generation.json"
    allowance = (json.loads(gen_path.read_text(encoding="utf8")).get("crop_allowance", {}) if gen_path.is_file() else {})
    processed, lost_total, cropped = {}, 0, {}
    for k, arr in raw.items():
        arr = arr.copy()
        o = (arr[..., 3] >= 128) & (arr[..., :3] == np.array(bp.PIXELLAB_OUTLINE, np.uint8)).all(-1)
        arr[o, :3] = INK
        placed, lost = centre(arr, size)
        key = f"{k[0]}/{k[1]}/{k[2]}"
        if lost and lost <= allowance.get(key, 0):
            cropped[key] = lost  # explicitly accepted in generation.json (crop_allowance), reported in provenance
        else:
            lost_total += lost
        processed[k] = bp.snap_character(placed, palette, outline, stats, speckle=False)
    if lost_total:
        raise SystemExit(f"{aid}: {lost_total} opaque pixels fall outside {size}; adjust before building")
    folder = out_root / aid
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    for (c, d, n), arr in sorted(processed.items()):
        bp.write(arr, folder / f"{c}_{d}_{n}.png")

    # raw source sheet: untouched raw frames, one row per clip/direction (cell = largest raw canvas)
    cell = max(max(f.shape[:2]) for f in raw.values())
    rows = [(c, d) for c in prof["clips"] for d in prof["directions"]]
    cols = max(n for n, _ in prof["clips"].values())
    src = Image.new("RGBA", (cols * cell, len(rows) * cell), (0, 0, 0, 0))
    src_xy = {}
    for r, (c, d) in enumerate(rows):
        for n in range(prof["clips"][c][0]):
            src.paste(Image.fromarray(raw[(c, d, n)], "RGBA"), (n * cell, r * cell))
            src_xy[(c, d, n)] = [n * cell, r * cell]
    rd = raw_root / aid
    src.save(rd / "source.png")
    contact(processed, prof, 1, rd / "contact_1x.png")
    contact(processed, prof, 4, rd / "contact_4x.png")

    gen = json.loads((rd / "generation.json").read_text(encoding="utf8")) if (rd / "generation.json").is_file() else {}
    frames = []
    for (c, d, n) in sorted(processed):
        frames.append({
            "key": f"longtime/{aid}/{c}_{d}_{n}",
            "path": f"assets/processed_longtime/{aid}/{c}_{d}_{n}.png",
            "raw_path": f"assets/raw/longtime/{aid}/{c}/{d}/frame_{n:03d}.png",
            "raw_sha256": sha(raw_paths[(c, d, n)]),
            "source_xy": src_xy[(c, d, n)],
            "duration_ms": prof["clips"][c][1],
            "sha256": sha(folder / f"{c}_{d}_{n}.png"),
        })
    prov = {
        "id": aid,
        "producer": "Claude Code worker driving the PixelLab MCP",
        "rights": "Generated with the project's PixelLab subscription for this project; processed with tools/scripts/build_longtime_characters.py.",
        "brief": a["brief"],
        **gen,
        "native_px": prof["native_px"],
        "pivot_px": prof["pivot_px"],
        "processing": {
            "script": "tools/scripts/build_longtime_characters.py",
            "script_sha256": sha(Path(__file__)),
            "palette": "tools/generators/palette.json",
            "steps": ["centre native canvas on manifest canvas (no scaling, no vertical shift)",
                      "#020105 -> #14101a", "binary alpha", "snap to 40 colours with ink_01 reserved for outline",
                      "silhouette edge repaint with #14101a", "outline thinning of 2x2 blocks"],
            "pixels_changed": {k: int(v) for k, v in sorted(stats.items())},
            **({"cropped_opaque_pixels": cropped} if cropped else {}),
        },
        "source": "source.png",
        "source_sha256": sha(rd / "source.png"),
        "contact_sheets": {f"assets/raw/longtime/{aid}/{n}": sha(rd / n) for n in ("contact_1x.png", "contact_4x.png")},
        "frames": frames,
    }
    (rd / "provenance.json").write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"{aid}: {len(processed)} frames; fixes {dict(stats)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("ingest")
    i.add_argument("id")
    i.add_argument("--zip", required=True)
    b = sub.add_parser("build")
    b.add_argument("id")
    a = ap.parse_args()
    if a.cmd == "ingest":
        ingest(a.id, a.zip)
    else:
        build(a.id)


if __name__ == "__main__":
    main()
