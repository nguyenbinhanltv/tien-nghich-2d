"""Generate original Brass Spindle and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
SPINDLE = "lt_brass_spindle"
SHOT = "lt_brass_spindle_shot"
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
    pen.polygon([(12, 1), (14, 7), (13, 17), (13, 21), (11, 22),
                 (10, 19), (11, 8)], COLORS["bronze_03"])
    pen.line([(12, 2), (12, 7)], COLORS["bronze_07"])
    # Wound silk narrows above the whorl. Its bands pick up the top-left light.
    pen.polygon([(11, 6), (14, 7), (15, 12), (9, 12)], COLORS["jade_03"])
    for y in (8, 10):
        pen.line([(10, y+1), (13, y)], COLORS["jade_06"])
    pen.ellipse((5, 10, 18, 16), fill=COLORS["bronze_02"])
    pen.ellipse((5, 9, 18, 14), fill=COLORS["bronze_04"])
    pen.arc((5, 9, 18, 14), 180, 285, fill=COLORS["bronze_07"])
    pen.line([(8, 13), (14, 13), (16, 12)], COLORS["bronze_05"])
    pen.ellipse((10, 10, 13, 12), fill=COLORS["bronze_03"])
    pen.rectangle((11, 17, 13, 20), fill=COLORS["jade_02"])
    pen.line([(11, 19), (13, 17)], COLORS["jade_05"])
    pen.point((11, 21), COLORS["bronze_06"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)

    def turn(x, y):
        for _ in range(index):
            x, y = -y, x
        return (8+x, 8+y)

    # One loose end sweeps a quarter turn per pose around the fixed brass hub.
    thread = [turn(*p) for p in [(1, -2), (3, -4), (4, -4), (6, -2), (6, 0)]]
    pen.line(thread, COLORS["jade_05"])
    pen.point(thread[-1], COLORS["jade_07"])
    pen.ellipse((4, 5, 12, 11), fill=COLORS["bronze_02"])
    pen.ellipse((4, 4, 12, 10), fill=COLORS["bronze_04"])
    pen.arc((4, 4, 12, 10), 180, 285, fill=COLORS["bronze_06"])
    pen.line([turn(-3, 0), turn(-1, 0)], COLORS["bronze_02"])
    pen.point((8, 8), COLORS["bronze_07"])
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
              "brief": ("A turned brass spindle with a weighted whorl, tapered tip and wrapped grip." if asset_id == SPINDLE
                        else "A spinning brass whorl drawing an asymmetric curl of jade thread."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    spindle = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(spindle, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / SPINDLE).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / SPINDLE / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(SPINDLE, "held", 0, [12, 18], [spindle], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
