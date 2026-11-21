"""Codex-authored, palette-native effects for the Blood Sea encounter."""
import json
import math
from PIL import Image, ImageDraw


def spirit_blade(draw, index, c):
    # An open forked trail and pale cutting edge travel to the right.
    shift = [0, 2, 1, 3][index]
    draw.polygon([(2 + shift, 5), (12, 7), (20, 7), (23, 8), (14, 11),
                  (4, 13), (8 + shift, 10), (0, 9), (10, 8)], fill=c["jade_03"])
    draw.polygon([(5 + shift, 7), (16, 7), (22, 8), (13, 10), (4, 10), (11, 8)], fill=c["jade_06"])
    draw.line([(12, 8), (21, 8)], fill=c["thunder_04"])
    draw.point((2 + shift, 11), fill=c["jade_05"])


def hit_spark(draw, index, c):
    # Unequal rays keep the hit distinct from the circular ground warnings.
    for ray in range(7):
        angle = ray * math.tau / 7 + .26
        end = min(15, 5 + index * 2 + ray % 3)
        start = max(1, end - (7 - index))
        point = lambda radius: (16 + round(math.cos(angle) * radius), 16 + round(math.sin(angle) * radius))
        draw.line([point(start), point(end)], fill=c["bronze_06"] if ray % 2 else c["jade_06"])
        draw.point(point(start), fill=c["thunder_04"])
    radius = max(0, 4 - index)
    if radius:
        draw.polygon([(16-radius,16),(16,16-radius),(16+radius,16),(16,16+radius)], fill=c["bronze_07"])


def seal_break(draw, index, c):
    # Eight fragments of a seal separate, shed sparks, then extinguish.
    radius = 7 + index * 3
    for arm in range(8):
        angle = math.tau * arm / 8
        def point(radius, offset=0):
            return (32 + round(math.cos(angle + offset) * radius), 32 + round(math.sin(angle + offset) * radius))
        width = max(.025, .23 - index * .025)
        draw.line([point(radius,-width),point(radius+1),point(radius,width)], fill=c["jade_06"], width=1)
        draw.line([point(radius-3),point(radius)], fill=c["bronze_05"])
        draw.point(point(radius+3,.07), fill=c["bronze_07"])
        if index < 5:
            draw.point(point(radius-6,.15), fill=c["soul_06"])


def claw_rake(draw, index, c):
    # Three hooked talons carve one lane, catching light behind the moving tips.
    for lane, row in enumerate((7, 16, 24)):
        tip = (32, 59, 85, 103, 113)[index] - lane * 3
        tail = max(2, tip - (31, 50, 61, 42, 20)[index])
        draw.polygon([(tail, row + 2), (tip - 9, row - 2), (tip, row - 5),
                      (tip - 4, row + 1), (tail + 5, row + 4)], fill=c["blood_04"])
        draw.line([(tail + 8, row + 2), (tip - 7, row - 1), (tip, row - 5)], fill=c["bronze_06"])
        draw.line([(tip - 3, row - 2), (tip, row - 5)], fill=c["thunder_04"])
        draw.point((tail - 1, row + 4), fill=c["blood_06"])


def seal_brand(draw, index, c):
    # A square seal set inside the round ward, its strokes splitting into four quadrants.
    for turn in range(4):
        def rotated(x, y):
            for _ in range(turn):
                x, y = -y, x
            return (32 + x, 32 + y)
        drift = (0, 1, 3, 5, 7)[index]
        corner = (10, 14, 16, 17, 18)[index]
        for stroke in (((2, corner), (corner, corner), (corner, 3)),
                       ((4, 8), (8, 8), (8, 2))):
            points = [rotated(x + drift, y + drift) for x, y in stroke]
            draw.line(points, fill=c["blood_03"], width=3)
            draw.line(points, fill=c["bronze_06"] if index < 3 else c["blood_05"])
            draw.point(points[0], fill=c["bronze_07"])
        draw.point(rotated(0, corner + drift + 3), fill=c["blood_06"])


def wail_mask(draw, index, c):
    # A tiny funerary mask with hollow eyes, a lengthening jaw and two drifting streamers.
    y = (6, 5, 4, 3, 2)[index]
    jaw = y + 9 + min(index, 3)
    draw.polygon([(5, y), (9, y + 2), (14, y + 2), (18, y), (17, y + 8),
                  (13, jaw), (10, jaw), (6, y + 8)], fill=c["soul_04"])
    draw.line([(6, y + 2), (10, y + 4), (12, y + 3), (16, y + 2)], fill=c["soul_07"])
    draw.line([(7, y + 5), (10, y + 6)], fill=c["ink_01"])
    draw.line([(13, y + 6), (16, y + 5)], fill=c["ink_01"])
    draw.rectangle((11, y + 8, 12, jaw - 1), fill=c["soul_01"])
    for x, sign in ((6, -1), (17, 1)):
        draw.line([(x, y + 6), (x - sign, y + 11), (x + sign * (2 + index % 2), jaw + 3),
                   (x + sign, jaw + 5)], fill=c["soul_05"])


CLIPS = [
    ("court_spirit_blade", "Spirit blade", 24, 16, 4, spirit_blade),
    ("court_hit_spark", "Strike impact", 32, 32, 6, hit_spark),
    ("court_seal_break", "Broken seal", 64, 64, 8, seal_break),
    ("court_claw_rake", "Claw rake", 120, 32, 5, claw_rake),
    ("court_seal_brand", "Soul seal brand", 64, 64, 5, seal_brand),
    ("court_wail_mask", "Wailing mask", 24, 28, 5, wail_mask),
]


def export_effects(out, palette):
    colors = {color["id"]: color["hex"] for color in palette["colors"]}
    page = Image.new("RGBA", (max(w * count for _, _, w, _, count, _ in CLIPS),
                              sum(h for _, _, _, h, _, _ in CLIPS)))
    frames, catalog = {}, {}
    y = 0
    for name, label, w, h, count, paint in CLIPS:
        catalog[name] = {"label": label, "frames": count}
        for index in range(count):
            tile = Image.new("RGBA", (w, h))
            paint(ImageDraw.Draw(tile), index, colors)
            page.paste(tile, (index*w,y))
            frames[f"vfx/{name}_{index}"] = {"frame": {"x":index*w,"y":y,"w":w,"h":h}, "ground":[w//2,h//2]}
        y += h
    page.save(out / "effects.png")
    data = {"frames": frames, "meta": {"image":"effects.png", "clips":catalog}}
    (out / "effects.json").write_bytes((json.dumps(data, indent=2) + "\n").encode("utf-8"))
