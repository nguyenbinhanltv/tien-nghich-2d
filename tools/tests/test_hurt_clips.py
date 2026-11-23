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


if __name__ == "__main__":
    unittest.main()
