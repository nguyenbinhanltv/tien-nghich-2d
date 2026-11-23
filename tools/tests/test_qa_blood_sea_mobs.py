"""Unit tests for independent Blood Sea mob animation assembly & QA verifier."""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools/scripts"))

import qa_blood_sea_mobs as qa  # noqa: E402

def _manifest_without_hurt(directory: Path) -> Path:
    """The synthetic Blood Sea package is the original delivery (no `hurt` clip); the repo manifest now lists it
    (PX-1, 2026-11-24), so audit the package against the manifest as it was delivered."""
    manifest = json.loads((REPO / "assets/manifest.json").read_text(encoding="utf-8"))
    for asset in manifest["assets"]:
        hurt = asset.get("animations", {}).pop("hurt", None)
        if hurt:
            asset["frames_per_direction"] -= hurt["frames"]
            asset["total_frames"] -= hurt["frames"] * len(asset["directions"])
    path = directory / "manifest_original.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


INK = (20, 16, 26, 255)
CRIMSON = (165, 29, 53, 255)
BRIGHT = (238, 122, 128, 255)
PURPLE = (45, 27, 78, 255)


def _draw_outlined_sprite(
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    fill: tuple[int, int, int, int],
    accent: tuple[int, int, int, int],
    mark_x: int = 0,
) -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([x0, y0, x1, y1], fill=fill, outline=INK)
    if x1 - x0 >= 6 and y1 - y0 >= 6:
        # Distinct per-frame mark so every silhouette/pixel drawing is unique
        mx = min(x1 - 2, max(x0 + 2, x0 + 2 + mark_x))
        d.rectangle([mx, y0 + 2, min(x1 - 2, mx + 2), y0 + 4], fill=accent)
    return im


