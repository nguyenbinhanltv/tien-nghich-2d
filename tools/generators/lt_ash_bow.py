"""Generate original Ash Bow and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
BOW = "lt_ash_bow"
SHOT = "lt_ash_bow_shot"
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
    pen.line([(2, 8), (21, 4)], fill=COLORS["ink_05"])
    limb = [(2, 8), (3, 11), (3, 13), (5, 16), (8, 17), (11, 18),
            (14, 17), (17, 15), (19, 11), (19, 8), (21, 4)]
    pen.line(limb, fill=COLORS["bronze_02"], width=2)
    pen.line(limb[1:6], fill=COLORS["ink_04"])
    pen.line(limb[6:], fill=COLORS["ink_04"])
    pen.line([(4, 13), (5, 15), (7, 16)], fill=COLORS["ink_05"])
    pen.line([(17, 14), (18, 12)], fill=COLORS["ink_05"])
    pen.line([(9, 18), (12, 18), (14, 17)], fill=COLORS["blood_03"], width=3)
    for x, y in [(9, 17), (11, 17), (13, 16)]:
        pen.line([(x, y), (x+1, y+1)], fill=COLORS["thunder_06"])
    pen.point((2, 8), fill=COLORS["bronze_05"])
    pen.point((21, 4), fill=COLORS["bronze_05"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # Two displaced bands of trailing ash curl around a stable flaked point.
    upper, lower, mote = [
        ([(2, 5), (4, 5), (7, 8)], [(4, 10), (6, 9)], (2, 11)),
        ([(2, 6), (5, 6), (7, 8)], [(3, 11), (5, 10), (7, 9)], (2, 4)),
        ([(3, 7), (6, 7), (7, 8)], [(2, 10), (4, 10), (7, 9)], (3, 4)),
        ([(3, 5), (5, 6), (7, 8)], [(2, 9), (5, 9)], (2, 12)),
    ][index]
    pen.line(upper, fill=COLORS["ink_05"])
    pen.line(lower + [(8, 8)], fill=COLORS["ink_04"])
    pen.point(mote, fill=COLORS["ink_05"])
    pen.polygon([(6, 7), (8, 5), (9, 6), (14, 8), (8, 11), (8, 9), (5, 9)],
                fill=COLORS["ink_03"])
    pen.polygon([(6, 7), (8, 5), (9, 6), (13, 8), (8, 8)], fill=COLORS["ink_05"])
    pen.line([(8, 6), (10, 7)], fill=COLORS["ink_06"])
    pen.line([(8, 9), (10, 8)], fill=COLORS["blood_05"])
    pen.point((10, 8), fill=COLORS["thunder_06"])
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
              "brief": ("Crescent ashwood limbs, a pale string and a rust-red wrapped grip." if asset_id == BOW
                        else "Flaked cinder point trailing four phases of windblown ash."),
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    bow = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (100, 28))
    contact.paste(bow, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (28 + 18*i, 6))
    (RAW / BOW).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / BOW / f"contact_{scale}x.png"
        contact.resize((100*scale, 28*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(BOW, "held", 0, [12, 18], [bow], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
