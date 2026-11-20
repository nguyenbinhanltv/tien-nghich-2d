"""Generate manifest tilesets using Pillow and NumPy.

Run from any directory with Python 3, Pillow and NumPy installed.
--only selects a biome ID. --out replaces the common tileset output root.
--verify renders twice and checks output hashes, pixels, and blob seams.
"""

import argparse
import hashlib
import json
from pathlib import Path
import random
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path("assets/raw/environment_items/tilesets")
SIZE = 16
DIRECTIONS = {
    "N": (1, 0, -1), "NE": (2, 1, -1), "E": (4, 1, 0),
    "SE": (8, 1, 1), "S": (16, 0, 1), "SW": (32, -1, 1),
    "W": (64, -1, 0), "NW": (128, -1, -1),
}
DIAGONALS = ((2, 5), (8, 20), (32, 80), (128, 65))
MATERIALS = {
    "hengyue": {
        "floor_blob47": ("ink_03", "ink_02", "ink_04", "ink_05", "jade_02"),
        "floor_garden_blob47": ("jade_01", "ink_02", "jade_02", "jade_03", "jade_05"),
        "wall_top_blob47": ("ink_04", "ink_03", "ink_05", "ink_06", "jade_03"),
    },
    "blood_sea": {
        "floor_ravine_blob47": ("ink_03", "soul_01", "ink_04", "ink_05", "soul_03"),
        "floor_blood_blob47": ("blood_02", "blood_01", "blood_03", "blood_04", "ink_05"),
        "blood_pool_blob47": ("blood_03", "blood_02", "blood_04", "blood_05", "blood_06"),
        "wall_top_blob47": ("ink_04", "ink_02", "ink_05", "ink_06", "blood_03"),
    },
    "ancient_god": {
        "floor_blob47": ("ink_02", "soul_01", "ink_03", "ink_04", "bronze_03"),
        "void_crack_blob47": ("soul_01", "ink_02", "soul_02", "soul_03", "soul_06"),
        "wall_top_blob47": ("ink_03", "ink_02", "ink_04", "ink_05", "bronze_04"),
    },
}


def canonical(mask):
    for diagonal, sides in DIAGONALS:
        if mask & sides != sides:
            mask &= ~diagonal
    return mask


MASKS = sorted({canonical(mask) for mask in range(256)})


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8", newline="\n")


def seeded(*parts):
    return random.Random("/".join(map(str, parts)))


def erosion(neighbors, distance):
    """Sample the occupied neighborhood at the four corners of a square."""
    return np.logical_and.reduce([
        neighbors[SIZE + y:2 * SIZE + y, SIZE + x:2 * SIZE + x]
        for y in (-distance, distance) for x in (-distance, distance)
    ])


def tile_geometry(mask):
    neighborhood = np.zeros((3, 3), dtype=bool)
    neighborhood[1, 1] = True
    for bit, x, y in DIRECTIONS.values():
        neighborhood[1 + y, 1 + x] = bool(mask & bit)
    neighbors = neighborhood.repeat(SIZE, axis=0).repeat(SIZE, axis=1)
    return [erosion(neighbors, width) for width in (2, 3, 4)]


