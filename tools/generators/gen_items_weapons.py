"""Draw manifest-assigned weapons, projectiles and props as deterministic PNGs.

Run from any directory. --out replaces assets/raw/environment_items as the
output root; --only restricts generation to one manifest ID. Every run checks
frame dimensions, palette membership, alpha, silhouette and animation changes.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path("assets/raw/environment_items")
GROUPS = {"weapons", "projectiles", "props"}

JADE = ("jade_01", "jade_03", "jade_05", "jade_07")
BLOOD = ("blood_02", "blood_04", "blood_05", "blood_07")
GOLD = ("bronze_01", "bronze_03", "bronze_05", "bronze_07")
SOUL = ("soul_01", "soul_03", "soul_05", "soul_07")
CYAN = ("thunder_01", "thunder_02", "thunder_03", "thunder_04")
RED = ("blood_03", "thunder_05", "thunder_06", "blood_07")
STONE = ("ink_02", "ink_03", "ink_05", "ink_06")

WEAPON_RAMPS = {
    "heaven_defying_bead": CYAN, "soul_banner": SOUL,
    "restriction_talisman": GOLD, "azure_wind_sword": JADE,
    "slaughter_sword": BLOOD, "blood_jade_blade": BLOOD,
    "thunder_seal": RED, "blood_fiend_banner": BLOOD,
    "ancient_god_hammer": GOLD, "soul_lamp": SOUL,
    "five_element_needles": JADE, "spirit_stone_beads": CYAN,
}


class Sprite:
    """Draw integer primitives in a 32-unit design grid onto a native canvas."""

    def __init__(self, size, palette):
        self.image = Image.new("RGBA", tuple(size))
        self.draw = ImageDraw.Draw(self.image)
        self.palette = palette
        self.width, self.height = size

    def point(self, point):
        x, y = point
        return (round(1 + x * (self.width - 3) / 32),
                round(1 + y * (self.height - 3) / 32))

    def poly(self, color, *points):
        self.draw.polygon([self.point(p) for p in points], self.palette[color])

    def line(self, color, *points, width=1):
        self.draw.line([self.point(p) for p in points], self.palette[color],
                       width=max(1, round(width * min(self.width, self.height) / 32)))

    def oval(self, color, x, y, rx, ry):
        self.draw.ellipse((self.point((x-rx, y-ry)), self.point((x+rx, y+ry))),
                          self.palette[color])

    def box(self, color, x, y, right, bottom):
        self.draw.rectangle((self.point((x, y)), self.point((right, bottom))),
                            self.palette[color])

    def gem(self, ramp, x, y, r):
        dark, mid, bright, shine = ramp
        self.poly(dark, (x, y-r), (x+r, y), (x, y+r), (x-r, y))
        self.poly(mid, (x, y-r), (x+r, y), (x, y+r), (x-1, y))
        self.poly(bright, (x, y-r), (x-1, y), (x-r, y))
        self.line(shine, (x-r/2, y-1), (x-1, y-r/2))

    def outline(self):
        mask = np.asarray(self.image)[:, :, 3] != 0
        padded = np.pad(mask, 1)
        neighbors = (padded[:-2, 1:-1] | padded[2:, 1:-1]
                     | padded[1:-1, :-2] | padded[1:-1, 2:])
        pixels = np.array(self.image)
        pixels[neighbors & ~mask] = (*self.palette["ink_01"], 255)
        return Image.fromarray(pixels)


def orbit(s, ramp, phase, x=16, y=16, rx=12, ry=8, count=5):
    for i in range(count):
        angle = phase + math.tau * i / count
        px, py = x + rx * math.cos(angle), y + ry * math.sin(angle)
        s.oval(ramp[2 if i else 3], px, py, 0.85 if i else 1.6, 0.7 if i else 1.2)


def sigil(s, color, x, y, r):
    s.line(color, (x-r, y-r/2), (x+r, y-r/2))
    s.line(color, (x, y-r), (x, y+r), (x+r/2, y+r/2))
    s.line(color, (x-r, y+r/2), (x, y), (x+r, y+r/2))


def sword(s, ramp, kind, y=0):
    dark, mid, bright, shine = ramp
    if kind == "blood_jade_blade":
        edge = [(11, 21), (19, 10), (27, 8), (25, 16), (16, 24)]
    elif kind == "slaughter_sword":
        edge = [(9, 20), (18, 8), (21, 9), (29, 2), (27, 15), (15, 24)]
    else:
        edge = [(11, 20), (23, 6), (29, 3), (27, 10), (15, 23)]
    s.line(GOLD[1], (5, 27+y), (14, 19+y), width=4)
    s.line(GOLD[3], (6, 26+y), (12, 21+y))
    s.poly(mid, *((x, py+y) for x, py in edge))
    s.poly(dark, *((x, py+y) for x, py in [edge[0], edge[-2], edge[-1]]))
    tip = edge[2] if kind != "slaughter_sword" else edge[3]
    s.line(bright, *((x, py+y) for x, py in edge[:edge.index(tip)+1]), width=2)
    s.line(shine, (edge[1][0], edge[1][1]+y), (tip[0]-1, tip[1]+1+y))
    s.line(GOLD[2], (9, 18+y), (16, 25+y), width=3)
    s.gem(ramp, 13, 21+y, 2)


def banner(s, ramp, wave, sect=False):
    dark, mid, bright, shine = ramp
    s.line(GOLD[1], (8, 29), (8, 5), width=3)
    s.line(GOLD[2], (7, 28), (7, 5))
    s.poly(dark, (9, 6), (15, 7), (21, 5+wave), (28, 7+wave),
           (25, 15+wave), (28, 22+wave), (21, 20+wave), (14, 23), (9, 21))
    s.poly(mid, (9, 6), (15, 7), (21, 5+wave), (28, 7+wave),
           (23, 10+wave), (20, 17+wave), (14, 19), (9, 15))
    s.line(bright, (10, 8), (15, 9), (21, 7+wave), (25, 8+wave))
    if sect:
        sigil(s, shine, 16, 13, 4)
    else:
        s.oval(bright, 16, 13, 4, 4)
        s.box(shine, 14, 13, 18, 16)
        s.oval(dark, 14, 12, 1, 1)
        s.oval(dark, 18, 12, 1, 1)
    s.gem(GOLD, 8, 4, 2)


def talisman(s, offset=0):
    s.poly(GOLD[1], (6, 10), (19, 4), (24, 20), (10, 27))
    s.poly(GOLD[2], (8+offset, 8), (22+offset, 4), (26, 22), (13, 27))
    s.poly(GOLD[3], (8+offset, 8), (22+offset, 4), (23, 7), (10, 11))
    sigil(s, BLOOD[1], 17+offset, 15, 5)
    s.line(GOLD[0], (14, 23), (21, 21))


def bolt(s, ramp, offset):
    points = [(21, 3), (10+offset, 15), (18, 15), (12, 28), (25, 12), (18, 12)]
    s.poly(ramp[1], *points)
    s.line(ramp[3], (21, 4), (12+offset, 14), (19, 14), (14, 25))
    s.line(ramp[2], (23, 11), (28, 7+offset))
    s.line(ramp[2], (12, 17), (6, 22-offset))


def flame(s, ramp, x, y, sway):
    s.poly(ramp[1], (x-5, y), (x-7, y-5), (x-3, y-11),
           (x-2+sway, y-7), (x+3+sway, y-16), (x+6, y-6), (x+4, y))
    s.poly(ramp[2], (x-4, y-1), (x-3, y-6), (x, y-4),
           (x+2+sway, y-10), (x+4, y-4), (x+2, y))
    s.oval(ramp[3], x, y-2, 2, 2)


def needles(s, spread):
    ramps = (SOUL, CYAN, JADE, GOLD, BLOOD)
    for i, ramp in enumerate(ramps):
        tip = (13+i*3, 4+i*(2+spread))
        tail = (5+i*3, 25+i//2)
        s.line(ramp[1], tail, tip, width=2)
        s.line(ramp[3], tip, (tip[0]-2, tip[1]+4))


def draw_weapon(s, kind, animation, frame, phase):
    ramp = WEAPON_RAMPS[kind]
    attack = animation == "attack"
    wave = (0, 2, 1, -2)[frame % 4] if attack else 0
    if kind == "heaven_defying_bead":
        s.oval(SOUL[1], 16, 16, 7, 7)
        s.oval(SOUL[0], 17, 17, 5, 5)
        s.line(CYAN[1], (11, 16), (12, 12), (16, 10), (19, 11))
        s.line(CYAN[3], (12, 14), (14, 12), (16, 12))
        s.gem(GOLD, 17, 17, 3)
        orbit(s, CYAN, phase, rx=12, ry=9) if attack else s.oval(GOLD[2], 21, 20, 1, 1)
    elif kind in {"soul_banner", "blood_fiend_banner"}:
        banner(s, ramp, wave)
    elif kind in {"azure_wind_sword", "slaughter_sword", "blood_jade_blade"}:
        if attack:
            s.line(ramp[1], (6, 15-wave), (11, 9-wave), (18, 5-wave))
            s.oval(ramp[2], 23, 23+wave, 1, 1)
        sword(s, ramp, kind, wave)
    elif kind == "restriction_talisman":
        talisman(s, wave)
        if attack:
            orbit(s, GOLD, phase, count=3)
    elif kind == "thunder_seal":
        s.poly(GOLD[1], (5, 15), (14, 10), (26, 13), (26, 23), (16, 28), (5, 24))
        s.poly(GOLD[2], (5, 15), (14, 10), (26, 13), (16, 19))
        s.gem(JADE, 15, 12, 7)
        sigil(s, ramp[2], 17, 21, 4)
        if attack:
            s.line(ramp[3], (20, 8+wave), (25, 5), (24, 10), (29, 6+wave))
    elif kind == "ancient_god_hammer":
        s.line(GOLD[1], (6, 28), (21, 13+wave), width=6)
        s.line(GOLD[2], (6, 27), (21, 12+wave), width=2)
        s.poly(STONE[1], (10, 7+wave), (19, 3+wave), (28, 7+wave),
               (28, 17+wave), (20, 22+wave), (10, 17+wave))
        s.poly(STONE[2], (10, 7+wave), (19, 3+wave), (28, 7+wave), (20, 12+wave))
        s.line(STONE[3], (11, 7+wave), (19, 4+wave), (25, 7+wave))
        sigil(s, GOLD[2], 21, 15+wave, 3)
    elif kind == "soul_lamp":
        flame(s, ramp, 16, 20, wave)
        s.oval(GOLD[1], 16, 24, 9, 4)
        s.oval(GOLD[2], 16, 21, 9, 3)
        s.oval(SOUL[1], 16, 21, 6, 1)
        s.line(GOLD[3], (8, 21), (12, 22), (16, 22))
    elif kind == "five_element_needles":
        needles(s, (0, 1, 0, -1)[frame % 4] if attack else 0)
        if attack:
            orbit(s, GOLD, phase, count=3)
    elif kind == "spirit_stone_beads":
        for i, (x, y) in enumerate(((9, 17), (17, 11), (23, 20))):
            s.gem(ramp, x, y+wave*((-1)**i), 5)
        if attack:
            orbit(s, ramp, phase, count=4)


def draw_projectile(s, kind, animation, frame, phase):
    ramp = WEAPON_RAMPS[kind]
    wave = (0, 2, 1, -2)[frame % 4]
    if animation == "impact":
        radius = 4 + 3*frame
        orbit(s, ramp, phase, rx=radius, ry=radius*0.8, count=4)
        if frame < 3:
            s.gem(ramp, 16, 16, 8-2*frame)
        if kind == "restriction_talisman":
            sigil(s, GOLD[2], 16, 16, radius/2+2)
        return
    if kind in {"azure_wind_sword", "slaughter_sword"}:
        s.line(ramp[1], (3, 22+wave), (11, 16+wave), width=2)
        sword(s, ramp, kind, wave)
    elif kind in {"soul_banner", "blood_fiend_banner"}:
        s.poly(ramp[1], (8, 19), (4, 26+wave), (16, 24), (24, 15), (9, 10))
        s.oval(ramp[2], 17, 13+wave, 9, 8)
        s.box(ramp[3], 13, 15+wave, 21, 23+wave)
        s.oval(ramp[0], 13, 12+wave, 2, 2)
        s.oval(ramp[0], 21, 12+wave, 2, 2)
        s.oval(ramp[0], 17, 20+wave, 2, 3)
    elif kind == "blood_jade_blade":
        s.poly(ramp[1], (4, 26), (11, 20+wave), (16, 13), (19, 4),
               (24, 8), (25, 15), (20, 22), (12, 26))
        s.line(ramp[3], (19, 5), (23, 9), (23, 15), (20, 20), (12, 25))
        s.oval(ramp[2], 5+3*frame, 28-frame, 1, 1)
    elif kind == "thunder_seal":
        bolt(s, ramp, wave)
        s.oval(ramp[2], 28, 9+4*frame, 1, 1)
    elif kind == "restriction_talisman":
        talisman(s, wave)
    elif kind == "ancient_god_hammer":
        s.oval(STONE[1], 16, 19, 11, 6)
        orbit(s, ramp, phase, y=18, rx=10, ry=4)
        s.gem(ramp, 16, 15, 5)
    elif kind == "soul_lamp":
        flame(s, ramp, 16, 23, wave)
    elif kind == "five_element_needles":
        needles(s, (0, 1, 0, -1)[frame % 4])
        orbit(s, ramp, phase, count=3)
    else:
        s.oval(ramp[1], 16, 15, 6, 5)
        s.gem(ramp, 17, 14, 4)
        orbit(s, ramp, phase, rx=10, ry=7, count=3)


def block(s, ramp, x, y, w, h, depth=4):
    """Draw an extruded, straight-on top face and two shaded sides."""
    dark, mid, bright, shine = ramp
    s.poly(mid, (x, y), (x+w, y), (x+w, y+h), (x, y+h))
    s.poly(dark, (x+w, y), (x+w+depth, y-depth),
           (x+w+depth, y+h-depth), (x+w, y+h))
    s.poly(bright, (x, y), (x+depth, y-depth), (x+w+depth, y-depth), (x+w, y))
    s.line(shine, (x+1, y-1), (x+depth, y-depth), (x+w-1, y-depth))


def fragments(s, ramp, frame, seed):
    rng = np.random.default_rng(seed)
    for i in range(6):
        x = 6 + i*4
        y = min(29, 19 + int(rng.integers(0, 4)) + abs(frame-i%3))
        r = int(rng.integers(2, 4))
        s.poly(ramp[1], (x-r, y+1), (x-1, y-r), (x+r, y-1), (x+1, y+2))
        s.line(ramp[2], (x-r+1, y), (x-1, y-r))


def floor_ring(s, ramp, phase, state):
    s.oval(ramp[0], 16, 21, 13, 8)
    s.oval(ramp[1], 16, 19, 13, 7)
    s.oval(STONE[0], 16, 19, 10, 5)
    if state != "closed":
        s.oval(ramp[0], 16, 19, 8, 4)
        sigil(s, ramp[2], 16, 19, 4)
        orbit(s, ramp, phase, y=18, rx=11, ry=6, count=5)
        if state in {"activate", "spawn"}:
            s.gem(ramp, 16, 13+3*math.sin(phase), 5)


def draw_prop(s, kind, state, frame, phase):
    wave = round(3 * math.sin(phase) + math.cos(phase))
    if kind == "spirit_chest":
        angle = 0 if state == "closed" else frame+1 if state == "opening" else 5
        block(s, GOLD, 5, 20, 19, 8)
        if angle:
            block(s, GOLD, 5, 20-angle*2, 19, 5)
            s.poly(GOLD[0], (5, 20), (9, 16), (28, 16), (24, 20))
            for x, y in ((11, 17), (17, 16), (22, 17)):
                s.gem(JADE, x, y, min(3, angle+1))
        else:
            block(s, GOLD, 5, 16, 19, 5)
        s.box(GOLD[0], 13, 20, 17, 25)
        s.gem(JADE, 15, 22, 2)
        s.line(GOLD[2], (8, 22), (8, 27))
        s.line(GOLD[2], (21, 22), (21, 27))
    elif kind == "alchemy_jar":
        if state == "intact":
            s.oval(JADE[0], 16, 19, 9, 10)
            s.oval(JADE[1], 14, 17, 7, 8)
            s.line(JADE[2], (9, 15), (10, 12), (13, 11))
            s.oval(GOLD[1], 16, 9, 6, 4)
            s.oval(GOLD[2], 16, 7, 6, 2)
            s.oval(GOLD[0], 16, 7, 3, 1)
            sigil(s, GOLD[3], 15, 18, 3)
        else:
            fragments(s, JADE, 6 if state == "debris" else frame, 41)
            if state == "shatter":
                s.gem(CYAN, 16, 11+frame*2, 4-frame/2)
    elif kind in {"teleport_array", "spawn_circle", "golden_rune_glyph"}:
        ramp = {"teleport_array": CYAN, "spawn_circle": BLOOD, "golden_rune_glyph": GOLD}[kind]
        floor_ring(s, ramp, phase, state)
    elif kind in {"shrine_altar", "bone_altar"}:
        ramp = JADE if kind == "shrine_altar" else BLOOD
        block(s, STONE, 6, 25, 17, 4)
        block(s, STONE, 9, 18, 11, 7)
        block(s, GOLD if kind == "shrine_altar" else STONE, 5, 16, 19, 4)
        sigil(s, ramp[1], 15, 22, 3)
        if kind == "bone_altar":
            for x in (7, 23):
                s.oval(STONE[3], x, 13, 3, 3)
                s.oval(STONE[0], x, 13, 1, 1)
        if state != "used":
            s.gem(ramp, 16, 10+wave, 4)
            if state == "activate":
                orbit(s, ramp, phase, y=12, rx=10, ry=5)
    elif kind in {"courtyard_pillar", "restriction_pillar"}:
        block(s, STONE, 6, 26, 16, 3)
        if state == "broken":
            s.poly(STONE[1], (10, 25), (10, 18), (13, 16), (16, 20),
                   (18, 17), (20, 24))
            fragments(s, STONE, 5, 27)
        else:
            block(s, STONE, 10, 9, 10, 17)
            block(s, STONE, 7, 8, 15, 4)
            s.line(STONE[2], (11, 13), (11, 23))
            if kind == "restriction_pillar":
                for i in range(3):
                    color = CYAN[3] if i == frame % 3 else CYAN[1]
                    sigil(s, color, 15, 13+4*i, 2)
                orbit(s, CYAN, phase, rx=8, ry=7, count=3)
                if state == "overload":
                    s.line(CYAN[3], (7, 8+wave), (5, 13), (6, 17), (3, 21+wave))
    elif kind == "room_door":
        block(s, STONE, 4, 7, 23, 4, 2)
        block(s, STONE, 4, 9, 5, 20, 2)
        block(s, STONE, 23, 9, 5, 20, 2)
        block(s, STONE, 7, 27, 17, 3, 2)
        if state != "open":
            lift = (frame+1)*3 if state == "unlocking" else 0
            s.box(GOLD[0], 10, 10, 22, 26-lift)
            for x in (11, 15, 19, 22):
                s.line(GOLD[1], (x, 10), (x, 26-lift))
            s.gem(CYAN, 16, 18-lift/2, 3)
    elif kind == "stone_lantern":
        block(s, STONE, 6, 27, 17, 3)
        block(s, STONE, 11, 19, 7, 8)
        s.box(STONE[1], 9, 10, 23, 20)
        s.box(GOLD[1], 12, 11, 20, 17)
        s.oval(GOLD[3], 16, 15, 2, 2+frame%3)
        s.poly(STONE[2], (6, 11), (15, 5), (22, 7), (26, 11))
        s.line(STONE[3], (7, 11), (15, 6), (21, 7))
        s.oval(GOLD[2], 24, 12+frame, 1, 1)
    elif kind == "bamboo_cluster":
        for i in range(4):
            x, y = 8+i*5, 8+(i%2)*5
            tip = x+wave+(i-1)*2
            s.line(JADE[1], (x, 28), (tip, y), width=3)
            s.line(JADE[2], (x-1, 26), (tip-1, y+1))
            for height in (y+3, y+9):
                bend = round((tip+x)/2)
                s.poly(JADE[2], (bend, height+2), (bend-6, height-3), (bend-1, height-2))
                s.poly(JADE[1], (bend, height+3), (bend+5, height-1), (bend+3, height+3))
    elif kind == "spirit_herb":
        s.oval(STONE[1], 16, 23, 10, 4)
        if state != "harvested":
            for i in range(5):
                x = 5+i*5
                y = 12+(i%2)*3 + (wave if i%2 else -wave)
                s.poly(JADE[1], (15, 24), (x, y), (x+4, y+1), (17, 20))
                s.line(JADE[2], (x, y), (16, 22))
            s.gem(CYAN, 16, 12+wave/2, 3)
        else:
            s.line(JADE[1], (13, 22), (16, 19), (18, 23))
    elif kind == "sect_banner":
        banner(s, JADE, wave, sect=True)
    elif kind == "blood_pool_decor":
        s.oval(STONE[1], 16, 20, 13, 9)
        s.oval(BLOOD[0], 16, 19, 12, 7)
        s.oval(BLOOD[1], 15, 17, 10, 5)
        for i in range(4):
            s.oval(BLOOD[2], 7+i*6, 17+(i+frame)%4*2, 1.5, 1)
    elif kind == "mist_ravine_rock":
        s.poly(STONE[1], (4, 25), (9, 15), (13, 6), (21, 3),
               (25, 14), (28, 26), (18, 29))
        s.poly(STONE[2], (4, 25), (9, 15), (13, 6), (21, 3), (19, 13), (14, 24))
        s.line(STONE[0], (19, 13), (23, 15), (19, 21), (23, 25))
        s.line(STONE[3], (11, 13), (14, 7), (20, 4))
    elif kind == "petrified_chain":
        if state == "shatter":
            fragments(s, STONE, frame, 19)
        for i in range(6 if state == "idle" else 4-frame):
            x, y = 15+(i%2)*3, 5+i*4
            s.oval(STONE[1], x, y, 5, 3)
            s.oval(STONE[0], x, y, 2, 1)
            s.line(STONE[2], (x-4, y-1), (x-2, y-2), (x+1, y-2))
    elif kind == "void_crack_decor":
        s.poly(SOUL[0], (4, 25), (11, 16), (13, 19), (20, 8), (27, 6),
               (22, 14), (18, 16), (16, 23), (13, 21))
        s.line(SOUL[2], (5, 24), (11, 17), (13, 20), (21, 10), (26, 7))
        orbit(s, SOUL, phase, rx=11, ry=7, count=4)
    elif kind == "ancient_statue":
        block(s, STONE, 7, 26, 16, 3)
        if state == "crumble":
            fragments(s, GOLD, frame, 29)
        s.poly(STONE[1], (9, 25), (8, 20), (12, 17), (12, 12), (10, 9),
               (14, 4+frame), (20, 5+frame), (22, 11), (20, 16), (24, 22), (22, 25))
        s.poly(STONE[2], (12, 10), (14, 5+frame), (19, 6+frame), (17, 12), (13, 14))
        s.line(GOLD[3], (13, 10), (15, 10))
        s.line(GOLD[2], (10, 20), (15, 18), (17, 21), (21, 19))
    else:
        raise ValueError(f"Unsupported prop ID: {kind}")


def verify_frame(path, size, palette):
    with Image.open(path) as image:
        if image.mode != "RGBA" or image.size != tuple(size):
            raise ValueError(f"Incorrect mode or dimensions: {path}")
        pixels = np.asarray(image)
    rgba = set(map(tuple, pixels.reshape(-1, 4).tolist()))
    allowed = {(*color, 255) for color in palette.values()} | {(0, 0, 0, 0)}
    if not rgba <= allowed or (0, 0, 0, 0) not in rgba or len(rgba) < 3:
        raise ValueError(f"Incorrect palette, alpha or empty sprite: {path}")
    mask = pixels[:, :, 3] == 255
    padded = np.pad(mask, 1)
    interior = (padded[:-2, 1:-1] & padded[2:, 1:-1]
                & padded[1:-1, :-2] & padded[1:-1, 2:])
    if np.any(pixels[mask & ~interior, :3] != palette["ink_01"]):
        raise ValueError(f"Incorrect silhouette outline: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / OUTPUT)
    parser.add_argument("--only", metavar="ID")
    args = parser.parse_args()
    palette_data = json.loads(Path(__file__).with_name("palette.json").read_text(encoding="utf-8-sig"))
    palette = {item["id"]: ImageColor.getrgb(item["hex"]) for item in palette_data["colors"]}
    manifest = json.loads((ROOT / "assets/manifest.json").read_text(encoding="utf-8-sig"))
    assets = []
    for entry in manifest["assets"]:
        if entry["assigned_agent"] != "codex_antigravity":
            continue
        manifest_path = Path(entry["output_path"])
        if not manifest_path.is_relative_to(OUTPUT):
            continue
        target = manifest_path.relative_to(OUTPUT)
        if target.parts and target.parts[0] in GROUPS and args.only in (None, entry["id"]):
            assets.append((entry, target))
    if not assets:
        parser.error(f"No assigned weapon, projectile or prop matched {args.only!r}")

    renderers = {"weapons": draw_weapon, "projectiles": draw_projectile, "props": draw_prop}
    log = []
    duplicates = []
    for entry, target in assets:
        dest = args.out / target
        dest.mkdir(parents=True, exist_ok=True)
        renderer = renderers[target.parts[0]]
        kind = entry["id"].split("_", 1)[1]
        size = entry["size"]
        for animation, spec in entry["animations"].items():
            hashes = set()
            for frame in range(spec["frames"]):
                sprite = Sprite(size, palette)
                phase = math.tau * frame / spec["frames"]
                renderer(sprite, kind, animation, frame, phase)
                path = dest / f"{animation}_{frame:02d}.png"
                sprite.outline().save(path, compress_level=9)
                verify_frame(path, size, palette)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                hashes.add(digest)
                log.append({"id": entry["id"], "name": entry["name"],
                            "file": (target / path.name).as_posix(), "dims": size,
                            "animation": animation, "frame": frame,
                            "frames": spec["frames"], "loop": spec["loop"], "sha256": digest})
            if len(hashes) != spec["frames"]:
                duplicates.append(f"{entry['id']} / {animation}")

    if duplicates:
        raise ValueError("Duplicate frames: " + ", ".join(duplicates))

    name = "gen_items_weapons" if args.only is None else f"gen_items_weapons_{args.only}"
    (args.out / f"{name}_log.json").write_text(
        json.dumps({"assets": len(assets), "files": log}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Verified {len(log)} frames across {len(assets)} assets.")


if __name__ == "__main__":
    main()
