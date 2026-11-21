"""Regression checks for the planning budget, evidenced coverage and pilot brief."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_audio_plan import ROOT, read, validate


class AudioPlanTests(unittest.TestCase):
    def setUp(self):
        self.plan = read("audio_manifest.json")

    def test_design_and_manifest_agree_on_pilot(self):
        validate(self.plan)
        doc = (ROOT / "docs/AUDIO_DESIGN.md").read_text(encoding="utf-8")
        brief = doc.split("### Wave 1 listening brief")[1].split("## Musical")[0]
        self.assertIn(self.plan["pilot"]["music"], brief)
        self.assertEqual(re.findall(r"^\| `(sfx_\w+)`", brief, re.MULTILINE),
                         list(self.plan["pilot"]["effects"].values()))

    def test_wrong_pilot_with_same_count(self):
        self.plan["pilot"]["effects"]["dash"] = "sfx_step"
        with self.assertRaisesRegex(ValueError, "pilot"):
            validate(self.plan)

    def test_duplicate_budget_slot(self):
        self.plan["extensions"]["modes"]["bgm"][0] = "bgm_endless"
        with self.assertRaisesRegex(ValueError, "duplicate"):
            validate(self.plan)

    def test_missing_character(self):
        self.plan["asset_groups"]["pet"].pop()
        with self.assertRaisesRegex(ValueError, "asset"):
            validate(self.plan)

    def test_invalid_fusion_parents(self):
        self.plan["fusions"]["lt_reed_verdict"]["parents"].reverse()
        with self.assertRaisesRegex(ValueError, "lt_reed_verdict"):
            validate(self.plan)

    def test_unknown_cue(self):
        self.plan["families"]["pet"]["reply"] = "sfx_missing"
        with self.assertRaisesRegex(ValueError, "unresolved"):
            validate(self.plan)


if __name__ == "__main__":
    unittest.main()
