import importlib.util
import unittest
from pathlib import Path

module = Path(__file__).resolve().parents[1] / "scripts/check_longtime.py"
spec = importlib.util.spec_from_file_location("check_longtime", module)
design = importlib.util.module_from_spec(spec)
spec.loader.exec_module(design)


class DesignTests(unittest.TestCase):
    def test_catalog(self):
        self.assertEqual(design.validate(design.read(design.CATALOG))["abode"], 1)

    def test_rejected_changes(self):
        def duplicate(m):
            m["assets"].append(m["assets"][0])
        def base(m):
            m["base"]["contracts"][0][2] = "0" * 64
        def routing(m):
            m["profiles"]["terrain"]["assigned_agent"] = "pixellab"
        def budget(m):
            m["chunks"]["abode"] = 0
        def missing(m):
            m["assets"][0]["dependencies"] = ["unknown"]
        def readiness(m):
            m["assets"][0]["readiness"] = "packed"
        def later(m):
            m["assets"][0]["dependencies"] = ["lt_mirror_adjudicator"]
        def cycle(m):
            m["assets"][0]["dependencies"] = ["lt_kiln"]
            m["assets"][1]["dependencies"] = [m["assets"][0]["id"]]
        for change in (duplicate, base, routing, budget, missing, readiness, later, cycle):
            with self.subTest(change=change.__name__):
                data = design.read(design.CATALOG)
                change(data)
                with self.assertRaises(ValueError):
                    design.validate(data)


class VfxDesignTests(unittest.TestCase):
    def test_vfx_entries(self):
        data = design.read(design.CATALOG)
        entries = data["vfx"]["entries"]
        self.assertEqual(len(entries), 6)
        self.assertEqual(sum(map(design.vfx_frames, entries)), 188)
        self.assertEqual(len(data["vfx"]["reuse_inherited"]), 12)

    def test_rejected_vfx_changes(self):
        def entry(m):
            return m["vfx"]["entries"][0]
        def duplicate(m):
            m["vfx"]["entries"].append(dict(entry(m)))
        def inherited_id(m):
            entry(m)["id"] = "hit_spark"
        def readiness(m):
            entry(m)["status"] = "shipped"
        def block_status(m):
            m["vfx"]["status"] = "planned"
        def no_evidence(m):
            entry(m)["chunk_group"] = "abode" if entry(m)["chunk_group"] != "abode" else "wards"
        def ramp(m):
            entry(m)["palettes"]["anchor"]["ramps"] = ["magenta"]
        def chunk(m):
            entry(m)["chunk_group"] = "nowhere"
        def event(m):
            entry(m)["events"][0][2] = 99
        def timing(m):
            entry(m)["clips"]["place"]["ms"] = [40]
        def pivot(m):
            entry(m)["pivot_px"] = [48, 24]
        def loop(m):
            entry(m)["clips"]["place"]["kind"] = "loop"
        def cue(m):
            entry(m)["palettes"]["anchor"]["uses"][0][2] = "sfx_unknown"
        def related(m):
            entry(m)["related"] = ["missing_asset"]
        def reuse(m):
            del m["vfx"]["reuse_inherited"]["hit_spark"]
        def budget(m):
            entry(m)["native_px"] = [1000, 1000]
            entry(m)["pivot_px"] = [500, 500]
        def acceptance(m):
            entry(m)["acceptance"]["peak_opaque_pct"] = [30, 10]
        for change in (duplicate, inherited_id, readiness, block_status, no_evidence, ramp, chunk, event, timing, pivot,
                       loop, cue, related, reuse, budget, acceptance):
            with self.subTest(change=change.__name__):
                data = design.read(design.CATALOG)
                change(data)
                with self.assertRaises(ValueError):
                    design.validate(data)
