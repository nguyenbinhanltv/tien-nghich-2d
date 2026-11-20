"""Pack processed sprites into deterministic, untrimmed texture atlases."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
GROUPS = ("characters", "tilesets", "weapons", "projectiles", "props", "vfx", "ui")
IMAGE_SUFFIXES = {".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".jpg", ".jpeg"}
MISSING = "missing: pixellab not generated"
ANIM_FRAME = re.compile(r"^(.+)/([^/]+)_([^/_]+)_(\d+)$")


@dataclass(frozen=True)
class Sprite:
    key: str
    pixels: Image.Image


@dataclass(frozen=True)
class Placement:
    sprite: Sprite
    x: int
    y: int


@dataclass(frozen=True)
class Profile:
    limit: int
    padding: int
    extrusion: int
    fixed_size: bool = False

    @property
    def border(self):
        return self.padding + self.extrusion


PROFILES = {"web": Profile(2048, 0, 0, True), "mobile": Profile(1024, 2, 1)}


def read_sprites(source):
    sprites = {}
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        key = path.relative_to(source).with_suffix("").as_posix()
        if key in sprites:
            raise ValueError(f"Duplicate frame key {key!r}: {path}")
        with Image.open(path) as image:
            if getattr(image, "n_frames", 1) != 1:
                raise ValueError(f"Expected a single frame in {path}")
            sprites[key] = Sprite(key, image.convert("RGBA"))
    return sprites


def pack(sprites, profile):
    """First-fit decreasing-height shelves, including reserved borders."""
    ordered = sorted(sprites.values(), key=lambda s: (-s.pixels.height, -s.pixels.width, s.key))
    pages = []
    border = profile.border
    for sprite in ordered:
        width = sprite.pixels.width + 2 * border
        height = sprite.pixels.height + 2 * border
        if max(width, height) > profile.limit:
            raise ValueError(f"{sprite.key} needs {width}x{height}, exceeding {profile.limit}")
        for shelves, placements in pages:
            for shelf in shelves:
                x, y, shelf_height = shelf
                if height <= shelf_height and x + width <= profile.limit:
                    placements.append(Placement(sprite, x + border, y + border))
                    shelf[0] += width
                    break
            else:
                y = shelves[-1][1] + shelves[-1][2]
                if y + height > profile.limit:
                    continue
                shelves.append([width, y, height])
                placements.append(Placement(sprite, border, y + border))
            break
        else:
            pages.append(([[width, 0, height]], [Placement(sprite, border, border)]))
    return [placements for _, placements in pages]


def pot(n):
    return 1 << (n - 1).bit_length()


def page_size(placements, profile):
    if profile.fixed_size:
        return profile.limit, profile.limit
    width = max(p.x + p.sprite.pixels.width for p in placements) + profile.border
    height = max(p.y + p.sprite.pixels.height for p in placements) + profile.border
    return pot(width), pot(height)


def frame_record(placement):
    width, height = placement.sprite.pixels.size
    return {
        "frame": {"x": placement.x, "y": placement.y, "w": width, "h": height},
        "rotated": False,
        "trimmed": False,
        "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
        "sourceSize": {"w": width, "h": height},
    }


def draw(placements, size, extrusion):
    page = Image.new("RGBA", size)
    for placement in placements:
        x, y = placement.x, placement.y
        sprite = placement.sprite.pixels
        width, height = sprite.size
        page.paste(sprite, (x, y))
        if extrusion:
            for left, right, dx in ((0, 1, -1), (width - 1, width, width)):
                page.paste(sprite.crop((left, 0, right, height)), (x + dx, y))
                page.putpixel((x + dx, y - 1), sprite.getpixel((left, 0)))
                page.putpixel((x + dx, y + height), sprite.getpixel((left, height - 1)))
            page.paste(sprite.crop((0, 0, width, 1)), (x, y - 1))
            page.paste(sprite.crop((0, height - 1, width, height)), (x, y + height))
    return page


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_page(image, frames, sprites, profile, seen):
    width, height = image.size
    if any(n < 1 or n > profile.limit or n & (n - 1) for n in image.size):
        raise ValueError(f"Invalid POT page size {image.size}")
    if profile.fixed_size and image.size != (profile.limit, profile.limit):
        raise ValueError(f"Invalid fixed page size {image.size}")
    occupancy = Image.new("1", image.size)
    placements = []
    for key, record in frames.items():
        if key in seen or key not in sprites:
            raise ValueError(f"Duplicate or unknown frame: {key}")
        seen.add(key)
        x, y, w, h = (record["frame"][field] for field in ("x", "y", "w", "h"))
        placement = Placement(sprites[key], x, y)
        if frame_record(placement) != record or min(w, h) < 1:
            raise ValueError(f"Incorrect frame metadata: {key}")
        border = profile.border
        box = x - border, y - border, x + w + border, y + h + border
        if box[0] < 0 or box[1] < 0 or box[2] > width or box[3] > height:
            raise ValueError(f"Frame or border outside page: {key}")
        if occupancy.crop(box).getbbox():
            raise ValueError(f"Overlapping frames or reserved padding: {key}")
        occupancy.paste(1, box)
        placements.append(placement)
    if image.convert("RGBA").tobytes() != draw(placements, image.size, profile.extrusion).tobytes():
        raise ValueError("Atlas pixels differ from source frames, extrusion or blank padding")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique_object)


def check_profile(directory, sprites, profile, web):
    seen = set()
    pages = sorted(directory.glob("atlas-*.png"))
    expected_names = {f"atlas-{index}.png" for index in range(len(pages))}
    if {page.name for page in pages} != expected_names:
        raise ValueError(f"Nonconsecutive page names in {directory}")
    for path in pages:
        data = read_json(path.with_suffix(".json"))
        with Image.open(path) as image:
            validate_page(image, data["frames"], sprites, profile, seen)
            if data["meta"]["image"] != path.name or data["meta"]["size"] != dict(zip(("w", "h"), image.size)):
                raise ValueError(f"Incorrect page metadata: {path}")
            if web:
                array = read_json(path.with_suffix(".array.json"))
                expected = [{"filename": key, **record} for key, record in data["frames"].items()]
                if array != {"frames": expected, "meta": data["meta"]}:
                    raise ValueError(f"Array metadata differs from hash: {path}")
                with Image.open(path.with_suffix(".webp")) as fallback:
                    if fallback.size != image.size or fallback.convert("RGBA").tobytes() != image.tobytes():
                        raise ValueError(f"WebP fallback differs from PNG: {path}")
    if seen != sprites.keys():
        raise ValueError(f"Missing frames in {directory}: {', '.join(sorted(sprites.keys() - seen))}")


def write_profile(directory, pages, profile, web):
    directory.mkdir(parents=True, exist_ok=True)
    produced = set()
    for index, placements in enumerate(pages):
        stem = f"atlas-{index}"
        size = page_size(placements, profile)
        page = draw(placements, size, profile.extrusion)
        frames = {p.sprite.key: frame_record(p) for p in sorted(placements, key=lambda p: p.sprite.key)}
        meta = {"image": f"{stem}.png", "format": "RGBA8888", "size": dict(zip(("w", "h"), size)), "scale": "1"}
        page.save(directory / f"{stem}.png")
        write_json(directory / f"{stem}.json", {"frames": frames, "meta": meta})
        produced.update((f"{stem}.png", f"{stem}.json"))
        if web:
            page.save(directory / f"{stem}.webp", lossless=True, exact=True)
            write_json(directory / f"{stem}.array.json", {
                "frames": [{"filename": key, **record} for key, record in frames.items()],
                "meta": meta,
            })
            produced.update((f"{stem}.webp", f"{stem}.array.json"))
    for path in directory.iterdir():
        if re.fullmatch(r"atlas-\d+\.(?:png|webp|json|array\.json)", path.name) and path.name not in produced:
            path.unlink()


def group_keys(sprites):
    groups = {group: {} for group in GROUPS}
    for key in sorted(sprites):
        group, separator, relative_key = key.partition("/")
        if not separator:
            group, relative_key = "other", key
        groups.setdefault(group, {})[relative_key] = key
    return groups


def animation_metadata(manifest):
    """Index manifest animation records by character ID and animation name."""
    metadata = {}

    def visit(node, identity=None):
        if isinstance(node, list):
            for item in node:
                visit(item, identity)
        elif isinstance(node, dict):
            identity = node.get("asset_id", node.get("id", identity))
            animations = node.get("animations")
            if identity and isinstance(animations, dict):
                for name, definition in animations.items():
                    if isinstance(definition, dict):
                        metadata[(identity, name)] = definition
            elif identity and isinstance(animations, list):
                for definition in animations:
                    if isinstance(definition, dict):
                        name = definition.get("name", definition.get("id", definition.get("anim")))
                        if name:
                            metadata[(identity, name)] = definition
            for name, value in node.items():
                if name != "animations" and isinstance(value, (list, dict)):
                    visit(value, name if isinstance(value, dict) else identity)

    visit(manifest)
    return metadata


def animation_definitions(character_keys, manifest):
    directions = {}
    metadata = animation_metadata(manifest)
    for relative, key in character_keys.items():
        match = ANIM_FRAME.fullmatch(relative)
        if match:
            asset, anim, direction, index = match.groups()
            directions.setdefault((asset, anim, direction), {})[int(index)] = key
    result = {}
    for (asset, anim, direction), frames in sorted(directions.items()):
        definition = metadata.get((asset, anim), metadata.get((asset.rsplit("/", 1)[-1], anim), {}))
        rate = definition.get("frameRate", definition.get("frame_rate", definition.get("fps")))
        loop = definition.get("loop")
        sequence = definition.get("frames")
        if isinstance(sequence, dict):
            sequence = sequence.get(direction)
        if isinstance(sequence, list) and all(type(index) is int for index in sequence):
            if any(index not in frames for index in sequence):
                continue
            ordered = [frames[index] for index in sequence]
        elif isinstance(sequence, list) and all(isinstance(frame, str) for frame in sequence):
            available = set(frames.values())
            ordered = [frame if frame.startswith("characters/") else f"characters/{asset}/{frame}" for frame in sequence]
            if any(frame not in available for frame in ordered):
                continue
        elif type(sequence) is int:
            if set(frames) != set(range(sequence)):
                continue
            ordered = [frames[index] for index in range(sequence)]
        else:
            ordered = [frames[index] for index in sorted(frames)]
        result.setdefault(asset, {}).setdefault(anim, {})[direction] = {
            "frameRate": rate, "frames": ordered, "loop": loop,
        }
    return result


def typescript(sprites, manifest):
    groups = group_keys(sprites)
    biome_tiles = {}
    for relative, key in groups["tilesets"].items():
        biome, separator, tile = relative.partition("/")
        if separator:
            biome_tiles.setdefault(biome, {})[tile] = key
    status = {
        group: ("ready" if keys else MISSING if group == "characters" else "missing: no processed assets")
        for group, keys in groups.items()
    }
    exports = {
        "AssetKeys": groups,
        "AssetStatus": status,
        "BiomeTiles": biome_tiles,
        "CharacterAnimations": animation_definitions(groups["characters"], manifest),
    }
    lines = ["// Generated by tools/scripts/pack_atlases.py."]
    for name, value in exports.items():
        lines.append(f"export const {name} = {json.dumps(value, ensure_ascii=True, indent=2)} as const;")
    lines.extend([
        "export type AssetGroup = keyof typeof AssetKeys;",
        "export type AssetKeyFor<G extends AssetGroup> = {",
        "  [K in G]: (typeof AssetKeys)[K][keyof (typeof AssetKeys)[K]]",
        "}[G];",
        "export type AssetKey = AssetKeyFor<AssetGroup>;",
        "export type BiomeId = keyof typeof BiomeTiles;",
        "export type BiomeTileId<B extends BiomeId> = keyof (typeof BiomeTiles)[B];",
        "export type AnimatedCharacterId = keyof typeof CharacterAnimations;",
        "export type CharacterAnimationId<C extends AnimatedCharacterId> = keyof (typeof CharacterAnimations)[C];",
        "",
    ])
    return "\n\n".join(lines[:5]) + "\n\n" + "\n".join(lines[5:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "assets/processed")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/atlases")
    parser.add_argument("--manifest", type=Path, default=ROOT / "assets/manifest.json")
    parser.add_argument("--check", action="store_true", help="Validate existing outputs without writing")
    args = parser.parse_args()
    if args.source.resolve() != (ROOT / "assets/processed").resolve() and args.output.resolve() == (ROOT / "assets/atlases").resolve():
        parser.error("An alternate source requires an alternate --output directory")
    try:
        sprites = read_sprites(args.source)
        manifest = read_json(args.manifest) if args.manifest.is_file() else {}
        keys = typescript(sprites, manifest)
        for group, frames in group_keys(sprites).items():
            if not frames:
                print(f"{group}: {MISSING if group == 'characters' else 'missing: no processed assets'}")
        if not args.check:
            layouts = {name: pack(sprites, profile) for name, profile in PROFILES.items()}
            for name, profile in PROFILES.items():
                write_profile(args.output / name, layouts[name], profile, name == "web")
            (args.output / "AssetKeys.ts").write_text(keys, encoding="utf-8", newline="\n")
        for name, profile in PROFILES.items():
            check_profile(args.output / name, sprites, profile, name == "web")
        if (args.output / "AssetKeys.ts").read_text(encoding="utf-8") != keys:
            raise ValueError("AssetKeys.ts differs from source frames or manifest")
        print(f"Validated {len(sprites)} frames on both profiles")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Atlas error: {error}\n")


if __name__ == "__main__":
    sys.exit(main())
