"""4x contact sheets and 1x/2x strips of the processed Longtime VFX frames (review artifacts)."""
from pathlib import Path

from longtime_vfx import PROCESSED

GROUNDS = {"dark": (26, 18, 32, 255), "gray": (128, 128, 128, 255)}


def frames_of(eid, clip, pal, n):
    from PIL import Image
    return [Image.open(PROCESSED / eid / f"{clip}_{pal}_{i}.png").convert("RGBA") for i in range(n)]


def make_sheets(effects, ids, out: Path) -> int:
    from PIL import Image, ImageDraw
    out.mkdir(parents=True, exist_ok=True)
    for eid in ids:
        e = effects[eid]
        rows = [(clip, pal) for clip in e["clips"] for pal in e["palettes"]]
        any_f = frames_of(eid, rows[0][0], rows[0][1], 1)[0]
        w, h = any_f.size
        maxn = max(len(c["ms"]) for c in e["clips"].values())
        for ground, bg in GROUNDS.items():
            cw, ch = w * 4 + 4, h * 4 + 14
            big = Image.new("RGBA", (maxn * cw + 70, len(rows) * ch + 4), bg)
            d = ImageDraw.Draw(big)
            for r, (clip, pal) in enumerate(rows):
                ms = e["clips"][clip]["ms"]
                d.text((2, r * ch + 4), f"{clip}\n{pal}", fill=(230, 230, 230, 255))
                for i, f in enumerate(frames_of(eid, clip, pal, len(ms))):
                    x, y = 70 + i * cw, r * ch + 12
                    big.alpha_composite(f.resize((w * 4, h * 4), Image.NEAREST), (x, y))
                    d.text((x, y - 10), f"{i} {ms[i]}ms", fill=(255, 255, 160, 255))
            big.save(out / f"{eid}_contact4x_{ground}.png")
            # 1x and 2x strips: one row per clip/palette, 1x then 2x
            sw = maxn * (w * 3 + 6) + 70
            strip = Image.new("RGBA", (sw, len(rows) * (h * 2 + 6) + 4), bg)
            sd = ImageDraw.Draw(strip)
            for r, (clip, pal) in enumerate(rows):
                sd.text((2, r * (h * 2 + 6) + 4), f"{clip}\n{pal}", fill=(230, 230, 230, 255))
                for i, f in enumerate(frames_of(eid, clip, pal, len(e["clips"][clip]["ms"]))):
                    x = 70 + i * (w * 3 + 6)
                    y = r * (h * 2 + 6) + 2
                    strip.alpha_composite(f, (x, y + h // 2))
                    strip.alpha_composite(f.resize((w * 2, h * 2), Image.NEAREST), (x + w + 2, y))
            strip.save(out / f"{eid}_strip1x2x_{ground}.png")
            print("wrote", eid, ground)
    return 0
