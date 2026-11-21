#!/usr/bin/env python
"""Independent animation assembly & QA verifier for Codex Blood Sea (and v2 assembly.json) mob packages.

Reads Blood-Sea.zip or an unpacked handoff directory STRICTLY READ-ONLY. Never generates,
repaints, or modifies game artwork, and never writes to the source package or peer worktrees.

Validates:
  - Optional pinned archive SHA-256 (--expected-sha256)
  - Blood-Sea/assembly.json schema, facings contract (south/east authored, north reuses south,
    west mirrors east around 31 - anchor_x), manifest clip/frame counts, and per-PNG SHA-256 digests
  - Native 32x32 RGBA pixel hygiene (binary alpha, zero dirty transparent RGB, global 40-color
    palette.json + per-mob manifest palette compliance, 1px #14101a outline integrity, no speckles,
    no duplicate silhouettes across a mob's frames)
  - Explicit per-frame clearance_px contract (airborne flyers hovering above fixed gameplay root
    and finishing grounded on death; grounded mobs supporting root and pouncing cleanly)
  - source-map.json provenance (source.png SHA-256, zero overlapping crops, horizontal pivot drift
    with concrete source_root_x correction proposals)
  - Blood Sea terrain readability contrast against actual Blood Sea arena swatches
  - Isolated repo qa_assets.py + pack_atlases.py (web & mobile) compatibility

Produces (only inside --out-dir):
  - blood-sea-mobs-assembly-manifest.json  Machine-readable clips, timing, pivots, clearances & QA
  - blood-sea-mobs-qa-contact-sheet.png    Annotated 3x + 1x contact sheet + Blood Sea terrain strip
  - blood-sea-mobs-animation-qa.html       Self-contained dual-scale interactive QA workbench
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from blood_sea_qa_io import MARKUP_JS, package_path, report_path, script_json

REPO = Path(__file__).resolve().parents[2]
CLIP_ORDER = ["idle", "move", "attack", "death"]
AUTHORED_FACINGS = ["south", "east"]
RUNTIME_DIRS = ["south", "east", "west", "north"]

# Real Blood Sea biome backdrop swatches (from palette.json & Blood Sea court arena)
BLOOD_SEA_SWATCHES = {
    "court_stone_dark": ("#2c2733", (0x2C, 0x27, 0x33)),
    "court_stone_mid": ("#49434f", (0x49, 0x43, 0x4F)),
    "blood_pool_abyss": ("#2a0a16", (0x2A, 0x0A, 0x16)),
    "blood_pool_dried": ("#4f0f22", (0x4F, 0x0F, 0x22)),
}


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_global_palette(path: Path) -> tuple[set[tuple[int, int, int]], tuple[int, int, int], dict[str, tuple[int, int, int]]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    by_id = {c["id"]: hex_to_rgb(c["hex"]) for c in data["colors"]}
    outline = hex_to_rgb(data["outline"])
    by_id[data.get("outline_id", "ink_01")] = outline
    colors = set(by_id.values())
    colors.add(outline)
    return colors, outline, by_id


def rel_luminance(rgb: tuple[int, int, int]) -> float:
    def lin(v: int) -> float:
        c = v / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])


def contrast_ratio(c1: tuple[int, int, int], c2: tuple[int, int, int]) -> float:
    l1, l2 = rel_luminance(c1), rel_luminance(c2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def neighbors_transparent_4(opaque: np.ndarray) -> np.ndarray:
    t = ~opaque
    r = np.zeros_like(opaque)
    r[1:, :] |= t[:-1, :]
    r[:-1, :] |= t[1:, :]
    r[:, 1:] |= t[:, :-1]
    r[:, :-1] |= t[:, 1:]
    return r


def connected_components_8(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps: list[list[tuple[int, int]]] = []
    for y, x in zip(*np.nonzero(mask)):
        yi, xi = int(y), int(x)
        if seen[yi, xi]:
            continue
        stack = [(yi, xi)]
        seen[yi, xi] = True
        comp = []
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        comps.append(comp)
    return comps


def silhouette_iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    def norm_crop(m: np.ndarray) -> np.ndarray:
        ys, xs = np.nonzero(m)
        if not len(xs):
            return np.zeros((32, 32), dtype=bool)
        sub = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out = np.zeros((32, 32), dtype=bool)
        h, w = sub.shape
        out[32 - h:32, (32 - w) // 2:(32 - w) // 2 + w] = sub
        return out

    na, nb = norm_crop(mask_a), norm_crop(mask_b)
    return int((na & nb).sum()) / max(1, int((na | nb).sum()))


def horizontal_symmetry(mask: np.ndarray) -> float:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return 0.0
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    flipped = sub[:, ::-1]
    return int((sub & flipped).sum()) / max(1, int((sub | flipped).sum()))


def default_blood_sea_durations(mob_id: str, archetype: str, state: str, count: int) -> list[int]:
    """Integration-ready explicit per-frame durations (ms) tuned to biome mob archetype & beats."""
    is_flyer = archetype == "flyer" or "crow" in mob_id
    is_fast = archetype == "fast_melee" or "wolf" in mob_id

    if state == "idle":
        if count == 4:
            if is_flyer:
                return [145, 130, 145, 130]  # steady hover wingbeat
            if is_fast:
                return [160, 145, 165, 145]  # alert wolf breath cycle
            return [170, 150, 170, 150]
        if count == 6:
            return [150, 135, 135, 150, 135, 135]
    elif state == "move":
        if count == 6:
            if is_flyer:
                # 0 high wings, 1 downstroke, 2 passing down, 3 low wings, 4 upstroke, 5 passing up
                return [90, 75, 85, 95, 80, 85]
            if is_fast:
                # 0 contact A, 1 load A, 2 suspension pass A, 3 contact B, 4 load B, 5 suspension pass B
                return [95, 75, 80, 95, 75, 80]
            return [110, 85, 95, 110, 85, 95]
        if count == 4:
            return [120, 100, 120, 100]
    elif state == "attack":
        if count == 4:
            if is_flyer:
                # 0 brace, 1 pitch forward accel, 2 beak & talons dive strike, 3 flare recover
                return [150, 75, 130, 160]
            if is_fast:
                # 0 pounce windup, 1 push off accel, 2 pounce strike, 3 land & recover
                return [135, 70, 125, 155]
            return [150, 80, 135, 160]
        if count == 6:
            return [145, 95, 75, 140, 110, 160]
    elif state == "death":
        if count == 4:
            if is_flyer:
                # 0 stagger in flight, 1 lose lift, 2 fall sideways, 3 grounded rest
                return [115, 125, 135, 380]
            return [120, 130, 140, 380]
        if count == 6:
            return [110, 115, 120, 130, 145, 360]
    return [120] * count


MAX_ARCHIVE_BYTES = 512 * 1024**2
MAX_ARCHIVE_MEMBERS = 10000


def _extract_archive(archive: zipfile.ZipFile, root: Path) -> None:
    entries = archive.infolist()
    if len(entries) > MAX_ARCHIVE_MEMBERS or sum(e.file_size for e in entries) > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive exceeds extraction limits")
    seen = set()
    for entry in entries:
        name = entry.filename.removesuffix("/")
        target = package_path(root, name)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in (0, stat.S_IFDIR, stat.S_IFREG) or name.casefold() in seen:
            raise ValueError("Unsupported or duplicate ZIP member")
        seen.add(name.casefold())
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst)


def _assembly_root(root: Path) -> Path:
    if package_path(root, "assembly.json").is_file():
        return root
    for child in sorted(root.iterdir()):
        if child.is_dir() and package_path(root, child.name + "/assembly.json").is_file():
            return child
    return root


def _resolve_package_root(source_path: Path, expected_sha256: str | None = None):
    if source_path.is_dir():
        if expected_sha256:
            raise ValueError("Digest verification requires a ZIP archive")
        return _assembly_root(source_path), None, None
    if source_path.suffix.lower() != ".zip" or source_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Expected a ZIP archive within the size limit")
    with source_path.open("rb") as src:
        digest = hashlib.sha256()
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
        actual = digest.hexdigest()
        if expected_sha256 and actual != expected_sha256.lower():
            raise ValueError("Archive SHA-256 mismatch")
        src.seek(0)
        tmp = tempfile.TemporaryDirectory(prefix="blood_sea_mobs_qa_")
        try:
            with zipfile.ZipFile(src) as archive:
                _extract_archive(archive, Path(tmp.name))
            return _assembly_root(Path(tmp.name)), tmp, actual
        except BaseException:
            tmp.cleanup()
            raise


def _check_repo_pipeline_compat(
    pkg_root: Path,
    mob_ids: list[str],
    manifest_path: Path,
    palette_path: Path,
) -> dict:
    """Run repo qa_assets.py and pack_atlases.py (web & mobile) inside an isolated temp sandbox."""
    if not mob_ids:
        return {"checked": False, "reason": "no mobs to validate"}

    qa_script = REPO / "tools/scripts/qa_assets.py"
    pack_script = REPO / "tools/scripts/pack_atlases.py"
    if not qa_script.is_file() or not pack_script.is_file():
        return {"checked": False, "reason": "repo scripts missing"}

    with tempfile.TemporaryDirectory(prefix="blood_sea_repo_compat_") as td:
        td_path = Path(td)
        proc_root = td_path / "processed"
        mobs_dst = proc_root / "mobs"
        for mid in mob_ids:
            src_dir = package_path(pkg_root, f"assets/processed/mobs/{mid}")
            if src_dir.is_dir():
                dst = mobs_dst / mid
                dst.mkdir(parents=True, exist_ok=True)
                for png in sorted(src_dir.glob("*.png")):
                    shutil.copy2(package_path(src_dir, png.name), dst / png.name)

        qa_proc = subprocess.run(
            [sys.executable, "-E", "-B", str(qa_script), "--root", str(proc_root),
             "--manifest", str(manifest_path.resolve()), "--palette", str(palette_path.resolve())],
            cwd=td, timeout=120, capture_output=True,
            text=True,
            check=False,
        )

        atlas_out = td_path / "atlases"
        pack_proc = subprocess.run(
            [sys.executable, "-E", "-B", str(pack_script), "--source", str(proc_root), "--output", str(atlas_out),
             "--manifest", str(manifest_path.resolve())],
            cwd=td, timeout=120, capture_output=True,
            text=True,
            check=False,
        )

        packed_clips: dict[str, dict[str, list[str]]] = {}
        ts_file = atlas_out / "AssetKeys.ts"
        if ts_file.is_file():
            m = re.search(r"export const CharacterAnimations = (\{.*?\}) as const;", ts_file.read_text(encoding="utf-8"), re.S)
            if m:
                ca = json.loads(m.group(1))
                packed_clips = {
                    cid: {anim: sorted(dirs.keys()) for anim, dirs in anims.items()}
                    for cid, anims in ca.items()
                }

        qa_out = (qa_proc.stdout + "\n" + qa_proc.stderr).strip()
        pack_out = (pack_proc.stdout + "\n" + pack_proc.stderr).strip()
        return {
            "checked": True,
            "qa_assets_rc": qa_proc.returncode,
            "qa_assets_summary": (qa_proc.stdout.strip().splitlines() or qa_out.splitlines() or [""])[-1],
            "pack_atlases_rc": pack_proc.returncode,
            "pack_atlases_summary": (pack_proc.stdout.strip().splitlines() or pack_out.splitlines() or [""])[-1],
            "packed_clips": packed_clips,
            "directional_clips_packed": sum(len(ds) for cs in packed_clips.values() for ds in cs.values()),
        }


def audit_blood_sea_mobs(
    source_path: Path,
    manifest_path: Path,
    palette_path: Path,
    run_repo_compat: bool = True,
    expected_sha256: str | None = None,
) -> tuple[dict, dict[str, Image.Image]]:
    """Audit a v2 assembly.json mob package read-only and return (report, strip_images)."""
    global_pal, outline_rgb, pal_by_id = load_global_palette(palette_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_by_id = {a["id"]: a for a in manifest["assets"]}

    pkg_root, tmp_ctx, archive_sha256 = _resolve_package_root(source_path, expected_sha256)
    exceptions: list[dict] = []
    mob_reports: dict[str, dict] = {}
    strip_images: dict[str, Image.Image] = {}

    def add_exc(severity: str, code: str, mob_id: str, where: str, detail: str, proposal: dict | None = None) -> None:
        rec = {"severity": severity, "code": code, "mob": mob_id, "where": where, "detail": detail}
        if proposal is not None:
            rec["proposed_correction"] = proposal
        exceptions.append(rec)

    try:
        aj_path = pkg_root / "assembly.json"
        if not aj_path.is_file():
            add_exc("error", "assembly_json_missing", "package", "assembly.json", f"assembly.json not found in {source_path}")
            return {
                "schema": "tien-nghich-2d.blood-sea-mob-assembly-qa",
                "version": 1,
                "source_package": str(source_path),
                "archive_sha256": archive_sha256,
                "summary": {"mobs_checked": 0, "mob_ids": [], "total_frames": 0, "directional_clips": 0, "errors": 1, "warnings": 0, "info": 0},
                "mobs": {},
                "exceptions": exceptions,
            }, {}

        aj = json.loads(aj_path.read_text(encoding="utf-8"))
        canvas = aj.get("canvas") or [32, 32]
        if canvas != [32, 32]:
            add_exc("error", "canvas_mismatch", "package", "assembly.json", f"canvas {canvas} != [32, 32]")

        facings = aj.get("facings") or {}
        north_rule = str(facings.get("north", "")).lower()
        west_rule = str(facings.get("west", "")).lower()
        facing_rules_ok = (
            str(facings.get("south", "")).lower() == "authored"
            and str(facings.get("east", "")).lower() == "authored"
            and "south" in north_rule
            and "mirror" in west_rule
            and "31" in west_rule
        )
        if not facing_rules_ok:
            add_exc("error", "facings_rule_mismatch", "package", "assembly.json", f"Unexpected facings contract: {facings}")

        assets = aj.get("assets") or {}
        if not isinstance(assets, dict) or not assets:
            add_exc("error", "no_assets_in_assembly", "package", "assembly.json", "assembly.json contains no assets")

        total_sha_ok = 0
        total_sha_failed = 0
        total_dir_clips = 0

        for mob_id in sorted(assets.keys()):
            if not re.fullmatch(r"mob_[a-z0-9_]+", mob_id):
                raise ValueError("Invalid mob ID")
            aspec = assets[mob_id]
            m_asset = manifest_by_id.get(mob_id)
            ax, ay = int(aspec["anchor_px"][0]), int(aspec["anchor_px"][1])
            west_ax = (int(canvas[0]) - 1) - ax
            archetype = (m_asset or {}).get("archetype", "unknown")
            idle_south_decl = ((aspec.get("clips") or {}).get("idle") or {}).get("directions", {}).get("south") or []
            is_flyer = (
                archetype == "flyer"
                or "crow" in mob_id
                or (bool(idle_south_decl) and all(int(f.get("clearance_px", 0)) > 0 for f in idle_south_decl))
            )

            if m_asset is None:
                add_exc("error", "manifest_missing_mob", mob_id, "assembly.json", f"{mob_id} not found in assets/manifest.json")
            else:
                if m_asset["size"] != canvas:
                    add_exc("error", "manifest_size_mismatch", mob_id, "assembly.json", f"canvas {canvas} != manifest {m_asset['size']}")
                if m_asset["directions"] != AUTHORED_FACINGS:
                    add_exc("error", "manifest_dir_mismatch", mob_id, "assembly.json", f"manifest directions {m_asset['directions']} != {AUTHORED_FACINGS}")

            # Optional raw source-map.json verification
            sm_path = package_path(pkg_root, f"assets/raw/characters/mobs/{mob_id}/source-map.json")
            sm_spec = None
            sm_by_key: dict[tuple[str, str, int], dict] = {}
            source_sha_ok = False
            source_scale = None
            source_overlaps = 0
            if sm_path.is_file():
                sm_spec = json.loads(sm_path.read_text(encoding="utf-8"))
                source_scale = float(sm_spec.get("scale", 0.0)) or None
                src_png = package_path(sm_path.parent, sm_spec.get("source_file", "source.png"))
                if not src_png.is_file():
                    add_exc("error", "source_missing", mob_id, str(src_png.name), f"Missing source sheet {src_png.name}")
                else:
                    actual_src_sha = hashlib.sha256(src_png.read_bytes()).hexdigest()
                    source_sha_ok = actual_src_sha == sm_spec.get("source_sha256")
                    if not source_sha_ok:
                        add_exc("error", "source_sha256_mismatch", mob_id, src_png.name, f"source SHA-256 {actual_src_sha[:12]} != source-map {str(sm_spec.get('source_sha256'))[:12]}")
                    src_im = Image.open(src_png).convert("RGBA")
                    if [src_im.width, src_im.height] != sm_spec.get("source_dimensions"):
                        add_exc("error", "source_dim_mismatch", mob_id, src_png.name, f"{list(src_im.size)} != {sm_spec.get('source_dimensions')}")

                sm_frames = sm_spec.get("frames") or []
                for f in sm_frames:
                    sm_by_key[(f["state"], f["direction"], int(f["index"]))] = f
                for i in range(len(sm_frames)):
                    a0, a1, a2, a3 = sm_frames[i]["crop_xyxy"]
                    for j in range(i + 1, len(sm_frames)):
                        b0, b1, b2, b3 = sm_frames[j]["crop_xyxy"]
                        if a0 < b2 and a2 > b0 and a1 < b3 and a3 > b1:
                            source_overlaps += 1
                            add_exc(
                                "error",
                                "source_crop_overlap",
                                mob_id,
                                f"{sm_frames[i]['state']}/{sm_frames[i]['direction']}/{sm_frames[i]['index']} vs {sm_frames[j]['state']}/{sm_frames[j]['direction']}/{sm_frames[j]['index']}",
                                f"Overlapping source crops {sm_frames[i]['crop_xyxy']} and {sm_frames[j]['crop_xyxy']}",
                            )

            # Allowed mob palette from manifest palette_refs + source-map palette
            mob_pal: set[tuple[int, int, int]] = set()
            if m_asset:
                for pid in m_asset.get("palette_refs") or []:
                    if pid in pal_by_id:
                        mob_pal.add(pal_by_id[pid])
            if sm_spec and isinstance(sm_spec.get("palette"), dict):
                for h in sm_spec["palette"].values():
                    mob_pal.add(hex_to_rgb(h))
            mob_pal.add(outline_rgb)

            # Collect & audit every frame in ordered clips
            clips_spec = aspec.get("clips") or {}
            ordered_frames: list[tuple[str, str, dict, Image.Image]] = []
            frame_metrics: list[dict] = []
            masks_by_key: dict[tuple[str, str, int], np.ndarray] = {}
            metrics_by_clip_dir: dict[tuple[str, str], list[dict]] = {}
            seen_silhouettes: dict[tuple[int, int, bytes], str] = {}

            tot_partial = 0
            tot_dirty0 = 0
            tot_off_global = 0
            tot_off_mob = 0
            tot_op_px = 0
            tot_ink_px = 0
            thick_frames: list[str] = []
            color_counts: Counter[tuple[int, int, int]] = Counter()

            for cname in CLIP_ORDER:
                cdef = clips_spec.get(cname)
                if not isinstance(cdef, dict):
                    add_exc("error", "missing_clip", mob_id, cname, f"Missing required clip '{cname}' in assembly.json")
                    continue
                m_anim = ((m_asset or {}).get("animations") or {}).get(cname)
                if m_anim is not None:
                    if bool(cdef.get("loop")) != bool(m_anim.get("loop")):
                        add_exc("error", "clip_loop_mismatch", mob_id, cname, f"assembly.json loop={cdef.get('loop')} != manifest loop={m_anim.get('loop')}")

                dirs_map = cdef.get("directions") or {}
                for facing in AUTHORED_FACINGS:
                    flist = dirs_map.get(facing)
                    if not isinstance(flist, list) or not flist:
                        add_exc("error", "missing_clip_direction", mob_id, f"{cname}/{facing}", f"Missing frames for {cname}/{facing}")
                        continue
                    total_dir_clips += 1
                    if m_anim is not None and len(flist) != int(m_anim["frames"]):
                        add_exc("error", "clip_frame_count_mismatch", mob_id, f"{cname}/{facing}", f"{len(flist)} frames != manifest {m_anim['frames']}")

                    cd_metrics: list[dict] = []
                    for expected_idx, fentry in enumerate(flist):
                        idx = int(fentry.get("index", expected_idx))
                        if idx != expected_idx:
                            add_exc("error", "frame_index_order", mob_id, f"{cname}/{facing}[{expected_idx}]", f"index={idx} != {expected_idx}")

                        rel_path = str(fentry.get("path", ""))
                        fp = package_path(pkg_root, rel_path)
                        fname = fp.name
                        if not fp.is_file():
                            add_exc("error", "frame_file_missing", mob_id, rel_path, f"Missing PNG {rel_path}")
                            total_sha_failed += 1
                            continue

                        raw_bytes = fp.read_bytes()
                        actual_sha = hashlib.sha256(raw_bytes).hexdigest()
                        if actual_sha != fentry.get("sha256"):
                            add_exc("error", "frame_sha256_mismatch", mob_id, fname, f"SHA-256 {actual_sha[:12]} != assembly.json {str(fentry.get('sha256'))[:12]}")
                            total_sha_failed += 1
                        else:
                            total_sha_ok += 1

                        im = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
                        if [im.width, im.height] != canvas:
                            add_exc("error", "frame_size_mismatch", mob_id, fname, f"size {list(im.size)} != {canvas}")
                            continue

                        arr = np.array(im)
                        alpha = arr[..., 3]
                        part = int(((alpha > 0) & (alpha < 255)).sum())
                        dirty0 = int(((alpha == 0) & (arr[..., :3].sum(-1) > 0)).sum())
                        op = alpha == 255
                        ys, xs = np.nonzero(op)
                        if len(xs) == 0:
                            add_exc("error", "empty_frame", mob_id, fname, "Empty transparent frame")
                            continue

                        op_rgb = arr[op][:, :3]
                        off_g = 0
                        off_m = 0
                        ink_n = 0
                        for rgb_t in map(tuple, op_rgb.tolist()):
                            color_counts[rgb_t] += 1
                            if rgb_t not in global_pal:
                                off_g += 1
                            if rgb_t not in mob_pal:
                                off_m += 1
                            if rgb_t == outline_rgb:
                                ink_n += 1

                        tot_partial += part
                        tot_dirty0 += dirty0
                        tot_off_global += off_g
                        tot_off_mob += off_m
                        tot_op_px += len(xs)
                        tot_ink_px += ink_n

                        if part > 0:
                            add_exc("error", "partial_alpha", mob_id, fname, f"{part} partial-alpha pixels")
                        if dirty0 > 0:
                            add_exc("error", "dirty_transparent", mob_id, fname, f"{dirty0} dirty RGB pixels under alpha=0")
                        if off_g > 0:
                            add_exc("error", "off_global_palette", mob_id, fname, f"{off_g} pixels outside palette.json")
                        if off_m > 0:
                            add_exc("warn", "off_mob_palette", mob_id, fname, f"{off_m} pixels outside mob manifest palette_refs")

                        bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
                        bw, bh = bx1 - bx0 + 1, by1 - by0 + 1
                        trimmed_id = (bw, bh, im.crop((bx0, by0, bx1 + 1, by1 + 1)).tobytes())
                        if trimmed_id in seen_silhouettes:
                            add_exc("error", "duplicate_silhouette", mob_id, fname, f"Identical trimmed silhouette to {seen_silhouettes[trimmed_id]}")
                        else:
                            seen_silhouettes[trimmed_id] = fname

                        actual_clr = ay - by1
                        spec_clr = int(fentry.get("clearance_px", 0))
                        if actual_clr != spec_clr:
                            add_exc(
                                "error",
                                "clearance_mismatch",
                                mob_id,
                                fname,
                                f"Measured clearance {actual_clr}px (bottom y={by1}) != assembly.json clearance_px={spec_clr}",
                            )

                        # Outline gap & thickness (exact qa_assets.py 2x2 block heuristic)
                        ol = op & (arr[..., 0] == outline_rgb[0]) & (arr[..., 1] == outline_rgb[1]) & (arr[..., 2] == outline_rgb[2])
                        edge4 = neighbors_transparent_4(op)
                        gap4 = int((op & edge4 & ~ol).sum())
                        blk2x2 = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
                        thick_px = int(blk2x2.sum())
                        if gap4 > 0:
                            add_exc("error", "outline_gap_4conn", mob_id, fname, f"{gap4} silhouette edge pixels missing #14101a outline")
                        if thick_px > 0:
                            thick_frames.append(fname)

                        comps = connected_components_8(op)
                        specks = sum(len(cp) for cp in comps if len(cp) <= 2) if (comps and max(map(len, comps)) >= 20) else 0
                        if specks > 0:
                            add_exc("warn", "detached_speckle", mob_id, fname, f"{specks} detached 1-2px pixel(s)")

                        edge_touches = [s for s, cond in (("left", bx0 == 0), ("right", bx1 == 31), ("top", by0 == 0)) if cond]
                        if edge_touches:
                            add_exc("warn", "frame_edge_touch", mob_id, fname, f"32x32 frame touches {', '.join(edge_touches)} edge (bbox={bx0},{by0}..{bx1},{by1})")

                        head_band = ys <= (by0 + max(2, int(bh * 0.35)))
                        head_cx = float(xs[head_band].mean())
                        com_x, com_y = float(xs.mean()), float(ys.mean())
                        row_bot_xs = xs[ys == by1]
                        hull2_xs = xs[ys >= by1 - 1]
                        sym = horizontal_symmetry(op)

                        if spec_clr == 0 and len(row_bot_xs) == 1 and abs(int(row_bot_xs[0]) - ax) >= 6:
                            add_exc(
                                "info",
                                "single_pixel_ground_contact",
                                mob_id,
                                fname,
                                f"Grounded row y={ay} touches only 1px at x={int(row_bot_xs[0])} (anchor_x={ax}); 2px hull spans [{int(hull2_xs.min())}..{int(hull2_xs.max())}].",
                            )

                        sm_rec = sm_by_key.get((cname, facing, idx))
                        frec = {
                            "state": cname,
                            "direction": facing,
                            "index": idx,
                            "filename": fname,
                            "path": rel_path,
                            "beat": fentry.get("beat", ""),
                            "sha256": actual_sha,
                            "clearance_px": actual_clr,
                            "declared_clearance_px": spec_clr,
                            "native_bbox": [bx0, by0, bx1, by1],
                            "native_size": [bw, bh],
                            "area_px": int(len(xs)),
                            "head_cx": round(head_cx, 2),
                            "com_xy": [round(com_x, 2), round(com_y, 2)],
                            "head_minus_anchor_x": round(head_cx - ax, 2),
                            "com_minus_anchor_x": round(com_x - ax, 2),
                            "bottom_y": by1,
                            "row_bottom_x_span": [int(row_bot_xs.min()), int(row_bot_xs.max())],
                            "support_hull_2px": [int(hull2_xs.min()), int(hull2_xs.max())],
                            "symmetry": round(sym, 3),
                            "edge_touches": edge_touches,
                            "outline_gap_4conn": gap4,
                            "outline_2x2_blocks": thick_px,
                            "speckle_px": specks,
                            "source_root_x": sm_rec.get("source_root_x") if sm_rec else None,
                            "source_crop_xyxy": sm_rec.get("crop_xyxy") if sm_rec else None,
                            "west_mirrored_bbox": [31 - bx1, by0, 31 - bx0, by1] if facing == "east" else None,
                        }
                        frame_metrics.append(frec)
                        cd_metrics.append(frec)
                        masks_by_key[(cname, facing, idx)] = op
                        ordered_frames.append((cname, facing, fentry, im))

                    metrics_by_clip_dir[(cname, facing)] = cd_metrics

            # Airborne vs grounded semantic rules
            for cname in CLIP_ORDER:
                for facing in AUTHORED_FACINGS:
                    cd = metrics_by_clip_dir.get((cname, facing)) or []
                    if not cd:
                        continue
                    clrs = [f["clearance_px"] for f in cd]
                    if is_flyer:
                        if cname in ("idle", "move", "attack") and any(c <= 0 for c in clrs):
                            add_exc("error", "flyer_grounded_in_flight", mob_id, f"{cname}/{facing}", f"Airborne mob touches ground during {cname}/{facing} (clearances={clrs})")
                        if cname == "death":
                            if clrs[-1] != 0:
                                add_exc("error", "flyer_death_not_grounded", mob_id, f"death/{facing}", f"Final death frame clearance={clrs[-1]} != 0 (must finish on row {ay})")
                            if clrs != sorted(clrs, reverse=True):
                                add_exc("warn", "flyer_death_non_monotonic_descent", mob_id, f"death/{facing}", f"Flyer death clearances {clrs} do not descend monotonically")
                    else:
                        if cname in ("idle", "death") and any(c != 0 for c in clrs):
                            add_exc("error", "grounded_mob_floating", mob_id, f"{cname}/{facing}", f"Grounded mob leaves ground during {cname}/{facing} (clearances={clrs})")

            # Clip-level horizontal pivot drift, move symmetry, and south-vs-east death orientation
            clip_stability: dict[str, dict] = {}
            for cname in CLIP_ORDER:
                for facing in AUTHORED_FACINGS:
                    cd = metrics_by_clip_dir.get((cname, facing)) or []
                    if not cd:
                        continue
                    hxs = [f["head_cx"] for f in cd]
                    cxs = [f["com_xy"][0] for f in cd]
                    hs = [f["native_size"][1] for f in cd]
                    areas = [f["area_px"] for f in cd]
                    hx_span = round(max(hxs) - min(hxs), 2)
                    cx_span = round(max(cxs) - min(cxs), 2)

                    # For flyers, wings lift above the head so CoM X is the clean horizontal axis;
                    # for grounded mobs, check both head_cx and com_x.
                    outlier_head = max(cd, key=lambda f: abs(f["head_minus_anchor_x"]))
                    outlier_com = max(cd, key=lambda f: abs(f["com_minus_anchor_x"]))
                    clip_stability[f"{cname}/{facing}"] = {
                        "heights": hs,
                        "areas": areas,
                        "clearances": [f["clearance_px"] for f in cd],
                        "head_x_span_px": hx_span,
                        "com_x_span_px": cx_span,
                        "head_outlier": outlier_head["filename"],
                        "com_outlier": outlier_com["filename"],
                    }

                    if cname != "death":
                        if is_flyer:
                            if cx_span > 2.8:
                                proposal = None
                                if outlier_com["source_root_x"] is not None and source_scale:
                                    shift = int(round(outlier_com["com_minus_anchor_x"] / source_scale))
                                    proposal = {"frame": outlier_com["filename"], "current_source_root_x": outlier_com["source_root_x"], "suggested_source_root_x": outlier_com["source_root_x"] + shift}
                                add_exc(
                                    "warn",
                                    "clip_pivot_drift",
                                    mob_id,
                                    f"{cname}/{facing} ({outlier_com['filename']})",
                                    f"Body CoM X drifts {cx_span:.2f}px across {cname}/{facing} (outlier {outlier_com['filename']}: com_x={outlier_com['com_xy'][0]} vs anchor_x={ax}, dX={outlier_com['com_minus_anchor_x']:+.2f}px).",
                                    proposal=proposal,
                                )
                        else:
                            if hx_span > 3.8 or cx_span > 2.8:
                                proposal = None
                                if outlier_head["source_root_x"] is not None and source_scale:
                                    # Align outlier back toward clip median com_x / anchor_x
                                    shift = int(round(outlier_head["com_minus_anchor_x"] / source_scale))
                                    proposal = {
                                        "frame": outlier_head["filename"],
                                        "current_source_root_x": outlier_head["source_root_x"],
                                        "suggested_source_root_x": outlier_head["source_root_x"] + shift,
                                    }
                                add_exc(
                                    "warn",
                                    "clip_pivot_drift",
                                    mob_id,
                                    f"{cname}/{facing} ({outlier_head['filename']})",
                                    f"Horizontal drift across {cname}/{facing}: head_x span={hx_span:.2f}px, com_x span={cx_span:.2f}px (outlier {outlier_head['filename']}: head_cx={outlier_head['head_cx']}, com_x={outlier_head['com_xy'][0]} vs anchor_x={ax}).",
                                    proposal=proposal,
                                )

                    # 6-frame move cycle half-stride height symmetry check (load A idx 1 vs load B idx 4)
                    if cname == "move" and len(cd) == 6:
                        dh_load = abs(hs[1] - hs[4])
                        if dh_load >= 3:
                            add_exc(
                                "warn",
                                "move_cycle_asymmetry",
                                mob_id,
                                f"move/{facing}",
                                f"Asymmetric compression between move halves: frame 1 ({cd[1]['beat']}) h={hs[1]}px vs frame 4 ({cd[4]['beat']}) h={hs[4]}px (dH={dh_load}px).",
                            )

                # South vs East death orientation check (require both high IoU and front symmetry loss)
                if cname == "death":
                    ds = metrics_by_clip_dir.get(("death", "south")) or []
                    de = metrics_by_clip_dir.get(("death", "east")) or []
                    is_idle = metrics_by_clip_dir.get(("idle", "south")) or []
                    if ds and len(ds) == len(de):
                        ious = [round(silhouette_iou(masks_by_key[("death", "south", i)], masks_by_key[("death", "east", i)]), 3) for i in range(len(ds))]
                        mean_iou = sum(ious) / len(ious)
                        ds_sym = sum(f["symmetry"] for f in ds) / len(ds)
                        idle_sym = (sum(f["symmetry"] for f in is_idle) / len(is_idle)) if is_idle else ds_sym
                        clip_stability["death/south_vs_east_iou"] = {
                            "per_frame": ious,
                            "mean": round(mean_iou, 3),
                            "death_south_mean_sym": round(ds_sym, 3),
                            "idle_south_mean_sym": round(idle_sym, 3),
                        }
                        if mean_iou >= 0.72 and (ds_sym < 0.70 or (idle_sym - ds_sym) >= 0.15):
                            add_exc(
                                "warn",
                                "south_death_facing_east",
                                mob_id,
                                "death/south (0..3)",
                                f"death_south silhouette closely tracks side-profile death_east (mean IoU={mean_iou:.2f}, per_frame={ious}; front symmetry {idle_sym:.2f} -> {ds_sym:.2f}).",
                            )

            # Outline thickness summary advisory (matching Codex / qa_assets report cleanly)
            ink_share = tot_ink_px / max(1, tot_op_px)
            if thick_frames:
                add_exc(
                    "warn",
                    "outline_thickness_advisory",
                    mob_id,
                    f"{len(thick_frames)}/{len(frame_metrics)} frames",
                    f"2x2 #14101a ink blocks present on {len(thick_frames)}/{len(frame_metrics)} frames (overall ink share {ink_share:.1%}).",
                )

            # Blood Sea terrain contrast evaluation
            palette_breakdown = []
            terrain_contrast: dict[str, dict] = {}
            for tname, (thex, trgb) in BLOOD_SEA_SWATCHES.items():
                w_cr = 0.0
                low_frac = 0.0
                for rgb_t, cnt in color_counts.items():
                    frac = cnt / max(1, tot_op_px)
                    cr = contrast_ratio(rgb_t, trgb)
                    w_cr += frac * cr
                    if cr < 2.0:
                        low_frac += frac
                terrain_contrast[tname] = {
                    "hex": thex,
                    "weighted_mean_cr": round(w_cr, 2),
                    "low_contrast_lt2_frac": round(low_frac, 4),
                }
            for rgb_t, cnt in color_counts.most_common():
                palette_breakdown.append({
                    "hex": "#%02x%02x%02x" % rgb_t,
                    "pixels": int(cnt),
                    "share": round(cnt / max(1, tot_op_px), 4),
                    "luminance": round(rel_luminance(rgb_t), 4),
                })

            stone_dark = terrain_contrast["court_stone_dark"]
            pool_abyss = terrain_contrast["blood_pool_abyss"]
            if stone_dark["weighted_mean_cr"] < 1.75 or stone_dark["low_contrast_lt2_frac"] >= 0.85:
                add_exc(
                    "warn",
                    "blood_sea_terrain_contrast",
                    mob_id,
                    "all 36 frames",
                    f"Low silhouette contrast over Blood Sea terrain: {stone_dark['low_contrast_lt2_frac']*100:.1f}% of pixels have CR<2.0 vs court stone #2c2733 (mean CR={stone_dark['weighted_mean_cr']:.2f}) and {pool_abyss['low_contrast_lt2_frac']*100:.1f}% vs blood pool #2a0a16 (mean CR={pool_abyss['weighted_mean_cr']:.2f}). Relies heavily on accent highlights over dark tiles.",
                )

            # Pack ordered horizontal runtime strip (32x32 tiles) for the interactive HTML viewer
            strip_w = max(1, len(ordered_frames)) * 32
            strip_im = Image.new("RGBA", (strip_w, 32), (0, 0, 0, 0))
            packed_rects: dict[tuple[str, str, int], list[int]] = {}
            for tile_idx, (st, fc, fentry, tile_im) in enumerate(ordered_frames):
                strip_im.paste(tile_im, (tile_idx * 32, 0))
                packed_rects[(st, fc, int(fentry["index"]))] = [tile_idx * 32, 0, 32, 32]
            strip_images[mob_id] = strip_im

            # Assemble explicit 4-direction runtime clips (south, east, west mirror, north reuse)
            assembled_clips: dict[str, dict] = {}
            for cname in CLIP_ORDER:
                cdef = clips_spec.get(cname)
                if not isinstance(cdef, dict):
                    continue
                loop_flag = bool(cdef.get("loop"))
                south_list = (cdef.get("directions") or {}).get("south") or []
                east_list = (cdef.get("directions") or {}).get("east") or []
                if not south_list or not east_list:
                    continue
                durs = default_blood_sea_durations(mob_id, archetype, cname, len(south_list))
                dir_out: dict[str, list[dict]] = {}
                for rdir in RUNTIME_DIRS:
                    if rdir == "west":
                        src_dir, mirror_x, g_px = "east", True, [west_ax, ay]
                        src_list = east_list
                    elif rdir == "north":
                        src_dir, mirror_x, g_px = "south", False, [ax, ay]
                        src_list = south_list
                    else:
                        src_dir, mirror_x, g_px = rdir, False, [ax, ay]
                        src_list = south_list if rdir == "south" else east_list

                    seq = []
                    for i, fentry in enumerate(src_list):
                        idx = int(fentry["index"])
                        fname = Path(fentry["path"]).name
                        seq.append({
                            "index": i,
                            "source_key": f"mobs/{mob_id}/{cname}_{src_dir}_{idx}",
                            "filename": fname,
                            "path": fentry["path"],
                            "sha256": fentry["sha256"],
                            "beat": fentry.get("beat", ""),
                            "clearance_px": int(fentry.get("clearance_px", 0)),
                            "source_facing": src_dir,
                            "mirror_x": mirror_x,
                            "sheet_rect": packed_rects[(cname, src_dir, idx)],
                            "ground_px": g_px,
                            "duration_ms": durs[i] if i < len(durs) else 120,
                            "active_contact": (cname == "attack" and idx == (2 if len(src_list) == 4 else 3)),
                        })
                    dir_out[rdir] = seq

                assembled_clips[cname] = {
                    "mode": "loop" if loop_flag else "oneshot",
                    "loop": loop_flag,
                    "frames_per_direction": len(south_list),
                    "total_duration_ms": sum(durs),
                    "active_contact_index": (2 if len(south_list) == 4 else 3) if cname == "attack" else None,
                    "coverage_status": "complete_manifest_frames",
                    "directions": dir_out,
                }

            mob_reports[mob_id] = {
                "id": mob_id,
                "name": aspec.get("name") or (m_asset or {}).get("name", {}).get("en") or mob_id,
                "biome": (m_asset or {}).get("biome", "blood_sea"),
                "archetype": archetype,
                "airborne_hover": is_flyer,
                "gameplay_root_fixed": True,
                "canvas": canvas,
                "anchor_px": [ax, ay],
                "west_mirrored_anchor_px": [west_ax, ay],
                "source_scale": source_scale,
                "source_sha256_verified": source_sha_ok,
                "source_crop_overlaps": source_overlaps,
                "total_frames": len(frame_metrics),
                "hygiene": {
                    "partial_alpha_px": tot_partial,
                    "dirty_transparent_px": tot_dirty0,
                    "off_global_palette_px": tot_off_global,
                    "off_mob_palette_px": tot_off_mob,
                    "opaque_px": tot_op_px,
                    "ink_outline_share": round(ink_share, 4),
                    "thick_outline_frames": len(thick_frames),
                },
                "palette_breakdown": palette_breakdown,
                "terrain_contrast": terrain_contrast,
                "clip_stability": clip_stability,
                "frames": frame_metrics,
                "assembly": {
                    "tier": f"full_runtime_{len(frame_metrics)}f",
                    "anchor_px_direct": [ax, ay],
                    "anchor_px_west_mirrored": [west_ax, ay],
                    "direction_rules": {
                        "south": "authored",
                        "east": "authored",
                        "west": f"mirror_x(east), anchor=[{west_ax},{ay}] (31-{ax})",
                        "north": "reuse(south)",
                    },
                    "clips": assembled_clips,
                },
            }

        repo_compat = (
            _check_repo_pipeline_compat(pkg_root, list(mob_reports.keys()), manifest_path, palette_path)
            if run_repo_compat
            else {"checked": False}
        )
        if repo_compat.get("checked"):
            if repo_compat["qa_assets_rc"] != 0:
                add_exc("error", "repo_qa_assets_failed", "package", "qa_assets.py", f"qa_assets.py exited {repo_compat['qa_assets_rc']}: {repo_compat.get('qa_assets_summary')}")
            if repo_compat["pack_atlases_rc"] != 0:
                add_exc("error", "repo_pack_atlases_failed", "package", "pack_atlases.py", f"pack_atlases.py exited {repo_compat['pack_atlases_rc']}: {repo_compat.get('pack_atlases_summary')}")

        sev_counts = Counter(e["severity"] for e in exceptions)
        report = {
            "schema": "tien-nghich-2d.blood-sea-mob-assembly-qa",
            "version": 1,
            "source_package": str(source_path),
            "archive_sha256": archive_sha256,
            "assembly_json_verification": {
                "present": True,
                "path": "assembly.json",
                "assets_verified": len(mob_reports),
                "directional_clips_verified": total_dir_clips,
                "frames_sha256_verified": total_sha_ok,
                "frames_sha256_failed": total_sha_failed,
                "facing_rules_ok": facing_rules_ok,
            },
            "summary": {
                "mobs_checked": len(mob_reports),
                "mob_ids": list(mob_reports.keys()),
                "total_frames": sum(m["total_frames"] for m in mob_reports.values()),
                "directional_clips": total_dir_clips,
                "errors": sev_counts.get("error", 0),
                "warnings": sev_counts.get("warn", 0),
                "info": sev_counts.get("info", 0),
            },
            "repo_pipeline_compat": repo_compat,
            "mobs": mob_reports,
            "exceptions": exceptions,
        }
        return report, strip_images
    finally:
        if tmp_ctx is not None:
            tmp_ctx.cleanup()


def _checker_bg(w: int, h: int, step: int = 8) -> Image.Image:
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    ys = (np.arange(h) // step)[:, None]
    xs = (np.arange(w) // step)[None, :]
    dark = ((ys + xs) % 2) == 0
    arr[dark] = (34, 30, 42, 255)
    arr[~dark] = (46, 41, 56, 255)
    return Image.fromarray(arr, "RGBA")


def _blood_sea_tile_bg(w: int, h: int, kind: str) -> Image.Image:
    im = Image.new("RGBA", (w, h), (44, 39, 51, 255))
    d = ImageDraw.Draw(im)
    if kind == "stone":
        c1, c2, crack = (44, 39, 51, 255), (73, 67, 79, 255), (20, 16, 26, 255)
    elif kind == "pool":
        c1, c2, crack = (42, 10, 22, 255), (79, 15, 34, 255), (20, 16, 26, 255)
    else:
        c1, c2, crack = (110, 104, 119, 255), (140, 134, 148, 255), (73, 67, 79, 255)
    step = 16
    for y in range(0, h, step):
        for x in range(0, w, step):
            fill = c1 if ((x // step + y // step) % 2 == 0) else c2
            d.rectangle([x, y, x + step - 1, y + step - 1], fill=fill, outline=crack)
    return im


def build_contact_sheet(report: dict, strip_images: dict[str, Image.Image], out_path: Path) -> None:
    """Build annotated 3x + 1x contact sheet for Blood Sea mobs + Blood Sea terrain contrast strip."""
    mobs = list(report["mobs"].values())
    if not mobs:
        return

    pad = 12
    title_h = 46
    zoom = 3
    mag_sz = 32 * zoom
    nat_sz = 32
    col_w = mag_sz + nat_sz + 10
    row_h = mag_sz + 28
    sections: list[Image.Image] = []

    for mrep in mobs:
        mob_id = mrep["id"]
        strip = strip_images[mob_id]
        ax, ay = mrep["anchor_px"]
        wax, _ = mrep["west_mirrored_anchor_px"]
        fmetrics = {f["filename"]: f for f in mrep["frames"]}
        clips = mrep["assembly"]["clips"]

        rows_spec = []
        for cname in CLIP_ORDER:
            if cname not in clips:
                continue
            for dlabel, dkey in ((f"{cname} · south", "south"), (f"{cname} · east", "east"), (f"{cname} · west(flip)", "west")):
                rows_spec.append((dlabel, cname, dkey))

        max_cols = max(len(clips[c]["directions"]["south"]) for c in CLIP_ORDER if c in clips)
        sec_w = pad * 2 + 138 + max_cols * col_w
        terrain_band_h = 74
        sec_h = 42 + len(rows_spec) * row_h + terrain_band_h + pad
        sec = Image.new("RGBA", (sec_w, sec_h), (20, 17, 26, 255))
        draw = ImageDraw.Draw(sec)

        hyg = mrep["hygiene"]
        tc = mrep["terrain_contrast"]["court_stone_dark"]
        mode_tag = "AIRBORNE FLYER" if mrep["airborne_hover"] else "GROUNDED / POUNCE"
        hdr = (
            f"{mob_id} ({mrep['name']})  |  {mrep['total_frames']}f · {mode_tag}  |  "
            f"anchor={mrep['anchor_px']} west={mrep['west_mirrored_anchor_px']}  |  "
            f"ink={hyg['ink_outline_share']*100:.1f}%  stone_CR={tc['weighted_mean_cr']:.2f} (<2.0: {tc['low_contrast_lt2_frac']*100:.0f}%)"
        )
        draw.text((pad, 8), hdr, fill=(242, 233, 214, 255))
        draw.text(
            (pad, 23),
            "3x magnified + 1x native | Cyan+=fixed root, Gold=y=31 ground, Teal bar=clearance_px above root, Red=edge touch",
            fill=(160, 156, 172, 255),
        )

        for r_idx, (dlabel, cname, dkey) in enumerate(rows_spec):
            oy = 42 + r_idx * row_h
            frames = clips[cname]["directions"][dkey]
            cur_ax = wax if dkey == "west" else ax
            draw.text((pad, oy + 36), dlabel, fill=(212, 208, 226, 255))
            draw.text((pad, oy + 52), f"piv=[{cur_ax},{ay}]", fill=(138, 232, 255, 255))

            for c_idx, fr in enumerate(frames):
                ox = pad + 138 + c_idx * col_w
                sx, sy, sw, sh = fr["sheet_rect"]
                tile = strip.crop((sx, sy, sx + sw, sy + sh))
                if fr["mirror_x"]:
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

                bg = _checker_bg(mag_sz, mag_sz, 8)
                dm = ImageDraw.Draw(bg)
                clr = int(fr["clearance_px"])
                scx, scy = (cur_ax + 0.5) * zoom, (ay - 0.5) * zoom
                sh_rx = max(4.5, 9.0 - clr * 0.6) * zoom
                sh_ry = max(1.4, 2.5 - clr * 0.15) * zoom
                sh_a = max(65, 155 - clr * 15)
                dm.ellipse([scx - sh_rx, scy - sh_ry, scx + sh_rx, scy + sh_ry], fill=(16, 13, 22, sh_a))
                bg.alpha_composite(tile.resize((mag_sz, mag_sz), Image.Resampling.NEAREST), (0, 0))
                dm = ImageDraw.Draw(bg)
                dm.line([(0, mag_sz - 1), (mag_sz - 1, mag_sz - 1)], fill=(224, 176, 48, 210), width=1)
                px_c, py_c = int((cur_ax + 0.5) * zoom), int((ay + 0.5) * zoom)
                if clr > 0:
                    bot_y = int((ay - clr + 1) * zoom)
                    dm.line([(px_c, bot_y), (px_c, py_c)], fill=(92, 199, 150, 230), width=1)
                dm.line([(px_c - 6, py_c), (px_c + 6, py_c)], fill=(138, 232, 255, 255), width=1)
                dm.line([(px_c, py_c - 6), (px_c, py_c + 6)], fill=(138, 232, 255, 255), width=1)

                fm = fmetrics.get(fr["filename"], {})
                touches = list(fm.get("edge_touches") or [])
                if fr["mirror_x"]:
                    touches = ["left" if t == "right" else "right" if t == "left" else t for t in touches]
                if "left" in touches:
                    dm.rectangle([0, 0, 2, mag_sz - 1], fill=(255, 59, 48, 255))
                if "right" in touches:
                    dm.rectangle([mag_sz - 3, 0, mag_sz - 1, mag_sz - 1], fill=(255, 59, 48, 255))
                if "top" in touches:
                    dm.rectangle([0, 0, mag_sz - 1, 2], fill=(255, 59, 48, 255))

                sec.alpha_composite(bg, (ox, oy + 14))

                bg1 = _checker_bg(nat_sz, nat_sz, 4)
                bg1.alpha_composite(tile, (0, 0))
                sec.alpha_composite(bg1, (ox + mag_sz + 3, oy + 14 + (mag_sz - nat_sz) // 2))

                flags = []
                if clr > 0:
                    flags.append(f"c{clr}")
                if fr.get("active_contact"):
                    flags.append("HIT")
                if not fr["mirror_x"] and not mrep["airborne_hover"] and abs(fm.get("head_minus_anchor_x", 0)) > 3.2 and cname != "death":
                    flags.append(f"dX{fm['head_minus_anchor_x']:+.1f}")
                if touches:
                    flags.append("EDGE")
                col_txt = (245, 215, 101, 255) if any(k.startswith("dX") or k == "EDGE" for k in flags) else (154, 227, 184, 255) if "HIT" in flags else (196, 192, 210, 255)
                ftxt = f"[{c_idx}] {fr['duration_ms']}ms" + (f" {' '.join(flags)}" if flags else "")
                draw.text((ox, oy + 1), ftxt, fill=col_txt)

        # Blood Sea 1x + 2x Terrain Readability Comparison Strip at bottom of each mob section
        ty = 42 + len(rows_spec) * row_h + 6
        draw.text((pad, ty), "1x / 2x Blood Sea Terrain Check (idle_S, attack_S_2, idle_E, attack_E_2):", fill=(238, 122, 128, 255))
        sample_frames = [
            clips["idle"]["directions"]["south"][0],
            clips["attack"]["directions"]["south"][min(2, len(clips["attack"]["directions"]["south"]) - 1)],
            clips["idle"]["directions"]["east"][0],
            clips["attack"]["directions"]["east"][min(2, len(clips["attack"]["directions"]["east"]) - 1)],
        ]
        bx = pad
        for label, bg_kind in (("Court Stone (#2c2733/#49434f)", "stone"), ("Blood Pool (#2a0a16/#4f0f22)", "pool"), ("Light Slate (#6e6877)", "slate")):
            band_w = 270
            band = _blood_sea_tile_bg(band_w, 48, bg_kind)
            bd = ImageDraw.Draw(band)
            bd.text((6, 2), label, fill=(230, 225, 236, 255))
            tx_cur = 8
            for sfr in sample_frames:
                sx, sy, sw, sh = sfr["sheet_rect"]
                t1 = strip.crop((sx, sy, sx + sw, sy + sh))
                band.alpha_composite(t1, (tx_cur, 15))
                tx_cur += 36
            # Also 1x side-by-side 2x preview of strike
            sx, sy, sw, sh = sample_frames[1]["sheet_rect"]
            t2 = strip.crop((sx, sy, sx + sw, sy + sh)).resize((40, 40), Image.Resampling.NEAREST)
            band.alpha_composite(t2, (band_w - 46, 6))
            sec.alpha_composite(band, (bx, ty + 16))
            bx += band_w + 12

        sections.append(sec)

    total_w = max(s.width for s in sections)
    total_h = title_h + sum(s.height + 10 for s in sections)
    sheet = Image.new("RGBA", (total_w, total_h), (14, 12, 20, 255))
    dtop = ImageDraw.Draw(sheet)
    s = report["summary"]
    sha_short = (report.get("archive_sha256") or "")[:12]
    dtop.text(
        (pad, 8),
        f"TIEN NGHICH 2D · BLOOD SEA MOBS INDEPENDENT QA SHEET  |  mobs={s['mobs_checked']} frames={s['total_frames']} clips={s['directional_clips']} errors={s['errors']} warnings={s['warnings']} sha={sha_short}",
        fill=(255, 240, 176, 255),
    )
    dtop.text(
        (pad, 25),
        "Assembled strictly from Codex verified 32x32 PNGs (no generated pixels). West=mirror(East) pivot [15,31]; North=reuse(South) pivot [16,31].",
        fill=(157, 152, 164, 255),
    )
    y_cur = title_h
    for sec in sections:
        sheet.alpha_composite(sec, (0, y_cur))
        y_cur += sec.height + 10
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out_path)


def _img_to_data_uri(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_html_workbench(report: dict, strip_images: dict[str, Image.Image], out_path: Path) -> None:
    """Generate self-contained interactive dual-scale Blood Sea Mob Animation QA Workbench."""
    art_uris = {mid: _img_to_data_uri(im) for mid, im in strip_images.items()}
    payload_json = script_json({"report": report, "sheets": art_uris})
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Blood Sea Mobs · Independent Animation Assembly &amp; Terrain QA</title>
<style>
  :root {{
    --bg: #110d14; --card: #1a141f; --line: #392738; --fg: #f1e9ee;
    --muted: #a997a8; --accent: #8ae8ff; --ok: #5cc796; --warn: #f5d765; --err: #ff6b63;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }}
  header {{ padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; background: #191019; }}
  header h1 {{ margin: 0; font-size: 16px; }}
  .chips {{ display: flex; gap: 8px; flex-wrap: wrap; }}
  .chip {{ padding: 3px 9px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid var(--line); white-space: nowrap; }}
  .chip.ok {{ background: rgba(92,199,150,.15); color: var(--ok); border-color: rgba(92,199,150,.45); }}
  .chip.warn {{ background: rgba(245,215,101,.14); color: var(--warn); border-color: rgba(245,215,101,.45); }}
  .chip.err {{ background: rgba(255,107,99,.16); color: var(--err); border-color: rgba(255,107,99,.45); }}
  main {{ padding: 16px 18px 28px; display: grid; gap: 16px; max-width: 1380px; margin: 0 auto; }}
  .grid2 {{ display: grid; grid-template-columns: minmax(400px, 1.35fr) minmax(320px, 1fr); gap: 16px; align-items: start; }}
  @media (max-width: 960px) {{ .grid2 {{ grid-template-columns: 1fr; }} }}
  .panel {{ background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }}
  .panel h2 {{ margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }}
  .toolbar {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }}
  select, button {{ background: #261b2a; color: var(--fg); border: 1px solid var(--line); border-radius: 5px; padding: 5px 9px; font: inherit; cursor: pointer; }}
  button.primary {{ background: #224658; border-color: #3f7e9c; color: #e8fdff; }}
  button.strike {{ background: #5a1f2d; border-color: #a51d35; color: #ffd9dd; }}
  button.death {{ background: #3b234d; border-color: #6a3fa8; color: #e3d6fb; }}
  label.tog {{ display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }}
  .stage-wrap {{ display: flex; flex-wrap: wrap; gap: 18px; align-items: center; justify-content: center; background: #140f17; border: 1px solid var(--line); border-radius: 6px; padding: 14px; }}
  .stage-box {{ text-align: center; }}
  .stage-box canvas {{ image-rendering: pixelated; border: 1px solid #483247; display: block; margin: 0 auto; }}
  .cap {{ margin-top: 6px; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }}
  .turntable {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }}
  @media (max-width: 680px) {{ .turntable {{ grid-template-columns: repeat(2, 1fr); }} }}
  .tt-cell {{ background: #140f17; border: 1px solid var(--line); border-radius: 6px; padding: 8px; text-align: center; }}
  .tt-cell canvas {{ image-rendering: pixelated; display: block; margin: 0 auto; }}
  .timeline {{ display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }}
  .tl-step {{ padding: 4px 8px; border-radius: 5px; border: 1px solid var(--line); background: #221828; font-size: 11px; font-family: ui-monospace, monospace; cursor: pointer; }}
  .tl-step.active {{ border-color: var(--accent); background: rgba(138,232,255,.16); color: #e8fdff; }}
  .tl-step.hit {{ border-color: #d03a4a; }}
  .kv {{ display: grid; grid-template-columns: 150px 1fr; gap: 4px 10px; font-size: 12px; }}
  .kv span {{ color: var(--muted); }}
  .kv code {{ font-family: ui-monospace, monospace; color: var(--accent); word-break: break-word; }}
  .swatches {{ display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; }}
  .sw-card {{ display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: #151019; font-size: 11px; font-family: ui-monospace, monospace; }}
  .sw-box {{ width: 18px; height: 18px; border-radius: 3px; border: 1px solid rgba(255,255,255,.22); flex-shrink: 0; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }}
  th {{ color: var(--muted); }}
  .sev-error {{ color: var(--err); font-weight: 700; }}
  .sev-warn {{ color: var(--warn); font-weight: 700; }}
  .sev-info {{ color: var(--accent); font-weight: 700; }}
  .mono {{ font-family: ui-monospace, monospace; font-size: 11px; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Blood Sea Mobs · Independent Animation Assembly &amp; Terrain QA</h1>
    <div style="color:var(--muted);font-size:12px;">Assembled strictly from Codex verified 32×32 PNGs (zero generated pixels) · Native 1× + Magnified · Fixed Root + Airborne/Pounce Clearance + Terrain Contrast</div>
  </div>
  <div id="chips" class="chips"></div>
</header>
<main>
  <section class="grid2">
    <div class="panel">
      <h2>Live Dual-Scale Playback &amp; Blood Sea Terrain Check</h2>
      <div class="toolbar">
        <select id="sel-mob"></select>
        <select id="sel-clip"></select>
        <select id="sel-dir">
          <option value="south">south (authored)</option>
          <option value="east">east (authored)</option>
          <option value="west">west (mirror E · x=15)</option>
          <option value="north">north (reuses S)</option>
        </select>
        <select id="sel-bg" title="Terrain backdrop">
          <option value="stone" selected>Blood Sea Stone (#2c2733/#49434f)</option>
          <option value="pool">Blood Pool (#2a0a16/#4f0f22)</option>
          <option value="checker">Alpha Checker</option>
          <option value="slate">Light Slate (#6e6877)</option>
        </select>
        <select id="sel-zoom">
          <option value="4">4×</option>
          <option value="6" selected>6×</option>
          <option value="8">8×</option>
        </select>
        <select id="sel-speed">
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="1.5">1.5×</option>
        </select>
      </div>
      <div class="toolbar">
        <button id="btn-play" class="primary">Pause</button>
        <button id="btn-prev">◀ Step</button>
        <button id="btn-next">Step ▶</button>
        <button id="btn-attack" class="strike">Trigger Attack</button>
        <button id="btn-death" class="death">Trigger Death</button>
        <label class="tog"><input id="chk-loop-oneshot" type="checkbox" /> Loop One-Shot</label>
        <label class="tog"><input id="chk-pivot" type="checkbox" checked /> Root &amp; Clearance</label>
        <label class="tog"><input id="chk-shadow" type="checkbox" checked /> Ground Shadow</label>
        <label class="tog"><input id="chk-onion" type="checkbox" checked /> Onion Skin</label>
        <label class="tog"><input id="chk-grid" type="checkbox" /> Pixel Grid</label>
      </div>
      <div class="stage-wrap">
        <div class="stage-box">
          <canvas id="cv-mag" width="224" height="224"></canvas>
          <div id="cap-mag" class="cap"></div>
        </div>
        <div class="stage-box">
          <canvas id="cv-nat" width="64" height="64"></canvas>
          <div class="cap">Native 1× (32×32 on terrain)</div>
        </div>
      </div>
      <div id="timeline" class="timeline"></div>
      <h2 style="margin-top:14px;">All 4 Runtime Directions In Sync (3×)</h2>
      <div class="turntable">
        <div class="tt-cell"><canvas id="tt-south" width="96" height="96"></canvas><div class="cap">south (authored)</div></div>
        <div class="tt-cell"><canvas id="tt-east" width="96" height="96"></canvas><div class="cap">east (authored)</div></div>
        <div class="tt-cell"><canvas id="tt-west" width="96" height="96"></canvas><div class="cap">west (flip E · piv 15)</div></div>
        <div class="tt-cell"><canvas id="tt-north" width="96" height="96"></canvas><div class="cap">north (reuses S)</div></div>
      </div>
    </div>

    <div class="panel">
      <h2>Active Frame, Clearance &amp; Registration Contract</h2>
      <div id="frame-kv" class="kv"></div>
      <h2 style="margin-top:14px;">Blood Sea Terrain Contrast Telemetry</h2>
      <div id="terrain-swatches" class="swatches"></div>
      <h2 style="margin-top:14px;">Clip Timing &amp; Coverage</h2>
      <table>
        <thead><tr><th>Clip</th><th>Mode</th><th>Frames</th><th>Total ms</th></tr></thead>
        <tbody id="cov-body"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Independent QA Findings &amp; Proposed Corrections</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Sev</th><th>Mob</th><th>Target</th><th>Code</th><th>Detail</th><th>Proposed Correction</th></tr></thead>
        <tbody id="exc-body"></tbody>
      </table>
    </div>
  </section>
</main>
<script type="application/json" id="qa-data">{payload_json}</script>
<script>
{MARKUP_JS}
const DATA = JSON.parse(document.getElementById("qa-data").textContent);
const REPORT = DATA.report;
const SHEETS = DATA.sheets;
const imgs = {{}};
const $ = (id) => document.getElementById(id);

let mobId = REPORT.summary.mob_ids[0];
let clipName = 'attack';
let dir = 'south';
let frameIdx = 0;
let playing = true;
let elapsed = 0;
let oneshotDone = false;

function loadImg(uri) {{
  return new Promise((res, rej) => {{ const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = uri; }});
}}

function drawBackdrop(ctx, x0, y0, w, h, step, bgMode) {{
  let c1 = '#231e2e', c2 = '#1b1724', line = null;
  if (bgMode === 'stone') {{ c1 = '#2c2733'; c2 = '#49434f'; line = '#14101a'; }}
  else if (bgMode === 'pool') {{ c1 = '#2a0a16'; c2 = '#4f0f22'; line = '#14101a'; }}
  else if (bgMode === 'slate') {{ c1 = '#6e6877'; c2 = '#878091'; line = '#49434f'; }}
  for (let y = 0; y < h; y += step) {{
    for (let x = 0; x < w; x += step) {{
      ctx.fillStyle = (((x / step) + (y / step)) & 1) ? c2 : c1;
      const rw = Math.min(step, w - x), rh = Math.min(step, h - y);
      ctx.fillRect(x0 + x, y0 + y, rw, rh);
      if (line) {{
        ctx.strokeStyle = line;
        ctx.strokeRect(x0 + x + 0.5, y0 + y + 0.5, rw - 1, rh - 1);
      }}
    }}
  }}
}}

function getClip() {{
  return REPORT.mobs[mobId].assembly.clips[clipName];
}}

function getFrames(d = dir) {{
  const c = getClip();
  return (c && c.directions && c.directions[d]) || [];
}}

function updateClipOptions() {{
  const mob = REPORT.mobs[mobId];
  const entries = Object.entries(mob.assembly.clips);
  if (!entries.some(([k]) => k === clipName)) clipName = entries[0]?.[0] || 'idle';
  $('sel-clip').innerHTML = entries.map(([k, c]) => markup`<option value="${{k}}" ${{k===clipName?'selected':''}}>${{k}} (${{c.mode}} · ${{c.frames_per_direction}}f · ${{c.total_duration_ms}}ms)</option>`).join('');
}}

function renderSpriteOn(ctx, mob, fr, cx, cy, z, alpha = 1.0) {{
  const img = imgs[mob.id];
  if (!img || !fr) return;
  const [sx, sy, sw, sh] = fr.sheet_rect;
  const [gx, gy] = fr.ground_px;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  if (fr.mirror_x) {{
    const tileLeft = cx - gx * z;
    const tileTop = cy - gy * z;
    ctx.translate(tileLeft + sw * z, tileTop);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * z, sh * z);
  }} else {{
    ctx.drawImage(img, sx, sy, sw, sh, cx - gx * z, cy - gy * z, sw * z, sh * z);
  }}
  ctx.restore();
}}

function drawShadow(ctx, cx, cy, z, clr) {{
  const rx = Math.max(4.5, 9.0 - clr * 0.55) * z;
  const ry = Math.max(1.3, 2.5 - clr * 0.14) * z;
  const alpha = Math.max(0.28, 0.72 - clr * 0.07);
  ctx.fillStyle = `rgba(10,6,14,${{alpha.toFixed(2)}})`;
  ctx.beginPath();
  ctx.ellipse(cx + z * 0.5, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}}

function drawStage() {{
  const mob = REPORT.mobs[mobId];
  const clip = getClip();
  const frames = getFrames(dir);
  if (!mob || !frames.length) return;
  const idx = frameIdx % frames.length;
  const fr = frames[idx];
  const prevFr = frames[(idx - 1 + frames.length) % frames.length];
  const z = Number($('sel-zoom').value);
  const bgMode = $('sel-bg').value;
  const pad = 16;
  const mw = 32 * z + pad * 2;
  const mh = 32 * z + pad * 2;

  const cv = $('cv-mag');
  if (cv.width !== mw || cv.height !== mh) {{ cv.width = mw; cv.height = mh; }}
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#140f17';
  ctx.fillRect(0, 0, mw, mh);
  drawBackdrop(ctx, pad, pad, 32 * z, 32 * z, bgMode === 'checker' ? Math.max(4, z * 2) : z * 16, bgMode);

  const gx = fr.ground_px[0], gy = fr.ground_px[1];
  const px = pad + gx * z, py = pad + gy * z;

  if ($('chk-shadow').checked) drawShadow(ctx, px, py, z, fr.clearance_px);
  if ($('chk-onion').checked && prevFr !== fr) renderSpriteOn(ctx, mob, prevFr, px, py, z, 0.28);
  renderSpriteOn(ctx, mob, fr, px, py, z, 1.0);

  if ($('chk-grid').checked && z >= 4) {{
    ctx.strokeStyle = 'rgba(212,208,216,0.12)';
    for (let i = 0; i <= 32; i++) {{
      ctx.beginPath(); ctx.moveTo(pad + i * z + 0.5, pad); ctx.lineTo(pad + i * z + 0.5, pad + 32 * z); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad, pad + i * z + 0.5); ctx.lineTo(pad + 32 * z, pad + i * z + 0.5); ctx.stroke();
    }}
  }}
  if ($('chk-pivot').checked) {{
    ctx.strokeStyle = 'rgba(224,176,48,0.68)';
    ctx.beginPath(); ctx.moveTo(pad, pad + 32 * z - 0.5); ctx.lineTo(pad + 32 * z, pad + 32 * z - 0.5); ctx.stroke();
    if (fr.clearance_px > 0) {{
      ctx.strokeStyle = '#5cc796';
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(px + z * 0.5, pad + (32 - fr.clearance_px) * z);
      ctx.lineTo(px + z * 0.5, py + z * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }}
    ctx.strokeStyle = '#8ae8ff';
    ctx.beginPath();
    ctx.moveTo(px + z * 0.5 - 9, py + z * 0.5); ctx.lineTo(px + z * 0.5 + 9, py + z * 0.5);
    ctx.moveTo(px + z * 0.5, py + z * 0.5 - 9); ctx.lineTo(px + z * 0.5, py + z * 0.5 + 9);
    ctx.stroke();
  }}
  $('cap-mag').textContent = `${{mob.id}} · ${{clipName}}[${{idx}}/${{frames.length - 1}}] · ${{dir}} · ${{fr.beat}} · clr=${{fr.clearance_px}}px (${{fr.duration_ms}}ms) @ ${{z}}×`;

  const ncv = $('cv-nat');
  const nctx = ncv.getContext('2d');
  nctx.imageSmoothingEnabled = false;
  drawBackdrop(nctx, 0, 0, 64, 64, 16, bgMode);
  if ($('chk-shadow').checked) drawShadow(nctx, 32, 48, 1, fr.clearance_px);
  renderSpriteOn(nctx, mob, fr, 32, 48, 1, 1.0);

  for (const td of ['south', 'east', 'west', 'north']) {{
    const tcv = $('tt-' + td);
    const tctx = tcv.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    drawBackdrop(tctx, 0, 0, 96, 96, bgMode === 'checker' ? 8 : 48, bgMode);
    const tframes = getFrames(td);
    const tfr = tframes[idx % tframes.length];
    if (tfr) {{
      const tx = tfr.ground_px[0] * 3, ty = tfr.ground_px[1] * 3;
      if ($('chk-shadow').checked) drawShadow(tctx, tx, ty, 3, tfr.clearance_px);
      renderSpriteOn(tctx, mob, tfr, tx, ty, 3, 1.0);
      if ($('chk-pivot').checked) {{
        tctx.strokeStyle = '#8ae8ff';
        tctx.beginPath(); tctx.moveTo(tx - 5, ty + 1.5); tctx.lineTo(tx + 8, ty + 1.5); tctx.stroke();
      }}
    }}
  }}

  $('timeline').innerHTML = frames.map((f, i) => markup`
    <span class="tl-step ${{i===idx?'active':''}} ${{f.active_contact?'hit':''}}" data-idx="${{i}}">${{i}}: ${{f.beat}} (${{f.duration_ms}}ms · c${{f.clearance_px}})${{f.active_contact?' [HIT]':''}}</span>
  `).join('');
  document.querySelectorAll('.tl-step').forEach(el => {{
    el.onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; frameIdx = Number(el.dataset.idx); drawStage(); }};
  }});

  const hyg = mob.hygiene;
  $('frame-kv').innerHTML = markup`
    <span>Mob / Archetype</span><code>${{mob.id}} (${{mob.archetype}}${{mob.airborne_hover ? ' · airborne' : ' · grounded'}})</code>
    <span>Contract Key</span><code>${{fr.source_key}}</code>
    <span>Frame / SHA-256</span><code>${{fr.filename}} · ${{fr.sha256.slice(0,12)}}…</code>
    <span>Beat / Timing</span><code>${{fr.beat}} · ${{fr.duration_ms}}ms${{fr.active_contact ? ' [ACTIVE CONTACT]' : ''}}</code>
    <span>Fixed Root / Clr</span><code>[${{fr.ground_px.join(', ')}}] · clearance=${{fr.clearance_px}}px${{fr.mirror_x ? ' (west flip 31−' + mob.anchor_px[0] + ')' : ''}}</code>
    <span>Transform</span><code>${{fr.mirror_x ? 'mirror_x(east)' : (dir==='north' ? 'reuse(south)' : 'direct')}}</code>
    <span>Pixel Hygiene</span><code>alpha=0/255, dirty0=${{hyg.dirty_transparent_px}}, offPal=${{hyg.off_global_palette_px}}, ink=${{(hyg.ink_outline_share*100).toFixed(1)}}% (${{hyg.thick_outline_frames}}f thick)</code>
  `;

  $('terrain-swatches').innerHTML = Object.entries(mob.terrain_contrast).map(([name, t]) => markup`
    <div class="sw-card">
      <div class="sw-box" style="background:${{t.hex}}"></div>
      <div>
        <div>${{name}} (${{t.hex}})</div>
        <div style="color:${{t.weighted_mean_cr < 1.75 ? 'var(--warn)' : 'var(--ok)'}}">CR ${{t.weighted_mean_cr}} · &lt;2.0: ${{(t.low_contrast_lt2_frac*100).toFixed(0)}}%</div>
      </div>
    </div>
  `).join('');

  $('cov-body').innerHTML = Object.entries(mob.assembly.clips).map(([cname, cdef]) => markup`
    <tr>
      <td class="mono">${{cname}}</td>
      <td>${{cdef.mode}}</td>
      <td class="mono">${{cdef.frames_per_direction}}f × 4 dirs</td>
      <td class="mono">${{cdef.total_duration_ms}} ms</td>
    </tr>
  `).join('');
}}

function renderHeaderAndTable() {{
  const s = REPORT.summary;
  const rc = REPORT.repo_pipeline_compat || {{}};
  const aj = REPORT.assembly_json_verification || {{}};
  $('chips').innerHTML = `
    ${{REPORT.archive_sha256 ? `<span class="chip ok" title="${{REPORT.archive_sha256}}">Archive SHA: ${{REPORT.archive_sha256.slice(0,12)}}…</span>` : ''}}
    <span class="chip ${{aj.frames_sha256_failed ? 'err' : 'ok'}}">assembly.json: ${{aj.frames_sha256_verified}} PNG SHA OK · ${{aj.directional_clips_verified}} clips</span>
    <span class="chip ${{s.errors?'err':'ok'}}">Errors: ${{s.errors}}</span>
    <span class="chip ${{s.warnings?'warn':'ok'}}">Warnings: ${{s.warnings}}</span>
    ${{rc.checked ? `<span class="chip ${{rc.qa_assets_rc===0 && rc.pack_atlases_rc===0 ? 'ok':'err'}}">Repo QA+Packer: ${{rc.qa_assets_rc===0 && rc.pack_atlases_rc===0 ? 'PASS' : 'FAIL'}}</span>` : ''}}
  `;
  $('sel-mob').innerHTML = s.mob_ids.map(id => {{
    const m = REPORT.mobs[id];
    return markup`<option value="${{id}}" ${{id===mobId?'selected':''}}>${{id}} · ${{m.name}} (${{m.total_frames}}f · ${{m.archetype}})</option>`;
  }}).join('');
  $('exc-body').innerHTML = REPORT.exceptions.length ? REPORT.exceptions.map(e => markup`
    <tr>
      <td class="sev-${{e.severity}}">${{e.severity.toUpperCase()}}</td>
      <td class="mono">${{e.mob}}</td>
      <td class="mono">${{e.where}}</td>
      <td class="mono">${{e.code}}</td>
      <td>${{e.detail}}</td>
      <td class="mono">${{e.proposed_correction ? JSON.stringify(e.proposed_correction) : '—'}}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" style="color:var(--ok);">No QA errors or warnings.</td></tr>';
}}

async function boot() {{
  for (const [id, uri] of Object.entries(SHEETS)) imgs[id] = await loadImg(uri);
  renderHeaderAndTable();
  updateClipOptions();

  const triggerOneShot = (name) => {{
    clipName = name; $('sel-clip').value = name;
    frameIdx = 0; elapsed = 0; oneshotDone = false; playing = true; $('btn-play').textContent = 'Pause';
    drawStage();
  }};

  $('sel-mob').onchange = (e) => {{ mobId = e.target.value; updateClipOptions(); frameIdx = 0; elapsed = 0; oneshotDone = false; playing = true; $('btn-play').textContent = 'Pause'; drawStage(); }};
  $('sel-clip').onchange = (e) => {{ clipName = e.target.value; frameIdx = 0; elapsed = 0; oneshotDone = false; playing = true; $('btn-play').textContent = 'Pause'; drawStage(); }};
  $('sel-dir').onchange = (e) => {{ dir = e.target.value; drawStage(); }};
  for (const id of ['sel-bg','sel-zoom','chk-pivot','chk-shadow','chk-onion','chk-grid']) $(id).onchange = drawStage;
  $('btn-play').onclick = () => {{ playing = !playing; if (playing && oneshotDone) {{ frameIdx = 0; elapsed = 0; oneshotDone = false; }} $('btn-play').textContent = playing ? 'Pause' : 'Play'; }};
  $('btn-prev').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getFrames().length; frameIdx = (frameIdx - 1 + n) % n; drawStage(); }};
  $('btn-next').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getFrames().length; frameIdx = (frameIdx + 1) % n; drawStage(); }};
  $('btn-attack').onclick = () => triggerOneShot('attack');
  $('btn-death').onclick = () => triggerOneShot('death');

  drawStage();
  let last = performance.now();
  function tick(now) {{
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing && !oneshotDone) {{
      const clip = getClip();
      const frames = getFrames();
      if (frames.length > 0) {{
        elapsed += dt * 1000 * Number($('sel-speed').value);
        const cur = frames[frameIdx % frames.length];
        if (elapsed >= cur.duration_ms) {{
          elapsed -= cur.duration_ms;
          if (clip.mode === 'oneshot' && !$('chk-loop-oneshot').checked && frameIdx + 1 >= frames.length) {{
            oneshotDone = true;
            playing = false;
            $('btn-play').textContent = 'Replay';
          }} else {{
            frameIdx = (frameIdx + 1) % frames.length;
          }}
          drawStage();
        }}
      }}
    }}
    requestAnimationFrame(tick);
  }}
  requestAnimationFrame(tick);
}}
boot();
</script>
</body>
</html>
"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", type=Path, required=True, help="Read-only path to Blood-Sea.zip or unpacked handoff directory")
    ap.add_argument("--manifest", type=Path, default=REPO / "assets/manifest.json")
    ap.add_argument("--palette", type=Path, default=REPO / "tools/generators/palette.json")
    ap.add_argument("--out-dir", type=Path, default=None, help="Output directory for assembly JSON, contact sheet, and HTML viewer")
    ap.add_argument("--out-prefix", type=str, default="blood-sea-mobs", help="Filename prefix for generated deliverables (default: blood-sea-mobs)")
    ap.add_argument("--expected-sha256", type=str, default=None, help="Optional pinned SHA-256 digest for the input zip archive")
    ap.add_argument("--skip-repo-compat", action="store_true", help="Skip isolated qa_assets.py / pack_atlases.py check")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if any error-level QA issues are found")
    args = ap.parse_args(argv)

    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", args.out_prefix):
        ap.error("--out-prefix must be a filename prefix")
    src = args.source.resolve()
    report, strip_images = audit_blood_sea_mobs(
        src,
        args.manifest.resolve(),
        args.palette.resolve(),
        run_repo_compat=not args.skip_repo_compat,
        expected_sha256=args.expected_sha256,
    )

    if args.out_dir:
        out_dir = args.out_dir.resolve()
        if src.is_dir() and (src in out_dir.parents or out_dir == src):
            ap.error("--out-dir must not write inside --source (source tree stays read-only)")
        out_dir.mkdir(parents=True, exist_ok=True)
        pfx = args.out_prefix
        report_path(out_dir, f"{pfx}-assembly-manifest.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        build_contact_sheet(report, strip_images, report_path(out_dir, f"{pfx}-qa-contact-sheet.png"))
        build_html_workbench(report, strip_images, report_path(out_dir, f"{pfx}-animation-qa.html"))

    s = report["summary"]
    aj = report.get("assembly_json_verification") or {}
    print(
        f"Blood Sea Mob Assembly & QA: mobs={s['mobs_checked']} frames={s['total_frames']} "
        f"clips={s['directional_clips']} errors={s['errors']} warnings={s['warnings']} info={s['info']}"
    )
    if report.get("archive_sha256"):
        print(f"  Archive SHA-256: {report['archive_sha256']}")
    if aj.get("present"):
        print(
            f"  assembly.json: {aj['frames_sha256_verified']} PNG SHA-256 OK ({aj['frames_sha256_failed']} failed), "
            f"{aj['directional_clips_verified']} clips, facing_rules_ok={aj['facing_rules_ok']}"
        )
    rc = report.get("repo_pipeline_compat") or {}
    if rc.get("checked"):
        print(
            f"  Repo compat: qa_assets={rc['qa_assets_rc']} ({rc['qa_assets_summary']}) | "
            f"pack_atlases={rc['pack_atlases_rc']} ({rc['pack_atlases_summary']})"
        )
    for e in report["exceptions"]:
        if e["severity"] in ("error", "warn"):
            print(f"  [{e['severity'].upper():5}] {e['mob']:20} {e['where']:30} {e['code']}: {e['detail']}")
    return 1 if (args.strict and s["errors"] > 0) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, zipfile.BadZipFile, subprocess.TimeoutExpired) as exc:
        sys.exit(f"QA failed: {exc}")
