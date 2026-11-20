#!/usr/bin/env python
"""Asset QA for Tien Nghich 2D: validates PNG frames against assets/manifest.json + palette.json.

Run isolated:  python -I tools/scripts/qa_assets.py [options]      (needs numpy + Pillow only)

Modes
  check (default)  read --root (default assets/processed), print summary, exit 1 on any error.
  --fix            read --src (default assets/raw), write repaired copies into --dst
                   (default assets/processed). --dst must be a directory named "processed";
                   --src is never written to. Both sides are QA'd, so fixed/remaining is measured.
  --report [path]  write a markdown report (default docs/ASSET_QA_REPORT.md).
  --sheet path     write a before/after contact sheet (nearest x4) for --fix runs.

Key naming contract (path relative to the root):
  <group>/<id>/<anim>_<dir>_<n>.png
    group  last folder of manifest output_path's parent: players mobs bosses tilesets weapons
           projectiles props icons ui
    anim   manifest animation name (tileset: sheet id; icon: "static" or "v<W>" size variant)
    dir    south|east|north|west as listed in the manifest; "none" when not directional;
           tileset: "f<k>" = animation frame k of the sheet
    n      0-based frame index (tileset: tile index)
This tool does NOT judge art quality or palette *semantics* (manifest palette_refs are
provisional role names); it checks mechanical, objectively decidable properties only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
SEV_ORDER = {"error": 0, "warn": 1, "info": 2}
NAME_RE = re.compile(r"^(?P<anim>[a-z0-9]+(?:_[a-z0-9]+)*)_(?P<dir>south|east|north|west|none|f\d+)_(?P<n>\d+)$")
# Categories whose silhouettes must carry the 1px outline. Tiles/UI/projectile glows are exempt.
OUTLINE_CATEGORIES = {"player", "mob", "boss", "weapon", "prop", "icon"}
GROUP_OF_CATEGORY = {"player": "players", "mob": "mobs", "boss": "bosses", "tileset": "tilesets",
                     "weapon": "weapons", "projectile": "projectiles", "prop": "props",
                     "icon": "icons", "ui": "ui"}


# ----------------------------------------------------------------------------- loading
def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_palette(path: Path):
    p = json.loads(path.read_text(encoding="utf8"))
    cols = [hex_to_rgb(c["hex"]) for c in p["colors"]]
    outline = hex_to_rgb(p["outline"])
    if outline not in cols:
        cols.append(outline)
    return np.array(cols, dtype=np.uint8), outline


def _wh(v, default):
    if v is None:
        return tuple(default)
    return (v, v) if isinstance(v, int) else (v[0], v[1])


def expected_files(a: dict) -> dict:
    """Return {(anim, dir, n): (w, h)} the manifest demands for one asset."""
    size = tuple(a["size"])
    out = {}
    cat = a["category"]
    if cat == "tileset":
        for sh in a["sheets"]:
            wh = _wh(sh.get("tile_size"), (a["tile_size"], a["tile_size"]))
            for f in range(sh.get("anim_frames", 1)):
                for n in range(sh["tiles"]):
                    out[(sh["id"], f"f{f}", n)] = wh
        return out
    dirs = a.get("directions") or ["none"]
    for anim, cfg in (a.get("animations") or {}).items():
        for d in dirs:
            for n in range(cfg["frames"]):
                out[(anim, d, n)] = size
    if cat == "icon":
        out[("static", "none", 0)] = size
        for v in a.get("variant_sizes", []):
            if tuple(v) != size:
                out[(f"v{v[0]}", "none", 0)] = tuple(v)
    elif not out:
        out[("static", "none", 0)] = size
    return out


def manifest_selfcheck(m: dict) -> list:
    issues = []
    ids = Counter(a["id"] for a in m["assets"])
    for i, c in ids.items():
        if c > 1:
            issues.append(("error", "manifest_dup_id", i, "duplicate asset id in manifest"))
    for a in m["assets"]:
        if a["category"] in ("player", "mob", "boss"):
            fpd = sum(c["frames"] for c in a["animations"].values())
            if fpd != a.get("frames_per_direction"):
                issues.append(("warn", "manifest_count", a["id"], f"frames_per_direction {a.get('frames_per_direction')} != sum {fpd}"))
            if a.get("total_frames") != fpd * len(a["directions"]):
                issues.append(("warn", "manifest_count", a["id"], f"total_frames {a.get('total_frames')} != {fpd * len(a['directions'])}"))
    return issues


# ----------------------------------------------------------------------------- pixel checks
def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _neighbors_transparent(opaque: np.ndarray) -> np.ndarray:
    """True where a pixel has a 4-neighbour that is inside the canvas and not opaque."""
    t = ~opaque
    r = np.zeros_like(opaque)
    r[1:, :] |= t[:-1, :]
    r[:-1, :] |= t[1:, :]
    r[:, 1:] |= t[:, :-1]
    r[:, :-1] |= t[:, 1:]
    return r


def pack(rgb: np.ndarray) -> np.ndarray:
    return (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2]


def components(opaque: np.ndarray) -> list:
    """8-connected components of an opaque mask -> list of lists of (y, x). Images are tiny (<=96px)."""
    h, w = opaque.shape
    seen = np.zeros_like(opaque)
    comps = []
    for y, x in zip(*np.nonzero(opaque)):
        if seen[y, x]:
            continue
        stack, comp = [(y, x)], []
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and opaque[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        comps.append(comp)
    return comps


def defect_masks(arr: np.ndarray, palette: np.ndarray, outline) -> dict:
    """Per-pixel boolean masks of each pixel-level defect (shared by checks and the contact sheet)."""
    a = arr[..., 3]
    opaque = a == 255
    px = pack(arr[..., :3])
    m = {"partial_alpha": (a > 0) & (a < 255),
         "dirty_transparent": (a == 0) & (arr[..., :3].sum(-1) != 0),
         "off_palette": opaque & ~np.isin(px, pack(palette))}
    ol = opaque & (px == pack(np.array(outline, dtype=np.uint8)))
    m["outline_gap"] = opaque & _neighbors_transparent(opaque) & ~ol
    thick = np.zeros_like(ol)
    blk = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
    thick[:-1, :-1] |= blk; thick[1:, :-1] |= blk; thick[:-1, 1:] |= blk; thick[1:, 1:] |= blk
    m["outline_thick"] = thick
    speck = np.zeros_like(opaque)
    comps = components(opaque)
    if comps and max(map(len, comps)) >= 20:
        for c in comps:
            if len(c) <= 2:
                for y, x in c:
                    speck[y, x] = True
    m["speckle"] = speck
    return m


def analyse(arr: np.ndarray, expect_size, palette: np.ndarray, outline, need_outline: bool) -> list:
    """arr: HxWx4 uint8. Returns [(severity, code, count, detail)]."""
    out = []
    h, w = arr.shape[:2]
    if expect_size and (w, h) != tuple(expect_size):
        out.append(("error", "size", 1, f"{w}x{h} != expected {expect_size[0]}x{expect_size[1]}"))
    if not (arr[..., 3] > 0).any():
        out.append(("error", "empty_frame", 1, "fully transparent"))
        return out
    m = defect_masks(arr, palette, outline)
    px = pack(arr[..., :3])
    if m["partial_alpha"].any():
        out.append(("error", "partial_alpha", int(m["partial_alpha"].sum()), "alpha must be 0 or 255"))
    if m["dirty_transparent"].any():
        out.append(("error", "dirty_transparent", int(m["dirty_transparent"].sum()), "RGB under alpha 0 must be 0,0,0"))
    off = m["off_palette"]
    if off.any():
        cols = sorted({"#%06x" % v for v in np.unique(px[off]).tolist()})
        out.append(("error", "off_palette", int(off.sum()), f"{len(cols)} colours e.g. {', '.join(cols[:4])}"))
    if need_outline:
        if m["outline_gap"].any():
            out.append(("error", "outline_gap", int(m["outline_gap"].sum()), "silhouette edge pixels that are not #14101a"))
        if m["outline_thick"].any():
            out.append(("warn", "outline_thick", int(m["outline_thick"].sum()), "2x2 outline blocks (outline should be 1px)"))
    if m["speckle"].any():
        out.append(("warn", "speckle", int(m["speckle"].sum()), "isolated 1-2px islands detached from the sprite"))
    return out


# ----------------------------------------------------------------------------- scanning
def load_rgba(p: Path):
    try:
        im = Image.open(p)
        mode = im.mode
        im = im.convert("RGBA")
        return np.array(im), mode, None
    except Exception as e:  # corrupt / unreadable
        return None, None, str(e)


def scan(root: Path, m: dict, palette, outline, with_pixels=True, loose=False):
    """Return (issues, per_file, coverage). issues: dicts with severity/code/where/count/detail."""
    issues = []

    def add(sev, code, where, detail, count=1):
        issues.append({"severity": sev, "code": code, "where": where, "count": count, "detail": detail})

    for sev, code, where, detail in manifest_selfcheck(m):
        add(sev, code, where, detail)
    assets = {a["id"]: a for a in m["assets"]}
    exp = {i: expected_files(a) for i, a in assets.items()}

    def contract_fail(code, key, detail, p, aid=None):
        """Naming/layout violation. With --loose the pixels are still inspected (reported as loose_*)."""
        add("error", code, key, detail)
        if not loose:
            return
        arr, _, err = load_rgba(p)
        if arr is None:
            add("error", "corrupt_png", key, err)
            return
        mt = re.search(r"_(\d+)x(\d+)$", p.stem)
        size = (int(mt[1]), int(mt[2])) if mt else None
        cat = assets[aid]["category"] if aid in assets else ("icon" if "icon_" in p.stem else "ui")
        for sev, c, cnt, d in analyse(arr, size, palette, outline, cat in OUTLINE_CATEGORIES):
            add(sev, "loose_" + c, key, d, cnt)

    found = defaultdict(dict)  # id -> {(anim,dir,n): path}
    files = sorted(root.rglob("*")) if root.exists() else []
    hashes = {}
    for p in files:
        if p.is_dir():
            continue
        rel = p.relative_to(root)
        key = rel.as_posix()
        if p.suffix.lower() != ".png":
            if p.suffix.lower() not in (".json", ".md", ".toml", ".txt"):
                add("warn", "non_png", key, "non-PNG file in asset tree")
            continue
        if len(rel.parts) < 3:
            contract_fail("orphan_path", key, "expected <group>/<id>/<anim>_<dir>_<n>.png", p, None)
            continue
        group, aid, stem = rel.parts[-3], rel.parts[-2], p.stem
        a = assets.get(aid)
        if a is None:
            contract_fail("orphan_asset", key, f"id '{aid}' is not in manifest", p, aid)
            continue
        if group != GROUP_OF_CATEGORY[a["category"]]:
            contract_fail("bad_group", key, f"group '{group}' should be '{GROUP_OF_CATEGORY[a['category']]}'", p, aid)
            continue
        mt = NAME_RE.match(stem)
        if not mt:
            contract_fail("bad_name", key, "name must match <anim>_<dir>_<n> (lowercase, no spaces)", p, aid)
            continue
        k = (mt["anim"], mt["dir"], int(mt["n"]))
        if mt["n"] != str(int(mt["n"])):
            contract_fail("bad_name", key, "frame index must not be zero-padded", p, aid)
            continue
        if k not in exp[aid]:
            add("error", "orphan_frame", key, "frame not demanded by manifest (unknown anim/dir or index >= frames)")
            continue
        if k in found[aid]:
            add("error", "duplicate_key", key, f"same key also at {found[aid][k]}")
            continue
        found[aid][k] = key
        if not with_pixels:
            continue
        arr, mode, err = load_rgba(p)
        if arr is None:
            add("error", "corrupt_png", key, err)
            continue
        if mode != "RGBA":
            add("warn", "mode", key, f"PNG mode {mode}, expected RGBA")
        for sev, code, cnt, detail in analyse(arr, exp[aid][k], palette, outline, a["category"] in OUTLINE_CATEGORIES):
            add(sev, code, key, detail, cnt)
        hashes[key] = (aid, k, hashlib.sha1(arr.tobytes()).hexdigest())
    # missing frames, duplicate frames
    cov = {}
    for aid, a in assets.items():
        have = found.get(aid, {})
        want = exp[aid]
        miss = [k for k in want if k not in have]
        status = "not_delivered" if not have else ("complete" if not miss else "partial")
        cov[aid] = {"category": a["category"], "have": len(have), "want": len(want), "status": status}
        if have and miss:
            ex = ", ".join(f"{x[0]}_{x[1]}_{x[2]}" for x in miss[:3])
            add("error", "missing_frames", f"{GROUP_OF_CATEGORY[a['category']]}/{aid}", f"{len(miss)} of {len(want)} missing e.g. {ex}", len(miss))
    seq = defaultdict(list)
    for key, (aid, k, hx) in hashes.items():
        seq[(aid, k[0], k[1])].append((k[2], hx, key))
    for (aid, anim, d), lst in seq.items():
        if len(lst) < 2:
            continue
        lst.sort()
        by = defaultdict(list)
        for n, hx, key in lst:
            by[hx].append(key)
        for hx, keys in by.items():
            if len(keys) > 1:
                add("warn", "duplicate_frame", keys[1], f"identical to {keys[0]}", len(keys) - 1)
    return issues, cov


# ----------------------------------------------------------------------------- fixing
def fix_array(arr: np.ndarray, palette: np.ndarray, outline=None, thr=128, fix_outline=False, fix_speckle=False):
    """Return (fixed_arr, stats). Order: snap alpha -> clean transparent -> Lab-quantize
    -> (opt-in) speckle removal -> (opt-in) repaint outline-gap edge pixels with the outline colour."""
    arr = arr.copy()
    st = Counter()
    a = arr[..., 3]
    partial = (a > 0) & (a < 255)
    st["alpha_snapped"] = int(partial.sum())
    a[:] = np.where(a >= thr, 255, 0)
    clear = (a == 0) & (arr[..., :3].sum(-1) != 0)
    st["transparent_cleaned"] = int(clear.sum())
    arr[a == 0, :3] = 0
    px = pack(arr[..., :3])
    ppx = pack(palette)
    op = a == 255
    bad = op & ~np.isin(px, ppx)
    if bad.any():
        uniq, inv = np.unique(px[bad], return_inverse=True)
        urgb = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], -1).astype(np.uint8)
        d = ((srgb_to_lab(urgb)[:, None, :] - srgb_to_lab(palette)[None, :, :]) ** 2).sum(-1)
        arr[bad, :3] = palette[d.argmin(1)][inv]
    st["quantized"] = int(bad.sum())
    if fix_speckle:
        sp = defect_masks(arr, palette, outline)["speckle"]
        arr[sp] = 0
        st["speckle_removed"] = int(sp.sum())
    if fix_outline:
        gap = defect_masks(arr, palette, outline)["outline_gap"]
        arr[gap, :3] = outline
        st["outline_repainted"] = int(gap.sum())
    return arr, st


def process_fix(src: Path, dst: Path, m, palette, outline, **opts):
    """Copy every well-named, correctly sized file to dst/<group>/<id>/ after fixing."""
    assets = {a["id"]: a for a in m["assets"]}
    log = []
    for p in sorted(src.rglob("*.png")):
        rel = p.relative_to(src)
        if len(rel.parts) < 3 or rel.parts[-2] not in assets:
            continue
        aid = rel.parts[-2]
        a = assets[aid]
        mt = NAME_RE.match(p.stem)
        if not mt or rel.parts[-3] != GROUP_OF_CATEGORY[a["category"]]:
            log.append((rel.as_posix(), "skipped", "bad name/group (cannot auto-fix)"))
            continue
        k = (mt["anim"], mt["dir"], int(mt["n"]))
        want = expected_files(a).get(k)
        arr, _, err = load_rgba(p)
        if arr is None or want is None or (arr.shape[1], arr.shape[0]) != tuple(want):
            log.append((rel.as_posix(), "skipped", "unreadable / unknown frame / wrong size (cannot auto-fix)"))
            continue
        fixed, st = fix_array(arr, palette, outline, fix_outline=bool(opts.get('fix_outline')) and a['category'] in OUTLINE_CATEGORIES,
                              fix_speckle=bool(opts.get('fix_speckle')))
        out = dst / rel.parts[-3] / aid / p.name
        out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(fixed, "RGBA").save(out, optimize=False)
        log.append((rel.as_posix(), "written", dict(st)))
    return log


# ----------------------------------------------------------------------------- reporting
def summarize(issues):
    c = Counter((i["severity"], i["code"]) for i in issues)
    n = Counter()
    for i in issues:
        n[(i["severity"], i["code"])] += 1
    return c


def _rel(v) -> str:
    """Repo-relative path for the report (no machine-specific absolute paths)."""
    try:
        return Path(v).resolve().relative_to(REPO).as_posix()
    except (ValueError, OSError):
        return str(v)


def write_report(path: Path, ctx: dict):
    ctx = dict(ctx, root=_rel(ctx["root"]), manifest=_rel(ctx["manifest"]), palette=_rel(ctx["palette"]))
    if ctx.get("fix"):
        ctx["fix"] = {**ctx["fix"], "src": _rel(ctx["fix"]["src"]), "dst": _rel(ctx["fix"]["dst"])}
    L = ["# Asset QA Report", "", f"- Root kiểm tra: `{ctx['root']}`", f"- Manifest: `{ctx['manifest']}` ({ctx['n_assets']} asset)",
         f"- Palette: `{ctx['palette']}` ({ctx['n_colors']} màu)", f"- Số PNG đọc được: {ctx['n_png']}", ""]
    errs = [i for i in ctx["issues"] if i["severity"] == "error"]
    warns = [i for i in ctx["issues"] if i["severity"] == "warn"]
    L += [f"**Kết quả: {len(errs)} lỗi, {len(warns)} cảnh báo.**", ""]
    cov = ctx["coverage"]
    st = Counter(v["status"] for v in cov.values())
    L += ["## Độ phủ theo manifest", "", "| Trạng thái | Số asset |", "|---|---|"]
    L += [f"| {k} | {st.get(k, 0)} |" for k in ("complete", "partial", "not_delivered")]
    L += ["", "`not_delivered` = chưa có file nào (không tính là lỗi). `partial` = thiếu frame (lỗi `missing_frames`).", ""]
    L += ["## Lỗi theo loại", "", "| Mức | Mã | Số file/mục | Số pixel/đối tượng |", "|---|---|---|---|"]
    agg = defaultdict(lambda: [0, 0])
    for i in ctx["issues"]:
        agg[(i["severity"], i["code"])][0] += 1
        agg[(i["severity"], i["code"])][1] += i["count"]
    for (s, c), (n, t) in sorted(agg.items(), key=lambda x: (SEV_ORDER[x[0][0]], x[0][1])):
        L.append(f"| {s} | `{c}` | {n} | {t} |")
    if not agg:
        L.append("| - | (không có) | 0 | 0 |")
    L += ["", "## Chi tiết (tối đa 200 dòng)", "", "| Mức | Mã | Vị trí | Chi tiết |", "|---|---|---|---|"]
    for i in sorted(ctx["issues"], key=lambda i: (SEV_ORDER[i["severity"]], i["code"], i["where"]))[:200]:
        L.append(f"| {i['severity']} | `{i['code']}` | `{i['where']}` | {i['detail']} ({i['count']}) |")
    if ctx.get("fix"):
        f = ctx["fix"]
        L += ["", "## Chế độ --fix", "", f"- Nguồn (chỉ đọc): `{f['src']}`", f"- Đích: `{f['dst']}`",
              f"- Lỗi trước khi sửa: {f['before_err']}; sau khi sửa: {f['after_err']}; **sửa được: {f['before_err'] - f['after_err']}**",
              f"- Số file ghi: {f['written']}; bỏ qua (không tự sửa được): {f['skipped']}"]
    L += ["", "## Ghi chú về vai trò công cụ", "",
          "- Công cụ này kiểm tra cơ học (kích thước, alpha, palette, viền, đặt tên, số frame). Không đánh giá chất lượng nghệ thuật.",
          "- `palette_refs` trong manifest là tên vai trò tạm; chưa được ánh xạ sang id palette thật nên chưa kiểm tra 'đúng màu theo asset'.",
          "- `assetcat` KHÔNG làm kiểm tra pixel: nó chỉ lập chỉ mục/license/provenance (xem docs/ASSET_PROVENANCE.md).", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(L), encoding="utf8")


MARKS = {"outline_gap": (255, 40, 40), "off_palette": (255, 170, 0), "partial_alpha": (60, 140, 255),
         "dirty_transparent": (255, 0, 255), "speckle": (255, 255, 0), "outline_thick": (0, 255, 255)}


def _checker(w, h, scale):
    bg = Image.new("RGBA", (w * scale, h * scale))
    d = ImageDraw.Draw(bg)
    for y in range(h):
        for x in range(w):
            c = (62, 62, 72, 255) if (x + y) % 2 else (50, 50, 58, 255)
            d.rectangle([x * scale, y * scale, x * scale + scale - 1, y * scale + scale - 1], fill=c)
    return bg


def _cell(arr, scale, masks=None):
    """arr RGBA -> checker-backed nearest-scaled image; masks -> coloured boxes drawn over defect pixels."""
    h, w = arr.shape[:2]
    bg = _checker(w, h, scale)
    big = Image.fromarray(arr, "RGBA").resize((w * scale, h * scale), Image.NEAREST)
    bg.alpha_composite(big)
    if masks:
        d = ImageDraw.Draw(bg)
        for code, mk in masks.items():
            if code in MARKS and mk.any():
                for y, x in zip(*np.nonzero(mk)):
                    d.rectangle([x * scale, y * scale, x * scale + scale - 1, y * scale + scale - 1], outline=MARKS[code])
    return bg


def contact_sheet(src: Path, dst: Path, log: list, palette, outline, out: Path, scale=4, max_rows=8, per_row=2):
    """Before (raw, defects boxed) | after (processed) at x4 nearest, plus after at 1x and 2x, labelled."""
    cells = [x for x in log][: max_rows * per_row]
    if not cells:
        return
    sz = 40 * scale
    cw = sz * 2 + 80 + 16                                  # before + after + 1x/2x strip
    lab = 14
    W, H = per_row * cw + 8, ((len(cells) + per_row - 1) // per_row) * (sz + lab + 8) + 44
    sheet = Image.new("RGBA", (W, H), (28, 26, 34, 255))
    d = ImageDraw.Draw(sheet)
    d.text((6, 4), "RAW x4 (defects boxed) | PROCESSED x4 | PROCESSED 1x / 2x   (nearest, checker = transparent)", fill=(230, 230, 240, 255))
    x0 = 6
    for code, col in MARKS.items():
        d.rectangle([x0, 20, x0 + 8, 28], outline=col)
        d.text((x0 + 12, 19), code, fill=col)
        x0 += 12 + 6 * len(code) + 12
    for i, (rel, status, info) in enumerate(cells):
        r, c = divmod(i, per_row)
        ox, oy = 4 + c * cw, 40 + r * (sz + lab + 8)
        short = "/".join(Path(rel).parts[-2:])
        arr, _, err = load_rgba(src / rel)
        if arr is None:
            d.text((ox, oy), f"{short}: UNREADABLE", fill=(255, 80, 80, 255))
            continue
        masks = defect_masks(arr, palette, outline)
        codes = ",".join(k for k, v in masks.items() if v.any() and k in MARKS) or "pixels ok"
        d.text((ox, oy), f"{short}  [{codes}]" + ("  SKIPPED" if status == "skipped" else ""), fill=(220, 220, 230, 255))
        sheet.alpha_composite(_cell(arr, scale, masks), (ox, oy + lab))
        if status == "written":
            fx = Path(rel).parts[-3] + "/" + Path(rel).parts[-2] + "/" + Path(rel).name
            fa, _, _ = load_rgba(dst / fx)
            sheet.alpha_composite(_cell(fa, scale), (ox + sz + 4, oy + lab))
            sheet.alpha_composite(_cell(fa, 1), (ox + 2 * sz + 8, oy + lab))
            sheet.alpha_composite(_cell(fa, 2), (ox + 2 * sz + 8, oy + lab + fa.shape[0] + 4))
        else:
            d.text((ox + sz + 8, oy + lab + 4), "not auto-fixable:\n" + str(info)[:40], fill=(255, 120, 120, 255))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out)


# ----------------------------------------------------------------------------- cli
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--manifest", default=str(REPO / "assets/manifest.json"))
    ap.add_argument("--palette", default=str(REPO / "tools/generators/palette.json"))
    ap.add_argument("--root", default=str(REPO / "assets/processed"))
    ap.add_argument("--fix", action="store_true")
    ap.add_argument("--src", default=str(REPO / "assets/raw"))
    ap.add_argument("--dst", default=str(REPO / "assets/processed"))
    ap.add_argument("--report", nargs="?", const=str(REPO / "docs/ASSET_QA_REPORT.md"))
    ap.add_argument("--fix-outline", action="store_true", help="opt-in: repaint outline-gap edge pixels with #14101a (only categories needing outline)")
    ap.add_argument("--fix-speckle", action="store_true", help="opt-in: delete isolated 1-2px islands")
    ap.add_argument("--sheet")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--loose", action="store_true", help="also run pixel checks (as loose_*) on files that violate the naming contract")
    args = ap.parse_args(argv)

    m = json.loads(Path(args.manifest).read_text(encoding="utf8"))
    palette, outline = load_palette(Path(args.palette))
    ctx = {"manifest": args.manifest, "palette": args.palette, "n_colors": len(palette), "n_assets": len(m["assets"])}
    if args.fix:
        src, dst = Path(args.src).resolve(), Path(args.dst).resolve()
        if dst.name != "processed":
            ap.error("--dst must be a directory named 'processed'")
        if dst == src or src in dst.parents or dst in src.parents:
            ap.error("--src and --dst must be separate trees (raw is never modified)")
        before, _ = scan(src, m, palette, outline)
        log = process_fix(src, dst, m, palette, outline, fix_outline=args.fix_outline, fix_speckle=args.fix_speckle)
        issues, cov = scan(dst, m, palette, outline)
        ctx.update(root=str(dst), fix={"src": str(src), "dst": str(dst),
                                       "before_err": sum(i["severity"] == "error" for i in before),
                                       "after_err": sum(i["severity"] == "error" for i in issues),
                                       "written": sum(1 for x in log if x[1] == "written"),
                                       "skipped": sum(1 for x in log if x[1] == "skipped")})
        if args.sheet:
            contact_sheet(src, dst, log, palette, outline, Path(args.sheet))
    else:
        root = Path(args.root)
        issues, cov = scan(root, m, palette, outline, loose=args.loose)
        ctx["root"] = str(root)
    ctx.update(issues=issues, coverage=cov, n_png=sum(v["have"] for v in cov.values()))
    if args.report:
        write_report(Path(args.report), ctx)
    errs = sum(i["severity"] == "error" for i in issues)
    warns = sum(i["severity"] == "warn" for i in issues)
    if args.json:
        print(json.dumps({"errors": errs, "warnings": warns, "issues": issues}, indent=1))
    else:
        for (s, c), n in sorted(summarize(issues).items(), key=lambda x: (SEV_ORDER[x[0][0]], x[0][1])):
            print(f"{s:5} {c:20} x{n}")
        print(f"errors={errs} warnings={warns} png={ctx['n_png']}")
        if args.fix:
            f = ctx["fix"]
            print(f"fix: errors {f['before_err']} -> {f['after_err']}, written={f['written']} skipped={f['skipped']}")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
