"""Fault injection for the animation gate. Run with the project Python."""
from pathlib import Path
import runpy
import unittest

import numpy as np

BAKE = runpy.run_path(str(Path(__file__).with_name("bake.py")))
MARKER = BAKE["COLORS"]["soul_07"]
FUR = BAKE["COLORS"]["ink_03"]
RIG = {"left_ear_box": [10, 9, 13, 12]}


class AnimationGateTest(unittest.TestCase):
    def setUp(self):
        frame = np.zeros((32, 32, 4), dtype=np.uint8)
        frame[8:25, 8:24] = (*FUR, 255)
        frame[10, 11, :3] = MARKER
        self.frames = [BAKE["outline"](frame) for _ in range(4)]
        self.contacts = [[{"xy": [12, 24], "planted": True}] for _ in range(4)]

    def gate(self):
        return BAKE["animation_gate"](self.frames, self.contacts, RIG, MARKER)

    def test_stable_reference(self):
        self.assertTrue(self.gate()["pass"])

    def test_planted_paw_moves(self):
        self.contacts[1][0]["xy"] = [13, 24]
        self.assertIn([0, 0], self.gate()["planted_slide_transitions"])

    def test_planted_paw_disappears(self):
        self.frames[1][24, 12] = 0
        self.assertIn([1, 0], self.gate()["planted_missing_pixels"])

    def test_ear_mark_on_other_side(self):
        self.frames[2][10, 11, :3] = FUR
        self.frames[2][10, 21, :3] = MARKER
        self.assertEqual(self.gate()["wrong_or_missing_ear_frames"], [2])

    def test_silhouette_drifts(self):
        self.frames[1] = np.roll(self.frames[1], 3, axis=1)
        self.assertTrue(self.gate()["bbox_drift_flag"])

    def test_interior_flicker(self):
        self.frames[1][14:17, 14:18, :3] = BAKE["COLORS"]["ink_04"]
        self.assertTrue(self.gate()["interior_flicker_flag"])

    def test_loop_cut(self):
        for i, frame in enumerate(self.frames):
            frame[14:14+i, 12:20, :3] = BAKE["COLORS"]["ink_04"]
        self.assertTrue(self.gate()["loop_seam_flag"])


if __name__ == "__main__":
    unittest.main()
