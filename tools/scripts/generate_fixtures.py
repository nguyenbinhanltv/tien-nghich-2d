#!/usr/bin/env python3
"""Generate clearly-labelled FIXTURE sprites + Phaser/Pixi hash web atlas in assets/_fixtures/.

IMPORTANT:
- NEVER writes to assets/processed/ or assets/raw/characters/.
- Fixtures are unmistakable geometric/diagnostic test patterns using colors from
  tools/generators/palette.json so the preview app's atlas loader, blob-47 autotile
  renderer, projectile system, and frame-by-frame inspector can be smoke-tested
  while real assets (and PixelLab characters) are still pending.
"""

from __future__ import annotations

import json
import pathlib
import struct
import zlib

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PALETTE_PATH = REPO_ROOT / "tools" / "generators" / "palette.json"
OUT_ROOT = REPO_ROOT / "assets" / "_fixtures"
ATLAS_DIR = OUT_ROOT / "atlases" / "web"
PNG_DIR = OUT_ROOT / "pngs"

CANONICAL_47_MASKS = [
    0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81,
    84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197,
    199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255,
]


def hex_to_rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def write_png(path: pathlib.Path, width: int, height: int, pixels: bytearray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


class Canvas:
    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.buf = bytearray(w * h * 4)

    def set(self, x: int, y: int, rgba: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.buf[i : i + 4] = bytes(rgba)

    def rect(self, x: int, y: int, w: int, h: int, rgba: tuple[int, int, int, int]) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, rgba)

    def border(self, x: int, y: int, w: int, h: int, rgba: tuple[int, int, int, int]) -> None:
        for xx in range(x, x + w):
            self.set(xx, y, rgba)
            self.set(xx, y + h - 1, rgba)
        for yy in range(y, y + h):
            self.set(x, yy, rgba)
            self.set(x + w - 1, yy, rgba)

    def stamp_f_badge(self, x: int, y: int, fg: tuple[int, int, int, int]) -> None:
        """Tiny 3x5 'F' pixel glyph marking every fixture unmistakably."""
        glyph = [
            "111",
            "100",
            "110",
            "100",
            "100",
        ]
        for gy, row in enumerate(glyph):
            for gx, ch in enumerate(row):
                if ch == "1":
                    self.set(x + gx, y + gy, fg)

    def blit(self, other: "Canvas", dx: int, dy: int) -> None:
        for y in range(other.h):
            for x in range(other.w):
                si = (y * other.w + x) * 4
                a = other.buf[si + 3]
                if a > 0:
                    self.set(dx + x, dy + y, tuple(other.buf[si : si + 4]))


def make_blob_tile(mask: int, colors: dict[str, tuple[int, int, int, int]], outline: tuple[int, int, int, int]) -> Canvas:
    c = Canvas(16, 16)
    base = colors["base"]
    mid = colors["mid"]
    edge = colors["edge"]
    hi = colors["hi"]

    # Subtle checkerboard tile interior
    for y in range(16):
        for x in range(16):
            c.set(x, y, base if ((x // 4 + y // 4) % 2 == 0) else mid)

    # Edges where neighbor is absent (so blob-47 connectivity is immediately visible)
    n, ne, e, se, s, sw, w, nw = (
        bool(mask & 1),
        bool(mask & 2),
        bool(mask & 4),
        bool(mask & 8),
        bool(mask & 16),
        bool(mask & 32),
        bool(mask & 64),
        bool(mask & 128),
    )

    if not n:
        c.rect(0, 0, 16, 2, hi)
        c.rect(0, 0, 16, 1, outline)
    if not s:
        c.rect(0, 14, 16, 2, edge)
        c.rect(0, 15, 16, 1, outline)
    if not w:
        c.rect(0, 0, 2, 16, hi)
        c.rect(0, 0, 1, 16, outline)
    if not e:
        c.rect(14, 0, 2, 16, edge)
        c.rect(15, 0, 1, 16, outline)

    # Inner concave corner notches when both cardinals exist but diagonal doesn't
    if n and e and not ne:
        c.rect(13, 0, 3, 3, edge)
        c.set(15, 0, outline)
    if s and e and not se:
        c.rect(13, 13, 3, 3, edge)
        c.set(15, 15, outline)
    if s and w and not sw:
        c.rect(0, 13, 3, 3, edge)
        c.set(0, 15, outline)
    if n and w and not nw:
        c.rect(0, 0, 3, 3, hi)
        c.set(0, 0, outline)

    # Tiny 'F' mark in center-left so fixture tiles are unmistakable
    c.stamp_f_badge(6, 5, outline)
    return c


def make_fixture_item(w: int, h: int, fill: tuple[int, int, int, int], accent: tuple[int, int, int, int], outline: tuple[int, int, int, int], frame: int = 0) -> Canvas:
    c = Canvas(w, h)
    pad = 2
    c.rect(pad, pad, w - pad * 2, h - pad * 2, fill)
    c.border(pad, pad, w - pad * 2, h - pad * 2, outline)
    # Animated rotating corner pip so frame stepping is visibly verifiable
    corners = [
        (pad + 2, pad + 2),
        (w - pad - 5, pad + 2),
        (w - pad - 5, h - pad - 5),
        (pad + 2, h - pad - 5),
    ]
    px, py = corners[frame % 4]
    c.rect(px, py, 3, 3, accent)
    # Center diagnostic crosshair + 'F' badge
    cx, cy = w // 2, h // 2
    c.rect(cx - 2, cy, 5, 1, accent)
    c.rect(cx, cy - 2, 1, 5, accent)
    c.stamp_f_badge(max(pad + 1, cx - 1), max(pad + 1, cy - 2), outline)
    return c


def main() -> None:
    pal_data = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
    pal = {c["id"]: hex_to_rgba(c["hex"]) for c in pal_data["colors"]}
    outline = pal["ink_01"]

    frames_data: list[tuple[str, Canvas]] = []

    biome_themes = {
        "hengyue": {"base": pal["ink_03"], "mid": pal["ink_04"], "edge": pal["jade_02"], "hi": pal["jade_05"]},
        "blood_sea": {"base": pal["ink_02"], "mid": pal["blood_02"], "edge": pal["blood_04"], "hi": pal["blood_06"]},
        "ancient_god": {"base": pal["soul_02"], "mid": pal["soul_03"], "edge": pal["bronze_04"], "hi": pal["bronze_06"]},
    }

    for biome_id, colors in biome_themes.items():
        for idx, mask in enumerate(CANONICAL_47_MASKS):
            key = f"tilesets/{biome_id}/tile_{idx:02d}"
            frames_data.append((key, make_blob_tile(mask, colors, outline)))

    # Fixture weapon, projectile, prop, vfx, ui samples (NOT characters — PixelLab is missing)
    frames_data.append(("weapons/wp_heaven_defying_bead", make_fixture_item(24, 24, pal["thunder_01"], pal["thunder_04"], outline, 0)))
    frames_data.append(("weapons/wp_azure_wind_sword", make_fixture_item(32, 32, pal["jade_03"], pal["thunder_03"], outline, 0)))
    frames_data.append(("weapons/wp_soul_banner", make_fixture_item(32, 32, pal["soul_03"], pal["soul_06"], outline, 0)))

    for f in range(4):
        frames_data.append((f"projectiles/pj_heaven_defying_bead_{f}", make_fixture_item(16, 16, pal["thunder_02"], pal["thunder_04"], outline, f)))
        frames_data.append((f"projectiles/pj_azure_wind_sword_{f}", make_fixture_item(16, 16, pal["jade_04"], pal["thunder_04"], outline, f)))
        frames_data.append((f"projectiles/pj_soul_banner_{f}", make_fixture_item(16, 16, pal["soul_04"], pal["soul_07"], outline, f)))
        frames_data.append((f"props/prop_stone_lantern_{f}", make_fixture_item(16, 32, pal["ink_04"], pal["bronze_06"], outline, f)))
        frames_data.append((f"props/prop_alchemy_jar_{f}", make_fixture_item(16, 24, pal["bronze_02"], pal["jade_05"], outline, f)))
        frames_data.append((f"vfx/vfx_qi_burst_{f}", make_fixture_item(24, 24, pal["thunder_01"], pal["thunder_03"], outline, f)))
        frames_data.append((f"ui/ui_spirit_stone_{f}", make_fixture_item(16, 16, pal["jade_04"], pal["thunder_04"], outline, f)))

    # Pack into a simple shelf-packed Phaser/Pixi hash atlas (512px wide)
    atlas_w = 512
    x = 0
    y = 0
    row_h = 0
    placements: list[tuple[str, int, int, Canvas]] = []
    for key, canvas in frames_data:
        if x + canvas.w + 2 > atlas_w:
            x = 0
            y += row_h + 2
            row_h = 0
        placements.append((key, x, y, canvas))
        x += canvas.w + 2
        row_h = max(row_h, canvas.h)
    atlas_h = y + row_h + 2

    sheet = Canvas(atlas_w, atlas_h)
    atlas_frames: dict[str, dict] = {}
    for key, px, py, canvas in placements:
        sheet.blit(canvas, px, py)
        atlas_frames[key] = {
            "frame": {"x": px, "y": py, "w": canvas.w, "h": canvas.h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": canvas.w, "h": canvas.h},
            "sourceSize": {"w": canvas.w, "h": canvas.h},
        }

    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    atlas_png_name = "fixtures_atlas.png"
    write_png(ATLAS_DIR / atlas_png_name, atlas_w, atlas_h, sheet.buf)

    atlas_json = {
        "frames": atlas_frames,
        "meta": {
            "app": "tien-nghich-2d-fixture-generator",
            "fixture": True,
            "note": "CLEARLY-LABELLED DEV FIXTURES ONLY — NOT REAL GAME ART. Characters omitted (PixelLab MCP not connected).",
            "version": "1.0",
            "image": atlas_png_name,
            "format": "RGBA8888",
            "size": {"w": atlas_w, "h": atlas_h},
            "scale": "1",
        },
    }
    (ATLAS_DIR / "fixtures_atlas.json").write_text(json.dumps(atlas_json, indent=2), encoding="utf-8")

    # Also write a couple individual PNGs under assets/_fixtures/pngs/ to smoke-test raw PNG fallback
    for sample_key in ("weapons/wp_thunder_seal", "vfx/vfx_thunder_strike_0", "vfx/vfx_thunder_strike_1", "vfx/vfx_thunder_strike_2", "vfx/vfx_thunder_strike_3"):
        f_idx = int(sample_key.rsplit("_", 1)[-1]) if sample_key[-1].isdigit() else 0
        w, h = (24, 24) if "weapon" in sample_key else (32, 48)
        c = make_fixture_item(w, h, pal["thunder_05"], pal["thunder_04"], outline, f_idx)
        write_png(PNG_DIR / f"{sample_key}.png", w, h, c.buf)

    print(f"Generated {len(atlas_frames)} fixture atlas frames at {ATLAS_DIR / 'fixtures_atlas.json'}")
    print(f"Generated 5 standalone dev-fallback fixture PNGs under {PNG_DIR}")


if __name__ == "__main__":
    main()
