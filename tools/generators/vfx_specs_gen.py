"""Author the spritefx effect specs for Tien Nghich combat VFX (deterministic).

Writes tools/generators/vfx_specs/<id>.json. The JSON is the effect; every pixel is
rendered by spritefx (never painted). All ramp colors are picked from palette.json (40).
Usage: python -I vfx_specs_gen.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "vfx_specs"
PALETTE = "tien_nghich_40"
OUTLINE = "#14101a"  # ink_01

# ---- ramps: dark -> light, every hex is a palette.json color -----------------
RAMPS = {
    "ruby":   ["#4f0f22", "#7a1426", "#d03a4a", "#ee7a80", "#f9c4c0"],         # blood_02,03,05,06,07
    "volt":   ["#a51d35", "#ff3b30", "#ff9a7a", "#f5d765", "#fff0b0"],         # blood_04 thunder_05,06 bronze_06,07
    "wraith": ["#2d1b4e", "#6a3fa8", "#8f62cf", "#b99aeb", "#e3d6fb"],         # soul_02,04,05,06,07
    "umbra":  ["#1b1030", "#2d1b4e", "#46297a"],                                # soul_01,02,03 (smoke)
    "gold":   ["#63400f", "#8f5f14", "#bf8a1e", "#e0b030", "#f5d765", "#fff0b0"],
    "jade":   ["#17594b", "#22795f", "#2fa27a", "#5cc796", "#9ae3b8", "#d2f5de"],
    "ash":    ["#2c2733", "#49434f", "#6e6877"],                                   # ink_02,03,04
    "cyan":   ["#0f5f8c", "#28a8dc", "#8ae8ff", "#e8fdff"],
}


def K(*pairs, ease=None):
    d = {"keys": [list(p) for p in pairs]}
    if ease:
        d["ease"] = ease
    return d


def base(name, type_, canvas, phases, layers, order=None, **kw):
    spec = {"name": name, "type": type_, "canvas": canvas, "anchor": kw.pop("anchor", "center"),
            "fps": 30, "seed": kw.pop("seed", 1), "palette": PALETTE, "outline": OUTLINE,
            "ramps": {}, "phases": phases, "layers": layers}
    spec["order"] = order or [l["id"] for l in layers]
    spec.update(kw)
    names = {l["ramp"] for l in layers if "ramp" in l}
    spec["ramps"] = {k: {"colors": RAMPS[k]} for k in RAMPS if k in names}
    return spec


# ---------------------------------------------------------------- 1. blood sword
def kiem_khi():
    ph = [{"name": "swing", "ticks": 2, "fast": True},
          {"name": "impact", "ticks": 2, "fast": True, "events": ["hit"]},
          {"name": "shatter", "ticks": 10}]
    L = [
        {"id": "speed_out", "kind": "shape", "during": ["swing"], "ramp": "ruby", "role": "flash",
         "shape": {"sdf": "arc", "r": 26, "width": K((0, 2), (0.67, 2), (1, 1)), "taper": 0.4,
                   "from": K((0, 220), (0.5, 280), (1, 336)), "to": K((0, 290), (0.5, 350), (1, 406))},
         "value": K((0, 0.6), (1, 0.42))},
        {"id": "swing", "kind": "shape", "during": ["swing", "impact"], "ramp": "ruby", "role": "flash",
         "outline": "dark",
         "shape": {"sdf": "crescent", "r": 23,
                   "from": K((0, 230), (0.33, 206), (0.67, 198), (1, 198)),
                   "to": K((0, 360), (0.33, 440), (0.67, 452), (1, 452)),
                   "width": K((0, 7), (0.33, 12), (1, 12)), "peak": 0.7, "sharp": 1.4},
         "value_mode": "sweep", "edge": 0.45, "tail": 0.05, "value": K((0, 1.15), (0.33, 1.3), (1, 1.0))},
        {"id": "shatter", "kind": "shape", "during": ["shatter"], "ramp": "ruby", "role": "flash",
         "shape": {"sdf": "crescent", "r": K((0, 23), (1, 25), ease="out"),
                   "from": K((0, 205), (1, 300), ease="in"), "to": K((0, 94), (1, 104), ease="out"),
                   "width": K((0, 9), (0.5, 4), (1, 2), ease="out"), "peak": 0.7, "sharp": 1.4,
                   "rotate": K((0, 0), (1, 20), ease="out")},
         "value_mode": "sweep", "edge": 0.6, "tail": 0.2, "value": K((0, 1.0), (1, 0.7)),
         "break_up": {"after": 0.0, "noise": "angular", "scale": 26, "amount": 1, "bias": 0.35, "ease": "linear"}},
        {"id": "drops", "kind": "particles", "during": ["impact", "shatter"], "ramp": "ruby", "role": "spark",
         "tag": "sparkle",
         "emit": {"mode": "burst", "count": [9, 11], "from": {"area": "circle", "at": [2, 21], "r": 2.5}},
         "velocity": {"speed": [1.6, 2.8], "angle": 185, "spread": 55}, "drag": 0.15, "gravity": 0.06,
         "life": [6, 9], "stamp": {"kind": "streak", "size": K((0, 3), (1, 1))},
         "value_over_life": K((0, 1.2), (0.6, 0.9), (1, 0.5))},
    ]
    return base("huyet_hai_kiem_khi", "slash", [64, 64], ph, L, seed=5,
                outputs={"emissive": ["swing", "shatter"]})


# --------------------------------------------------------------- 2. heavenly thunder
def thien_loi():
    ph = [{"name": "contrast", "ticks": 1},
          {"name": "flash", "ticks": 2, "fast": True, "events": ["hit", "shake:4"]},
          {"name": "flicker", "ticks": 6, "fast": True},
          {"name": "impact", "ticks": 8},
          {"name": "linger", "ticks": 17}]
    G = [0, -9]
    L = [
        {"id": "dark", "kind": "shape", "during": ["contrast"], "ramp": "umbra", "value": 0.1, "at": [0, -9],
         "shape": {"sdf": "ellipse", "rx": 12, "ry": 5}},
        {"id": "afterglow", "kind": "shape", "during": ["impact", "linger"], "ramp": "volt", "at": G, "outline": "dark",
         "shape": {"sdf": "circle", "squash": 0.38, "r": K((0, 12), (1, 8), ease="out")},
         "value_mode": "radial", "edge": 0.1, "value": K((0, 0.8), (0.4, 0.5), (1, 0.2), ease="out"),
         "break_up": {"after": 0.3, "noise": "worley", "scale": 7, "amount": 1.1, "ease": "linear"}},
        {"id": "pool", "kind": "shape", "during": ["flash", "flicker", "impact"], "ramp": "volt", "role": "flash",
         "at": G, "shape": {"sdf": "circle", "squash": 0.38, "r": K((0, 18), (0.3, 13), (1, 4), ease="out")},
         "value_mode": "radial", "edge": 0.15, "value": K((0, 1.8), (0.3, 0.95), (1, 0.35), ease="out"),
         "break_up": {"after": 0.55, "noise": "worley", "scale": 6, "amount": 1}},
        {"id": "shock", "kind": "shape", "during": ["flicker", "impact"], "ramp": "volt", "at": G,
         "shape": {"sdf": "ring", "squash": 0.38, "r": K((0, 8), (1, 26), ease="out3"),
                   "width": K((0, 4), (1, 1))},
         "value": K((0, 0.6), (0.5, 0.45), (1, 0.2)),
         "break_up": {"after": 0.45, "noise": "angular", "scale": 6, "amount": 1.0}},
        {"id": "sparks", "kind": "particles", "during": ["flicker", "impact"], "ramp": "volt", "tag": "sparkle",
         "emit": {"mode": "burst", "count": [10, 12], "from": {"area": "circle", "r": 2, "at": [0, -11]}},
         "velocity": {"speed": [1.6, 2.8], "angle": 270, "spread": 150}, "gravity": 0.2, "drag": 0.03,
         "ground": {"y": -8, "bounce": 0.35}, "life": [10, 15],
         "stamp": {"kind": "streak", "size": K((0, 3), (1, 1))},
         "value_over_life": K((0, 0.95), (1, 0.3), ease="in")},
        {"id": "halo", "kind": "bolt", "during": ["flicker"], "ramp": "volt", "flicker": True, "outline": "dark",
         "from": [3, -58], "to": [0, -11], "roughness": 0.5, "generations": 5, "reseed": 2, "blank": [3, 1],
         "width": 3, "glow": 0, "value": 0.2},
        {"id": "bolt", "kind": "bolt", "during": ["flash", "flicker"], "ramp": "volt", "role": "flash",
         "flicker": True, "from": [3, -58], "to": [0, -11], "roughness": 0.5, "generations": 5,
         "branches": {"count": 3, "length": [0.18, 0.32], "angle": [25, 45]}, "reseed": 2, "blank": [3, 1],
         "width": 1, "glow": 2, "value": K((0, 2.2), (0.3, 1.6), (1, 1.0))},
        {"id": "glare", "kind": "shape", "during": ["flash", "flicker", "impact"], "ramp": "volt", "role": "flash",
         "at": [0, -11],
         "shape": {"sdf": "star", "points": 4, "r": K((0, 13), (0.25, 9), (1, 2), ease="out"), "inner": 0.22},
         "value_mode": "radial", "edge": 0.0, "value": K((0, 1.25), (0.4, 0.95), (1, 0.3), ease="out"),
         "break_up": {"after": 0.5, "noise": "angular", "amount": 1}},
    ]
    return base("thien_loi_cuc_canh", "bolt", [64, 64], ph, L, anchor="bottom", seed=9,
                outputs={"emissive": ["bolt", "glare", "pool"]})


# ------------------------------------------------------------------ 3. hit spark
def hit_spark():
    ph = [{"name": "flash", "ticks": 2, "fast": True, "events": ["hit"]},
          {"name": "burst", "ticks": 3}, {"name": "fade", "ticks": 7}]
    L = [
        {"id": "star", "kind": "shape", "during": ["flash", "burst", "fade"], "ramp": "volt", "role": "flash",
         "outline": "dark",
         "shape": {"sdf": "star", "points": 4, "r": K((0, 10), (0.15, 11), (1, 3), ease="out"), "inner": 0.3,
                   "rotate": 45},
         "value_mode": "radial", "value": K((0, 1.3), (0.15, 1.2), (0.4, 0.95), (1, 0.4), ease="out"), "edge": 0.0,
         "break_up": {"after": 0.6, "noise": "angular", "amount": 1}},
        {"id": "streaks", "kind": "particles", "during": ["flash", "burst", "fade"], "ramp": "volt", "tag": "debris",
         "emit": {"mode": "burst", "count": [6, 7], "from": {"area": "circle", "r": 1.5}},
         "velocity": {"speed": [1.6, 2.6], "angle": "out"}, "drag": 0.18, "life": [6, 9],
         "stamp": {"kind": "streak", "size": K((0, 3), (1, 1))},
         "value_over_life": K((0, 0.78), (1, 0.2), ease="in")},
    ]
    return base("hit_spark", "hit", [32, 32], ph, L, order=["streaks", "star"], seed=3,
                outputs={"emissive": ["star"]})


# ------------------------------------------------------------ 4. soul-banner black fog
def hac_vu():
    ph = [{"name": "swirl", "ticks": 48}]
    sw = {"sdf": "ellipse", "rx": 25, "ry": 24}
    L = [
        {"id": "pall", "kind": "field", "ramp": "umbra", "role": "smoke",
         "noise": {"kind": "worley", "scale": 11, "speed": 0.02, "invert": True}, "mask": sw,
         "radial_falloff": 0.7, "threshold": 0.35, "value": 0.9, "min_cluster": 6},
        {"id": "arms", "kind": "field", "ramp": "wraith", "role": "spark", "min_cluster": 5,
         "polar": {"swirl": 3, "rings": 1.2, "speed": 0.0208}, "mask": {"sdf": "ellipse", "rx": 24, "ry": 23},
         "threshold": 0.62, "value": 0.85},
        {"id": "puffs", "kind": "particles", "ramp": "umbra", "role": "smoke", "min_cluster": 4,
         "emit": {"mode": "stream", "rate": 0.3, "from": {"area": "ring", "r": 11, "width": 3}},
         "velocity": {"speed": [0.15, 0.3], "angle": "out"}, "life": [24, 34],
         "stamp": {"kind": "puff", "r": K((0, 2), (0.5, 5), (1, 5), ease="out"), "erode": "crescent",
                   "erode_angle": 120},
         "value_over_life": K((0, 0.7), (0.5, 0.9), (1, 0.0), ease="inout")},
        {"id": "wisps", "kind": "particles", "ramp": "wraith", "tag": "sparkle",
         "emit": {"mode": "stream", "rate": 0.35, "from": {"area": "ring", "r": 14, "width": 3}},
         "velocity": {"speed": [0.4, 0.7], "angle": 270, "spread": 25}, "wiggle": {"amp": 2.5, "freq": 0.05},
         "life": [16, 24], "stamp": {"kind": "streak", "size": K((0, 4), (1, 1))},
         "value_over_life": K((0, 0.6), (0.4, 1.0), (1, 0.3))},
        {"id": "eyes", "kind": "shape", "ramp": "wraith", "role": "flash", "tag": "sparkle", "min_cluster": 1,
         "shape": {"sdf": "capsule", "from": [-6, -2], "to": [-3, -3], "r": 1},
         "mirror": "x", "value": K((0, 0.9), (0.5, 1.4), (1, 0.9))},
    ]
    return base("ton_hon_phan_hac_vu", "aura", [64, 64], ph, L, loop=True, seed=21)


# -------------------------------------------------------------- 5. prohibition array
def tran_phap():
    nd, nc, nb, nr = 16, 30, 3, 36
    T = nd + nc + nb + nr
    d, c1, b1 = nd / T, (nd + nc) / T, (nd + nc + nb) / T   # draw end, channel end, burst end (as u)
    ph = [{"name": "draw", "ticks": nd}, {"name": "channel", "ticks": nc},
          {"name": "burst", "ticks": nb, "fast": True, "events": ["seal"]}, {"name": "release", "ticks": nr}]
    sq = 0.4
    brk = {"after": b1 + 0.02, "noise": "angular", "scale": 24, "bias": 0.0, "amount": 1.5, "ease": "linear"}

    def arc(i, w, r, a0, a1, v):
        return {"id": "ring_%s" % i, "kind": "shape", "ramp": "gold",
                "shape": {"sdf": "arc", "squash": sq, "width": w, "from": a0,
                          "to": K((0, a0 + 3), (d, a1), (1, a1)), "r": r},
                "value": K((0, v), (c1, v), (c1 + 0.01, 1.0), (b1 + 0.04, 0.85), (1, 0.55)),
                "break_up": brk, "min_cluster": 4}

    L = [arc(i, 2.5, 26, 90 * i, 90 * i + 90, 0.7) for i in range(4)]
    L += [
        {"id": "star", "kind": "shape", "ramp": "jade",
         "shape": {"sdf": "star", "squash": sq, "points": 8, "inner": 0.62, "onion": 1.8,
                   "r": K((0, 0), (0.03, 0), (d, 21), (1, 21)),
                   "rotate": K((0, 0), (d, 0), (c1, 45), (1, 52))},
         "value": K((0, 0.75), (c1, 0.75), (c1 + 0.01, 1.05), (b1 + 0.04, 0.9), (1, 0.6)),
         "break_up": dict(brk, amount=1.7), "min_cluster": 4},
        {"id": "runes", "kind": "shape", "ramp": "gold",
         "shape": {"sdf": "rays", "squash": sq, "count": 8, "inner": 22, "length": 25, "width": 3,
                   "rotate": K((0, 0), (d, 0), (c1, -45), (1, -52))},
         "value": K((0, 0.8), (c1, 0.8), (c1 + 0.01, 1.2), (1, 0.7)),
         "break_up": dict(brk, amount=1.7), "min_cluster": 4},
        {"id": "motes", "kind": "particles", "ramp": "jade", "tag": "sparkle", "during": ["channel"],
         "emit": {"mode": "stream", "rate": 0.7, "from": {"area": "rect", "size": [46, 14]}},
         "velocity": {"speed": [0.35, 0.7], "angle": 270, "spread": 10}, "life": [14, 24],
         "stamp": {"kind": "dot", "size": 1}, "value_over_life": K((0, 0.6), (0.3, 1.0), (1, 0.5))},
        {"id": "shock", "kind": "shape", "ramp": "gold", "role": "flash", "during": ["burst", "release"],
         "shape": {"sdf": "ring", "squash": sq, "r": K((0, 10), (0.12, 28), (1, 30), ease="out"),
                   "width": K((0, 3), (0.12, 2.5), (0.6, 2), (1, 1.5))},
         "value": K((0, 1.2), (0.4, 0.9), (1, 0.6)),
         "break_up": {"after": 0.3, "noise": "angular", "scale": 12, "bias": 0.0, "amount": 1.0, "ease": "out"}, "min_cluster": 4},
    ]
    return base("cam_che_tran_phap", "other", [64, 64], ph, L, loop=True, seed=11,
                sections={"start": ["draw"], "loop": ["channel"], "end": ["burst", "release"]})


# ---------------------------------------------------------------- 6. dash afterimage
def dash():
    ph = [{"name": "streak", "ticks": 1, "fast": True, "events": ["dash"]}, {"name": "fade", "ticks": 11}]
    # No character silhouette is invented: the engine tints the real sprite for the afterimage.
    # This effect is the qi shear (tapered bands) + dust trailing LEFT of the origin (mirror for left dashes).
    L = []
    for i, (y, ln) in enumerate(((-6, 12), (-1, 15), (4, 10))):
        L.append({"id": "band%d" % i, "kind": "shape", "during": ["streak", "fade"], "ramp": "wraith",
                  "tag": "sparkle",
                  "shape": {"sdf": "capsule", "from": [K((0, 3), (1, -4 - i), ease="out"), y],
                            "to": [K((0, 3 - ln), (1, -12 - 2 * i), ease="out"), y], "r": 1.5, "taper": 1},
                  "value_mode": "radial", "edge": 0.5, "value": K((0, 1.2 - 0.1 * i), (0.4, 0.8), (1, 0.2)),
                  "break_up": {"after": 0.3 + 0.06 * i, "noise": "angular", "scale": 4, "bias": 0.3, "amount": 1, "ease": "in"}})
    L.append({"id": "ghost", "kind": "shape", "during": ["streak", "fade"], "ramp": "wraith", "role": "flash",
              "tag": "sparkle",
              "shape": {"sdf": "arc", "r": 8, "width": 2, "taper": 0.6, "from": 120, "to": 240, "at": [3, 0]},
              "value": K((0, 1.1), (1, 0.2)), "break_up": {"after": 0.2, "noise": "angular", "amount": 1}})
    L.append({"id": "dust", "kind": "particles", "during": ["fade"], "ramp": "ash", "role": "smoke", "min_cluster": 3, "tag": "debris",
              "emit": {"mode": "burst", "count": 3, "from": {"area": "rect", "size": [6, 2], "at": [2, 10]}},
              "velocity": {"speed": [0.3, 0.6], "angle": 190, "spread": 30}, "life": [8, 10],
              "stamp": {"kind": "puff", "r": 2.5, "erode": "crescent"},
              "value_over_life": K((0, 0.9), (1, 0.0))})
    return base("dash_afterimage", "other", [32, 32], ph, L, seed=4)


# ---------------------------------------------------------- 7. spirit stone glint
def glint():
    ph = [{"name": "twinkle", "ticks": 4, "fast": True}, {"name": "fade", "ticks": 8}]
    L = [
        {"id": "beam", "kind": "shape", "during": ["twinkle", "fade"], "ramp": "jade", "tag": "sparkle",
         "shape": {"sdf": "star", "points": 4, "inner": 0.12, "rotate": 45,
                   "r": K((0, 2), (0.3, 9), (1, 0), ease="out")},
         "value_mode": "radial", "edge": 0.3, "value": 1.0},
        {"id": "star", "kind": "shape", "during": ["twinkle", "fade"], "ramp": "jade", "role": "flash",
         "tag": "sparkle",
         "shape": {"sdf": "star", "points": 4, "inner": 0.14, "r": K((0, 3), (0.25, 13), (0.8, 4), (1, 0), ease="out")},
         "value_mode": "radial", "edge": 0.35, "value": 1.25},
        {"id": "sat", "kind": "particles", "during": ["twinkle", "fade"], "ramp": "jade", "tag": "sparkle",
         "emit": {"mode": "burst", "count": 3, "from": {"area": "circle", "r": 9}}, "life": [6, 9],
         "stamp": {"kind": "plus", "size": K((0, 1), (0.4, 3), (1, 1))},
         "value_over_life": K((0, 1.0), (1, 0.5))},
    ]
    return base("spirit_stone_glint", "sparkle", [32, 32], ph, L, seed=6)


# ------------------------------------------------------------------- 8. charge-up
def charge_up():
    ph = [{"name": "gather", "ticks": 18}, {"name": "hold", "ticks": 12}]
    L = [
        {"id": "motes_in", "kind": "particles", "during": ["gather"], "ramp": "gold", "tag": "sparkle",
         "emit": {"mode": "stream", "rate": 0.9, "from": {"area": "ring", "r": 26, "width": 3}},
         "velocity": {"speed": -1.1, "angle": "out"}, "life": [10, 14],
         "stamp": {"kind": "streak", "size": K((0, 4), (1, 1))},
         "value_over_life": K((0, 0.5), (1, 1.0))},
        {"id": "motes_hold", "kind": "particles", "during": ["hold"], "ramp": "gold", "tag": "sparkle",
         "emit": {"mode": "stream", "rate": 0.5, "from": {"area": "ring", "r": 16, "width": 3}},
         "velocity": {"speed": -0.7, "angle": "out"}, "life": [10, 12],
         "stamp": {"kind": "dot", "size": 1}, "value_over_life": K((0, 0.6), (1, 1.0))},
        {"id": "orb", "kind": "shape", "ramp": "gold", "role": "flash", "during": ["gather", "hold"],
         "outline": "dark",
         "shape": {"sdf": "circle", "r": K((0, 2), (0.6, 7), (1, 7), ease="out")},
         "value_mode": "radial", "edge": 0.25, "value": K((0, 0.7), (0.6, 1.1), (1, 1.1))},
        {"id": "rays", "kind": "shape", "ramp": "gold", "during": ["gather", "hold"],
         "shape": {"sdf": "star", "points": 4, "inner": 0.15, "r": K((0, 0), (0.6, 13), (1, 13), ease="out")},
         "value_mode": "radial", "edge": 0.2, "value": 0.9},
    ]
    return base("charge_up", "other", [64, 64], ph, L, loop=True, seed=8,
                sections={"start": ["gather"], "loop": ["hold"]})


# ------------------------------------------------------ 9. realm breakthrough auras
REALMS = {"luyen_khi": "jade", "truc_co": "gold", "kim_dan": "volt", "nguyen_anh": "wraith"}


def aura(realm, ramp):
    ph = [{"name": "aura", "ticks": 36}]
    sq = 0.4
    L = []
    rings = {"luyen_khi": 1, "truc_co": 2, "kim_dan": 2, "nguyen_anh": 3}[realm]
    for i in range(rings):
        y = 17 - i * 6
        L.append({"id": "base%d" % i, "kind": "shape", "ramp": ramp, "at": [0, y], "tag": "sparkle",
                  "outline": "dark", "shape": {"sdf": "ellipse", "rx": 18 - i, "ry": 7 + i, "onion": 1},
                  "value": 0.55 + 0.12 * i})
        # three arc segments, 120 degrees of symmetry: the loop closes by itself
        for k in range(3):
            L.append({"id": "seg%d_%d" % (i, k), "kind": "shape", "ramp": ramp, "at": [0, y], "tag": "sparkle",
                      "shape": {"sdf": "arc", "squash": sq, "r": 19 - i, "width": 3, "taper": 0.5,
                                "from": 120 * k, "to": 120 * k + 70,
                                "rotate": K((0, 0), (1, 120 * (-1) ** i))},
                      "value": 1.1 - 0.1 * i})
    if realm in ("kim_dan", "nguyen_anh"):
        r0 = 7 if realm == "kim_dan" else 5
        L.append({"id": "halo", "kind": "shape", "ramp": ramp, "at": [0, -14], "role": "flash",
                  "outline": "dark", "shape": {"sdf": "circle", "r": r0},
                  "value_mode": "radial", "edge": 0.35, "value": K((0, 1.0), (0.5, 1.25), (1, 1.0))})
        L.append({"id": "halo_rays", "kind": "shape", "ramp": ramp, "at": [0, -14], "tag": "sparkle",
                  "shape": {"sdf": "rays", "count": 8, "inner": r0 + 3, "length": r0 + 6, "width": 1.5,
                            "rotate": K((0, 0), (1, 45))}, "value": 0.85})
    if realm == "truc_co":
        L.append({"id": "pillars", "kind": "particles", "ramp": ramp, "tag": "sparkle",
                  "emit": {"mode": "stream", "rate": 0.5, "from": {"area": "line", "from": [-17, 18], "to": [17, 18]}},
                  "velocity": {"speed": [0.9, 1.5], "angle": 270, "spread": 4}, "life": [16, 24],
                  "stamp": {"kind": "streak", "size": K((0, 6), (1, 2))},
                  "value_over_life": K((0, 0.6), (0.4, 1.0), (1, 0.3))})
    L.append({"id": "motes", "kind": "particles", "ramp": ramp, "tag": "sparkle",
              "emit": {"mode": "stream", "rate": 0.35, "from": {"area": "ring", "r": 13, "width": 3, "at": [0, 11]}},
              "velocity": {"speed": [0.7, 1.2], "angle": 270, "spread": 10}, "wiggle": {"amp": 1, "freq": 0.07},
              "life": [18, 26], "stamp": {"kind": "streak", "size": K((0, 4), (1, 1))},
              "value_over_life": K((0, 0.5), (0.4, 1.0), (1, 0.4))})
    return base("breakthrough_aura_" + realm, "aura", [64, 64], ph, L, loop=True, seed=31)


SPECS = {"huyet_hai_kiem_khi": kiem_khi, "thien_loi_cuc_canh": thien_loi, "hit_spark": hit_spark,
         "ton_hon_phan_hac_vu": hac_vu, "cam_che_tran_phap": tran_phap, "dash_afterimage": dash,
         "spirit_stone_glint": glint, "charge_up": charge_up}
for _r, _rp in REALMS.items():
    SPECS["breakthrough_aura_" + _r] = (lambda r=_r, rp=_rp: aura(r, rp))

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in SPECS.items():
        (OUT / (name + ".json")).write_text(json.dumps(fn(), indent=1) + "\n", encoding="utf-8")
        print("wrote", name)
