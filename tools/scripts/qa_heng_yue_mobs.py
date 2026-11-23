#!/usr/bin/env python
"""Independent animation assembly & QA verifier for Codex Heng Yue mob packages.

Supports BOTH:
  - Full-runtime 36-frame pilot mobs (`runtime.json` + `frames/*.png`: idle[4], move[6],
    attack[4], death[4] x south/east + runtime west flip [31-x] + north reuse south)
  - Key-pose 12-frame mobs (`poses.json` + `keys.png` + `timing.json`)

Reads Heng-Yue.zip or an unpacked directory STRICTLY READ-ONLY. Never generates, repaints,
or modifies game artwork, and never writes to the source package or peer worktrees.

Produces (only inside --out-dir):
  - heng-yue-assembly-manifest.json   Machine-readable animation clips, timing, pivots & QA findings
  - heng-yue-pilot-runtime-qa-sheet.png Full 36-frame annotated sheet (3x + 1x) for runtime pilot mobs
  - heng-yue-mob-qa-contact-sheet.png   5-mob 12-key overview sheet (4x + 1x, S/E/W-flip/N)
  - heng-yue-mob-animation-qa.html      Self-contained dual-scale interactive animation QA workbench
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import ntpath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter
from pathlib import Path, PureWindowsPath

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
EXPECTED_KEYS_ORDER = [
    "idle_ready",
    "move_contact_a",
    "move_contact_b",
    "attack_windup",
    "attack_impact",
    "attack_recovery",
]
EXPECTED_FACINGS = ["south", "east"]
RUNTIME_CLIP_ORDER = ["idle", "move", "attack", "death"]


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_global_palette(path: Path) -> tuple[set[tuple[int, int, int]], tuple[int, int, int]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    colors = {hex_to_rgb(c["hex"]) for c in data["colors"]}
    outline = hex_to_rgb(data["outline"])
    colors.add(outline)
    return colors, outline


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


def _silhouette_iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    """Center-aligned bounding-box silhouette IoU (0..1) to detect near-duplicate facing orientation."""
    def norm_crop(m: np.ndarray) -> np.ndarray:
        ys, xs = np.nonzero(m)
        if not len(xs):
            return np.zeros((32, 32), dtype=bool)
        sub = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out = np.zeros((32, 32), dtype=bool)
        h, w = sub.shape
        oy = 32 - h
        ox = (32 - w) // 2
        out[oy:oy + h, ox:ox + w] = sub
        return out

    na, nb = norm_crop(mask_a), norm_crop(mask_b)
    inter = int((na & nb).sum())
    union = int((na | nb).sum())
    return inter / max(1, union)


def _horizontal_symmetry(mask: np.ndarray) -> float:
    """Silhouette left-right mirror IoU around its own bbox center (1.0 = symmetric front-facing)."""
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return 0.0
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    flipped = sub[:, ::-1]
    inter = int((sub & flipped).sum())
    union = int((sub | flipped).sum())
    return inter / max(1, union)


def _default_runtime_durations(mob_id: str, state: str, count: int) -> list[int]:
    is_viper = "viper" in mob_id
    if state == "idle":
        base = [170, 150, 170, 150] if not is_viper else [160, 140, 160, 140]
    elif state == "move":
        # Contacts at 0 and 3 get slightly longer beat than compression/pass frames
        base = [115, 85, 95, 115, 85, 95] if not is_viper else [105, 80, 90, 105, 80, 90]
    elif state == "attack":
        if count == 6:
            # 0 windup, 1 gather, 2 pre-contact acceleration, 3 shield contact / talisman release, 4 recoil, 5 recovery
            base = [150, 100, 75, 145, 110, 160]
        else:
            # 0 windup, 1 release transition, 2 thrust/bite/sword release contact, 3 recovery
            base = [165, 80, 140, 170] if not is_viper else [145, 70, 130, 155]
    elif state == "death":
        # 0 stagger, 1 buckle, 2 fall, 3 grounded hold
        base = [130, 140, 150, 380]
    else:
        base = [120] * count
    if len(base) == count:
        return base
    return [120] * count


def build_mob_clips_from_keys(mob_id: str, spec: dict, manifest_asset: dict | None, timing_spec: dict | None = None) -> dict:
    """Assemble explicit looping idle/move & one-shot attack clips strictly from 12 Codex keys."""
    keys_by_fp = {(k["facing"], k["pose"]): k for k in spec["keys"]}
    ax, ay = int(spec["anchor_px"][0]), int(spec["anchor_px"][1])
    w, h = int(spec["canvas"][0]), int(spec["canvas"][1])
    west_ax = (w - 1) - ax
    targets = (manifest_asset or {}).get("animations") or spec.get("manifest_animation_targets") or {}
    t_clips = (timing_spec or {}).get("clips") or {}

    def sparse_slots(cname: str, default_len: int) -> list[str | None]:
        tc = t_clips.get(cname)
        if isinstance(tc, dict) and isinstance(tc.get("pose_at_index"), list):
            return list(tc["pose_at_index"])
        return [None] * default_len

    def ref_frame(facing: str, pose: str, ms: int, role: str) -> dict:
        if facing == "west":
            src_facing, mirror_x, g_px = "east", True, [west_ax, ay]
        elif facing == "north":
            src_facing, mirror_x, g_px = "south", False, [ax, ay]
        else:
            src_facing, mirror_x, g_px = facing, False, [ax, ay]
        krec = keys_by_fp[(src_facing, pose)]
        return {
            "source_key": f"{mob_id}/{src_facing}/{pose}",
            "pose": pose,
            "source_facing": src_facing,
            "source_file": "keys.png",
            "mirror_x": mirror_x,
            "sheet_rect": [int(krec["sheet_xy"][0]), int(krec["sheet_xy"][1]), w, h],
            "ground_px": g_px,
            "duration_ms": ms,
            "role": role,
        }

    is_fast = (manifest_asset or {}).get("archetype") == "fast_melee" or "viper" in mob_id
    move_contact_ms = 125 if is_fast else 145
    move_pass_ms = 95 if is_fast else 110
    atk_windup_ms = 150 if is_fast else 180
    atk_impact_ms = 120 if is_fast else 140
    atk_recov_ms = 160 if is_fast else 190

    runtime_dirs = ["south", "east", "west", "north"]
    idle_len = int((targets.get("idle") or {}).get("frames", 4))
    move_len = int((targets.get("move") or {}).get("frames", 6))
    atk_len = int((targets.get("attack") or {}).get("frames", 4))
    death_len = int((targets.get("death") or {}).get("frames", 4))
    clips = {
        "idle": {
            "mode": "loop",
            "manifest_target_frames": idle_len,
            "sparse_pose_at_index": sparse_slots("idle", idle_len),
            "authored_unique_keys_per_dir": 1,
            "coverage_status": "key_pose_baseline_only",
            "honest_gap_note": f"Uses Codex idle_ready key only (1/{idle_len} manifest idle slots; {idle_len - 1} breathing in-betweens still null/unauthored).",
            "directions": {d: [ref_frame(d, "idle_ready", 480, "baseline_hold")] for d in runtime_dirs},
        },
        "move": {
            "mode": "loop",
            "manifest_target_frames": move_len,
            "sparse_pose_at_index": sparse_slots("move", move_len),
            "authored_unique_keys_per_dir": 3,
            "coverage_status": "key_pose_cycle_assembled",
            "honest_gap_note": f"4-step loop assembled from Codex move_contact_a + idle_ready + move_contact_b + idle_ready; sparse slots {sparse_slots('move', move_len)} leave 4 passing drawings open.",
            "directions": {
                d: [
                    ref_frame(d, "move_contact_a", move_contact_ms, "contact_a"),
                    ref_frame(d, "idle_ready", move_pass_ms, "passing_reuse_ready"),
                    ref_frame(d, "move_contact_b", move_contact_ms, "contact_b"),
                    ref_frame(d, "idle_ready", move_pass_ms, "passing_reuse_ready"),
                ]
                for d in runtime_dirs
            },
        },
        "attack": {
            "mode": "oneshot",
            "manifest_target_frames": atk_len,
            "sparse_pose_at_index": sparse_slots("attack", atk_len),
            "authored_unique_keys_per_dir": 3,
            "coverage_status": "key_pose_oneshot_assembled",
            "honest_gap_note": f"3-key one-shot (windup -> impact -> recovery); {max(0, atk_len - 3)} transition slot(s) remain null/unauthored vs manifest target ({atk_len}f).",
            "directions": {
                d: [
                    ref_frame(d, "attack_windup", atk_windup_ms, "windup"),
                    ref_frame(d, "attack_impact", atk_impact_ms, "impact"),
                    ref_frame(d, "attack_recovery", atk_recov_ms, "recovery"),
                ]
                for d in runtime_dirs
            },
        },
        "death": {
            "mode": "oneshot",
            "manifest_target_frames": death_len,
            "sparse_pose_at_index": sparse_slots("death", death_len),
            "authored_unique_keys_per_dir": 0,
            "coverage_status": "not_authored",
            "honest_gap_note": f"No death pose keys provided by Codex yet (0/{death_len} slots); excluded from playback.",
            "directions": {},
        },
    }
    return {
        "tier": "key_poses_12f",
        "atlas_kind": "keys_png",
        "anchor_px_direct": [ax, ay],
        "anchor_px_west_mirrored": [west_ax, ay],
        "direction_rules": {
            "south": "source_row_0",
            "east": "source_row_1",
            "west": f"mirror_x(east) with anchor_x={west_ax} (31 - {ax})",
            "north": "reuse(south) per manifest 2-dir mob rule",
        },
        "clips": clips,
    }


def build_mob_clips_from_runtime(mob_id: str, rt_spec: dict, packed_rects: dict[str, list[int]]) -> dict:
    """Assemble full 36-frame manifest clips (idle[4], move[6], attack[4], death[4]) strictly from Codex frames."""
    ax, ay = int(rt_spec["anchor_px"][0]), int(rt_spec["anchor_px"][1])
    w, h = int(rt_spec["canvas"][0]), int(rt_spec["canvas"][1])
    west_ax = (w - 1) - ax
    by_sfi = {(f["state"], f["facing"], int(f["index"])): f for f in rt_spec["frames"]}
    runtime_dirs = ["south", "east", "west", "north"]
    clips = {}

    for state in RUNTIME_CLIP_ORDER:
        cdef = (rt_spec.get("clips") or {}).get(state)
        if not cdef:
            continue
        count = int(cdef["frames"])
        loop = bool(cdef.get("loop", False))
        durs = _default_runtime_durations(mob_id, state, count)
        dirs_out = {}
        for d in runtime_dirs:
            if d == "west":
                src_f, mirror_x, g_px = "east", True, [west_ax, ay]
            elif d == "north":
                src_f, mirror_x, g_px = "south", False, [ax, ay]
            else:
                src_f, mirror_x, g_px = d, False, [ax, ay]
            seq = []
            for idx in range(count):
                fmeta = by_sfi[(state, src_f, idx)]
                fn = fmeta["filename"]
                seq.append({
                    "source_key": f"characters/{mob_id}/{state}_{src_f}_{idx}",
                    "filename": fn,
                    "pose": f"{state}_{idx}",
                    "beat": fmeta.get("beat", f"{state}[{idx}]"),
                    "source_facing": src_f,
                    "source_file": fmeta.get("source", "frames"),
                    "mirror_x": mirror_x,
                    "sheet_rect": packed_rects[fn],
                    "ground_px": g_px,
                    "duration_ms": durs[idx],
                    "role": fmeta.get("beat", f"frame_{idx}"),
                })
            dirs_out[d] = seq
        clips[state] = {
            "mode": "loop" if loop else "oneshot",
            "manifest_target_frames": count,
            "sparse_pose_at_index": [f"{state}_{i}" for i in range(count)],
            "authored_unique_keys_per_dir": count,
            "coverage_status": "complete_manifest_frames",
            "honest_gap_note": f"All {count}/{count} manifest frames authored by Codex ({'looping' if loop else 'one-shot'}).",
            "directions": dirs_out,
        }

    return {
        "tier": "full_runtime_36f",
        "atlas_kind": "runtime_strip_png",
        "anchor_px_direct": [ax, ay],
        "anchor_px_west_mirrored": [west_ax, ay],
        "direction_rules": {
            "south": "authored_frames_south",
            "east": "authored_frames_east",
            "west": f"mirror_x(east) with anchor_x={west_ax} (31 - {ax})",
            "north": "reuse(south) per manifest 2-dir mob rule",
        },
        "clips": clips,
    }


def _audit_runtime_frames(
    mdir: Path,
    mob_id: str,
    rt_spec: dict,
    m_asset: dict | None,
    global_pal: set[tuple[int, int, int]],
    outline_rgb: tuple[int, int, int],
    add_exc,
) -> tuple[dict, Image.Image, dict[str, list[int]]]:
    """Audit all 36 runtime frames in mdir/frames/ against runtime.json + manifest.json."""
    frames_dir = mdir / "frames"
    ax, ay = int(rt_spec["anchor_px"][0]), int(rt_spec["anchor_px"][1])
    w, h = int(rt_spec["canvas"][0]), int(rt_spec["canvas"][1])
    if (w, h) != (32, 32) or rt_spec.get("facings", EXPECTED_FACINGS) != EXPECTED_FACINGS:
        raise ValueError("Runtime strips require 32px cells and south/east source facings")
    clips = rt_spec.get("clips") or {}
    if set(clips) - set(RUNTIME_CLIP_ORDER) or any(not 1 <= int(c["frames"]) <= 256 for c in clips.values()):
        raise ValueError("Invalid runtime clip or frame count")
    mob_pal = {hex_to_rgb(hx) for hx in (rt_spec.get("palette") or {}).values()}

    # 1. Source hashes verification
    hash_results = {}
    for fname, expected_sha in (rt_spec.get("source_hashes") or {}).items():
        fpath = _package_path(mdir, fname)
        if not fpath.is_file():
            hash_results[fname] = False
            add_exc("error", "runtime_source_missing", mob_id, fname, f"Referenced source '{fname}' missing")
        else:
            ok = hashlib.sha256(fpath.read_bytes()).hexdigest() == expected_sha
            hash_results[fname] = ok
            if not ok:
                add_exc("error", "runtime_source_sha_mismatch", mob_id, fname, f"SHA-256 mismatch on '{fname}'")

    # 2. Verify exact manifest frame list (36 expected)
    expected_files = {
        f"{state}_{facing}_{idx}.png"
        for state, cdef in (rt_spec.get("clips") or {}).items()
        for facing in (rt_spec.get("facings") or EXPECTED_FACINGS)
        for idx in range(int(cdef["frames"]))
    }
    actual_files = {p.name for p in frames_dir.glob("*.png")} if frames_dir.is_dir() else set()
    missing_f = sorted(expected_files - actual_files)
    extra_f = sorted(actual_files - expected_files)
    if missing_f:
        add_exc("error", "runtime_missing_frames", mob_id, "frames/", f"{len(missing_f)} missing runtime frames e.g. {missing_f[:3]}")
    if extra_f:
        add_exc("warn", "runtime_extra_frames", mob_id, "frames/", f"{len(extra_f)} unindexed PNGs in frames/: {extra_f[:3]}")

    if m_asset:
        for state, mcfg in (m_asset.get("animations") or {}).items():
            if state == "hurt":  # derived overlay (build_hurt_clips.py), not part of the release archive
                continue
            rcfg = (rt_spec.get("clips") or {}).get(state)
            if not rcfg or int(rcfg["frames"]) != int(mcfg["frames"]):
                add_exc("error", "runtime_manifest_clip_mismatch", mob_id, state, f"runtime.json clip {rcfg} != manifest {mcfg}")

    # 3. Load every frame, build horizontal runtime strip for HTML viewer, measure pixel & motion metrics
    fmeta_by_name = {f["filename"]: f for f in rt_spec.get("frames", [])}
    ordered_names = [
        f"{state}_{facing}_{idx}.png"
        for state in RUNTIME_CLIP_ORDER
        if state in (rt_spec.get("clips") or {})
        for facing in (rt_spec.get("facings") or EXPECTED_FACINGS)
        for idx in range(int(rt_spec["clips"][state]["frames"]))
    ]

    strip_im = Image.new("RGBA", (max(1, len(ordered_names)) * w, h))
    packed_rects: dict[str, list[int]] = {}
    seen_bytes: dict[bytes, str] = {}
    frame_metrics: list[dict] = []
    masks_by_sfi: dict[tuple[str, str, int], np.ndarray] = {}
    metrics_by_sf: dict[tuple[str, str], list[dict]] = {}

    tot_partial = tot_dirty0 = tot_off_global = tot_off_mob = tot_gap4 = tot_speck = 0
    tot_opaque = tot_ink = 0
    edge_touch_frames = []

    for slot_i, fn in enumerate(ordered_names):
        p = _package_path(frames_dir, fn)
        if not p.is_file():
            continue
        im = Image.open(p).convert("RGBA")
        if im.size != (w, h):
            add_exc("error", "runtime_frame_size", mob_id, fn, f"Size {im.size} != {(w, h)}")
            continue
        strip_im.paste(im, (slot_i * w, 0))
        packed_rects[fn] = [slot_i * w, 0, w, h]

        raw_bytes = im.tobytes()
        if raw_bytes in seen_bytes:
            add_exc("error", "runtime_duplicate_frame", mob_id, fn, f"Byte-identical duplicate of {seen_bytes[raw_bytes]}")
        seen_bytes[raw_bytes] = fn

        arr = np.array(im)
        a = arr[..., 3]
        op = a == 255
        partial = int(((a > 0) & (a < 255)).sum())
        dirty0 = int(((a == 0) & (arr[..., :3].sum(-1) > 0)).sum())
        op_rgb = arr[op][:, :3]
        off_g = sum(1 for px in op_rgb if tuple(px.tolist()) not in global_pal)
        off_m = sum(1 for px in op_rgb if tuple(px.tolist()) not in mob_pal)
        ink_n = sum(1 for px in op_rgb if tuple(px.tolist()) == outline_rgb)
        tot_partial += partial
        tot_dirty0 += dirty0
        tot_off_global += off_g
        tot_off_mob += off_m
        tot_opaque += len(op_rgb)
        tot_ink += ink_n

        ys, xs = np.nonzero(op)
        if not len(xs):
            add_exc("error", "runtime_empty_frame", mob_id, fn, "Fully transparent runtime frame")
            continue
        bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
        bw, bh = bx1 - bx0 + 1, by1 - by0 + 1
        head_band = ys <= (by0 + max(2, int(bh * 0.35)))
        head_cx = float(xs[head_band].mean())
        com_x, com_y = float(xs.mean()), float(ys.mean())
        area = int(op.sum())

        ol = op & (arr[..., 0] == outline_rgb[0]) & (arr[..., 1] == outline_rgb[1]) & (arr[..., 2] == outline_rgb[2])
        edge4 = neighbors_transparent_4(op)
        gap4 = int((op & edge4 & ~ol).sum())
        blk2x2 = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
        comps = connected_components_8(op)
        specks = sum(len(cp) for cp in comps if len(cp) <= 2)
        tot_gap4 += gap4
        tot_speck += specks

        touches = [s for s, cond in (("left", bx0 == 0), ("right", bx1 == w - 1), ("top", by0 == 0)) if cond]
        if touches:
            edge_touch_frames.append((fn, touches, [bx0, by0, bx1, by1]))
            add_exc("warn", "runtime_frame_edge_touch", mob_id, fn, f"32x32 frame touches {', '.join(touches)} edge (bbox={bx0},{by0}..{bx1},{by1})")
        if by1 != ay:
            add_exc("error", "runtime_ground_mismatch", mob_id, fn, f"Lowest opaque row y={by1} != anchor_px[1]={ay}")
        if gap4 > 0:
            add_exc("error", "runtime_outline_gap", mob_id, fn, f"{gap4} 4-connected edge pixels missing #14101a outline")
        if specks > 0:
            add_exc("warn", "runtime_speckle", mob_id, fn, f"{specks} detached 1-2px pixel(s) across {len(comps)} components")

        fm = fmeta_by_name.get(fn) or {}
        state = fm.get("state") or fn.split("_")[0]
        facing = fm.get("facing") or fn.split("_")[1]
        idx = int(fm.get("index", int(fn.rsplit("_", 1)[1].split(".")[0])))
        masks_by_sfi[(state, facing, idx)] = op

        rec = {
            "filename": fn,
            "state": state,
            "facing": facing,
            "index": idx,
            "beat": fm.get("beat", ""),
            "source": fm.get("source", ""),
            "crop_xyxy": fm.get("crop_xyxy"),
            "ground_xy": fm.get("ground_xy"),
            "bbox": [bx0, by0, bx1, by1],
            "size_px": [bw, bh],
            "opaque_area": area,
            "head_cx": round(head_cx, 2),
            "com_xy": [round(com_x, 2), round(com_y, 2)],
            "head_minus_anchor_x": round(head_cx - ax, 2),
            "bottom_y": by1,
            "edge_touches": touches,
            "outline_2x2_blocks": int(blk2x2.sum()),
            "speckle_px": specks,
            "symmetry_lr": round(_horizontal_symmetry(op), 3),
        }
        frame_metrics.append(rec)
        metrics_by_sf.setdefault((state, facing), []).append(rec)

    if tot_partial > 0:
        add_exc("error", "runtime_partial_alpha", mob_id, "frames/", f"{tot_partial} partial-alpha pixels across runtime frames")
    if tot_dirty0 > 0:
        add_exc("error", "runtime_dirty_transparent", mob_id, "frames/", f"{tot_dirty0} dirty transparent RGB pixels across runtime frames")
    if tot_off_global > 0:
        add_exc("error", "runtime_off_global_palette", mob_id, "frames/", f"{tot_off_global} opaque pixels outside palette.json")
    if tot_off_mob > 0:
        add_exc("warn", "runtime_off_mob_palette", mob_id, "frames/", f"{tot_off_mob} opaque pixels outside mob palette_refs")

    # 4. Clip-level motion continuity, scale-jump, pivot-drift & death-orientation checks
    clip_qa = {}
    for (state, facing), items in sorted(metrics_by_sf.items()):
        items.sort(key=lambda r: r["index"])
        hxs = [r["head_cx"] for r in items]
        bhs = [r["size_px"][1] for r in items]
        areas = [r["opaque_area"] for r in items]
        hx_drift = round(max(hxs) - min(hxs), 2)
        outlier = max(items, key=lambda r: abs(r["head_cx"] - ax))

        # Check keys.png vs progression-source.png scale/bulk consistency within looping clips (idle/move)
        keys_items = [r for r in items if r["source"] == "keys.png"]
        prog_items = [r for r in items if r["source"] != "keys.png"]
        area_ratio = None
        height_delta = None
        if keys_items and prog_items and state in ("idle", "move"):
            k_area = float(np.mean([r["opaque_area"] for r in keys_items]))
            p_area = float(np.mean([r["opaque_area"] for r in prog_items]))
            k_h = float(np.mean([r["size_px"][1] for r in keys_items]))
            p_h = float(np.mean([r["size_px"][1] for r in prog_items]))
            area_ratio = round(p_area / max(1.0, k_area), 3)
            height_delta = round(p_h - k_h, 2)
            if abs(area_ratio - 1.0) >= 0.20 or abs(height_delta) >= 2.5:
                add_exc(
                    "warn",
                    "runtime_keys_vs_prog_scale_jump",
                    mob_id,
                    f"{state}/{facing}",
                    f"Visible bulk/height pop between keys.png frames (mean h={k_h:.1f}px, area={k_area:.0f}px) and progression-source frames (mean h={p_h:.1f}px, area={p_area:.0f}px; ratio={area_ratio:.2f}x, dH={height_delta:+.1f}px).",
                    proposal={"detail": "Slightly reduce progression-source scale in runtime.json to match keys.png silhouette height/area on looping clips."},
                )

        # Horizontal pivot drift within a clip (skip death fall horizontal spread; flag sudden spikes in idle/move/attack)
        drift_limit = 2.5 if state == "idle" else 3.8 if state == "move" else 4.5
        if state in ("idle", "move", "attack") and hx_drift > drift_limit:
            prop = None
            if outlier.get("ground_xy") and rt_spec.get("scale"):
                gxy = outlier["ground_xy"]
                shift_src = int(round(outlier["head_minus_anchor_x"] / float(rt_spec["scale"])))
                prop = {"filename": outlier["filename"], "current_ground_xy": gxy, "suggested_ground_xy": [gxy[0] + shift_src, gxy[1]]}
            elif outlier["source"] == "keys.png":
                prop = {"filename": outlier["filename"], "source": "keys.png", "note": "Inherited from keys.png registration; adjust ground_xy in poses.json and rebuild."}
            add_exc(
                "warn",
                "runtime_clip_head_drift",
                mob_id,
                f"{state}/{facing} ({outlier['filename']})",
                f"Head X drifts {hx_drift:.2f}px across {state}/{facing} (outlier {outlier['filename']}: head_cx={outlier['head_cx']} vs anchor_x={ax}, dX={outlier['head_minus_anchor_x']:+.2f}px).",
                proposal=prop,
            )

        # Death monotonic collapse check
        collapse_ok = None
        if state == "death" and len(items) >= 4:
            collapse_ok = (bhs[-1] < bhs[0]) and (bhs[-1] <= bhs[0] * 0.65)
            if not collapse_ok:
                add_exc("warn", "runtime_death_collapse_weak", mob_id, f"death/{facing}", f"Death heights {bhs} do not clearly collapse to grounded pose.")

        clip_qa[f"{state}/{facing}"] = {
            "frames": len(items),
            "height_range": [min(bhs), max(bhs)],
            "area_range": [min(areas), max(areas)],
            "head_x_drift_px": hx_drift,
            "head_x_outlier": outlier["filename"],
            "keys_vs_prog_area_ratio": area_ratio,
            "keys_vs_prog_height_delta": height_delta,
            "death_collapse_ok": collapse_ok,
        }

    # 5. South vs East orientation similarity check on death frames (catches side-profile south death!)
    death_south_east_ious = []
    if ("death", "south") in metrics_by_sf and ("death", "east") in metrics_by_sf:
        idle_s_sym = _horizontal_symmetry(masks_by_sfi[("idle", "south", 0)]) if ("idle", "south", 0) in masks_by_sfi else 0.0
        for idx in range(int(rt_spec["clips"]["death"]["frames"])):
            ms = masks_by_sfi.get(("death", "south", idx))
            me = masks_by_sfi.get(("death", "east", idx))
            if ms is not None and me is not None:
                death_south_east_ious.append(round(_silhouette_iou(ms, me), 3))
        mean_iou = float(np.mean(death_south_east_ious)) if death_south_east_ious else 0.0
        death_s0_sym = _horizontal_symmetry(masks_by_sfi[("death", "south", 0)]) if ("death", "south", 0) in masks_by_sfi else 0.0
        # If idle_south is strongly front-symmetric (>=0.70) while death_south closely mimics death_east (mean IoU >= 0.68) and loses front symmetry:
        if mean_iou >= 0.68 and (idle_s_sym - death_s0_sym) >= 0.18:
            add_exc(
                "warn",
                "runtime_south_death_facing_east",
                mob_id,
                "death/south (0..3)",
                f"death_south_0..3 silhouette closely matches side-profile death_east (mean IoU={mean_iou:.2f}, per-frame={death_south_east_ious}; front symmetry drops {idle_s_sym:.2f} -> {death_s0_sym:.2f}). South death reads as facing east instead of front.",
                proposal={"action": "review_or_regenerate_south_death_in_codex", "note": "Keep front-facing hood/torso read on south death frames 0-1 (stagger/buckle) before grounded collapse."},
            )

    runtime_report = {
        "present": True,
        "total_frames": len(frame_metrics),
        "expected_frames": len(expected_files),
        "source_hashes_verified": hash_results,
        "hygiene": {
            "partial_alpha_px": tot_partial,
            "dirty_transparent_px": tot_dirty0,
            "off_global_palette_px": tot_off_global,
            "off_mob_palette_px": tot_off_mob,
            "outline_gap_4conn_px": tot_gap4,
            "speckle_px": tot_speck,
            "opaque_px": tot_opaque,
            "ink_outline_share": round(tot_ink / max(1, tot_opaque), 4),
            "edge_touch_count": len(edge_touch_frames),
        },
        "death_south_vs_east_iou": death_south_east_ious,
        "clip_qa": clip_qa,
        "frames": frame_metrics,
    }
    return runtime_report, strip_im, packed_rects


def _check_repo_pipeline_compat(work_root: Path, runtime_mob_ids: list[str]) -> dict:
    """Verify runtime pilot frames pass repo qa_assets.py and pack_atlases.py in an isolated temp dir."""
    result = {"checked": False, "qa_assets_rc": None, "pack_atlases_rc": None, "packed_clips": {}}
    if not runtime_mob_ids:
        return result
    qa_script = REPO / "tools/scripts/qa_assets.py"
    pack_script = REPO / "tools/scripts/pack_atlases.py"
    if not qa_script.is_file() or not pack_script.is_file():
        return result

    with tempfile.TemporaryDirectory(prefix="hy_repo_compat_") as td:
        proc = Path(td) / "processed"
        out_atl = Path(td) / "atlases"
        for mob_id in runtime_mob_ids:
            matches = list(work_root.rglob(f"{mob_id}/frames"))
            if not matches:
                continue
            dst_dir = proc / "mobs" / mob_id
            dst_dir.mkdir(parents=True, exist_ok=True)
            for p in matches[0].glob("*.png"):
                shutil.copy2(p, dst_dir / p.name)
            # the manifest also lists the derived hurt clip, which is not part of the release package
            for p in (REPO / "assets/processed/mobs" / mob_id).glob("hurt_*.png"):
                shutil.copy2(p, dst_dir / p.name)
        r1 = subprocess.run([sys.executable, "-E", "-B", str(qa_script), "--root", str(proc)], capture_output=True, text=True, cwd=td, timeout=120)
        r2 = subprocess.run(
            [sys.executable, "-E", "-B", str(pack_script), "--source", str(proc), "--output", str(out_atl)],
            cwd=td, timeout=120, capture_output=True,
            text=True,
        )
        result["checked"] = True
        result["qa_assets_rc"] = r1.returncode
        result["qa_assets_summary"] = (r1.stdout.strip().splitlines() or [""])[-1]
        result["pack_atlases_rc"] = r2.returncode
        result["pack_atlases_summary"] = (r2.stdout.strip().splitlines() or [""])[-1]
        ts_file = out_atl / "AssetKeys.ts"
        if ts_file.is_file():
            m = re.search(r"export const CharacterAnimations = (\{.*?\}) as const;", ts_file.read_text(encoding="utf-8"), re.S)
            if m:
                ca = json.loads(m.group(1))
                result["packed_clips"] = {
                    cid: {anim: sorted(dirs.keys()) for anim, dirs in anims.items()}
                    for cid, anims in ca.items()
                }
    return result


def _verify_assembly_json(work_root: Path, add_exc) -> dict:
    """Verify top-level Heng-Yue/assembly.json paths, clip structure, facing_rules & 188 PNG SHA-256 digests."""
    candidates = list(work_root.rglob("assembly.json"))
    info = {
        "present": False,
        "path": None,
        "assets_verified": 0,
        "directional_clips_verified": 0,
        "frames_sha256_verified": 0,
        "frames_sha256_failed": 0,
        "facing_rules_ok": None,
    }
    if not candidates:
        return info

    asm_path = candidates[0]
    asm_root = asm_path.parent
    asm = json.loads(asm_path.read_text(encoding="utf-8"))
    info["present"] = True
    info["path"] = asm_path.relative_to(work_root).as_posix()

    fr = asm.get("facing_rules") or {}
    north_ok = (fr.get("north") or {}).get("source") == "south" and (fr.get("north") or {}).get("flip_x") is False
    west_ok = (fr.get("west") or {}).get("source") == "east" and (fr.get("west") or {}).get("flip_x") is True
    info["facing_rules_ok"] = north_ok and west_ok
    if not info["facing_rules_ok"]:
        add_exc("error", "assembly_facing_rules", "package", "assembly.json", f"Unexpected facing_rules: {fr}")

    assets = asm.get("assets") or {}
    info["assets_verified"] = len(assets)
    for mob_id, adata in sorted(assets.items()):
        for cname, cdef in sorted((adata.get("clips") or {}).items()):
            for facing, flist in sorted((cdef.get("directions") or {}).items()):
                info["directional_clips_verified"] += 1
                for idx, entry in enumerate(flist):
                    rel = entry.get("path", "")
                    want_sha = entry.get("sha256", "")
                    fpath = _package_path(asm_root, rel)
                    if not fpath.is_file():
                        info["frames_sha256_failed"] += 1
                        add_exc("error", "assembly_missing_png", mob_id, f"{cname}/{facing}[{idx}]", f"Missing PNG '{rel}' referenced by assembly.json")
                        continue
                    got_sha = hashlib.sha256(fpath.read_bytes()).hexdigest()
                    if got_sha != want_sha:
                        info["frames_sha256_failed"] += 1
                        add_exc("error", "assembly_sha256_mismatch", mob_id, rel, f"SHA-256 {got_sha[:12]} != assembly.json {want_sha[:12]}")
                    else:
                        info["frames_sha256_verified"] += 1
    return info


def _package_path(root: Path, name: str) -> Path:
    # ntpath checks Windows device names even when the verifier runs on POSIX.
    reserved = getattr(ntpath, "isreserved", None)
    parts = name.split("/")
    if any(
        part in ("", ".", "..") or part.endswith((" ", "."))
        or re.search(r'[<>:"|?*\\\x00-\x1f]', part)
        or (reserved(part) if reserved else PureWindowsPath(part).is_reserved())
        for part in parts
    ):
        raise ValueError(f"Invalid package path: {name!r}")
    return root.joinpath(*parts)


def _extract_archive(archive: zipfile.ZipFile, root: Path) -> None:
    entries = archive.infolist()
    if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 512 * 1024**2:
        raise ValueError("Package exceeds extraction limits")
    seen = set()
    for entry in entries:
        name = entry.filename.removesuffix("/")
        target = _package_path(root, name)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in (0, stat.S_IFDIR, stat.S_IFREG) or name.casefold() in seen:
            raise ValueError(f"Unsupported or duplicate ZIP member: {name!r}")
        seen.add(name.casefold())
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)


def _check_directory(root: Path) -> None:
    for directory, folders, files in os.walk(root):
        for name in folders + files:
            info = (Path(directory) / name).lstat()
            if (not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode))
                    or getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
                raise ValueError("Package directories must contain ordinary files and directories")


def _discover_mob_dirs(root: Path) -> list[Path]:
    return sorted(p.parent for p in root.rglob("poses.json") if p.parent.name.startswith("mob_"))


def audit_mob_package(
    source_path: Path,
    manifest_path: Path,
    palette_path: Path,
    run_repo_compat: bool = True,
    expected_sha256: str | None = None,
) -> tuple[dict, dict[str, dict]]:
    """Audit all mob folders in a Heng-Yue.zip or directory (read-only)."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_by_id = {a["id"]: a for a in manifest["assets"]}
    global_pal, outline_rgb = load_global_palette(palette_path)

    archive_sha256 = None
    tmp_ctx = None
    try:
        if source_path.is_file() and source_path.suffix.lower() == ".zip":
            with source_path.open("rb") as source:
                digest = hashlib.sha256()
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                archive_sha256 = digest.hexdigest()
                if expected_sha256 and archive_sha256 != expected_sha256.lower():
                    raise ValueError("Archive SHA-256 mismatch")
                source.seek(0)
                tmp_ctx = tempfile.TemporaryDirectory(prefix="heng_yue_qa_")
                work_root = Path(tmp_ctx.name)
                with zipfile.ZipFile(source) as archive:
                    _extract_archive(archive, work_root)
        else:
            if not source_path.is_dir() or expected_sha256:
                raise ValueError("Supply a ZIP archive for digest verification or an unpacked directory without a pin")
            _check_directory(source_path)
            work_root = source_path

        mob_dirs = _discover_mob_dirs(work_root)
        exceptions: list[dict] = []
        mob_reports: dict[str, dict] = {}
        images_cache: dict[str, dict] = {}
        runtime_mob_ids: list[str] = []

        def add_exc(severity: str, code: str, mob_id: str, where: str, detail: str, proposal: dict | None = None):
            rec = {"severity": severity, "code": code, "mob": mob_id, "where": where, "detail": detail}
            if proposal is not None:
                rec["proposed_correction"] = proposal
            exceptions.append(rec)

        assembly_json_check = _verify_assembly_json(work_root, add_exc)

        if not mob_dirs:
            add_exc("error", "no_mobs_found", "package", str(source_path), "No mob_*/poses.json folders found in package")

        for mdir in mob_dirs:
            spec = json.loads((mdir / "poses.json").read_text(encoding="utf-8"))
            mob_id = spec["id"]
            if mob_id != mdir.name or not re.fullmatch(r"mob_[a-z0-9_]+", mob_id):
                raise ValueError("Mob ID must match its package directory")
            m_asset = manifest_by_id.get(mob_id)
            keys_path = mdir / "keys.png"
            src_path = mdir / "source.png"

            if m_asset is None:
                add_exc("error", "manifest_missing_mob", mob_id, "poses.json", f"{mob_id} not found in assets/manifest.json")
            else:
                if m_asset["size"] != spec["canvas"]:
                    add_exc("error", "manifest_size_mismatch", mob_id, "poses.json", f"canvas {spec['canvas']} != manifest {m_asset['size']}")
                if m_asset["directions"] != EXPECTED_FACINGS:
                    add_exc("error", "manifest_dir_mismatch", mob_id, "poses.json", f"manifest directions {m_asset['directions']} != {EXPECTED_FACINGS}")

            sha_ok = False
            src_im = None
            if not src_path.is_file():
                add_exc("error", "source_missing", mob_id, "source.png", "Missing source.png")
            else:
                actual_sha = hashlib.sha256(src_path.read_bytes()).hexdigest()
                sha_ok = actual_sha == spec.get("source_sha256")
                if not sha_ok:
                    add_exc("error", "source_sha256_mismatch", mob_id, "source.png", f"SHA-256 {actual_sha[:12]} != poses.json {str(spec.get('source_sha256'))[:12]}")
                src_im = Image.open(src_path).convert("RGBA")
                if [src_im.width, src_im.height] != spec.get("source_dimensions"):
                    add_exc("error", "source_dim_mismatch", mob_id, "source.png", f"{src_im.size} != {spec.get('source_dimensions')}")

            if not keys_path.is_file():
                add_exc("error", "keys_missing", mob_id, "keys.png", "Missing keys.png")
                continue

            keys_im = Image.open(keys_path).convert("RGBA")
            karr = np.array(keys_im)
            kh, kw = karr.shape[:2]
            if (kw, kh) != (216, 72):
                add_exc("error", "keys_sheet_size", mob_id, "keys.png", f"keys.png size {kw}x{kh} != expected 216x72")

            ka = karr[..., 3]
            k_partial = int(((ka > 0) & (ka < 255)).sum())
            k_dirty0 = int(((ka == 0) & (karr[..., :3].sum(-1) > 0)).sum())
            mob_pal = {hex_to_rgb(h) for h in (spec.get("palette") or {}).values()}
            op_px = karr[ka == 255][:, :3]
            k_off_global = sum(1 for px in op_px if tuple(px.tolist()) not in global_pal)
            k_off_mob = sum(1 for px in op_px if tuple(px.tolist()) not in mob_pal)
            k_ink = sum(1 for px in op_px if tuple(px.tolist()) == outline_rgb)
            ink_share = k_ink / max(1, len(op_px))

            if k_partial > 0:
                add_exc("error", "keys_partial_alpha", mob_id, "keys.png", f"{k_partial} partial alpha pixels in keys.png")
            if k_dirty0 > 0:
                add_exc("error", "keys_dirty_transparent", mob_id, "keys.png", f"{k_dirty0} dirty RGB pixels under alpha=0 in keys.png")
            if k_off_global > 0:
                add_exc("error", "keys_off_global_palette", mob_id, "keys.png", f"{k_off_global} pixels outside 40-color palette.json")
            if k_off_mob > 0:
                add_exc("warn", "keys_off_mob_palette", mob_id, "keys.png", f"{k_off_mob} pixels outside mob's manifest palette_refs")

            gutter_mask = np.ones((kh, kw), dtype=bool)
            for krec in spec["keys"]:
                sx, sy = int(krec["sheet_xy"][0]), int(krec["sheet_xy"][1])
                gutter_mask[sy:sy + 32, sx:sx + 32] = False
            gutter_leak = int((ka[gutter_mask] > 0).sum())
            if gutter_leak > 0:
                add_exc("error", "keys_gutter_leak", mob_id, "keys.png", f"{gutter_leak} non-transparent pixels in keys.png gutters")

            crops = [(k["facing"], k["pose"], k["crop_xyxy"]) for k in spec["keys"]]
            for i in range(len(crops)):
                for j in range(i + 1, len(crops)):
                    a_b, b_b = crops[i][2], crops[j][2]
                    if a_b[0] < b_b[2] and a_b[2] > b_b[0] and a_b[1] < b_b[3] and a_b[3] > b_b[1]:
                        add_exc("error", "source_crop_overlap", mob_id, f"{crops[i][0]}/{crops[i][1]} vs {crops[j][0]}/{crops[j][1]}", f"Overlapping source crops {a_b} and {b_b}")

            ax, ay = int(spec["anchor_px"][0]), int(spec["anchor_px"][1])
            west_ax = 31 - ax
            seen_bytes = set()
            key_metrics = []
            thick_keys = []

            for krec in spec["keys"]:
                facing = krec["facing"]
                pose = krec["pose"]
                sx, sy = int(krec["sheet_xy"][0]), int(krec["sheet_xy"][1])
                crop = [int(v) for v in krec["crop_xyxy"]]
                gxy = [int(v) for v in krec["ground_xy"]]
                pkey = f"{facing}/{pose}"

                tile = karr[sy:sy + 32, sx:sx + 32]
                tbytes = tile.tobytes()
                if tbytes in seen_bytes:
                    add_exc("error", "duplicate_key_frame", mob_id, pkey, "Identical pixel bytes to another key in keys.png")
                seen_bytes.add(tbytes)

                op = tile[..., 3] == 255
                ys, xs = np.nonzero(op)
                if len(xs) == 0:
                    add_exc("error", "empty_key_frame", mob_id, pkey, "Empty 32x32 key frame")
                    continue

                bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
                bw, bh = bx1 - bx0 + 1, by1 - by0 + 1
                head_band = ys <= (by0 + max(2, int(bh * 0.35)))
                head_cx = float(xs[head_band].mean())
                com_x, com_y = float(xs.mean()), float(ys.mean())
                src_w = crop[2] - crop[0]
                src_cx = 0.5 * (crop[0] + crop[2] - 1)
                src_ground_offset = gxy[0] - src_cx
                src_ground_offset_frac = src_ground_offset / max(1.0, float(src_w))

                ol = op & (tile[..., 0] == outline_rgb[0]) & (tile[..., 1] == outline_rgb[1]) & (tile[..., 2] == outline_rgb[2])
                edge4 = neighbors_transparent_4(op)
                gap4 = int((op & edge4 & ~ol).sum())
                blk2x2 = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
                edge_cnt = int((op & edge4).sum())
                thick_ratio = int((ol & ~edge4).sum()) / max(1, edge_cnt)
                comps = connected_components_8(op)
                specks = sum(len(cp) for cp in comps if len(cp) <= 2)

                edge_touches = [s for s, cond in (("left", bx0 == 0), ("right", bx1 == 31), ("top", by0 == 0)) if cond]
                ground_ok = (by1 == ay)
                if not ground_ok:
                    add_exc("error", "ground_contact_mismatch", mob_id, pkey, f"Lowest opaque row y={by1} != anchor_px[1]={ay}")
                if gxy[1] != crop[3] - 1:
                    add_exc("error", "source_ground_y_mismatch", mob_id, pkey, f"ground_xy[1]={gxy[1]} != crop_xyxy[3]-1={crop[3]-1}")
                if gap4 > 0:
                    add_exc("error", "outline_gap_4conn", mob_id, pkey, f"{gap4} silhouette edge pixels missing #14101a outline")
                if edge_touches:
                    add_exc("warn", "frame_edge_touch", mob_id, pkey, f"Native 32x32 frame touches {', '.join(edge_touches)} edge (bbox={bx0},{by0}..{bx1},{by1})")
                if specks > 0:
                    add_exc("warn", "detached_speckle", mob_id, pkey, f"{specks} detached 1-2px pixel(s) across {len(comps)} components")
                if int(blk2x2.sum()) >= 12 or thick_ratio >= 0.45:
                    thick_keys.append(pkey)

                west_bbox = [31 - bx1, by0, 31 - bx0, by1] if facing == "east" else None
                key_metrics.append({
                    "facing": facing,
                    "pose": pose,
                    "sheet_xy": [sx, sy],
                    "crop_xyxy": crop,
                    "ground_xy": gxy,
                    "native_bbox": [bx0, by0, bx1, by1],
                    "native_size": [bw, bh],
                    "head_cx": round(head_cx, 2),
                    "com_xy": [round(com_x, 2), round(com_y, 2)],
                    "head_minus_anchor_x": round(head_cx - ax, 2),
                    "source_ground_offset_px": round(src_ground_offset, 1),
                    "source_ground_offset_frac": round(src_ground_offset_frac, 3),
                    "bottom_y": by1,
                    "ground_contact_ok": ground_ok,
                    "edge_touches": edge_touches,
                    "components": len(comps),
                    "speckle_px": specks,
                    "outline_gap_4conn": gap4,
                    "outline_2x2_blocks": int(blk2x2.sum()),
                    "interior_ink_to_edge_ratio": round(thick_ratio, 3),
                    "west_mirrored_bbox": west_bbox,
                })

            if thick_keys:
                add_exc(
                    "warn",
                    "thick_outline_advisory",
                    mob_id,
                    f"{len(thick_keys)}/12 keys",
                    f"Elevated interior #14101a / 2x2 ink blocks on {len(thick_keys)} keys ({', '.join(thick_keys[:5])}{'...' if len(thick_keys)>5 else ''}); overall ink share {ink_share:.1%}.",
                )

            row_stability = {}
            for facing in EXPECTED_FACINGS:
                rm = [k for k in key_metrics if k["facing"] == facing]
                if not rm:
                    continue
                hxs = [k["head_cx"] for k in rm]
                cxs = [k["com_xy"][0] for k in rm]
                bys = [k["bottom_y"] for k in rm]
                hx_span = round(max(hxs) - min(hxs), 2)
                cx_span = round(max(cxs) - min(cxs), 2)
                outlier = max(rm, key=lambda k: abs(k["head_cx"] - ax))
                row_stability[facing] = {
                    "bottom_y_range": [min(bys), max(bys)],
                    "head_x_range": [round(min(hxs), 2), round(max(hxs), 2)],
                    "head_x_drift_px": hx_span,
                    "com_x_drift_px": cx_span,
                    "head_x_outlier_pose": outlier["pose"],
                    "head_x_outlier_offset_px": outlier["head_minus_anchor_x"],
                }
                if hx_span > 3.5:
                    og = outlier["ground_xy"]
                    shift_src = int(round(outlier["head_minus_anchor_x"] / float(spec["scale"])))
                    add_exc(
                        "warn",
                        "head_pivot_drift",
                        mob_id,
                        f"{facing}/{outlier['pose']}",
                        f"Head X drifts {hx_span:.2f} native px across {facing} key poses (outlier {facing}/{outlier['pose']}: head_cx={outlier['head_cx']} vs anchor_x={ax}, offset={outlier['head_minus_anchor_x']:+.2f}px; source ground_xy[0]={og[0]} sits {outlier['source_ground_offset_frac']:+.0%} of crop width).",
                        proposal={"suggested_ground_xy_x": og[0] + shift_src, "current_ground_xy": og},
                    )

            have_pairs = {(k["facing"], k["pose"]) for k in spec["keys"]}
            want_pairs = {(f, p) for f in EXPECTED_FACINGS for p in EXPECTED_KEYS_ORDER}
            missing_pairs = sorted(want_pairs - have_pairs)
            if missing_pairs:
                add_exc("error", "missing_key_poses", mob_id, "poses.json", f"Missing required key poses: {missing_pairs}")

            # Optional timing.json validation
            timing_spec = None
            timing_path = mdir / "timing.json"
            timing_summary = {"present": False, "filled_slots": 0, "open_slots": 0, "total_slots": 0}
            if timing_path.is_file():
                timing_spec = json.loads(timing_path.read_text(encoding="utf-8"))
                timing_summary["present"] = True
                t_facings = timing_spec.get("facings") or EXPECTED_FACINGS
                valid_poses = {k["pose"] for k in spec["keys"]}
                for cname, cdef in (timing_spec.get("clips") or {}).items():
                    slots = cdef.get("pose_at_index") or []
                    for sidx, sname in enumerate(slots):
                        if sname is not None and sname not in valid_poses:
                            add_exc("error", "timing_unknown_pose", mob_id, f"{cname}[{sidx}]", f"timing.json references unknown pose '{sname}'")
                    n_fill = sum(1 for s in slots if s is not None) * len(t_facings)
                    n_tot = len(slots) * len(t_facings)
                    timing_summary["filled_slots"] += n_fill
                    timing_summary["open_slots"] += (n_tot - n_fill)
                    timing_summary["total_slots"] += n_tot
                    if m_asset and cname in (m_asset.get("animations") or {}):
                        want_f = int(m_asset["animations"][cname]["frames"])
                        if len(slots) != want_f:
                            add_exc("error", "timing_clip_length_mismatch", mob_id, cname, f"timing.json {cname} length {len(slots)} != manifest {want_f}")

            # Full 36-frame runtime.json + frames/ audit if present!
            rt_path = mdir / "runtime.json"
            runtime_report = {"present": False, "total_frames": 0}
            runtime_strip_im = None
            if rt_path.is_file() and (mdir / "frames").is_dir():
                rt_spec = json.loads(rt_path.read_text(encoding="utf-8"))
                runtime_report, runtime_strip_im, packed_rects = _audit_runtime_frames(
                    mdir, mob_id, rt_spec, m_asset, global_pal, outline_rgb, add_exc
                )
                assembly = build_mob_clips_from_runtime(mob_id, rt_spec, packed_rects)
                runtime_mob_ids.append(mob_id)
                # Update slot coverage to reflect full 36/36 runtime frames!
                timing_summary["runtime_filled_slots"] = runtime_report["total_frames"]
                timing_summary["runtime_open_slots"] = max(0, timing_summary["total_slots"] - runtime_report["total_frames"])
            else:
                assembly = build_mob_clips_from_keys(mob_id, spec, m_asset, timing_spec)
                timing_summary["runtime_filled_slots"] = timing_summary["filled_slots"]
                timing_summary["runtime_open_slots"] = timing_summary["open_slots"]

            mob_reports[mob_id] = {
                "id": mob_id,
                "name": spec.get("name", mob_id),
                "tier": assembly["tier"],
                "source_sha256": spec.get("source_sha256"),
                "source_sha256_verified": sha_ok,
                "canvas": spec["canvas"],
                "scale": spec["scale"],
                "anchor_px": [ax, ay],
                "west_mirrored_anchor_px": [west_ax, ay],
                "keys_sheet_size": [kw, kh],
                "timing_contract": timing_summary,
                "keys_hygiene": {
                    "partial_alpha_px": k_partial,
                    "dirty_transparent_px": k_dirty0,
                    "off_global_palette_px": k_off_global,
                    "off_mob_palette_px": k_off_mob,
                    "gutter_leak_px": gutter_leak,
                    "opaque_px": int(len(op_px)),
                    "ink_outline_share": round(ink_share, 4),
                },
                "row_stability": row_stability,
                "keys": key_metrics,
                "runtime_frames": runtime_report,
                "assembly": assembly,
            }
            images_cache[mob_id] = {
                "keys_im": keys_im.copy(),
                "runtime_strip_im": runtime_strip_im.copy() if runtime_strip_im is not None else None,
                "source_im": src_im.copy() if src_im is not None else None,
            }

        repo_compat = _check_repo_pipeline_compat(work_root, runtime_mob_ids) if run_repo_compat else {"checked": False}
        if repo_compat.get("checked"):
            if repo_compat["qa_assets_rc"] != 0:
                add_exc("error", "repo_qa_assets_failed", "package", "qa_assets.py", f"qa_assets.py exited {repo_compat['qa_assets_rc']}: {repo_compat.get('qa_assets_summary')}")
            if repo_compat["pack_atlases_rc"] != 0:
                add_exc("error", "repo_pack_atlases_failed", "package", "pack_atlases.py", f"pack_atlases.py exited {repo_compat['pack_atlases_rc']}: {repo_compat.get('pack_atlases_summary')}")

        sev_counts = Counter(e["severity"] for e in exceptions)
        report = {
            "schema": "tien-nghich-2d.heng-yue-mob-assembly-qa",
            "version": 3,
            "source_package": source_path.name,
            "archive_sha256": archive_sha256,
            "assembly_json_verification": assembly_json_check,
            "summary": {
                "mobs_checked": len(mob_reports),
                "mob_ids": list(mob_reports.keys()),
                "full_runtime_mobs": runtime_mob_ids,
                "total_runtime_frames": sum(m["runtime_frames"]["total_frames"] for m in mob_reports.values()),
                "total_verified_keys": sum(len(m["keys"]) for m in mob_reports.values()),
                "manifest_filled_slots": sum(m["timing_contract"]["runtime_filled_slots"] for m in mob_reports.values()),
                "manifest_open_slots": sum(m["timing_contract"]["runtime_open_slots"] for m in mob_reports.values()),
                "manifest_total_slots": sum(m["timing_contract"]["total_slots"] for m in mob_reports.values()),
                "errors": sev_counts.get("error", 0),
                "warnings": sev_counts.get("warn", 0),
                "info": sev_counts.get("info", 0),
            },
            "repo_pipeline_compat": repo_compat,
            "mobs": mob_reports,
            "exceptions": exceptions,
        }
        return report, images_cache
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


