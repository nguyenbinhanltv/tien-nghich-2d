"""Generate original Ink Flute and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
FLUTE = "lt_ink_flute"
SHOT = "lt_ink_flute_shot"
PALETTE = ROOT / "tools/generators/palette.json"
COLORS = {c["id"]: ImageColor.getcolor(c["hex"], "RGBA")
          for c in json.loads(PALETTE.read_text())["colors"]}


def outlined(paint):
    """Grow one four-connected ink pixel outside the painted silhouette."""
    result = Image.new("RGBA", paint.size)
    for y in range(paint.height):
        for x in range(paint.width):
            if paint.getpixel((x, y))[3]:
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    result.putpixel((x + dx, y + dy), COLORS["ink_01"])
    result.alpha_composite(paint)
    return result


def held():
    art = Image.new("RGBA", (24, 24))
    pen = ImageDraw.Draw(art)
    # A small purple silk knot hangs clear of the fingerboard.
    pen.line([(11, 17), (8, 17), (7, 19), (5, 20)], COLORS["soul_04"])
    pen.line([(7, 19), (5, 19)], COLORS["soul_06"])
    pen.point((8, 18), COLORS["soul_05"])
    # Tilt a five-pixel cylinder toward the viewer, keeping the lower grip fixed.
    for y in range(3, 22):
        left = 15 - (y - 3) // 3
        for i, shade in enumerate(["jade_03", "jade_06", "jade_05", "jade_03", "jade_01"]):
            pen.point((left+i, y), COLORS[shade])
        if y in (6, 9, 12, 15):
            pen.line([(left+2, y), (left+3, y)], COLORS["ink_02"])
        if y in (16, 18, 20):
            pen.line([(left, y), (left+3, y+1)], COLORS["bronze_04"])
    pen.ellipse((15, 1, 20, 4), fill=COLORS["bronze_05"])
    pen.line([(17, 2), (19, 2)], COLORS["ink_01"])
    pen.point((16, 3), COLORS["bronze_07"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # The front of the wave rolls inward. Its trailing filament folds and unfurls.
    tail, crest, curl = [
        ([(1, 10), (4, 10), (6, 9)], (10, 3), (11, 7)),
        ([(2, 12), (4, 11), (6, 9)], (11, 2), (12, 7)),
        ([(2, 11), (5, 12), (7, 10)], (11, 3), (12, 8)),
        ([(1, 9), (4, 11), (7, 10)], (10, 4), (11, 8)),
    ][index]
    pen.line(tail + [(8, 8)], COLORS["soul_04"])
    pen.polygon([(4, 10), (7, 8), (8, 5), crest, (13, 4), (14, 6),
                 (13, 8), curl, (12, 5), (10, 6), (10, 9),
                 (8, 11), (5, 11)], fill=COLORS["soul_03"])
    pen.line([(5, 10), (7, 9), (9, 5), crest, (12, 4)], COLORS["soul_05"])
    pen.point(crest, COLORS["soul_07"])
    pen.point((8, 8), COLORS["soul_04"])
    return outlined(art)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(asset_id, clip, duration, pivot, frames, contact_hashes):
    raw = RAW / asset_id
    processed = PROCESSED / asset_id
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)
    width, height = frames[0].size
    source = Image.new("RGBA", (width * len(frames), height))
    records = []
    for i, frame in enumerate(frames):
        name = f"{clip}_none_{i}"
        path = processed / (name + ".png")
        frame.save(path)
        xy = (i * width, 0)
        source.paste(frame, xy)
        records.append({"key": f"longtime/{asset_id}/{name}",
                        "path": path.relative_to(ROOT).as_posix(), "source_xy": xy,
                        "duration_ms": duration, "sha256": sha(path)})
    source.save(raw / "source.png")
    script = Path(__file__).resolve()
    ledger = {"id": asset_id, "producer": "OpenAI Codex",
              "method": "Original deterministic native-grid drawing, no seed or input images.",
              "brief": ("Jade lacquer flute with a hollow end, dark tone holes and a bound grip." if asset_id == FLUTE
                        else "A curling pulse of ink drawn into a tapered brush stroke."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    flute = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(flute, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / FLUTE).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / FLUTE / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(FLUTE, "held", 0, [12, 18], [flute], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
