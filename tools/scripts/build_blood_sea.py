"""Export the Blood Sea encounter key poses and native-resolution court. Requires Pillow."""
import argparse
import hashlib
import json
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory

from PIL import Image, ImageColor, ImageDraw, ImageFilter
from PIL.ImageChops import multiply, subtract
from blood_sea_effects import CLIPS, export_effects

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "assets/encounter/blood-sea"
NEAREST = Image.Resampling.NEAREST


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def corrected_turnaround(actor):
    """Assemble the corrective north cell and reuse the character's own banner on three action poses."""
    source = Image.open(BASE / "source" / actor["baseSource"]).convert("RGBA")
    edit = actor["replacement"]
    row = actor["rows"].index(edit["direction"])
    col = actor["poses"].index(edit["pose"])
    x1, x2 = actor["xEdges"][row][col:col + 2]
    y1, y2 = actor["yEdges"][row:row + 2]
    source.paste((0, 0, 0, 0), (x1, y1, x2, y2))
    with Image.open(BASE / "source" / edit["source"]) as replacement:
        patch = replacement.crop(edit["crop"]).resize(edit["size"], NEAREST)
        source.paste(patch, edit["position"])
    for piece in actor["bannerPatches"]:
        polygon = [tuple(point) for point in piece["sourcePolygon"]]
        left = min(x for x, _ in polygon)
        top = min(y for _, y in polygon)
        box = (left, top, max(x for x, _ in polygon) + 1, max(y for _, y in polygon) + 1)
        cutout = source.crop(box)
        mask = Image.new("L", cutout.size)
        ImageDraw.Draw(mask).polygon([(x-left, y-top) for x, y in polygon], fill=255)
        cutout.putalpha(multiply(mask, cutout.getchannel("A")))
        for placement in piece["placements"]:
            cloth = cutout.rotate(placement["angle"], resample=NEAREST, expand=True)
            x, y = placement["position"]
            foreground = source.crop((x, y, x + cloth.width, y + cloth.height))
            cloth.alpha_composite(foreground)
            source.paste(cloth, (x, y))
    return source


def grade_banner(source, box, size, anchor, pivot, scale, tones, alpha_threshold):
    """Sample only the painted violet textile inside the measured sheet rectangle."""
    left, top, right, bottom = box
    affine = (1 / scale, 0, anchor[0] - left - pivot[0] / scale,
              0, 1 / scale, anchor[1] - top - pivot[1] / scale)
    patch = source.crop((left, top, right, bottom)).transform(size, Image.Transform.AFFINE, affine, NEAREST)
    pixels = patch.load()
    for y in range(size[1]):
        for x in range(size[0]):
            r, g, b, alpha = pixels[x, y]
            # The cloth is magenta-violet; the neighbouring robe, hair and bronze hilt are warmer.
            if alpha >= alpha_threshold and b >= g + 12 and b >= .82 * r and r >= g + 8:
                color = next((color for cutoff, color in tones if r >= cutoff), None)
                if color is not None:
                    pixels[x, y] = (*color, 255)
                    continue
            pixels[x, y] = (0, 0, 0, 0)
    return patch


def grade_small_sprite(frame, alpha, grade, blade, swatches, colors, color_ids):
    """Preserve the metal facet inside the source silhouette and ink the outside at native size."""
    lut = [round(255 * (v / 255) ** grade["gamma"]) for v in range(256)]
    indexed = frame.convert("RGB").point(lut * 3).quantize(palette=swatches, dither=Image.Dither.NONE)
    indexed_palette = indexed.getpalette()
    ink = color_ids["ink_01"] * 3
    indexed_palette[ink:ink + 3] = colors[color_ids[grade["interiorInk"]]]
    indexed.putpalette(indexed_palette)
    rgb = indexed.convert("RGB")

    # The fine diagonals can sample only the dark side of the high-resolution blade.
    # Trace its lit facet from hilt to tip, clipped to the original native alpha.
    if blade:
        x1, y1, x2, y2 = blade
        metal = Image.new("RGB", frame.size)
        pen = ImageDraw.Draw(metal)
        pen.line(blade, fill=colors[color_ids["bronze_05"]])
        pen.line([(round((x1+x2)/2), round((y1+y2)/2)), (x2,y2)], fill=colors[color_ids["bronze_07"]])
        mask = multiply(alpha, metal.convert("L").point(lambda v: 255 if v else 0))
        rgb.paste(metal, mask=mask)

    cross = ImageFilter.Kernel((3, 3), (0, 1, 0, 1, 1, 1, 0, 1, 0), 5)
    outer = alpha.filter(cross).point(lambda coverage: 255 if coverage else 0)
    return rgb, outer, subtract(outer, alpha)


