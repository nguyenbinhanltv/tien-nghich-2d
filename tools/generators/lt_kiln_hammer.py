"""Generate original Kiln Hammer and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
HAMMER = "lt_kiln_hammer"
SHOT = "lt_kiln_hammer_shot"
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
    pen.polygon([(10, 9), (13, 9), (14, 21), (11, 22)], COLORS["bronze_02"])
    pen.line([(11, 12), (12, 21)], COLORS["bronze_04"])
    for y in (16, 18, 20):
        pen.line([(11, y), (13, y-1)], COLORS["bronze_05"])
    # Three visible planes: refractory brick crown, vented front and iron end.
    pen.polygon([(2, 6), (6, 2), (19, 4), (21, 6), (17, 9), (4, 8)], COLORS["ink_04"])
    pen.polygon([(3, 7), (17, 9), (17, 14), (4, 12)], COLORS["bronze_01"])
    pen.polygon([(17, 9), (21, 6), (21, 11), (17, 14)], COLORS["ink_03"])
    pen.line([(3, 6), (6, 3), (10, 3)], COLORS["ink_05"])
    pen.line([(10, 4), (8, 6)], COLORS["ink_03"])
    pen.line([(6, 8), (6, 11)], COLORS["ink_04"])
    for x, y in [(8, 9), (12, 10)]:
        pen.line([(x, y), (x+2, y)], COLORS["thunder_05"])
        pen.point((x+1, y), COLORS["bronze_06"])
    pen.line([(16, 9), (16, 13)], COLORS["ink_04"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # Four poses of the detached clinker. A fixed highlight keeps light upper-left.
    facets = [
        [(5, 5), (10, 4), (13, 7), (11, 10), (6, 11), (4, 8)],
        [(7, 3), (11, 5), (12, 9), (9, 12), (5, 10), (5, 6)],
        [(8, 3), (12, 6), (10, 11), (7, 13), (5, 9), (6, 5)],
        [(5, 4), (10, 5), (12, 9), (10, 12), (6, 10), (4, 7)],
    ]
    chips = [[(2, 6), (3, 11)], [(2, 8), (4, 13)],
             [(3, 5), (3, 12)], [(2, 4), (3, 9)]]
    rim = facets[index]
    pen.polygon(rim, COLORS["blood_03"])
    pen.polygon([rim[0], rim[1], (9, 7), rim[5]], COLORS["ink_04"])
    pen.line([rim[5], (8, 8), (9, 7), rim[2]], COLORS["thunder_05"])
    pen.line([(8, 8), (9, 7)], COLORS["bronze_06"])
    pen.point(chips[index][0], COLORS["blood_05"])
    pen.point(chips[index][1], COLORS["thunder_06"])
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
              "brief": ("Kiln hammer with a broad brick crown, two glowing vents and a bound grip." if asset_id == HAMMER
                        else "A detached tumbling firebrick with a bright refractory seam and shedding embers."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    hammer = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(hammer, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / HAMMER).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / HAMMER / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(HAMMER, "held", 0, [12, 18], [hammer], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
