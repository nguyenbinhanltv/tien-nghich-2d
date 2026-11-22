"""Draw the review pictures for the ember-orange ramp (orange_01..03) added to the master palette.

Writes two PNGs into assets/review/:
  orange_ramp_8x.png      the new orange ramp beside the blood (red) and bronze (yellow) ramps and the two
                          thunder reds, every colour as a 4x4 source-pixel block shown at 8x, with ids and hex
  orange_scarf_mockup.png a 32x32 mock-up figure with an orange scarf, at 1x and 4x, on a dark floor tone
The mock-up is a review aid made only from palette colours. It is not a game asset and is not shipped.
Every colour is read from tools/generators/palette.json; nothing is invented here.

Usage: python -I tools/scripts/make_orange_review.py
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "review"
PAL = {c["id"]: tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5))
       for c in json.loads((ROOT / "tools/generators/palette.json").read_text(encoding="utf-8"))["colors"]}
HEX = {k: "#%02x%02x%02x" % v for k, v in PAL.items()}
BG = (255, 255, 255)  # review sheet background only; never part of a sprite


def ramp_sheet() -> Image.Image:
    rows = [
        ("blood (red)", [f"blood_{i:02d}" for i in range(1, 8)]),
        ("orange (new)", [f"orange_{i:02d}" for i in range(1, 4)]),
        ("bronze (yellow)", [f"bronze_{i:02d}" for i in range(1, 8)]),
        ("thunder red", ["thunder_05", "thunder_06"]),
    ]
    block, scale, label_w, gap = 4, 8, 150, 30
    cell = block * scale
    pitch = 62
    w = label_w + 7 * pitch + 10
    h = len(rows) * (cell + gap) + 10
    sheet = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(sheet)
    for r, (title, ids) in enumerate(rows):
        y = 5 + r * (cell + gap)
        d.text((5, y + cell // 2 - 5), title, fill=(20, 16, 26))
        for i, cid in enumerate(ids):
            x = label_w + i * pitch
            # one block of 4x4 source pixels, enlarged 8x by whole-number nearest-neighbour
            tile = Image.new("RGB", (block, block), PAL[cid]).resize((cell, cell), Image.NEAREST)
            sheet.paste(tile, (x, y))
            d.text((x, y + cell + 2), cid, fill=(20, 16, 26))
            d.text((x, y + cell + 12), HEX[cid], fill=(20, 16, 26))
    return sheet


def figure() -> Image.Image:
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = im.load()

    def put(x, y, cid):
        px[x, y] = PAL[cid] + (255,)

    def rect(x0, y0, x1, y1, cid):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                put(x, y, cid)

    # robe (violet), shaded to the right, light from the top left
    rect(11, 19, 20, 27, "soul_04")
    rect(18, 19, 20, 27, "soul_03")
    rect(11, 19, 12, 27, "soul_05")
    rect(11, 24, 20, 24, "bronze_04")  # belt
    # feet
    rect(12, 28, 14, 28, "ink_02")
    rect(17, 28, 19, 28, "ink_02")
    # head: skin, hair cap, eyes
    for y in range(4, 17):
        for x in range(8, 24):
            if ((x - 15.5) / 8.0) ** 2 + ((y - 10.5) / 6.8) ** 2 <= 1:
                put(x, y, "blood_07" if x < 18 else "blood_06")
    rect(9, 3, 22, 7, "ink_02")
    for y in range(3, 8):
        for x in range(8, 24):
            if ((x - 15.5) / 8.0) ** 2 + ((y - 10.5) / 6.8) ** 2 > 1 and px[x, y][3]:
                px[x, y] = (0, 0, 0, 0)
    rect(12, 11, 13, 12, "ink_01")
    rect(18, 11, 19, 12, "ink_01")
    # orange scarf: band round the neck, one tail hanging down the right side
    rect(9, 17, 22, 18, "orange_02")
    rect(9, 17, 14, 17, "orange_03")  # lit from the top left
    rect(9, 19, 21, 19, "orange_01")  # shadow under the band
    rect(20, 20, 22, 26, "orange_02")
    rect(20, 20, 20, 25, "orange_03")
    rect(22, 21, 22, 26, "orange_01")
    rect(20, 27, 22, 27, "orange_01")
    # 1 px outline on the outer silhouette, ink_01
    out = im.copy()
    op = out.load()
    for y in range(32):
        for x in range(32):
            if px[x, y][3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < 32 and 0 <= ny < 32 and px[nx, ny][3]:
                    op[x, y] = PAL["ink_01"] + (255,)
                    break
    return out


def mockup_sheet(fig: Image.Image) -> Image.Image:
    floor = PAL["ink_03"]
    w, h = 32 + 8 + 128 + 16, 128 + 16
    sheet = Image.new("RGB", (w, h), floor)
    f1 = Image.new("RGBA", (32, 32), floor + (255,))
    f1.alpha_composite(fig)
    sheet.paste(f1.convert("RGB"), (8, 8))
    f4 = Image.new("RGBA", (32, 32), floor + (255,))
    f4.alpha_composite(fig)
    sheet.paste(f4.resize((128, 128), Image.NEAREST).convert("RGB"), (8 + 32 + 8, 8))
    d = ImageDraw.Draw(sheet)
    d.text((8, 44), "1x", fill=PAL["ink_06"])
    d.text((48, h - 12), "4x", fill=PAL["ink_06"])
    return sheet


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ramp_sheet().save(OUT / "orange_ramp_8x.png")
    fig = figure()
    # the figure itself must be palette-only with binary alpha
    pal = set(PAL.values())
    for r, g, b, a in fig.get_flattened_data() if hasattr(fig, 'get_flattened_data') else fig.getdata():
        assert a in (0, 255) and (a == 0 and (r, g, b) == (0, 0, 0) or (r, g, b) in pal), (r, g, b, a)
    mockup_sheet(fig).save(OUT / "orange_scarf_mockup.png")
    fig.save(OUT / "orange_scarf_mockup_32.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
