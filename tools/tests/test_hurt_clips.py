import importlib.util
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_hurt_clips", ROOT / "tools/scripts/build_hurt_clips.py")
hurt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hurt)


class HurtClipTests(unittest.TestCase):
    def test_committed_frames_match_generator(self):
        for path, frame in hurt.build(ROOT).items():
            on_disk = np.array(Image.open(path).convert("RGBA"))
            self.assertTrue(np.array_equal(on_disk, frame), path.name)

    def test_alpha_binary_outline_kept_and_silhouette_preserved(self):
        outline, _, _ = hurt.palette()
        for path, frame in hurt.build(ROOT).items():
            self.assertTrue(set(np.unique(frame[:, :, 3])) <= {0, 255}, path)
            self.assertEqual(int((frame[:, :, 3] > 0).sum()),
                             int((np.array(Image.open(path.with_name(f"idle_{path.stem.split('_')[1]}_0.png").as_posix()).convert("RGBA"))[:, :, 3] > 0).sum()), path)
            self.assertTrue((frame[frame[:, :, 3] == 0] == 0).all(), path)
            opaque = frame[frame[:, :, 3] > 0][:, :3]
            self.assertIn(tuple(int(outline[i:i + 2], 16) for i in (1, 3, 5)), {tuple(p) for p in opaque}, path)

    def test_flash_stays_in_the_source_ramp_and_never_goes_down(self):
        outline, ramps, lookup = hurt.palette()
        for path, frame in hurt.build(ROOT).items():
            facing, n = path.stem.split("_")[1:]
            source = np.array(Image.open(path.with_name(f"idle_{facing}_0.png")).convert("RGBA"))
            if int(n) == 2:
                continue
            for y, x in zip(*np.nonzero(source[:, :, 3])):
                value = hurt.rgb_hex(source[y, x])
                if value == outline:
                    continue
                # the recoil moves pixels, so compare the multiset of ramp steps per ramp instead of positions
                self.assertIn(value, lookup, path)
            src = {}
            for y, x in zip(*np.nonzero(source[:, :, 3])):
                v = hurt.rgb_hex(source[y, x])
                if v != outline:
                    src.setdefault(lookup[v][0], []).append(lookup[v][1])
            out = {}
            for y, x in zip(*np.nonzero(frame[:, :, 3])):
                v = hurt.rgb_hex(frame[y, x])
                if v != outline:
                    out.setdefault(lookup[v][0], []).append(lookup[v][1])
            self.assertEqual(set(out), set(src), f"{path.name}: flash left its ramp")
            for ramp, steps in src.items():
                self.assertEqual(len(out[ramp]), len(steps), path.name)
                self.assertGreaterEqual(sum(out[ramp]), sum(steps), path.name)

    def test_thunder_ramps_are_split(self):
        _, ramps, lookup = hurt.palette()
        self.assertNotEqual(lookup["#8ae8ff"][0], lookup["#ff3b30"][0])
        self.assertEqual(lookup["#e8fdff"][0], lookup["#28a8dc"][0])


if __name__ == "__main__":
    unittest.main()
