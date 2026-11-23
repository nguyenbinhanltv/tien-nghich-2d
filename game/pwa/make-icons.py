"""Draws the PWA icons (placeholder: a seal in the 43-colour palette) at 48x48 and enlarges with nearest-neighbour (192/180/512 px; 180 and 512 are not whole multiples of 48, the art is a flat seal so nothing shimmers).
Run: ../tools/.venvs/project/bin/python -I pwa/make-icons.py   (from game/). The PNGs are committed; this is the generator.
Not a reviewed art asset: an owner decision is needed before it ships as a store icon."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
pal = {c["id"]: c["hex"] for c in json.loads((HERE.parent.parent / "tools/generators/palette.json").read_text())["colors"]}
INK = json.loads((HERE.parent.parent / "tools/generators/palette.json").read_text())["outline"]
BG, RING, SEAL, SEAL_HI, MARK = INK, pal["bronze_04"], pal["blood_03"], pal["blood_05"], pal["bronze_06"]


def draw(size_px: int, pad: int) -> Image.Image:
    n = 48
    im = Image.new("RGB", (n, n), BG)
    d = ImageDraw.Draw(im)
    lo, hi = pad, n - 1 - pad
    d.ellipse([lo, lo, hi, hi], fill=RING)
    d.ellipse([lo + 2, lo + 2, hi - 2, hi - 2], fill=SEAL)
    d.ellipse([lo + 4, lo + 4, hi - 8, hi - 8], outline=SEAL_HI)
    c = n // 2
    # a slash through the seal: "nghich" (against the current)
    for i in range(-9, 10):
        d.rectangle([c + i - 1, c - i - 1, c + i, c - i], fill=MARK)
    d.rectangle([c - 8, c + 6, c + 8, c + 7], fill=MARK)
    return im.resize((size_px, size_px), Image.NEAREST)


out = HERE.parent / "public/icons"
out.mkdir(parents=True, exist_ok=True)
draw(192, 3).save(out / "icon-192.png")
draw(512, 3).save(out / "icon-512.png")
draw(180, 3).save(out / "icon-180.png")
draw(512, 9).save(out / "icon-maskable-512.png")  # safe zone: art inside the centre 80%
print("ok")
