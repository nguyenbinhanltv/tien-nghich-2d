"""Effect definitions for the six Longtime VFX (see longtime_vfx.py).

Each EFFECTS entry: clips -> {ms, spec(palette, slots)} and palettes -> slot ramps.
Slots: "A" is the body ramp (3 steps), "B" the accent ramp (2 steps). Every variant of an ID uses the
same layers, so the masks are identical and only the ramp colours change (recolours).
Specs are plain SpriteFX JSON; the renderer chooses every colour.
"""
from longtime_vfx import ramp_colors


def ramps(slots):
    return {k: {"colors": ramp_colors(r, steps)} for k, (r, steps) in slots.items()}


def keys(*pairs, ease=None):
    d = {"keys": [list(p) for p in pairs]}
    if ease:
        d["ease"] = ease
    return d


# ---------------------------------------------------------------- lt_fx_impact
def impact_hit(pal, slots):
    return {
        "type": "hit", "canvas": [32, 32], "anchor": "center", "fps": 30, "seed": 11,
        "ramps": ramps(slots),
        "phases": [
            {"name": "flash", "ticks": 1, "fast": True, "events": ["hit"]},
            {"name": "burst", "ticks": 2},
            {"name": "fade", "ticks": 5},
        ],
        "layers": [
            {"id": "cross", "kind": "shape", "during": ["flash", "burst", "fade"], "ramp": "A",
             "outline": "dark",
             "shape": {"sdf": "star", "points": 4, "r": keys((0, 10), (0.2, 11), (0.5, 8), (1, 1), ease="inout"),
                       "inner": 0.14, "rotate": 0},
             "value_mode": "radial", "edge": 0.1,
             "value": keys((0, 1.1), (0.4, 0.85), (1, 0.4), ease="out"),
             "break_up": {"after": 0.45, "noise": "angular", "scale": 12, "amount": 1.6, "ease": "in"}},
            {"id": "diag", "kind": "shape", "during": ["flash", "burst", "fade"], "ramp": "A",
             "outline": "dark",
             "shape": {"sdf": "star", "points": 4, "r": keys((0, 6), (0.2, 7), (0.5, 5), (1, 2), ease="inout"),
                       "inner": 0.2, "rotate": 45},
             "value_mode": "radial", "edge": 0.1,
             "value": keys((0, 1.1), (0.4, 0.85), (1, 0.4), ease="out"),
             "break_up": {"after": 0.6, "noise": "angular", "scale": 12, "amount": 1, "ease": "in"}},
            {"id": "core", "kind": "shape", "during": ["flash", "burst"], "ramp": "A",
             "shape": {"sdf": "circle", "r": keys((0, 2.5), (1, 1.5), ease="out")},
             "value": 1.3},
            {"id": "chips", "kind": "particles", "during": ["flash", "burst", "fade"], "ramp": "B",
             "tag": "debris", "outline": "dark",
             "emit": {"mode": "burst", "count": [6, 6], "from": {"area": "ring", "r": 3}},
             "velocity": {"speed": [1.8, 2.8], "angle": "out"}, "drag": 0.2, "life": [5, 7],
             "stamp": {"kind": "streak", "size": keys((0, 4), (1, 1))},
             "value_over_life": keys((0, 0.95), (1, 0.4), ease="in")},
        ],
        "order": ["chips", "cross", "diag", "core"],
        "outputs": {"emissive": ["core"]},
    }



def phases(*rows):
    return [dict(name=n, ticks=t, **({"fast": True} if f else {}), **({"events": e} if e else {}))
            for n, t, f, e in rows]


# ---------------------------------------------------------------- lt_fx_ward_pulse
SQ = 0.625  # 1.6:1 ground ellipse (design decision 8, provisional)


def ward_place(pal, slots):
    return {
        "type": "shockwave", "canvas": [48, 48], "anchor": "center", "fps": 15, "seed": 21,
        "ramps": ramps(slots),
        "phases": phases(("drop", 2, True, ["place"]), ("settle", 2, False, None), ("end", 1, True, None)),
        "layers": [
            {"id": "ring", "kind": "shape", "during": ["drop", "settle", "end"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "ring", "r": keys((0, 3), (0.25, 13), (1, 12), ease="out"),
                       "width": 1, "squash": SQ},
             "value_mode": "near", "edge": 0.35, "value": keys((0, 1.0), (0.5, 0.8), (1, 0.4)),
             "break_up": {"after": 0.7, "noise": "angular", "scale": 12, "amount": 1}},
            {"id": "dot", "kind": "shape", "during": ["drop", "settle"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "circle", "r": keys((0, 2), (1, 1)), "squash": SQ},
             "value": 1.3},
        ],
        "order": ["ring", "dot"],
    }


