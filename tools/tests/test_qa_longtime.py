"""Regressions for Longtime Wave 1 independent QA and offline chunk atlas packing.

Run: python tools/tests/test_qa_longtime.py  (uses TEMP/TMP; never writes to assets/).
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("qa_longtime", ROOT / "tools/scripts/qa_longtime.py")
ql = importlib.util.module_from_spec(SPEC)
sys.modules["qa_longtime"] = ql
SPEC.loader.exec_module(ql)

WAVE1_CODEX_IDS = [
    "lt_abode_stone",
    "lt_kiln",
    "lt_herb_bed",
    "lt_moon_gate",
    "lt_icon_seed",
    "lt_icon_ingot",
    "lt_icon_kiln_heat",
]


def make_sprite(w: int, h: int, fill_rgb: tuple[int, int, int], outline_rgb: tuple[int, int, int],
                solid_tile: bool = False) -> np.ndarray:
    arr = np.zeros((h, w, 4), dtype=np.uint8)
    if solid_tile:
        arr[:, :, :3] = fill_rgb
        arr[:, :, 3] = 255
        return arr
    # Draw a clean 1px outlined box inside the canvas
    x0, y0, x1, y1 = 2, 2, w - 3, h - 3
    arr[y0:y1 + 1, x0:x1 + 1, :3] = fill_rgb
    arr[y0:y1 + 1, x0:x1 + 1, 3] = 255
    arr[y0, x0:x1 + 1, :3] = outline_rgb
    arr[y1, x0:x1 + 1, :3] = outline_rgb
    arr[y0:y1 + 1, x0, :3] = outline_rgb
    arr[y0:y1 + 1, x1, :3] = outline_rgb
    return arr


def save_png(path: Path, arr: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr, "RGBA").save(path, format="PNG", optimize=False)


class LongtimeQATests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((ROOT / "assets/manifest_longtime.json").read_text(encoding="utf-8"))
        cls.palette, cls.outline = ql.load_palette(ROOT / "tools/generators/palette.json")
        cls.selected = ql.select_assets(cls.manifest, wave="wave_1", agent="codex_antigravity")

    def _build_clean_wave1_fixture(self, proc_root: Path, src_root: Path):
        fill = ql.hex_to_rgb("#2fa27a")  # jade_04
        for asset in self.selected:
            aid = asset["id"]
            prof = asset["_profile"]
            is_tile = prof["category"] == "tileset"
            exp = ql.expected_frames_for_asset(asset)
            for (clip, d, n), spec in exp.items():
                w, h = spec["size"]
                arr = make_sprite(w, h, fill, self.outline, solid_tile=is_tile)
                save_png(proc_root / aid / spec["filename"], arr)
            # Add a contact sheet that must be excluded from runtime inventory
            sheet = make_sprite(32, 32, (12, 34, 56), self.outline, solid_tile=True)
            save_png(proc_root / aid / f"{aid}_sheet.png", sheet)
            # Add source provenance metadata
            sdir = src_root / aid
            sdir.mkdir(parents=True, exist_ok=True)
            (sdir / "provenance.json").write_text(
                json.dumps({"tool": "codex", "prompt": "test", "source_sha256": "0" * 64}),
                encoding="utf-8",
            )

    def test_wave1_selection_matches_exact_7_ids_37_frames(self):
        self.assertEqual([a["id"] for a in self.selected], WAVE1_CODEX_IDS)
        total = sum(len(ql.expected_frames_for_asset(a)) for a in self.selected)
        self.assertEqual(total, 37)

    def test_clean_wave1_qa_and_deterministic_chunk_atlases(self):
        before_shipped = ql.snapshot_atlas_hashes(ROOT / "assets/atlases")
        self.assertGreater(len(before_shipped), 0)

        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            proc = base / "processed_longtime"
            src = base / "raw_longtime"
            out1 = base / "atlases_run1"
            out2 = base / "atlases_run2"
            self._build_clean_wave1_fixture(proc, src)

            res = ql.validate_group(self.manifest, proc, self.palette, self.outline, self.selected, source_root=src)
            errs = [i for i in res["issues"] if i["severity"] == "error"]
            self.assertEqual(errs, [], errs)
            self.assertEqual(len(res["sprites"]), 37)
            self.assertEqual(len(res["excluded_sheets"]), 7)

            pack1 = ql.pack_chunks(self.manifest, res["sprites"], out1)
            pack2 = ql.pack_chunks(self.manifest, res["sprites"], out2)

            # Chunk ownership & frame totals
            self.assertEqual(set(pack1.keys()), {"abode", "interface"})
            self.assertEqual(pack1["abode"]["mobile"]["frame_count"], 34)
            self.assertEqual(pack1["interface"]["mobile"]["frame_count"], 3)

            # Mobile page constraints & determinism
            for chunk in ("abode", "interface"):
                for plat in ("web", "mobile"):
                    self.assertEqual(pack1[chunk][plat]["manifest_sha256"], pack2[chunk][plat]["manifest_sha256"])
                    self.assertEqual(
                        [p["png_sha256"] for p in pack1[chunk][plat]["pages"]],
                        [p["png_sha256"] for p in pack2[chunk][plat]["pages"]],
                    )
                    for page in pack1[chunk][plat]["pages"]:
                        if plat == "mobile":
                            self.assertLessEqual(page["width"], 1024)
                            self.assertLessEqual(page["height"], 1024)
                            self.assertEqual(page["width"] & (page["width"] - 1), 0)
                            self.assertEqual(page["height"] & (page["height"] - 1), 0)
                    # Verify no contact sheet leaked into atlas keys and pixels round-trip exactly
                    page0_json = json.loads((out1 / plat / chunk / "atlas-0.json").read_text(encoding="utf-8"))
                    self.assertFalse(any("_sheet" in k for k in page0_json["frames"]))
                    with Image.open(out1 / plat / chunk / page0_json["meta"]["image"]) as sheet_im:
                        for k, rec in page0_json["frames"].items():
                            f = rec["frame"]
                            crop = sheet_im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
                            self.assertEqual(crop.tobytes(), res["sprites"][k]["image"].tobytes(), (chunk, plat, k))

        self.assertEqual(before_shipped, ql.snapshot_atlas_hashes(ROOT / "assets/atlases"))

    def test_detects_defects_and_unexplained_files(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            proc = base / "processed_longtime"
            src = base / "raw_longtime"
            self._build_clean_wave1_fixture(proc, src)

            # 1. Wrong dimensions
            save_png(proc / "lt_icon_seed/glyph_none_0.png", make_sprite(24, 24, ql.hex_to_rgb("#2fa27a"), self.outline))
            # 2. Off-palette pixel + partial alpha
            bad_ingot = make_sprite(16, 16, (12, 34, 56), self.outline)
            bad_ingot[5, 5, 3] = 128
            save_png(proc / "lt_icon_ingot/glyph_none_0.png", bad_ingot)
            # 3. Transparent hole in floor tile seam
            bad_floor = make_sprite(16, 16, ql.hex_to_rgb("#2fa27a"), self.outline, solid_tile=True)
            bad_floor[0, 0] = (0, 0, 0, 0)
            save_png(proc / "lt_abode_stone/floor_none_0.png", bad_floor)
            # 4. Missing frame
            (proc / "lt_kiln/hot_none_3.png").unlink()
            # 5. Extra orphan frame + unexplained PNG + zero-padded index + rogue sheet
            save_png(proc / "lt_kiln/hot_none_9.png", make_sprite(32, 32, ql.hex_to_rgb("#2fa27a"), self.outline))
            save_png(proc / "lt_kiln/hot_none_00.png", make_sprite(32, 32, ql.hex_to_rgb("#2fa27a"), self.outline))
            save_png(proc / "unknown_asset/idle_none_0.png", make_sprite(16, 16, ql.hex_to_rgb("#2fa27a"), self.outline))
            save_png(proc / "rogue_sheet.png", make_sprite(16, 16, ql.hex_to_rgb("#2fa27a"), self.outline))

            res = ql.validate_group(self.manifest, proc, self.palette, self.outline, self.selected, source_root=src)
            errs = {(i["where"], i["code"]) for i in res["issues"] if i["severity"] == "error"}
            self.assertIn(("lt_icon_seed/glyph_none_0.png", "size"), errs)
            self.assertIn(("lt_icon_ingot/glyph_none_0.png", "off_palette"), errs)
            self.assertIn(("lt_icon_ingot/glyph_none_0.png", "partial_alpha"), errs)
            self.assertIn(("lt_abode_stone/floor_none_0.png", "tile_seam_hole"), errs)
            self.assertIn(("lt_kiln", "missing_frames"), errs)
            self.assertIn(("lt_kiln/hot_none_9.png", "orphan_frame"), errs)
            self.assertIn(("lt_kiln/hot_none_00.png", "bad_name"), errs)
            self.assertIn(("unknown_asset/idle_none_0.png", "orphan_asset"), errs)
            self.assertIn(("rogue_sheet.png", "unexplained_sheet"), errs)

    def test_real_wave1_delivered_assets_and_offline_chunk_atlases(self):
        proc = ROOT / "assets/processed_longtime"
        src = ROOT / "assets/raw/longtime"
        export = ROOT / "assets/atlases_longtime"
        if not proc.is_dir():
            self.skipTest("Wave 1 processed assets not delivered yet")
        res = ql.validate_group(self.manifest, proc, self.palette, self.outline, self.selected, source_root=src)
        errs = [i for i in res["issues"] if i["severity"] == "error"]
        self.assertEqual(errs, [], errs)
        self.assertEqual(len(res["sprites"]), 37)
        self.assertTrue(all(v == "verified" for v in res["provenance"].values()), res["provenance"])
        # Verify offline chunk atlases match deterministic rebuild byte-for-byte
        if export.is_dir():
            with tempfile.TemporaryDirectory() as td:
                rebuilt = ql.pack_chunks(self.manifest, res["sprites"], Path(td) / "wave1")
                for chunk in ("abode", "interface"):
                    wave1_chunk_ids = sorted(a["id"] for a in self.selected if a["chunk_group"] == chunk)
                    for plat in ("web", "mobile"):
                        cm_path = export / plat / chunk / "chunk-manifest.json"
                        self.assertTrue(cm_path.is_file(), f"Missing {cm_path}")
                        disk = json.loads(cm_path.read_text(encoding="utf-8"))
                        self.assertEqual(disk["readiness"], "packed")
                        self.assertTrue(set(wave1_chunk_ids).issubset(disk["asset_ids"]))
                        if disk["asset_ids"] == wave1_chunk_ids:
                            expected_chunk = rebuilt[chunk][plat]
                        else:
                            cum_sel = ql.select_assets(self.manifest, wave=None, agent=None, ids=disk["asset_ids"])
                            cum_res = ql.validate_group(self.manifest, proc, self.palette, self.outline, cum_sel, source_root=src)
                            self.assertEqual([i for i in cum_res["issues"] if i["severity"] == "error"], [])
                            expected_chunk = ql.pack_chunks(self.manifest, cum_res["sprites"], Path(td) / f"{chunk}_{plat}")[chunk][plat]
                        self.assertEqual(
                            [p["png_sha256"] for p in disk["pages"]],
                            [p["png_sha256"] for p in expected_chunk["pages"]],
                        )
                        self.assertEqual(
                            [p["json_sha256"] for p in disk["pages"]],
                            [p["json_sha256"] for p in expected_chunk["pages"]],
                        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
