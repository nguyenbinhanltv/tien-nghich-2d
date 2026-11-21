"""Deterministic ImageGen turnaround import and pet rig bake for the P0 trial."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
EXPERIMENT = ROOT / "assets/experiments/forge_bakeoff/lt_ink_marten"
SHIPPED = ROOT / "assets/processed_longtime/lt_ink_marten"
DIRECTIONS = ("south", "west", "north", "east")
SIZE = 32
PIVOT = (16, 29)
PALETTE = json.loads((ROOT / "tools/generators/palette.json").read_text())
COLORS = {c["id"]: tuple(bytes.fromhex(c["hex"][1:])) for c in PALETTE["colors"]}
INK = COLORS[PALETTE["outline_id"]]

# These tracks are in pet space. Forward is projected independently by each facing.
# Contacts stay fixed over consecutive planted keys. Alternate pairs swing on follow.
MOTIONS = {
    "idle": {
        "duration_ms": 180,
        "tail_degrees": [0, 6, 0, -6],
        "paw_tracks": [
            [(0, 0, True)] * 4,
            [(0, 0, True)] * 4,
        ],
    },
    "follow": {
        "duration_ms": 120,
        "tail_degrees": [-5, 0, 5, 0],
        "paw_tracks": [
            [(0, 0, True), (0, 0, True), (-1, -1, False), (1, -1, False)],
            [(-1, -1, False), (1, -1, False), (0, 0, True), (0, 0, True)],
        ],
    },
}


def bounds(mask):
    ys, xs = np.nonzero(mask)
    if not xs.size:
        raise ValueError("empty silhouette")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def outline(layer):
    """Replace the inner 4-neighbor boundary with a single layer of outline ink."""
    result = layer.copy()
    opaque = result[:, :, 3] == 255
    p = np.pad(opaque, 1)
    core = opaque & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    result[opaque & ~core, :3] = INK
    return result


def import_cell(sheet, i, template, anchor, marker):
    """Return outline-free indexed colors in an RGBA canvas and import landmarks."""
    half = sheet.height // template["rows"]
    row = i // template["columns"]
    cell = sheet.crop((round(sheet.width * anchor["cell_x"][0]), row * half,
                       round(sheet.width * anchor["cell_x"][1]), (row + 1) * half))
    rgb = np.array(cell.convert("RGB"))
    red, green, blue = rgb.astype(np.int16).transpose(2, 0, 1)
    # Green dominance allows for variation in the generated key, including fringe.
    if template["key_rgb"] != [0, 255, 0]:
        raise ValueError("this prototype expects a green chroma key")
    mask = ~((green >= 105) & (green - np.maximum(red, blue) >= 55))
    mask[:round(half * template["label_band_fraction"])] = False
    x0, y0, x1, y1 = bounds(mask)
    foot_x0, foot_x1 = (round(half * x) for x in anchor["foot_window"])
    _, _, _, ground_y = bounds(mask[:, foot_x0:foot_x1])
    ground_x = round(half * anchor["center_x"])
    target_y = 25  # bottom-exclusive support line, 4 px above the logical pivot
    ratios = [
        anchor["height_px"] / (ground_y - y0),
        (PIVOT[0] - 1) / max(1, ground_x - x0),
        (SIZE - 1 - PIVOT[0]) / max(1, x1 - ground_x),
        (SIZE - 2 - target_y) / max(1, y1 - ground_y),
        (target_y - 1) / max(1, ground_y - y0),
    ]
    scale = min(ratios)
    rgba = np.dstack((rgb, mask.astype(np.uint8) * 255))
    crop = Image.fromarray(rgba[y0:y1, x0:x1]).convert("RGBa")
    dims = (max(1, round((x1 - x0) * scale)), max(1, round((y1 - y0) * scale)))
    reduced = crop.resize(dims, Image.Resampling.BOX).convert("RGBA")
    canvas = Image.new("RGBA", (SIZE, SIZE))
    origin = (PIVOT[0] + round((x0 - ground_x) * scale),
              target_y + round((y0 - ground_y) * scale))
    canvas.paste(reduced, origin)
    sampled = np.asarray(canvas)
    opaque = sampled[:, :, 3] >= 128
    colors = sampled[opaque, :3].astype(np.int32)
    allowed = np.array([rgb for rgb in COLORS.values() if rgb not in (INK, marker)])
    nearest = np.argmin(((colors[:, None] - allowed) ** 2).sum(axis=2), axis=1)
    indexed = np.zeros_like(sampled)
    indexed[opaque, :3] = allowed[nearest]
    indexed[opaque, 3] = 255
    # Preserve the source mark only where the lavender survives the area filter.
    red, green, blue = sampled[:, :, :3].astype(np.int16).transpose(2, 0, 1)
    lavender = opaque & (red >= 165) & (blue >= 187) & (blue - green >= 17)
    indexed[lavender, :3] = marker
    return indexed, {"source_ground_xy": [ground_x, ground_y], "source_bounds": [x0, y0, x1, y1],
                     "native_origin_xy": origin, "scale": round(scale, 6)}


def mask_part(layer, polygon):
    mask = Image.new("1", (SIZE, SIZE))
    ImageDraw.Draw(mask).polygon([tuple(point) for point in polygon], fill=1)
    return np.where(np.asarray(mask)[:, :, None], layer, 0)


def split_parts(layer, rig, marker):
    """Cut overlapping tail and paws from one facing using authored pixel polygons."""
    layer = layer.copy()
    # This explicit pixel edit keeps the mark legible even when an ear edge becomes ink.
    layer[np.all(layer[:, :, :3] == marker, axis=2), :3] = COLORS["ink_05"]
    for x, y in rig["mark_pixels"]:
        if layer[y, x, 3] != 255:
            raise ValueError(f"ear repair outside silhouette at {(x, y)}")
        layer[y, x, :3] = marker
    tail = mask_part(layer, rig["tail"]["cut"])
    paws = [mask_part(layer, paw["cut"]) for paw in rig["paws"]]
    body = layer.copy()
    for spec in [rig["tail"], *rig["paws"]]:
        body[mask_part(layer, spec["remove"])[:, :, 3] == 255] = 0
    return tail, paws, body


def place(dst, src, dx=0, dy=0):
    shifted = np.roll(src, (dy, dx), axis=(0, 1))
    if dy > 0:
        shifted[:dy] = 0
    elif dy < 0:
        shifted[dy:] = 0
    if dx > 0:
        shifted[:, :dx] = 0
    elif dx < 0:
        shifted[:, dx:] = 0
    opaque = shifted[:, :, 3] == 255
    dst[opaque] = shifted[opaque]
    return opaque


def bake(layer, rig, motion, index):
    tail, paws, body = layer
    angle = motion["tail_degrees"][index] * rig["tail"]["swing"]
    tail_pose = Image.fromarray(tail).rotate(
        angle, resample=Image.Resampling.NEAREST, center=tuple(rig["tail"]["joint"])
    )
    frame = np.zeros_like(body)
    place(frame, np.asarray(tail_pose))
    contacts = []
    for pixels, paw in zip(paws, rig["paws"], strict=True):
        stride, lift, planted = motion["paw_tracks"][paw["phase"]][index]
        dx, dy = rig["forward"]
        dx, dy = stride * dx, stride * dy + lift
        footprint = place(frame, pixels, dx, dy)
        x, y = paw["contact"]
        x, y = x + dx, y + dy
        if not footprint[y, x]:
            raise ValueError(f"paw contact missing from cut at {(x, y)}")
        contacts.append({"xy": [x, y], "planted": planted})
    place(frame, body)
    if any(frame[y, x, 3] != 255 for x, y in (p["xy"] for p in contacts)):
        raise ValueError("paw contact disappeared in composite")
    if (frame[[0, -1], :, 3].any() or frame[:, [0, -1], 3].any()):
        raise ValueError("baked sprite reaches canvas boundary")
    return outline(frame), contacts


def compare_sheet(versions, scale):
    tile = SIZE * scale
    label_width = 94
    row_height = tile + 5
    pair_gap = 22
    pad = 10
    header = 36
    sheet = Image.new("RGB", (label_width + tile * 8 + pair_gap + pad,
                               header + row_height * 8 + pad), "#191820")
    draw = ImageDraw.Draw(sheet)
    for version_index, title in enumerate(versions):
        start = label_width + version_index * (tile * 4 + pair_gap)
        draw.text((start + 4, 6), title, fill="#f2ebf9")
        for index in range(4):
            draw.text((start + index * tile + 4, 22), str(index), fill="#c8becf")
        for clip_index, clip in enumerate(MOTIONS):
            for facing_index, facing in enumerate(DIRECTIONS):
                y = header + (clip_index * 4 + facing_index) * row_height
                if version_index == 0:
                    draw.text((pad, y + 10), f"{clip} / {facing}", fill="#ece4ef")
                for i, arr in enumerate(versions[title][clip][facing]):
                    x = start + i * tile
                    draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill="#827c88")
                    im = Image.fromarray(arr).resize((tile, tile), Image.Resampling.NEAREST)
                    sheet.paste(im, (x, y), im)
    return sheet


def palette_gate(paths):
    cmd = [sys.executable, "-I", str(ROOT / "tools/scripts/validate_palette.py"),
           "--class", "character", *map(str, paths)]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr or result.stdout)
    return {"pass": result.stdout.count("\nPASS ") + result.stdout.startswith("PASS "),
            "fail": result.stdout.count("\nFAIL ") + result.stdout.startswith("FAIL "),
            "warnings": result.stdout.count("   warn: ")}


def mark_mask(frame, marker):
    return (frame[:, :, 3] == 255) & np.all(frame[:, :, :3] == marker, axis=2)


def wrap_pairs(values):
    return zip(values, values[1:] + values[:1], strict=True)


def frame_metrics(frames):
    """Pixel-only measurements shared by both versions."""
    silhouettes = [f[:, :, 3] != 0 for f in frames]
    boxes = [bounds(mask) for mask in silhouettes]
    sizes = [[x1 - x0, y1 - y0] for x0, y0, x1, y1 in boxes]
    drift = []
    support = []
    luma_spreads = []
    for frame, mask, (x0, y0, x1, y1) in zip(frames, silhouettes, boxes, strict=True):
        # Whole-silhouette anchors can respond to tail movement. Treat them as proxies.
        drift.append((x0 + x1, y0 + y1))
        support.append(set(np.where(mask[y1 - 1])[0].tolist()))
        interior = mask & np.any(frame[:, :, :3] != INK, axis=2)
        colors = frame[interior, :3].astype(np.int32)
        luma = colors @ np.array([54, 183, 19]) / 256
        luma_spreads.append(float(np.percentile(luma, 90) - np.percentile(luma, 10)))
    changes = []
    for (a, b), (ma, mb) in zip(wrap_pairs(frames), wrap_pairs(silhouettes), strict=True):
        changes.append(round(float((np.any(a != b, axis=2) & (ma | mb)).sum() / (ma | mb).sum()), 3))
    flicker = []
    for i, current in enumerate(frames):
        before, after = frames[i - 1], frames[(i + 1) % len(frames)]
        always_inside = (before[:, :, 3] == 255) & (current[:, :, 3] == 255) & (after[:, :, 3] == 255)
        for frame in (before, current, after):
            always_inside &= np.any(frame[:, :, :3] != INK, axis=2)
        aba = np.all(before == after, axis=2) & np.any(current != before, axis=2)
        flicker.append(int((always_inside & aba).sum()))
    return {
        "occupied_size_px": sizes,
        "bbox_center_span_px": [float(v / 2) for v in np.ptp(drift, axis=0)],
        "lowest_row_span_px": max(b[3] for b in boxes) - min(b[3] for b in boxes),
        "lowest_row_columns_changed": [len(a ^ b) for a, b in wrap_pairs(support)],
        "interior_luma_p90_p10": round(float(np.mean(luma_spreads)), 1),
        "changed_fraction": changes,
        "interior_aba_pixels": flicker,
        "loop_seam_flag": changes[-1] > max(changes[:-1]) * 1.25 + 0.03,
    }


def animation_gate(frames, contacts, rig, marker):
    """Check projected supports, silhouette drift, interior flicker and ear placement."""
    slide = []
    planted_missing = []
    for i, (previous, current) in enumerate(wrap_pairs(contacts)):
        for j, (a, b) in enumerate(zip(previous, current, strict=True)):
            if a["planted"] and b["planted"] and a["xy"] != b["xy"]:
                slide.append([i, j])
            x, y = a["xy"]
            if a["planted"] and frames[i][y, x, 3] != 255:
                planted_missing.append([i, j])
    x0, y0, x1, y1 = rig["left_ear_box"]
    mark_pixels = []
    wrong_ear = []
    for i, frame in enumerate(frames):
        mark = mark_mask(frame, marker)
        visible = int(mark[y0:y1, x0:x1].sum())
        mark_pixels.append(visible)
        if not visible or int(mark.sum()) != visible:
            wrong_ear.append(i)
    metrics = frame_metrics(frames)
    drift = max(metrics["bbox_center_span_px"]) > 2
    flicker = max(metrics["interior_aba_pixels"]) > 10
    return {
        "pass": not any((slide, planted_missing, wrong_ear, drift, flicker, metrics["loop_seam_flag"])),
        "planted_slide_transitions": slide,
        "planted_missing_pixels": planted_missing,
        "bbox_drift_flag": drift,
        "interior_flicker_flag": flicker,
        "loop_seam_flag": metrics["loop_seam_flag"],
        "left_ear_marker_pixels": mark_pixels,
        "wrong_or_missing_ear_frames": wrong_ear,
    }


def save_png(frame, path):
    Image.fromarray(frame).save(path, compress_level=9)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=EXPERIMENT, help="destination for rebuilt outputs")
    args = parser.parse_args()
    source = EXPERIMENT / "turnaround.png"
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != (EXPERIMENT / "turnaround.sha256").read_text().split()[0]:
        raise ValueError("turnaround SHA-256 mismatch")
    config = json.loads((EXPERIMENT / "rig.json").read_text())
    marker = COLORS[config["marker"]]
    layout = json.loads((EXPERIMENT / "layout.json").read_text())
    template = layout["template"]
    if tuple(label.lower() for label in template["labels"]) != DIRECTIONS:
        raise ValueError("turnaround labels do not match the rig facing order")
    args.out.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as original:
        sheet = original.convert("RGB")
    if sheet.width != sheet.height or sheet.width % 2:
        raise ValueError("expected a square, even-sized 2x2 turnaround")
    runs = {"Shipped PixelLab": {}, "ImageGen + rig": {}}
    metrics = {"sheet_sha256": digest, "pivot_px": PIVOT, "imports": {}, "clips": {}}
    rig_parts = {}
    (args.out / "turnaround_native").mkdir(exist_ok=True)
    for i, facing in enumerate(DIRECTIONS):
        rig = config["facings"][facing]
        imported, landmarks = import_cell(sheet, i, template, layout["source_landmarks"][facing], marker)
        native = outline(imported)
        metrics["imports"][facing] = landmarks
        metrics["imports"][facing]["visible_source_marker_px"] = int(mark_mask(native, marker).sum())
        save_png(native, args.out / "turnaround_native" / f"{facing}.png")
        rig_parts[facing] = split_parts(imported, rig, marker)
    (args.out / "frames").mkdir(exist_ok=True)
    failed_clips = []
    for clip, motion in MOTIONS.items():
        for version in runs.values():
            version[clip] = {}
        metrics["clips"][clip] = {"duration_ms": motion["duration_ms"], "facings": {}}
        for facing in DIRECTIONS:
            rig = config["facings"][facing]
            baked, shipped, contacts = [], [], []
            for i in range(4):
                name = f"{clip}_{facing}_{i}.png"
                frame, pose = bake(rig_parts[facing], rig, motion, i)
                save_png(frame, args.out / "frames" / name)
                baked.append(frame)
                contacts.append(pose)
                with Image.open(SHIPPED / name) as original:
                    shipped.append(np.array(original.convert("RGBA")))
            runs["Shipped PixelLab"][clip][facing] = shipped
            runs["ImageGen + rig"][clip][facing] = baked
            gate = animation_gate(baked, contacts, rig, marker)
            if not gate["pass"]:
                failed_clips.append(f"{clip}/{facing}")
            metrics["clips"][clip]["facings"][facing] = {
                "shipped": frame_metrics(shipped),
                "forge": frame_metrics(baked),
                "forge_animation_gate": gate,
                "forge_paw_contacts": contacts,
            }
    metrics["palette_gate"] = {"shipped": palette_gate([SHIPPED]),
                               "forge": palette_gate([args.out / "frames"])}
    for scale, name in [(4, "comparison_4x.png"), (1, "comparison_1x.png")]:
        compare_sheet(runs, scale).save(args.out / name, compress_level=9)
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    if failed_clips or metrics["palette_gate"]["forge"]["fail"]:
        raise SystemExit(f"Forge QA failed. Inspect {args.out / 'metrics.json'}")


if __name__ == "__main__":
    main()
