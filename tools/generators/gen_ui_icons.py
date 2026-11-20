#!/usr/bin/env python3
"""Deterministic procedural pixel-art generator for Tiên Nghịch 2D UI & Card Icons.

Generates crisp 3/4 top-down Soul Knight-style pixel art using ONLY the 40-color
Xianxia FINAL v2 palette defined in ``tools/generators/palette.json`` (referenced
strictly by stable color ``id``: ``jade_01..07``, ``blood_01..07``,
``bronze_01..07``, ``soul_01..07``, ``thunder_01..06``, ``ink_01..06``), with
binary alpha (transparent backgrounds) and a strict 1px ``ink_01`` outline around
every silhouette edge.

Scope
-----
1. All 16 skill/restriction card icons from ``assets/manifest.json``
   (``assigned_agent == "codex_antigravity"``, ``category == "icon"``), generated
   at both ``24x24`` and ``16x16`` per manifest ``variant_sizes`` and
   ``palette.json`` ``size_classes.icon``:
   - icon_sinh_tu_cam           (Sinh Tử Cấm / Life-Death Restriction)
   - icon_tue_nguyet_cam        (Tuế Nguyệt Cấm / Years-Moon Restriction)
   - icon_thien_loi_dan         (Thiên Lôi Dẫn / Heaven Thunder Guide)
   - icon_van_hon_phe_tam       (Vạn Hồn Phệ Tâm / Myriad Souls Devour Heart)
   - icon_huyet_hai_cuong_trieu (Huyết Hải Cuồng Triều / Blood Sea Surge)
   - icon_thanh_phong_don       (Thanh Phong Độn / Azure Wind Step)
   - icon_ho_the_cuong_khi      (Hộ Thể Cương Khí / Guardian Qi Shield)
   - icon_ngung_khi_quyet       (Ngưng Khí Quyết / Qi Condensing Art)
   - icon_truc_co_dan           (Trúc Cơ Đan / Foundation Pill)
   - icon_thien_nghich_chi_luc  (Thiên Nghịch Chi Lực / Defy-Heaven Power)
   - icon_co_than_the           (Cổ Thần Thể / Ancient God Body)
   - icon_hu_khong_liet_phung   (Hư Không Liệt Phùng / Void Rift)
   - icon_phong_an_cam          (Phong Ấn Cấm / Sealing Restriction)
   - icon_cuc_canh_hoa_than     (Cực Cảnh Hóa Thần / Extreme Jing Soul Formation)
   - icon_huyet_te              (Huyết Tế / Blood Sacrifice)
   - icon_tu_linh_tran          (Tụ Linh Trận / Spirit Gathering Array)

2. Mobile-friendly HUD icons:
   - ui_spirit_stone : follows manifest ``size: [16, 16]``, ``animations.idle``
     (4 individual 16x16 frames, one canvas per frame per ``docs/ART_BIBLE.md``)
     plus a supplemental 24x24 HUD icon variant (documented).
   - hud_hp          : manifest only defines 64x8 bars (``ui_hud_bars``) and is
     silent on a standalone HP icon -> generated at 24x24 + 16x16.
   - hud_qi          : manifest is silent on a standalone Spirit Qi/Mana icon
     -> generated at 24x24 + 16x16.
   - hud_btn_dash    : manifest is silent on a mobile Dash button -> generated
     at 24x24 + 16x16 with bold medallion contrast for touch legibility.
   - hud_btn_attack  : manifest is silent on a mobile Attack button -> generated
     at 24x24 + 16x16 with bold medallion contrast for touch legibility.

Output Layout
-------------
All outputs are written under ``--out`` (default ``assets/raw/environment_items/ui``)
per ``docs/ASSET_ROUTING.md`` and the generator contract, alongside
``gen_ui_icons_log.json`` (recording files, manifest output_paths, dims, frames,
seeds, and SHA-256 digests). Every generated PNG strictly conforms to
``palette.json`` ``size_classes.icon`` (``16x16`` or ``24x24``).

CLI Examples
------------
    python tools/generators/gen_ui_icons.py
    python tools/generators/gen_ui_icons.py --out assets/raw/environment_items/ui
    python tools/generators/gen_ui_icons.py --only icon_sinh_tu_cam
    python tools/generators/gen_ui_icons.py --only hud_btn_attack --out /tmp/test_ui
    python tools/generators/gen_ui_icons.py --contact-sheet-dir /tmp/previews
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_PALETTE = REPO_ROOT / "tools" / "generators" / "palette.json"
DEFAULT_MANIFEST = REPO_ROOT / "assets" / "manifest.json"
DEFAULT_OUT = REPO_ROOT / "assets" / "raw" / "environment_items" / "ui"


# ---------------------------------------------------------------------------
# Palette (all colors loaded strictly from palette.json v2 by stable id)
# ---------------------------------------------------------------------------

def _hex_to_rgba(hex_str: str) -> Tuple[int, int, int, int]:
    s = hex_str.lstrip("#")
    if len(s) != 6:
        raise ValueError(f"Expected 6-digit hex color, got {hex_str!r}")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


class Palette:
    """Lookup table for the 40-color Xianxia v2 palette keyed strictly by ``id``."""

    def __init__(self, path: Path) -> None:
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.name: str = raw["name"]
        self.version: int = int(raw.get("version", 1))
        self.colors: Dict[str, Tuple[int, int, int, int]] = {}
        self.rgb_set: set[Tuple[int, int, int]] = set()
        for entry in raw["colors"]:
            cid = entry["id"]
            rgba = _hex_to_rgba(entry["hex"])
            self.colors[cid] = rgba
            self.rgb_set.add(rgba[:3])
        self.outline_id: str = raw["outline_id"]
        self.outline_rgba: Tuple[int, int, int, int] = self.colors[self.outline_id]
        if self.outline_rgba != _hex_to_rgba(raw["outline"]):
            raise ValueError("palette.json outline hex does not match outline_id color")
        self.icon_sizes: List[Tuple[int, int]] = [
            (int(w), int(h)) for w, h in raw["size_classes"]["icon"]["sizes"]
        ]

    def rgba(self, color_id: str) -> Tuple[int, int, int, int]:
        try:
            return self.colors[color_id]
        except KeyError as exc:
            raise KeyError(f"Unknown palette color id: {color_id!r}") from exc


# ---------------------------------------------------------------------------
# Deterministic pixel canvas with strict 1px silhouette outline
# ---------------------------------------------------------------------------

class PixelCanvas:
    """Integer-grid RGBA pixel canvas enforcing binary alpha and 1px outline."""

    def __init__(self, width: int, height: int, palette: Palette) -> None:
        self.w = width
        self.h = height
        self.pal = palette
        self.buf = np.zeros((height, width, 4), dtype=np.uint8)
        # Interior drawing stays inside [1..w-2, 1..h-2] so the 4-connected
        # 1px outline always fits cleanly within [0..w-1, 0..h-1].
        self.margin = 1

    def in_interior(self, x: int, y: int) -> bool:
        return self.margin <= x < self.w - self.margin and self.margin <= y < self.h - self.margin

    def px(self, x: float, y: float, color_id: str) -> None:
        ix, iy = int(round(x)), int(round(y))
        if self.in_interior(ix, iy):
            self.buf[iy, ix] = self.pal.rgba(color_id)

    def clear_px(self, x: float, y: float) -> None:
        ix, iy = int(round(x)), int(round(y))
        if 0 <= ix < self.w and 0 <= iy < self.h:
            self.buf[iy, ix] = (0, 0, 0, 0)

    def rect(self, x0: int, y0: int, x1: int, y1: int, color_id: str) -> None:
        rgba = self.pal.rgba(color_id)
        xa, xb = max(self.margin, min(x0, x1)), min(self.w - 1 - self.margin, max(x0, x1))
        ya, yb = max(self.margin, min(y0, y1)), min(self.h - 1 - self.margin, max(y0, y1))
        if xa <= xb and ya <= yb:
            self.buf[ya:yb + 1, xa:xb + 1] = rgba

    def line(self, x0: float, y0: float, x1: float, y1: float, color_id: str) -> None:
        """Crisp integer Bresenham line."""
        ix0, iy0, ix1, iy1 = int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1))
        dx = abs(ix1 - ix0)
        dy = -abs(iy1 - iy0)
        sx = 1 if ix0 < ix1 else -1
        sy = 1 if iy0 < iy1 else -1
        err = dx + dy
        while True:
            self.px(ix0, iy0, color_id)
            if ix0 == ix1 and iy0 == iy1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                ix0 += sx
            if e2 <= dx:
                err += dx
                iy0 += sy

    def thick_line(self, x0: float, y0: float, x1: float, y1: float, radius: float, color_id: str) -> None:
        """Integer capsule stroke from (x0, y0) to (x1, y1)."""
        rgba = self.pal.rgba(color_id)
        vx, vy = x1 - x0, y1 - y0
        l2 = vx * vx + vy * vy
        r2 = radius * radius
        for y in range(self.margin, self.h - self.margin):
            for x in range(self.margin, self.w - self.margin):
                t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((x - x0) * vx + (y - y0) * vy) / l2))
                px = x0 + t * vx
                py = y0 + t * vy
                if (x - px) ** 2 + (y - py) ** 2 <= r2:
                    self.buf[y, x] = rgba

    def circle(
        self,
        cx: float,
        cy: float,
        r: float,
        color_id: str,
        fill: bool = True,
        thickness: float = 1.15,
    ) -> None:
        rgba = self.pal.rgba(color_id)
        r2 = r * r
        ri2 = max(0.0, (r - thickness)) ** 2
        for y in range(self.margin, self.h - self.margin):
            for x in range(self.margin, self.w - self.margin):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if fill:
                    if d2 <= r2:
                        self.buf[y, x] = rgba
                elif ri2 <= d2 <= r2:
                    self.buf[y, x] = rgba

    def ellipse(
        self,
        cx: float,
        cy: float,
        rx: float,
        ry: float,
        color_id: str,
        fill: bool = True,
        thickness: float = 0.25,
    ) -> None:
        rgba = self.pal.rgba(color_id)
        if rx <= 0 or ry <= 0:
            return
        for y in range(self.margin, self.h - self.margin):
            for x in range(self.margin, self.w - self.margin):
                v = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
                if fill:
                    if v <= 1.0:
                        self.buf[y, x] = rgba
                elif (1.0 - thickness) ** 2 <= v <= 1.0:
                    self.buf[y, x] = rgba

    def shaded_circle(
        self,
        cx: float,
        cy: float,
        r: float,
        ramp: Sequence[str],
        light_dir: Tuple[float, float] = (-0.65, -0.76),
    ) -> None:
        """Draw a top-left lit sphere quantized cleanly across ``ramp`` (dark -> light)."""
        n = len(ramp)
        lx, ly = light_dir
        for y in range(self.margin, self.h - self.margin):
            for x in range(self.margin, self.w - self.margin):
                dx = (x - cx) / max(r, 0.001)
                dy = (y - cy) / max(r, 0.001)
                d2 = dx * dx + dy * dy
                if d2 <= 1.0:
                    nz = math.sqrt(max(0.0, 1.0 - d2))
                    dot = dx * lx + dy * ly + 0.52 * nz
                    t = max(0.0, min(0.9999, (dot + 0.65) / 1.85))
                    idx = min(n - 1, int(t * n))
                    self.buf[y, x] = self.pal.rgba(ramp[idx])

    def diamond(self, cx: float, cy: float, rx: float, ry: float, color_id: str) -> None:
        rgba = self.pal.rgba(color_id)
        for y in range(self.margin, self.h - self.margin):
            for x in range(self.margin, self.w - self.margin):
                if abs(x - cx) / max(rx, 0.001) + abs(y - cy) / max(ry, 0.001) <= 1.0:
                    self.buf[y, x] = rgba

    def poly(self, pts: Sequence[Tuple[float, float]], color_id: str) -> None:
        """Deterministic point-in-polygon fill on integer pixel centers."""
        rgba = self.pal.rgba(color_id)
        n = len(pts)
        if n < 3:
            return
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        min_x = max(self.margin, int(math.floor(min(xs))))
        max_x = min(self.w - 1 - self.margin, int(math.ceil(max(xs))))
        min_y = max(self.margin, int(math.floor(min(ys))))
        max_y = min(self.h - 1 - self.margin, int(math.ceil(max(ys))))
        for y in range(min_y, max_y + 1):
            py = y + 0.01
            for x in range(min_x, max_x + 1):
                px = x + 0.01
                inside = False
                j = n - 1
                for i in range(n):
                    xi, yi = pts[i]
                    xj, yj = pts[j]
                    if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
                        inside = not inside
                    j = i
                if inside:
                    self.buf[y, x] = rgba

    def sparkle(self, cx: float, cy: float, arm: int, color_id: str, core_id: Optional[str] = None) -> None:
        """Draw a crisp 4-point pixel sparkle."""
        ix, iy = int(round(cx)), int(round(cy))
        for d in range(-arm, arm + 1):
            self.px(ix + d, iy, color_id)
            self.px(ix, iy + d, color_id)
        self.px(ix, iy, core_id or color_id)

    def apply_outline(self) -> None:
        """Apply a guaranteed 1px 4-connected ``ink_01`` silhouette outline.

        Because all interior drawing stays inside ``[1..w-2, 1..h-2]`` and never
        uses ``ink_01`` on silhouette borders, every newly outlined pixel has at
        least one non-outline opaque neighbor, guaranteeing zero edge errors and
        zero >1px thickness warnings under ``validate_palette.py --border-is-edge``.
        """
        opaque = self.buf[:, :, 3] == 255
        if not np.any(opaque):
            return
        outline_rgb = np.array(self.pal.outline_rgba[:3], dtype=np.uint8)
        fallback_dark = self.pal.rgba("ink_02")
        matches_outline = opaque & np.all(self.buf[:, :, :3] == outline_rgb, axis=2)
        if np.any(matches_outline):
            self.buf[matches_outline] = fallback_dark

        dilated = np.zeros_like(opaque)
        dilated[1:, :] |= opaque[:-1, :]
        dilated[:-1, :] |= opaque[1:, :]
        dilated[:, 1:] |= opaque[:, :-1]
        dilated[:, :-1] |= opaque[:, 1:]
        ring = dilated & (~opaque)
        self.buf[ring] = self.pal.outline_rgba

    def to_image(self) -> Image.Image:
        return Image.fromarray(self.buf, mode="RGBA")


def _seed_for(asset_id: str, w: int, h: int, frame: int = 0) -> int:
    digest = hashlib.sha256(f"tien-nghich-2d:v2:{asset_id}:{w}x{h}:f{frame}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


# ---------------------------------------------------------------------------
# 16 Skill & Restriction Card Icon Renderers (24x24 & 16x16, v2 palette IDs)
# ---------------------------------------------------------------------------

def draw_icon_sinh_tu_cam(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Sinh Tử Cấm (Life-Death Restriction): Blood/Ghost Yin-Yang inside gold rune ring."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    r_outer = (c.w - 2) / 2.0 - 0.3
    r_inner = r_outer - (1.8 if c.w >= 24 else 1.2)

    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy)
            if r_inner < d <= r_outer:
                lit = (-dx - dy) / max(r_outer, 1.0)
                if lit > 0.45:
                    col = "bronze_06"
                elif lit > -0.15:
                    col = "bronze_05"
                else:
                    col = "bronze_03"
                c.px(x, y, col)

    half_r = r_inner / 2.0
    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            dx, dy = x - cx, y - cy
            if math.hypot(dx, dy) <= r_inner:
                d_top = math.hypot(dx, dy + half_r)
                d_bot = math.hypot(dx, dy - half_r)
                if d_top <= half_r:
                    is_life = True
                elif d_bot <= half_r:
                    is_life = False
                else:
                    is_life = dx < 0

                lit = (-0.65 * dx - 0.75 * dy) / max(r_inner, 1.0)
                if is_life:
                    if lit > 0.35:
                        col = "blood_05"
                    elif lit > -0.2:
                        col = "blood_04"
                    else:
                        col = "blood_03"
                else:
                    if lit > 0.35:
                        col = "ink_06"
                    elif lit > -0.15:
                        col = "ink_05"
                    elif lit > -0.55:
                        col = "ink_04"
                    else:
                        col = "ink_03"
                c.px(x, y, col)

    eye_r = 1.35 if c.w >= 24 else 0.85
    c.circle(cx, cy - half_r, eye_r, "ink_06")
    c.px(cx, cy - half_r, "thunder_04")
    c.circle(cx, cy + half_r, eye_r, "blood_04")
    c.px(cx, cy + half_r, "blood_06")

    if c.w >= 24:
        for ax, ay in [(cx, 1.5), (cx, c.h - 2.5), (1.5, cy), (c.w - 2.5, cy)]:
            c.px(ax, ay, "bronze_07")


def draw_icon_tue_nguyet_cam(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Tuế Nguyệt Cấm (Years-Moon Restriction): Golden crescent moon + time hourglass."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Deep night-obsidian temporal disk
    c.shaded_circle(cx, cy, 9.6 * s, ["soul_01", "soul_01", "soul_02", "thunder_01"])

    # Golden crescent moon curving along left & bottom
    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            d_main = math.hypot(x - (cx - 0.6 * s), y - cy)
            d_cut = math.hypot(x - (cx + 2.9 * s), y - (cy - 1.3 * s))
            if d_main <= 9.2 * s and d_cut >= 6.4 * s:
                lit = (-(x - cx) - (y - cy)) / max(9.0 * s, 1.0)
                if lit > 0.35:
                    col = "bronze_07"
                elif lit > -0.1:
                    col = "bronze_06"
                elif lit > -0.5:
                    col = "bronze_05"
                else:
                    col = "bronze_03"
                c.px(x, y, col)

    # Crisp hourglass inside crescent hollow
    hx = cx + 2.4 * s
    hy = cy - 0.4 * s
    hw = max(2, int(round(3.4 * s)))
    hh = max(4, int(round(5.6 * s)))

    c.rect(round(hx - hw), round(hy - hh), round(hx + hw), round(hy - hh + max(0, round(0.7 * s))), "bronze_06")
    c.rect(round(hx - hw), round(hy + hh - max(0, round(0.7 * s))), round(hx + hw), round(hy + hh), "bronze_04")

    c.poly(
        [
            (hx - hw + 0.4 * s, hy - hh + 1.0 * s),
            (hx + hw - 0.4 * s, hy - hh + 1.0 * s),
            (hx, hy),
        ],
        "thunder_03",
    )
    c.poly(
        [
            (hx, hy),
            (hx - hw + 0.4 * s, hy + hh - 1.0 * s),
            (hx + hw - 0.4 * s, hy + hh - 1.0 * s),
        ],
        "thunder_01",
    )

    c.poly(
        [
            (hx - hw * 0.55, hy - hh * 0.45),
            (hx + hw * 0.55, hy - hh * 0.45),
            (hx, hy),
        ],
        "bronze_07",
    )
    c.poly(
        [
            (hx, hy + hh * 0.25),
            (hx - hw * 0.65, hy + hh - 1.1 * s),
            (hx + hw * 0.65, hy + hh - 1.1 * s),
        ],
        "bronze_05",
    )
    c.line(hx, hy, hx, hy + hh * 0.45, "thunder_04")

    c.px(cx - 5.2 * s, cy - 5.2 * s, "thunder_04")
    if c.w >= 24:
        c.px(hx + 3.2 * s, hy - 4.2 * s, "thunder_03")


def draw_icon_thien_loi_dan(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Thiên Lôi Dẫn (Heaven Thunder Guide): Jagged thunderbolt striking a target seal."""
    s = c.w / 24.0
    cx = (c.w - 1) / 2.0

    # Target restriction ring on the ground (3/4 perspective ellipse)
    ry_cy = c.h - 4.8 * s
    c.ellipse(cx, ry_cy, 8.6 * s, 3.2 * s, "blood_02", fill=True)
    c.ellipse(cx, ry_cy, 8.2 * s, 2.9 * s, "blood_05", fill=False, thickness=0.38)
    c.ellipse(cx, ry_cy, 4.6 * s, 1.6 * s, "thunder_05", fill=False, thickness=0.45)

    # Outer red-thunder plasma halo behind bolt
    bolt_outer = [
        (13.8 * s, 1.5 * s),
        (18.2 * s, 1.5 * s),
        (13.2 * s, 9.2 * s),
        (17.8 * s, 9.2 * s),
        (9.2 * s, 20.5 * s),
        (10.8 * s, 12.2 * s),
        (6.4 * s, 12.2 * s),
    ]
    c.poly(bolt_outer, "thunder_05")

    # Golden lightning core body
    bolt_mid = [
        (14.1 * s, 2.2 * s),
        (17.1 * s, 2.2 * s),
        (12.2 * s, 9.8 * s),
        (16.2 * s, 9.8 * s),
        (9.6 * s, 19.6 * s),
        (11.6 * s, 11.4 * s),
        (7.7 * s, 11.4 * s),
    ]
    c.poly(bolt_mid, "bronze_06")

    # Searing flash-white spine
    c.line(15.2 * s, 2.6 * s, 10.2 * s, 10.6 * s, "thunder_04")
    c.line(10.2 * s, 10.6 * s, 14.0 * s, 10.6 * s, "bronze_07")
    c.line(14.0 * s, 10.6 * s, 10.0 * s, 18.2 * s, "thunder_04")

    c.sparkle(10.0 * s, ry_cy, max(1, round(2.0 * s)), "bronze_07", "thunder_04")
    if c.w >= 24:
        c.px(4, 7, "thunder_05")
        c.px(19, 6, "bronze_07")
        c.px(18, 15, "thunder_06")


