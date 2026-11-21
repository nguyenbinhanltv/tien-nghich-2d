"""Generate original Ember Fan and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
FAN = "lt_ember_fan"
SHOT = "lt_ember_fan_shot"
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
    hinge = (12, 16)
    # A scalloped paper leaf. The left planes catch light across the folds.
    tips = [(2, 9), (5, 5), (10, 3), (16, 3), (21, 7)]
    valleys = [(4, 8), (8, 5), (13, 4), (18, 6)]
    for i, valley in enumerate(valleys):
        pen.polygon([hinge, tips[i], valley], COLORS["blood_05"])
        pen.polygon([hinge, valley, tips[i+1]], COLORS["blood_03"])
        pen.line([valley, tips[i+1]], COLORS["thunder_06"])
    for tip in tips:
        pen.line([tip, hinge], COLORS["bronze_03"])
    pen.line([tips[0], hinge], COLORS["bronze_05"])
    pen.line([(12, 16), (12, 21)], COLORS["bronze_04"], width=2)
    pen.line([(13, 17), (13, 21)], COLORS["bronze_02"])
    pen.point((12, 16), COLORS["bronze_07"])
    pen.line([(12, 20), (13, 20)], COLORS["blood_03"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # Split tongues flutter behind a coal with a stationary pointed nose.
    upper, lower, notch = [
        ((2, 3), (3, 12), (6, 8)),
        ((1, 4), (4, 13), (7, 8)),
        ((3, 5), (1, 12), (6, 9)),
        ((4, 3), (2, 11), (5, 8)),
    ][index]
    pen.polygon([upper, (8, 6), (10, 5), (14, 8), (10, 10),
                 (7, 10), lower, notch], COLORS["blood_04"])
    pen.polygon([upper, (8, 7), (10, 6), (13, 8), (9, 9)],
                COLORS["thunder_05"])
    pen.line([lower, (7, 9), (10, 9)], COLORS["blood_05"])
    pen.polygon([(7, 8), (9, 7), (11, 7), (12, 8), (9, 9)],
                COLORS["bronze_05"])
    pen.line([(8, 8), (10, 7)], COLORS["bronze_07"])
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
              "brief": ("Scalloped crimson leaf, bronze ribs and wrapped grip." if asset_id == FAN
                        else "Forked ember tongues streaming behind a pointed incandescent coal."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    fan = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(fan, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / FAN).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / FAN / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(FAN, "held", 0, [12, 18], [fan], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
