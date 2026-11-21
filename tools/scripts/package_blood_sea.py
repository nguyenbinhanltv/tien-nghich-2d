"""Package the committed court, inspector and reproducible art inputs for offline use."""
import argparse
from pathlib import Path
from subprocess import check_output, run
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
CONTENTS = [
    "studio", "studio.project.json", "assets/manifest.json", "assets/atlases/web", "assets/processed",
    "assets/raw/environment_items", "assets/raw/characters", "assets/_fixtures",
    "assets/encounter/blood-sea", "tools/generators/palette.json",
    "tools/scripts/build_blood_sea.py", "tools/scripts/blood_sea_effects.py",
    "tools/tests/test_blood_sea_runtime.py",
]
GUIDE = """The Drowned Court

Extract the full archive. In the extracted folder, start the local preview with

    node studio/serve.mjs --port 4173

Python 3 can also serve the same files with

    python studio/serve.py --port 4173

Play at http://127.0.0.1:4173/studio/blood-sea/index.html
Inspect poses at http://127.0.0.1:4173/studio/index.html?tab=inspector&collection=court
Open the west-facing Ghost King wail paused on frame 3 at
http://127.0.0.1:4173/studio/index.html?tab=inspector&collection=court&actor=boss_ghost_king&clip=soul_wail&facing=west&frame=3
Use Ctrl+C in the terminal to close the preview.

Use WASD or the arrows to move, J to strike, Space to dodge and P to pause.
On phones, slide one thumb across the arrows to steer while the other strikes.
The center stops movement. Enable Sound in the court to hear the gold
timing cue. Clear the court to see fight time, personal best, hits and counters.
Select Watch best to replay the recorded inputs from your fastest clear.

All court art, source prompts, measured anchors and clip timing are under
assets/encounter/blood-sea/. To verify the native exports with Pillow 13.0.0,
run python tools/scripts/build_blood_sea.py --check. Simulation and inspector
tests run with node --test studio/blood-sea/encounter.test.mjs.

Local source revision {revision}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Destination .zip file")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.suffix.lower() != ".zip":
        parser.error("choose a .zip destination")
    revision = check_output(["git", "rev-parse", "--verify", "HEAD"], cwd=ROOT, text=True).strip()
    with TemporaryDirectory(dir=output.parent) as scratch:
        archive = Path(scratch) / "court.zip"
        guide = "--add-virtual-file=START-HERE.txt:" + GUIDE.format(revision=revision)
        run(["git", "archive", "--format=zip", f"--output={archive}", guide, revision, *CONTENTS],
            cwd=ROOT, check=True)
        archive.replace(output)
    print(f"Packaged {revision[:12]} in {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