def _make_synthetic_blood_sea_zip(
    zip_path: Path,
    corrupt_crow_clearance: bool = False,
    corrupt_sha: bool = False,
    corrupt_wolf_drift: bool = False,
) -> str:
    assembly = {
        "canvas": [32, 32],
        "facings": {
            "south": "authored",
            "east": "authored",
            "north": "reuse south",
            "west": "mirror east and set anchor x to 31 - east anchor x",
        },
        "assets": {},
    }
    clip_counts = {"idle": (4, True), "move": (6, True), "attack": (4, False), "death": (4, False)}

    with zipfile.ZipFile(zip_path, "w") as zf:
        for mob_id, name, is_crow in (
            ("mob_blood_crow", "Blood Crow", True),
            ("mob_blood_wolf", "Blood Wolf", False),
        ):
            clips_out = {}
            sm_frames = []
            # Create a tiny dummy source sheet
            src_im = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
            src_buf = qa.io.BytesIO()
            src_im.save(src_buf, format="PNG")
            src_bytes = src_buf.getvalue()
            zf.writestr(f"Blood-Sea/assets/raw/characters/mobs/{mob_id}/source.png", src_bytes)

            frame_counter = 0
            for st, (cnt, loop) in clip_counts.items():
                clips_out[st] = {"loop": loop, "directions": {}}
                for dr in ("south", "east"):
                    seq = []
                    for i in range(cnt):
                        if is_crow:
                            if st == "idle":
                                clr = 4
                            elif st == "move":
                                clr = [5, 4, 3, 3, 4, 5][i]
                            elif st == "attack":
                                clr = [5, 3, 1, 4][i]
                            else:
                                clr = [4, 2, 1, 0][i]
                        else:
                            if st == "attack":
                                clr = [0, 2, 3, 0][i]
                            elif st == "move":
                                clr = [0, 0, 1, 0, 0, 1][i]
                            else:
                                clr = 0

                        actual_clr = (clr + 2) if (corrupt_crow_clearance and is_crow and st == "death" and i == 3) else clr
                        by1 = 31 - actual_clr
                        h = 14 if st != "death" else max(7, 14 - i * 2)
                        by0 = max(2, by1 - h + 1)
                        cx = 16
                        if corrupt_wolf_drift and not is_crow and st == "attack" and dr == "south" and i == 3:
                            cx = 10
                        half_w = 5 + (frame_counter % 3)
                        bx0 = max(1, cx - half_w)
                        bx1 = min(30, bx0 + 2 * half_w)
                        fill = PURPLE if is_crow else CRIMSON
                        im = _draw_outlined_sprite(bx0, by0, bx1, by1, fill, BRIGHT, mark_x=frame_counter % 5)
                        # Make each frame uniquely shaped on top pixel so trimmed silhouette is distinct
                        im.putpixel((bx0 + 1 + (frame_counter % max(1, (bx1 - bx0 - 2))), by0 + 1), BRIGHT)
                        buf = qa.io.BytesIO()
                        im.save(buf, format="PNG")
                        pbytes = buf.getvalue()
                        rel = f"assets/processed/mobs/{mob_id}/{st}_{dr}_{i}.png"
                        zf.writestr(f"Blood-Sea/{rel}", pbytes)
                        digest = hashlib.sha256(pbytes).hexdigest()
                        if corrupt_sha and is_crow and st == "idle" and dr == "south" and i == 0:
                            digest = "0" * 64
                        seq.append({
                            "index": i,
                            "beat": f"{st}_{i}",
                            "clearance_px": clr,
                            "path": rel,
                            "sha256": digest,
                        })
                        cx0 = (frame_counter % 6) * 20
                        cy0 = (frame_counter // 6) * 20
                        sm_frames.append({
                            "state": st,
                            "direction": dr,
                            "index": i,
                            "beat": f"{st}_{i}",
                            "crop_xyxy": [cx0, cy0, cx0 + 18, cy0 + 18],
                            "source_root_x": cx0 + 9,
                            "clearance_px": clr,
                        })
                        frame_counter += 1
                    clips_out[st]["directions"][dr] = seq

            assembly["assets"][mob_id] = {"name": name, "anchor_px": [16, 31], "clips": clips_out}
            sm = {
                "id": mob_id,
                "display_name": name,
                "canvas": [32, 32],
                "anchor_px": [16, 31],
                "directions": ["south", "east"],
                "scale": 0.14,
                "source_file": "source.png",
                "source_sha256": hashlib.sha256(src_bytes).hexdigest(),
                "source_dimensions": [128, 128],
                "palette": {"ink_01": "#14101a", "blood_04": "#a51d35", "blood_06": "#ee7a80", "soul_02": "#2d1b4e"},
                "frames": sm_frames,
            }
            zf.writestr(f"Blood-Sea/assets/raw/characters/mobs/{mob_id}/source-map.json", json.dumps(sm, indent=2))
        zf.writestr("Blood-Sea/assembly.json", json.dumps(assembly, indent=2))
    return hashlib.sha256(zip_path.read_bytes()).hexdigest()


class TestBloodSeaMobQA(unittest.TestCase):
    def test_clean_package_verifies_digests_clearances_and_repo_packer(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tdp = Path(td)
            zpath = tdp / "Blood-Sea.zip"
            zsha = _make_synthetic_blood_sea_zip(zpath)
            out_dir = tdp / "out"

            report, strips = qa.audit_blood_sea_mobs(
                zpath,
                _manifest_without_hurt(tdp),
                REPO / "tools/generators/palette.json",
                run_repo_compat=True,
                expected_sha256=zsha,
            )
            self.assertEqual(report["summary"]["errors"], 0, report["exceptions"])
            self.assertEqual(report["summary"]["mobs_checked"], 2)
            self.assertEqual(report["summary"]["total_frames"], 72)
            self.assertEqual(report["summary"]["directional_clips"], 16)
            self.assertEqual(report["assembly_json_verification"]["frames_sha256_verified"], 72)
            self.assertEqual(report["assembly_json_verification"]["frames_sha256_failed"], 0)
            self.assertTrue(report["assembly_json_verification"]["facing_rules_ok"])
            self.assertEqual(report["repo_pipeline_compat"]["qa_assets_rc"], 0)
            self.assertEqual(report["repo_pipeline_compat"]["pack_atlases_rc"], 0)
            self.assertEqual(report["repo_pipeline_compat"]["directional_clips_packed"], 16)

            # Verify west mirror anchor 31 - 16 = 15 & north reuse south
            crow = report["mobs"]["mob_blood_crow"]
            self.assertTrue(crow["airborne_hover"])
            self.assertEqual(crow["west_mirrored_anchor_px"], [15, 31])
            self.assertEqual(crow["assembly"]["clips"]["attack"]["directions"]["west"][2]["ground_px"], [15, 31])
            self.assertEqual(crow["assembly"]["clips"]["attack"]["directions"]["west"][2]["clearance_px"], 1)
            self.assertTrue(crow["assembly"]["clips"]["attack"]["directions"]["west"][2]["active_contact"])

            qa.build_contact_sheet(report, strips, out_dir / "sheet.png")
            crow["name"] = "QA <label> & text"
            qa.build_html_workbench(report, strips, out_dir / "viewer.html")
            viewer = (out_dir / "viewer.html").read_text(encoding="utf-8")
            self.assertNotIn(crow["name"], viewer)
            self.assertIn(r"QA \u003clabel> & text", viewer)
            self.assertTrue((out_dir / "sheet.png").is_file())
            self.assertTrue((out_dir / "viewer.html").is_file())

            rc = qa.main(["--source", str(zpath), "--expected-sha256", zsha, "--out-dir", str(out_dir), "--out-prefix", "blood-sea-trio", "--skip-repo-compat", "--strict"])
            self.assertEqual(rc, 0)
            self.assertTrue((out_dir / "blood-sea-trio-assembly-manifest.json").is_file())
            self.assertTrue((out_dir / "blood-sea-trio-qa-contact-sheet.png").is_file())
            self.assertTrue((out_dir / "blood-sea-trio-animation-qa.html").is_file())

    def test_archive_pin_and_limits_apply_before_extraction(self):
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / "fixture.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("first.png", b"abc")
                zf.writestr("second.png", b"123")
            with patch.object(qa, "_extract_archive") as extract:
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    qa._resolve_package_root(archive, "0" * 64)
                extract.assert_not_called()
            for limit in ("MAX_ARCHIVE_MEMBERS", "MAX_ARCHIVE_BYTES"):
                with self.subTest(limit=limit), patch.object(qa, limit, 1), zipfile.ZipFile(archive) as zf:
                    with self.assertRaisesRegex(ValueError, "extraction limits"):
                        qa._extract_archive(zf, Path(td) / "out")
            self.assertFalse((Path(td) / "out").exists())

    def test_archive_member_and_assembly_paths_stay_in_package(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive = root / "fixture.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("../outside.png", b"fixture")
            with self.assertRaisesRegex(ValueError, "Invalid package path"):
                qa._resolve_package_root(archive)

            _make_synthetic_blood_sea_zip(archive)
            package, scratch, _ = qa._resolve_package_root(archive)
            self.addCleanup(scratch.cleanup)
            index = package / "assembly.json"
            data = json.loads(index.read_text(encoding="utf-8"))
            frames = data["assets"]["mob_blood_crow"]["clips"]["idle"]["directions"]["south"]
            frames[0]["path"] = "../outside.png"
            index.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Invalid package path"):
                qa.audit_blood_sea_mobs(package, REPO / "assets/manifest.json",
                                        REPO / "tools/generators/palette.json", run_repo_compat=False)

    def test_unsafe_metadata_and_output_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for name in ("../frame.png", "C:/frames/frame.png", "/frame.png", "NUL.png"):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    qa.package_path(root, name)
            with self.assertRaises(SystemExit):
                qa.main(["--source", str(root), "--out-dir", str(root / "out"), "--out-prefix", "../other"])

    def test_detects_sha_clearance_and_drift_defects(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            zpath = Path(td) / "Blood-Sea-bad.zip"
            _make_synthetic_blood_sea_zip(
                zpath,
                corrupt_crow_clearance=True,
                corrupt_sha=True,
                corrupt_wolf_drift=True,
            )
            report, _ = qa.audit_blood_sea_mobs(
                zpath,
                REPO / "assets/manifest.json",
                REPO / "tools/generators/palette.json",
                run_repo_compat=False,
            )
            codes = {e["code"] for e in report["exceptions"]}
            self.assertIn("frame_sha256_mismatch", codes)
            self.assertIn("clearance_mismatch", codes)
            self.assertIn("flyer_death_not_grounded", codes)
            self.assertIn("clip_pivot_drift", codes)


if __name__ == "__main__":
    unittest.main()