def export(out, assembled_path):
    spec = read(BASE / "contract.json")
    palette = read(ROOT / "tools/generators/palette.json")
    colors = [ImageColor.getrgb(entry["hex"]) for entry in palette["colors"]]
    swatches = Image.new("P", (1, 1))
    swatches.putpalette([channel for color in colors for channel in color] + list(colors[0]) * (256 - len(colors)))
    color_ids = {entry["id"]: index for index, entry in enumerate(palette["colors"])}

    def colorize(image):
        return image.convert("RGB").quantize(palette=swatches, dither=Image.Dither.NONE).convert("RGB")

    out.mkdir(exist_ok=True)
    if spec["sourcePrompts"].keys() != spec["sourceSha256"].keys():
        raise ValueError("Each pinned ImageGen input needs its source prompt")
    for filename, digest in spec["sourceSha256"].items():
        prompt = spec["sourcePrompts"][filename]
        if (Path(prompt).name != prompt or not prompt.endswith(".prompt.txt")
                or not (BASE / "source" / prompt).read_text(encoding="utf-8").strip()):
            raise ValueError(f"Invalid source prompt for {filename}")
        if hashlib.sha256((BASE / "source" / filename).read_bytes()).hexdigest() != digest:
            raise ValueError(f"Source hash mismatch: {filename}")
    actors = {actor["id"]: actor for actor in read(ROOT / "assets/manifest.json")["assets"]}
    sheets = dict(spec["actors"])
    for name, extra in spec.get("supplements", {}).items():
        master = sheets[extra["actor"]]
        inherited = {key: master[key] for key in ("size", "rows", "pivot", "scale")}
        sheets[name] = {**inherited, **extra}
        if "nativeGrade" in master:
            sheets[name]["nativeGrade"] = {**master["nativeGrade"], "bladeFacets": extra["bladeFacets"]}
    for name, actor in sheets.items():
        actor_id = actor.get("actor", name)
        size = actor["size"]
        if actors[actor_id]["size"] != [size, size] or actors[actor_id]["directions"] != actor["rows"]:
            raise ValueError(f"Size or directions differ from the manifest: {name}")
        if "replacement" in actor:
            source = corrected_turnaround(actor)
            source.save(assembled_path)
        else:
            source = Image.open(BASE / "source" / (name + ".png")).convert("RGBA")
        page = Image.new("RGBA", (len(actor["poses"]) * size, len(actor["rows"]) * size))
        frames = {}
        for row, direction in enumerate(actor["rows"]):
            top, bottom = actor["yEdges"][row:row + 2]
            for col, pose in enumerate(actor["poses"]):
                left, right = actor["xEdges"][row][col:col + 2]
                x, y = actor["anchors"][row][col]
                px, py = actor["pivot"]
                scale = actor["scale"]
                sample = source.crop((left, top, right, bottom))
                frame = sample.transform((size, size), Image.Transform.AFFINE,
                    (1 / scale, 0, x - left - px / scale, 0, 1 / scale, y - top - py / scale), NEAREST)
                alpha = frame.getchannel("A").point(lambda a: 255 if a >= spec["alphaThreshold"] else 0)
                bounds = alpha.getbbox()
                if not bounds:
                    raise ValueError(f"Empty frame {name}/{direction}/{pose}")
                if min(bounds[:2]) < 1 or max(bounds[2:]) > size - 1:
                    raise ValueError(f"Silhouette touches frame boundary: {name}/{direction}/{pose}")
                if "nativeGrade" in actor:
                    grade = actor["nativeGrade"]
                    rgb, alpha, edge = grade_small_sprite(frame, alpha, grade, grade["bladeFacets"][row][col],
                                                          swatches, colors, color_ids)
                    banner = actor.get("bannerGrade")
                    if banner and (box := banner["sourceBoxes"][row][col]):
                        tones = [(cutoff, colors[color_ids[tone]]) for cutoff, tone in reversed(banner["tones"])]
                        textile = grade_banner(source, box, frame.size, (x, y), (px, py), scale, tones,
                                               spec["alphaThreshold"])
                        rgb.paste(textile.convert("RGB"), mask=textile.getchannel("A"))
                else:
                    rgb = colorize(frame)
                    edge = subtract(alpha, alpha.filter(ImageFilter.MinFilter(3)))
                if min(alpha.getbbox()[:2]) < 1 or max(alpha.getbbox()[2:]) > size - 1:
                    raise ValueError(f"Outlined silhouette touches frame boundary: {name}/{direction}/{pose}")
                rgb.paste(ImageColor.getrgb(palette["outline"]), mask=edge)
                rgb.putalpha(alpha)
                page.paste(rgb, (col * size, row * size), alpha)
                frames[f"characters/{actor_id}/{pose}_{direction}_0"] = {
                    "frame": {"x": col * size, "y": row * size, "w": size, "h": size},
                    "ground": actor["pivot"]
                }
            for clip, poses in actor["clips"].items():
                for index, pose in enumerate(poses):
                    frames[f"characters/{actor_id}/{clip}_{direction}_{index}"] = frames[f"characters/{actor_id}/{pose}_{direction}_0"]
        page.save(out / (name + ".png"))
        timelines = {}
        for clip, states in actor["timelines"].items():
            if len(states) != len(actor["clips"][clip]):
                raise ValueError(f"One timing entry is required per clip frame: {name}/{clip}")
            timeline = [{"ms": spec["timingMs"][key], "label": label} for key, label in states]
            if min(frame["ms"] for frame in timeline) < 0 or not any(frame["ms"] for frame in timeline):
                raise ValueError(f"Invalid clip duration: {name}/{clip}")
            timelines[clip] = timeline
        atlas = {"frames": frames, "meta": {"image": name + ".png", "timelines": timelines}}
        companions = [key for key, sheet in spec.get("supplements", {}).items() if sheet["actor"] == name]
        if companions:
            atlas["meta"]["companions"] = companions
        (out / (name + ".json")).write_bytes((json.dumps(atlas, indent=2) + "\n").encode("utf-8"))
    with Image.open(BASE / "source/court.png") as court:
        # Sample the painted clusters once at export; the game scales native pixels with nearest neighbor.
        colorize(court.resize((384, 256), Image.Resampling.BOX)).save(out / "court.png")
    export_effects(out, palette)
    (out / "timing.mjs").write_bytes(timing_module(spec).encode("utf-8"))


