"""Run: python -I tools/tests/test_qa_assets.py   (stdlib unittest + numpy + Pillow; rebuilds fixtures in a temp dir)"""
import importlib.util
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


fx = load("make_qa_fixtures", "tools/scripts/make_qa_fixtures.py")
qa = load("qa_assets", "tools/scripts/qa_assets.py")


def tree_hash(p: Path):
    return {f.relative_to(p).as_posix(): hashlib.sha1(f.read_bytes()).hexdigest() for f in sorted(p.rglob("*")) if f.is_file()}


class QATests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "fx"
        fx.build(cls.out)
        cls.m = qa.json.loads((cls.out / "manifest.json").read_text(encoding="utf8"))
        cls.pal, cls.ol = qa.load_palette(ROOT / "tools/generators/palette.json")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def scan(self, root):
        return qa.scan(root, self.m, self.pal, self.ol)

    def test_every_planted_defect_is_caught_and_clean_files_stay_clean(self):
        issues, _ = self.scan(self.out / "raw")
        by_file = {}
        for i in issues:
            if i["severity"] == "error":
                by_file.setdefault(i["where"], set()).add(i["code"])
        for rel, codes in fx.EXPECTED.items():
            self.assertEqual(by_file.get(rel, set()), codes, rel)
        self.assertTrue(any(i["code"] == "missing_frames" and i["where"] == "mobs/fx_mob" for i in issues))
        self.assertTrue(any(i["code"] == "duplicate_frame" and i["where"] == "mobs/fx_mob/idle_south_2.png" for i in issues))

    def test_fix_never_touches_raw_and_removes_fixable_errors(self):
        raw, dst = self.out / "raw", Path(self.tmp.name) / "run" / "processed"
        before = tree_hash(raw)
        qa.process_fix(raw, dst, self.m, self.pal, self.ol, fix_outline=True)
        self.assertEqual(before, tree_hash(raw))
        issues, _ = self.scan(dst)
        codes = {i["code"] for i in issues if i["severity"] == "error"}
        self.assertFalse(codes & {"partial_alpha", "dirty_transparent", "off_palette", "outline_gap"}, codes)
        self.assertIn("empty_frame", codes)       # not auto-fixable by design
        self.assertIn("missing_frames", codes)

    def test_fix_is_idempotent(self):
        raw, d1, d2 = self.out / "raw", Path(self.tmp.name) / "i1" / "processed", Path(self.tmp.name) / "i2" / "processed"
        qa.process_fix(raw, d1, self.m, self.pal, self.ol, fix_outline=True)
        qa.process_fix(d1, d2, self.m, self.pal, self.ol, fix_outline=True)
        self.assertEqual(tree_hash(d1), tree_hash(d2))

    def test_lab_quantize_snaps_to_nearest_palette_colour(self):
        import numpy as np
        a = np.zeros((2, 2, 4), np.uint8)
        a[0, 0] = (0x30, 0xA0, 0x7C, 255)        # near jade_04 #2fa27a
        a[0, 1] = (0x14, 0x10, 0x1B, 255)        # near outline
        a[1, 0] = (9, 9, 9, 100)                 # partial alpha below threshold -> transparent
        fixed, st = qa.fix_array(a, self.pal, self.ol)
        self.assertEqual(tuple(fixed[0, 0, :3]), (0x2F, 0xA2, 0x7A))
        self.assertEqual(tuple(fixed[0, 1, :3]), self.ol)
        self.assertEqual(tuple(fixed[1, 0]), (0, 0, 0, 0))

    def test_dst_guard(self):
        with self.assertRaises(SystemExit):
            qa.main(["--manifest", str(self.out / "manifest.json"), "--fix", "--src", str(self.out / "raw"), "--dst", str(self.out / "raw" / "x")])

    def test_real_manifest_expected_frame_total(self):
        m = qa.json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf8"))
        chars = [a for a in m["assets"] if a["category"] in ("player", "mob", "boss")]
        for a in chars:
            self.assertEqual(len(qa.expected_files(a)), a["total_frames"], a["id"])
        self.assertEqual(qa.manifest_selfcheck(m), [])

    def test_real_processed_tree_vfx_and_manifest_alignment(self):
        m = qa.json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf8"))
        issues, cov = qa.scan(ROOT / "assets/processed", m, self.pal, self.ol)
        errs = [i for i in issues if i["severity"] == "error"]
        self.assertEqual(errs, [], f"Unexpected errors on real processed tree: {errs[:5]}")
        groups = qa.group_counts(cov)
        self.assertEqual(groups["vfx"]["assets"], 13)
        self.assertEqual(groups["vfx"]["complete"], 13)
        self.assertEqual(groups["vfx"]["have"], 466)
        self.assertEqual(groups["vfx"]["want"], 466)
        self.assertEqual(groups["vfx"]["excluded_sheets"], 13)
        self.assertEqual(sum(v["have"] for v in cov.values()), 3051)

    def test_vfx_index_validation_and_defect_detection(self):
        import numpy as np
        from PIL import Image

        def write_png(path: Path, arr: np.ndarray):
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(arr, "RGBA").save(path)

        def solid(w, h, rgba):
            a = np.zeros((h, w, 4), np.uint8)
            a[:, :] = rgba
            return a

        jade = (0x2F, 0xA2, 0x7A, 255)
        clear = (0, 0, 0, 0)
        vfx_manifest = {
            "assets": [],
            "delivery": {"vfx_index": "assets/processed/vfx/vfx_index.json", "vfx_readiness": "packed"},
        }
        vfx_index = {
            "effects": [
                {
                    "id": "spark_once",
                    "frame_size": [8, 8],
                    "frame_count": 3,
                    "loop": False,
                    "tags": [["burst", 0, 1, "once"], ["fade", 2, 2, "once"]],
                    "sheet": "assets/processed/vfx/spark_once_sheet.png",
                },
                {
                    "id": "aura_loop",
                    "frame_size": [8, 8],
                    "frame_count": 2,
                    "loop": True,
                    "tags": [["aura", 0, 1, "loop"]],
                    "sheet": "assets/processed/vfx/aura_loop_sheet.png",
                },
            ]
        }

        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "processed"
            vdir = root / "vfx"
            vdir.mkdir(parents=True)
            (vdir / "vfx_index.json").write_text(qa.json.dumps(vfx_index), encoding="utf8")

            # Clean baseline: 3 once frames (last is transparent fade tail) + 2 loop frames + 2 declared contact sheets
            write_png(vdir / "spark_once_0.png", solid(8, 8, jade))
            write_png(vdir / "spark_once_1.png", solid(8, 8, (0x5C, 0xC7, 0x96, 255)))
            write_png(vdir / "spark_once_2.png", solid(8, 8, clear))
            write_png(vdir / "spark_once_sheet.png", solid(24, 8, (1, 2, 3, 255)))  # off-palette sheet excluded
            write_png(vdir / "aura_loop_0.png", solid(8, 8, jade))
            write_png(vdir / "aura_loop_1.png", solid(8, 8, (0x5C, 0xC7, 0x96, 255)))
            write_png(vdir / "aura_loop_sheet.png", solid(16, 8, (1, 2, 3, 255)))

            issues, cov = qa.scan(root, vfx_manifest, self.pal, self.ol)
            self.assertEqual([i for i in issues if i["severity"] == "error"], [])
            self.assertTrue(any(i["severity"] == "warn" and i["code"] == "empty_frame" and i["where"] == "vfx/spark_once_2.png" for i in issues))
            self.assertEqual(qa.group_counts(cov)["vfx"]["have"], 5)
            self.assertEqual(qa.group_counts(cov)["vfx"]["excluded_sheets"], 2)

            # Plant unexplained contact sheet, extra frame, zero-padded name, nested orphan, wrong size, off-palette, empty loop frame
            write_png(vdir / "rogue_sheet.png", solid(8, 8, jade))
            write_png(vdir / "spark_once_3.png", solid(8, 8, jade))
            write_png(vdir / "spark_once_00.png", solid(8, 8, jade))
            write_png(vdir / "nested" / "bad.png", solid(8, 8, jade))
            write_png(vdir / "spark_once_1.png", solid(16, 8, jade))
            write_png(vdir / "aura_loop_0.png", solid(8, 8, (12, 34, 56, 255)))
            write_png(vdir / "aura_loop_1.png", solid(8, 8, clear))
            (vdir / "spark_once_0.png").unlink()

            issues2, _ = qa.scan(root, vfx_manifest, self.pal, self.ol)
            errs = {(i["where"], i["code"]) for i in issues2 if i["severity"] == "error"}
            self.assertIn(("vfx/rogue_sheet.png", "bad_name"), errs)
            self.assertIn(("vfx/spark_once_3.png", "orphan_frame"), errs)
            self.assertIn(("vfx/spark_once_00.png", "bad_name"), errs)
            self.assertIn(("vfx/nested/bad.png", "orphan_path"), errs)
            self.assertIn(("vfx/spark_once_1.png", "size"), errs)
            self.assertIn(("vfx/aura_loop_0.png", "off_palette"), errs)
            self.assertIn(("vfx/aura_loop_1.png", "empty_frame"), errs)
            self.assertIn(("vfx/spark_once", "missing_frames"), errs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
