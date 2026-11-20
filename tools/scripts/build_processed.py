#!/usr/bin/env python
"""Build assets/processed from raw sources (deterministic, idempotent).

Run isolated:  python -I tools/scripts/build_processed.py [options]   (numpy + Pillow only)

Pipeline per frame
  1. map the raw file to the key contract  <group>/<id>/<anim>_<dir>_<n>.png  (see qa_assets.py)
  2. characters only: PixelLab outline #020105 -> ink_01, common-bbox crop per character,
     feet-anchored paste into the manifest canvas (mode-filter downscale only when the common
     bbox does not fit; never interpolates colours)
  3. alpha -> 0/255, RGB under alpha 0 -> 0, snap every pixel to the 40 palette colours (ink_01 outline included) (Lab distance)
  4. repair silhouette edges with the #14101a outline (categories that need one)
  5. optional character colour-noise clean-up (rare colours merged into the nearest used colour)

Sources (all read-only):
  --env-src   assets/raw/environment_items   tilesets, weapons, projectiles, props, ui, icons
  --char-src  assets/raw/characters          <group>/<id>/<anim>/<dir>/frame_NNN.png
  --vfx-src   directory of <id>_<n>.png      (optional; written to processed/vfx/)
Only the ids found in a source are rebuilt: their old output directory is removed first, so a
re-run never leaves stale frames and gives byte-identical files.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]


def _load_qa():
    """qa_assets.py is a sibling script; `python -I` does not put its folder on sys.path."""
    spec = importlib.util.spec_from_file_location("qa_assets", Path(__file__).with_name("qa_assets.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["qa_assets"] = mod
    spec.loader.exec_module(mod)
    return mod


qa = _load_qa()
PIXELLAB_OUTLINE = (0x02, 0x01, 0x05)
CHAR_CATS = ("player", "mob", "boss")
GROUP = qa.GROUP_OF_CATEGORY
OUTLINE_CATS = qa.OUTLINE_CATEGORIES


# ----------------------------------------------------------------------------- helpers
def read(p: Path) -> np.ndarray:
    return np.array(Image.open(p).convert("RGBA"))


def write(arr: np.ndarray, p: Path):
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(arr), "RGBA").save(p, optimize=False)


def snap(arr, palette, outline, category, stats, speckle=False):
    """Alpha/palette/outline normalisation shared by every category."""
    fixed, st = qa.fix_array(arr, palette, outline, fix_outline=category in OUTLINE_CATS, fix_speckle=speckle)
    stats.update(st)
    return fixed


def mode_downscale(arr: np.ndarray, out_w: int, out_h: int, src_w: float, src_h: float, outline) -> np.ndarray:
    """Nearest-colour area downscale: every output pixel takes the most common opaque colour of
    its source footprint (outline wins ties). No colour is ever blended. src_* = source size."""
    h, w = arr.shape[:2]
    out = np.zeros((out_h, out_w, 4), np.uint8)
    ol = qa.pack(np.array(outline, np.uint8))
    for y in range(out_h):
        y0, y1 = int(np.floor(y * src_h / out_h)), max(int(np.ceil((y + 1) * src_h / out_h)), int(np.floor(y * src_h / out_h)) + 1)
        for x in range(out_w):
            x0, x1 = int(np.floor(x * src_w / out_w)), max(int(np.ceil((x + 1) * src_w / out_w)), int(np.floor(x * src_w / out_w)) + 1)
            blk = arr[y0:min(y1, h), x0:min(x1, w)].reshape(-1, 4)
            op = blk[blk[:, 3] >= 128]
            if len(op) * 2 < len(blk):
                continue
            cnt = Counter(map(tuple, op[:, :3].tolist()))
            best = max(cnt.items(), key=lambda kv: (kv[1] + (0.5 if qa.pack(np.array(kv[0], np.uint8)) == ol else 0), kv[0]))
            out[y, x, :3] = best[0]
            out[y, x, 3] = 255
    return out


def snap_character(arr, palette, outline, stats, speckle=False):
    """Like snap(), but ink_01 is reserved for the outline: off-palette interior darks snap to the
    nearest *non-ink* colour (ink_02 ...), so interior shading stays readable against the 1px outline.
    Only pixels that were already exactly #14101a (PixelLab #020105 remapped) or edge repairs get ink_01."""
    ink = np.array(outline, np.uint8)
    keep = ~(palette == ink).all(-1)
    is_ink = (arr[..., 3] >= 128) & (arr[..., :3] == ink).all(-1)
    tmp = arr.copy()
    tmp[is_ink, :3] = palette[keep][0]            # placeholder inside the reduced palette
    tmp, st = qa.fix_array(tmp, palette[keep], outline)
    stats.update(st)
    tmp[is_ink & (tmp[..., 3] == 255), :3] = ink
    fixed, st2 = qa.fix_array(tmp, palette, outline, fix_outline=True, fix_speckle=speckle)
    stats["outline_repainted"] += st2["outline_repainted"]
    stats["speckle_removed"] += st2.get("speckle_removed", 0)
    stats["outline_thinned"] += thin_outline(fixed, palette, outline)
    return fixed


