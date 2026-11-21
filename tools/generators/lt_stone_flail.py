"""Generate original Stone Flail and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
FLAIL = "lt_stone_flail"
SHOT = "lt_stone_flail_shot"
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
    # Unequal link widths show alternating face-on and edge-on rings.
    pen.line([(5, 9), (7, 5), (11, 3), (15, 4), (18, 8), (18, 11)],
             fill=COLORS["ink_04"])
    for box in [(6, 4, 10, 7), (11, 2, 15, 5), (16, 6, 19, 10)]:
        pen.ellipse(box, outline=COLORS["ink_04"])
        pen.arc(box, 180, 285, fill=COLORS["ink_06"])
    pen.point((8, 5), fill=COLORS["ink_03"])
    pen.polygon([(17, 10), (19, 11), (12, 21), (9, 21), (9, 20)],
                fill=COLORS["bronze_02"])
    pen.line([(10, 20), (17, 11)], fill=COLORS["bronze_04"])
    for x, y in [(11, 18), (13, 15), (16, 11)]:
        pen.line([(x, y), (x+2, y+1)], fill=COLORS["bronze_05"])

    pen.polygon([(2, 10), (5, 8), (8, 9), (10, 12), (8, 16),
                 (4, 17), (1, 14)], fill=COLORS["ink_03"])
    pen.polygon([(2, 10), (5, 8), (8, 9), (6, 12), (2, 13)], fill=COLORS["ink_05"])
    pen.polygon([(2, 13), (6, 12), (8, 15), (4, 16)], fill=COLORS["ink_04"])
    pen.line([(7, 10), (6, 12), (7, 13), (6, 14)], fill=COLORS["jade_05"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)

    def turn(x, y):
        for _ in range(index):
            x, y = -y, x
        return (8 + x, 8 + y)

    rim = [turn(*point) for point in [(-6, -1), (-3, -5), (1, -5), (5, -2),
                                      (4, 2), (2, 5), (-2, 4), (-5, 3)]]
    knot = turn(-1, 0)
    # Shade each facet by its position on screen to keep the light upper-left.
    for a, b in zip(rim, rim[1:] + rim[:1]):
        light = sum(a) + sum(b)
        tone = "ink_05" if light < 26 else "ink_04" if light < 35 else "ink_03"
        pen.polygon([a, b, knot], fill=COLORS[tone])
    crack = [turn(*p) for p in [(0, -4), (-2, -1), (0, 0), (-2, 3)]]
    pen.line(crack, fill=COLORS["jade_05"])
    pen.point(crack[1], fill=COLORS["jade_07"])
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
              "brief": ("Faceted seal stone, arched iron links and an ochre-wrapped grip." if asset_id == FLAIL
                        else "Detached tumbling seal stone with a luminous jade fissure."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    flail = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(flail, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / FLAIL).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / FLAIL / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(FLAIL, "held", 0, [12, 18], [flail], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