def timing_module(contract):
    seconds = {key: ms / 1000 for key, ms in contract["timingMs"].items()}
    return ("// Generated by tools/scripts/build_blood_sea.py from the encounter contract.\n"
            + "export const seconds = Object.freeze(" + json.dumps(seconds, indent=2) + ");\n")


def check(expected, actual):
    if expected.suffix == ".png":
        with Image.open(expected) as reference, Image.open(actual) as rebuilt:
            matches = (reference.mode, reference.size, reference.tobytes()) == (rebuilt.mode, rebuilt.size, rebuilt.tobytes())
    elif expected.suffix == ".json":
        matches = read(expected) == read(actual)
    else:
        matches = expected.read_text(encoding="utf-8") == actual.read_text(encoding="utf-8")
    if not matches:
        raise ValueError(f"Stale export: {expected.name}")


def validate_actor_page(name, sheet, atlas, contract):
    actor_id = sheet.get("actor", name)
    actor = contract["actors"][actor_id]
    frames, meta = atlas["frames"], atlas["meta"]
    companions = [page for page, extra in contract.get("supplements", {}).items() if extra["actor"] == name]
    if meta.get("companions", []) != companions:
        raise ValueError(f"Incorrect companion pages: {name}")
    for direction in actor["rows"]:
        prefix = f"characters/{actor_id}/"
        for pose in sheet["poses"]:
            key = f"{prefix}{pose}_{direction}_0"
            entry = frames.get(key, {})
            if entry.get("ground") != actor["pivot"]:
                raise ValueError(f"Missing pose or incorrect ground pivot: {key}")
            if any(entry["frame"][axis] != actor["size"] for axis in ("w", "h")):
                raise ValueError(f"Incorrect native size: {key}")
        for clip, poses in sheet["clips"].items():
            for index, pose in enumerate(poses):
                key = f"{prefix}{clip}_{direction}_{index}"
                if frames.get(key) != frames[f"{prefix}{pose}_{direction}_0"]:
                    raise ValueError(f"Incorrect clip alias: {key} should draw {pose}")
    for clip, phases in sheet["timelines"].items():
        expected = [{"ms": contract["timingMs"][timing], "label": label} for timing, label in phases]
        if meta.get("timelines", {}).get(clip) != expected:
            raise ValueError(f"Incorrect exported timing: {name}/{clip}")


