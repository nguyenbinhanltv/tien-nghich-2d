"""Restore approved native mob frames from the pinned release archives."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "assets/mob-releases.json"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def frame_set_digest(files):
    entries = [f"{name} {digest(data)}\n" for name, data in sorted(files.items()) if name.endswith(".png")]
    return digest("".join(entries).encode("ascii"))


def collect(directory, assets, releases):
    """Verify the complete selection before writing any processed files."""
    outputs = {}
    for name, release in releases.items():
        archive = directory / name
        with archive.open("rb") as handle:
            if digest(handle.read()) != release["sha256"]:
                raise ValueError(f"Archive digest mismatch: {name}")
            with ZipFile(handle) as bundle:
                prefix = archive.stem + "/"
                assembly = json.loads(bundle.read(prefix + "assembly.json"))
                canvas = assembly.get("canvas", assembly.get("canvas_px"))
                if canvas != [32, 32]:
                    raise ValueError(f"Unexpected native canvas in {name}: {canvas}")
                if set(assembly["assets"]) != set(release["mobs"]):
                    raise ValueError(f"Unexpected mob inventory: {name}")
                for mob, source in assembly["assets"].items():
                    asset = assets[mob]
                    anchor = source["anchor_px"]
                    width, height = asset["size"]
                    clips = source["clips"]
                    if set(clips) != set(asset["animations"]):
                        raise ValueError(f"Clip mismatch: {mob}")
                    frames = {}
                    for anim, clip in clips.items():
                        contract = asset["animations"][anim]
                        if clip["loop"] != contract["loop"] or set(clip["directions"]) != set(asset["directions"]):
                            raise ValueError(f"Clip contract mismatch: {mob}/{anim}")
                        for facing, sequence in clip["directions"].items():
                            if len(sequence) != contract["frames"]:
                                raise ValueError(f"Frame count mismatch: {mob}/{anim}/{facing}")
                            for index, frame in enumerate(sequence):
                                filename = f"{anim}_{facing}_{index}.png"
                                pixels = bundle.read(prefix + frame["path"])
                                if Path(frame["path"]).name != filename or digest(pixels) != frame["sha256"]:
                                    raise ValueError(f"Frame mismatch: {mob}/{filename}")
                                frames[filename] = pixels
                    info = {
                        "canvas": [width, height], "frames": len(frames), "anchor_px": anchor,
                        "origin": [anchor[0] / width, (anchor[1] + 1) / height],
                        "release": name,
                        "facings": {
                            facing: {"source": source_dir, "flip_x": flip,
                                     "anchor_px": [width - 1 - anchor[0], anchor[1]] if flip else anchor}
                            for facing, source_dir, flip in (
                                ("south", "south", False), ("east", "east", False),
                                ("north", "south", False), ("west", "east", True))
                        },
                    }
                    if mob == "mob_rune_sentinel":
                        cast = json.loads(bundle.read(prefix + "ground-and-cast-check.json"))
                        info["suggested_attack_ms"] = cast["suggested_attack_ms"]
                        info["attack_release_index"] = cast["attack_release_index"]
                    frames["anchor.json"] = (json.dumps(info, indent=1) + "\n").encode()
                    if frame_set_digest(frames) != release["mobs"][mob]:
                        raise ValueError(f"Frame set digest mismatch: {mob}")
                    outputs[mob] = frames
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", type=Path)
    parser.add_argument("--biome")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    assets = {a["id"]: a for a in json.loads((ROOT / "assets/manifest.json").read_bytes())["assets"]}
    releases = json.loads(LOCK.read_bytes())
    if args.biome:
        releases = {k: v for k, v in releases.items() if assets[next(iter(v["mobs"]))]["biome"] == args.biome}
        if not releases:
            parser.error("unknown mob biome")
    outputs = collect(args.archives, assets, releases)
    for mob, files in outputs.items():
        folder = ROOT / "assets/processed/mobs" / mob
        extra = {p.name for p in folder.glob("*.png")} - files.keys()
        if extra:
            raise ValueError(f"Unexpected frames in {folder}: {sorted(extra)}")
    for mob, files in outputs.items():
        folder = ROOT / "assets/processed/mobs" / mob
        if not args.check:
            folder.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            path = folder / name
            if args.check:
                actual = path.read_bytes()
                if name == "anchor.json":
                    actual = actual.replace(b"\r\n", b"\n")
                if actual != data:
                    raise ValueError(f"Processed release mismatch: {path}")
            else:
                path.write_bytes(data)
    print(f"Verified {len(outputs)} mobs, {sum(len(files)-1 for files in outputs.values())} frames")


if __name__ == "__main__":
    main()
