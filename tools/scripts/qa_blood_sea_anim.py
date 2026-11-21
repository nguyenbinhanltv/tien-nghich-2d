#!/usr/bin/env python
"""Independent sprite assembly & animation QA verifier for Blood Sea and multi-dir encounter assets.

Read-only auditor for Codex turnaround source sheets, frame contracts, exported native
web sheets, and Blood Sea runtime timing/mirroring rules. Does NOT generate or edit game
artwork and does NOT write to the source/encounter directory.

Outputs (written only to --out-dir):
  - blood-sea-qa-report.json       Machine-readable per-pose metrics, exceptions & proposed fixes
  - blood-sea-qa-contact-sheet.png Annotated source + native + mirrored-west QA contact sheet
  - blood-sea-animation-qa.html    Self-contained interactive browser animation QA workbench
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
EXPECTED_POSES = {
    "wl_blood_foundation": ["idle", "stride", "windup", "impact"],
    "boss_ghost_king": ["idle", "windup", "impact"],
}
EXPECTED_DIRS = {
    "wl_blood_foundation": ["south", "east", "north", "west"],
    "boss_ghost_king": ["south", "east"],
}
DEFAULT_TIMING = {
    "wl_blood_foundation": {
        "stride_hz": 8.0,
        "stride_step_ms": 125,
        "attack_total_ms": 340,
        "attack_windup_ms": 150,
        "attack_impact_ms": 190,
        "dash_ms": 180,
        "shadow_rx": 9,
        "shadow_dy": -1,
    },
    "boss_ghost_king": {
        "warn_claw_ms": 900,
        "warn_wail_ms": 1200,
        "impact_ms": 250,
        "recover_ms": 560,
        "hover_amp_px": 1.4,
        "hover_freq_rad_s": 2.0,
        "shadow_rx": 20,
        "shadow_dy": -1,
        "mirror_west_from": "east",
        "north_fallback": "south",
    },
}


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_palette(path: Path) -> tuple[set[tuple[int, int, int]], tuple[int, int, int]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    colors = {hex_to_rgb(c["hex"]) for c in data["colors"]}
    outline = hex_to_rgb(data["outline"])
    colors.add(outline)
    return colors, outline


def connected_components_8(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    """8-connected components for native sprite masks."""
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


def neighbors_transparent_4(opaque: np.ndarray) -> np.ndarray:
    t = ~opaque
    r = np.zeros_like(opaque)
    r[1:, :] |= t[:-1, :]
    r[:-1, :] |= t[1:, :]
    r[:, 1:] |= t[:, :-1]
    r[:, :-1] |= t[:, 1:]
    return r


def detect_violet_banner_pixels(cell: np.ndarray, thr: int) -> int:
    """Count violet/purple soul-banner pixels (R>=85, B>=115, B-G>=25, R-G>=12)."""
    op = cell[..., 3] >= thr
    r = cell[..., 0].astype(np.int16)
    g = cell[..., 1].astype(np.int16)
    b = cell[..., 2].astype(np.int16)
    violet = op & (b >= 115) & (r >= 85) & ((b - g) >= 25) & ((r - g) >= 12) & (b >= r - 10)
    return int(violet.sum())


def detect_bronze_blade_pixels(cell: np.ndarray, thr: int) -> int:
    """Count bright pale-bronze/ivory sword blade pixels."""
    op = cell[..., 3] >= thr
    r = cell[..., 0].astype(np.int16)
    g = cell[..., 1].astype(np.int16)
    b = cell[..., 2].astype(np.int16)
    warm_bright = op & (r >= 180) & (g >= 155) & (b >= 100) & (r >= b + 20) & (g >= b + 5)
    return int(warm_bright.sum())


def inspect_runtime(runtime_dir: Path | None) -> dict:
    """Read-only static audit of Blood Sea combat.mjs / game.mjs timing and mirroring rules."""
    info = {
        "checked": False,
        "files": [],
        "timing": json.loads(json.dumps(DEFAULT_TIMING)),
        "west_mirror_verified": None,
        "boss_north_reuse_verified": None,
        "findings": [],
    }
    if not runtime_dir or not runtime_dir.is_dir():
        return info

    combat_path = runtime_dir / "combat.mjs"
    game_path = runtime_dir / "game.mjs"
    if not combat_path.is_file() or not game_path.is_file():
        return info

    info["checked"] = True
    info["files"] = [str(combat_path), str(game_path)]
    combat_src = combat_path.read_text(encoding="utf-8")
    game_src = game_path.read_text(encoding="utf-8")

    # Verify boss west mirroring in game.mjs
    has_west_to_east = bool(re.search(r"b\.face\s*===\s*['\"]west['\"]\s*\?\s*['\"]east['\"]\s*:\s*b\.face", game_src))
    has_scale_flip = bool(re.search(r"if\s*\(\s*mirror\s*\)\s*context\.scale\s*\(\s*-1\s*,\s*1\s*\)", game_src))
    has_pivot_draw = bool(re.search(r"drawImage\([^)]*,\s*-g\[0\]\s*,\s*-g\[1\]", game_src))
    info["west_mirror_verified"] = has_west_to_east and has_scale_flip and has_pivot_draw

    # Verify boss north fallback -> south in combat.mjs
    has_boss_dir_clamp = bool(
        re.search(
            r"b\.face\s*=\s*Math\.abs\(dir\.x\)\s*>\s*\.35\s*\?\s*\(dir\.x\s*<\s*0\s*\?\s*['\"]west['\"]\s*:\s*['\"]east['\"]\)\s*:\s*['\"]south['\"]",
            combat_src,
        )
    )
    info["boss_north_reuse_verified"] = has_boss_dir_clamp

    # Extract positive timing constants (skip reset-to-0 assignments like p.action=0)
    m_stride = re.search(r"state\.time\s*\*\s*(\d+(?:\.\d+)?)", game_src)
    if m_stride:
        hz = float(m_stride.group(1))
        info["timing"]["wl_blood_foundation"]["stride_hz"] = hz
        info["timing"]["wl_blood_foundation"]["stride_step_ms"] = round(1000.0 / hz)

    m_action = re.search(r"p\.action\s*=\s*(0?\.[1-9]\d*|[1-9]\d*(?:\.\d+)?)", combat_src)
    m_split = re.search(r"p\.action\s*>\s*(0?\.[1-9]\d*|[1-9]\d*(?:\.\d+)?)\s*\?\s*['\"]windup['\"]", game_src)
    if m_action and m_split:
        total = float(m_action.group(1))
        split = float(m_split.group(1))
        info["timing"]["wl_blood_foundation"]["attack_total_ms"] = round(total * 1000)
        info["timing"]["wl_blood_foundation"]["attack_windup_ms"] = round((total - split) * 1000)
        info["timing"]["wl_blood_foundation"]["attack_impact_ms"] = round(split * 1000)

    m_dash = re.search(r"p\.dash\s*=\s*(0?\.[1-9]\d*|[1-9]\d*(?:\.\d+)?)", combat_src)
    if m_dash:
        info["timing"]["wl_blood_foundation"]["dash_ms"] = round(float(m_dash.group(1)) * 1000)

    m_warn = re.search(r"kind\s*===\s*['\"]wail['\"]\s*\?\s*(\d+(?:\.\d+)?)\s*:\s*(0?\.\d+|\d+(?:\.\d+)?)", combat_src)
    if m_warn:
        info["timing"]["boss_ghost_king"]["warn_wail_ms"] = round(float(m_warn.group(1)) * 1000)
        info["timing"]["boss_ghost_king"]["warn_claw_ms"] = round(float(m_warn.group(2)) * 1000)

    m_bimp = re.search(r"b\.phase\s*=\s*['\"]impact['\"];\s*b\.timer\s*=\s*(0?\.\d+|\d+(?:\.\d+)?)", combat_src)
    if m_bimp:
        info["timing"]["boss_ghost_king"]["impact_ms"] = round(float(m_bimp.group(1)) * 1000)

    m_brec = re.search(r"b\.phase\s*=\s*['\"]recover['\"];\s*b\.timer\s*=\s*(0?\.\d+|\d+(?:\.\d+)?)", combat_src)
    if m_brec:
        info["timing"]["boss_ghost_king"]["recover_ms"] = round(float(m_brec.group(1)) * 1000)

    if not has_west_to_east or not has_scale_flip:
        info["findings"].append({
            "severity": "error",
            "code": "runtime_mirror_missing",
            "where": "game.mjs",
            "detail": "Boss west-mirroring from east via scale(-1,1) around ground pivot not confirmed",
        })
    if "ctx.filter='brightness" in game_src or 'ctx.filter="brightness' in game_src:
        info["findings"].append({
            "severity": "info",
            "code": "runtime_hitflash_filter",
            "where": "game.mjs",
            "detail": "Boss hit-flash uses canvas ctx.filter='brightness(1.85)' (verify crisp nearest-neighbor across browsers).",
        })
    info["findings"].append({
        "severity": "info",
        "code": "runtime_mirror_pivot_parity",
        "where": "game.mjs:sprite()",
        "detail": "scale(-1,1) + drawImage(-g[0], -g[1]) maps even-width 80px cell [-40,+40] symmetrically around x; source column g[0]=40 maps to [-1,0] vs [0,1] (standard 1px even-canvas parity).",
    })
    return info


def _resolve_pose_override(encounter_dir: Path, actor: dict, direction: str, pose: str) -> dict | None:
    """Support optional per-pose override entries in contract.json (e.g. replacement north/impact PNG)."""
    overrides = actor.get("overrides") or {}
    for key in (f"{direction}/{pose}", f"{pose}_{direction}", f"{direction}_{pose}"):
        ov = overrides.get(key)
        if isinstance(ov, dict):
            return ov
    return None


def _load_pose_sample(
    encounter_dir: Path,
    src_arr: np.ndarray,
    actor: dict,
    row: int,
    col: int,
    direction: str,
    pose: str,
) -> tuple[np.ndarray, list[int], list[int], list[int], float, str]:
    """Return (cell_rgba, cell_rect, anchor_global, anchor_local, eff_scale, source_label)."""
    ov = _resolve_pose_override(encounter_dir, actor, direction, pose)
    if ov and ov.get("image"):
        img_rel = ov["image"]
        ov_path = encounter_dir / img_rel if not Path(img_rel).is_absolute() else Path(img_rel)
        if not ov_path.is_file():
            ov_path = encounter_dir / "source" / img_rel
        oarr = np.array(Image.open(ov_path).convert("RGBA"))
        oh, ow = oarr.shape[:2]
        crop = ov.get("crop") or [0, 0, ow, oh]
        x0, y0, x1, y1 = [int(v) for v in crop]
        ax, ay = [int(v) for v in ov["anchor"]]
        eff_scale = float(ov.get("scale", actor["scale"]))
        return oarr[y0:y1, x0:x1], [x0, y0, x1, y1], [ax, ay], [ax - x0, ay - y0], eff_scale, str(img_rel)

    y0, y1 = int(actor["yEdges"][row]), int(actor["yEdges"][row + 1])
    x0, x1 = int(actor["xEdges"][row][col]), int(actor["xEdges"][row][col + 1])
    ax, ay = int(actor["anchors"][row][col][0]), int(actor["anchors"][row][col][1])
    return src_arr[y0:y1, x0:x1], [x0, y0, x1, y1], [ax, ay], [ax - x0, ay - y0], float(actor["scale"]), "sheet"


def audit_encounter(
    encounter_dir: Path,
    manifest_path: Path,
    palette_path: Path,
    runtime_dir: Path | None = None,
) -> dict:
    """Run all independent QA checks against an encounter directory (strictly read-only)."""
    contract_path = encounter_dir / "contract.json"
    spec = json.loads(contract_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_by_id = {a["id"]: a for a in manifest["assets"]}
    pal_rgb, outline_rgb = load_palette(palette_path)
    thr = int(spec.get("alphaThreshold", 128))
    halo_thr = 32  # separates genuine sprite halo bleed from ImageGen 1..15 background alpha floor

    exceptions: list[dict] = []
    actor_reports: dict[str, dict] = {}

    def add_exc(severity: str, code: str, actor_id: str, pose_key: str, detail: str, proposal: dict | None = None):
        rec = {
            "severity": severity,
            "code": code,
            "actor": actor_id,
            "where": pose_key,
            "detail": detail,
        }
        if proposal is not None:
            rec["proposed_correction"] = proposal
        exceptions.append(rec)

    for actor_id, actor in spec["actors"].items():
        m_asset = manifest_by_id.get(actor_id)
        size = int(actor["size"])
        pivot = [int(actor["pivot"][0]), int(actor["pivot"][1])]
        scale = float(actor["scale"])
        rows = list(actor["rows"])
        poses = list(actor["poses"])
        y_edges = [int(v) for v in actor["yEdges"]]
        x_edges = [[int(v) for v in row] for row in actor["xEdges"]]
        uses_west_mirror = ("east" in rows) and ("west" not in rows)

        # 1. Manifest & contract alignment
        if m_asset is None:
            add_exc("error", "manifest_missing_actor", actor_id, "contract", f"Actor '{actor_id}' not found in manifest.json")
        else:
            if m_asset["size"] != [size, size]:
                add_exc("error", "manifest_size_mismatch", actor_id, "contract", f"contract size {size} != manifest {m_asset['size']}")
            if m_asset["directions"] != rows:
                add_exc("error", "manifest_dir_mismatch", actor_id, "contract", f"contract rows {rows} != manifest directions {m_asset['directions']}")
            if actor_id in EXPECTED_DIRS and rows != EXPECTED_DIRS[actor_id]:
                add_exc("error", "dir_order_mismatch", actor_id, "contract", f"rows {rows} != expected {EXPECTED_DIRS[actor_id]}")
            if actor_id in EXPECTED_POSES and poses != EXPECTED_POSES[actor_id]:
                add_exc("warn", "pose_order_unexpected", actor_id, "contract", f"poses {poses} != expected {EXPECTED_POSES[actor_id]}")
            m_anims = list((m_asset.get("animations") or {}).keys())
            add_exc(
                "info",
                "encounter_pose_contract_delta",
                actor_id,
                "contract",
                f"Encounter uses 1-frame key poses {poses} (separate web atlas); manifest.json defines multi-frame animations {m_anims}.",
            )

        # 2. Load source PNG
        src_name = actor.get("source") or f"{actor_id}.png"
        src_path = encounter_dir / "source" / src_name if not Path(src_name).is_absolute() else Path(src_name)
        if not src_path.is_file():
            add_exc("error", "source_missing", actor_id, "source", f"Missing source sheet {src_path}")
            continue

        raw_im = Image.open(src_path)
        src_mode = raw_im.mode
        src_arr = np.array(raw_im.convert("RGBA"))
        sh, sw = src_arr.shape[:2]
        sa = src_arr[..., 3]

        if y_edges[0] != 0 or y_edges[-1] != sh:
            add_exc("warn", "y_edge_bounds", actor_id, "source", f"yEdges start/end ({y_edges[0]}, {y_edges[-1]}) != image height (0, {sh})")
        for r, row_x in enumerate(x_edges):
            if row_x[0] != 0 or row_x[-1] != sw:
                add_exc("warn", "x_edge_bounds", actor_id, f"row:{rows[r]}", f"xEdges start/end ({row_x[0]}, {row_x[-1]}) != image width (0, {sw})")

        # Sheet-level alpha bucket profile
        alpha_buckets = {
            "a_eq_0": int((sa == 0).sum()),
            "a_1_to_15": int(((sa >= 1) & (sa <= 15)).sum()),
            "a_16_to_thr": int(((sa >= 16) & (sa < thr)).sum()),
            "a_thr_to_254": int(((sa >= thr) & (sa < 255)).sum()),
            "a_eq_255": int((sa == 255).sum()),
        }
        src_dirty0 = int(((sa == 0) & (src_arr[..., :3].sum(-1) > 0)).sum())
        if src_mode != "RGBA":
            add_exc("warn", "source_mode", actor_id, "source", f"Source PNG mode is {src_mode}, expected RGBA")
        if alpha_buckets["a_1_to_15"] > (sw * sh * 0.1):
            add_exc(
                "info",
                "source_alpha_floor",
                actor_id,
                "source",
                f"Source sheet has widespread low-alpha background floor (a=1..15: {alpha_buckets['a_1_to_15']:,} px, a=255: {alpha_buckets['a_eq_255']:,} px); binary alphaThreshold={thr} on export is required.",
            )
        if src_dirty0 > 0:
            add_exc("info", "source_dirty_transparent", actor_id, "source", f"{src_dirty0} source alpha=0 pixels carry non-zero RGB (must zero on export).")

        # Gutter / sheet separation checks (opaque >= thr is error, halo >= 32 is warn)
        gutter_issues = []
        for yi in y_edges[1:-1]:
            op_cut = int((sa[yi, :] >= thr).sum())
            halo_cut = int(((sa[yi, :] >= halo_thr) & (sa[yi, :] < thr)).sum())
            if op_cut > 0:
                gutter_issues.append({"axis": "y", "coord": yi, "opaque": op_cut, "halo": halo_cut})
                add_exc("error", "gutter_cut_opaque", actor_id, f"y={yi}", f"Horizontal cut y={yi} intersects {op_cut} opaque pixels (>={thr})")
            elif halo_cut > 0:
                gutter_issues.append({"axis": "y", "coord": yi, "opaque": 0, "halo": halo_cut})
                add_exc("warn", "gutter_cut_halo", actor_id, f"y={yi}", f"Horizontal cut y={yi} touches {halo_cut} halo pixels ({halo_thr}..{thr-1})")
        for r, dname in enumerate(rows):
            y0, y1 = y_edges[r], y_edges[r + 1]
            for xi in x_edges[r][1:-1]:
                op_cut = int((sa[y0:y1, xi] >= thr).sum())
                halo_cut = int(((sa[y0:y1, xi] >= halo_thr) & (sa[y0:y1, xi] < thr)).sum())
                if op_cut > 0:
                    gutter_issues.append({"axis": "x", "row": dname, "coord": xi, "opaque": op_cut, "halo": halo_cut})
                    add_exc("error", "gutter_cut_opaque", actor_id, f"{dname}/x={xi}", f"Vertical cut x={xi} in row '{dname}' intersects {op_cut} opaque pixels (>={thr})")
                elif halo_cut > 0:
                    gutter_issues.append({"axis": "x", "row": dname, "coord": xi, "opaque": 0, "halo": halo_cut})
                    add_exc("warn", "gutter_cut_halo", actor_id, f"{dname}/x={xi}", f"Vertical cut x={xi} in row '{dname}' touches {halo_cut} halo pixels ({halo_thr}..{thr-1})")

        # 3. Per-cell source measurements
        cell_metrics = []
        max_required_scale_cap = 10.0
        banner_counts = {}

        for r, dname in enumerate(rows):
            for c, pname in enumerate(poses):
                cell, cell_rect, anc_glob, anc_loc, eff_scale, src_label = _load_pose_sample(
                    encounter_dir, src_arr, actor, r, c, dname, pname
                )
                x0, y0, x1, y1 = cell_rect
                ax, ay = anc_glob
                lax, lay = anc_loc
                ca = cell[..., 3]
                op = ca >= thr
                ys, xs = np.nonzero(op)
                pkey = f"{dname}/{pname}"

                if len(xs) == 0:
                    add_exc("error", "source_empty_cell", actor_id, pkey, "No opaque pixels >= alphaThreshold in cell")
                    continue

                bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
                bw, bh = bx1 - bx0 + 1, by1 - by0 + 1

                foot_band = ys >= (by1 - max(4, int(bh * 0.06)))
                foot_xmin, foot_xmax = int(xs[foot_band].min()), int(xs[foot_band].max())
                foot_mid_x = 0.5 * (foot_xmin + foot_xmax)

                head_band = ys <= (by0 + max(4, int(bh * 0.35)))
                head_cx = float(xs[head_band].mean())
                com_x, com_y = float(xs.mean()), float(ys.mean())

                left_reach_src = lax - bx0
                right_reach_src = bx1 - lax
                up_reach_src = lay - by0
                down_reach_src = by1 - lay
                lean_ratio = (com_x - lax) / max(1.0, float(bw))
                reach_asym = (right_reach_src - left_reach_src) / max(1.0, float(bw))

                # Native projection: dst = pivot + (src - anchor) * eff_scale
                nx0 = pivot[0] + (bx0 - lax) * eff_scale
                nx1 = pivot[0] + (bx1 - lax) * eff_scale
                ny0 = pivot[1] + (by0 - lay) * eff_scale
                ny1 = pivot[1] + (by1 - lay) * eff_scale

                clip_sides = []
                if nx0 < 0:
                    clip_sides.append(f"left({nx0:.2f})")
                if nx1 > size - 1:
                    clip_sides.append(f"right({nx1:.2f})")
                if ny0 < 0:
                    clip_sides.append(f"top({ny0:.2f})")
                if ny1 > size - 1:
                    clip_sides.append(f"bottom({ny1:.2f})")

                safe_margin = 1.0
                avail_l = pivot[0] - safe_margin
                avail_r = (size - 1 - safe_margin) - pivot[0]
                avail_t = pivot[1] - safe_margin
                avail_b = (size - 1) - pivot[1]
                caps = []
                if left_reach_src > 0:
                    caps.append(avail_l / left_reach_src)
                if right_reach_src > 0:
                    caps.append(avail_r / right_reach_src)
                if up_reach_src > 0:
                    caps.append(avail_t / up_reach_src)
                if down_reach_src > 0 and avail_b > 0:
                    caps.append(avail_b / down_reach_src)
                cell_safe_scale = min(caps) if caps else eff_scale
                if src_label == "sheet":
                    max_required_scale_cap = min(max_required_scale_cap, cell_safe_scale)

                margins = {
                    "left": bx0,
                    "right": (x1 - x0 - 1) - bx1,
                    "top": by0,
                    "bottom": (y1 - y0 - 1) - by1,
                }
                min_margin = min(margins.values())

                dy_ground_src = lay - by1
                dx_foot_src = lax - foot_mid_x
                dy_ground_nat = dy_ground_src * eff_scale
                dx_foot_nat = dx_foot_src * eff_scale

                violet_px = detect_violet_banner_pixels(cell, thr) if actor_id == "wl_blood_foundation" else 0
                blade_px = detect_bronze_blade_pixels(cell, thr) if actor_id == "wl_blood_foundation" else 0
                banner_counts[pkey] = violet_px

                cm = {
                    "direction": dname,
                    "pose": pname,
                    "row": r,
                    "col": c,
                    "source": src_label,
                    "effective_scale": eff_scale,
                    "cell_rect": cell_rect,
                    "source_bbox_local": [bx0, by0, bx1, by1],
                    "source_bbox_global": [x0 + bx0, y0 + by0, x0 + bx1, y0 + by1],
                    "source_size": [bw, bh],
                    "margins": margins,
                    "contract_anchor": [ax, ay],
                    "contract_anchor_local": [lax, lay],
                    "measured_bottom_y_global": y0 + by1,
                    "measured_foot_mid_x_global": round(x0 + foot_mid_x, 1),
                    "measured_head_cx_global": round(x0 + head_cx, 1),
                    "measured_com_global": [round(x0 + com_x, 1), round(y0 + com_y, 1)],
                    "anchor_delta_ground_src_px": dy_ground_src,
                    "anchor_delta_ground_nat_px": round(dy_ground_nat, 2),
                    "anchor_delta_foot_x_src_px": round(dx_foot_src, 1),
                    "anchor_delta_foot_x_nat_px": round(dx_foot_nat, 2),
                    "reach_src_px": {
                        "left": left_reach_src,
                        "right": right_reach_src,
                        "up": up_reach_src,
                        "down": down_reach_src,
                    },
                    "lean_ratio": round(lean_ratio, 3),
                    "reach_asymmetry": round(reach_asym, 3),
                    "projected_native_bbox": [round(nx0, 2), round(ny0, 2), round(nx1, 2), round(ny1, 2)],
                    "projected_clip": clip_sides,
                    "safe_scale_1px_margin": round(cell_safe_scale, 4),
                    "source_halo_alpha_px": int(((ca >= halo_thr) & (ca < thr)).sum()),
                    "violet_banner_src_px": violet_px,
                    "bronze_blade_src_px": blade_px,
                    "proposed_anchor_ground": [int(round(x0 + foot_mid_x)), y0 + by1],
                }
                cell_metrics.append(cm)

                if min_margin < 4:
                    tight_side = min(margins, key=margins.get)
                    add_exc(
                        "warn" if min_margin > 0 else "error",
                        "tight_cell_margin",
                        actor_id,
                        pkey,
                        f"Silhouette within {min_margin}px of cell {tight_side} edge (margins={margins})",
                    )

                if clip_sides:
                    prop_ax = ax
                    if nx1 > size - 1:
                        prop_ax = ax + int(math.ceil((nx1 - (size - 1.5)) / eff_scale))
                    elif nx0 < 0:
                        prop_ax = ax - int(math.ceil((0.5 - nx0) / eff_scale))
                    add_exc(
                        "error",
                        "native_canvas_clip",
                        actor_id,
                        pkey,
                        f"Projected native bbox ({nx0:.1f},{ny0:.1f})-({nx1:.1f},{ny1:.1f}) clips {size}x{size} cell on {', '.join(clip_sides)} at scale={eff_scale}, anchor=({ax},{ay})",
                        proposal={
                            "option_a_uniform_scale": round(cell_safe_scale, 4),
                            "option_b_anchor_shift": [prop_ax, ay],
                            "note": "Lower uniform actor scale (keeps pivot exact) or shift source anchor X.",
                        },
                    )

                if dname in ("south", "north"):
                    if abs(reach_asym) >= 0.28 or abs(lean_ratio) >= 0.14:
                        side = "EAST (+X)" if (reach_asym + lean_ratio) > 0 else "WEST (-X)"
                        sev = "error" if (dname == "north" and pname == "impact" and abs(reach_asym) >= 0.35) else "warn"
                        add_exc(
                            sev,
                            "cardinal_orientation_lean",
                            actor_id,
                            pkey,
                            f"{dname.upper()}/{pname} leans/reaches heavily {side} (left={left_reach_src}px vs right={right_reach_src}px, reach_asym={reach_asym:+.2f}, com_lean={lean_ratio:+.2f}). Visually breaks {dname}-facing read.",
                            proposal={
                                "action": "regenerate_pose_in_codex" if sev == "error" else "review_or_recenter_anchor",
                                "source_bbox_global": [x0 + bx0, y0 + by0, x0 + bx1, y0 + by1],
                                "centered_anchor_if_kept": [int(round(x0 + com_x)), ay],
                            },
                        )
                elif dname == "east" and pname == "impact":
                    if right_reach_src <= left_reach_src:
                        add_exc(
                            "warn",
                            "east_impact_reverse_lean",
                            actor_id,
                            pkey,
                            f"EAST/impact does not extend further right than left (left={left_reach_src}px, right={right_reach_src}px).",
                        )
                elif dname == "west" and pname == "impact":
                    if left_reach_src <= right_reach_src:
                        add_exc(
                            "warn",
                            "west_impact_reverse_lean",
                            actor_id,
                            pkey,
                            f"WEST/impact does not extend further left than right (left={left_reach_src}px, right={right_reach_src}px).",
                        )

                if abs(dy_ground_nat) > 1.25:
                    add_exc(
                        "warn",
                        "anchor_ground_offset",
                        actor_id,
                        pkey,
                        f"Contract anchor Y={ay} differs from lowest opaque row Y={y0 + by1} by {dy_ground_src:+d} source px ({dy_ground_nat:+.2f} native px).",
                        proposal={"anchor": [ax, y0 + by1]},
                    )

        # Cross-pose vertical/horizontal stability per direction row
        row_stability = {}
        head_drift_limit = 3.5 if size <= 32 else 7.5
        for dname in rows:
            rcells = [m for m in cell_metrics if m["direction"] == dname]
            if not rcells:
                continue
            bot_nat = [m["projected_native_bbox"][3] for m in rcells]
            top_nat = [m["projected_native_bbox"][1] for m in rcells]
            head_x_nat = [
                pivot[0] + (m["measured_head_cx_global"] - m["contract_anchor"][0]) * m["effective_scale"]
                for m in rcells
            ]
            bot_span = round(max(bot_nat) - min(bot_nat), 2)
            top_span = round(max(top_nat) - min(top_nat), 2)
            head_x_span = round(max(head_x_nat) - min(head_x_nat), 2)
            max_head_idx = int(np.argmax([abs(hx - pivot[0]) for hx in head_x_nat]))
            outlier = rcells[max_head_idx]
            row_stability[dname] = {
                "projected_bottom_y_range": [round(min(bot_nat), 2), round(max(bot_nat), 2)],
                "projected_bottom_jitter_px": bot_span,
                "projected_top_y_range": [round(min(top_nat), 2), round(max(top_nat), 2)],
                "projected_height_shift_px": top_span,
                "projected_head_x_drift_px": head_x_span,
                "head_x_outlier_pose": outlier["pose"],
            }
            if bot_span > 1.5:
                add_exc(
                    "warn",
                    "ground_contact_jitter",
                    actor_id,
                    f"{dname}/*",
                    f"Projected bottom ground contact varies by {bot_span:.2f} native px across {dname} poses ({min(bot_nat):.1f}..{max(bot_nat):.1f} vs pivotY={pivot[1]}).",
                )
            if head_x_span > head_drift_limit:
                o_anc = outlier["contract_anchor"]
                mid_x = int(round(0.5 * (o_anc[0] + outlier["measured_head_cx_global"])))
                add_exc(
                    "warn",
                    "head_pivot_drift",
                    actor_id,
                    f"{dname}/{outlier['pose']}",
                    f"Projected head/upper-torso X drifts by {head_x_span:.2f} native px across {dname} poses (outlier: {dname}/{outlier['pose']} headCX={outlier['measured_head_cx_global']} vs anchorX={o_anc[0]}).",
                    proposal={"optional_recenter_anchor": [mid_x, o_anc[1]]},
                )

        # Prop continuity check for Wang Lin's violet soul banner
        if actor_id == "wl_blood_foundation" and banner_counts:
            median_banner = float(np.median([v for v in banner_counts.values() if v > 0] or [0]))
            for pkey, bpx in banner_counts.items():
                if median_banner >= 200 and bpx < 60:
                    add_exc(
                        "warn",
                        "prop_continuity_soul_banner",
                        actor_id,
                        pkey,
                        f"Violet soul banner largely absent ({bpx} violet px vs sheet median {median_banner:.0f} px).",
                    )

        # 4. Inspect Codex's exported native web sheet (read-only)
        web_png_path = encounter_dir / "web" / f"{actor_id}.png"
        web_json_path = encounter_dir / "web" / f"{actor_id}.json"
        web_report = {"present": False, "frames": []}
        eroded_blade_poses = []

        if web_png_path.is_file() and web_json_path.is_file():
            web_report["present"] = True
            web_json = json.loads(web_json_path.read_text(encoding="utf-8"))
            warr = np.array(Image.open(web_png_path).convert("RGBA"))
            wh, ww = warr.shape[:2]
            wa = warr[..., 3]
            expected_w = len(poses) * size
            expected_h = len(rows) * size
            web_report["sheet_size"] = [ww, wh]
            web_report["expected_size"] = [expected_w, expected_h]
            if (ww, wh) != (expected_w, expected_h):
                add_exc("error", "web_sheet_size", actor_id, "web", f"Exported sheet {ww}x{wh} != expected {expected_w}x{expected_h}")

            w_partial = int(((wa > 0) & (wa < 255)).sum())
            w_dirty0 = int(((wa == 0) & (warr[..., :3].sum(-1) > 0)).sum())
            op_rgb = warr[wa == 255][:, :3]
            w_off_pal = sum(1 for px in op_rgb if tuple(px.tolist()) not in pal_rgb)
            w_ink = sum(1 for px in op_rgb if tuple(px.tolist()) == outline_rgb)
            ink_share = w_ink / max(1, len(op_rgb))

            web_report["hygiene"] = {
                "partial_alpha_px": w_partial,
                "dirty_transparent_px": w_dirty0,
                "off_palette_px": w_off_pal,
                "opaque_px": int(len(op_rgb)),
                "ink_outline_share": round(ink_share, 4),
            }
            if w_partial > 0:
                add_exc("error", "web_partial_alpha", actor_id, "web", f"{w_partial} semi-transparent pixels in exported web sheet")
            if w_dirty0 > 0:
                add_exc(
                    "error",
                    "web_dirty_transparent",
                    actor_id,
                    "web",
                    f"{w_dirty0} transparent (alpha=0) pixels have non-zero RGB (breaks qa_assets.py dirty_transparent rule).",
                    proposal={"fix_in": "build_blood_sea.py", "detail": "Zero RGB where alpha==0 after quantize+outline paste."},
                )
            if w_off_pal > 0:
                add_exc("error", "web_off_palette", actor_id, "web", f"{w_off_pal} opaque pixels outside 40-color palette.json")
            if ink_share > 0.45:
                add_exc(
                    "warn",
                    "web_high_ink_ratio",
                    actor_id,
                    "web",
                    f"High #14101a ink share ({ink_share:.1%} of opaque pixels); 3x3 MinFilter(3) outline + unrestricted ink_01 quantization darkens interior detail and thin weapons.",
                    proposal={"fix_in": "build_blood_sea.py", "detail": "Use 4-connected outline edge and reserve ink_01 for silhouette edges (per LESSONS_processing.md Vòng 2)."},
                )

            for r, dname in enumerate(rows):
                for c, pname in enumerate(poses):
                    fkey = f"characters/{actor_id}/{pname}_{dname}_0"
                    pkey = f"{dname}/{pname}"
                    frec = (web_json.get("frames") or {}).get(fkey)
                    if not frec:
                        add_exc("error", "web_missing_frame_key", actor_id, pkey, f"Missing frame key '{fkey}' in web/{actor_id}.json")
                        continue
                    fr = frec["frame"]
                    fg = frec.get("ground")
                    if fg != pivot:
                        add_exc("error", "web_ground_mismatch", actor_id, pkey, f"web json ground {fg} != contract pivot {pivot}")
                    sub = warr[fr["y"]:fr["y"] + fr["h"], fr["x"]:fr["x"] + fr["w"]]
                    sub_op = sub[..., 3] == 255
                    ys, xs = np.nonzero(sub_op)
                    if len(xs) == 0:
                        add_exc("error", "web_empty_frame", actor_id, pkey, "Exported native frame is fully transparent")
                        continue
                    bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
                    edge_touches = [
                        side
                        for side, cond in (("left", bx0 == 0), ("right", bx1 == fr["w"] - 1), ("top", by0 == 0), ("bottom", by1 == fr["h"] - 1))
                        if cond
                    ]
                    ol = sub_op & (sub[..., 0] == outline_rgb[0]) & (sub[..., 1] == outline_rgb[1]) & (sub[..., 2] == outline_rgb[2])
                    blk2x2 = ol[:-1, :-1] & ol[1:, :-1] & ol[:-1, 1:] & ol[1:, 1:]
                    edge4 = neighbors_transparent_4(sub_op)
                    gap4 = int((sub_op & edge4 & ~ol).sum())
                    comps = connected_components_8(sub_op)
                    specks = sum(len(cp) for cp in comps if len(cp) <= 2)
                    blade_nat = detect_bronze_blade_pixels(sub, 128) if actor_id == "wl_blood_foundation" else 0
                    wf = {
                        "key": fkey,
                        "direction": dname,
                        "pose": pname,
                        "rect": [fr["x"], fr["y"], fr["w"], fr["h"]],
                        "ground": fg,
                        "bbox": [bx0, by0, bx1, by1],
                        "size_px": [bx1 - bx0 + 1, by1 - by0 + 1],
                        "bottom_minus_pivot_y": by1 - pivot[1],
                        "edge_touches": edge_touches,
                        "components": len(comps),
                        "speckle_px": specks,
                        "outline_2x2_blocks": int(blk2x2.sum()),
                        "outline_gap_4conn": gap4,
                        "bronze_blade_nat_px": blade_nat,
                    }
                    web_report["frames"].append(wf)

                    if edge_touches:
                        add_exc(
                            "error" if any(s in ("left", "right", "top") for s in edge_touches) else "warn",
                            "web_frame_edge_touch",
                            actor_id,
                            pkey,
                            f"Native {size}x{size} frame touches canvas edge(s): {', '.join(edge_touches)} (bbox={bx0},{by0}..{bx1},{by1})",
                        )
                    if specks > 0:
                        add_exc(
                            "warn",
                            "web_speckle",
                            actor_id,
                            pkey,
                            f"{specks} detached 1-2px speckle pixel(s) across {len(comps)} connected components.",
                        )
                    if gap4 > 0:
                        add_exc("error", "web_outline_gap", actor_id, pkey, f"{gap4} 4-connected silhouette edge pixels missing #14101a outline")
                    if actor_id == "wl_blood_foundation" and blade_nat <= 1:
                        eroded_blade_poses.append(pkey)

            if eroded_blade_poses:
                add_exc(
                    "warn",
                    "web_thin_blade_eroded",
                    actor_id,
                    f"{len(eroded_blade_poses)}/{len(rows)*len(poses)} poses",
                    f"Pale-bronze sword blade interior eroded to <=1px at 32x32 on {len(eroded_blade_poses)} poses ({', '.join(eroded_blade_poses[:6])}{'...' if len(eroded_blade_poses) > 6 else ''}) due to 3x3 MinFilter(3) outline erosion.",
                    proposal={"fix_in": "build_blood_sea.py", "detail": "Switch MinFilter(3) (8-neighbor) to 4-neighbor outline mask to preserve 1-2px weapon interiors."},
                )

        # 5. West-mirroring verification for 2-direction actors (bosses & mobs: south + east)
        mirror_report = None
        if uses_west_mirror:
            east_cells = [m for m in cell_metrics if m["direction"] == "east"]
            mirrored = []
            for m in east_cells:
                nx0, ny0, nx1, ny1 = m["projected_native_bbox"]
                mx0 = 2 * pivot[0] - 1 - nx1
                mx1 = 2 * pivot[0] - 1 - nx0
                mclip = []
                if mx0 < 0:
                    mclip.append(f"left({mx0:.2f})")
                if mx1 > size - 1:
                    mclip.append(f"right({mx1:.2f})")
                mirrored.append({
                    "pose": m["pose"],
                    "source_dir": "east",
                    "mirrored_native_bbox": [round(mx0, 2), round(ny0, 2), round(mx1, 2), round(ny1, 2)],
                    "mirrored_clip": mclip,
                    "west_reach_left_nat": round(pivot[0] - mx0, 2),
                    "west_reach_right_nat": round(mx1 - pivot[0], 2),
                })
                if mclip:
                    add_exc(
                        "error",
                        "mirrored_west_clip",
                        actor_id,
                        f"west(mirrored)/{m['pose']}",
                        f"Mirrored west frame clips {size}x{size} cell on {', '.join(mclip)}",
                    )
            mirror_report = {
                "source_direction": "east",
                "derived_direction": "west",
                "pivot_x": pivot[0],
                "even_canvas_parity_shift_px": -1 if size % 2 == 0 else 0,
                "poses": mirrored,
            }

        actor_reports[actor_id] = {
            "size": size,
            "pivot": pivot,
            "scale": scale,
            "recommended_max_uniform_scale_1px_margin": round(max_required_scale_cap, 4),
            "rows": rows,
            "poses": poses,
            "uses_west_mirror": uses_west_mirror,
            "source_sheet_size": [sw, sh],
            "source_mode": src_mode,
            "source_alpha_buckets": alpha_buckets,
            "source_dirty_zero_rgb": src_dirty0,
            "gutter_issues": gutter_issues,
            "row_stability": row_stability,
            "cells": cell_metrics,
            "web_export": web_report,
            "west_mirror_check": mirror_report,
        }

    runtime_report = inspect_runtime(runtime_dir)
    for rf in runtime_report["findings"]:
        exceptions.append({
            "severity": rf["severity"],
            "code": rf["code"],
            "actor": "runtime",
            "where": rf["where"],
            "detail": rf["detail"],
        })

    sev_counts = Counter(e["severity"] for e in exceptions)
    return {
        "schema": "tien-nghich-2d.blood-sea-animation-qa",
        "version": 2,
        "encounter_dir": str(encounter_dir),
        "summary": {
            "errors": sev_counts.get("error", 0),
            "warnings": sev_counts.get("warn", 0),
            "info": sev_counts.get("info", 0),
            "actors_checked": list(actor_reports.keys()),
        },
        "runtime": runtime_report,
        "actors": actor_reports,
        "exceptions": exceptions,
    }


def _checker_bg(w: int, h: int, step: int = 8) -> Image.Image:
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    ys = (np.arange(h) // step)[:, None]
    xs = (np.arange(w) // step)[None, :]
    dark = ((ys + xs) % 2) == 0
    arr[dark] = (34, 30, 42, 255)
    arr[~dark] = (46, 41, 56, 255)
    return Image.fromarray(arr, "RGBA")


def _crop_cell_image(encounter_dir: Path, src_im: Image.Image, cm: dict) -> Image.Image:
    x0, y0, x1, y1 = cm["cell_rect"]
    if cm.get("source") and cm["source"] != "sheet":
        p = encounter_dir / cm["source"]
        if not p.is_file():
            p = encounter_dir / "source" / cm["source"]
        return Image.open(p).convert("RGBA").crop((x0, y0, x1, y1))
    return src_im.crop((x0, y0, x1, y1))


def build_contact_sheet(encounter_dir: Path, report: dict, out_path: Path) -> None:
    """Assemble an independent visual QA contact sheet (source annotated + native + west mirror)."""
    pad = 12
    title_h = 44
    sections: list[Image.Image] = []

    for actor_id, arep in report["actors"].items():
        src_im = Image.open(encounter_dir / "source" / f"{actor_id}.png").convert("RGBA")
        web_path = encounter_dir / "web" / f"{actor_id}.png"
        web_im = Image.open(web_path).convert("RGBA") if web_path.is_file() else None
        size = arep["size"]
        piv_x, piv_y = arep["pivot"]
        rows = arep["rows"]
        poses = arep["poses"]

        src_thumb = 128 if size <= 32 else 144
        nat_zoom = 4 if size <= 32 else 2
        nat_w = size * nat_zoom
        cell_h = max(src_thumb, nat_w) + 34
        pair_w = src_thumb + 6 + nat_w + 12

        display_rows = list(rows)
        if arep.get("uses_west_mirror"):
            display_rows.append("west (mirrored E)")

        sec_w = max(760, pad * 2 + len(poses) * pair_w)
        sec_h = 40 + len(display_rows) * cell_h + pad
        sec = Image.new("RGBA", (sec_w, sec_h), (20, 17, 26, 255))
        draw = ImageDraw.Draw(sec)

        hdr = (
            f"{actor_id}  |  native {size}x{size}  pivot={arep['pivot']}  "
            f"contract_scale={arep['scale']}  safe_1px_scale={arep['recommended_max_uniform_scale_1px_margin']}"
        )
        draw.text((pad, 8), hdr, fill=(242, 233, 214, 255))
        draw.text(
            (pad, 22),
            "LEFT: Source cell (yellow=bbox, cyan+=contract anchor, lime+=measured feet)  |  RIGHT: Native web export (cyan+=pivot, red=edge clip)",
            fill=(160, 156, 172, 255),
        )

        cells_by_rc = {(m["row"], m["col"]): m for m in arep["cells"]}
        web_by_dp = {(w["direction"], w["pose"]): w for w in arep["web_export"].get("frames", [])}

        for r_idx, dlabel in enumerate(display_rows):
            is_mirror = dlabel.startswith("west (mirrored")
            src_r = rows.index("east") if is_mirror else r_idx
            dname = "east" if is_mirror else dlabel
            oy = 40 + r_idx * cell_h

            for c_idx, pname in enumerate(poses):
                ox = pad + c_idx * pair_w
                m = cells_by_rc.get((src_r, c_idx))
                if not m:
                    continue

                x0, y0, x1, y1 = m["cell_rect"]
                cw, ch = x1 - x0, y1 - y0
                crop = _crop_cell_image(encounter_dir, src_im, m)
                if is_mirror:
                    crop = crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

                fit_s = min(src_thumb / cw, src_thumb / ch)
                tw, th = max(1, int(round(cw * fit_s))), max(1, int(round(ch * fit_s)))
                bg_s = _checker_bg(src_thumb, src_thumb, 8)
                thumb = crop.resize((tw, th), Image.Resampling.NEAREST)
                tx = (src_thumb - tw) // 2
                ty = (src_thumb - th) // 2
                bg_s.alpha_composite(thumb, (tx, ty))
                ds = ImageDraw.Draw(bg_s)

                bx0, by0, bx1, by1 = m["source_bbox_local"]
                lax, lay = m["contract_anchor_local"]
                fmx = m["measured_foot_mid_x_global"] - x0
                if is_mirror:
                    bx0, bx1 = (cw - 1 - bx1), (cw - 1 - bx0)
                    lax = cw - 1 - lax
                    fmx = cw - 1 - fmx

                ds.rectangle(
                    [tx + bx0 * fit_s, ty + by0 * fit_s, tx + bx1 * fit_s, ty + by1 * fit_s],
                    outline=(245, 215, 101, 220),
                    width=1,
                )
                acx, acy = tx + lax * fit_s, ty + lay * fit_s
                ds.line([(acx - 6, acy), (acx + 6, acy)], fill=(138, 232, 255, 255), width=1)
                ds.line([(acx, acy - 6), (acx, acy + 6)], fill=(138, 232, 255, 255), width=1)
                fcx, fcy = tx + fmx * fit_s, ty + by1 * fit_s
                ds.line([(fcx - 4, fcy), (fcx + 4, fcy)], fill=(92, 199, 150, 255), width=1)
                ds.line([(fcx, fcy - 4), (fcx, fcy + 4)], fill=(92, 199, 150, 255), width=1)

                sec.alpha_composite(bg_s, (ox, oy + 16))

                bg_n = _checker_bg(nat_w, nat_w, max(4, nat_zoom * 2))
                wmeta = web_by_dp.get((dname, pname))
                if web_im is not None and wmeta is not None:
                    rx, ry, rw, rh = wmeta["rect"]
                    nf = web_im.crop((rx, ry, rx + rw, ry + rh))
                    if is_mirror:
                        nf = nf.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    dn = ImageDraw.Draw(bg_n)
                    sh_rx = (9 if size <= 32 else 20) * nat_zoom
                    sh_ry = max(2, int(round(sh_rx * 0.28)))
                    sh_cx = piv_x * nat_zoom
                    sh_cy = (piv_y - 1) * nat_zoom
                    dn.ellipse([sh_cx - sh_rx, sh_cy - sh_ry, sh_cx + sh_rx, sh_cy + sh_ry], fill=(20, 16, 26, 150))
                    bg_n.alpha_composite(nf.resize((nat_w, nat_w), Image.Resampling.NEAREST), (0, 0))
                    dn = ImageDraw.Draw(bg_n)
                    px_s, py_s = piv_x * nat_zoom, piv_y * nat_zoom
                    dn.line([(px_s - 8, py_s), (px_s + 8, py_s)], fill=(138, 232, 255, 255), width=1)
                    dn.line([(px_s, py_s - 8), (px_s, py_s + 8)], fill=(138, 232, 255, 255), width=1)
                    touches = list(wmeta["edge_touches"])
                    if is_mirror:
                        touches = ["left" if t == "right" else "right" if t == "left" else t for t in touches]
                    if "left" in touches:
                        dn.rectangle([0, 0, 2, nat_w - 1], fill=(255, 59, 48, 255))
                    if "right" in touches:
                        dn.rectangle([nat_w - 3, 0, nat_w - 1, nat_w - 1], fill=(255, 59, 48, 255))
                    if "top" in touches:
                        dn.rectangle([0, 0, nat_w - 1, 2], fill=(255, 59, 48, 255))
                    if "bottom" in touches:
                        dn.rectangle([0, nat_w - 3, nat_w - 1, nat_w - 1], fill=(255, 59, 48, 255))
                sec.alpha_composite(bg_n, (ox + src_thumb + 6, oy + 16))

                flags = []
                if m["projected_clip"]:
                    flags.append("CLIP")
                if dlabel in ("south", "north") and (abs(m["reach_asymmetry"]) >= 0.28 or abs(m["lean_ratio"]) >= 0.14):
                    flags.append("LEAN!")
                if actor_id == "wl_blood_foundation" and m["violet_banner_src_px"] < 60:
                    flags.append("NO-BANNER")
                label_col = (255, 110, 100, 255) if flags else (216, 212, 224, 255)
                tag = f" [{','.join(flags)}]" if flags else ""
                draw.text((ox, oy + 2), f"{dlabel}/{pname}{tag}", fill=label_col)
                sub_line = f"anc({m['contract_anchor'][0]},{m['contract_anchor'][1]}) dY={m['anchor_delta_ground_src_px']:+d}px lean={m['lean_ratio']:+.2f}"
                draw.text((ox, oy + 16 + max(src_thumb, nat_w) + 2), sub_line, fill=(148, 144, 160, 255))

        sections.append(sec)

    total_w = max(s.width for s in sections)
    total_h = title_h + sum(s.height + 8 for s in sections)
    sheet = Image.new("RGBA", (total_w, total_h), (14, 12, 20, 255))
    dtop = ImageDraw.Draw(sheet)
    summ = report["summary"]
    dtop.text(
        (pad, 8),
        f"TIEN NGHICH 2D · INDEPENDENT ANIMATION QA CONTACT SHEET  |  errors={summ['errors']} warnings={summ['warnings']}",
        fill=(255, 240, 176, 255),
    )
    dtop.text(
        (pad, 24),
        "Cyan + = contract anchor/pivot   Lime + = measured foot center   Yellow = source bbox   Red edge bar = native canvas clip",
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


def build_html_workbench(encounter_dir: Path, report: dict, out_path: Path) -> None:
    """Generate a self-contained browser-based Animation QA Workbench with embedded frames."""
    embedded = {}
    for actor_id, arep in report["actors"].items():
        web_png = encounter_dir / "web" / f"{actor_id}.png"
        src_png = encounter_dir / "source" / f"{actor_id}.png"
        entry = {
            "size": arep["size"],
            "pivot": arep["pivot"],
            "scale": arep["scale"],
            "rows": arep["rows"],
            "poses": arep["poses"],
            "usesWestMirror": arep.get("uses_west_mirror", False),
            "webDataUri": _img_to_data_uri(Image.open(web_png).convert("RGBA")) if web_png.is_file() else None,
            "sourceThumbUris": {},
        }
        if src_png.is_file():
            sim = Image.open(src_png).convert("RGBA")
            for cm in arep["cells"]:
                crop = _crop_cell_image(encounter_dir, sim, cm)
                cw, ch = crop.size
                s = min(128 / cw, 128 / ch)
                tw, th = max(1, int(round(cw * s))), max(1, int(round(ch * s)))
                entry["sourceThumbUris"][f"{cm['direction']}/{cm['pose']}"] = _img_to_data_uri(
                    crop.resize((tw, th), Image.Resampling.NEAREST)
                )
        embedded[actor_id] = entry

    payload_json = json.dumps({"report": report, "art": embedded}, ensure_ascii=False)
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Tiên Nghịch 2D · Independent Animation QA Workbench</title>
<style>
  :root {{
    --bg: #121019; --card: #1b1724; --line: #322c40; --fg: #ece7f2;
    --muted: #a099ad; --accent: #8ae8ff; --ok: #5cc796; --warn: #f5d765; --err: #ff6b63;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }}
  header {{ padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; background: #171320; }}
  header h1 {{ margin: 0; font-size: 16px; letter-spacing: .2px; }}
  .chips {{ display: flex; gap: 8px; flex-wrap: wrap; }}
  .chip {{ padding: 3px 9px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid var(--line); }}
  .chip.err {{ background: rgba(255,107,99,.16); color: var(--err); border-color: rgba(255,107,99,.45); }}
  .chip.warn {{ background: rgba(245,215,101,.14); color: var(--warn); border-color: rgba(245,215,101,.45); }}
  .chip.ok {{ background: rgba(92,199,150,.15); color: var(--ok); border-color: rgba(92,199,150,.45); }}
  main {{ padding: 16px 18px 28px; display: grid; gap: 16px; max-width: 1320px; margin: 0 auto; }}
  .workbench {{ display: grid; grid-template-columns: minmax(340px, 1fr) 370px; gap: 16px; align-items: start; }}
  @media (max-width: 920px) {{ .workbench {{ grid-template-columns: 1fr; }} }}
  .panel {{ background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }}
  .panel h2 {{ margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }}
  .toolbar {{ display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }}
  select, button {{ background: #241f31; color: var(--fg); border: 1px solid var(--line); border-radius: 5px; padding: 5px 9px; font: inherit; cursor: pointer; }}
  button.primary {{ background: #234759; border-color: #3f7e9c; color: #e8fdff; }}
  label.tog {{ display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); cursor: pointer; }}
  .stage-row {{ display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: center; background: #14101a; border: 1px solid var(--line); border-radius: 6px; padding: 16px; min-height: 280px; }}
  .canvas-box {{ text-align: center; }}
  .canvas-box canvas {{ image-rendering: pixelated; border: 1px solid #3c354d; display: block; margin: 0 auto; background: #1a1624; }}
  .canvas-cap {{ margin-top: 6px; font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }}
  .kv {{ display: grid; grid-template-columns: 145px 1fr; gap: 4px 10px; font-size: 12px; }}
  .kv span {{ color: var(--muted); }}
  .kv code {{ font-family: ui-monospace, monospace; color: var(--accent); word-break: break-word; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }}
  th {{ color: var(--muted); font-weight: 600; }}
  .sev-error {{ color: var(--err); font-weight: 700; }}
  .sev-warn {{ color: var(--warn); font-weight: 700; }}
  .sev-info {{ color: var(--accent); }}
  .mono {{ font-family: ui-monospace, monospace; font-size: 11px; }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Tiên Nghịch 2D · Independent Sprite Assembly &amp; Animation QA</h1>
    <div style="color:var(--muted);font-size:12px;">Read-only verification of Codex turnaround sheets, frame contract, native export &amp; runtime cadence</div>
  </div>
  <div id="summary-chips" class="chips"></div>
</header>
<main>
  <section class="workbench">
    <div class="panel">
      <h2>Live Animation &amp; Mirroring Verifier</h2>
      <div class="toolbar">
        <select id="sel-actor"></select>
        <select id="sel-dir"></select>
        <select id="sel-seq"></select>
        <select id="sel-zoom">
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="4" selected>4×</option>
          <option value="6">6×</option>
        </select>
        <select id="sel-speed">
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
        </select>
        <button id="btn-play" class="primary">Pause</button>
        <button id="btn-prev">◀ Step</button>
        <button id="btn-next">Step ▶</button>
      </div>
      <div class="toolbar">
        <label class="tog"><input id="chk-pivot" type="checkbox" checked /> Pivot Crosshair</label>
        <label class="tog"><input id="chk-shadow" type="checkbox" checked /> Ground Contact Shadow</label>
        <label class="tog"><input id="chk-bounds" type="checkbox" checked /> Cell Bounds &amp; Clip</label>
        <label class="tog"><input id="chk-onion" type="checkbox" checked /> Onion Skin (Prev Pose)</label>
        <label class="tog"><input id="chk-hover" type="checkbox" checked /> Boss Hover Bob (±1.4px)</label>
      </div>
      <div class="stage-row">
        <div class="canvas-box">
          <canvas id="cv-anim" width="256" height="256"></canvas>
          <div id="cap-anim" class="canvas-cap"></div>
        </div>
        <div class="canvas-box">
          <canvas id="cv-source" width="160" height="160"></canvas>
          <div id="cap-source" class="canvas-cap">Source Cell (Anchor=Cyan, Feet=Lime)</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Current Pose Metrics</h2>
      <div id="pose-kv" class="kv"></div>
      <h2 style="margin-top:14px;">Row Stability &amp; Runtime Rules</h2>
      <div id="row-kv" class="kv"></div>
    </div>
  </section>

  <section class="panel">
    <h2>Per-Pose Exceptions &amp; Proposed Source Coordinate Corrections</h2>
    <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Sev</th><th>Actor</th><th>Pose / Target</th><th>Code</th><th>Finding</th><th>Proposed Correction</th></tr></thead>
        <tbody id="exc-body"></tbody>
      </table>
    </div>
  </section>
</main>
<script>
const DATA = {payload_json};
const REPORT = DATA.report;
const ART = DATA.art;

function buildSequences(id, poses) {{
  if (id === 'wl_blood_foundation') {{
    const t = REPORT.runtime?.timing?.wl_blood_foundation || {{}};
    return [
      {{ id: 'walk', label: `Walk Cycle (idle ↔ stride · ${{t.stride_hz||8}}Hz / ${{t.stride_step_ms||125}}ms)`, steps: [{{pose:'idle',ms:t.stride_step_ms||125}},{{pose:'stride',ms:t.stride_step_ms||125}}] }},
      {{ id: 'attack', label: `Attack (windup ${{t.attack_windup_ms||150}}ms → impact ${{t.attack_impact_ms||190}}ms → idle)`, steps: [{{pose:'windup',ms:t.attack_windup_ms||150}},{{pose:'impact',ms:t.attack_impact_ms||190}},{{pose:'idle',ms:220}}] }},
      {{ id: 'dash', label: `Dash (stride ${{t.dash_ms||180}}ms → idle)`, steps: [{{pose:'stride',ms:t.dash_ms||180}},{{pose:'idle',ms:220}}] }},
      {{ id: 'all', label: 'All 4 Poses (350ms each)', steps: poses.map(p => ({{pose:p,ms:350}})) }},
    ];
  }}
  if (id === 'boss_ghost_king') {{
    const t = REPORT.runtime?.timing?.boss_ghost_king || {{}};
    return [
      {{ id: 'claw', label: `Claw / Seal (warn ${{t.warn_claw_ms||900}}ms → impact ${{t.impact_ms||250}}ms → recover ${{t.recover_ms||560}}ms)`, steps: [{{pose:'windup',ms:t.warn_claw_ms||900}},{{pose:'impact',ms:t.impact_ms||250}},{{pose:'idle',ms:t.recover_ms||560}}] }},
      {{ id: 'wail', label: `Soul Wail (warn ${{t.warn_wail_ms||1200}}ms → impact ${{t.impact_ms||250}}ms → recover ${{t.recover_ms||560}}ms)`, steps: [{{pose:'windup',ms:t.warn_wail_ms||1200}},{{pose:'impact',ms:t.impact_ms||250}},{{pose:'idle',ms:t.recover_ms||560}}] }},
      {{ id: 'all', label: 'All 3 Poses (450ms each)', steps: poses.map(p => ({{pose:p,ms:450}})) }},
    ];
  }}
  return [{{ id: 'all', label: `All Poses (${{poses.join('→')}})`, steps: poses.map(p => ({{pose:p,ms:250}})) }}];
}}

const images = {{}};
const srcThumbs = {{}};
function loadImg(uri) {{
  return new Promise((res, rej) => {{ const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = uri; }});
}}

const $ = (id) => document.getElementById(id);
let actorId = Object.keys(REPORT.actors)[0];
let dir = 'south';
let seqId = '';
let stepIdx = 0;
let playing = true;
let elapsed = 0;
let totalTick = 0;

function getSeq() {{
  const arep = REPORT.actors[actorId];
  const list = buildSequences(actorId, arep?.poses || []);
  return list.find(s => s.id === seqId) || list[0];
}}

function renderSummary() {{
  const s = REPORT.summary;
  const rt = REPORT.runtime;
  $('summary-chips').innerHTML = `
    <span class="chip ${{s.errors ? 'err' : 'ok'}}">Errors: ${{s.errors}}</span>
    <span class="chip ${{s.warnings ? 'warn' : 'ok'}}">Warnings: ${{s.warnings}}</span>
    <span class="chip ${{rt.west_mirror_verified ? 'ok' : 'warn'}}">Boss West Mirror: ${{rt.west_mirror_verified ? 'Verified' : 'Unchecked'}}</span>
  `;
  $('exc-body').innerHTML = REPORT.exceptions.map(e => `
    <tr>
      <td class="sev-${{e.severity}}">${{e.severity.toUpperCase()}}</td>
      <td class="mono">${{e.actor}}</td>
      <td class="mono">${{e.where}}</td>
      <td class="mono">${{e.code}}</td>
      <td>${{e.detail}}</td>
      <td class="mono">${{e.proposed_correction ? JSON.stringify(e.proposed_correction) : '—'}}</td>
    </tr>
  `).join('');
}}

function populateControls() {{
  $('sel-actor').innerHTML = Object.keys(REPORT.actors).map(id => `<option value="${{id}}" ${{id===actorId?'selected':''}}>${{id}}</option>`).join('');
  updateActorDependent();
}}

function updateActorDependent() {{
  const arep = REPORT.actors[actorId];
  const dirs = arep.uses_west_mirror ? [...arep.rows, 'west'] : arep.rows;
  if (!dirs.includes(dir)) dir = dirs[0];
  $('sel-dir').innerHTML = dirs.map(d => `<option value="${{d}}" ${{d===dir?'selected':''}}>${{d}}${{arep.uses_west_mirror&&d==='west'?' (mirrored E)':''}}</option>`).join('');
  const seqs = buildSequences(actorId, arep.poses);
  seqId = seqs[0]?.id || '';
  $('sel-seq').innerHTML = seqs.map(s => `<option value="${{s.id}}">${{s.label}}</option>`).join('');
  $('sel-zoom').value = arep.size <= 32 ? '6' : '3';
  stepIdx = 0; elapsed = 0;
  drawFrame();
}}

function drawChecker(ctx, w, h, step) {{
  for (let y = 0; y < h; y += step) {{
    for (let x = 0; x < w; x += step) {{
      ctx.fillStyle = (((x / step) + (y / step)) & 1) ? '#231e2e' : '#1b1724';
      ctx.fillRect(x, y, step, step);
    }}
  }}
}}

function drawFrame() {{
  const arep = REPORT.actors[actorId];
  const seq = getSeq();
  if (!arep || !seq) return;
  const step = seq.steps[stepIdx % seq.steps.length];
  const prevStep = seq.steps[(stepIdx - 1 + seq.steps.length) % seq.steps.length];
  const mirror = arep.uses_west_mirror && dir === 'west';
  const srcDir = mirror ? 'east' : dir;
  const z = Number($('sel-zoom').value);
  const sz = arep.size;
  const pad = 20;
  const cw = sz * z + pad * 2;
  const ch = sz * z + pad * 2;

  const cv = $('cv-anim');
  if (cv.width !== cw || cv.height !== ch) {{ cv.width = cw; cv.height = ch; }}
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#14101a';
  ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(pad, pad);
  drawChecker(ctx, sz * z, sz * z, Math.max(4, z * 2));

  const [pivX, pivY] = arep.pivot;
  const hover = (actorId === 'boss_ghost_king' && $('chk-hover').checked) ? Math.round(Math.sin(totalTick * 2) * 1.4) : 0;

  if ($('chk-shadow').checked) {{
    const rx = (sz <= 32 ? 9 : 20) * z;
    const ry = rx * 0.28;
    ctx.fillStyle = 'rgba(20,16,26,0.68)';
    ctx.beginPath();
    ctx.ellipse(pivX * z, (pivY - 1) * z, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }}

  const webImg = images[actorId];
  const findWeb = (pName) => (arep.web_export.frames || []).find(f => f.direction === srcDir && f.pose === pName);
  const curWeb = findWeb(step.pose);
  const prvWeb = findWeb(prevStep.pose);

  const blit = (wf, alpha) => {{
    if (!webImg || !wf) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pivX * z, (pivY + hover) * z);
    if (mirror) ctx.scale(-1, 1);
    const [rx, ry, rw, rh] = wf.rect;
    ctx.drawImage(webImg, rx, ry, rw, rh, -pivX * z, -pivY * z, rw * z, rh * z);
    ctx.restore();
  }};

  if ($('chk-onion').checked && prvWeb && prvWeb !== curWeb) blit(prvWeb, 0.28);
  blit(curWeb, 1.0);

  if ($('chk-bounds').checked) {{
    ctx.strokeStyle = 'rgba(160,153,173,0.45)';
    ctx.strokeRect(0.5, 0.5, sz * z - 1, sz * z - 1);
    if (curWeb && curWeb.edge_touches.length) {{
      ctx.strokeStyle = '#ff6b63';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, sz * z - 2, sz * z - 2);
      ctx.lineWidth = 1;
    }}
  }}
  if ($('chk-pivot').checked) {{
    ctx.strokeStyle = '#8ae8ff';
    ctx.beginPath();
    ctx.moveTo(pivX * z - 10, pivY * z + 0.5); ctx.lineTo(pivX * z + 10, pivY * z + 0.5);
    ctx.moveTo(pivX * z + 0.5, pivY * z - 10); ctx.lineTo(pivX * z + 0.5, pivY * z + 10);
    ctx.stroke();
  }}
  ctx.restore();

  $('cap-anim').textContent = `${{actorId}} · ${{dir}}/${{step.pose}} (${{step.ms}}ms) · ${{sz}}×${{sz}} @ ${{z}}×${{mirror?' · MIRRORED':''}}`;

  const cm = arep.cells.find(c => c.direction === srcDir && c.pose === step.pose);
  const scv = $('cv-source');
  const sctx = scv.getContext('2d');
  sctx.imageSmoothingEnabled = false;
  drawChecker(sctx, scv.width, scv.height, 8);
  const sth = srcThumbs[actorId]?.[`${{srcDir}}/${{step.pose}}`];
  if (sth && cm) {{
    const [x0, y0, x1, y1] = cm.cell_rect;
    const cwS = x1 - x0, chS = y1 - y0;
    const ox = Math.floor((scv.width - sth.width) / 2);
    const oy = Math.floor((scv.height - sth.height) / 2);
    sctx.save();
    if (mirror) {{ sctx.translate(scv.width, 0); sctx.scale(-1, 1); }}
    sctx.drawImage(sth, ox, oy);
    const sx = sth.width / cwS, sy = sth.height / chS;
    const [bx0, by0, bx1, by1] = cm.source_bbox_local;
    sctx.strokeStyle = '#f5d765';
    sctx.strokeRect(ox + bx0 * sx, oy + by0 * sy, (bx1 - bx0) * sx, (by1 - by0) * sy);
    const [lax, lay] = cm.contract_anchor_local;
    sctx.strokeStyle = '#8ae8ff';
    sctx.beginPath();
    sctx.moveTo(ox + lax * sx - 6, oy + lay * sy); sctx.lineTo(ox + lax * sx + 6, oy + lay * sy);
    sctx.moveTo(ox + lax * sx, oy + lay * sy - 6); sctx.lineTo(ox + lax * sx, oy + lay * sy + 6);
    sctx.stroke();
    const fmx = cm.measured_foot_mid_x_global - x0;
    sctx.strokeStyle = '#5cc796';
    sctx.beginPath();
    sctx.moveTo(ox + fmx * sx - 5, oy + by1 * sy); sctx.lineTo(ox + fmx * sx + 5, oy + by1 * sy);
    sctx.moveTo(ox + fmx * sx, oy + by1 * sy - 5); sctx.lineTo(ox + fmx * sx, oy + by1 * sy + 5);
    sctx.stroke();
    sctx.restore();
  }}

  if (cm) {{
    $('pose-kv').innerHTML = `
      <span>Source Cell</span><code>${{cm.cell_rect.join(', ')}} (${{cm.source}})</code>
      <span>Contract Anchor</span><code>(${{cm.contract_anchor.join(', ')}})</code>
      <span>Measured Ground</span><code>(${{cm.measured_foot_mid_x_global}}, ${{cm.measured_bottom_y_global}})</code>
      <span>Anchor dY / dX</span><code>${{cm.anchor_delta_ground_src_px}}px (${{cm.anchor_delta_ground_nat_px}} nat) / ${{cm.anchor_delta_foot_x_src_px}}px</code>
      <span>Projected BBox</span><code>${{cm.projected_native_bbox.join(', ')}}</code>
      <span>Projected Clip</span><code style="color:${{cm.projected_clip.length?'var(--err)':'var(--ok)'}}">${{cm.projected_clip.length?cm.projected_clip.join(', '):'none'}}</code>
      <span>Lean / Asym</span><code>${{cm.lean_ratio}} / ${{cm.reach_asymmetry}}</code>
      <span>Safe 1px Scale</span><code>${{cm.safe_scale_1px_margin}} (contract=${{arep.scale}})</code>
      <span>Web Edge Touch</span><code>${{curWeb && curWeb.edge_touches.length ? curWeb.edge_touches.join(', ') : 'none'}}</code>
      <span>Web Ink 2×2 / Speck</span><code>${{curWeb ? curWeb.outline_2x2_blocks + ' / ' + curWeb.speckle_px + 'px' : '—'}}</code>
    `;
  }}
  const stab = arep.row_stability[srcDir];
  $('row-kv').innerHTML = stab ? `
    <span>Row</span><code>${{srcDir}}${{mirror?' → mirrored west':''}}</code>
    <span>Bottom Y Jitter</span><code>${{stab.projected_bottom_jitter_px}} nat px</code>
    <span>Head X Drift</span><code>${{stab.projected_head_x_drift_px}} nat px (${{stab.head_x_outlier_pose}})</code>
    <span>Rec Max Scale</span><code>${{arep.recommended_max_uniform_scale_1px_margin}}</code>
    <span>Web Dirty Alpha=0</span><code style="color:${{arep.web_export.hygiene?.dirty_transparent_px?'var(--err)':'var(--ok)'}}">${{arep.web_export.hygiene?.dirty_transparent_px ?? '—'}} px</code>
    <span>Web Ink Share</span><code>${{arep.web_export.hygiene ? (arep.web_export.hygiene.ink_outline_share*100).toFixed(1)+'%' : '—'}}</code>
  ` : '';
}}

async function init() {{
  for (const [id, entry] of Object.entries(ART)) {{
    if (entry.webDataUri) images[id] = await loadImg(entry.webDataUri);
    srcThumbs[id] = {{}};
    for (const [k, uri] of Object.entries(entry.sourceThumbUris || {{}})) {{
      srcThumbs[id][k] = await loadImg(uri);
    }}
  }}
  renderSummary();
  populateControls();
  $('sel-actor').onchange = (e) => {{ actorId = e.target.value; updateActorDependent(); }};
  $('sel-dir').onchange = (e) => {{ dir = e.target.value; drawFrame(); }};
  $('sel-seq').onchange = (e) => {{ seqId = e.target.value; stepIdx = 0; elapsed = 0; drawFrame(); }};
  for (const id of ['sel-zoom','chk-pivot','chk-shadow','chk-bounds','chk-onion','chk-hover']) {{
    $(id).onchange = drawFrame;
  }}
  $('btn-play').onclick = () => {{ playing = !playing; $('btn-play').textContent = playing ? 'Pause' : 'Play'; }};
  $('btn-prev').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getSeq().steps.length; stepIdx = (stepIdx - 1 + n) % n; drawFrame(); }};
  $('btn-next').onclick = () => {{ playing = false; $('btn-play').textContent = 'Play'; const n = getSeq().steps.length; stepIdx = (stepIdx + 1) % n; drawFrame(); }};

  let last = performance.now();
  function tick(now) {{
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    totalTick += dt;
    if (playing) {{
      const seq = getSeq();
      const speed = Number($('sel-speed').value);
      elapsed += dt * 1000 * speed;
      const cur = seq.steps[stepIdx % seq.steps.length];
      if (elapsed >= cur.ms) {{
        elapsed %= cur.ms;
        stepIdx = (stepIdx + 1) % seq.steps.length;
      }}
    }}
    drawFrame();
    requestAnimationFrame(tick);
  }}
  requestAnimationFrame(tick);
}}
init();
</script>
</body>
</html>
"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--encounter-dir", type=Path, required=True, help="Read-only path to encounter directory containing contract.json and source/")
    ap.add_argument("--runtime-dir", type=Path, default=None, help="Optional read-only path to preview-app/blood-sea")
    ap.add_argument("--manifest", type=Path, default=REPO / "assets/manifest.json")
    ap.add_argument("--palette", type=Path, default=REPO / "tools/generators/palette.json")
    ap.add_argument("--out-dir", type=Path, default=None, help="Output directory for report JSON, contact sheet PNG, and HTML workbench")
    ap.add_argument("--strict", action="store_true", help="Exit 1 if any error-level exceptions are found")
    args = ap.parse_args(argv)

    enc_dir = args.encounter_dir.resolve()
    rt_dir = args.runtime_dir.resolve() if args.runtime_dir else None
    if rt_dir is None:
        cand = enc_dir.parents[2] / "preview-app/blood-sea" if len(enc_dir.parents) >= 3 else None
        if cand and cand.is_dir():
            rt_dir = cand

    report = audit_encounter(enc_dir, args.manifest.resolve(), args.palette.resolve(), rt_dir)

    if args.out_dir:
        out_dir = args.out_dir.resolve()
        if enc_dir in out_dir.parents or out_dir == enc_dir:
            ap.error("--out-dir must not write inside --encounter-dir (source tree stays read-only)")
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "blood-sea-qa-report.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        build_contact_sheet(enc_dir, report, out_dir / "blood-sea-qa-contact-sheet.png")
        build_html_workbench(enc_dir, report, out_dir / "blood-sea-animation-qa.html")

    s = report["summary"]
    print(f"Blood Sea Animation QA: errors={s['errors']} warnings={s['warnings']} info={s['info']}")
    for e in report["exceptions"]:
        if e["severity"] in ("error", "warn"):
            print(f"  [{e['severity'].upper():5}] {e['actor']} {e['where']:22} {e['code']}: {e['detail']}")
    return 1 if (args.strict and s["errors"] > 0) else 0


if __name__ == "__main__":
    sys.exit(main())
