"""Generate original Cinder Mirror and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
MIRROR = "lt_cinder_mirror"
SHOT = "lt_cinder_mirror_shot"
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
    art = Image.new("RGBA", (32, 32))
    pen = ImageDraw.Draw(art)
    # Five enamel pleats diverge from the ferrule, framing the bright glass.
    hinge = (16, 22)
    crown = [(3, 12), (5, 6), (9, 8), (11, 3), (15, 5), (18, 2),
             (21, 6), (25, 4), (26, 9), (29, 8), (28, 14)]
    pen.polygon([hinge, *crown], COLORS["blood_03"])
    for outer, fold in zip(crown[::2], crown[1::2]):
        pen.polygon([hinge, outer, fold], COLORS["blood_05"])
        pen.line([outer, fold], COLORS["blood_06"])
        pen.line([fold, hinge], COLORS["bronze_04"])
    # The glass nests into the folds; its lower bezel becomes the grip ferrule.
    pen.ellipse((9, 9, 22, 21), fill=COLORS["bronze_02"])
    pen.arc((9, 9, 22, 21), 140, 310, fill=COLORS["bronze_06"])
    pen.ellipse((11, 10, 20, 18), fill=COLORS["ink_04"])
    pen.polygon([(11, 14), (14, 11), (17, 11), (12, 16)], COLORS["ink_06"])
    pen.line([(16, 17), (19, 14)], COLORS["ink_05"])
    pen.rectangle((15, 21, 17, 28), fill=COLORS["blood_02"])
    pen.rectangle((14, 21, 18, 22), fill=COLORS["bronze_05"])
    for y in (24, 27):
        pen.line([(15, y + 1), (17, y - 1)], COLORS["blood_06"])
    pen.line([(15, 29), (17, 29)], COLORS["bronze_05"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)

    def pose(points):
        result = []
        for x, y in points:
            for _ in range(index):
                x, y = -y, x
            result.append((8 + x, 8 + y))
        return result

    pen.polygon(pose([(-6, -4), (-1, -2), (1, -3), (4, -1), (2, 2),
                      (-3, 3), (-5, 4), (-3, 1), (-1, 0)]), COLORS["blood_05"])
    pen.line(pose([(-5, -3), (-2, -2), (0, -1)]), COLORS["bronze_06"])
    pen.polygon(pose([(-2, 0), (2, -3), (5, -2), (3, 1), (0, 2)]), COLORS["ink_04"])
    pen.line(pose([(-2, 0), (2, -3), (4, -2)]), COLORS["ink_06"])
    pen.line(pose([(0, 1), (3, -1)]), COLORS["bronze_05"])
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
              "method": "Original native-grid drawing from parent silhouette references; no random seed.",
              "brief": ("Pleated ember ribs cradle a round mirror above one wrapped grip." if asset_id == MIRROR
                        else "A tumbling mirror shard trailing a fork of cinders."),
              "parent_sources": [
                  {"id": parent, "path": (RAW / parent / "source.png").relative_to(ROOT).as_posix(),
                   "sha256": sha(RAW / parent / "source.png")}
                  for parent in ("lt_ember_fan", "lt_mirror_disc")
              ],
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    mirror = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (110, 36))
    contact.paste(mirror, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (37 + 18*i, 10))
    (RAW / MIRROR).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / MIRROR / f"contact_{scale}x.png"
        contact.resize((110*scale, 36*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(MIRROR, "held", 0, [16, 24], [mirror], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
