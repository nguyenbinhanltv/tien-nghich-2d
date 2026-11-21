"""Generate original Jade Crucible and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
RELIC = "lt_jade_crucible"
SHOT = "lt_jade_crucible_shot"
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
    # The sloped kiln socket and the leaf share a spine across the head.
    pen.polygon([(2, 3), (8, 6), (13, 10), (16, 15), (11, 16),
                 (7, 13), (4, 8)], COLORS["jade_03"])
    pen.polygon([(3, 4), (9, 8), (14, 13), (10, 12), (6, 9)], COLORS["jade_05"])
    pen.line([(4, 5), (8, 8), (11, 11)], COLORS["jade_07"])
    pen.polygon([(14, 16), (18, 16), (18, 28), (15, 29)], COLORS["bronze_02"])
    pen.line([(15, 19), (15, 27)], COLORS["bronze_04"])
    for y in (22, 25):
        pen.line([(15, y + 1), (18, y - 1)], COLORS["bronze_06"])
    pen.polygon([(10, 12), (15, 8), (25, 7), (29, 10), (27, 17),
                 (19, 20), (12, 18)], COLORS["ink_03"])
    pen.polygon([(10, 12), (15, 8), (25, 7), (29, 10),
                 (23, 13), (14, 15)], COLORS["ink_05"])
    pen.polygon([(14, 12), (17, 10), (24, 9), (25, 10),
                 (21, 12), (16, 13)], COLORS["blood_02"])
    pen.line([(17, 12), (21, 11)], COLORS["bronze_06"])
    pen.polygon([(22, 14), (28, 11), (26, 16), (22, 18)], COLORS["ink_04"])
    for x, y in [(15, 16), (18, 15)]:
        pen.line([(x, y), (x + 1, y)], COLORS["blood_06"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)

    def turn(points):
        transformed = []
        for x, y in points:
            for _ in range(index):
                x, y = -y, x
            transformed.append((8 + x, 8 + y))
        return transformed

    # A long hooked rim and a short lip leave a break around the ember.
    pen.polygon(turn([(-6, -4), (-2, -3), (2, -3), (4, -1), (4, 2),
                      (1, 4), (-2, 4), (0, 2), (2, 1), (1, -1), (-3, -1)]),
                COLORS["jade_03"])
    pen.line(turn([(-5, -4), (-2, -2), (1, -2), (3, -1)]), COLORS["jade_06"])
    pen.ellipse((6, 6, 10, 10), fill=COLORS["blood_05"])
    pen.line([(7, 7), (8, 7)], COLORS["bronze_07"])
    pen.point((8, 8), COLORS["bronze_05"])
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
              "brief": ("A leaf-shaped jade horn growing from the lip of a vented kiln hammer around one shared grip." if asset_id == RELIC
                        else "An incandescent crucible bead tumbling inside a hooked jade shell."),
              "parent_sources": [
                  {"id": parent, "path": (RAW / parent / "source.png").relative_to(ROOT).as_posix(),
                   "sha256": sha(RAW / parent / "source.png")}
                  for parent in ("lt_jade_lance", "lt_kiln_hammer")
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
