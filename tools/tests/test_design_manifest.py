"""Phase 1 catalog regressions. Run with python -I tools/tests/test_design_manifest.py."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/scripts"))
import check_manifest as check


class DesignManifestTests(unittest.TestCase):
    def setUp(self):
        self.doc = check.read_json(ROOT / "assets/manifest.json")

    def validate(self):
        return check.validate_delivery(ROOT, self.doc)

    def test_declared_scope_and_actual_shipping_state(self):
        records = self.validate()
        planned = {i for i, (_, s) in records.items() if s["source"] == "absent"}
        self.assertEqual(planned, {"ui_card_frame", "ui_hud_bars", "ui_minimap",
                                   "ui_form_portraits", "ui_panel_cursor"})
        self.assertEqual(len(records), 102)
        self.assertEqual(sum(s["processed"] == "complete" for _, s in records.values()), 97)
        for profile in ("web", "mobile"):
            self.assertEqual(sum(s[profile] == "complete" for _, s in records.values()), 85)
        self.assertEqual(check.coverage({"frame0", "frame1"}, {"frame1"}), "partial")

    def test_cannot_label_unpacked_effects_as_delivered(self):
        self.doc["delivery"]["vfx_readiness"] = "packed"
        with self.assertRaisesRegex(ValueError, "differs from measured"):
            self.validate()

    def test_planned_ui_requires_every_component(self):
        ui = next(a for a in self.doc["assets"] if a["id"] == "ui_panel_cursor")
        ui["frame_roles"]["button"].pop()
        with self.assertRaisesRegex(ValueError, "UI components"):
            self.validate()

    def test_missing_catalog_link(self):
        self.doc["delivery"]["vfx_index"] = "assets/absent-index.json"
        with self.assertRaises(FileNotFoundError):
            self.validate()

    def test_ui_export_matches_existing_atlas_contract(self):
        self.doc["delivery"]["ui_export"]["atlas_key"] = "ui/{id}/{clip}_{n}"
        with self.assertRaisesRegex(ValueError, "UI export"):
            self.validate()

    def test_projectile_reverse_reference(self):
        projectile = next(a for a in self.doc["assets"] if a["category"] == "projectile")
        projectile["weapon_id"] = "missing_weapon"
        with self.assertRaisesRegex(ValueError, "weapon/projectile link"):
            self.validate()

    def test_duplicate_effect_even_when_count_is_twelve(self):
        index = ROOT / self.doc["delivery"]["vfx_index"]
        catalog = check.read_json(index)
        catalog["effects"][-1] = catalog["effects"][0]
        read = check.read_json
        with patch.object(check, "read_json", side_effect=lambda p: catalog if p == index else read(p)):
            with self.assertRaisesRegex(ValueError, "VFX IDs"):
                self.validate()

    def test_vfx_must_agree_with_source(self):
        index = check.read_json(ROOT / self.doc["delivery"]["vfx_index"])
        for field, value in (("fps", 12), ("frame_count", 1), ("tags", []), ("events", [["hit", 0]])):
            with self.subTest(field=field):
                entry = copy.deepcopy(index["effects"][0])
                entry[field] = value
                with self.assertRaises(ValueError):
                    check.validate_effect(ROOT, entry)


if __name__ == "__main__":
    unittest.main()