def ward_release(pal, slots):
    return {
        "type": "shockwave", "canvas": [48, 48], "anchor": "center", "fps": 25, "seed": 22,
        "ramps": ramps(slots),
        "phases": phases(("pulse", 2, True, ["pulse"]), ("fade", 4, False, None), ("end", 2, True, None)),
        "layers": [
            {"id": "wave", "kind": "shape", "during": ["pulse", "fade", "end"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "ring", "r": keys((0, 3), (0.15, 17), (0.3, 20), (1, 21), ease="out"),
                       "width": 1, "squash": SQ},
             "value_mode": "near", "edge": 0.3, "value": keys((0, 1.0), (1, 0.5)),
             "break_up": {"after": 0.7, "noise": "angular", "scale": 12, "amount": 1}},
            {"id": "flash", "kind": "shape", "during": ["pulse"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "circle", "r": keys((0, 3), (1, 1.5), ease="out"), "squash": SQ},
             "value": 1.3},
        ],
        "order": ["wave", "flash"],
    }


WARD_PALETTES = {
    "anchor": {"A": ("bronze", [1, 3, 5, 6])},
    "mirror": {"A": ("ink", [1, 2, 3, 4])},
    "thorn": {"A": ("jade", [1, 3, 5, 6])},
    "tide": {"A": ("bolt", [0, 1, 2, 3])},
    "flare": {"A": ("blood", [2, 4, 5, 6])},
    "bell": {"A": ("soul", [2, 4, 5, 6])},
}


# ---------------------------------------------------------------- lt_fx_craft
def craft_finish(pal, slots):
    tip = keys((0, -6), (0.15, -19), (1, -19), ease="out")
    return {
        "type": "sparkle", "canvas": [32, 32], "anchor": [16, 28], "fps": 20, "seed": 31,
        "ramps": ramps(slots),
        "phases": phases(("rise", 3, True, None), ("done", 1, True, ["done"]), ("fade", 4, False, None), ("end", 2, True, None)),
        "layers": [
            {"id": "glint", "kind": "shape", "during": ["rise", "done", "fade", "end"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "star", "points": 4, "r": keys((0, 1), (0.12, 5.5), (1, 5.5), ease="out"),
                       "inner": 0.3, "at": [0, tip]},
             "value": 1.0,
             "break_up": {"after": 0.85, "noise": "angular", "scale": 8, "amount": 1.0}},
            {"id": "streaks", "kind": "particles", "during": ["rise", "done", "fade", "end"], "ramp": "A",
             "tag": "sparkle", "outline": "dark",
             "emit": {"mode": "burst", "count": [3, 3], "from": {"area": "rect", "size": [6, 2], "at": [0, -4]}},
             "velocity": {"speed": [2.2, 3.2], "angle": 270, "spread": 16}, "drag": 0.12, "life": [4, 5],
             "stamp": {"kind": "streak", "size": keys((0, 2), (0.3, 5), (1, 2))},
             "value_over_life": keys((0, 0.9), (1, 0.3), ease="in")},
            {"id": "motes", "kind": "particles", "during": ["rise", "done", "fade", "end"], "ramp": "A",
             "tag": "sparkle", "outline": "dark",
             "emit": {"mode": "burst", "count": [3, 3], "from": {"area": "rect", "size": [8, 2], "at": [0, -3]}},
             "velocity": {"speed": [0.7, 1.2], "angle": 270, "spread": 60}, "drag": 0.05, "life": [7, 8],
             "stamp": {"kind": "dot", "size": 2},
             "value_over_life": keys((0, 0.9), (1, 0.3), ease="in")},
        ],
        "order": ["motes", "streaks", "glint"],
    }


CRAFT_PALETTES = {
    "bronze": {"A": ("bronze", [1, 3, 5, 6])},
    "jade": {"A": ("jade", [1, 3, 5, 6])},
    "soul": {"A": ("soul", [2, 4, 5, 6])},
}


