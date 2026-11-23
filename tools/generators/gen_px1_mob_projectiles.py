#!/usr/bin/env python3
"""Code-drawn enemy projectiles for the Blood Sea vertical slice (PX-1, 2026-11-24).

Four 16x16 projectiles, each `flight` (4 frames) + `impact` (4 frames), drawn facing east at native size from the master
palette only (`tools/generators/palette.json`, referenced by id), binary alpha, 1 px ink_01 outline on the outer silhouette.
No image model and no PixelLab: every pixel comes from the integer primitives below. Output (raw, `flight_00.png` ...):
assets/raw/environment_items/projectiles/<id>/ ; then `tools/scripts/build_processed.py --only <ids>` maps it to processed.

    python tools/generators/gen_px1_mob_projectiles.py [--out DIR]
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PALETTE = {c["id"]: tuple(int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)) for c in
           json.loads((ROOT / "tools/generators/palette.json").read_text(encoding="utf-8"))["colors"]}
SIZE = 16
IDS = {
    "pj_mob_crow_feather": "Blood Crow: barbed feather dart",
    "pj_mob_corpse_gore": "Blood Corpse: hurled gore clot",
    "pj_mob_lurker_bubble": "Blood Pool Lurker: blood-water bubble",
    "pj_mob_soul_wisp": "Vengeful Soul: jade-violet soul fire",
}
REFS = {
    "pj_mob_crow_feather": ["soul_02", "soul_04", "blood_05", "blood_06", "ink_01"],
    "pj_mob_corpse_gore": ["blood_02", "blood_03", "blood_05", "blood_07", "ink_01"],
    "pj_mob_lurker_bubble": ["blood_01", "blood_04", "blood_06", "blood_07", "ink_01"],
    "pj_mob_soul_wisp": ["soul_04", "soul_06", "soul_07", "jade_05", "ink_01"],
}


class Canvas:
    def __init__(self):
        self.px = {}

    def put(self, x, y, colour):
        if 1 <= x <= SIZE - 2 and 1 <= y <= SIZE - 2:
            self.px[(x, y)] = colour

    def rect(self, x, y, w, h, colour):
        for j in range(h):
            for i in range(w):
                self.put(x + i, y + j, colour)

    def disc(self, cx, cy, r, colour):
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r // 2:
                    self.put(x, y, colour)

    def ring(self, cx, cy, r, colour):
        for y in range(cy - r - 1, cy + r + 2):
            for x in range(cx - r - 1, cx + r + 2):
                d = (x - cx) ** 2 + (y - cy) ** 2
                if (r - 1) ** 2 < d <= r * r + 1:
                    self.put(x, y, colour)

    def image(self):
        out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        o = out.load()
        for (x, y), c in self.px.items():
            o[x, y] = (*PALETTE[c], 255)
        for (x, y) in list(self.px):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if 0 <= n[0] < SIZE and 0 <= n[1] < SIZE and n not in self.px:
                    o[n] = (*PALETTE["ink_01"], 255)
        return out


def burst(c, frame, tones, centre=(8, 8)):
    """Shared impact language: a bright core that shrinks while a broken ring grows and thins out."""
    cx, cy = centre
    dark, mid, light, spark = tones
    if frame == 0:
        c.disc(cx, cy, 3, mid)
        c.disc(cx, cy, 2, light)
        c.put(cx - 1, cy - 1, spark)
    elif frame == 1:
        c.ring(cx, cy, 4, mid)
        c.disc(cx, cy, 2, light)
        c.put(cx, cy, spark)
    elif frame == 2:
        for dx, dy in ((-5, 0), (5, 0), (0, -5), (0, 5), (-4, -3), (4, 3), (-4, 3), (4, -3)):
            c.rect(cx + dx, cy + dy, 1, 1, mid)
        c.rect(cx - 1, cy - 1, 2, 2, light)
    else:
        for dx, dy in ((-6, -1), (6, 1), (1, -6), (-1, 6), (-5, 4), (5, -4)):
            c.put(cx + dx, cy + dy, dark if (dx + dy) % 2 else mid)


def crow_feather(c, frame):
    bob = (0, -1, 0, 1)[frame]
    width = (1, 2, 1, 2)[frame]                       # the vane turns as it spins
    for x in range(3, 13):                            # shaft
        c.put(x, 8 + bob, "soul_04")
    for x in range(4, 11):                            # vane, barbed and widening toward the tail
        for w in range(1, width + 1):
            c.put(x, 8 + bob - w, "soul_02")
            c.put(x, 8 + bob + w, "soul_02" if x % 2 else "soul_04")
    c.rect(11, 7 + bob, 2, 2, "blood_05")             # blood-red tip
    c.put(13, 8 + bob, "blood_06")
    c.put(2, 8 + bob - width, "soul_02")
    c.put(2, 8 + bob + width, "soul_02")


def corpse_gore(c, frame):
    wob = (0, 1, 0, -1)[frame]
    c.disc(9, 8 + wob, 3, "blood_03")
    c.rect(8, 6 + wob, 2, 2, "blood_05")
    c.put(7, 6 + wob, "blood_07")
    c.put(9, 10 + wob, "blood_02")
    c.put(10, 8 + wob, "blood_02")
    for k, (dx, dy) in enumerate(((4, 0), (5, 1 - wob), (3, -1))):   # drips trailing behind
        c.put(7 - dx + 2 * (frame % 2), 8 + dy + wob * (k % 2), "blood_03" if k else "blood_02")


def lurker_bubble(c, frame):
    bob = (0, -1, 0, 1)[frame]
    r = (4, 4, 3, 4)[frame]
    c.disc(8, 8 + bob, r, "blood_04")
    c.disc(8, 8 + bob, r - 2, "blood_01")
    c.put(6, 6 + bob, "blood_07")
    c.put(7, 6 + bob, "blood_06")
    c.put(6, 7 + bob, "blood_06")
    c.put(10 + (frame % 2), 10 + bob, "blood_06")
    c.put(12, 8 + bob + (frame % 2) * 2, "blood_04")                  # spray off the bubble


def soul_wisp(c, frame):
    flick = (0, 1, 0, -1)[frame]
    c.disc(10, 8, 2, "soul_04")
    c.put(10, 8, "soul_07")
    c.put(9, 7, "soul_06")
    c.put(11, 7, "soul_06")
    c.put(11, 9, "soul_06")
    for k, x in enumerate(range(8, 2, -1)):                           # tail streaming west, jade at the very end
        c.put(x, 8 + (flick if k % 2 else -flick) * (k > 1), "soul_04" if k < 3 else "jade_05")
    c.put(13, 8 + flick, "soul_06")
    c.put(12, 6 - flick, "soul_07")


FLIGHT = {"pj_mob_crow_feather": crow_feather, "pj_mob_corpse_gore": corpse_gore,
          "pj_mob_lurker_bubble": lurker_bubble, "pj_mob_soul_wisp": soul_wisp}
BURST_TONES = {"pj_mob_crow_feather": ("soul_02", "soul_04", "blood_06", "blood_07"),
               "pj_mob_corpse_gore": ("blood_02", "blood_03", "blood_05", "blood_07"),
               "pj_mob_lurker_bubble": ("blood_01", "blood_04", "blood_06", "blood_07"),
               "pj_mob_soul_wisp": ("soul_03", "soul_05", "soul_06", "soul_07")}


def render():
    frames = {}
    for pid, fn in FLIGHT.items():
        for n in range(4):
            c = Canvas()
            fn(c, n)
            frames[(pid, "flight", n)] = c.image()
            c = Canvas()
            burst(c, n, BURST_TONES[pid])
            frames[(pid, "impact", n)] = c.image()
    return frames


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=ROOT / "assets/raw/environment_items/projectiles")
    args = ap.parse_args()
    for (pid, clip, n), image in render().items():
        folder = args.out / pid
        folder.mkdir(parents=True, exist_ok=True)
        image.save(folder / f"{clip}_{n:02d}.png")
    script = hashlib.sha256(Path(__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    for pid, brief in IDS.items():
        folder = args.out / pid
        lines = "".join(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(folder).as_posix()}\n"
                        for f in sorted(folder.rglob("*")) if f.is_file() and f.name != "provenance.json")
        record = {"id": pid, "producer": "Claude Code (Anthropic), PX-1 worker session tien-nghich-2d-88, 2026-11-24",
                  "method": "Original deterministic native-grid drawing (integer primitives, master palette only); no image model, no PixelLab, no input images.",
                  "brief": brief, "rights": "Original artwork created for this project.",
                  "seed": "none: no random generator is used",
                  "generator": "tools/generators/gen_px1_mob_projectiles.py", "generator_sha256_lf": script,
                  "palette": "tools/generators/palette.json", "native_px": [SIZE, SIZE],
                  "source_sha256": hashlib.sha256(lines.encode()).hexdigest()}
        (folder / "provenance.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(IDS)} projectiles x 8 frames to {args.out}")


if __name__ == "__main__":
    main()
