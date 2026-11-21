"""Generate original Mist String and flight art from native pixel geometry (Pillow)."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
PROCESSED = ROOT / "assets/processed_longtime"
RELIC = "lt_mist_string"
SHOT = "lt_mist_string_shot"
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
    # The string runs from the short wooden nock to the eye of the long needle.
    pen.line([(3, 14), (25, 10)], COLORS["soul_05"])
    pen.line([(5, 14), (12, 12)], COLORS["soul_06"])
    pen.polygon([(2, 12), (5, 15), (7, 19), (12, 21), (17, 22),
                 (22, 17), (25, 11), (26, 12), (24, 19), (19, 25),
                 (15, 26), (8, 23), (4, 19)], COLORS["ink_03"])
    pen.line([(3, 15), (6, 19), (11, 22)], COLORS["ink_05"])
    pen.line([(4, 16), (5, 15)], COLORS["bronze_05"])
    # A faceted needle grows from the opposite shoulder of the stave.
    pen.polygon([(20, 20), (22, 14), (28, 4), (29, 2), (28, 9),
                 (25, 17), (22, 21)], COLORS["ink_04"])
    pen.line([(21, 18), (23, 13), (29, 2)], COLORS["ink_06"])
    pen.line([(24, 12), (26, 9)], COLORS["soul_03"])
    pen.line([(21, 18), (24, 19)], COLORS["bronze_05"])
    pen.polygon([(10, 22), (14, 22), (19, 21), (20, 24),
                 (16, 27), (12, 26)], COLORS["soul_03"])
    for x in (12, 15, 18):
        pen.line([(x, 23), (x + 1, 25)], COLORS["soul_05"])
    pen.point((16, 24), COLORS["soul_06"])
    return outlined(art)


def flight(index):
    art = Image.new("RGBA", (16, 16))
    pen = ImageDraw.Draw(art)
    # The head tracks forward as a four-pose transverse wave passes down the tail.
    waves = [
        [(1, 7), (3, 4), (5, 4), (7, 7)],
        [(1, 9), (3, 7), (4, 5), (6, 5), (7, 7)],
        [(1, 11), (3, 11), (5, 8), (7, 7)],
        [(1, 8), (3, 10), (5, 11), (7, 9), (7, 7)],
    ]
    wave = waves[index]
    pen.line(wave, COLORS["soul_05"])
    pen.point(wave[1], COLORS["soul_06"])
    pen.polygon([(6, 7), (9, 6), (14, 6), (11, 8), (7, 9)], COLORS["ink_04"])
    pen.line([(8, 7), (11, 6), (14, 6)], COLORS["ink_06"])
    pen.line([(7, 7), (8, 9)], COLORS["bronze_05"])
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
              "brief": ("An ashwood crescent with a silver needle limb and a violet bowstring above one grip." if asset_id == RELIC
                        else "A silver dart drawing a traveling violet ripple through the mist."),
              "parent_sources": [
                  {"id": parent, "path": (RAW / parent / "source.png").relative_to(ROOT).as_posix(),
                   "sha256": sha(RAW / parent / "source.png")}
                  for parent in ("lt_mist_needle", "lt_ash_bow")
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