# ---------------------------------------------------------------- lt_fx_stamp
def stamp_press(pal, slots):
    return {
        "type": "other", "canvas": [48, 48], "anchor": "center", "fps": 20, "seed": 41,
        "ramps": ramps(slots),
        "phases": phases(("descend", 3, True, None), ("land", 1, True, ["land"]), ("settle", 6, False, None), ("end", 2, True, None)),
        "layers": [
            {"id": "frame", "kind": "shape", "during": ["descend", "land", "settle", "end"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "star", "points": 4, "inner": 0.707, "rotate": 45, "onion": keys((0, 1), (0.25, 2), (1, 1)),
                       "r": keys((0, 2), (0.1, 8), (0.25, 16), (0.35, 15), (1, 14), ease="out")},
             "value": keys((0, 0.7), (0.25, 1.1), (0.5, 0.8), (1, 0.4)),
             "break_up": {"after": 0.6, "noise": "angular", "scale": 12, "amount": 1, "ease": "in"}},
            {"id": "glyph", "kind": "shape", "during": ["land", "settle", "end"], "ramp": "A", "outline": "dark",
             "shape": {"sdf": "star", "points": 4, "inner": 0.22, "r": keys((0, 8), (1, 5), ease="out")},
             "value": keys((0, 1.2), (0.5, 0.8), (1, 0.4)),
             "break_up": {"after": 0.4, "noise": "angular", "scale": 10, "amount": 1, "ease": "in"}},
            {"id": "dust", "kind": "particles", "during": ["land", "settle", "end"], "ramp": "A", "tag": "debris",
             "outline": "dark",
             "emit": {"mode": "burst", "count": [4, 4], "from": {"area": "ring", "r": 15}},
             "velocity": {"speed": [0.9, 1.4], "angle": "out"}, "drag": 0.12, "life": [6, 8],
             "stamp": {"kind": "dot", "size": 2},
             "value_over_life": keys((0, 0.9), (1, 0.3), ease="in")},
        ],
        "order": ["dust", "frame", "glyph"],
    }


STAMP_PALETTES = {
    "mark": {"A": ("bronze", [1, 3, 5, 6])},
    "oath": {"A": ("soul", [2, 4, 5, 6])},
    "bank": {"A": ("jade", [1, 3, 5, 6])},
}


# ---------------------------------------------------------------- lt_fx_gate_unseal
def gate_unseal(pal, slots):
    cy = -24  # centre of the 32x48 gate opening above the pivot (24,61)
    return {
        "type": "other", "canvas": [48, 64], "anchor": [24, 61], "fps": 20, "seed": 51,
        "ramps": ramps(slots),
        "phases": phases(("crack", 3, True, None), ("burst", 2, True, None), ("clear", 4, False, None), ("end", 3, True, None)),
        "layers": [
            {"id": "cracks", "kind": "shape", "during": ["crack", "burst", "clear", "end"], "ramp": "B",
             "outline": "dark",
             "shape": {"sdf": "rays", "count": 6, "inner": 1, "rotate": 15, "width": 1,
                       "length": keys((0, 2), (0.27, 11), (1, 11), ease="out"), "at": [0, cy]},
             "value": keys((0, 1.0), (0.5, 0.9), (1, 0.5)),
             "break_up": {"after": 0.5, "noise": "angular", "scale": 9, "amount": 1.5, "ease": "in"}},
            {"id": "light", "kind": "shape", "during": ["crack", "burst", "clear", "end"], "ramp": "A",
             "outline": "dark",
             "shape": {"sdf": "ellipse", "rx": keys((0, 1), (0.15, 4), (0.27, 7), (1, 3), ease="out"),
                       "ry": keys((0, 2), (0.15, 8), (0.27, 14), (1, 6), ease="out"), "at": [0, cy]},
             "value_mode": "radial", "edge": 0.2,
             "value": keys((0, 0.6), (0.27, 1.2), (0.6, 0.8), (1, 0.4)),
             "break_up": {"after": 0.45, "noise": "worley", "scale": 4, "amount": 1.4, "ease": "in"}},
            {"id": "shards", "kind": "particles", "during": ["burst", "clear", "end"], "ramp": "B", "tag": "debris",
             "outline": "dark",
             "emit": {"mode": "burst", "count": [7, 7], "from": {"area": "ring", "r": 7, "at": [0, cy]}},
             "velocity": {"speed": [0.9, 1.5], "angle": "out"}, "drag": 0.12, "life": [4, 5],
             "stamp": {"kind": "dot", "size": 2},
             "value_over_life": keys((0, 0.9), (1, 0.3), ease="in")},
        ],
        "order": ["cracks", "light", "shards"],
    }


GATE_PALETTES = {"base": {"A": ("jade", [1, 3, 5]), "B": ("ink", [2, 4])}}


