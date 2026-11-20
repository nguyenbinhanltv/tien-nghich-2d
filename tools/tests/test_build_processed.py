"""Run: python -I tools/tests/test_build_processed.py   (stdlib unittest + numpy + Pillow; synthetic raw in a temp dir)"""
import hashlib
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_processed", ROOT / "tools/scripts/build_processed.py")
bp = importlib.util.module_from_spec(spec)
sys.modules["build_processed"] = bp
spec.loader.exec_module(bp)


def tree_hash(p: Path):
    return {f.relative_to(p).as_posix(): hashlib.sha1(f.read_bytes()).hexdigest() for f in sorted(p.rglob("*")) if f.is_file()}


def make_raw(tmp: Path):
    """One weapon frame with off-palette colour + partial alpha, one 44px PixelLab-style character frame."""
    w = np.zeros((24, 24, 4), np.uint8)
    w[8:16, 8:16] = (250, 120, 10, 255)          # off palette
    w[8, 8] = (250, 120, 10, 100)                # partial alpha
    w[0, 0, :3] = (9, 9, 9)                      # dirty transparent
    d = tmp / "env/weapons/wp_heaven_defying_bead"
    d.mkdir(parents=True)
    Image.fromarray(w, "RGBA").save(d / "idle_00.png")
    c = np.zeros((44, 44, 4), np.uint8)
    c[10:40, 14:30] = (2, 1, 5, 255)             # PixelLab outline colour, 16x30 body
    c[11:39, 15:29] = (110, 104, 119, 255)
    for dr in ("south", "east"):
        for n in range(4):
            d = tmp / f"chars/mobs/mob_rogue_disciple/idle/{dr}"
            d.mkdir(parents=True, exist_ok=True)
            Image.fromarray(c, "RGBA").save(d / f"frame_{n:03d}.png")


class BuildTests(unittest.TestCase):
    def run_build(self, tmp, out):
        args = bp.argparse.Namespace(manifest=str(ROOT / "assets/manifest.json"), palette=str(ROOT / "tools/generators/palette.json"),
                                     env_src=str(tmp / "env"), char_src=str(tmp / "chars"), vfx_src=None, out=str(out),
                                     only=None, no_denoise=False, log=None)
        return bp.build(args)

    def test_pipeline(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            make_raw(tmp)
            out = tmp / "a/processed"
            rep = self.run_build(tmp, out)
            palette, outline = bp.qa.load_palette(ROOT / "tools/generators/palette.json")
            w = np.array(Image.open(out / "weapons/wp_heaven_defying_bead/idle_none_0.png"))
            self.assertTrue(set(np.unique(w[..., 3])) <= {0, 255})
            self.assertEqual(int(w[0, 0, :3].sum()), 0)
            op = w[..., 3] == 255
            cols = {tuple(c) for c in w[op][:, :3].tolist()}
            self.assertTrue(cols <= {tuple(c) for c in palette.tolist()})
            ch = np.array(Image.open(out / "mobs/mob_rogue_disciple/idle_south_0.png"))
            self.assertEqual(ch.shape[:2], (32, 32))
            self.assertEqual(tuple(ch[ch[..., 3] == 255][0, :3]), bp.qa.hex_to_rgb("#14101a"))   # #020105 -> ink_01
            self.assertTrue((ch[31, :, 3] == 255).any())                                         # feet on last row
            self.assertEqual(rep["anchors"]["mob_rogue_disciple"]["scale"], 1.0)
            # idempotent: second run is byte-identical
            before = tree_hash(out)
            self.run_build(tmp, out)
            self.assertEqual(before, tree_hash(out))

    def test_downscale_keeps_palette(self):
        arr = np.zeros((40, 40, 4), np.uint8)
        arr[:, :, :3] = (110, 104, 119)
        arr[:, :, 3] = 255
        arr[::2, ::2, :3] = (20, 16, 26)
        out = bp.mode_downscale(arr, 32, 32, 40, 40, (20, 16, 26))
        self.assertEqual({tuple(c) for c in out[out[..., 3] == 255][:, :3].tolist()} - {(110, 104, 119), (20, 16, 26)}, set())


if __name__ == "__main__":
    unittest.main()
