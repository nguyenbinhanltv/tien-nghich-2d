"""studio_primitives: deterministic, palette-locked, outlined, binary-alpha primitive sprites."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools/generators/studio_primitives.py"
PALETTE = ROOT / "tools/generators/palette.json"
DATA = json.loads(PALETTE.read_text(encoding="utf-8"))
ALLOWED = {tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in DATA["colors"]}
OUTLINE = tuple(int(DATA["outline"][i:i + 2], 16) for i in (1, 3, 5))


def run(out, *extra, shape="diamond", size="16", seed="3"):
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT), "--out", str(out), "--palette", str(PALETTE), "--shape", shape, "--size", size,
         "--fill", "jade_03", "--accent", "bronze_04", "--seed", seed, *extra],
        capture_output=True, text=True)


class StudioPrimitives(unittest.TestCase):
    def test_every_shape_is_nonempty_palette_only_binary_alpha_and_outlined(self):
        for shape in ("diamond", "disc", "ring", "cross", "star", "drop", "shard"):
            with self.subTest(shape=shape), tempfile.TemporaryDirectory() as d:
                self.assertEqual(run(d, shape=shape, size="24").returncode, 0)
                img = Image.open(Path(d) / "glyph_none_0.png").convert("RGBA")
                px = img.load()
                opaque = [(x, y) for y in range(img.height) for x in range(img.width) if px[x, y][3]]
                self.assertTrue(opaque, "empty sprite")
                for x, y in opaque:
                    self.assertEqual(px[x, y][3], 255)
                    self.assertIn(px[x, y][:3], ALLOWED)
                    edge = any(not (0 <= nx < img.width and 0 <= ny < img.height) or not px[nx, ny][3]
                               for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
                    if edge:
                        self.assertEqual(px[x, y][:3], OUTLINE, f"edge pixel {x},{y} is not the outline colour")
                for y in range(img.height):
                    for x in range(img.width):
                        if not px[x, y][3]:
                            self.assertEqual(px[x, y][:3], (0, 0, 0), "colour under alpha 0")

    def test_same_arguments_same_bytes_and_a_seed_changes_the_speckle(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b, tempfile.TemporaryDirectory() as c:
            run(a, "--frames", "4"); run(b, "--frames", "4"); run(c, "--frames", "4", seed="99")
            names = sorted(p.name for p in Path(a).iterdir())
            self.assertEqual(names, [f"glyph_none_{i}.png" for i in range(4)])
            self.assertEqual([(Path(a) / n).read_bytes() for n in names], [(Path(b) / n).read_bytes() for n in names])
            self.assertNotEqual([(Path(a) / n).read_bytes() for n in names], [(Path(c) / n).read_bytes() for n in names])

    def test_clip_and_direction_name_the_files_and_frames_pulse(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(run(d, "--clip", "flight", "--direction", "east", "--frames", "3").returncode, 0)
            sizes = [sum(1 for p in Image.open(Path(d) / f"flight_east_{i}.png").convert("RGBA").getdata() if p[3]) for i in range(3)]
            self.assertGreater(len(set(sizes)), 1, "frames should pulse")

    def test_bad_arguments_fail_loudly_and_write_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, "-I", str(SCRIPT), "--out", d, "--palette", str(PALETTE), "--shape", "disc", "--size", "16",
                                "--fill", "no_such_99", "--accent", "bronze_04"], capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("not in the palette", r.stderr)
            self.assertEqual(list(Path(d).iterdir()), [])
            self.assertNotEqual(run(d, size="4").returncode, 0)
            self.assertNotEqual(run(d, "--frames", "99").returncode, 0)


if __name__ == "__main__":
    unittest.main()