# ---------------------------------------------------------------- lt_fx_core_breach
def core_breach(pal, slots):
    return {
        "type": "explosion", "canvas": [64, 64], "anchor": "center", "fps": 20, "seed": 61,
        "ramps": ramps(slots),
        "phases": phases(("crack", 3, True, ["breach", "shake:3"]), ("blast", 4, False, None),
                         ("burn", 4, False, None), ("linger", 3, False, None), ("end", 2, True, None)),
        "layers": [
            {"id": "spikes", "kind": "shape", "during": ["crack", "blast", "burn", "linger", "end"], "ramp": "A",
             "outline": "dark", "role": "flash",
             "shape": {"sdf": "star", "points": 8, "inner": 0.2, "r": keys((0, 16), (0.2, 28), (0.5, 24), (1, 6), ease="out"),
                       "rotate": 12},
             "value_mode": "radial", "edge": 0.15,
             "value": keys((0, 1.2), (0.3, 0.95), (1, 0.4), ease="out"),
             "break_up": {"after": 0.45, "noise": "angular", "scale": 14, "amount": 1, "ease": "in"}},
            {"id": "core", "kind": "shape", "during": ["crack", "blast", "burn"], "ramp": "A", "role": "fire",
             "outline": "dark",
             "shape": {"sdf": "circle", "r": keys((0, 6), (0.25, 11), (1, 3), ease="out")},
             "value_mode": "radial", "edge": 0.3,
             "value": keys((0, 1.3), (0.4, 1.0), (1, 0.5)),
             "break_up": {"after": 0.6, "noise": "worley", "scale": 4, "amount": 1, "ease": "in"}},
            {"id": "debris", "kind": "particles", "during": ["crack", "blast", "burn", "linger", "end"], "ramp": "B",
             "tag": "debris", "outline": "dark",
             "emit": {"mode": "burst", "count": [9, 9], "from": {"area": "circle", "r": 4}},
             "velocity": {"speed": [1.8, 3.4], "angle": "out"}, "drag": 0.08, "gravity": 0.1, "life": [10, 15],
             "stamp": {"kind": "dot", "size": keys((0, 3), (1, 1))},
             "value_over_life": keys((0, 0.95), (1, 0.3), ease="in")},
            {"id": "smoke", "kind": "particles", "during": ["blast", "burn", "linger", "end"], "ramp": "B", "role": "smoke",
             "outline": "dark", "min_cluster": 4,
             "emit": {"mode": "burst", "count": [6, 6], "from": {"area": "circle", "r": 7}},
             "velocity": {"speed": [0.4, 0.9], "angle": "out"}, "drag": 0.1, "life": [10, 12],
             "stamp": {"kind": "puff", "r": keys((0, 2), (0.4, 4), (1, 4)), "erode": "crescent"},
             "value_over_life": keys((0, 0.9), (1, 0.2))},
        ],
        "order": ["smoke", "debris", "spikes", "core"],
    }


CORE_PALETTES = {"base": {"A": ("blood", [2, 4, 6]), "B": ("ink", [1, 2])}}


EFFECTS = {
    "lt_fx_impact": {
        "clips": {"hit": {"ms": [33, 33, 40, 40, 40, 40, 50, 60], "spec": impact_hit}},
        "palettes": {
            "stone": {"A": ("ink", [2, 3, 4]), "B": ("bronze", [2, 4])},
            "spirit": {"A": ("soul", [3, 5, 6]), "B": ("jade", [3, 5])},
        },
    },
    "lt_fx_ward_pulse": {
        "clips": {"place": {"ms": [40, 40, 50, 50, 60], "spec": ward_place},
                  "release": {"ms": [40, 40, 45, 45, 50, 55, 60, 70], "spec": ward_release}},
        "palettes": WARD_PALETTES,
    },
    "lt_fx_craft": {
        "clips": {"finish": {"ms": [50] * 4 + [60] * 4 + [70] * 2, "spec": craft_finish}},
        "palettes": CRAFT_PALETTES,
    },
    "lt_fx_stamp": {
        "clips": {"press": {"ms": [40, 40, 40] + [60] * 8 + [50], "spec": stamp_press}},
        "palettes": STAMP_PALETTES,
    },
    "lt_fx_gate_unseal": {
        "clips": {"unseal": {"ms": [60] * 6 + [50] * 6, "spec": gate_unseal}},
        "palettes": GATE_PALETTES,
    },
    "lt_fx_core_breach": {
        "clips": {"breach": {"ms": [33] * 3 + [40] * 4 + [50] * 4 + [60] * 4 + [70], "spec": core_breach}},
        "palettes": CORE_PALETTES,
    },
}