def build_pilot_runtime_contact_sheet(report: dict, images_cache: dict, out_path: Path) -> None:
    """Build dedicated annotated contact sheet for full 36-frame runtime pilot mobs (3x + 1x, S/E/W-flip)."""
    runtime_mobs = [m for m in report["mobs"].values() if m["runtime_frames"].get("present")]
    if not runtime_mobs:
        return

    pad = 12
    title_h = 44
    zoom = 3
    mag_sz = 32 * zoom  # 96
    nat_sz = 32
    col_w = mag_sz + nat_sz + 10
    row_h = mag_sz + 28
    sections: list[Image.Image] = []

    for mrep in runtime_mobs:
        mob_id = mrep["id"]
        strip = images_cache[mob_id]["runtime_strip_im"]
        if strip is None:
            continue
        ax, ay = mrep["anchor_px"]
        wax, _ = mrep["west_mirrored_anchor_px"]
        fmetrics = {f["filename"]: f for f in mrep["runtime_frames"]["frames"]}
        clips = mrep["assembly"]["clips"]

        rows_spec = []
        for cname in RUNTIME_CLIP_ORDER:
            if cname not in clips:
                continue
            for dlabel, dkey in ((f"{cname} · south", "south"), (f"{cname} · east", "east"), (f"{cname} · west(flip)", "west")):
                rows_spec.append((dlabel, cname, dkey))

        max_cols = max(len(clips[c]["directions"]["south"]) for c in RUNTIME_CLIP_ORDER if c in clips)
        sec_w = pad * 2 + 132 + max_cols * col_w
        sec_h = 40 + len(rows_spec) * row_h + pad
        sec = Image.new("RGBA", (sec_w, sec_h), (20, 17, 26, 255))
        draw = ImageDraw.Draw(sec)

        hyg = mrep["runtime_frames"]["hygiene"]
        hdr = (
            f"{mob_id} ({mrep['name']})  |  36/36 FULL RUNTIME FRAMES  |  "
            f"anchor={mrep['anchor_px']}  west_anchor={mrep['west_mirrored_anchor_px']}  ink={hyg['ink_outline_share']*100:.1f}%"
        )
        draw.text((pad, 8), hdr, fill=(242, 233, 214, 255))
        draw.text(
            (pad, 22),
            "3x magnified + 1x native | K=keys.png, P=progression-source.png | Cyan+=root pivot, Gold=y=31 ground, Red=edge touch",
            fill=(160, 156, 172, 255),
        )

        for r_idx, (dlabel, cname, dkey) in enumerate(rows_spec):
            oy = 40 + r_idx * row_h
            frames = clips[cname]["directions"][dkey]
            cur_ax = wax if dkey == "west" else ax
            draw.text((pad, oy + 36), dlabel, fill=(212, 208, 226, 255))
            draw.text((pad, oy + 52), f"piv=[{cur_ax},{ay}]", fill=(138, 232, 255, 255))

            for c_idx, fr in enumerate(frames):
                ox = pad + 132 + c_idx * col_w
                sx, sy, sw, sh = fr["sheet_rect"]
                tile = strip.crop((sx, sy, sx + sw, sy + sh))
                if fr["mirror_x"]:
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

                bg = _checker_bg(mag_sz, mag_sz, 8)
                dm = ImageDraw.Draw(bg)
                scx, scy = (cur_ax + 0.5) * zoom, (ay - 0.5) * zoom
                dm.ellipse([scx - 9 * zoom, scy - 2.5 * zoom, scx + 9 * zoom, scy + 2.5 * zoom], fill=(16, 13, 22, 150))
                bg.alpha_composite(tile.resize((mag_sz, mag_sz), Image.Resampling.NEAREST), (0, 0))
                dm = ImageDraw.Draw(bg)
                dm.line([(0, mag_sz - 1), (mag_sz - 1, mag_sz - 1)], fill=(224, 176, 48, 200), width=1)
                px_c, py_c = int((cur_ax + 0.5) * zoom), int((ay + 0.5) * zoom)
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

                src_tag = "K" if fr["source_file"] == "keys.png" else "P"
                flags = []
                if not fr["mirror_x"] and abs(fm.get("head_minus_anchor_x", 0)) > 3.2 and cname != "death":
                    flags.append(f"dX{fm['head_minus_anchor_x']:+.1f}")
                if touches:
                    flags.append("EDGE")
                col_txt = (245, 215, 101, 255) if flags else (196, 192, 210, 255)
                ftxt = f"[{c_idx}:{src_tag}]" + (f" {' '.join(flags)}" if flags else f" {fr['duration_ms']}ms")
                draw.text((ox, oy + 1), ftxt, fill=col_txt)

        sections.append(sec)

    total_w = max(s.width for s in sections)
    total_h = title_h + sum(s.height + 8 for s in sections)
    sheet = Image.new("RGBA", (total_w, total_h), (14, 12, 20, 255))
    dtop = ImageDraw.Draw(sheet)
    s = report["summary"]
    dtop.text(
        (pad, 8),
        f"TIEN NGHICH 2D · HENG YUE PILOT FULL-RUNTIME QA SHEET  |  mobs={len(runtime_mobs)} frames={s['total_runtime_frames']} errors={s['errors']} warnings={s['warnings']}",
        fill=(255, 240, 176, 255),
    )
    dtop.text(
        (pad, 24),
        "All 4 clips (idle 4f, move 6f, attack 4f, death 4f) assembled from Codex frames (north reuses south). K=keys.png, P=progression-source.png.",
        fill=(157, 152, 164, 255),
    )
    y_cur = title_h
    for sec in sections:
        sheet.alpha_composite(sec, (0, y_cur))
        y_cur += sec.height + 8
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out_path)


