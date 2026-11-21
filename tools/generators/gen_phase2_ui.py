"""Reproduce the five phase-2 UI families on the native pixel grid (Codex original art).

Writes only matching source PNGs. Use build_processed.py --only for processed exports.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PALETTE = {c["id"]: c["hex"] for c in json.loads(
    (ROOT / "tools/generators/palette.json").read_text(encoding="utf-8"))["colors"]}


class Pixels:
    def __init__(self, size):
        self.image = Image.new("RGBA", size)
        self.draw = ImageDraw.Draw(self.image)

    def rect(self, box, color):
        self.draw.rectangle(box, fill=PALETTE[color])

    def poly(self, points, color):
        self.draw.polygon(points, fill=PALETTE[color])

    def line(self, points, color):
        self.draw.line(points, fill=PALETTE[color])

    def dot(self, xy, color):
        self.draw.point(xy, fill=PALETTE[color])

    def outlined(self):
        # Extend the silhouette one pixel on the cardinal grid. Keep interior highlights.
        alpha = self.image.getchannel("A")
        result = Image.new("RGBA", self.image.size)
        ink = Image.new("RGBA", self.image.size, PALETTE["ink_01"])
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            result.paste(ink, (dx, dy), alpha)
        result.paste(self.image, mask=alpha)
        return result


def card(clip, frame):
    p = Pixels((32, 40))
    # Chamfered bronze rails; the central 24x24 icon aperture is reserved.
    p.line([(1, 36), (1, 3), (3, 1), (28, 1)], "bronze_05")
    p.line([(28, 1), (30, 3), (30, 36), (28, 38), (3, 38), (1, 36)], "bronze_02")
    p.line([(2, 34), (2, 5), (5, 2), (26, 2)], "bronze_03")
    p.line([(29, 5), (29, 34), (26, 37), (5, 37)], "bronze_04")
    for x, sign in ((3, 1), (28, -1)):
        for y, step in ((3, 1), (36, -1)):
            p.line([(x, y + 4*step), (x, y), (x + 5*sign, y)], "bronze_04")
            p.dot((x + sign, y), "bronze_07")
    if clip == "rare":
        for y in (3, 36):
            p.poly([(9,y),(13,y-1),(16,y-2),(19,y-1),(22,y),(18,y+1),(15,y+2)], "jade_03")
            p.line([(12,y),(16,y-1),(19,y)], "jade_06")
        for x in (1, 30):
            p.rect((x, 13, x, 26), "jade_04")
    if clip == "forbidden":
        light = ["blood_03", "blood_05", "blood_07", "blood_06"][frame]
        for y, sign in ((3, 1), (36, -1)):
            p.line([(7,y),(11,y),(13,y+2*sign),(17,y+2*sign),(20,y),(24,y)], "blood_04")
            p.poly([(13,y),(15,y-2*sign),(18,y),(15,y+3*sign)], "blood_03")
            p.line([(14,y),(15,y-sign),(17,y)], light)
            p.dot((15,y+sign), "bronze_06")
        for x in (1, 30):
            p.rect((x, 16-frame, x, 23+frame), light)
    return p.outlined()


def bar(clip, frame):
    p = Pixels((64, 8))
    shadow, body, lit = {"hp": ("blood_02","blood_04","blood_06"),
                         "qi": ("jade_01","thunder_02","thunder_03"),
                         "boss_hp": ("blood_01","blood_03","blood_05")}[clip]
    p.poly([(1,3),(3,1),(60,1),(62,3),(62,4),(60,6),(3,6),(1,4)], shadow)
    p.rect((3,2,60,4), body)
    p.line([(4,2),(58,2)], lit)
    p.line([(4,5),(59,5)], body)
    p.line([(1,4),(3,2),(5,1)], "bronze_06")
    p.line([(59,6),(62,3)], "bronze_04")
    if clip == "boss_hp":
        for x in (15, 30, 45):
            p.line([(x,4),(x+2,2)], shadow)
            p.dot((x+1,4), "bronze_04")
    elif clip == "qi":
        for x in (11, 27, 43):
            p.line([(x,4),(x+3,3),(x+6,3)], "thunder_03")
    return p.outlined()


def minimap(clip, frame):
    p = Pixels((8, 8))
    if clip == "room":
        p.rect((1,2,6,5), "ink_04")
        p.rect((2,3,5,4), "ink_02")
        p.line([(2,2),(4,2)], "bronze_05")
    elif clip == "current":
        p.poly([(3,1),(6,4),(4,4),(4,6),(2,6),(2,4),(1,4)], ["thunder_02","thunder_03"][frame])
        p.dot((3,3), "thunder_04")
    elif clip == "boss":
        p.poly([(1,1),(3,3),(4,3),(6,1),(6,4),(4,6),(3,6),(1,4)], ["blood_04","blood_06"][frame])
        p.dot((2,3), "bronze_07")
        p.dot((5,3), "bronze_07")
        p.rect((3,5,4,5), "blood_02")
    elif clip == "shrine":
        p.poly([(1,3),(3,1),(4,1),(6,3)], "jade_06")
        p.rect((3,4,4,5), "jade_04")
        p.rect((1,6,6,6), "bronze_05")
    else:
        p.line([(2,2),(3,1),(5,1),(6,2),(5,3),(4,4)], "ink_05")
        p.dot((4,6), "ink_06")
    return p.outlined()


def furniture(clip, frame):
    p = Pixels((16, 16))
    if clip == "cursor":
        offset = frame
        p.poly([(2+offset,1+offset),(12+offset,8+offset),(8+offset,9+offset),
                (10+offset,13+offset),(8+offset,14),(6+offset,10+offset),(3+offset,13)], "bronze_04")
        p.poly([(3+offset,3+offset),(9+offset,7+offset),(6+offset,8+offset),(4+offset,10)],
               ["bronze_07","jade_06"][frame])
    elif clip == "nine_slice":
        p.rect((1,1,14,14), "bronze_03")
        p.rect((2,2,13,13), "ink_02")
        for x in (1,12):
            for y in (1,12):
                p.rect((x,y,x+2,y+2), "bronze_04")
                p.dot((x,y), "bronze_07")
                p.dot((x+1,y+1), "ink_03")
        p.line([(4,1),(11,1)], "bronze_05")
        p.line([(1,4),(1,11)], "bronze_05")
    else:
        y = 3 + (frame == 2)
        p.poly([(2,y+1),(3,y),(12,y),(14,y+2),(14,11),(12,13),(3,13),(1,11),(1,y+2)], "bronze_02")
        p.rect((3,y+1,12,10), ["ink_03","jade_03","ink_02"][frame])
        p.line([(2,9),(2,y+2),(4,y),(11,y)], ["bronze_05","jade_06","bronze_03"][frame])
        p.line([(5,y+4),(7,y+5),(10,y+3)], ["bronze_06","jade_07","bronze_04"][frame])
    return p.outlined()


def portrait(clip, frame):
    p = Pixels((48, 48))
    form = int(clip[-1])
    robe, shade, collar, piping = {
        1: ("ink_04","ink_03","ink_05","ink_06"),
        2: ("thunder_01","jade_01","ink_06","thunder_03"),
        3: ("blood_04","blood_02","blood_06","soul_05"),
        4: ("ink_02","soul_01","bronze_04","bronze_06")
    }[form]
    # Rear planes of the silhouette, including each form's identifying prop.
    if form == 1:
        p.poly([(37,22),(40,17),(41,20),(35,38),(32,38)], "bronze_02")
        p.line([(39,21),(34,35)], "bronze_04")
        p.line([(33,32),(38,34)], "bronze_03")
    elif form == 2:
        p.poly([(37,16),(39,12),(40,16),(36,33),(33,34)], "ink_05")
        p.line([(39,15),(35,29)], "thunder_03")
        p.line([(32,29),(38,31)], "bronze_05")
    elif form == 3:
        p.line([(39,7),(34,40)], "bronze_05")
        p.poly([(39,9),(45,11),(43,15),(45,19),(42,18),(42,22),(37,19)], "soul_04")
        p.line([(39,11),(42,12),(39,16),(41,17)], "soul_06")
    else:
        for pts in ([(38,5),(35,12),(39,11),(35,21)], [(7,19),(5,25),(9,24),(7,31)]):
            p.line(pts, "thunder_05")
            p.dot(pts[1], "thunder_06")

    # Rear hair, neck, and the triangular shoulder/lapel masses.
    p.poly([(13,15),(17,9),(27,8),(32,13),(33,24),(36,32),(32,37),
            (29,33),(18,34),(12,31),(14,24)], "ink_02")
    p.poly([(18,28),(26,27),(29,33),(35,35),(30,43),(16,40),(14,35),(18,33)], "bronze_02")
    p.poly([(19,28),(24,27),(24,33),(20,36),(16,34)], "blood_06")
    p.poly([(3,43),(7,37),(16,33),(20,37),(27,31),(35,33),(41,37),(45,44),
            (42,46),(6,46)], shade)
    p.poly([(5,43),(9,38),(15,35),(21,41),(18,46),(7,45)], robe)
    p.poly([(23,41),(30,33),(35,35),(40,39),(42,44),(36,42),(37,46),(20,46)], robe)
    p.line([(8,41),(11,38),(14,37)], collar)
    p.line([(30,35),(23,41),(20,45)], piping)
    p.poly([(13,34),(16,33),(22,38),(20,41)], collar)
    p.poly([(29,31),(32,33),(26,38),(19,46),(16,46),(21,38)], collar)
    p.line([(30,33),(24,39),(19,45)], shade)
    if form == 2:
        p.line([(28,37),(30,40),(34,41)], "bronze_05")
        p.rect((33,41,35,43), "jade_05")
        p.dot((33,41), "jade_07")
    if form == 4:
        p.line([(34,37),(38,39),(36,40),(40,42)], "bronze_04")

    # Fixed three-quarter face and identical eye line across the four busts.
    p.poly([(15,15),(18,12),(26,12),(30,16),(29,24),(26,28),(22,31),
            (18,30),(15,27),(14,22),(12,22),(12,19),(14,18)], "bronze_03")
    p.poly([(15,17),(18,14),(25,14),(28,16),(26,22),(26,26),(22,29),
            (19,29),(16,26),(15,23),(13,22),(12,20),(15,20)], "blood_07")
    p.poly([(25,17),(28,16),(28,22),(26,27),(22,29),(23,26),(25,25),(25,22)], "blood_06")
    p.line([(18,18),(21,19)], "ink_02")
    p.line([(24,18),(26,17)], "ink_02")
    p.line([(17,20),(20,20)], "ink_02")
    p.line([(24,20),(26,19)], "ink_02")
    p.dot((19,20), "thunder_05" if form == 4 else "bronze_02")
    p.line([(22,20),(21,23),(22,23)], "blood_06")
    p.line([(20,26),(23,25)], "blood_03")
    p.dot((20,27), "bronze_07")

    # Hair cap and directional comb highlights; tied knot for the first three forms.
    p.poly([(12,19),(12,14),(15,10),(19,8),(26,8),(31,12),(32,17),(30,23),
            (27,27),(28,18),(26,15),(24,14),(21,17),(22,14),(16,18),(17,15)], "ink_02")
    p.line([(14,14),(17,11),(21,10),(24,10)], "ink_04")
    p.line([(19,13),(23,11),(27,11)], "ink_03")
    p.line([(28,13),(30,16),(29,20)], "ink_03")
    if form != 4:
        p.poly([(19,8),(18,5),(20,2),(24,2),(27,5),(26,8),(23,10)], "ink_02")
        p.line([(20,5),(21,3),(24,3)], "ink_04")
        p.line([(18,8),(25,7)], ["bronze_03","thunder_02","blood_04"][form-1])
        if form == 3:
            p.line([(25,7),(29,6),(31,8)], "blood_05")
    else:
        p.poly([(14,13),(14,9),(19,5),(27,5),(32,9),(34,19),(33,26),(38,33),
                (34,32),(36,38),(30,34),(28,29),(31,23),(32,15),(28,10),(21,8)], "ink_02")
        p.line([(18,9),(22,6),(27,6),(30,8)], "ink_05")
        p.line([(32,12),(33,18),(31,25),(33,31)], "ink_04")
        p.line([(25,14),(23,17),(24,17),(23,19)], "thunder_05")
    return p.outlined()


FAMILIES = {"ui_card_frame": card, "ui_hud_bars": bar, "ui_minimap": minimap,
            "ui_form_portraits": portrait, "ui_panel_cursor": furniture}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-ui", type=Path, default=ROOT / "assets/raw/environment_items/ui")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8"))
    assets = {a["id"]: a for a in manifest["assets"]}
    for family, render in FAMILIES.items():
        directory = args.raw_ui / family
        directory.mkdir(parents=True, exist_ok=True)
        asset = assets[family]
        for clip, config in asset["animations"].items():
            for frame in range(config["frames"]):
                image = render(clip, frame)
                if image.size != tuple(asset["size"]):
                    raise ValueError(f"{family}/{clip}: wrong native canvas")
                image.save(directory / f"{family}_{clip}_{frame}.png")


if __name__ == "__main__":
    main()
