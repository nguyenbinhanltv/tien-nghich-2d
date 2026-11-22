"""The Drowned Court package must contain the playable and run from the unpacked tree."""
import json
import re
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "tools/scripts/package_blood_sea.py"
sys.path.insert(0, str(REPO / "tools/scripts"))
import package_blood_sea as pkg  # noqa: E402


class PackageTest(unittest.TestCase):
    def test_every_contents_entry_exists_in_the_repo(self):
        for entry in pkg.CONTENTS:
            self.assertTrue((REPO / entry).exists(), entry)

    def test_guide_names_only_paths_that_exist(self):
        for path in re.findall(r"(?:node|python|node --test) ((?:studio|playables|tools)/[\w./-]*\w)", pkg.GUIDE):
            self.assertTrue((REPO / path).exists(), f"START-HERE names {path}")

    def test_package_has_the_playable_and_runs_from_the_unpacked_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "court.zip"
            subprocess.run([sys.executable, str(SCRIPT), str(out)], cwd=REPO, check=True, capture_output=True)
            unpacked = Path(tmp) / "court"
            with zipfile.ZipFile(out) as z:
                names = set(z.namelist())
                z.extractall(unpacked)
            for needed in ["START-HERE.txt", "playables/blood-sea/index.html", "playables/blood-sea/game.mjs", "playables/previewer.html",
                           "playables/serve.py", "playables/preview-index.mjs", "studio/serve.mjs", "studio.project.json"]:
                self.assertIn(needed, names)
            server = subprocess.Popen(["node", "studio/serve.mjs", "--port", "0"], cwd=unpacked, stdout=subprocess.PIPE, text=True)
            try:
                line = server.stdout.readline()
                port = re.search(r":(\d+)/studio/", line).group(1)
                for url in ["/studio/blood-sea/index.html", "/studio/blood-sea/game.mjs", "/studio/previewer.html", "/studio/?tab=inspector"]:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}{url}") as r:
                        self.assertEqual(r.status, 200, url)
            finally:
                server.terminate()
                server.wait(timeout=10)


if __name__ == "__main__":
    unittest.main()