def thin_outline(arr, palette, outline, passes=3):
    """Break 2x2 outline blocks: an interior (non-edge) block pixel becomes ink_02 so the outline stays 1px."""
    ink = np.array(outline, np.uint8)
    fill = palette[int(np.argmin(((palette.astype(int) - np.array([0x2c, 0x27, 0x33])) ** 2).sum(-1)))]
    n = 0
    for _ in range(passes):
        opaque = arr[..., 3] == 255
        edge = qa._neighbors_transparent(opaque)
        thick = qa.defect_masks(arr, palette, outline)["outline_thick"]
        ol = opaque & (arr[..., :3] == ink).all(-1)
        cand = thick & ol & ~edge
        if not cand.any():
            break
        # one pixel per 2x2 block: take candidates whose left and top neighbours are not already candidates
        pick = cand.copy()
        pick[:, 1:] &= ~cand[:, :-1]
        pick[1:, :] &= ~cand[:-1, :]
        arr[pick, :3] = fill
        n += int(pick.sum())
    return n


# ----------------------------------------------------------------------------- environment
def slice_tileset(a, raw_dir: Path, report):
    """Cut each manifest sheet into tiles; animated sheets are frame blocks stacked downward."""
    jobs = []
    default = a["tile_size"]
    for sh in a["sheets"]:
        src = raw_dir / f"{sh['id']}.png"
        if not src.exists():
            report["missing"].append(f"{a['id']}/{sh['id']}: raw sheet not found")
            continue
        tw, th = qa._wh(sh.get("tile_size"), (default, default))
        arr = read(src)
        H, W = arr.shape[:2]
        frames = sh.get("anim_frames", 1)
        cols = W // tw
        rows = H // th // frames
        if cols * rows < sh["tiles"] or W % tw or H % th:
            report["mismatch"].append(f"{a['id']}/{sh['id']}: {W}x{H} cannot hold {sh['tiles']} tiles of {tw}x{th} x{frames}f")
            continue
        for f in range(frames):
            for n in range(sh["tiles"]):
                r, c = divmod(n, cols)
                y0, x0 = (f * rows + r) * th, c * tw
                jobs.append((f"{sh['id']}_f{f}_{n}", arr[y0:y0 + th, x0:x0 + tw]))
    known = {f"{s['id']}.png" for s in a["sheets"]}
    for extra in sorted(raw_dir.glob("*.png")):
        if extra.name not in known:
            report["unmanifested"].append(f"tilesets/{a['id']}/{extra.name}")
    return jobs


def env_jobs(a, raw_root: Path, report):
    """Yield (name, arr) for one environment asset, or [] when the raw layout is not understood."""
    cat, aid = a["category"], a["id"]
    folder = {"tileset": "tilesets", "weapon": "weapons", "projectile": "projectiles", "prop": "props",
              "icon": "ui", "ui": "ui"}[cat]
    d = raw_root / folder / aid
    if not d.is_dir():
        return None
    if cat == "tileset":
        return slice_tileset(a, d, report)
    exp = qa.expected_files(a)
    jobs, used = [], set()
    for (anim, dr, n), wh in exp.items():
        if cat == "icon":
            cand = d / (f"{aid}_{wh[0]}x{wh[1]}.png")
        elif cat == "ui" and dr == "none":
            cand = d / f"{aid}_{anim}_{n}.png"
        else:
            cand = d / f"{anim}_{n:02d}.png"
        if cand.exists():
            jobs.append((f"{anim}_{dr}_{n}", read(cand)))
            used.add(cand.name)
    for extra in sorted(d.glob("*.png")):
        if extra.name not in used:
            report["unmanifested"].append(f"{folder}/{aid}/{extra.name}")
    return jobs


