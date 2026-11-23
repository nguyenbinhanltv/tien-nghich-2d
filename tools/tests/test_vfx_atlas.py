"""Phase 2 VFX integration regressions. Run with python tools/tests/test_vfx_atlas.py (needs Pillow)."""
import json
import re
import sys
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/scripts"))
import pack_atlases as pack

VFX = ROOT / "assets/processed/vfx"
CATALOG = json.loads((VFX / "vfx_index.json").read_text(encoding="utf-8"))["effects"]


def atlas_frames(profile):
    frames = {}
    for page in sorted((ROOT / "assets/atlases" / profile).glob("atlas-*.json")):
        if not re.fullmatch(r"atlas-\d+\.json", page.name):
            continue
        data = json.loads(page.read_text(encoding="utf-8"))
        with Image.open(page.parent / data["meta"]["image"]) as image:
            image = image.convert("RGBA")
            for key, record in data["frames"].items():
                if key in frames:
                    raise AssertionError(f"duplicate {profile} key {key}")
                f = record["frame"]
                frames[key] = image.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])).tobytes()
    return frames


class VfxAtlasTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expected = {f"vfx/{e['id']}_{n}": e for e in CATALOG for n in range(e["frame_count"])}
        cls.atlas = {p: atlas_frames(p) for p in ("web", "mobile")}

    def test_exactly_466_frames_and_no_contact_sheets(self):
        self.assertEqual(len(CATALOG), 13)
        self.assertEqual(len(self.expected), 466)
        for profile, frames in self.atlas.items():
            vfx = {k for k in frames if k.startswith("vfx/")}
            self.assertEqual(vfx, set(self.expected), profile)
            self.assertFalse([k for k in frames if k.endswith("_sheet")], profile)

    def test_profiles_share_every_key_and_pixels(self):
        self.assertEqual(self.atlas["web"].keys(), self.atlas["mobile"].keys())
        self.assertEqual(self.atlas["web"], self.atlas["mobile"])

    def test_frames_match_processed_sources_with_binary_alpha(self):
        for key, entry in self.expected.items():
            with Image.open(VFX / (key.split("/")[1] + ".png")) as src:
                src = src.convert("RGBA")
            self.assertEqual(list(src.size), entry["frame_size"], key)
            self.assertEqual(self.atlas["web"][key], src.tobytes(), key)
            self.assertLessEqual(set(src.getchannel("A").tobytes()), {0, 255}, key)

    def test_five_ui_families_pack_exactly_26_native_frames(self):
        doc = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))
        sizes = {"ui_card_frame": (32, 40, 6), "ui_hud_bars": (64, 8, 3), "ui_minimap": (8, 8, 7),
                 "ui_form_portraits": (48, 48, 4), "ui_panel_cursor": (16, 16, 6)}
        expected = {}
        for asset in doc["assets"]:
            if asset["id"] in sizes:
                self.assertEqual(asset["readiness"], "packed")
                for clip, cfg in asset["animations"].items():
                    for n in range(cfg["frames"]):
                        expected[f"ui/{asset['id']}/{clip}_none_{n}"] = asset["id"]
        self.assertEqual(len(expected), 26)
        for profile, frames in self.atlas.items():
            for key, owner in expected.items():
                w, h, _ = sizes[owner]
                path = ROOT / "assets/processed/ui" / owner / (key.rsplit("/", 1)[1] + ".png")
                with Image.open(path) as src:
                    src = src.convert("RGBA")
                self.assertEqual(src.size, (w, h), key)
                self.assertEqual(frames[key], src.tobytes(), (profile, key))
                self.assertLessEqual(set(src.getchannel("A").tobytes()), {0, 255}, key)

    def test_timing_comes_from_descriptor_durations(self):
        for entry in CATALOG:
            desc = json.loads((ROOT / entry["descriptor"]).read_text(encoding="utf-8"))
            ms = [f["duration_ms"] for f in desc["frames"]]
            self.assertEqual(len(ms), entry["frame_count"])
            self.assertEqual(sum(ms), entry["total_ms"], entry["id"])

    def test_asset_keys_expose_exactly_the_vfx_frames(self):
        text = (ROOT / "assets/atlases/AssetKeys.ts").read_text(encoding="utf-8")
        listed = set(re.findall(r'"(vfx/[a-z0-9_]+_\d+)"', text))
        self.assertEqual(listed, set(self.expected))

    def test_packing_is_deterministic_and_contract_is_enforced(self):
        sprites = pack.read_sprites(ROOT / "assets/processed")
        self.assertEqual(pack.check_vfx_contract(sprites, ROOT / "assets/processed"), 466)
        for profile in pack.PROFILES.values():
            layout = lambda: [[(p.sprite.key, p.x, p.y) for p in page] for page in pack.pack(sprites, profile)]
            self.assertEqual(layout(), layout())
        missing = {k: v for k, v in sprites.items() if k != "vfx/hit_spark_0"}
        with self.assertRaisesRegex(ValueError, "VFX frames differ"):
            pack.check_vfx_contract(missing, ROOT / "assets/processed")


if __name__ == "__main__":
    unittest.main()
