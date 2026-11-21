"""Draw the Tide, Flare and Bell wards on their native grid with Pillow."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw/longtime"
FRAMES = ROOT / "assets/processed_longtime"
PARENT = Path("assets/raw/environment_items/props/prop_restriction_pillar/idle_00.png")
PALETTE = Path("tools/generators/palette.json")
C = {row["id"]: ImageColor.getcolor(row["hex"], "RGBA")
     for row in json.loads((ROOT / PALETTE).read_bytes())["colors"]}
SIZE = (32, 48)
CLIPS = (("idle", 1, 0), ("charge", 4, 120), ("release", 3, 80))


def socket(d, accent):
    d.polygon([(6, 39), (12, 36), (22, 36), (26, 39), (25, 44),
               (20, 45), (10, 45), (6, 43)], C["ink_03"])
    d.polygon([(6, 39), (12, 36), (22, 36), (26, 39), (20, 41),
               (11, 41)], C["ink_05"])
    d.line([(8, 39), (12, 37), (17, 37)], C["ink_06"])
    d.line([(13, 43), (18, 43)], C[accent])


def tide(d, clip, i):
    # A carved channel feeds a glazed basin on a stepped stone pier.
    d.polygon([(11, 26), (21, 25), (20, 39), (12, 39)], C["ink_03"])
    d.polygon([(12, 27), (16, 28), (15, 37), (12, 38)], C["ink_04"])
    d.line([(18, 29), (16, 31), (18, 33), (16, 35)], C["jade_05"])
    d.polygon([(5, 20), (26, 20), (23, 26), (17, 29), (9, 26)], C["jade_02"])
    d.ellipse((5, 18, 26, 23), C["jade_05"])
    d.ellipse((8, 19, 23, 21), C["jade_01"])
    heights = {"idle": (3,), "charge": (5, 8, 11, 14), "release": (14, 8, 4)}
    height = heights[clip][i]
    y = 20 - height
    d.polygon([(8, 20), (12, 17), (15, y+2), (18, y), (22, y+1),
               (23, y+4), (20, y+3), (18, y+4), (17, 18), (21, 20)], C["jade_04"])
    d.line([(12, 18), (16, y+2), (19, y+1), (21, y+2)], C["jade_07"])
    if clip == "release":
        for x, sign in [(6-i, -1), (25+i, 1)]:
            d.line([(x, 14+i*2), (x+sign*2, 11+i*2)], C["jade_06"])


def flare(d, clip, i):
    # A three-toothed bronze brazier holds a tall tapered ember.
    d.polygon([(11, 38), (14, 25), (18, 25), (22, 38), (17, 40)], C["bronze_02"])
    d.line([(15, 28), (14, 36)], C["bronze_05"])
    d.polygon([(5, 19), (11, 23), (16, 19), (21, 23), (27, 18),
               (23, 26), (17, 29), (10, 26)], C["bronze_04"])
    d.line([(6, 21), (11, 24), (15, 22)], C["bronze_06"])
    top = 16 if clip == "idle" else 13-3*i
    if clip == "release":
        top = (2, 8, 15)[i]
    d.polygon([(11, 22), (10, 17), (13, 18), (15, top+3), (18, top),
               (17, top+6), (21, top+4), (20, 18), (22, 17),
               (20, 22), (16, 24)], C["blood_05"])
    d.polygon([(13, 21), (15, top+6), (16, top+4), (16, 18),
               (19, 16), (18, 22)], C["bronze_06"])
    if clip == "release":
        for x, y in [(7-i, 9+i*2), (24+i, 7+i*2)]:
            d.polygon([(x, y-2), (x+1, y), (x, y+2), (x-1, y)], C["blood_06"])


def bell(d, clip, i):
    # A lintel, twin uprights and hanging loop keep the swinging bell legible.
    d.polygon([(8, 37), (7, 14), (10, 13), (12, 38)], C["ink_04"])
    d.polygon([(21, 38), (22, 13), (25, 14), (24, 38)], C["ink_03"])
    d.polygon([(5, 12), (10, 9), (22, 9), (27, 12),
               (25, 15), (7, 15)], C["bronze_03"])
    d.line([(7, 12), (11, 10), (20, 10)], C["bronze_06"])
    d.line([(16, 14), (16, 18)], C["bronze_05"])
    swing = 0 if clip == "idle" else (-1, 1, -2, 2)[i]
    if clip == "release":
        swing = (-3, 2, -1)[i]
    x = 16+swing
    d.polygon([(16, 17), (x+3, 19), (x+4, 25), (x+6, 28),
               (x-6, 28), (x-4, 25), (x-3, 20)], C["bronze_04"])
    d.line([(x-3, 24), (x-2, 20), (16, 18)], C["bronze_07"])
    d.ellipse((x-6, 26, x+6, 29), C["bronze_06"])
    d.line([(x-4, 28), (x+4, 28)], C["bronze_02"])
    d.ellipse((x+swing-1, 29, x+swing+1, 31), C["jade_05"])
    if clip == "charge":
        for j in range(i+1):
            d.point((12+2*j, 13), C["jade_07"])
    if clip == "release":
        left, right = 5-i, 26+i
        d.line([(left, 21+i), (left-2, 24+i), (left, 27+i)], C["jade_06"])
        d.line([(right, 21+i), (right+2, 24+i), (right, 27+i)], C["jade_06"])


def outlined(image):
    result = Image.new("RGBA", SIZE)
    for y in range(1, image.height-1):
        for x in range(1, image.width-1):
            if image.getpixel((x, y))[3]:
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    result.putpixel((x+dx, y+dy), C["ink_01"])
    result.alpha_composite(image)
    return result


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(name, draw, accent, brief):
    aid = "lt_ward_" + name
    raw, processed = RAW / aid, FRAMES / aid
    for folder in (raw, processed):
        folder.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (8*32, 48))
    contact = Image.new("RGBA", (8*36+8, 52))
    records = []
    for clip, length, ms in CLIPS:
        for i in range(length):
            image = Image.new("RGBA", SIZE)
            pen = ImageDraw.Draw(image)
            socket(pen, accent)
            draw(pen, clip, i)
            frame = outlined(image)
            key = f"{clip}_none_{i}"
            path = processed / (key+".png")
            frame.save(path)
            slot = len(records)
            xy = (32*slot, 0)
            sheet.paste(frame, xy)
            gap = {"idle": 0, "charge": 4, "release": 8}[clip]
            contact.paste(frame, (36*slot+gap+2, 2))
            records.append(dict(key=f"longtime/{aid}/{key}", path=path.relative_to(ROOT).as_posix(),
                                source_xy=xy, duration_ms=ms, sha256=sha(path)))
    source = raw / "source.png"
    sheet.save(source)
    contacts = {}
    for scale in (1, 4):
        p = raw / f"contact_{scale}x.png"
        contact.resize((contact.width*scale, contact.height*scale), Image.Resampling.NEAREST).save(p)
        contacts[p.relative_to(ROOT).as_posix()] = sha(p)
    script = Path(__file__).resolve()
    ledger = dict(id=aid, producer="OpenAI Codex", method="Original deterministic native-grid drawing.",
                  brief=brief, rights="Original artwork created for this project.",
                  parent_sources=[dict(id="prop_restriction_pillar", path=PARENT.as_posix(), sha256=sha(ROOT/PARENT))],
                  generator=script.relative_to(ROOT).as_posix(),
                  generator_sha256_lf=hashlib.sha256(script.read_text(encoding="utf-8").encode()).hexdigest(),
                  palette=PALETTE.as_posix(), native_px=SIZE, pivot_px=[16, 45], source="source.png",
                  source_sha256=sha(source), contact_sheets=contacts, frames=records)
    (raw/"provenance.json").write_bytes((json.dumps(ledger, indent=2)+"\n").encode())


if __name__ == "__main__":
    export("tide", tide, "jade_05", "A rising jade crest spills from a carved basin into twin sprays.")
    export("flare", flare, "blood_06", "A bronze brazier gathers an ember into a tall flame that sheds sparks.")
    export("bell", bell, "bronze_06", "A suspended bronze bell winds up and sends two ripples beyond its frame.")