def material_texture(biome, sheet, variant, frame, colors):
    base, dark, middle, light, accent = colors
    tile = Image.new("RGBA", (SIZE, SIZE), base)
    draw = ImageDraw.Draw(tile)
    rng = seeded(biome, sheet, variant)
    if sheet == "blood_pool_blob47":
        for y in (4, 8, 12):
            x = rng.randint(3, 7)
            draw.line((x, y, x + 5, y), fill=middle)
            draw.line((x + 2, y + 1, x + 6, y + 1), fill=dark)
        for index, (x, y) in enumerate(((5, 5), (10, 10), (6, 12))):
            phase = (frame + index) % 4
            if phase == 0:
                draw.point((x, y), fill=light)
            elif phase == 1:
                draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=dark, outline=light)
                draw.point((x, y - 1), fill=accent)
            elif phase == 2:
                draw.line((x - 2, y, x + 2, y), fill=light)
            else:
                draw.point((x - 2, y), fill=middle)
                draw.point((x + 2, y), fill=middle)
    elif sheet == "void_crack_blob47":
        draw.line([(3, 7), (7, 8), (9, 6), (12, 7)], fill=middle)
        draw.line([(5, 12), (8, 11), (11, 12)], fill=dark)
        for index, (x, y) in enumerate(((5, 5), (10, 9), (7, 11), (11, 4))):
            phase = (index + frame) % 4
            draw.point((x, y), fill=(middle, light, accent, light)[phase])
            if phase == 2:
                draw.point((x - 1, y), fill=light)
                draw.point((x, y + 1), fill=light)
    else:
        if sheet in {"floor_blob47", "wall_top_blob47"}:
            middle_y = 7 + variant % 3
            draw.line((2, middle_y, 13, middle_y), fill=dark)
            draw.line((3, middle_y + 1, 12, middle_y + 1), fill=middle)
            split = 5 + rng.randrange(5)
            draw.line((split, 3, split, middle_y), fill=dark)
            draw.line((split + 1, 3, split + 1, middle_y - 1), fill=middle)
            draw.line((12 - split, middle_y + 1, 12 - split, 12), fill=dark)
        for _ in range(8):
            x, y = rng.randrange(3, 12), rng.randrange(3, 13)
            draw.line((x, y, x + rng.randrange(1, 4), y),
                      fill=rng.choice((base, dark, middle)))
        x, y = rng.randrange(5, 9), rng.randrange(5, 10)
        draw.line([(x - 2, y + 1), (x, y), (x + 2, y), (x + 3, y - 1)],
                  fill=accent)
        draw.point((x, y - 1), fill=light)
        if sheet == "floor_blood_blob47":
            draw.line((x - 1, y + 2, x + 2, y + 2), fill=accent)
            draw.point((x - 1, y + 1), fill=middle)
    return np.asarray(tile)


def blob_tile(geometry, texture, colors, outline):
    base, dark, middle, _, _ = colors
    body, inside, core = geometry
    tile = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)
    tile[body] = outline
    tile[inside] = middle
    tile[core] = base
    # The cross-tile edge strips depend only on the contour, never on noise.
    tile[2:-2, 2:-2][core[2:-2, 2:-2]] = texture[2:-2, 2:-2][core[2:-2, 2:-2]]
    tile[13, 2:-2][(inside & ~core)[13, 2:-2]] = dark
    return Image.fromarray(tile)


def outlined(tile, ink):
    pixels = np.asarray(tile).copy()
    solid = pixels[:, :, 3] == 255
    padded = np.pad(solid, 1)
    inside = np.logical_and.reduce([
        padded[y:y + tile.height, x:x + tile.width]
        for y in range(3) for x in range(3)
    ])
    pixels[solid & ~inside] = ink
    return Image.fromarray(pixels)


def outline_overlay(tile, ink):
    """Add an ink pixel around every mark, preserving thin colored strokes."""
    pixels = np.asarray(tile).copy()
    solid = pixels[:, :, 3] == 255
    padded = np.pad(solid, 1)
    expanded = np.logical_or.reduce([
        padded[y:y + tile.height, x:x + tile.width]
        for y in range(3) for x in range(3)
    ])
    pixels[expanded & ~solid] = ink
    return Image.fromarray(pixels)


