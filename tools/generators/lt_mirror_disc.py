"""Generate original Mirror Disc and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
DISC = "lt_mirror_disc"
SHOT = "lt_mirror_disc_shot"
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
    # The cast bronze collar narrows into a jade-wrapped grip.
    pen.rounded_rectangle((11, 14, 13, 21), radius=1, fill=COLORS["bronze_03"])
    pen.line((11, 16, 11, 20), COLORS["bronze_05"])
    pen.rectangle((11, 17, 13, 19), COLORS["jade_02"])
    pen.line((11, 19, 13, 17), COLORS["jade_05"])
    pen.line((11, 21, 13, 21), COLORS["bronze_04"])

    rim = (4, 1, 20, 17)
    pen.ellipse(rim, fill=COLORS["bronze_03"])
    pen.arc(rim, 180, 291, COLORS["bronze_06"])
    pen.arc(rim, 5, 94, COLORS["bronze_01"])
    pen.ellipse((6, 3, 18, 15), fill=COLORS["ink_03"])
    pen.ellipse((7, 4, 17, 14), fill=COLORS["ink_05"])
    # Reflections clipped to the silvered face, with a hard diagonal glint.
    for y in range(4, 15):
        for x in range(7, 18):
            if art.getpixel((x, y)) != COLORS["ink_05"]:
                continue
            if x + y <= 14 or 18 <= x + y <= 19:
                art.putpixel((x, y), COLORS["thunder_04"])
            elif x + y >= 25:
                art.putpixel((x, y), COLORS["ink_04"])
    for point in [(5, 9), (12, 2), (19, 9), (12, 16)]:
        pen.point(point, COLORS["bronze_07"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # A spinning bevel exposes more or less silver as the disc banks.
    left_y, right_y, depth, shine = [
        (10, 6, 2, 6), (8, 8, 3, 8), (6, 10, 2, 10), (8, 8, 1, 8)
    ][index]
    left, right = (2, left_y), (14, right_y)
    top, bottom = (8, 8-depth), (8, 8+depth)
    pen.polygon([left, top, right, bottom], fill=COLORS["bronze_03"])
    pen.polygon([left, top, right, (8, 8)], fill=COLORS["ink_05"])
    pen.line([left, top], COLORS["thunder_03"])
    pen.line([top, right], COLORS["ink_06"])
    pen.line([bottom, right], COLORS["bronze_05"])
    pen.point((shine, 7), COLORS["thunder_04"])
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
              "brief": ("Bronze-rimmed round mirror with rippled silver glass and a jade grip." if asset_id == DISC
                        else "Spinning lenticular mirror shard with a traveling glint."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    disc = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(disc, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / DISC).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / DISC / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(DISC, "held", 0, [12, 18], [disc], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
