"""Verify generated item PNGs, manifest coverage and optional rerun hashes."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from PIL import ImageColor

from gen_items_weapons import GROUPS, OUTPUT, ROOT, verify_frame

LOG = "gen_items_weapons_log.json"


def verify(output, compare):
    palette_data = json.loads(
        Path(__file__).with_name("palette.json").read_text(encoding="utf-8-sig")
    )
    palette = {item["id"]: ImageColor.getrgb(item["hex"]) for item in palette_data["colors"]}
    manifest = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8-sig"))
    expected = {}
    for entry in manifest["assets"]:
        target = Path(entry["output_path"])
        if entry["assigned_agent"] != "codex_antigravity" or not target.is_relative_to(OUTPUT):
            continue
        target = target.relative_to(OUTPUT)
        if not target.parts or target.parts[0] not in GROUPS:
            continue
        for animation, spec in entry["animations"].items():
            for frame in range(spec["frames"]):
                file = target / f"{animation}_{frame:02d}.png"
                expected[file.as_posix()] = {
                    "id": entry["id"], "name": entry["name"], "dims": entry["size"],
                    "animation": animation, "frame": frame,
                    "frames": spec["frames"], "loop": spec["loop"],
                }

    log = (output / LOG).read_bytes()
    rows = json.loads(log)["files"]
    counts = Counter()
    if compare is not None and (compare / LOG).read_bytes() != log:
        raise ValueError("Rerun log differs")
    for row in rows:
        file = row["file"]
        metadata = {key: value for key, value in row.items() if key not in {"file", "sha256"}}
        if expected.pop(file, None) != metadata:
            raise ValueError(f"Unexpected or incorrect manifest metadata: {file}")
        verify_frame(output / file, row["dims"], palette)
        for directory in (output,) if compare is None else (output, compare):
            if hashlib.sha256((directory / file).read_bytes()).hexdigest() != row["sha256"]:
                raise ValueError(f"SHA-256 mismatch: {directory / file}")
        counts[Path(file).parts[0]] += 1
    if expected:
        raise ValueError(f"Missing frames: {', '.join(sorted(expected))}")
    print(f"Verified {sum(counts.values())} PNGs ({dict(sorted(counts.items()))}).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / OUTPUT)
    parser.add_argument("--compare", type=Path, help="Compare PNG hashes and log with a second run.")
    args = parser.parse_args()
    verify(args.out, args.compare)