def wall_face(biome, index, palette, ink):
    tile = Image.new("RGBA", (16, 32))
    draw = ImageDraw.Draw(tile)
    top, face, mortar, shadow = (palette[key] for key in
                                 ("ink_04", "ink_03", "ink_02", "ink_01"))
    rng = seeded(biome, "wall_face", index)
    draw.rectangle((0, 0, 15, 28), fill=face)
    draw.rectangle((0, 0, 15, 4), fill=top)
    draw.line((0, 5, 15, 5), fill=shadow)
    draw.line((0, 6, 15, 6), fill=top)
    for row, y in enumerate((11, 17, 23)):
        draw.line((0, y, 15, y), fill=mortar)
        draw.line((0, y + 1, 15, y + 1), fill=top)
        for x in range(4 + 3 * (row % 2), 15, 7):
            draw.line((x, y + 1, x, y + 5), fill=mortar)
        draw.point((rng.randrange(2, 14), y - 2), fill=top)
    draw.rectangle((0, 27, 15, 28), fill=mortar)
    variant = index // 4
    if biome == "hengyue":
        if variant == 0:
            draw.line([(2, 24), (3, 21), (5, 22), (7, 20)], fill=palette["jade_02"])
            draw.point((6 + index, 21), fill=palette["jade_03"])
        elif variant == 1:
            draw.rounded_rectangle((4, 8, 11, 20), radius=2, fill=shadow, outline=top)
            draw.rectangle((6, 11, 9, 17), fill=palette["jade_01"])
            draw.line((7, 11, 7, 17), fill=top)
            draw.line((6, 14, 9, 14), fill=top)
        else:
            draw.line((3, 8, 12, 8), fill=palette["bronze_04"], width=2)
            draw.polygon([(5, 9), (10, 9), (10, 21), (7, 24), (5, 22)],
                         fill=palette["jade_02"], outline=shadow)
            draw.line([(7, 12), (8, 14), (7, 17)], fill=palette["jade_05"])
    elif biome == "blood_sea":
        draw.line([(4, 7), (6, 11), (5, 15), (8, 19), (7, 24)],
                  fill=palette[("soul_01", "blood_03", "blood_02")[variant]])
        draw.line((8, 19, 9 + index % 4, 16), fill=mortar)
        if variant == 2:
            draw.line((10, 11, 13, 13), fill=palette["ink_05"])
    elif variant == 2:
        for y in range(8, 24, 4):
            x = 6 + (y // 4 + index) % 2
            draw.ellipse((x, y, x + 4, y + 5), fill=mortar, outline=palette["ink_05"])
    else:
        draw.polygon([(7, 8), (12, 13), (12, 20), (8, 24), (3, 20), (3, 13)],
                     fill=mortar, outline=top)
        draw.line([(5, 17), (8, 12), (10, 16), (7, 20), (6, 18)],
                  fill=palette[("bronze_03", "bronze_05")[variant]])
    return outlined(tile, ink)


def overlay(biome, sheet, index, frame, palette, ink):
    tile = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(tile)
    rng = seeded(biome, sheet, index)
    x, y = rng.randrange(4, 7), rng.randrange(5, 8)
    kind = index // 4
    if sheet == "rune_glow":
        glow = palette[("bronze_04", "bronze_05", "bronze_07", "bronze_06")[frame]]
        shapes = (
            [(4, 9), (7, 4), (11, 7), (8, 11), (4, 9)],
            [(4, 10), (10, 10), (10, 5), (6, 5), (6, 8), (8, 8)],
            [(4, 6), (8, 11), (12, 6), (7, 6), (7, 10)],
            [(4, 5), (4, 10), (11, 10), (11, 7), (7, 7), (7, 5)],
        )
        points = shapes[index % 4]
        if index >= 4:
            points = [(15 - px, py) for px, py in points]
        draw.line(points, fill=glow)
        draw.point((8, 3 + index % 2), fill=glow)
        return outline_overlay(tile, ink)
    if biome == "hengyue":
        colors = ("ink_04", "jade_03", "blood_07", "jade_05")
        if index == 15:  # Small, non-interactive garden lantern.
            draw.polygon([(4, 6), (8, 3), (12, 6), (11, 10), (9, 11),
                          (10, 13), (6, 13), (7, 11), (5, 10)], fill=ink)
            draw.line((6, 6, 10, 6), fill=palette["ink_05"])
            draw.rectangle((7, 8, 9, 9), fill=palette["bronze_06"])
            draw.point((8, 11), fill=palette["ink_04"])
            return outline_overlay(tile, ink)
        if index == 14:
            draw.line((6, 12, 8, 3), fill=palette["jade_04"])
            draw.line([(9, 6), (12, 4), (11, 6)], fill=palette["jade_03"])
            draw.line([(6, 8), (3, 6), (4, 8)], fill=palette["jade_03"])
            return outline_overlay(tile, ink)
        marks = [
            [(x, y), (x + 2, y + 3), (x + 5, y + 2), (x + 6, y + 4)],
            [(x, y + 2), (x + 3, y), (x + 5, y + 1)],
            [(x, y), (x + 1, y + 1), (x + 4, y + 3), (x + 5, y + 3)],
            [(x, y + 3), (x + 3, y + 1), (x + 6, y)],
        ]
    else:
        colors = ("ink_06", "blood_04", "ink_05", "soul_05")
        marks = [
            [(x, y), (x + 1, y + 2), (x + 5, y + 4), (x + 6, y + 3)],
            [(x, y), (x + 2, y + 1), (x + 4, y + 3), (x + 6, y + 2)],
            [(x - 2, y + 3), (x + 2, y + 1), (x + 6, y + 1)],
            [(x - 1, y + 3), (x + 1, y + 1), (x + 4, y + 2), (x + 6, y)],
        ]
    draw.line(marks[kind], fill=palette[colors[kind]])
    draw.point((x + 2, y + 5), fill=palette[colors[kind]])
    return outline_overlay(tile, ink)


def floor_shadow(index, palette):
    """Shadow on the first floor row below a south-facing wall."""
    tile = Image.new("RGBA", (SIZE, SIZE))
    draw = ImageDraw.Draw(tile)
    left, right = index & 1, index & 2
    draw.polygon([(0 if left else 2, 0), (15 if right else 13, 0),
                  (15 if right else 11, 5), (0 if left else 4, 5)],
                 fill=palette["ink_02"])
    draw.rectangle((0 if left else 2, 0, 15 if right else 13, 1),
                   fill=palette["ink_01"])
    return tile


def verify_seams(tiles):
    """Exhaust every occupied horizontal and vertical pair in a 4x3 stencil."""
    arrays = {mask: np.asarray(tile) for mask, tile in zip(MASKS, tiles)}
    if len({tile.tobytes() for tile in arrays.values()}) != 47:
        raise ValueError("Expected 47 visually unique blob masks")
    for dx, dy in ((1, 0), (0, 1)):
        positions = [(x, y) for y in range(-1, 2 + dy)
                     for x in range(-1, 2 + dx)
                     if (x, y) not in {(0, 0), (dx, dy)}]
        for combination in range(1 << len(positions)):
            occupied = {(0, 0), (dx, dy)}
            occupied.update(position for index, position in enumerate(positions)
                            if combination & (1 << index))
            first, second = (
                canonical(sum(bit for bit, x, y in DIRECTIONS.values()
                              if (cx + x, cy + y) in occupied))
                for cx, cy in ((0, 0), (dx, dy))
            )
            a, b = arrays[first], arrays[second]
            edges = (a[:, -1], b[:, 0]) if dx else (a[-1], b[0])
            if not np.array_equal(*edges):
                raise ValueError(f"Seam mismatch for {first}, {second}, axis {(dx, dy)}")


def pack(frames, cell, columns):
    width, height = cell
    rows = (len(frames[0]) + columns - 1) // columns
    sheet = Image.new("RGBA", (width * columns, height * rows * len(frames)))
    for frame, tiles in enumerate(frames):
        for index, tile in enumerate(tiles):
            sheet.paste(tile, (index % columns * width, (frame * rows + index // columns) * height))
    return sheet


def save_sheet(directory, spec, frames, cell, palette, verify):
    count, frame_count = spec["tiles"], spec["anim_frames"]
    columns = min(count, 8)
    if len(frames) != frame_count or any(len(tiles) != count for tiles in frames):
        raise ValueError(f"Tile/frame count mismatch for {spec['id']}")
    if any(tile.size != cell for tiles in frames for tile in tiles):
        raise ValueError(f"Cell size mismatch for {spec['id']}")
    path = directory / (spec["id"] + ".png")
    sheet = pack(frames, cell, columns)
    sheet.save(path)
    if verify:
        if len({tuple(tile.tobytes() for tile in tiles) for tiles in frames}) != frame_count:
            raise ValueError(f"Duplicate animation frames: {path}")
        with Image.open(path) as rendered:
            rows = (count + columns - 1) // columns
            if rendered.mode != "RGBA" or rendered.size != (
                columns * cell[0], frame_count * rows * cell[1]
            ):
                raise ValueError(f"Unexpected PNG dimensions or mode: {path}")
            pixels = set(rendered.get_flattened_data() if hasattr(rendered, "get_flattened_data")
                         else rendered.getdata())
            if not pixels <= {*palette.values(), (0, 0, 0, 0)}:
                raise ValueError(f"Unexpected color or alpha: {path}")
            if count == 47 or spec["id"] in {"wall_face", "deco", "rune_glow", "wall_shadow"}:
                if (0, 0, 0, 0) not in pixels:
                    raise ValueError(f"Missing transparency: {path}")
    return {"file": path.name, "dims": list(sheet.size), "cell": list(cell),
            "tiles": count, "frames": frame_count, "role": spec["role"],
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def make_tilesets(assets, out, palette, ink, verify):
    out.mkdir(parents=True, exist_ok=True)
    geometry = {mask: tile_geometry(mask) for mask in MASKS}
    mapping = {
        "directions": {name: bit for name, (bit, _, _) in DIRECTIONS.items()},
        "diagonal_rule": "Keep a diagonal only when both adjacent cardinals are set.",
        "columns": 8, "rows_per_frame": 6, "cell": [16, 16],
        "layout": "Zero-based row-major indices. Stack frame blocks downward. Cell 47 is transparent padding.",
        "mask_to_index": {str(mask): index for index, mask in enumerate(MASKS)},
        "raw_mask_to_index": [MASKS.index(canonical(mask)) for mask in range(256)],
        "wall_shadow": {
            "layout": "Place in the first floor row below a south-facing wall.",
            "index": "1 if left neighbor continues, plus 2 if right neighbor continues.",
        },
        "floor_variants": "Four alternate tiles for mask 255, with the same edge pixels.",
    }
    write_json(out / "blob47_mapping.json", mapping)
    log = []
    for asset in assets:
        biome = asset["biome"]
        directory = out / Path(asset["output_path"]).relative_to(OUTPUT)
        directory.mkdir(parents=True, exist_ok=True)
        records = []
        for spec in asset["sheets"]:
            sheet = spec["id"]
            cell = tuple(spec.get("tile_size", asset["size"]))
            frames = []
            for frame in range(spec["anim_frames"]):
                if sheet.endswith("_blob47"):
                    colors = tuple(palette[key] for key in MATERIALS[biome][sheet])
                    texture = material_texture(biome, sheet, 0, frame, colors)
                    tiles = [blob_tile(geometry[mask], texture, colors, ink) for mask in MASKS]
                    if verify:
                        verify_seams(tiles)
                elif sheet == "wall_face":
                    tiles = [wall_face(biome, index, palette, ink) for index in range(spec["tiles"])]
                elif sheet in {"deco", "rune_glow"}:
                    tiles = [overlay(biome, sheet, index, frame, palette, ink)
                             for index in range(spec["tiles"])]
                else:
                    raise ValueError(f"Unknown manifest sheet: {sheet}")
                frames.append(tiles)
            records.append(save_sheet(directory, spec, frames, cell, palette, verify))
            if sheet.startswith("floor_"):
                variants = []
                for variant in range(1, 5):
                    texture = material_texture(biome, sheet, variant, 0, colors)
                    variants.append(blob_tile(geometry[255], texture, colors, ink))
                if verify:
                    reference = np.asarray(frames[0][-1])
                    for variant_tile in variants:
                        variant_pixels = np.asarray(variant_tile)
                        if not (np.array_equal(reference[[0, -1]], variant_pixels[[0, -1]])
                                and np.array_equal(reference[:, [0, -1]], variant_pixels[:, [0, -1]])):
                            raise ValueError(f"Floor variation seam mismatch: {sheet}")
                variant_spec = {"id": sheet.removesuffix("_blob47") + "_variants",
                                "role": "Alternate fully surrounded floor cells",
                                "tiles": 4, "anim_frames": 1}
                records.append(save_sheet(directory, variant_spec, [variants], cell, palette, verify))
        shadow_spec = {"id": "wall_shadow", "role": "South wall shadow floor overlays",
                       "tiles": 4, "anim_frames": 1}
        shadows = [floor_shadow(index, palette) for index in range(4)]
        if verify:
            for first in (2, 3):
                for second in (1, 3):
                    if not np.array_equal(np.asarray(shadows[first])[:, -1],
                                          np.asarray(shadows[second])[:, 0]):
                        raise ValueError("Wall shadow seam mismatch")
        records.append(save_sheet(directory, shadow_spec, [shadows], (16, 16), palette, verify))
        for record in records:
            record["file"] = (directory.relative_to(out) / record["file"]).as_posix()
        log.append({"id": asset["id"], "name": asset["name"], "files": records})
    write_json(out / "gen_tilesets_log.json", {"assets": log, "mapping": "blob47_mapping.json"})


def file_hashes(assets, out):
    log = read_json(out / "gen_tilesets_log.json")
    paths = ["blob47_mapping.json", "gen_tilesets_log.json"]
    for asset, record in zip(assets, log["assets"], strict=True):
        if asset["id"] != record["id"]:
            raise ValueError("Log asset order mismatch")
        for entry in record["files"]:
            paths.append(entry["file"])
            if hashlib.sha256((out / entry["file"]).read_bytes()).hexdigest() != entry["sha256"]:
                raise ValueError(f"Invalid log digest: {entry['file']}")
    return {path: hashlib.sha256((out / path).read_bytes()).hexdigest() for path in paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / OUTPUT)
    parser.add_argument("--only", help="Manifest tileset asset ID")
    parser.add_argument("--verify", action="store_true", help="Validate and compare two independent runs")
    args = parser.parse_args()
    source = read_json(ROOT / "tools/generators/palette.json")
    palette = {color["id"]: ImageColor.getcolor(color["hex"], "RGBA")
               for color in source["colors"]}
    manifest = read_json(ROOT / "assets/manifest.json")
    assets = [asset for asset in manifest["assets"]
              if asset.get("assigned_agent") == "codex_antigravity"
              and asset.get("category") == "tileset"
              and (args.only is None or asset["id"] == args.only)]
    if not assets:
        parser.error("No matching Codex tileset manifest ID")
    ink = palette[source["outline_id"]]
    make_tilesets(assets, args.out, palette, ink, args.verify)
    if args.verify:
        with TemporaryDirectory() as temp:
            repeated = Path(temp)
            make_tilesets(assets, repeated, palette, ink, False)
            hashes = file_hashes(assets, args.out)
            if hashes != file_hashes(assets, repeated):
                raise ValueError("The two generation runs differ")
        print(f"Verified {len(assets)} biomes and {len(hashes)} byte-identical files, "
              "including dimensions, palette, transparency and 47-mask seams.")


if __name__ == "__main__":
    main()
