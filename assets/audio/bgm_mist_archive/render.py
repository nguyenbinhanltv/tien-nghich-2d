"""Render bgm_mist_archive with the Studio audio engine (studio/audio, Node 24) from score.json. Loop, notes, tails and reverb wrap on the score period."""
import argparse
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    subprocess.run([shutil.which("node"), str(ROOT / "studio/audio/cli.mjs"), "render",
                    str(HERE / "score.json"), "--out", str(args.output)], check=True, cwd=ROOT, stdout=subprocess.DEVNULL)
