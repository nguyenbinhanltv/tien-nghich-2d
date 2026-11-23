import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class HurtClips(unittest.TestCase):
    def test_files_match_build(self):
        r = subprocess.run([sys.executable, "-I", str(ROOT / "tools/scripts/build_hurt_clips.py"), "--check"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("120 hurt frames match", r.stdout)


if __name__ == "__main__":
    unittest.main()
