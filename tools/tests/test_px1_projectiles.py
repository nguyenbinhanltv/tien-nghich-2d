import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/generators"))

import gen_px1_mob_projectiles as gen  # noqa: E402


class Px1ProjectilePalette(unittest.TestCase):
    def test_manifest_palette_refs_are_the_painted_colours(self):
        manifest = {a["id"]: a for a in json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))["assets"]}
        refs = gen.palette_refs(gen.render())
        self.assertEqual(set(refs), set(gen.IDS))
        for pid, painted in refs.items():
            self.assertEqual(manifest[pid]["palette_refs"], painted, pid)


if __name__ == "__main__":
    unittest.main()


class Px1StatusIconPalette(unittest.TestCase):
    def test_manifest_palette_refs_are_the_painted_colours(self):
        import gen_px1_status_icons as icons
        manifest = {a["id"]: a for a in json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))["assets"]}
        refs = icons.palette_refs(icons.render())
        self.assertEqual(set(refs), set(icons.IDS))
        for pid, painted in refs.items():
            self.assertEqual(manifest[pid]["palette_refs"], painted, pid)