def build_mob_contact_sheet(report: dict, images_cache: dict, out_path: Path) -> None:
    """Build 5-mob 12-key overview sheet across S, E, W(mirrored), N(reuses S)."""
    pad = 12
    title_h = 44
    sections: list[Image.Image] = []

    for mob_id, mrep in report["mobs"].items():
        keys_im = images_cache[mob_id]["keys_im"]
        ax, ay = mrep["anchor_px"]
        wax, _ = mrep["west_mirrored_anchor_px"]
        kmap = {(k["facing"], k["pose"]): k for k in mrep["keys"]}

        zoom = 4
        nat_sz = 32
        mag_sz = 32 * zoom
        col_w = mag_sz + nat_sz + 14
        row_h = mag_sz + 32
        dir_rows = [
            ("south", "south", False, ax),
            ("east", "east", False, ax),
            ("west (mirror E)", "east", True, wax),
            ("north (reuse S)", "south", False, ax),
        ]
        sec_w = pad * 2 + 120 + len(EXPECTED_KEYS_ORDER) * col_w
        sec_h = 42 + len(dir_rows) * row_h + pad
        sec = Image.new("RGBA", (sec_w, sec_h), (20, 17, 26, 255))
        draw = ImageDraw.Draw(sec)

        tier_tag = "36f FULL RUNTIME" if mrep["tier"] == "full_runtime_36f" else "12f KEYS ONLY"
        hdr = (
            f"{mob_id} ({mrep['name']})  |  {tier_tag}  |  anchor={mrep['anchor_px']}  "
            f"west_anchor={mrep['west_mirrored_anchor_px']}  ink={mrep['keys_hygiene']['ink_outline_share']*100:.1f}%"
        )
        draw.text((pad, 8), hdr, fill=(242, 233, 214, 255))
        draw.text(
            (pad, 22),
            "4x magnified (left) + 1x native (right) | Cyan+ = registered anchor, Gold line = y=31 ground",
            fill=(160, 156, 172, 255),
        )

        for r_idx, (dlabel, src_dir, mirror, cur_ax) in enumerate(dir_rows):
            oy = 42 + r_idx * row_h
            draw.text((pad, oy + 52), dlabel, fill=(210, 206, 224, 255))
            draw.text((pad, oy + 68), f"piv=[{cur_ax},{ay}]", fill=(138, 232, 255, 255))

            for c_idx, pose in enumerate(EXPECTED_KEYS_ORDER):
                ox = pad + 120 + c_idx * col_w
                km = kmap.get((src_dir, pose))
                if not km:
                    continue
                sx, sy = km["sheet_xy"]
                tile = keys_im.crop((sx, sy, sx + 32, sy + 32))
                if mirror:
                    tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

                bg4 = _checker_bg(mag_sz, mag_sz, 8)
                d4 = ImageDraw.Draw(bg4)
                scx, scy = (cur_ax + 0.5) * zoom, (ay - 0.5) * zoom
                d4.ellipse([scx - 9 * zoom, scy - 2.5 * zoom, scx + 9 * zoom, scy + 2.5 * zoom], fill=(16, 13, 22, 150))
                bg4.alpha_composite(tile.resize((mag_sz, mag_sz), Image.Resampling.NEAREST), (0, 0))
                d4 = ImageDraw.Draw(bg4)
                d4.line([(0, mag_sz - 1), (mag_sz - 1, mag_sz - 1)], fill=(224, 176, 48, 200), width=1)
                px_c, py_c = int((cur_ax + 0.5) * zoom), int((ay + 0.5) * zoom)
                d4.line([(px_c - 8, py_c), (px_c + 8, py_c)], fill=(138, 232, 255, 255), width=1)
                d4.line([(px_c, py_c - 8), (px_c, py_c + 8)], fill=(138, 232, 255, 255), width=1)
                sec.alpha_composite(bg4, (ox, oy + 14))

                bg1 = _checker_bg(nat_sz, nat_sz, 4)
                bg1.alpha_composite(tile, (0, 0))
                sec.alpha_composite(bg1, (ox + mag_sz + 4, oy + 14 + (mag_sz - nat_sz) // 2))

                flags = []
                if abs(km["head_minus_anchor_x"]) > 3.0 and not mirror:
                    flags.append(f"dX{km['head_minus_anchor_x']:+.1f}")
                if km["edge_touches"]:
                    flags.append("EDGE")
                col_txt = (245, 215, 101, 255) if flags else (200, 196, 212, 255)
                tag = f" [{' '.join(flags)}]" if flags else ""
                draw.text((ox, oy), f"{pose}{tag}", fill=col_txt)

        sections.append(sec)

    if not sections:
        return
    total_w = max(s.width for s in sections)
    total_h = title_h + sum(s.height + 8 for s in sections)
    sheet = Image.new("RGBA", (total_w, total_h), (14, 12, 20, 255))
    dtop = ImageDraw.Draw(sheet)
    s = report["summary"]
    dtop.text(
        (pad, 8),
        f"TIEN NGHICH 2D · HENG YUE 5-MOB KEY OVERVIEW  |  mobs={s['mobs_checked']} runtime_frames={s['total_runtime_frames']} errors={s['errors']} warnings={s['warnings']}",
        fill=(255, 240, 176, 255),
    )
    dtop.text(
        (pad, 24),
        "West=mirrored East (x->31-x); North=reused South. Pilot mobs (disciple, viper) also include full 36f runtime sheet.",
        fill=(157, 152, 164, 255),
    )
    y_cur = title_h
    for sec in sections:
        sheet.alpha_composite(sec, (0, y_cur))
        y_cur += sec.height + 8
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(out_path)


def _img_to_data_uri(im: Image.Image) -> str:
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def build_mob_html_workbench(report: dict, images_cache: dict, out_path: Path) -> None:
    """Generate consolidated interactive browser Animation QA Workbench supporting full 36f pilots + 12f key mobs."""
    art_uris = {}
    for mob_id, mrep in report["mobs"].items():
        if mrep["assembly"]["atlas_kind"] == "runtime_strip_png" and images_cache[mob_id]["runtime_strip_im"] is not None:
            art_uris[mob_id] = _img_to_data_uri(images_cache[mob_id]["runtime_strip_im"])
        else:
            art_uris[mob_id] = _img_to_data_uri(images_cache[mob_id]["keys_im"])

    payload_json = json.dumps({"report": report, "sheets": art_uris}, ensure_ascii=True).replace("<", r"\u003c")
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Heng Yue Mobs · Full Runtime Pilot &amp; Key-Pose Animation QA</title>
<style>
  :root {{
    --bg: #111018; --card: #1a1724; --line: #322c42; --fg: #eee9f4;
    --muted: #9e97ad; --accent: #8ae8ff; --ok: #5cc796; --warn: #f5d765; --err: #ff6b63;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }}
  header {{ padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; background: #161320; }}
  header h1 {{ margin: 0; font-size: 16px; }}
  .chips {{ display: flex; gap: 8px; flex-wrap: wrap; }}
  .chip {{ padding: 3px 9px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid var(--line); }}
  .chip.ok {{ background: rgba(92,199,150,.15); color: var(--ok); border-color: rgba(92,199,150,.45); }}
  .chip.warn {{ background: rgba(245,215,101,.14); color: var(--warn); border-color: rgba(245,215,101,.45); }}
  .chip.err {{ background: rgba(255,107,99,.16); color: var(--err); border-color: rgba(255,107,99,.45); }}
  main {{ padding: 16px 18px 28px; display: grid; gap: 16px; max-width: 1360px; margin: 0 auto; }}
  .grid2 {{ display: grid; grid-template-columns: minmax(380px, 1.35fr) minmax(320px, 1fr); gap: 16px; align-items: start; }}
  @media (max-width: 960px) {{ .grid2 {{ grid-template-columns: 1fr; }} }}
  .panel {{ background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }}
  .panel h2 {{ margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }}
  .toolbar {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }}
  select, button {{ background: #241f31; color: var(--fg); border: 1px solid var(--line); border-radius: 5px; padding: 5px 9px; font: inherit; cursor: pointer; }}
  button.primary {{ background: #224658; border-color: #3f7e9c; color: #e8fdff; }}
  button.strike {{ background: #5a1f2d; border-color: #a51d35; color: #ffd9dd; }}
  button.death {{ background: #3b234d; border-color: #6a3fa8; color: #e3d6fb; }}
  button:disabled {{ opacity: .45; cursor: not-allowed; }}
  label.tog {{ display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }}
  .stage-wrap {{ display: flex; flex-wrap: wrap; gap: 18px; align-items: center; justify-content: center; background: #14101a; border: 1px solid var(--line); border-radius: 6px; padding: 14px; }}
  .stage-box {{ text-align: center; }}
  .stage-box canvas {{ image-rendering: pixelated; border: 1px solid #3c354d; display: block; margin: 0 auto; }}
  .cap {{ margin-top: 6px; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }}
  .turntable {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }}
  @media (max-width: 680px) {{ .turntable {{ grid-template-columns: repeat(2, 1fr); }} }}
  .tt-cell {{ background: #14101a; border: 1px solid var(--line); border-radius: 6px; padding: 8px; text-align: center; }}
  .tt-cell canvas {{ image-rendering: pixelated; display: block; margin: 0 auto; }}
  .timeline {{ display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }}
  .tl-step {{ padding: 4px 8px; border-radius: 5px; border: 1px solid var(--line); background: #201b2d; font-size: 11px; font-family: ui-monospace, monospace; cursor: pointer; }}
  .tl-step.active {{ border-color: var(--accent); background: rgba(138,232,255,.15); color: #e8fdff; }}
  .kv {{ display: grid; grid-template-columns: 150px 1fr; gap: 4px 10px; font-size: 12px; }}
  .kv span {{ color: var(--muted); }}
  .kv code {{ font-family: ui-monospace, monospace; color: var(--accent); word-break: break-word; }}
  .notice {{ margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: rgba(92,199,150,.10); border: 1px solid rgba(92,199,150,.32); color: #d2f5de; font-size: 12px; }}
  .notice.gap {{ background: rgba(245,215,101,.09); border-color: rgba(245,215,101,.32); color: #f6e7ad; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }}
  th {{ color: var(--muted); }}
  .sev-error {{ color: var(--err); font-weight: 700; }}
  .sev-warn {{ color: var(--warn); font-weight: 700; }}
  .mono {{ font-family: ui-monospace, monospace; font-size: 11px; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Heng Yue Mobs · Full Runtime Pilot &amp; Key-Pose Animation QA</h1>
    <div style="color:var(--muted);font-size:12px;">Assembled strictly from Codex verified 32×32 artwork (zero generated/repainted pixels) · Native 1× + Magnified · S/E + West Flip (31−x) + North Reuse</div>
  </div>
  <div id="chips" class="chips"></div>
</header>
<main>
  <section class="grid2">
    <div class="panel">
      <h2>Live Dual-Scale Animation Assembly (Native 1× + Magnified)</h2>
      <div class="toolbar">
        <select id="sel-mob"></select>
        <select id="sel-clip"></select>
        <select id="sel-dir">
          <option value="south">south (authored)</option>
          <option value="east">east (authored)</option>
          <option value="west">west (mirrored E · x=31−ax)</option>
          <option value="north">north (reuses S)</option>
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
        <label class="tog"><input id="chk-pivot" type="checkbox" checked /> Pivot</label>
        <label class="tog"><input id="chk-shadow" type="checkbox" checked /> Shadow</label>
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
          <div class="cap">Native 1× (32×32 on ground)</div>
        </div>
      </div>
      <div id="timeline" class="timeline"></div>
      <h2 style="margin-top:14px;">All 4 Runtime Directions In Sync (3×)</h2>
      <div class="turntable">
        <div class="tt-cell"><canvas id="tt-south" width="96" height="96"></canvas><div class="cap">south (authored)</div></div>
        <div class="tt-cell"><canvas id="tt-east" width="96" height="96"></canvas><div class="cap">east (authored)</div></div>
        <div class="tt-cell"><canvas id="tt-west" width="96" height="96"></canvas><div class="cap">west (flip E · 31−x)</div></div>
        <div class="tt-cell"><canvas id="tt-north" width="96" height="96"></canvas><div class="cap">north (reuses S)</div></div>
      </div>
    </div>

    <div class="panel">
      <h2>Active Frame &amp; Registration Contract</h2>
      <div id="frame-kv" class="kv"></div>
      <div id="gap-note" class="notice"></div>
      <h2 style="margin-top:14px;">Manifest Clip Coverage (Exact Authored Frames)</h2>
      <table>
        <thead><tr><th>Clip</th><th>Mode</th><th>Authored</th><th>Status</th></tr></thead>
        <tbody id="cov-body"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <h2>Independent QA Findings &amp; Registration Advisories</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Sev</th><th>Mob</th><th>Target</th><th>Code</th><th>Detail</th><th>Proposed Correction</th></tr></thead>
        <tbody id="exc-body"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
const DATA = {payload_json};
function markup(parts, ...values) {{
  const entities = {{'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}};
  return parts.reduce((out, part, i) => out + (i ? String(values[i-1]).replace(/[&<>"']/g, ch => entities[ch]) : '') + part, '');
}}
const REPORT = DATA.report;
const SHEETS = DATA.sheets;
const imgs = {{}};
const $ = (id) => document.getElementById(id);

let mobId = (REPORT.summary.full_runtime_mobs && REPORT.summary.full_runtime_mobs[0]) || REPORT.summary.mob_ids[0];
let clipName = 'move';
let dir = 'south';
let frameIdx = 0;
let playing = true;
let elapsed = 0;
let oneshotDone = false;

function loadImg(uri) {{
  return new Promise((res, rej) => {{ const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = uri; }});
}}

function drawChecker(ctx, x0, y0, w, h, step) {{
  for (let y = 0; y < h; y += step) {{
    for (let x = 0; x < w; x += step) {{
      ctx.fillStyle = (((x / step) + (y / step)) & 1) ? '#231e2e' : '#1b1724';
      ctx.fillRect(x0 + x, y0 + y, Math.min(step, w - x), Math.min(step, h - y));
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
  const entries = Object.entries(mob.assembly.clips).filter(([, c]) => c.directions && Object.keys(c.directions).length > 0);
  if (!entries.some(([k]) => k === clipName)) clipName = entries[0]?.[0] || 'idle';
  $('sel-clip').innerHTML = entries.map(([k, c]) => markup`<option value="${{k}}" ${{k===clipName?'selected':''}}>${{k}} (${{c.mode}} · ${{c.directions.south.length}}f)</option>`).join('');
  const hasDeath = !!(mob.assembly.clips.death && mob.assembly.clips.death.directions && mob.assembly.clips.death.directions.south);
  $('btn-death').disabled = !hasDeath;
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

function drawStage() {{
  const mob = REPORT.mobs[mobId];
  const clip = getClip();
  const frames = getFrames(dir);
  if (!mob || !frames.length) return;
  const idx = frameIdx % frames.length;
  const fr = frames[idx];
  const prevFr = frames[(idx - 1 + frames.length) % frames.length];
  const z = Number($('sel-zoom').value);
  const pad = 16;
  const mw = 32 * z + pad * 2;
  const mh = 32 * z + pad * 2;

  const cv = $('cv-mag');
  if (cv.width !== mw || cv.height !== mh) {{ cv.width = mw; cv.height = mh; }}
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14101a';
  ctx.fillRect(0, 0, mw, mh);
  drawChecker(ctx, pad, pad, 32 * z, 32 * z, Math.max(4, z * 2));

  const gx = fr.ground_px[0], gy = fr.ground_px[1];
  const px = pad + gx * z, py = pad + gy * z;

  if ($('chk-shadow').checked) {{
    ctx.fillStyle = 'rgba(14,10,20,0.72)';
    ctx.beginPath();
    ctx.ellipse(px + z * 0.5, py, 9 * z, 2.5 * z, 0, 0, Math.PI * 2);
    ctx.fill();
  }}
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
    ctx.strokeStyle = 'rgba(224,176,48,0.65)';
    ctx.beginPath(); ctx.moveTo(pad, pad + 32 * z - 0.5); ctx.lineTo(pad + 32 * z, pad + 32 * z - 0.5); ctx.stroke();
    ctx.strokeStyle = '#8ae8ff';
    ctx.beginPath();
    ctx.moveTo(px + z * 0.5 - 9, py + z * 0.5); ctx.lineTo(px + z * 0.5 + 9, py + z * 0.5);
    ctx.moveTo(px + z * 0.5, py + z * 0.5 - 9); ctx.lineTo(px + z * 0.5, py + z * 0.5 + 9);
    ctx.stroke();
  }}
  $('cap-mag').textContent = `${{mob.id}} · ${{clipName}}[${{idx}}/${{frames.length - 1}}] · ${{dir}} · ${{fr.beat || fr.pose}} (${{fr.duration_ms}}ms) @ ${{z}}×`;

  const ncv = $('cv-nat');
  const nctx = ncv.getContext('2d');
  nctx.imageSmoothingEnabled = false;
  nctx.fillStyle = '#383340';
  nctx.fillRect(0, 0, 64, 64);
  nctx.fillStyle = '#2c2733';
  for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) nctx.strokeRect(x + 0.5, y + 0.5, 15, 15);
  nctx.fillStyle = 'rgba(20,16,26,0.55)';
  nctx.beginPath(); nctx.ellipse(32, 48, 8, 2.5, 0, 0, Math.PI * 2); nctx.fill();
  renderSpriteOn(nctx, mob, fr, 32, 48, 1, 1.0);

  for (const td of ['south', 'east', 'west', 'north']) {{
    const tcv = $('tt-' + td);
    const tctx = tcv.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    drawChecker(tctx, 0, 0, 96, 96, 8);
    const tframes = getFrames(td);
    const tfr = tframes[idx % tframes.length];
    if (tfr) {{
      const tx = tfr.ground_px[0] * 3, ty = tfr.ground_px[1] * 3;
      if ($('chk-shadow').checked) {{
        tctx.fillStyle = 'rgba(14,10,20,0.68)';
        tctx.beginPath(); tctx.ellipse(tx + 1.5, ty, 27, 7, 0, 0, Math.PI * 2); tctx.fill();
      }}
      renderSpriteOn(tctx, mob, tfr, tx, ty, 3, 1.0);
      if ($('chk-pivot').checked) {{
        tctx.strokeStyle = '#8ae8ff';
        tctx.beginPath(); tctx.moveTo(tx - 5, ty + 1.5); tctx.lineTo(tx + 8, ty + 1.5); tctx.stroke();
      }}
    }}
  }}

  $('timeline').innerHTML = frames.map((f, i) => markup`
    <span class="tl-step ${{i===idx?'active':''}}" data-idx="${{i}}">${{i}}: ${{f.beat || f.pose}} (${{f.duration_ms}}ms) [${{f.source_file==='keys.png'?'K':'P'}}]</span>
  `).join('');
  document.querySelectorAll('.tl-step').forEach(el => {{
    el.onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; frameIdx = Number(el.dataset.idx); drawStage(); }};
  }});

  const hyg = mob.runtime_frames?.present ? mob.runtime_frames.hygiene : mob.keys_hygiene;
  $('frame-kv').innerHTML = markup`
    <span>Mob / Tier</span><code>${{mob.id}} (${{mob.tier}})</code>
    <span>Contract Key</span><code>${{fr.source_key}}</code>
    <span>Source Origin</span><code>${{fr.filename || fr.pose}} ← ${{fr.source_file}}</code>
    <span>Beat Role</span><code>${{fr.beat || fr.role}}</code>
    <span>Ground Pivot</span><code>[${{fr.ground_px.join(', ')}}]${{fr.mirror_x ? ' (flipped 31−' + mob.anchor_px[0] + ')' : ''}}</code>
    <span>Transform</span><code>${{fr.mirror_x ? 'mirror_x(east)' : (dir==='north' ? 'reuse(south)' : 'direct')}}</code>
    <span>Pixel Hygiene</span><code>alpha=0/255, dirty0=${{hyg.dirty_transparent_px}}, offPal=${{hyg.off_global_palette_px}}, ink=${{(hyg.ink_outline_share*100).toFixed(1)}}%</code>
  `;
  const gn = $('gap-note');
  gn.textContent = clip.honest_gap_note;
  gn.className = clip.coverage_status === 'complete_manifest_frames' ? 'notice' : 'notice gap';

  $('cov-body').innerHTML = Object.entries(mob.assembly.clips).map(([cname, cdef]) => markup`
    <tr>
      <td class="mono">${{cname}}</td>
      <td>${{cdef.mode}}</td>
      <td class="mono">${{cdef.authored_unique_keys_per_dir}} / ${{cdef.manifest_target_frames}} per dir</td>
      <td class="mono">${{cdef.coverage_status}}</td>
    </tr>
  `).join('');
}}

function renderHeaderAndTable() {{
  const s = REPORT.summary;
  const rc = REPORT.repo_pipeline_compat || {{}};
  const aj = REPORT.assembly_json_verification || {{}};
  $('chips').innerHTML = `
    ${{REPORT.archive_sha256 ? `<span class="chip ok" title="${{REPORT.archive_sha256}}">Archive SHA: ${{REPORT.archive_sha256.slice(0,12)}}…</span>` : ''}}
    ${{aj.present ? `<span class="chip ${{aj.frames_sha256_failed ? 'err' : 'ok'}}">assembly.json: ${{aj.frames_sha256_verified}} PNG SHA OK · ${{aj.directional_clips_verified}} clips</span>` : ''}}
    <span class="chip ok">Runtime Pilots: ${{s.full_runtime_mobs.length}} (${{s.total_runtime_frames}}f)</span>
    <span class="chip ${{s.errors?'err':'ok'}}">Errors: ${{s.errors}}</span>
    <span class="chip ${{s.warnings?'warn':'ok'}}">Warnings: ${{s.warnings}}</span>
    ${{rc.checked ? `<span class="chip ${{rc.qa_assets_rc===0 && rc.pack_atlases_rc===0 ? 'ok':'err'}}">Repo QA+Packer: ${{rc.qa_assets_rc===0 && rc.pack_atlases_rc===0 ? 'PASS' : 'FAIL'}}</span>` : ''}}
  `;
  $('sel-mob').innerHTML = s.mob_ids.map(id => {{
    const m = REPORT.mobs[id];
    const badge = m.tier === 'full_runtime_36f' ? '36f FULL' : '12f KEYS';
    return markup`<option value="${{id}}" ${{id===mobId?'selected':''}}>${{id}} · ${{m.name}} [${{badge}}]</option>`;
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
  for (const id of ['sel-zoom','chk-pivot','chk-shadow','chk-onion','chk-grid']) $(id).onchange = drawStage;
  $('btn-play').onclick = () => {{ playing = !playing; if (playing && oneshotDone) {{ frameIdx = 0; elapsed = 0; oneshotDone = false; }} $('btn-play').textContent = playing ? 'Pause' : 'Play'; }};
  $('btn-prev').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getFrames().length; frameIdx = (frameIdx - 1 + n) % n; drawStage(); }};
  $('btn-next').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getFrames().length; frameIdx = (frameIdx + 1) % n; drawStage(); }};
  $('btn-attack').onclick = () => triggerOneShot('attack');
  $('btn-death').onclick = () => {{ if (!$('btn-death').disabled) triggerOneShot('death'); }};

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
    ap.add_argument("--source", type=Path, required=True, help="Read-only path to Heng-Yue.zip or unpacked mob package directory")
    ap.add_argument("--manifest", type=Path, default=REPO / "assets/manifest.json")
    ap.add_argument("--palette", type=Path, default=REPO / "tools/generators/palette.json")
    ap.add_argument("--out-dir", type=Path, default=None, help="Output directory for assembly JSON, contact sheets, and HTML viewer")
    ap.add_argument("--expected-sha256", type=str, default=None, help="Optional pinned SHA-256 digest for the input zip archive")
    ap.add_argument("--skip-repo-compat", action="store_true", help="Skip isolated qa_assets.py / pack_atlases.py check")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if any error-level QA issues are found")
    args = ap.parse_args(argv)

    src = args.source.resolve()
    report, images_cache = audit_mob_package(
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
        (out_dir / "heng-yue-assembly-manifest.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        build_mob_contact_sheet(report, images_cache, out_dir / "heng-yue-mob-qa-contact-sheet.png")
        if report["summary"]["full_runtime_mobs"]:
            build_pilot_runtime_contact_sheet(report, images_cache, out_dir / "heng-yue-pilot-runtime-qa-sheet.png")
        build_mob_html_workbench(report, images_cache, out_dir / "heng-yue-mob-animation-qa.html")

    s = report["summary"]
    aj = report.get("assembly_json_verification") or {}
    print(
        f"Heng Yue Mob Assembly & QA: mobs={s['mobs_checked']} runtime_pilots={len(s['full_runtime_mobs'])} "
        f"runtime_frames={s['total_runtime_frames']} slots={s['manifest_filled_slots']}/{s['manifest_total_slots']} "
        f"errors={s['errors']} warnings={s['warnings']}"
    )
    if report.get("archive_sha256"):
        print(f"  Archive SHA-256: {report['archive_sha256']}")
    if aj.get("present"):
        print(f"  assembly.json: {aj['frames_sha256_verified']} PNG SHA-256 OK ({aj['frames_sha256_failed']} failed), {aj['directional_clips_verified']} clips, facing_rules_ok={aj['facing_rules_ok']}")
    rc = report.get("repo_pipeline_compat") or {}
    if rc.get("checked"):
        print(f"  Repo compat: qa_assets={rc['qa_assets_rc']} ({rc['qa_assets_summary']}) | pack_atlases={rc['pack_atlases_rc']} ({rc['pack_atlases_summary']})")
    for e in report["exceptions"]:
        if e["severity"] in ("error", "warn"):
            print(f"  [{e['severity'].upper():5}] {e['mob']:22} {e['where']:28} {e['code']}: {e['detail']}")
    return 1 if (args.strict and s["errors"] > 0) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.TimeoutExpired) as exc:
        sys.exit(f"QA failed: {exc}")
