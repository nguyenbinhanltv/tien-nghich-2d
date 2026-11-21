"""Generate original Ember Reed and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
RELIC = "lt_ember_reed"
SHOT = "lt_ember_reed_shot"
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
    # The stalk splits above the grip and curves up the left rim of the glass.
    pen.polygon([(13, 28), (15, 23), (16, 18), (19, 18),
                 (18, 25), (16, 29)], COLORS["bronze_02"])
    for x, y in [(15, 26), (16, 23)]:
        pen.line([(x - 1, y), (x + 2, y + 1)], COLORS["blood_06"])
    pen.ellipse((13, 12, 26, 23), fill=COLORS["bronze_03"])
    pen.arc((13, 12, 26, 23), 155, 315, COLORS["bronze_06"])
    pen.ellipse((15, 13, 24, 21), fill=COLORS["ink_04"])
    pen.polygon([(15, 17), (18, 14), (21, 14), (16, 19)], COLORS["ink_06"])
    pen.point((23, 18), COLORS["bronze_06"])
    pen.polygon([(11, 21), (9, 16), (10, 11), (13, 7), (21, 2),
                 (20, 6), (15, 12), (14, 16), (15, 20), (18, 22),
                 (15, 23)], COLORS["jade_03"])
    pen.polygon([(10, 16), (11, 11), (14, 7), (20, 3),
                 (16, 8), (13, 12)], COLORS["jade_05"])
    pen.line([(10, 15), (12, 10), (16, 6)], COLORS["jade_07"])
    pen.line([(11, 17), (12, 20), (15, 22)], COLORS["bronze_05"])
    pen.line([(14, 21), (17, 22)], COLORS["blood_05"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # The two mirrored husks fold at different rates around the seed's axis.
    tips = [((3, 2), (4, 10)), ((1, 4), (3, 12)),
            ((2, 6), (4, 13)), ((4, 4), (2, 10))]
    upper, lower = tips[index]
    pen.polygon([upper, (7, 5), (10, 7), (7, 8)], COLORS["ink_04"])
    pen.line([upper, (7, 5), (9, 7)], COLORS["ink_06"])
    pen.polygon([lower, (6, 8), (10, 7), (8, 10)], COLORS["jade_03"])
    pen.line([lower, (7, 9)], COLORS["jade_05"])
    pen.polygon([(6, 7), (10, 6), (13, 8), (10, 9), (7, 9)], COLORS["blood_04"])
    pen.line([(7, 7), (10, 7), (12, 8)], COLORS["bronze_06"])
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
              "brief": ("A curved reed blade clasping a round mirror guard above a single corded grip." if asset_id == RELIC
                        else "A copper ember seed in flight with opening and folding reflective husks."),
              "parent_sources": [
                  {"id": parent, "path": (RAW / parent / "source.png").relative_to(ROOT).as_posix(),
                   "sha256": sha(RAW / parent / "source.png")}
                  for parent in ("lt_reed_blade", "lt_mirror_disc")
              ],
              "rights": "Original artwork created for this project.",
              "generator": script.relative_to(ROOT).as_posix(),
              "generator_sha256_lf": hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
              "palette": PALETTE.relative_to(ROOT).as_posix(), "native_px": [width, height],
              "pivot_px": pivot, "source": "source.png", "source_sha256": sha(raw / "source.png"),
              "contact_sheets": contact_hashes, "frames": records}
    (raw / "provenance.json").write_bytes((json.dumps(ledger, indent=2) + "\n").encode())


def main():
    relic = held()
    shots = [flight(i) for i in range(4)]
    contact = Image.new("RGBA", (110, 36))
    contact.paste(relic, (2, 2))
    for i, shot in enumerate(shots):
        contact.paste(shot, (37 + 18*i, 10))
    (RAW / RELIC).mkdir(parents=True, exist_ok=True)
    hashes = {}
    for scale in (1, 6):
        path = RAW / RELIC / f"contact_{scale}x.png"
        contact.resize((110*scale, 36*scale), Image.Resampling.NEAREST).save(path)
        hashes[path.relative_to(ROOT).as_posix()] = sha(path)
    export(RELIC, "held", 0, [16, 24], [relic], hashes)
    export(SHOT, "flight", 80, [8, 8], shots, hashes)


if __name__ == "__main__":
    main()
