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