# ----------------------------------------------------------------------------- characters
def load_character(a, raw_dir: Path):
    """{(anim, dir, n): arr} for every frame found, PixelLab outline already mapped to ink_01."""
    frames = {}
    for anim in a["animations"]:
        for dr in a["directions"]:
            for p in sorted((raw_dir / anim / dr).glob("frame_*.png")):
                n = int(p.stem.split("_")[1])
                arr = read(p)
                rgb = arr[..., :3]
                arr[(arr[..., 3] >= 128) & (rgb == np.array(PIXELLAB_OUTLINE, np.uint8)).all(-1), :3] = np.array(qa.hex_to_rgb("#14101a"), np.uint8)
                frames[(anim, dr, n)] = arr
    return frames


def character_layout(frames, target, ref=48):
    """Common bbox in a shared centred reference space + the integer-free scale needed to fit `target`."""
    box = [10 ** 6, 10 ** 6, -1, -1]
    for arr in frames.values():
        h, w = arr.shape[:2]
        ys, xs = np.nonzero(arr[..., 3] >= 128)
        if not len(xs):
            continue
        ox, oy = (ref - w) // 2, (ref - h) // 2
        box = [min(box[0], xs.min() + ox), min(box[1], ys.min() + oy), max(box[2], xs.max() + ox), max(box[3], ys.max() + oy)]
    box = [int(v) for v in box]
    bw, bh = box[2] - box[0] + 1, box[3] - box[1] + 1
    scale = min(1.0, target[0] / bw, target[1] / bh)
    return box, bw, bh, scale


