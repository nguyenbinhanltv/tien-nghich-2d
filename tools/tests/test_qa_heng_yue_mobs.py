#!/usr/bin/env python
"""Unit tests for tools/scripts/qa_heng_yue_mobs.py using synthetic zip fixtures."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("qa_heng_yue_mobs", REPO / "tools/scripts/qa_heng_yue_mobs.py")
qa_hy = importlib.util.module_from_spec(SPEC)
sys.modules["qa_heng_yue_mobs"] = qa_hy
SPEC.loader.exec_module(qa_hy)


class TestHengYueMobQA(unittest.TestCase):
    def _make_zip(self, zip_path: Path, drift_impact=False, with_full_runtime=False):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "Heng-Yue" / "mob_rogue_disciple"
            root.mkdir(parents=True)
            src_arr = np.zeros((400, 600, 4), dtype=np.uint8)
            src_arr[20:100, 20:100] = (110, 104, 119, 255)
            src_file = root / "source.png"
            Image.fromarray(src_arr, "RGBA").save(src_file)
            sha = hashlib.sha256(src_file.read_bytes()).hexdigest()

            ink = (0x14, 0x10, 0x1A, 255)
            fill = (0x6E, 0x68, 0x77, 255)
            accent = (0xA5, 0x1D, 0x35, 255)
            sheet = np.zeros((72, 216, 4), dtype=np.uint8)
            poses = ["idle_ready", "move_contact_a", "move_contact_b", "attack_windup", "attack_impact", "attack_recovery"]
            keys = []
            for r, facing in enumerate(["south", "east"]):
                for c, pose in enumerate(poses):
                    sx, sy = 2 + 36 * c, 2 + 36 * r
                    dx = 6 if (drift_impact and facing == "south" and pose == "attack_impact") else 0
                    x0 = 10 + dx
                    sheet[sy + 10:sy + 32, sx + x0:sx + x0 + 11] = ink
                    sheet[sy + 11:sy + 31, sx + x0 + 1:sx + x0 + 10] = fill
                    sheet[sy + 14 + r, sx + x0 + 2 + c] = accent
                    keys.append({
                        "facing": facing,
                        "pose": pose,
                        "crop_xyxy": [c * 90 + 10, r * 180 + 10, c * 90 + 80, r * 180 + 150],
                        "ground_xy": [c * 90 + 45, r * 180 + 149],
                        "sheet_xy": [sx, sy],
                    })
            keys_file = root / "keys.png"
            Image.fromarray(sheet, "RGBA").save(keys_file)
            poses_json = {
                "id": "mob_rogue_disciple",
                "name": "Rogue Outer Disciple",
                "source_sha256": sha,
                "source_dimensions": [600, 400],
                "canvas": [32, 32],
                "scale": 0.1,
                "anchor_px": [15, 31],
                "palette": {
                    "ink_04": "#6e6877",
                    "blood_07": "#f9c4c0",
                    "ink_02": "#2c2733",
                    "ink_01": "#14101a",
                    "ink_05": "#9d98a4",
                    "blood_04": "#a51d35",
                },
                "keys": keys,
            }
            (root / "poses.json").write_text(json.dumps(poses_json), encoding="utf-8")
            timing_json = {
                "status": "key poses for assembly",
                "null_meaning": "drawing still required",
                "facings": ["south", "east"],
                "clips": {
                    "idle": {"loop": True, "pose_at_index": ["idle_ready", None, None, None]},
                    "move": {"loop": True, "pose_at_index": ["move_contact_a", None, None, "move_contact_b", None, None]},
                    "attack": {"loop": False, "pose_at_index": ["attack_windup", None, "attack_impact", "attack_recovery"]},
                    "death": {"loop": False, "pose_at_index": [None, None, None, None]},
                },
            }
            (root / "timing.json").write_text(json.dumps(timing_json), encoding="utf-8")

            if with_full_runtime:
                prog_file = root / "progression-source.png"
                Image.fromarray(src_arr, "RGBA").save(prog_file)
                fdir = root / "frames"
                fdir.mkdir()
                rt_frames = []
                clips = {
                    "idle": {"frames": 4, "loop": True},
                    "move": {"frames": 6, "loop": True},
                    "attack": {"frames": 4, "loop": False},
                    "death": {"frames": 4, "loop": False},
                }
                uid = 0
                for state, cfg in clips.items():
                    for facing in ("south", "east"):
                        for idx in range(cfg["frames"]):
                            tile = np.zeros((32, 32, 4), dtype=np.uint8)
                            # Collapse height during death
                            h_box = [22, 18, 14, 9][idx] if state == "death" else 22
                            w_box = 18 if (state == "death" and idx == 3) else 11
                            x0 = 15 - w_box // 2
                            y0 = 32 - h_box
                            tile[y0:32, x0:x0 + w_box] = ink
                            tile[y0 + 1:31, x0 + 1:x0 + w_box - 1] = fill
                            # Unique accent pixel inside interior
                            ux = x0 + 1 + (uid % max(1, w_box - 2))
                            uy = y0 + 1 + ((uid // max(1, w_box - 2)) % max(1, h_box - 2))
                            tile[uy, ux] = accent
                            uid += 1
                            fn = f"{state}_{facing}_{idx}.png"
                            Image.fromarray(tile, "RGBA").save(fdir / fn)
                            rt_frames.append({
                                "filename": fn,
                                "state": state,
                                "facing": facing,
                                "index": idx,
                                "beat": f"{state}_{idx}",
                                "source": "keys.png" if (idx == 0 and state != "death") else "progression-source.png",
                            })
                rt_json = {
                    "id": "mob_rogue_disciple",
                    "canvas": [32, 32],
                    "anchor_px": [15, 31],
                    "palette": poses_json["palette"],
                    "scale": 0.12,
                    "facings": ["south", "east"],
                    "clips": clips,
                    "frames": rt_frames,
                    "source_hashes": {
                        "keys.png": hashlib.sha256(keys_file.read_bytes()).hexdigest(),
                        "progression-source.png": hashlib.sha256(prog_file.read_bytes()).hexdigest(),
                    },
                }
                (root / "runtime.json").write_text(json.dumps(rt_json), encoding="utf-8")
                asm_clips = {}
                for state, cfg in clips.items():
                    dirs = {}
                    for facing in ("south", "east"):
                        dirs[facing] = [
                            {
                                "path": f"mob_rogue_disciple/frames/{state}_{facing}_{idx}.png",
                                "sha256": hashlib.sha256((fdir / f"{state}_{facing}_{idx}.png").read_bytes()).hexdigest(),
                                "beat": f"{state}_{idx}",
                            }
                            for idx in range(cfg["frames"])
                        ]
                    asm_clips[state] = {"loop": cfg["loop"], "directions": dirs}
                asm_json = {
                    "canvas_px": [32, 32],
                    "facing_rules": {
                        "north": {"source": "south", "flip_x": False},
                        "west": {"source": "east", "flip_x": True, "anchor_x": "31 - source_anchor_x"},
                    },
                    "assets": {"mob_rogue_disciple": {"anchor_px": [15, 31], "clips": asm_clips}},
                }
                (root.parent / "assembly.json").write_text(json.dumps(asm_json), encoding="utf-8")

            with zipfile.ZipFile(zip_path, "w") as zf:
                for p in root.parent.rglob("*"):
                    if p.is_file():
                        zf.write(p, f"Heng-Yue/{p.relative_to(root.parent).as_posix()}")

    def test_clean_zip_assembles_and_verifies_mirror_anchor(self):
        with tempfile.TemporaryDirectory() as td:
            zp = Path(td) / "Heng-Yue.zip"
            out = Path(td) / "out"
            self._make_zip(zp, drift_impact=False)
            rep, imgs = qa_hy.audit_mob_package(zp, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json", run_repo_compat=False)
            self.assertEqual(rep["summary"]["errors"], 0, rep["exceptions"])
            mob = rep["mobs"]["mob_rogue_disciple"]
            self.assertEqual(mob["anchor_px"], [15, 31])
            self.assertEqual(mob["west_mirrored_anchor_px"], [16, 31])
            self.assertEqual(mob["timing_contract"]["filled_slots"], 12)
            self.assertEqual(mob["timing_contract"]["open_slots"], 24)
            clips = mob["assembly"]["clips"]
            self.assertEqual(clips["death"]["coverage_status"], "not_authored")
            qa_hy.build_mob_contact_sheet(rep, imgs, out / "sheet.png")
            mob["name"] = "Label </script> & text"
            qa_hy.build_mob_html_workbench(rep, imgs, out / "viewer.html")
            html = (out / "viewer.html").read_text(encoding="utf-8")
            self.assertNotIn(mob["name"], html)
            self.assertIn(r"Label \u003c/script> & text", html)
            self.assertTrue((out / "sheet.png").is_file())
            self.assertTrue((out / "viewer.html").is_file())

    def test_full_runtime_36f_pilot_assembles_all_4_clips_and_passes_repo_packer(self):
        with tempfile.TemporaryDirectory() as td:
            zp = Path(td) / "Heng-Yue.zip"
            out = Path(td) / "out"
            self._make_zip(zp, drift_impact=False, with_full_runtime=True)
            rep, imgs = qa_hy.audit_mob_package(zp, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json", run_repo_compat=True)
            self.assertEqual(rep["summary"]["errors"], 0, rep["exceptions"])
            self.assertEqual(rep["summary"]["total_runtime_frames"], 36)
            self.assertEqual(rep["assembly_json_verification"]["frames_sha256_verified"], 36)
            self.assertEqual(rep["assembly_json_verification"]["frames_sha256_failed"], 0)
            self.assertEqual(rep["assembly_json_verification"]["directional_clips_verified"], 8)
            self.assertEqual(rep["repo_pipeline_compat"]["qa_assets_rc"], 0)
            self.assertEqual(rep["repo_pipeline_compat"]["pack_atlases_rc"], 0)
            with self.assertRaisesRegex(ValueError, "Archive SHA-256 mismatch"):
                qa_hy.audit_mob_package(
                    zp, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json",
                    run_repo_compat=False, expected_sha256="0" * 64,
                )
            mob = rep["mobs"]["mob_rogue_disciple"]
            self.assertEqual(mob["tier"], "full_runtime_36f")
            self.assertEqual(len(mob["assembly"]["clips"]["death"]["directions"]["west"]), 4)
            self.assertEqual(mob["assembly"]["clips"]["death"]["directions"]["west"][3]["ground_px"], [16, 31])
            qa_hy.build_pilot_runtime_contact_sheet(rep, imgs, out / "pilot.png")
            qa_hy.build_mob_html_workbench(rep, imgs, out / "viewer.html")
            self.assertTrue((out / "pilot.png").is_file())
            self.assertTrue((out / "viewer.html").is_file())

    def test_zip_reader_rejects_duplicate_member_names(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            with zipfile.ZipFile(root / "duplicate.zip", "w") as archive:
                archive.writestr("Frames/test.png", b"first")
                archive.writestr("frames/test.png", b"second")
            with zipfile.ZipFile(root / "duplicate.zip") as archive:
                with self.assertRaisesRegex(ValueError, "duplicate ZIP member"):
                    qa_hy._extract_archive(archive, root / "output")

    def test_package_paths_must_be_portable_and_relative(self):
        for name in ("../frame.png", "/frame.png", "C:/frame.png", "a:b", "CON.png"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                qa_hy._package_path(Path("frames"), name)

    def test_detects_head_drift_warning(self):
        with tempfile.TemporaryDirectory() as td:
            zp = Path(td) / "Heng-Yue.zip"
            self._make_zip(zp, drift_impact=True)
            rep, _ = qa_hy.audit_mob_package(zp, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json", run_repo_compat=False)
            codes = {e["code"] for e in rep["exceptions"]}
            self.assertIn("head_pivot_drift", codes)


if __name__ == "__main__":
    unittest.main()
