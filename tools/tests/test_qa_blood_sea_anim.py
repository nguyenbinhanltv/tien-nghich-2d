#!/usr/bin/env python
"""Unit tests for tools/scripts/qa_blood_sea_anim.py (synthetic fixtures only)."""
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("qa_blood_sea_anim", REPO / "tools/scripts/qa_blood_sea_anim.py")
qa_anim = importlib.util.module_from_spec(SPEC)
sys.modules["qa_blood_sea_anim"] = qa_anim
SPEC.loader.exec_module(qa_anim)


def _make_solid_box(arr: np.ndarray, x0: int, y0: int, x1: int, y1: int, rgba=(165, 29, 53, 255)):
    arr[y0:y1, x0:x1] = rgba


class TestBloodSeaAnimQA(unittest.TestCase):
    def _build_synthetic_encounter(self, root: Path, clip_right=False, lean_north=False, dirty_web=False):
        src = root / "source"
        web = root / "web"
        rt = root / "runtime"
        src.mkdir(parents=True, exist_ok=True)
        web.mkdir(parents=True, exist_ok=True)
        rt.mkdir(parents=True, exist_ok=True)

        # Synthetic 4x4 player sheet (400x400, 100x100 per cell, scale=0.2 -> 20px fits cleanly in 32x32)
        p_arr = np.zeros((400, 400, 4), dtype=np.uint8)
        for r in range(4):
            for c in range(4):
                ox, oy = c * 100, r * 100
                if clip_right and r == 2 and c == 3:
                    _make_solid_box(p_arr, ox + 40, oy + 20, ox + 99, oy + 90)
                elif lean_north and r == 2 and c == 3:
                    _make_solid_box(p_arr, ox + 45, oy + 20, ox + 95, oy + 90)
                else:
                    _make_solid_box(p_arr, ox + 30, oy + 20, ox + 70, oy + 90)
                # Add violet banner pixels on all cells so prop continuity passes
                _make_solid_box(p_arr, ox + 44, oy + 35, ox + 56, oy + 65, rgba=(143, 98, 207, 255))
        Image.fromarray(p_arr, "RGBA").save(src / "wl_blood_foundation.png")

        # Synthetic 2x3 boss sheet (600x400, 200x200 per cell, scale=0.25 -> fits 80x80)
        b_arr = np.zeros((400, 600, 4), dtype=np.uint8)
        for r in range(2):
            for c in range(3):
                ox, oy = c * 200, r * 200
                _make_solid_box(b_arr, ox + 50, oy + 40, ox + 150, oy + 185, rgba=(106, 63, 168, 255))
        Image.fromarray(b_arr, "RGBA").save(src / "boss_ghost_king.png")

        # Native web sheets (4-connected #14101a outline + palette interior)
        ink = (0x14, 0x10, 0x1A, 255)
        fill = (0xA5, 0x1D, 0x35, 255)
        blade = (0xE0, 0xB0, 0x30, 255)
        pw = np.zeros((128, 128, 4), dtype=np.uint8)
        p_frames = {}
        dirs_p = ["south", "east", "north", "west"]
        poses_p = ["idle", "stride", "windup", "impact"]
        for r, d in enumerate(dirs_p):
            for c, p in enumerate(poses_p):
                ox, oy = c * 32, r * 32
                _make_solid_box(pw, ox + 10, oy + 8, ox + 22, oy + 30, ink)
                _make_solid_box(pw, ox + 11, oy + 9, ox + 21, oy + 29, fill)
                _make_solid_box(pw, ox + 12, oy + 12, ox + 15, oy + 15, blade)
                p_frames[f"characters/wl_blood_foundation/{p}_{d}_0"] = {
                    "frame": {"x": ox, "y": oy, "w": 32, "h": 32},
                    "ground": [16, 30],
                }
        if dirty_web:
            pw[0, 0] = (20, 16, 26, 0)
        Image.fromarray(pw, "RGBA").save(web / "wl_blood_foundation.png")
        (web / "wl_blood_foundation.json").write_text(
            json.dumps({"frames": p_frames, "meta": {"image": "wl_blood_foundation.png"}}), encoding="utf-8"
        )

        bw = np.zeros((160, 240, 4), dtype=np.uint8)
        b_frames = {}
        dirs_b = ["south", "east"]
        poses_b = ["idle", "windup", "impact"]
        for r, d in enumerate(dirs_b):
            for c, p in enumerate(poses_b):
                ox, oy = c * 80, r * 80
                _make_solid_box(bw, ox + 20, oy + 15, ox + 60, oy + 75, ink)
                _make_solid_box(bw, ox + 21, oy + 16, ox + 59, oy + 74, (0x6A, 0x3F, 0xA8, 255))
                b_frames[f"characters/boss_ghost_king/{p}_{d}_0"] = {
                    "frame": {"x": ox, "y": oy, "w": 80, "h": 80},
                    "ground": [40, 75],
                }
        Image.fromarray(bw, "RGBA").save(web / "boss_ghost_king.png")
        (web / "boss_ghost_king.json").write_text(
            json.dumps({"frames": b_frames, "meta": {"image": "boss_ghost_king.png"}}), encoding="utf-8"
        )

        contract = {
            "version": 1,
            "alphaThreshold": 128,
            "actors": {
                "wl_blood_foundation": {
                    "size": 32,
                    "pivot": [16, 30],
                    "scale": 0.35 if clip_right else 0.2,
                    "rows": dirs_p,
                    "poses": poses_p,
                    "yEdges": [0, 100, 200, 300, 400],
                    "xEdges": [[0, 100, 200, 300, 400]] * 4,
                    "anchors": [[[c * 100 + 50, r * 100 + 90] for c in range(4)] for r in range(4)],
                },
                "boss_ghost_king": {
                    "size": 80,
                    "pivot": [40, 75],
                    "scale": 0.25,
                    "rows": dirs_b,
                    "poses": poses_b,
                    "yEdges": [0, 200, 400],
                    "xEdges": [[0, 200, 400, 600]] * 2,
                    "anchors": [[[c * 200 + 100, r * 200 + 185] for c in range(3)] for r in range(2)],
                },
            },
        }
        (root / "contract.json").write_text(json.dumps(contract), encoding="utf-8")

        (rt / "combat.mjs").write_text(
            "p.action=0; p.dash=.18;\np.action=.34;\nb.timer=kind==='wail'?1.2:0.90;\nb.face=Math.abs(dir.x)>.35?(dir.x<0?'west':'east'):'south';\nb.phase='impact'; b.timer=.25;\nb.phase='recover'; b.timer=.56;\n",
            encoding="utf-8",
        )
        (rt / "game.mjs").write_text(
            "const stride=p.moving&&Math.floor(state.time*8)%2===1, pose=p.action>.19?'windup':p.action>0?'impact':'idle';\nconst face=b.face==='west'?'east':b.face;\nif(mirror) context.scale(-1,1);\ncontext.drawImage(art.img,f.x,f.y,f.w,f.h,-g[0],-g[1],f.w,f.h);\n",
            encoding="utf-8",
        )
        return rt

    def test_clean_synthetic_passes_and_parses_timing(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "enc"
            out = Path(td) / "out"
            rt = self._build_synthetic_encounter(root)
            rep = qa_anim.audit_encounter(root, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json", rt)
            self.assertEqual(rep["summary"]["errors"], 0, rep["exceptions"])
            self.assertEqual(rep["runtime"]["timing"]["wl_blood_foundation"]["attack_total_ms"], 340)
            self.assertEqual(rep["runtime"]["timing"]["wl_blood_foundation"]["attack_windup_ms"], 150)
            self.assertEqual(rep["runtime"]["timing"]["wl_blood_foundation"]["attack_impact_ms"], 190)
            self.assertTrue(rep["runtime"]["west_mirror_verified"])
            self.assertTrue(rep["runtime"]["boss_north_reuse_verified"])
            qa_anim.build_contact_sheet(root, rep, out / "sheet.png")
            qa_anim.build_html_workbench(root, rep, out / "qa.html")
            self.assertTrue((out / "sheet.png").is_file())
            self.assertTrue((out / "qa.html").is_file())

    def test_detects_clip_lean_and_dirty_transparent(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "enc"
            rt = self._build_synthetic_encounter(root, clip_right=True, lean_north=True, dirty_web=True)
            rep = qa_anim.audit_encounter(root, REPO / "assets/manifest.json", REPO / "tools/generators/palette.json", rt)
            codes = {e["code"] for e in rep["exceptions"] if e["severity"] == "error"}
            self.assertIn("native_canvas_clip", codes)
            self.assertIn("cardinal_orientation_lean", codes)
            self.assertIn("web_dirty_transparent", codes)


if __name__ == "__main__":
    unittest.main()