def draw_icon_van_hon_phe_tam(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Vạn Hồn Phệ Tâm (Myriad Souls Devour Heart): Swirling violet/jade ghost flames clutching crimson heart."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Flame-licked violet soul vortex rising from below & flanking the heart
    flame_outer = [
        (cx - 8.8 * s, 13.5 * s),
        (cx - 9.4 * s, 7.2 * s),
        (cx - 6.2 * s, 2.4 * s),
        (cx - 3.6 * s, 6.2 * s),
        (cx, 1.6 * s),
        (cx + 3.6 * s, 6.2 * s),
        (cx + 6.4 * s, 2.6 * s),
        (cx + 9.4 * s, 7.5 * s),
        (cx + 8.6 * s, 14.2 * s),
        (cx + 5.0 * s, 20.6 * s),
        (cx, 21.8 * s),
        (cx - 5.0 * s, 20.6 * s),
    ]
    c.poly(flame_outer, "soul_03")

    # Inner bright violet & eerie jade soul-tendril flames
    flame_mid = [
        (cx - 7.2 * s, 14.0 * s),
        (cx - 7.0 * s, 7.8 * s),
        (cx - 5.4 * s, 4.2 * s),
        (cx - 2.4 * s, 8.2 * s),
        (cx, 3.6 * s),
        (cx + 2.6 * s, 8.2 * s),
        (cx + 5.6 * s, 4.4 * s),
        (cx + 7.2 * s, 8.2 * s),
        (cx + 6.6 * s, 14.8 * s),
        (cx, 20.2 * s),
    ]
    c.poly(flame_mid, "soul_05")

    # Ghostly jade wisp tongues licking upward on the flanks
    c.line(cx - 7.2 * s, 12.6 * s, cx - 5.6 * s, 4.6 * s, "jade_05")
    c.line(cx + 7.0 * s, 12.6 * s, cx + 5.6 * s, 4.8 * s, "jade_06")
    c.line(cx, 6.8 * s, cx, 2.8 * s, "soul_07")

    # Central crimson heart being engulfed by spectral claws
    hy_c = cy + 2.2 * s
    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            nx = (x - cx) / (5.4 * s)
            ny = -(y - hy_c) / (5.2 * s)
            ny_adj = ny * 1.12 + 0.16
            v = (nx * nx + ny_adj * ny_adj - 1.0) ** 3 - (nx * nx) * (ny_adj ** 3)
            if v <= 0.0:
                lit = -0.6 * nx + 0.7 * ny_adj
                col = "blood_06" if lit > 0.45 else ("blood_05" if lit > 0.0 else ("blood_04" if lit > -0.45 else "blood_02"))
                c.px(x, y, col)

    # Spectral violet/jade claw streaks gripping across the heart
    c.line(cx - 5.2 * s, hy_c + 1.0 * s, cx - 1.2 * s, hy_c + 2.6 * s, "soul_06")
    c.line(cx + 5.2 * s, hy_c + 0.4 * s, cx + 1.2 * s, hy_c + 2.0 * s, "jade_06")
    c.px(cx - 2.0 * s, hy_c - 1.8 * s, "blood_07")


def draw_icon_huyet_hai_cuong_trieu(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Huyết Hải Cuồng Triều (Blood Sea Surge): Towering curling crimson wave."""
    s = c.w / 24.0

    wave_body = [
        (2.0 * s, 21.0 * s),
        (2.0 * s, 11.5 * s),
        (4.6 * s, 5.2 * s),
        (10.0 * s, 2.4 * s),
        (16.6 * s, 2.8 * s),
        (20.0 * s, 6.4 * s),
        (16.2 * s, 8.6 * s),
        (12.0 * s, 7.6 * s),
        (10.4 * s, 11.4 * s),
        (13.8 * s, 13.8 * s),
        (21.6 * s, 14.4 * s),
        (21.6 * s, 21.0 * s),
    ]
    c.poly(wave_body, "blood_03")

    wave_mid = [
        (2.5 * s, 16.5 * s),
        (5.0 * s, 6.4 * s),
        (10.4 * s, 3.2 * s),
        (16.0 * s, 3.6 * s),
        (18.6 * s, 6.4 * s),
        (14.5 * s, 7.4 * s),
        (10.0 * s, 7.4 * s),
        (8.4 * s, 12.6 * s),
        (12.8 * s, 15.8 * s),
        (21.0 * s, 16.0 * s),
        (21.0 * s, 18.4 * s),
        (5.8 * s, 18.6 * s),
    ]
    c.poly(wave_mid, "blood_04")

    # Deep dark blood-sea undertow
    c.poly(
        [
            (2.2 * s, 18.4 * s),
            (21.2 * s, 18.2 * s),
            (21.2 * s, 21.0 * s),
            (2.2 * s, 21.0 * s),
        ],
        "blood_02",
    )

    # Bright scarlet ridge along curling lip
    c.thick_line(5.2 * s, 7.8 * s, 10.6 * s, 3.8 * s, max(0.9, 1.3 * s), "blood_05")
    c.thick_line(10.6 * s, 3.8 * s, 16.8 * s, 4.6 * s, max(0.8, 1.2 * s), "blood_05")
    c.thick_line(16.8 * s, 4.6 * s, 19.4 * s, 7.2 * s, max(0.7, 1.0 * s), "blood_06")

    # Pale foam claws & spray droplets
    c.line(9.8 * s, 3.4 * s, 15.4 * s, 3.6 * s, "blood_07")
    c.px(18.0 * s, 5.2 * s, "thunder_04")
    c.px(19.6 * s, 7.2 * s, "blood_07")
    c.circle(20.0 * s, 10.6 * s, max(0.7, 1.0 * s), "blood_05")
    if c.w >= 24:
        c.px(19, 2, "blood_07")
        c.px(21, 5, "blood_06")
        c.line(6, 15, 11, 16, "blood_05")


def draw_icon_thanh_phong_don(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Thanh Phong Độn (Azure Wind Step): Sweeping azure gale blades & afterimage dash."""
    s = c.w / 24.0
    y_shift = 1.6 * s  # Clean vertical centering at both 24x24 and 16x16

    ribbons = [
        (0.0, 2.2 * s, "thunder_01", "thunder_02", "thunder_03"),
        (5.4 * s, 2.4 * s, "thunder_01", "thunder_02", "thunder_04"),
        (10.6 * s, 1.9 * s, "jade_02", "jade_04", "jade_06"),
    ]
    for y_off, rad, col_d, col_m, col_b in ribbons:
        pts = []
        for i in range(16):
            t = i / 15.0
            x = (2.4 + t * 18.4) * s
            y = (5.4 + y_off + y_shift + math.sin(t * math.pi * 1.15 - 0.5) * -2.4 - t * 1.2) * s
            pts.append((x, y))
        for i in range(len(pts) - 1):
            t = i / len(pts)
            r_here = max(0.7, rad * (0.45 + 0.65 * math.sin(t * math.pi)))
            c.thick_line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r_here, col_d if t < 0.35 else col_m)
        for i in range(5, len(pts) - 1):
            c.line(pts[i][0], pts[i][1] - 0.4 * s, pts[i + 1][0], pts[i + 1][1] - 0.4 * s, col_b)

    # Leading wind-arrow head
    tip_poly = [
        (14.4 * s, 4.4 * s),
        (21.4 * s, 10.2 * s),
        (14.6 * s, 16.6 * s),
        (17.2 * s, 10.4 * s),
    ]
    c.poly(tip_poly, "thunder_03")
    c.line(15.8 * s, 5.8 * s, 20.6 * s, 10.2 * s, "thunder_04")
    c.line(20.6 * s, 10.2 * s, 16.0 * s, 14.8 * s, "jade_07")


def draw_icon_ho_the_cuong_khi(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Hộ Thể Cương Khí (Guardian Qi Shield): Faceted cyan-jade spirit barrier shield."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    outer_pts = [
        (cx, 1.8 * s),
        (20.4 * s, 5.4 * s),
        (19.5 * s, 14.0 * s),
        (cx, 21.8 * s),
        (4.5 * s, 14.0 * s),
        (3.6 * s, 5.4 * s),
    ]
    c.poly(outer_pts, "thunder_01")

    left_rim = [
        (cx, 1.8 * s),
        (3.6 * s, 5.4 * s),
        (4.5 * s, 14.0 * s),
        (cx, 21.8 * s),
        (cx, 19.2 * s),
        (6.4 * s, 13.2 * s),
        (5.6 * s, 6.6 * s),
        (cx, 3.8 * s),
    ]
    c.poly(left_rim, "thunder_03")

    inner_left = [
        (cx, 4.0 * s),
        (cx, 19.3 * s),
        (6.6 * s, 13.4 * s),
        (5.8 * s, 6.8 * s),
    ]
    c.poly(inner_left, "jade_05")

    inner_right = [
        (cx, 4.0 * s),
        (18.2 * s, 6.8 * s),
        (17.4 * s, 13.4 * s),
        (cx, 19.3 * s),
    ]
    c.poly(inner_right, "jade_04")

    c.diamond(cx, cy - 0.2 * s, 3.8 * s, 4.8 * s, "jade_07")
    c.diamond(cx, cy - 0.2 * s, 2.0 * s, 2.6 * s, "thunder_04")
    c.line(cx - 1 * s, 2.5 * s, 4.8 * s, 5.8 * s, "thunder_04")


def draw_icon_ngung_khi_quyet(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Ngưng Khí Quyết (Qi Condensing Art): Three-arm spiral spirit-qi vortex."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    c.circle(cx, cy, 6.2 * s, "soul_01")

    arm_colors = [
        ("thunder_01", "thunder_02", "thunder_03"),
        ("jade_02", "jade_04", "jade_05"),
        ("thunder_01", "thunder_03", "thunder_04"),
    ]
    for k, (c_dark, c_mid, c_hi) in enumerate(arm_colors):
        base_ang = k * (2.0 * math.pi / 3.0) - 0.4
        for step in range(28):
            t = step / 27.0
            ang = base_ang + t * 2.55
            rad = (9.6 * (1.0 - t * 0.85)) * s
            x = cx + math.cos(ang) * rad
            y = cy + math.sin(ang) * rad
            thick = max(0.8, (1.9 - 0.6 * t) * s)
            col = c_dark if t < 0.28 else (c_mid if t < 0.68 else c_hi)
            c.circle(x, y, thick, col)

    c.circle(cx, cy, 3.4 * s, "thunder_03")
    c.circle(cx, cy, 1.9 * s, "thunder_04")
    c.sparkle(cx, cy, max(1, round(3.0 * s)), "jade_07", "thunder_04")


def draw_icon_truc_co_dan(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Trúc Cơ Đan (Foundation Pill): Luminous jade-and-gold immortal elixir pill."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Golden halo cup cradling the pill
    c.ellipse(cx, cy + 5.2 * s, 8.8 * s, 3.2 * s, "bronze_03", fill=True)
    c.ellipse(cx, cy + 4.8 * s, 7.6 * s, 2.4 * s, "bronze_05", fill=True)
    c.ellipse(cx, cy + 4.5 * s, 5.4 * s, 1.5 * s, "bronze_06", fill=True)

    # Spherical Foundation Pill (top-left lit 7-step jade ramp)
    pr = 7.4 * s
    py = cy - 0.8 * s
    c.shaded_circle(cx, py, pr, ["jade_01", "jade_02", "jade_04", "jade_05", "jade_06"])

    # Golden meridian band wrapped across the pill
    for i in range(-12, 13):
        t = i / 12.0
        bx = cx + t * (pr - 0.8 * s)
        by = py + math.sin(t * 1.4) * (2.4 * s) + 0.6 * s
        if math.hypot(bx - cx, by - py) <= pr - 0.5 * s:
            col = "bronze_07" if t < -0.1 else ("bronze_06" if t < 0.4 else "bronze_05")
            c.circle(bx, by, max(0.6, 0.85 * s), col)

    c.circle(cx - 2.8 * s, py - 2.8 * s, max(0.9, 1.6 * s), "jade_07")
    c.px(cx - 3.0 * s, py - 3.0 * s, "thunder_04")

    c.sparkle(cx + 5.8 * s, py - 5.2 * s, max(1, round(1.2 * s)), "bronze_07", "thunder_04")
    if c.w >= 24:
        c.px(cx - 6.8 * s, py - 4.8 * s, "bronze_06")


def draw_icon_thien_nghich_chi_luc(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Thiên Nghịch Chi Lực (Defy-Heaven Power): The Heaven Defying Bead pulsing energy."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Four cardinal energy pulse rays
    ray_len = 10.2 * s
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        c.poly(
            [
                (cx - dy * 1.8 * s, cy + dx * 1.8 * s),
                (cx + dy * 1.8 * s, cy - dx * 1.8 * s),
                (cx + dx * ray_len, cy + dy * ray_len),
            ],
            "bronze_06",
        )
        c.line(cx, cy, cx + dx * (ray_len - 0.5 * s), cy + dy * (ray_len - 0.5 * s), "bronze_07")

    diag_len = 8.4 * s
    for dx, dy in [(0.71, 0.71), (-0.71, 0.71), (0.71, -0.71), (-0.71, -0.71)]:
        c.line(cx, cy, cx + dx * diag_len, cy + dy * diag_len, "thunder_03")

    # Dark ancient obsidian-stone Heaven Defying Bead
    c.shaded_circle(cx, cy, 6.6 * s, ["ink_02", "ink_02", "ink_03", "ink_04", "ink_05"])

    # Glowing cosmic cracks across the bead
    c.line(cx - 3.6 * s, cy - 1.2 * s, cx, cy - 2.6 * s, "thunder_03")
    c.line(cx, cy - 2.6 * s, cx + 3.4 * s, cy + 0.8 * s, "bronze_07")
    c.line(cx - 2.6 * s, cy + 2.6 * s, cx + 0.8 * s, cy + 0.2 * s, "thunder_04")
    c.line(cx + 0.8 * s, cy + 0.2 * s, cx + 3.2 * s, cy + 3.0 * s, "bronze_05")

    c.circle(cx, cy, max(1.0, 1.7 * s), "bronze_07")
    c.px(cx, cy, "thunder_04")


def draw_icon_co_than_the(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Cổ Thần Thể (Ancient God Body): Spiked stone-bronze pauldrons & chestplate with 3 Ancient God Stars."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Broad flared armor pauldrons + tapered armored cuirass (unmistakable torso silhouette)
    cuirass = [
        (cx - 9.8 * s, 6.2 * s),
        (cx - 6.0 * s, 3.0 * s),
        (cx - 2.6 * s, 5.2 * s),  # Collar V-notch left
        (cx, 6.6 * s),            # Collar V-notch center
        (cx + 2.6 * s, 5.2 * s),  # Collar V-notch right
        (cx + 6.0 * s, 3.0 * s),
        (cx + 9.8 * s, 6.2 * s),
        (cx + 8.6 * s, 12.6 * s),
        (cx + 6.2 * s, 14.0 * s),
        (cx + 5.2 * s, 20.8 * s),
        (cx, 21.8 * s),
        (cx - 5.2 * s, 20.8 * s),
        (cx - 6.2 * s, 14.0 * s),
        (cx - 8.6 * s, 12.6 * s),
    ]
    c.poly(cuirass, "ink_03")

    # Left half lit stone-iron armor plating
    cuirass_lit = [
        (cx - 9.8 * s, 6.2 * s),
        (cx - 6.0 * s, 3.0 * s),
        (cx - 2.6 * s, 5.2 * s),
        (cx, 6.6 * s),
        (cx, 21.8 * s),
        (cx - 5.2 * s, 20.8 * s),
        (cx - 6.2 * s, 14.0 * s),
        (cx - 8.6 * s, 12.6 * s),
    ]
    c.poly(cuirass_lit, "ink_04")

    # Bronze shoulder pauldron plates (left brighter, right shaded)
    c.poly(
        [
            (cx - 9.4 * s, 6.4 * s),
            (cx - 6.0 * s, 3.4 * s),
            (cx - 4.4 * s, 7.6 * s),
            (cx - 8.2 * s, 11.4 * s),
        ],
        "bronze_05",
    )
    c.line(cx - 8.8 * s, 6.2 * s, cx - 6.0 * s, 3.8 * s, "bronze_07")

    c.poly(
        [
            (cx + 9.4 * s, 6.4 * s),
            (cx + 6.0 * s, 3.4 * s),
            (cx + 4.4 * s, 7.6 * s),
            (cx + 8.2 * s, 11.4 * s),
        ],
        "bronze_03",
    )
    c.line(cx + 6.0 * s, 3.8 * s, cx + 8.8 * s, 6.2 * s, "bronze_05")

    # Armored waist belt
    c.rect(round(cx - 5.0 * s), round(17.6 * s), round(cx + 5.0 * s), round(19.4 * s), "bronze_03")
    c.rect(round(cx - 1.6 * s), round(17.4 * s), round(cx + 1.6 * s), round(19.6 * s), "bronze_06")

    # Central glowing Ancient God Royal Star emblem on chest
    c.diamond(cx, cy + 0.6 * s, 3.6 * s, 3.6 * s, "bronze_05")
    c.diamond(cx, cy + 0.6 * s, 2.1 * s, 2.1 * s, "bronze_06")
    c.px(cx, cy + 0.6 * s, "bronze_07")

    # Vertical specular ridge on lit chestplate
    c.line(cx - 3.6 * s, 8.8 * s, cx - 3.2 * s, 16.0 * s, "ink_05")


def draw_icon_hu_khong_liet_phung(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Hư Không Liệt Phùng (Void Rift): Jagged diagonal violet spatial tear."""
    s = c.w / 24.0

    aura_poly = [
        (18.8 * s, 2.0 * s),
        (21.4 * s, 4.6 * s),
        (16.6 * s, 11.4 * s),
        (17.8 * s, 13.4 * s),
        (5.4 * s, 21.8 * s),
        (2.4 * s, 19.2 * s),
        (7.4 * s, 12.2 * s),
        (6.0 * s, 10.2 * s),
    ]
    c.poly(aura_poly, "soul_04")

    glow_poly = [
        (19.0 * s, 2.8 * s),
        (20.6 * s, 4.4 * s),
        (15.2 * s, 11.4 * s),
        (16.0 * s, 13.0 * s),
        (5.2 * s, 21.0 * s),
        (3.4 * s, 19.4 * s),
        (8.8 * s, 12.2 * s),
        (7.8 * s, 10.6 * s),
    ]
    c.poly(glow_poly, "soul_06")

    core_poly = [
        (19.4 * s, 3.6 * s),
        (13.8 * s, 11.8 * s),
        (14.0 * s, 12.6 * s),
        (4.6 * s, 20.2 * s),
        (10.0 * s, 12.0 * s),
        (9.8 * s, 11.0 * s),
    ]
    c.poly(core_poly, "soul_01")

    c.line(12.2 * s, 8.0 * s, 8.2 * s, 4.8 * s, "soul_06")
    c.line(11.8 * s, 15.8 * s, 16.2 * s, 18.8 * s, "soul_06")
    c.line(19.2 * s, 3.4 * s, 15.6 * s, 7.2 * s, "soul_07")
    c.line(4.6 * s, 20.2 * s, 8.4 * s, 16.6 * s, "soul_07")

    c.px(5.0 * s, 6.0 * s, "thunder_04")
    c.px(19.0 * s, 17.5 * s, "soul_06")


def draw_icon_phong_an_cam(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Phong Ấn Cấm (Sealing Restriction): Daoist parchment talisman with cinnabar seal."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    x0 = round(cx - 5.4 * s)
    x1 = round(cx + 5.4 * s)
    y0 = round(2.0 * s)
    y1 = round(c.h - 2.6 * s)

    # Aged gold-parchment slip using v2 bronze/ink-pale ramp
    c.rect(x0, y0, x1, y1, "bronze_07")
    c.rect(x0, y0, x0 + max(0, round(1.0 * s)), y1 - 1, "ink_06")
    c.rect(x0, y0, x1 - 1, y0 + max(0, round(0.8 * s)), "ink_06")
    c.rect(x1 - max(0, round(1.0 * s)), y0 + 1, x1, y1, "bronze_05")
    c.rect(x0 + 1, y1 - max(0, round(0.8 * s)), x1, y1, "bronze_04")

    # Cinnabar brush calligraphy strokes
    c.line(cx - 3.0 * s, 5.2 * s, cx + 3.0 * s, 5.2 * s, "blood_04")
    c.line(cx, 4.0 * s, cx, 18.6 * s, "blood_04")
    c.line(cx - 2.8 * s, 8.8 * s, cx + 2.8 * s, 8.8 * s, "blood_05")
    c.line(cx - 3.2 * s, 15.6 * s, cx + 3.2 * s, 15.6 * s, "blood_03")
    if c.w >= 24:
        c.line(cx - 2.8 * s, 12.2 * s, cx + 2.8 * s, 12.2 * s, "blood_04")
        c.px(cx - 3.0 * s, 7.0 * s, "blood_05")
        c.px(cx + 3.0 * s, 7.0 * s, "blood_03")

    # Diagonal golden restriction bar + central crimson seal stamp
    c.thick_line(2.8 * s, 14.5 * s, 21.0 * s, 9.2 * s, max(0.8, 1.2 * s), "bronze_04")
    c.line(3.2 * s, 14.0 * s, 20.6 * s, 8.8 * s, "bronze_06")
    c.rect(round(cx - 1.8 * s), round(cy - 1.8 * s), round(cx + 1.8 * s), round(cy + 1.8 * s), "thunder_05")
    c.px(cx, cy, "bronze_07")


def draw_icon_cuc_canh_hoa_than(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Cực Cảnh Hóa Thần (Extreme Jing Soul Formation): Blazing red lightning aura & divine eye."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    burst = []
    spikes = 10
    for i in range(spikes * 2):
        ang = -math.pi / 2 + i * (math.pi / spikes)
        rad = (10.2 if i % 2 == 0 else 6.0) * s
        burst.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
    c.poly(burst, "blood_04")

    inner_burst = []
    for i in range(spikes * 2):
        ang = -math.pi / 2 + i * (math.pi / spikes) + 0.15
        rad = (7.4 if i % 2 == 0 else 4.5) * s
        inner_burst.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
    c.poly(inner_burst, "thunder_05")

    eye_pts = [
        (cx - 5.6 * s, cy),
        (cx, cy - 3.6 * s),
        (cx + 5.6 * s, cy),
        (cx, cy + 3.6 * s),
    ]
    c.poly(eye_pts, "bronze_07")
    c.circle(cx, cy, max(1.3, 2.5 * s), "thunder_05")
    c.line(cx, cy - 1.8 * s, cx, cy + 1.8 * s, "blood_01")
    c.px(cx - 0.6 * s, cy - 0.8 * s, "thunder_04")

    for ax, ay in [(cx, 2.4 * s), (4.2 * s, 5.2 * s), (19.8 * s, 5.2 * s)]:
        c.px(ax, ay, "bronze_06")


def draw_icon_huyet_te(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Huyết Tế (Blood Sacrifice): Bone ritual chalice overflowing with crimson blood."""
    cx = (c.w - 1) / 2.0
    s = c.w / 24.0

    drop_y = 4.8 * s
    c.poly(
        [
            (cx, 1.8 * s),
            (cx + 2.4 * s, 5.8 * s),
            (cx, 7.6 * s),
            (cx - 2.4 * s, 5.8 * s),
        ],
        "blood_04",
    )
    c.px(cx - 0.6 * s, drop_y + 0.2 * s, "blood_05")
    c.px(cx - 0.6 * s, drop_y - 0.4 * s, "blood_07")

    cup = [
        (cx - 7.0 * s, 9.6 * s),
        (cx + 7.0 * s, 9.6 * s),
        (cx + 5.2 * s, 15.8 * s),
        (cx - 5.2 * s, 15.8 * s),
    ]
    c.poly(cup, "ink_05")
    c.poly(
        [
            (cx - 7.0 * s, 9.6 * s),
            (cx - 1.2 * s, 9.6 * s),
            (cx - 1.2 * s, 15.8 * s),
            (cx - 5.2 * s, 15.8 * s),
        ],
        "ink_06",
    )
    c.poly(
        [
            (cx + 2.2 * s, 9.6 * s),
            (cx + 7.0 * s, 9.6 * s),
            (cx + 5.2 * s, 15.8 * s),
            (cx + 1.8 * s, 15.8 * s),
        ],
        "ink_04",
    )

    c.rect(round(cx - 1.6 * s), round(15.6 * s), round(cx + 1.6 * s), round(19.2 * s), "ink_04")
    c.px(cx - 1.0 * s, 17.2 * s, "ink_06")
    c.poly(
        [
            (cx - 5.2 * s, 21.4 * s),
            (cx + 5.2 * s, 21.4 * s),
            (cx + 3.4 * s, 19.0 * s),
            (cx - 3.4 * s, 19.0 * s),
        ],
        "ink_05",
    )

    c.ellipse(cx, 9.8 * s, 6.6 * s, 1.8 * s, "blood_04", fill=True)
    c.ellipse(cx - 1.2 * s, 9.4 * s, 3.6 * s, 0.9 * s, "blood_05", fill=True)
    c.line(cx - 3.2 * s, 10.6 * s, cx - 3.2 * s, 14.4 * s, "blood_04")
    c.line(cx + 2.4 * s, 10.6 * s, cx + 2.4 * s, 13.2 * s, "blood_03")
    c.px(cx - 3.2 * s, 14.4 * s, "blood_06")


def draw_icon_tu_linh_tran(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Tụ Linh Trận (Spirit Gathering Array): Octagonal jade-gold formation with rising qi."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0 + (1.2 if c.w >= 24 else 0.6)
    s = c.w / 24.0

    c.ellipse(cx, cy + 1.2 * s, 9.6 * s, 6.4 * s, "jade_01", fill=True)
    c.ellipse(cx, cy + 1.0 * s, 9.2 * s, 6.0 * s, "jade_04", fill=False, thickness=0.28)
    c.ellipse(cx, cy + 1.0 * s, 6.4 * s, 4.1 * s, "bronze_05", fill=False, thickness=0.30)

    c.diamond(cx, cy + 1.0 * s, 5.2 * s, 3.2 * s, "thunder_02")
    c.diamond(cx, cy + 1.0 * s, 2.8 * s, 1.8 * s, "thunder_03")

    for ax, ay in [
        (cx - 8.4 * s, cy + 1.0 * s),
        (cx + 8.4 * s, cy + 1.0 * s),
        (cx, cy - 4.4 * s),
        (cx, cy + 6.4 * s),
    ]:
        c.px(ax, ay, "bronze_06")

    c.line(cx, cy + 0.6 * s, cx, 2.6 * s, "thunder_04")
    c.line(cx - 3.6 * s, cy + 0.2 * s, cx - 3.6 * s, 5.2 * s, "jade_06")
    c.line(cx + 3.6 * s, cy + 0.2 * s, cx + 3.6 * s, 5.6 * s, "thunder_03")
    c.sparkle(cx, 3.0 * s, max(1, round(1.5 * s)), "thunder_03", "thunder_04")


# ---------------------------------------------------------------------------
# 5 Mobile-Friendly HUD Icon Renderers
# ---------------------------------------------------------------------------

def draw_hud_hp(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """HUD HP Icon (24x24 & 16x16): Iconic plump crimson vitality heart with crisp top cleft."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    # Construct heart from two crisp upper lobes + tapered lower triangle so the
    # top cleft stays unmistakably sharp at both 24x24 and 16x16!
    lobe_r = 4.9 * s
    lobe_y = cy - 2.6 * s
    lobe_dx = 4.3 * s

    def in_heart(x: float, y: float) -> bool:
        d_l = math.hypot(x - (cx - lobe_dx), y - lobe_y)
        d_r = math.hypot(x - (cx + lobe_dx), y - lobe_y)
        if d_l <= lobe_r or d_r <= lobe_r:
            return True
        if y >= lobe_y:
            t = (y - lobe_y) / (11.2 * s)
            if 0.0 <= t <= 1.0:
                half_w = (lobe_dx + lobe_r * 0.94) * (1.0 - t) ** 0.92
                return abs(x - cx) <= half_w
        return False

    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            if in_heart(x, y):
                nx = (x - cx) / (9.2 * s)
                ny = (y - cy) / (9.2 * s)
                lit = -0.62 * nx - 0.72 * ny
                if lit > 0.42:
                    col = "blood_05"
                elif lit > -0.10:
                    col = "blood_04"
                elif lit > -0.58:
                    col = "blood_03"
                else:
                    col = "blood_02"
                c.px(x, y, col)

    # Crisp highlight glint on upper-left lobe
    c.circle(cx - 4.4 * s, lobe_y - 0.8 * s, max(0.85, 1.5 * s), "blood_06")
    c.px(cx - 4.8 * s, lobe_y - 1.4 * s, "blood_07")
    if c.w >= 24:
        c.px(cx - 5.2 * s, lobe_y - 1.6 * s, "thunder_04")


def draw_hud_qi(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """HUD Spirit Qi / Mana Icon (24x24 & 16x16): Luminous faceted azure spirit flame-drop."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 24.0

    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            t = (y - 2.0 * s) / (19.6 * s)
            if 0.0 <= t <= 1.0:
                half_w = 8.4 * s * (math.sin(t * math.pi) ** 0.78) * (0.28 + 0.72 * t)
                if abs(x - cx) <= half_w:
                    nx = (x - cx) / max(half_w, 0.5)
                    ny = (t - 0.62) * 1.8
                    lit = -0.65 * nx - 0.60 * ny
                    if lit > 0.48:
                        col = "thunder_04"
                    elif lit > 0.05:
                        col = "thunder_03"
                    elif lit > -0.40:
                        col = "thunder_02"
                    elif lit > -0.78:
                        col = "thunder_01"
                    else:
                        col = "soul_01"
                    c.px(x, y, col)

    c.diamond(cx, cy + 2.4 * s, 3.0 * s, 3.6 * s, "thunder_03")
    c.diamond(cx, cy + 2.2 * s, 1.5 * s, 1.8 * s, "thunder_04")
    c.line(cx - 1.8 * s, 8.2 * s, cx - 3.6 * s, 12.2 * s, "thunder_04")


def draw_ui_spirit_stone(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Linh Thạch (Spirit Stone Currency Icon): Faceted jade-qi crystal with 4-frame sparkle."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    s = c.w / 16.0  # Manifest native size is 16x16

    top = (cx, 1.4 * s)
    ul = (3.4 * s, 4.8 * s)
    ur = (12.6 * s, 4.8 * s)
    ll = (3.4 * s, 11.2 * s)
    lr = (12.6 * s, 11.2 * s)
    bot = (cx, 14.6 * s)

    c.poly([top, ur, lr, bot, ll, ul], "jade_02")
    c.poly([top, ul, ll, (cx, cy)], "jade_05")
    c.poly([top, ur, (cx, cy)], "jade_04")
    c.poly([(cx, cy), ll, bot], "jade_03")
    c.poly([(cx, cy), ur, lr, bot], "jade_01")

    core_pts = [
        (cx, 3.8 * s),
        (10.2 * s, 6.2 * s),
        (10.2 * s, 9.8 * s),
        (cx, 12.2 * s),
        (5.8 * s, 9.8 * s),
        (5.8 * s, 6.2 * s),
    ]
    c.poly(core_pts, "thunder_02")
    c.poly([(cx, 3.8 * s), (5.8 * s, 6.2 * s), (5.8 * s, 9.8 * s), (cx, cy)], "thunder_03")
    c.poly([(cx, 3.8 * s), (10.2 * s, 6.2 * s), (cx, cy)], "jade_06")

    f = frame % 4
    if f == 0:
        c.px(5.6 * s, 5.6 * s, "thunder_04")
        c.px(6.6 * s, 4.8 * s, "jade_07")
    elif f == 1:
        c.line(4.6 * s, 8.4 * s, 10.4 * s, 4.8 * s, "jade_07")
        c.px(cx, cy, "thunder_04")
    elif f == 2:
        c.line(6.2 * s, 11.0 * s, 11.4 * s, 7.4 * s, "jade_06")
        c.sparkle(11.6 * s, 3.4 * s, max(1, round(1.2 * s)), "jade_07", "thunder_04")
    else:
        c.diamond(cx, cy, 2.2 * s, 2.6 * s, "jade_07")
        c.sparkle(cx, cy, max(1, round(1.6 * s)), "thunder_03", "thunder_04")
        c.px(4.6 * s, 4.4 * s, "thunder_04")


def _draw_mobile_button_base(
    c: PixelCanvas,
    rim_hi: str,
    rim_mid: str,
    rim_dark: str,
    stud_col: str,
    dish_hi: str,
    dish_dark: str,
) -> Tuple[float, float, float]:
    """Draw a high-contrast beveled circular mobile button medallion."""
    cx, cy = (c.w - 1) / 2.0, (c.h - 1) / 2.0
    r_outer = (c.w - 2) / 2.0 - 0.1
    rim_w = 2.2 if c.w >= 24 else 1.45
    r_inner = r_outer - rim_w

    for y in range(1, c.h - 1):
        for x in range(1, c.w - 1):
            dx, dy = x - cx, y - cy
            d = math.hypot(dx, dy)
            if d <= r_outer:
                lit = (-0.65 * dx - 0.75 * dy) / max(r_outer, 1.0)
                if d > r_inner:
                    col = rim_hi if lit > 0.30 else (rim_mid if lit > -0.25 else rim_dark)
                else:
                    col = dish_hi if lit < -0.25 else dish_dark
                c.px(x, y, col)

    if c.w >= 24:
        for sx, sy in [(cx, 2.0), (cx, c.h - 3.0), (2.0, cy), (c.w - 3.0, cy)]:
            c.px(sx, sy, stud_col)

    return cx, cy, r_inner


def draw_hud_btn_dash(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Mobile Dash Button (24x24 & 16x16): High-contrast azure wind-dash medallion."""
    _draw_mobile_button_base(
        c,
        rim_hi="thunder_03",
        rim_mid="thunder_02",
        rim_dark="thunder_01",
        stud_col="bronze_06",
        dish_hi="soul_02",
        dish_dark="soul_01",
    )
    s = c.w / 24.0

    c.thick_line(5.2 * s, 9.0 * s, 10.5 * s, 9.0 * s, max(0.55, 0.85 * s), "jade_05")
    c.thick_line(4.4 * s, 12.0 * s, 12.5 * s, 12.0 * s, max(0.65, 1.0 * s), "thunder_03")
    c.thick_line(5.6 * s, 15.0 * s, 10.5 * s, 15.0 * s, max(0.55, 0.85 * s), "jade_05")

    back_chev = [
        (8.8 * s, 7.2 * s),
        (11.6 * s, 7.2 * s),
        (15.6 * s, 12.0 * s),
        (11.6 * s, 16.8 * s),
        (8.8 * s, 16.8 * s),
        (12.4 * s, 12.0 * s),
    ]
    c.poly(back_chev, "thunder_03")

    front_chev = [
        (12.2 * s, 6.4 * s),
        (15.0 * s, 6.4 * s),
        (19.4 * s, 12.0 * s),
        (15.0 * s, 17.6 * s),
        (12.2 * s, 17.6 * s),
        (16.2 * s, 12.0 * s),
    ]
    c.poly(front_chev, "jade_07")

    c.line(13.8 * s, 7.2 * s, 18.6 * s, 12.0 * s, "thunder_04")
    c.line(18.6 * s, 12.0 * s, 14.0 * s, 16.6 * s, "thunder_04")


def draw_hud_btn_attack(c: PixelCanvas, rng: random.Random, frame: int = 0) -> None:
    """Mobile Attack Button (24x24 & 16x16): High-contrast crimson/gold sword medallion."""
    cx, cy, _ = _draw_mobile_button_base(
        c,
        rim_hi="bronze_06",
        rim_mid="bronze_05",
        rim_dark="blood_04",
        stud_col="bronze_07",
        dish_hi="blood_02",
        dish_dark="blood_01",
    )
    s = c.w / 24.0

    for deg in range(-110, 35, 4):
        ang = math.radians(deg)
        ax = cx + math.cos(ang) * 6.8 * s
        ay = cy + math.sin(ang) * 6.8 * s
        col = "bronze_07" if -65 <= deg <= -15 else ("thunder_05" if deg < 10 else "blood_05")
        c.circle(ax, ay, max(0.55, 0.85 * s), col)

    blade = [
        (8.6 * s, 13.6 * s),
        (15.8 * s, 6.0 * s),
        (18.4 * s, 5.4 * s),
        (17.8 * s, 8.2 * s),
        (10.6 * s, 15.6 * s),
    ]
    c.poly(blade, "ink_06")
    c.line(9.4 * s, 13.6 * s, 17.8 * s, 5.8 * s, "thunder_04")
    c.line(10.8 * s, 15.0 * s, 17.4 * s, 8.2 * s, "ink_05")

    c.thick_line(6.8 * s, 11.8 * s, 12.2 * s, 17.2 * s, max(0.7, 1.0 * s), "bronze_05")
    c.line(7.0 * s, 11.8 * s, 11.8 * s, 16.6 * s, "bronze_06")

    c.thick_line(6.2 * s, 17.8 * s, 8.8 * s, 15.2 * s, max(0.65, 0.9 * s), "blood_04")
    c.circle(5.8 * s, 18.2 * s, max(0.85, 1.25 * s), "bronze_06")
    c.px(5.6 * s, 18.0 * s, "bronze_07")


# ---------------------------------------------------------------------------
# Registry of all 21 assets
# ---------------------------------------------------------------------------

DRAWERS: Dict[str, Callable[[PixelCanvas, random.Random, int], None]] = {
    "icon_sinh_tu_cam": draw_icon_sinh_tu_cam,
    "icon_tue_nguyet_cam": draw_icon_tue_nguyet_cam,
    "icon_thien_loi_dan": draw_icon_thien_loi_dan,
    "icon_van_hon_phe_tam": draw_icon_van_hon_phe_tam,
    "icon_huyet_hai_cuong_trieu": draw_icon_huyet_hai_cuong_trieu,
    "icon_thanh_phong_don": draw_icon_thanh_phong_don,
    "icon_ho_the_cuong_khi": draw_icon_ho_the_cuong_khi,
    "icon_ngung_khi_quyet": draw_icon_ngung_khi_quyet,
    "icon_truc_co_dan": draw_icon_truc_co_dan,
    "icon_thien_nghich_chi_luc": draw_icon_thien_nghich_chi_luc,
    "icon_co_than_the": draw_icon_co_than_the,
    "icon_hu_khong_liet_phung": draw_icon_hu_khong_liet_phung,
    "icon_phong_an_cam": draw_icon_phong_an_cam,
    "icon_cuc_canh_hoa_than": draw_icon_cuc_canh_hoa_than,
    "icon_huyet_te": draw_icon_huyet_te,
    "icon_tu_linh_tran": draw_icon_tu_linh_tran,
    "ui_spirit_stone": draw_ui_spirit_stone,
    "hud_hp": draw_hud_hp,
    "hud_qi": draw_hud_qi,
    "hud_btn_dash": draw_hud_btn_dash,
    "hud_btn_attack": draw_hud_btn_attack,
}

HUD_FALLBACK_SPECS: List[dict] = [
    {
        "id": "hud_hp",
        "name": {"vi": "Biểu Tượng Sinh Lực", "en": "HP HUD Icon"},
        "category": "ui",
        "size": [24, 24],
        "variant_sizes": [[24, 24], [16, 16]],
        "description": "Mobile HUD vitality heart icon (manifest silent; only defines 64x8 ui_hud_bars).",
        "manifest_output_path": None,
        "notes": "Manifest silent on standalone HP icon; generated 24x24 + 16x16 per task spec.",
    },
    {
        "id": "hud_qi",
        "name": {"vi": "Biểu Tượng Linh Lực", "en": "Spirit Qi / Mana HUD Icon"},
        "category": "ui",
        "size": [24, 24],
        "variant_sizes": [[24, 24], [16, 16]],
        "description": "Mobile HUD Spirit Qi droplet icon (manifest silent; only defines 64x8 ui_hud_bars).",
        "manifest_output_path": None,
        "notes": "Manifest silent on standalone Spirit Qi icon; generated 24x24 + 16x16 per task spec.",
    },
    {
        "id": "hud_btn_dash",
        "name": {"vi": "Nút Lướt (Độn Pháp)", "en": "Mobile Dash Button"},
        "category": "ui",
        "size": [24, 24],
        "variant_sizes": [[24, 24], [16, 16]],
        "description": "Mobile touch-legible Dash action button medallion.",
        "manifest_output_path": None,
        "notes": "Manifest silent on Dash button; generated 24x24 + 16x16 per task spec.",
    },
    {
        "id": "hud_btn_attack",
        "name": {"vi": "Nút Công Kích", "en": "Mobile Attack Button"},
        "category": "ui",
        "size": [24, 24],
        "variant_sizes": [[24, 24], [16, 16]],
        "description": "Mobile touch-legible Attack action button medallion.",
        "manifest_output_path": None,
        "notes": "Manifest silent on Attack button; generated 24x24 + 16x16 per task spec.",
    },
]


def load_specs(manifest_path: Path) -> List[dict]:
    """Load the 16 icon specs + ui_spirit_stone from manifest.json plus HUD fallbacks."""
    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    assets = [a for a in doc["assets"] if a.get("assigned_agent") == "codex_antigravity"]
    specs: List[dict] = []

    for a in assets:
        aid = a["id"]
        if a.get("category") == "icon" or aid == "ui_spirit_stone":
            if aid not in DRAWERS:
                raise KeyError(f"Manifest asset {aid!r} has no registered drawer")
            entry = dict(a)
            entry["manifest_output_path"] = a["output_path"]
            if aid == "ui_spirit_stone":
                entry["notes"] = (
                    "Follows manifest 16x16 4-frame looping idle animation (one canvas per frame "
                    "matching palette.json size_classes.icon), plus a 24x24 HUD icon variant."
                )
            else:
                entry["notes"] = (
                    "Manifest lists 24x24 + 16x16 variants; written under --out "
                    "(assets/raw/environment_items/ui/) per routing spec."
                )
            specs.append(entry)

    specs.extend(HUD_FALLBACK_SPECS)
    return specs


def _save_png_deterministic(img: Image.Image, path: Path) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", compress_level=9, optimize=False)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_icon(asset_id: str, w: int, h: int, pal: Palette, frame: int = 0) -> Tuple[Image.Image, int]:
    if (w, h) not in pal.icon_sizes:
        raise ValueError(f"Requested size {w}x{h} not in palette.json size_classes.icon {pal.icon_sizes}")
    seed = _seed_for(asset_id, w, h, frame)
    rng = random.Random(seed)
    canvas = PixelCanvas(w, h, pal)
    DRAWERS[asset_id](canvas, rng, frame)
    canvas.apply_outline()
    return canvas.to_image(), seed


def build_contact_sheet(
    images: Sequence[Tuple[str, Image.Image]],
    out_path: Path,
    pal: Palette,
    scale: int = 4,
    cols: int = 4,
) -> None:
    """Create a 4x nearest-neighbor preview contact sheet on a dark ink-slate grid."""
    if not images:
        return
    max_w = max(im.width for _, im in images) * scale
    max_h = max(im.height for _, im in images) * scale
    pad_x, pad_y, label_h = 16, 16, 20
    cell_w = max(max_w + pad_x * 2, 164)
    cell_h = max_h + pad_y * 2 + label_h
    rows = math.ceil(len(images) / cols)

    bg = pal.rgba("ink_02")
    tile_bg = pal.rgba("ink_03")
    border_col = pal.rgba("ink_04")
    text_col = pal.rgba("ink_06")

    sheet = Image.new("RGBA", (cols * cell_w + 16, rows * cell_h + 16), bg)
    draw = ImageDraw.Draw(sheet)

    for idx, (label, im) in enumerate(images):
        r, c_idx = divmod(idx, cols)
        x0 = 8 + c_idx * cell_w
        y0 = 8 + r * cell_h
        draw.rectangle([x0 + 4, y0 + 4, x0 + cell_w - 5, y0 + cell_h - 5], fill=tile_bg, outline=border_col)
        scaled = im.resize((im.width * scale, im.height * scale), Image.Resampling.NEAREST)
        px = x0 + (cell_w - scaled.width) // 2
        py = y0 + pad_y + (max_h - scaled.height) // 2
        sheet.alpha_composite(scaled, (px, py))
        short_label = label if len(label) <= 24 else label[:23] + "…"
        draw.text((x0 + 10, y0 + cell_h - label_h - 2), short_label, fill=text_col)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path, format="PNG", compress_level=9, optimize=False)


def generate_all(
    out_dir: Path,
    palette_path: Path,
    manifest_path: Path,
    only: Optional[Sequence[str]] = None,
    contact_sheet_dir: Optional[Path] = None,
) -> dict:
    pal = Palette(palette_path)
    specs = load_specs(manifest_path)

    if only:
        wanted = set(only)
        known = {s["id"] for s in specs}
        unknown = sorted(wanted - known)
        if unknown:
            raise ValueError(f"Unknown --only id(s): {', '.join(unknown)}. Known: {', '.join(sorted(known))}")
        specs = [s for s in specs if s["id"] in wanted]

    out_dir.mkdir(parents=True, exist_ok=True)
    log_files: List[dict] = []
    preview_cards_24: List[Tuple[str, Image.Image]] = []
    preview_cards_16: List[Tuple[str, Image.Image]] = []
    preview_hud: List[Tuple[str, Image.Image]] = []

    for spec in specs:
        aid = spec["id"]
        asset_dir = out_dir / aid

        if aid == "ui_spirit_stone":
            # Manifest specifies 16x16 with 4-frame looping idle animation (one canvas per frame)
            w, h = spec["size"]
            n_frames = int(spec["animations"]["idle"]["frames"])
            for fi in range(n_frames):
                im, seed = render_icon(aid, w, h, pal, frame=fi)
                fpath = asset_dir / f"{aid}_idle_{fi}.png"
                sha = _save_png_deterministic(im, fpath)
                log_files.append({
                    "id": aid,
                    "name": spec["name"],
                    "category": spec["category"],
                    "file": fpath.relative_to(out_dir).as_posix(),
                    "manifest_output_path": spec.get("manifest_output_path"),
                    "dims": [w, h],
                    "frames": n_frames,
                    "frame_index": fi,
                    "animation": "idle",
                    "seed": seed,
                    "sha256": sha,
                    "notes": spec.get("notes", ""),
                })
                preview_hud.append((f"spirit_stone_16 f{fi}", im))

            # Supplemental 24x24 HUD variant for 24x24 parity across mobile HUD icons
            im24, seed24 = render_icon(aid, 24, 24, pal, frame=0)
            p24 = asset_dir / f"{aid}_24x24.png"
            sha24 = _save_png_deterministic(im24, p24)
            log_files.append({
                "id": aid,
                "name": spec["name"],
                "category": spec["category"],
                "file": p24.relative_to(out_dir).as_posix(),
                "manifest_output_path": spec.get("manifest_output_path"),
                "dims": [24, 24],
                "frames": 1,
                "seed": seed24,
                "sha256": sha24,
                "notes": "Supplemental 24x24 HUD variant alongside manifest 16x16x4 idle.",
            })
            preview_hud.append(("spirit_stone_24", im24))
        else:
            sizes = spec.get("variant_sizes") or [spec["size"]]
            for w, h in sizes:
                im, seed = render_icon(aid, w, h, pal, frame=0)
                fpath = asset_dir / f"{aid}_{w}x{h}.png"
                sha = _save_png_deterministic(im, fpath)
                log_files.append({
                    "id": aid,
                    "name": spec["name"],
                    "category": spec["category"],
                    "file": fpath.relative_to(out_dir).as_posix(),
                    "manifest_output_path": spec.get("manifest_output_path"),
                    "dims": [w, h],
                    "frames": 1,
                    "seed": seed,
                    "sha256": sha,
                    "notes": spec.get("notes", ""),
                })
                short = aid.replace("icon_", "").replace("hud_", "")
                if spec["category"] == "icon":
                    if w == 24:
                        preview_cards_24.append((short, im))
                    else:
                        preview_cards_16.append((short, im))
                else:
                    preview_hud.append((f"{short}_{w}", im))

    log = {
        "script": "tools/generators/gen_ui_icons.py",
        "palette": palette_path.name,
        "palette_name": pal.name,
        "palette_version": pal.version,
        "outline_id": pal.outline_id,
        "manifest": manifest_path.name,
        "out_dir": out_dir.as_posix(),
        "total_assets": len(specs),
        "total_files": len(log_files),
        "notes": [
            "All colors loaded strictly by stable id from palette.json v2 (outline = ink_01).",
            "All 16 skill/restriction icons follow manifest ids, names, and variant_sizes [[24,24],[16,16]].",
            "Outputs are placed under assets/raw/environment_items/ui/ per docs/ASSET_ROUTING.md and task spec (manifest_output_path is preserved per entry).",
            "ui_spirit_stone follows manifest size 16x16 with 4 individual idle frames (one canvas per frame per ART_BIBLE.md) plus a 24x24 HUD icon variant.",
            "hud_hp, hud_qi, hud_btn_dash, hud_btn_attack are silent in manifest.json and generated at 24x24 + 16x16.",
        ],
        "files": log_files,
    }
    log_path = out_dir / "gen_ui_icons_log.json"
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if contact_sheet_dir is not None:
        if preview_cards_24:
            build_contact_sheet(preview_cards_24, contact_sheet_dir / "ui_card_icons_24x24_4x.png", pal, scale=4, cols=4)
        if preview_cards_16:
            build_contact_sheet(preview_cards_16, contact_sheet_dir / "ui_card_icons_16x16_4x.png", pal, scale=4, cols=4)
        if preview_hud:
            build_contact_sheet(preview_hud, contact_sheet_dir / "ui_hud_icons_4x.png", pal, scale=4, cols=4)

    return log


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"Output directory (default: {DEFAULT_OUT})")
    ap.add_argument(
        "--only",
        action="append",
        help="Generate only the specified asset id (repeatable or comma-separated).",
    )
    ap.add_argument("--palette", type=Path, default=DEFAULT_PALETTE, help="Path to palette.json")
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST, help="Path to assets/manifest.json")
    ap.add_argument(
        "--contact-sheet-dir",
        type=Path,
        default=None,
        help="Optional temp directory to write 4x nearest-neighbor preview contact sheets.",
    )
    ap.add_argument("--list", action="store_true", help="List all supported asset ids and exit.")
    return ap.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if args.list:
        for spec in load_specs(args.manifest):
            print(f"{spec['id']:30s} {spec['category']:6s} {spec['size']}  {spec['name']['vi']} ({spec['name']['en']})")
        return 0

    only_ids: Optional[List[str]] = None
    if args.only:
        only_ids = [part.strip() for item in args.only for part in item.split(",") if part.strip()]

    log = generate_all(
        out_dir=args.out,
        palette_path=args.palette,
        manifest_path=args.manifest,
        only=only_ids,
        contact_sheet_dir=args.contact_sheet_dir,
    )
    print(f"Generated {log['total_files']} PNG file(s) across {log['total_assets']} asset(s) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