def validate_runtime(directory):
    contract = read(BASE / "contract.json")
    sheets = {**contract["actors"], **contract.get("supplements", {})}
    expected = {"court.png", "timing.mjs", "effects.png", "effects.json"}
    for name in sheets:
        expected.update((name + ".json", name + ".png"))
    missing = expected - {item.name for item in directory.iterdir()}
    if missing:
        raise ValueError(f"Missing runtime export: {', '.join(sorted(missing))}")
    if (directory / "timing.mjs").read_text(encoding="utf-8") != timing_module(contract):
        raise ValueError("Runtime timing module differs from contract")
    palette = read(ROOT / "tools/generators/palette.json")
    allowed = {ImageColor.getrgb(color["hex"]) + (255,) for color in palette["colors"]} | {(0, 0, 0, 0)}
    for png in directory.glob("*.png"):
        with Image.open(png) as image:
            pixels = image.convert("RGBA").getcolors(maxcolors=41)
            if pixels is None or any(color not in allowed for _, color in pixels):
                raise ValueError(f"Off-palette color or nonbinary alpha: {png.name}")
    keys = set()
    for path in directory.glob("*.json"):
        atlas = read(path)
        if path.stem in sheets:
            validate_actor_page(path.stem, sheets[path.stem], atlas, contract)
        elif path.stem == "effects":
            for name, label, w, h, count, _ in CLIPS:
                if atlas["meta"]["clips"].get(name) != {"frames": count, "label": label}:
                    raise ValueError(f"Incorrect effect clip: {name}")
                for i in range(count):
                    key = f"vfx/{name}_{i}"
                    entry = atlas["frames"].get(key, {})
                    if (entry.get("ground") != [w//2, h//2] or
                            [entry["frame"]["w"], entry["frame"]["h"]] != [w, h]):
                        raise ValueError(f"Missing effect frame or incorrect size/pivot: {key}")
        if atlas["meta"]["image"] != path.with_suffix(".png").name:
            raise ValueError(f"Incorrect atlas image: {path.name}")
        duplicates = keys.intersection(atlas["frames"])
        if duplicates:
            raise ValueError(f"Duplicate frame key across atlas pages: {min(duplicates)}")
        keys.update(atlas["frames"])
        with Image.open(directory / atlas["meta"]["image"]) as image:
            alpha = image.convert("RGBA").getchannel("A")
            checked = set()
            for key, record in atlas["frames"].items():
                frame = record["frame"]
                x, y, w, h = (frame[k] for k in ("x", "y", "w", "h"))
                px, py = record["ground"]
                if not (0 <= x < x + w <= image.width and 0 <= y < y + h <= image.height
                        and 0 <= px < w and 0 <= py < h):
                    raise ValueError(f"Invalid atlas rectangle or pivot: {key}")
                box = (x, y, x + w, y + h)
                if box not in checked and alpha.crop(box).getbbox() is None:
                    raise ValueError(f"Transparent atlas frame: {key}")
                checked.add(box)


def install_file(target, source):
    # Finish and validate the whole export before replacing any live file.
    target.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(dir=target.parent, delete=False) as output:
        temp = Path(output.name)
        output.write(source.read_bytes())
    try:
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Rebuild in a temporary directory and verify shipped output")
    mode.add_argument("--check-runtime", type=Path, metavar="ATLAS_DIRECTORY",
                      help="Verify assembled files against the contract without reading the source art")
    options = parser.parse_args()
    if options.check_runtime is not None:
        validate_runtime(options.check_runtime)
        print("Verified runtime pages, clip aliases, timings, pivots, palette and visible frames.")
        raise SystemExit(0)
    assembled = BASE / "source/wl_blood_foundation.png"
    with TemporaryDirectory() as temporary:
        work = Path(temporary)
        export(work / "web", work / assembled.name)
        validate_runtime(work / "web")
        finish = check if options.check else install_file
        finish(assembled, work / assembled.name)
        for file in (work / "web").iterdir():
            finish(BASE / "web" / file.name, file)
    print("Verified source hashes, margins, assembled sheet, palette, atlas rectangles, pivots and runtime pixels.")
