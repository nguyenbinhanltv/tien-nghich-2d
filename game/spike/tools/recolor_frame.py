"""Recolour every opaque pixel of one atlas frame in place (simulates Pixel Kiln publishing a changed frame).
Usage: recolor_frame.py <atlas.png> <atlas.json> <frame-key> <r> <g> <b>   -> prints "x y" of the first opaque pixel (frame-local)."""
import json, sys, time
from PIL import Image

png, js, key, r, g, b = sys.argv[1:7]
f = json.load(open(js))["frames"][key]["frame"]
im = Image.open(png).convert("RGBA")
px = im.load()
first = None
for y in range(f["y"], f["y"] + f["h"]):
    for x in range(f["x"], f["x"] + f["w"]):
        if px[x, y][3]:
            px[x, y] = (int(r), int(g), int(b), 255)
            first = first or (x - f["x"], y - f["y"])
im.save(png, optimize=False)
print(*first, int(time.time() * 1000))  # x y, then epoch ms right after the file was written