def place_character(frames, target, outline, a_id, ref=48):
    """Crop to the common bbox, downscale only if needed, anchor feet at bottom-centre of the canvas."""
    tw, th = target
    box, bw, bh, scale = character_layout(frames, target, ref)
    ow, oh = (bw, bh) if scale == 1.0 else (max(1, round(bw * scale)), max(1, round(bh * scale)))
    dx, dy = (tw - ow) // 2, th - oh          # feet on the last row, body centred horizontally
    out = {}
    for k, arr in frames.items():
        h, w = arr.shape[:2]
        ox, oy = (ref - w) // 2, (ref - h) // 2
        crop = np.zeros((bh, bw, 4), np.uint8)
        sy0, sx0 = box[1] - oy, box[0] - ox
        for yy in range(bh):
            for xx in range(bw):
                sy, sx = sy0 + yy, sx0 + xx
                if 0 <= sy < h and 0 <= sx < w:
                    crop[yy, xx] = arr[sy, sx]
        if scale != 1.0:
            crop = mode_downscale(crop, ow, oh, bw, bh, outline)
        canvas = np.zeros((th, tw, 4), np.uint8)
        canvas[dy:dy + oh, dx:dx + ow] = crop
        out[k] = canvas
    info = {"canvas": [tw, th], "common_bbox_ref48": [int(v) for v in box], "bbox_size": [int(bw), int(bh)],
            "scale": round(scale, 4), "out_size": [ow, oh], "paste_offset": [int(dx), int(dy)],
            "anchor_px": [int(dx + ow // 2), int(th - 1)], "origin": [round((dx + ow / 2) / tw, 4), 1.0]}
    return out, info


def denoise_colours(frames, min_share=0.004):
    """Merge colours that cover < min_share of the character's opaque pixels into the nearest kept colour (Lab)."""
    allpx = np.concatenate([f[f[..., 3] == 255][:, :3] for f in frames.values()])
    cols, cnt = np.unique(allpx, axis=0, return_counts=True)
    keep = cnt >= max(2, int(cnt.sum() * min_share))
    if keep.all() or not keep.any():
        return 0
    lab = qa.srgb_to_lab(cols)
    d = ((lab[:, None] - lab[None][:, keep]) ** 2).sum(-1)
    remap = {tuple(c): tuple(cols[keep][d[i].argmin()]) for i, c in enumerate(cols.tolist()) if not keep[i]}
    n = 0
    for f in frames.values():
        for src, dst in remap.items():
            m = (f[..., 3] == 255) & (f[..., :3] == np.array(src, np.uint8)).all(-1)
            f[m, :3] = np.array(dst, np.uint8)
            n += int(m.sum())
    return n


# ----------------------------------------------------------------------------- driver
def build(args):
    m = json.loads(Path(args.manifest).read_text(encoding="utf8"))
    palette, outline = qa.load_palette(Path(args.palette))
    out_root = Path(args.out).resolve()
    if out_root.name != "processed":
        raise SystemExit("--out must be a directory named 'processed'")
    report = {"written": Counter(), "missing": [], "mismatch": [], "unmanifested": [], "anchors": {}, "stats": Counter()}
    assets = {a["id"]: a for a in m["assets"]}
    todo = set(args.only) if args.only else None

    def emit(a, aid, jobs):
        folder = out_root / GROUP[a["category"]] / aid
        if folder.exists():
            shutil.rmtree(folder)
        for name, arr in jobs:
            write(arr, folder / f"{name}.png")
            report["written"][GROUP[a["category"]]] += 1

    stats = report["stats"]
    if args.env_src and Path(args.env_src).is_dir():
        for aid, a in sorted(assets.items()):
            if a["category"] in CHAR_CATS or (todo and aid not in todo):
                continue
            jobs = env_jobs(a, Path(args.env_src), report)
            if not jobs:
                continue
            fixed = []
            for name, arr in jobs:
                fixed.append((name, snap(arr, palette, outline, a["category"], stats)))
            emit(a, aid, fixed)
    if args.char_src and Path(args.char_src).is_dir():
        for aid, a in sorted(assets.items()):
            if a["category"] not in CHAR_CATS or (todo and aid not in todo):
                continue
            d = Path(args.char_src) / GROUP[a["category"]] / aid
            if not d.is_dir():
                continue
            frames = load_character(a, d)
            if not frames:
                continue
            want = qa.expected_files(a)
            miss = [k for k in want if k not in frames]
            if miss:
                report["missing"].append(f"{aid}: {len(miss)} frames missing e.g. {miss[0]}")
            placed, info = place_character(frames, tuple(a["size"]), outline, aid)
            fixed = {}
            for k, arr in placed.items():
                fixed[k] = snap_character(arr, palette, outline, stats, speckle=True)
            if not args.no_denoise:
                stats["colour_noise_merged"] += denoise_colours(fixed)
            info["frames"] = len(fixed)
            report["anchors"][aid] = info
            emit(a, aid, [(f"{k[0]}_{k[1]}_{k[2]}", v) for k, v in sorted(fixed.items())])
            (out_root / GROUP[a["category"]] / aid / "anchor.json").write_text(
                json.dumps(info, indent=1, sort_keys=True) + "\n", encoding="utf8")
    if args.vfx_src and Path(args.vfx_src).is_dir():
        vdir = out_root / "vfx"
        if vdir.exists():
            shutil.rmtree(vdir)
        for p in sorted(Path(args.vfx_src).glob("*.png")):
            if p.stem.endswith("_sheet"):          # horizontal strips are a packaging convenience, not frames
                continue
            fixed = snap(read(p), palette, outline, "vfx", stats)
            write(fixed, vdir / p.name)
            report["written"]["vfx"] += 1
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--manifest", default=str(REPO / "assets/manifest.json"))
    ap.add_argument("--palette", default=str(REPO / "tools/generators/palette.json"))
    ap.add_argument("--env-src", default=str(REPO / "assets/raw/environment_items"))
    ap.add_argument("--char-src", default=str(REPO / "assets/raw/characters"))
    ap.add_argument("--vfx-src", default=None)
    ap.add_argument("--out", default=str(REPO / "assets/processed"))
    ap.add_argument("--only", nargs="*", help="rebuild only these asset ids")
    ap.add_argument("--no-denoise", action="store_true")
    ap.add_argument("--log", help="write a deterministic JSON build log")
    args = ap.parse_args(argv)
    rep = build(args)
    print("written:", dict(rep["written"]), "| fixes:", dict(rep["stats"]))
    for key in ("missing", "mismatch", "unmanifested"):
        for line in rep[key]:
            print(f"{key}: {line}")
    if args.log:
        Path(args.log).write_text(json.dumps({k: (dict(v) if isinstance(v, Counter) else v) for k, v in rep.items()},
                                             indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
