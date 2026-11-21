"""Generate original Shard Needle and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
RELIC = "lt_shard_needle"
SHOT = "lt_shard_needle_shot"
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
    # A taut silver string bridges the unequal nocks above the bell mouth.
    pen.line([(3, 10), (27, 5)], COLORS["ink_05"])
    pen.line([(4, 10), (10, 9)], COLORS["ink_06"])
    pen.polygon([(2, 8), (5, 12), (7, 16), (14, 19), (17, 20),
                 (23, 15), (26, 9), (27, 4), (29, 3), (28, 12),
                 (24, 18), (18, 23), (12, 22), (5, 18), (3, 14)], COLORS["ink_03"])
    pen.line([(3, 12), (6, 16), (11, 19)], COLORS["ink_05"])
    pen.line([(24, 15), (27, 9)], COLORS["ink_04"])
    for tip in [(3, 10), (27, 6)]:
        pen.point(tip, COLORS["bronze_06"])
    pen.polygon([(14, 19), (18, 18), (19, 27), (17, 29), (15, 27)], COLORS["jade_02"])
    for y in (23, 26):
        pen.line([(15, y + 1), (18, y - 1)], COLORS["jade_05"])
    # The flared lip and its dark open throat read independently of the limbs.
    pen.polygon([(9, 14), (22, 11), (20, 15), (18, 20),
                 (15, 21), (13, 17)], COLORS["bronze_04"])
    pen.polygon([(10, 14), (13, 14), (16, 19), (13, 17)], COLORS["bronze_06"])
    pen.ellipse((8, 11, 22, 15), fill=COLORS["bronze_06"])
    pen.ellipse((10, 12, 20, 14), fill=COLORS["bronze_01"])
    pen.line([(14, 13), (17, 13)], COLORS["jade_05"])
    pen.point((16, 12), COLORS["jade_07"])
    pen.line([(15, 20), (18, 19)], COLORS["bronze_02"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # Two staggered wave crests curl around the silver core as it travels.
    crests = [
        ([(3, 7), (3, 4), (5, 3), (7, 4)], [(6, 10), (8, 11), (9, 9)]),
        ([(3, 6), (5, 3), (7, 3), (8, 5)], [(5, 10), (7, 12), (9, 11)]),
        ([(5, 6), (7, 4), (9, 5)], [(4, 9), (5, 12), (8, 13), (9, 11)]),
        ([(6, 6), (7, 5), (8, 6)], [(3, 9), (4, 11), (7, 12), (8, 10)]),
    ]
    upper, lower = crests[index]
    pen.line(upper, COLORS["jade_05"])
    pen.point(upper[1], COLORS["jade_07"])
    pen.line(lower, COLORS["jade_03"])
    pen.point(lower[-1], COLORS["jade_05"])
    pen.polygon([(2, 9), (6, 7), (14, 6), (10, 8), (6, 9)], COLORS["ink_04"])
    pen.line([(6, 7), (10, 7), (14, 6)], COLORS["ink_06"])
    pen.line([(5, 8), (6, 9)], COLORS["bronze_05"])
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
              "brief": ("An ashwood bow with a hollow bronze bell at its center and a single tide-wrapped grip." if asset_id == RELIC
                        else "A silver needle passing through an oscillating broken tide ring."),
              "parent_sources": [
                  {"id": parent, "path": (RAW / parent / "source.png").relative_to(ROOT).as_posix(),
                   "sha256": sha(RAW / parent / "source.png")}
                  for parent in ("lt_tide_bell", "lt_ash_bow")
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
