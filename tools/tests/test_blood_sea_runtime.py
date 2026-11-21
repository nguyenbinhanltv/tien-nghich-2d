"""Assembly failures a valid-looking atlas rectangle alone cannot detect."""
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/scripts"))
from build_blood_sea import grade_banner, validate_runtime


class ReactionMaterialTests(unittest.TestCase):
    def test_banner_grade_tracks_opaque_violet_samples_inside_measured_box(self):
        source = Image.new("RGBA", (6, 1))
        source.putdata([
            (120, 60, 108, 255), (120, 60, 108, 255), (130, 34, 30, 255),
            (120, 60, 108, 100), (220, 165, 205, 255), (120, 60, 108, 255),
        ])
        cloth, detail = (106, 63, 168), (185, 154, 235)
        patch = grade_banner(source, (1, 0, 5, 1), source.size, (3, 0), (3, 0), 1,
                             [(201, detail), (58, cloth)], 128)
        empty = (0, 0, 0, 0)
        self.assertEqual(list(patch.get_flattened_data()),
                         [empty, (*cloth, 255), empty, empty, (*detail, 255), empty])


class CourtAssemblyTests(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.web = Path(work.name) / "web"
        shutil.copytree(ROOT / "assets/encounter/blood-sea/web", self.web)

    def test_wrong_direction_alias(self):
        path = self.web / "wl_blood_foundation.json"
        atlas = json.loads(path.read_text())
        prefix = "characters/wl_blood_foundation/"
        atlas["frames"][prefix + "cast_attack_north_2"] = atlas["frames"][prefix + "impact_east_0"]
        path.write_text(json.dumps(atlas), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Incorrect clip alias: .*cast_attack_north_2"):
            validate_runtime(self.web)

    def test_blank_companion_pose(self):
        path = self.web / "wl-reactions.png"
        with Image.open(path) as original:
            image = original.copy()
        image.paste((0, 0, 0, 0), (0, 0, 32, 32))
        image.save(path)
        with self.assertRaisesRegex(ValueError, "Transparent atlas frame: .*push_south"):
            validate_runtime(self.web)

    def test_missing_native_impact_frame(self):
        path = self.web / "effects.json"
        atlas = json.loads(path.read_text())
        del atlas["frames"]["vfx/court_wail_mask_3"]
        path.write_text(json.dumps(atlas), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Missing effect frame .*wail_mask_3"):
            validate_runtime(self.web)

    def test_stale_combat_timing(self):
        path = self.web / "timing.mjs"
        path.write_text(path.read_text().replace('"strikeWindup": 0.15', '"strikeWindup": 0.2'))
        with self.assertRaisesRegex(ValueError, "Runtime timing module"):
            validate_runtime(self.web)
